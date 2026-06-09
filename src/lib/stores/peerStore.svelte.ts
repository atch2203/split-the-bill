import Peer, { type DataConnection } from 'peerjs';
import type { ReceiptItem, Person, BillSettings, PaymentMethod } from '$lib/types';

// ===========================================================================
// Floating-rendezvous (floating-R) peer store with mutual authentication.
//
// Topology: a single room id `R` (the share-link id) is the rendezvous. EVERY
// peer connects to R; whoever currently HOLDS R is the authoritative host. When
// the holder dies, the surviving peers deterministically elect one of themselves
// to re-bind R (the PeerJS broker is the final arbiter of who actually gets it),
// and everyone reconnects to R. The returning original host reclaims R via a
// cooperative handoff. No id is ever permanently tied to one peer except R, which
// floats to whoever is hosting.
//
// Trust: anyone with the link can already read+edit, so for OPEN rooms "becoming
// host" is no escalation. For PASSCODE rooms a mutual HMAC challenge-response
// gates host-eligibility: a host must prove knowledge of the passcode to guests
// (and vice-versa) and the raw passcode never travels on the wire — so a rogue
// peer that knows R but not the passcode cannot squat R and harvest passcodes.
// ===========================================================================

// --- Message types ---------------------------------------------------------
type SyncMessage = {
	type: 'sync';
	payload: {
		items: ReceiptItem[];
		people: Person[];
		settings: BillSettings;
		colorIndex: number;
		paymentMethods?: PaymentMethod[];
	};
};

type ActionMessage = {
	type: 'action';
	action: string;
	args: unknown[];
};

type PeerCountMessage = {
	type: 'peerCount';
	count: number; // Total users including host
};

// Mutual auth: host → guest challenge.
type AuthRequestMessage = {
	type: 'authRequest';
	requiresPasscode: boolean;
	nonce: string; // host's challenge nonce
};

// Mutual auth: guest → host. `proof` = HMAC(passcode, hostNonce); `nonce` is the
// guest's own challenge the host must answer. Raw passcode is never sent.
type AuthResponseMessage = {
	type: 'authResponse';
	proof: string;
	nonce: string;
};

// Mutual auth: host → guest result. `proof` = HMAC(passcode, guestNonce) — proves
// the host also knows the passcode, defeating a rogue squatter.
type AuthResultMessage = {
	type: 'authResult';
	success: boolean;
	error?: string;
	proof?: string;
};

// Succession roster: the host broadcasts the ordered list of guest peer ids (join
// order). Cached by every guest and used to elect the next host on failover.
type RosterMessage = {
	type: 'roster';
	peerIds: string[];
};

// Cheap liveness beacon. WebRTC does NOT fire DataConnection 'close' promptly on
// an ungraceful host death — the host pings frequently so guests notice silence fast.
type PingMessage = {
	type: 'ping';
};

// A peer asks the current holder to hand R back to it. `reclaim` = the returning
// original host; `takeover` = a guest manually pressing "Take control".
type ClaimMessage = {
	type: 'reclaim' | 'takeover';
};

// The current holder announces a PLANNED release of R (so guests reconnect to R
// instead of treating it as a host death and electing).
type HandoffMessage = {
	type: 'handoff';
};

type PeerMessage =
	| SyncMessage
	| ActionMessage
	| PeerCountMessage
	| AuthRequestMessage
	| AuthResponseMessage
	| AuthResultMessage
	| RosterMessage
	| PingMessage
	| ClaimMessage
	| HandoffMessage;

// --- Connection state ------------------------------------------------------
let peer = $state<Peer | null>(null);
let peerId = $state<string | null>(null);
let isHost = $state<boolean>(false); // holds R with the full host UI
let isActingHost = $state<boolean>(false); // holds R but keeps the GUEST UI (silent failover)
let isProvisionalHost = $state<boolean>(false); // manual takeover; full host UI, subordinate to original
let isConnected = $state<boolean>(false);
let connections = $state<DataConnection[]>([]);
let isJoining = $state<boolean>(false);
const authenticatedConns = new WeakSet<DataConnection>();
const connNonces = new WeakMap<DataConnection, string>(); // host: per-conn challenge nonce
let hostConnection = $state<DataConnection | null>(null);
let error = $state<string | null>(null);
let totalUsers = $state<number>(1);

// --- Room / rendezvous identity --------------------------------------------
let roomId = $state<string | null>(null); // R: the floating rendezvous id (share link)
let wasOriginalHost = $state<boolean>(false); // true for the peer that first created R
let hostPasscode = $state<string>(''); // passcode we enforce while holding R
let lastPasscode = $state<string>(''); // passcode we authenticate with as a guest
let awaitingPasscode = $state<boolean>(false);
let pendingConnection = $state<DataConnection | null>(null);
// Resumes a guest auth flow once the user supplies a passcode (closure set during auth).
let resumeAuth: ((passcode: string) => void) | null = null;

// --- Initial-join retry (guest) --------------------------------------------
const MAX_JOIN_ATTEMPTS = 5;
let joinAttempts = $state<number>(0);
let joinFailed = $state<boolean>(false);
let joinRetryTimer: ReturnType<typeof setTimeout> | null = null;
let joinRetryResolve: (() => void) | null = null;
let joinAborted = false;
let tearingDown = false;

// --- Reconnection / host-loss state ----------------------------------------
let canReconnect = $state<boolean>(false);
let isReconnecting = $state<boolean>(false);
let reconnectAttempts = $state<number>(0);
let inFailover = $state<boolean>(false); // running on a non-original host (drives Take-control button)

// --- Failover machinery ----------------------------------------------------
let successionRoster = $state<string[]>([]); // cached guest ids in join order
const knownDeadPeers = new Set<string>(); // peers proven unreachable this outage
// While set, a host-connection close means "claim R" (reclaim/takeover) instead of "elect".
let pendingClaim: 'reclaim' | 'takeover' | null = null;
let expectingHandoff = false; // a planned handoff is in progress — reconnect, don't elect

const CLAIM_BASE_MS = 1500; // rank-0 waits this long before claiming R (rides brief blips)
const STAGGER_MS = 800; // each lower rank escalates its claim this much later
const ROSTER_HEARTBEAT_MS = 5000;
const HOST_PING_MS = 2000; // backstop liveness beacon (ICE state is the primary signal)
const HOST_SILENCE_MS = 3500; // backstop: declare dead after this much total silence
const ICE_CONFIRM_MS = 1500; // confirm an ICE 'disconnected' before treating it as loss
const FAILOVER_CONNECT_MS = 5000; // short connect timeout while probing R during failover
const HANDOFF_WINDOW_MS = 3000;

let rosterHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let hostWatchdogTimer: ReturnType<typeof setInterval> | null = null;
let handoffTimer: ReturnType<typeof setTimeout> | null = null;
let claimTimer: ReturnType<typeof setTimeout> | null = null; // rank-staggered R-claim escalation
let iceConfirmTimer: ReturnType<typeof setTimeout> | null = null; // pending ICE-disconnect confirmation
let failoverGen = 0; // generation token so only the latest failover loop runs
let awaitingHandoff = $state<boolean>(false); // a newly-bound host suppresses broadcast until pushed state arrives
let lastHostActivity = 0;

// --- Store integration callbacks -------------------------------------------
let onStateSync: ((state: SyncMessage['payload']) => void) | null = null;
let onAction: ((action: string, args: unknown[]) => void) | null = null;
let getState: (() => SyncMessage['payload']) | null = null;
let stateFilter: ((s: SyncMessage['payload']) => SyncMessage['payload']) | null = null;

function generateRoomId(): string {
	return Math.random().toString(36).substring(2, 8);
}

// --- Crypto: HMAC-SHA256 challenge proofs ----------------------------------
function genNonce(): string {
	const a = crypto.getRandomValues(new Uint32Array(4));
	return Array.from(a, (n) => n.toString(36)).join('');
}

async function hmac(key: string, msg: string): Promise<string> {
	const enc = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// --- ICE / peer creation ---------------------------------------------------
// Cache the fetched ICE/TURN config so a failover rebind doesn't pay a network
// round-trip to re-fetch it (that round-trip was adding latency to recovery).
// Short TTL so time-limited TURN credentials still get refreshed.
const ICE_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedIceServers: RTCIceServer[] | null = null;
let cachedIceAt = 0;

async function getIceServers(): Promise<RTCIceServer[]> {
	if (cachedIceServers && Date.now() - cachedIceAt < ICE_CACHE_TTL_MS) {
		return cachedIceServers;
	}
	try {
		// Bound the request so a hung worker can't stall peer creation / reconnect.
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 4000);
		const response = await fetch('https://lucky-poetry-9bdc.atch22037433.workers.dev/', {
			signal: ctrl.signal
		}).finally(() => clearTimeout(t));
		if (!response.ok) throw new Error('Failed to fetch ICE servers');
		const data = await response.json();
		cachedIceServers = data.iceServers || [];
		cachedIceAt = Date.now();
		return cachedIceServers!;
	} catch (err) {
		console.warn('Failed to fetch TURN credentials, using default STUN:', err);
		// Fall back to cache if we have any, else public STUN.
		return cachedIceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
	}
}

async function createPeer(id?: string): Promise<Peer> {
	const iceServers = await getIceServers();

	return new Promise((resolve, reject) => {
		const newPeer = new Peer(id || generateRoomId(), { config: { iceServers } });
		newPeer.on('open', (openId) => {
			peer = newPeer;
			peerId = openId;
			resolve(newPeer);
		});
		newPeer.on('error', (err) => reject(err));
	});
}

// ===========================================================================
// Host side: accept and authenticate incoming connections, relay state. Shared
// by the original host, an acting host, and a provisional host — anyone holding R.
// ===========================================================================
function attachHostHandlers(p: Peer): void {
	p.on('connection', (conn) => handleIncomingConnection(conn));
}

function handleIncomingConnection(conn: DataConnection): void {
	// Only relay if we currently hold R. Otherwise (a stray inbound while we're a
	// plain guest) reject so we never leak state.
	if (!(isHost || isActingHost || isProvisionalHost)) {
		conn.on('open', () => conn.close());
		return;
	}

	conn.on('open', () => {
		const nonce = genNonce();
		connNonces.set(conn, nonce);
		conn.send({ type: 'authRequest', requiresPasscode: !!hostPasscode, nonce } as AuthRequestMessage);
	});

	conn.on('data', (data) => {
		if (!data || typeof data !== 'object') return;
		const message = data as PeerMessage;
		if (typeof (message as { type?: unknown }).type !== 'string') return;

		if (message.type === 'authResponse') {
			void verifyGuest(conn, message);
		} else if (message.type === 'action' && onAction) {
			if (!authenticatedConns.has(conn)) return;
			if (typeof message.action !== 'string') return;
			if (!Array.isArray(message.args)) return;
			if (message.action.length > 64) return;
			if (message.args.length > 16) return;
			onAction(message.action, message.args);
		} else if (message.type === 'sync') {
			// State handoff: the previous holder pushed us its final state. Apply it
			// before asserting our own, then end the handoff window and broadcast.
			if (!authenticatedConns.has(conn)) return;
			if (!awaitingHandoff || !onStateSync) return;
			if (!message.payload || typeof message.payload !== 'object') return;
			onStateSync(message.payload);
			endHandoffWindow();
		} else if (message.type === 'reclaim' || message.type === 'takeover') {
			// A peer is claiming R (returning original, or manual takeover). Hand off.
			if (!authenticatedConns.has(conn)) return;
			yieldRoomTo(conn);
		}
	});

	conn.on('close', () => {
		authenticatedConns.delete(conn);
		connections = connections.filter((c) => c !== conn);
		broadcastPeerCount();
		broadcastRoster();
		if (connections.length === 0 && !isActingHost && !isProvisionalHost && !isHost) {
			isConnected = false;
		}
	});
}

async function verifyGuest(conn: DataConnection, message: AuthResponseMessage): Promise<void> {
	if (typeof message.proof !== 'string' || typeof message.nonce !== 'string') return;
	const hostNonce = connNonces.get(conn) || '';

	if (hostPasscode) {
		const expected = await hmac(hostPasscode, hostNonce);
		if (message.proof !== expected) {
			conn.send({ type: 'authResult', success: false, error: 'Incorrect passcode' } as AuthResultMessage);
			conn.close();
			return;
		}
	}

	// Prove OUR knowledge of the passcode back to the guest over its nonce.
	const proof = hostPasscode ? await hmac(hostPasscode, message.nonce) : '';

	authenticatedConns.add(conn);
	connections = [...connections, conn];
	conn.send({ type: 'authResult', success: true, proof } as AuthResultMessage);

	if (getState) {
		const raw = getState();
		const state = stateFilter ? stateFilter(raw) : raw;
		conn.send({ type: 'sync', payload: state } as SyncMessage);
	}
	conn.send({ type: 'peerCount', count: connections.length + 1 } as PeerCountMessage);
	broadcastPeerCount();
	broadcastRoster();
	isConnected = true;
}

// Original host: create the room and bind R.
async function startHost(passcode: string = '', existingId?: string): Promise<string> {
	if (peer) peer.destroy();

	const id = existingId || generateRoomId();
	isHost = true;
	isActingHost = false;
	isProvisionalHost = false;
	hostPasscode = passcode;
	lastPasscode = passcode;
	error = null;
	canReconnect = false;
	isReconnecting = false;

	const newPeer = await createPeer(id);
	roomId = peerId;
	if (!wasOriginalHost) wasOriginalHost = true;

	attachPeerLifecycle(newPeer);
	attachHostHandlers(newPeer);
	startRosterHeartbeat();

	return peerId!;
}

// Peer-server-level lifecycle: losing the broker connection (distinct from a data
// connection dropping). For a host, attempt to re-bind; for a guest the data-channel
// watchdog/close drives failover instead.
function attachPeerLifecycle(p: Peer): void {
	p.on('disconnected', () => {
		if (tearingDown) return;
		if (!canReconnect && (isHost || isActingHost || isProvisionalHost)) {
			canReconnect = true;
			isConnected = false;
			error = 'Disconnected from server';
			startReconnectLoop();
		}
	});
	p.on('close', () => {
		if (tearingDown) return;
		if (!canReconnect && (isHost || isActingHost || isProvisionalHost)) {
			canReconnect = true;
			isConnected = false;
			startReconnectLoop();
		}
	});
}

// ===========================================================================
// Guest side: connect to R and authenticate (mutual challenge-response).
// ===========================================================================
async function joinHost(targetRoomId: string, passcode: string = '', isReconnect: boolean = false): Promise<void> {
	if (peer) peer.destroy();

	isHost = false;
	error = null;
	awaitingPasscode = false;
	if (!isReconnect) {
		canReconnect = false;
		isReconnecting = false;
		isJoining = true;
		inFailover = false;
	}

	roomId = targetRoomId;
	lastPasscode = passcode;
	wasOriginalHost = false;

	const newPeer = await createPeer();
	attachPeerLifecycle(newPeer);
	// If WE later get elected to hold R it will be a fresh peer bound to R, so this
	// peer only ever accepts connections after a role change — guard inside the handler.
	newPeer.on('connection', (conn) => handleIncomingConnection(conn));

	return establishHostConnection(newPeer, targetRoomId, passcode);
}

// Open + mutually authenticate a data connection to R on `targetPeer`. Factored so
// failover re-joins can run on the EXISTING guest peer (identity preserved).
function establishHostConnection(
	targetPeer: Peer,
	targetRoomId: string,
	passcode: string,
	timeoutMs: number = 30000
): Promise<void> {
	let providedPasscode = passcode;
	let hostNonce = '';
	let guestNonce = '';
	let requiresPass = false;

	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout>;
		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			error = err.message;
			isJoining = false;
			reject(err);
		};
		const succeed = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			resolve();
		};

		const conn = targetPeer.connect(targetRoomId, { reliable: true });

		targetPeer.on('error', (err) => {
			if (isConnected || awaitingPasscode) return;
			fail(err instanceof Error ? err : new Error(String(err)));
		});

		const sendAuthResponse = async () => {
			guestNonce = genNonce();
			const proof = requiresPass ? await hmac(providedPasscode, hostNonce) : '';
			conn.send({ type: 'authResponse', proof, nonce: guestNonce } as AuthResponseMessage);
		};

		conn.on('open', () => {
			pendingConnection = conn;
		});

		conn.on('data', (data) => {
			lastHostActivity = Date.now();
			const message = data as PeerMessage;

			if (message.type === 'ping') {
				// liveness only
			} else if (message.type === 'authRequest') {
				hostNonce = message.nonce || '';
				requiresPass = !!message.requiresPasscode;
				if (requiresPass && !providedPasscode) {
					// Need a passcode from the user before we can answer the challenge.
					awaitingPasscode = true;
					pendingConnection = conn;
					resumeAuth = (pc: string) => {
						providedPasscode = pc;
						lastPasscode = pc;
						awaitingPasscode = false;
						void sendAuthResponse();
					};
				} else {
					void sendAuthResponse();
				}
			} else if (message.type === 'authResult') {
				void (async () => {
					if (!message.success) {
						awaitingPasscode = false;
						pendingConnection = null;
						fail(new Error(message.error || 'Authentication failed'));
						return;
					}
					// Verify the host proved IT knows the passcode (rogue-squatter defense).
					if (requiresPass) {
						const expected = await hmac(providedPasscode, guestNonce);
						if (message.proof !== expected) {
							pendingConnection = null;
							fail(new Error('Host failed passcode verification'));
							conn.close();
							return;
						}
					}
					hostConnection = conn;
					pendingConnection = null;
					awaitingPasscode = false;
					resumeAuth = null;
					isConnected = true;
					isJoining = false;
					canReconnect = false;
					error = null;
					// inFailover is managed by the election/reclaim paths, not here.
					watchConnectionState(conn); // fast, traffic-free death detection
					startHostWatchdog(); // backstop
					clearIceConfirm();
					// If we returned here to reclaim R, signal the current holder.
					if (pendingClaim) conn.send({ type: pendingClaim } as ClaimMessage);
					succeed();
				})();
			} else if (message.type === 'sync' && onStateSync) {
				onStateSync(message.payload);
			} else if (message.type === 'peerCount') {
				totalUsers = message.count;
			} else if (message.type === 'roster') {
				if (Array.isArray(message.peerIds)) cacheRoster(message.peerIds);
			} else if (message.type === 'handoff') {
				// Planned release of R by the current holder — reconnect, don't elect.
				expectingHandoff = true;
			}
		});

		conn.on('close', () => {
			const wasConnected = isConnected && hostConnection === conn;
			if (hostConnection === conn) hostConnection = null;
			pendingConnection = null;
			isJoining = false;
			if (!settled) fail(new Error('Connection closed'));
			if (tearingDown) return;
			if (wasConnected) {
				isConnected = false;
				onHostConnectionLost(false);
			}
		});

		conn.on('error', (err) => {
			fail(err instanceof Error ? err : new Error(String(err)));
		});

		timeoutId = setTimeout(() => {
			if (!isConnected && !awaitingPasscode) fail(new Error('Connection timeout'));
		}, timeoutMs);
	});
}

// Reconnect to R on the EXISTING guest peer (no destroy → our id/rank survives).
async function connectOnExistingPeer(
	targetRoomId: string,
	passcode: string,
	timeoutMs: number = 30000
): Promise<void> {
	if (!peer) return joinHost(targetRoomId, passcode, true);
	return establishHostConnection(peer, targetRoomId, passcode, timeoutMs);
}

// --- Initial join with capped backoff --------------------------------------
async function joinWithRetry(targetRoomId: string, passcode: string = ''): Promise<void> {
	joinAborted = false;
	joinFailed = false;
	joinAttempts = 0;
	if (joinRetryTimer) {
		clearTimeout(joinRetryTimer);
		joinRetryTimer = null;
	}

	while (!joinAborted) {
		joinAttempts++;
		try {
			await joinHost(targetRoomId, passcode);
			return;
		} catch {
			if (joinAborted) return;
			if (joinAttempts >= MAX_JOIN_ATTEMPTS) {
				joinFailed = true;
				isJoining = false;
				return;
			}
			isJoining = true;
			const delay = Math.min(1000 * 2 ** (joinAttempts - 1), 30000);
			await new Promise<void>((resolve) => {
				joinRetryResolve = resolve;
				joinRetryTimer = setTimeout(() => {
					joinRetryTimer = null;
					joinRetryResolve = null;
					resolve();
				}, delay);
			});
		}
	}
}

async function retryJoin(): Promise<void> {
	if (!roomId) return;
	await joinWithRetry(roomId, lastPasscode);
}

function cancelJoinRetryWait(): void {
	if (joinRetryTimer) {
		clearTimeout(joinRetryTimer);
		joinRetryTimer = null;
	}
	if (joinRetryResolve) {
		const resolve = joinRetryResolve;
		joinRetryResolve = null;
		resolve();
	}
}

function exitRoom(): void {
	joinAborted = true;
	cancelJoinRetryWait();
	disconnect();
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('room');
		url.searchParams.delete('p');
		window.history.replaceState({}, '', url.toString());
	}
}

// Guest supplies a passcode mid-auth → resume the challenge-response.
function submitPasscode(passcode: string): void {
	if (resumeAuth && awaitingPasscode) {
		resumeAuth(passcode);
	}
}

// ===========================================================================
// Roster + liveness
// ===========================================================================
function cacheRoster(peerIds: string[]): void {
	successionRoster = peerIds.slice();
	for (const id of [...knownDeadPeers]) {
		if (!peerIds.includes(id)) knownDeadPeers.delete(id);
	}
}

// The holder broadcasts the ordered guest ids (join order) so survivors can elect.
function broadcastRoster(): void {
	if (!(isHost || isActingHost || isProvisionalHost)) return;
	successionRoster = connections.map((c) => c.peer);
	const message: RosterMessage = { type: 'roster', peerIds: successionRoster };
	for (const conn of connections) if (conn.open) conn.send(message);
}

function broadcastPing(): void {
	if (!(isHost || isActingHost || isProvisionalHost)) return;
	const message: PingMessage = { type: 'ping' };
	for (const conn of connections) if (conn.open) conn.send(message);
}

function startRosterHeartbeat(): void {
	if (!rosterHeartbeatTimer) rosterHeartbeatTimer = setInterval(() => broadcastRoster(), ROSTER_HEARTBEAT_MS);
	if (!pingTimer) pingTimer = setInterval(() => broadcastPing(), HOST_PING_MS);
}

function stopRosterHeartbeat(): void {
	if (rosterHeartbeatTimer) {
		clearInterval(rosterHeartbeatTimer);
		rosterHeartbeatTimer = null;
	}
	if (pingTimer) {
		clearInterval(pingTimer);
		pingTimer = null;
	}
}

function startHostWatchdog(): void {
	lastHostActivity = Date.now();
	if (hostWatchdogTimer) return;
	hostWatchdogTimer = setInterval(() => {
		if (isHost || isActingHost || isProvisionalHost || !hostConnection) {
			stopHostWatchdog();
			return;
		}
		if (Date.now() - lastHostActivity > HOST_SILENCE_MS) {
			stopHostWatchdog();
			isConnected = false;
			onHostConnectionLost(true);
		}
	}, 1000);
}

function stopHostWatchdog(): void {
	if (hostWatchdogTimer) {
		clearInterval(hostWatchdogTimer);
		hostWatchdogTimer = null;
	}
}

// ===========================================================================
// Failover: detect host loss → reconnect-or-elect → bind R
// ===========================================================================
// Watch the underlying RTCPeerConnection for the FAST, traffic-free death signal.
// 'failed' = definitively gone → react now. 'disconnected' may be transient → only
// react if it's still bad after a short confirmation window.
function watchConnectionState(conn: DataConnection): void {
	const pc = (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
	if (!pc) return;
	const onChange = () => {
		if (hostConnection !== conn) return; // stale listener
		const s = pc.connectionState;
		if (s === 'failed') {
			clearIceConfirm();
			onHostConnectionLost(true);
		} else if (s === 'disconnected') {
			if (iceConfirmTimer) return;
			iceConfirmTimer = setTimeout(() => {
				iceConfirmTimer = null;
				if (
					hostConnection === conn &&
					(pc.connectionState === 'disconnected' || pc.connectionState === 'failed')
				) {
					onHostConnectionLost(true);
				}
			}, ICE_CONFIRM_MS);
		} else if (s === 'connected') {
			clearIceConfirm();
		}
	};
	pc.addEventListener('connectionstatechange', onChange);
	pc.addEventListener('iceconnectionstatechange', onChange);
}

function clearIceConfirm(): void {
	if (iceConfirmTimer) {
		clearTimeout(iceConfirmTimer);
		iceConfirmTimer = null;
	}
}

function onHostConnectionLost(immediate: boolean): void {
	if (isHost || isActingHost || isProvisionalHost) return;
	stopHostWatchdog();
	clearIceConfirm();
	if (!isConnected && (electionRunning())) return; // already failing over
	isConnected = false;
	canReconnect = true;
	if (!error) error = 'Disconnected from host';

	// A claim in flight: the holder closed because it's yielding R to us → grab it.
	if (pendingClaim) {
		const role = pendingClaim === 'reclaim' ? 'host' : 'provisional';
		pendingClaim = null;
		void claimRoom(role);
		return;
	}

	// Planned handoff: reconnect to R (the new holder is binding it) — don't elect.
	if (expectingHandoff) {
		expectingHandoff = false;
		startFailover(immediate, true);
		return;
	}

	startFailover(immediate, false);
}

let failoverActive = false;
function electionRunning(): boolean {
	return failoverActive;
}

// Failover runs two things in parallel:
//   (a) a rank-staggered CLAIM timer — at base + rank*STAGGER, if R still isn't up,
//       bind R ourselves. This is independent of any connect attempt, so a hung
//       probe can never delay it (that was the >10s regression).
//   (b) bounded, SHORT-timeout reconnect probes to R — if someone ahead of us binds
//       R first we just reconnect as a guest and cancel our claim.
// Lower ranks prefer (b); whoever's claim deadline arrives with R still down does (a).
function startFailover(immediate: boolean, planned: boolean): void {
	if (!planned) inFailover = true;
	stopReconnectLoop();
	const gen = ++failoverGen;
	failoverActive = true;

	const deadline = myClaimDeadlineMs(immediate);
	if (claimTimer) clearTimeout(claimTimer);
	claimTimer = setTimeout(() => {
		claimTimer = null;
		if (gen !== failoverGen || isStateAuthorityNow() || isConnected) {
			failoverActive = false;
			return;
		}
		failoverGen++; // stop the concurrent probe loop before we tear down the peer
		void claimRoom('acting');
	}, deadline);

	void failoverProbe(gen);
}

function myClaimDeadlineMs(immediate: boolean): number {
	const survivors = successionRoster.filter((id) => !knownDeadPeers.has(id));
	let rank = peerId ? survivors.indexOf(peerId) : -1;
	if (rank < 0) rank = survivors.length; // not (yet) in the roster → lowest priority
	const base = immediate ? 0 : CLAIM_BASE_MS;
	return base + rank * STAGGER_MS;
}

// Bounded short-timeout probes to R; on success, cancel the claim and become a guest.
async function failoverProbe(gen: number): Promise<void> {
	if (!roomId) return;
	let attempt = 0;
	while (gen === failoverGen && !isStateAuthorityNow() && !isConnected) {
		try {
			await connectOnExistingPeer(roomId, lastPasscode, FAILOVER_CONNECT_MS);
			if (gen === failoverGen && isConnected) {
				if (claimTimer) {
					clearTimeout(claimTimer);
					claimTimer = null;
				}
				canReconnect = false;
				error = null;
				failoverActive = false;
			}
			return;
		} catch {
			/* R not reachable yet — keep probing until the claim timer escalates */
		}
		if (gen !== failoverGen || isStateAuthorityNow() || isConnected) break;
		await new Promise<void>((r) => setTimeout(r, 500));
		attempt++;
	}
}

function isStateAuthorityNow(): boolean {
	return isHost || isActingHost || isProvisionalHost;
}

// Bind R and become the host. The PeerJS broker arbitrates races: if R is already
// taken (another peer won the claim race), fall back to joining as a guest.
async function claimRoom(role: 'acting' | 'host' | 'provisional'): Promise<void> {
	if (!roomId) return;
	const claimingState = getState ? getState() : null; // our view to re-assert after binding
	if (peer) peer.destroy();
	try {
		const newPeer = await createPeer(roomId);
		// Won R.
		isHost = role !== 'acting';
		isActingHost = role === 'acting';
		isProvisionalHost = role === 'provisional';
		inFailover = !wasOriginalHost && role === 'acting';
		isConnected = true;
		canReconnect = false;
		error = null;
		hostPasscode = lastPasscode;
		hostConnection = null;
		attachPeerLifecycle(newPeer);
		attachHostHandlers(newPeer);
		if (claimingState && onStateSync) onStateSync(claimingState);
		startRosterHeartbeat();
	} catch {
		// Lost the race for R → someone else holds it. Join as a guest.
		isHost = false;
		isActingHost = false;
		isProvisionalHost = false;
		await joinHost(roomId, lastPasscode, true).catch(() => {
			startFailover(false, false);
		});
	}
}

// ===========================================================================
// Original reclaim / manual takeover / handoff
// ===========================================================================

// The current holder yields R to a claiming peer: push final state, tell the rest
// it's a planned handoff, then release R. The claimant grabs R on the close.
function yieldRoomTo(conn: DataConnection): void {
	if (getState) {
		const raw = getState();
		const state = stateFilter ? stateFilter(raw) : raw;
		conn.send({ type: 'sync', payload: state } as SyncMessage);
	}
	const msg: HandoffMessage = { type: 'handoff' };
	for (const c of connections) if (c !== conn && c.open) c.send(msg);
	// Let the pushed state flush, then release R and rejoin as a plain guest.
	setTimeout(() => releaseRoom(), 400);
}

function releaseRoom(): void {
	stopRosterHeartbeat();
	isHost = false;
	isActingHost = false;
	isProvisionalHost = false;
	connections = [];
	// Recreate a guest peer and reconnect to R (now held by the claimant).
	void reconnectToRoomFresh();
}

async function reconnectToRoomFresh(): Promise<void> {
	if (!roomId) return;
	await joinWithRetry(roomId, lastPasscode);
}

function startHandoffWindow(): void {
	awaitingHandoff = true;
	if (handoffTimer) clearTimeout(handoffTimer);
	handoffTimer = setTimeout(() => endHandoffWindow(), HANDOFF_WINDOW_MS);
}

function endHandoffWindow(): void {
	if (handoffTimer) {
		clearTimeout(handoffTimer);
		handoffTimer = null;
	}
	if (!awaitingHandoff) return;
	awaitingHandoff = false;
	broadcastState();
}

// Manual "Take control": become a provisional host. If a holder is serving, ask it
// to hand off; otherwise (mid-outage) bind R directly.
function takeControl(): void {
	if (isHost) return;
	if (isConnected && hostConnection) {
		pendingClaim = 'takeover';
		hostConnection.send({ type: 'takeover' } as ClaimMessage);
	} else {
		void claimRoom('provisional');
	}
}

// ===========================================================================
// Reconnect loop (peer-server-level loss + manual "Retry now")
// ===========================================================================
let reconnectLoopActive = false;
let reconnectAborted = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function reconnect(): Promise<void> {
	if (!canReconnect || isReconnecting) return;
	isReconnecting = true;
	error = null;
	try {
		if ((isHost || isActingHost || isProvisionalHost || wasOriginalHost) && roomId) {
			// We hold (or held) R: try to re-bind it.
			try {
				await startHost(lastPasscode, roomId);
				if (wasOriginalHost) {
					isProvisionalHost = false;
					startHandoffWindow();
				}
			} catch {
				// Someone else holds R now → rejoin and (if we're the original) reclaim it.
				pendingClaim = wasOriginalHost ? 'reclaim' : null;
				await joinHost(roomId, lastPasscode, true);
			}
		} else if (roomId) {
			await joinHost(roomId, lastPasscode, true);
			inFailover = false;
		}
		canReconnect = false;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Reconnection failed';
		canReconnect = true;
	} finally {
		isReconnecting = false;
	}
}

async function startReconnectLoop(): Promise<void> {
	if (reconnectLoopActive) return;
	reconnectLoopActive = true;
	reconnectAborted = false;
	reconnectAttempts = 0;

	while (canReconnect && !reconnectAborted) {
		reconnectAttempts++;
		await reconnect();
		if (!canReconnect) break;
		if (reconnectAborted) break;
		const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 30000);
		await new Promise<void>((resolve) => {
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				resolve();
			}, delay);
		});
	}
	reconnectLoopActive = false;
}

function stopReconnectLoop(): void {
	reconnectAborted = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	reconnectAttempts = 0;
}

function clearReconnect(): void {
	stopReconnectLoop();
	failoverGen++; // abort any in-flight failover loop
	failoverActive = false;
	if (claimTimer) {
		clearTimeout(claimTimer);
		claimTimer = null;
	}
	clearIceConfirm();
	canReconnect = false;
	wasOriginalHost = false;
}

// ===========================================================================
// Broadcast / actions
// ===========================================================================
function broadcastState(): void {
	if (!(isHost || isActingHost || isProvisionalHost) || !getState) return;
	if (awaitingHandoff) return;
	const raw = getState();
	const state = stateFilter ? stateFilter(raw) : raw;
	const message: SyncMessage = { type: 'sync', payload: state };
	for (const conn of connections) if (conn.open) conn.send(message);
}

function setStateFilter(fn: ((s: SyncMessage['payload']) => SyncMessage['payload']) | null): void {
	stateFilter = fn;
}

function broadcastPeerCount(): void {
	if (!(isHost || isActingHost || isProvisionalHost)) return;
	const count = connections.length + 1;
	const message: PeerCountMessage = { type: 'peerCount', count };
	for (const conn of connections) if (conn.open) conn.send(message);
}

function sendAction(action: string, args: unknown[]): void {
	if (isHost || isActingHost || isProvisionalHost) return;
	if (!hostConnection || !hostConnection.open) return;
	const message: ActionMessage = { type: 'action', action, args };
	hostConnection.send(message);
}

// Can we actually deliver a guest action to a live host right now? If not, callers
// apply locally so the UI never freezes during an outage / half-dead connection.
function canSendToHost(): boolean {
	return !!hostConnection && hostConnection.open && isConnected;
}

// ===========================================================================
// Teardown / URL helpers / wiring
// ===========================================================================
function disconnect(): void {
	joinAborted = true;
	cancelJoinRetryWait();
	failoverGen++; // abort any in-flight failover loop
	failoverActive = false;
	if (claimTimer) {
		clearTimeout(claimTimer);
		claimTimer = null;
	}
	clearIceConfirm();
	stopHostWatchdog();
	stopRosterHeartbeat();
	if (handoffTimer) {
		clearTimeout(handoffTimer);
		handoffTimer = null;
	}
	tearingDown = true;
	if (peer) {
		peer.destroy();
		peer = null;
	}
	tearingDown = false;
	peerId = null;
	isHost = false;
	isActingHost = false;
	isProvisionalHost = false;
	awaitingHandoff = false;
	inFailover = false;
	isConnected = false;
	connections = [];
	hostConnection = null;
	pendingConnection = null;
	resumeAuth = null;
	error = null;
	totalUsers = 1;
	hostPasscode = '';
	awaitingPasscode = false;
	isJoining = false;
	joinFailed = false;
	joinAttempts = 0;
	roomId = null;
	wasOriginalHost = false;
	pendingClaim = null;
	expectingHandoff = false;
	successionRoster = [];
	knownDeadPeers.clear();
	clearReconnect();
}

function getShareUrl(): string {
	if (!roomId) return '';
	const url = new URL(window.location.href);
	url.searchParams.set('room', roomId);
	if (hostPasscode) url.searchParams.set('p', hostPasscode);
	return url.toString();
}

function getRoomFromUrl(): { roomId: string; passcode: string } | null {
	if (typeof window === 'undefined') return null;
	const url = new URL(window.location.href);
	const room = url.searchParams.get('room');
	if (!room) return null;
	const passcode = url.searchParams.get('p') || '';
	return { roomId: room, passcode };
}

function registerCallbacks(
	stateSyncCallback: (state: SyncMessage['payload']) => void,
	actionCallback: (action: string, args: unknown[]) => void,
	getStateCallback: () => SyncMessage['payload']
): void {
	onStateSync = stateSyncCallback;
	onAction = actionCallback;
	getState = getStateCallback;
}

// A guest is anyone who joined a room and is not holding R with the host UI. An
// acting host keeps the guest UI (isHost false); a provisional/real host does not.
function isGuest(): boolean {
	return !isHost && roomId !== null;
}

export const peerStore = {
	get peer() { return peer; },
	get peerId() { return peerId; },
	get isHost() { return isHost; },
	get isActingHost() { return isActingHost; },
	get isProvisionalHost() { return isProvisionalHost; },
	get isConnected() { return isConnected; },
	get isGuest() { return isGuest(); },
	get isStateAuthority() { return isHost || isActingHost || isProvisionalHost; },
	get canSendToHost() { return canSendToHost(); },
	get guestCount() { return connections.length; },
	get totalUsers() { return (isHost || isActingHost || isProvisionalHost) ? connections.length + 1 : totalUsers; },
	get error() { return error; },
	get awaitingPasscode() { return awaitingPasscode; },
	get hasPasscode() { return !!hostPasscode; },
	get canReconnect() { return canReconnect; },
	get isReconnecting() { return isReconnecting; },
	get reconnectAttempts() { return reconnectAttempts; },
	get isJoining() { return isJoining; },
	get wasHost() { return wasOriginalHost; },
	get joinFailed() { return joinFailed; },
	get joinAttempts() { return joinAttempts; },
	get maxJoinAttempts() { return MAX_JOIN_ATTEMPTS; },
	get canTakeControl() { return !isHost && roomId !== null && (isActingHost || inFailover || !isConnected); },

	startHost,
	joinHost,
	joinWithRetry,
	retryJoin,
	exitRoom,
	submitPasscode,
	reconnect,
	clearReconnect,
	broadcastState,
	sendAction,
	takeControl,
	disconnect,
	getShareUrl,
	getRoomFromUrl,
	registerCallbacks,
	setStateFilter
};
