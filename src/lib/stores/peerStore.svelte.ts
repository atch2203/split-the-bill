import Peer, { type DataConnection } from 'peerjs';
import type { ReceiptItem, Person, BillSettings, PaymentMethod } from '$lib/types';

// Message types for peer communication
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

type AuthRequestMessage = {
	type: 'authRequest';
	requiresPasscode: boolean;
};

type AuthResponseMessage = {
	type: 'authResponse';
	passcode: string;
};

type AuthResultMessage = {
	type: 'authResult';
	success: boolean;
	error?: string;
};

type PeerMessage = SyncMessage | ActionMessage | PeerCountMessage | AuthRequestMessage | AuthResponseMessage | AuthResultMessage;

// Connection state
let peer = $state<Peer | null>(null);
let peerId = $state<string | null>(null);
let isHost = $state<boolean>(false);
let isConnected = $state<boolean>(false);
let connections = $state<DataConnection[]>([]);
// True while a guest join is in flight (between joinHost call and success/error).
// Used by UI to show a loading screen instead of the standalone/host main UI.
let isJoining = $state<boolean>(false);
// Authenticated connections — explicit per-conn flag rather than array search.
// Adds robustness if `connections` reactive state ever lags an action message.
const authenticatedConns = new WeakSet<DataConnection>();
let hostConnection = $state<DataConnection | null>(null);
let error = $state<string | null>(null);
let totalUsers = $state<number>(1); // Total users in session (for guests to display)

// Passcode state
let hostPasscode = $state<string>(''); // Passcode set by host
let awaitingPasscode = $state<boolean>(false); // Guest waiting to enter passcode
let pendingConnection = $state<DataConnection | null>(null); // Connection waiting for auth

// Initial-join retry state (guest): cap attempts with exponential backoff, then stop.
const MAX_JOIN_ATTEMPTS = 5;
let joinAttempts = $state<number>(0); // 1-based count of attempts made
let joinFailed = $state<boolean>(false); // True once all attempts exhausted
let joinRetryTimer: ReturnType<typeof setTimeout> | null = null;
let joinRetryResolve: (() => void) | null = null; // Resolver for the in-progress backoff sleep
let joinAborted = false; // Set when the user exits; stops the retry loop
// Set during disconnect() so the peer/conn teardown events don't re-arm reconnection.
let tearingDown = false;

// Reconnection state
let lastHostId = $state<string | null>(null); // For guests: the host they were connected to
let lastPasscode = $state<string>(''); // Passcode used in last connection
let wasHost = $state<boolean>(false); // Were we hosting before disconnect?
let canReconnect = $state<boolean>(false); // Can we attempt to reconnect?
let isReconnecting = $state<boolean>(false); // Currently attempting to reconnect
// Auto-reconnect loop (both host and guest): keep retrying with capped backoff
// until reconnected or the user dismisses/leaves.
let reconnectLoopActive = false;
let reconnectAborted = false;
let reconnectAttempts = $state<number>(0);
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Callbacks for store integration
let onStateSync: ((state: SyncMessage['payload']) => void) | null = null;
let onAction: ((action: string, args: unknown[]) => void) | null = null;
let getState: (() => SyncMessage['payload']) | null = null;
// Optional filter applied to outgoing broadcast state. Used by the tour to strip
// host-local sample data from anything sent to guests.
let stateFilter: ((s: SyncMessage['payload']) => SyncMessage['payload']) | null = null;

function generateRoomId(): string {
	return Math.random().toString(36).substring(2, 8);
}

// Fetch TURN server credentials
async function getIceServers(): Promise<RTCIceServer[]> {
	try {
		const response = await fetch('https://lucky-poetry-9bdc.atch22037433.workers.dev/');
		if (!response.ok) {
			throw new Error('Failed to fetch ICE servers');
		}
		const data = await response.json();
		return data.iceServers || [];
	} catch (err) {
		console.warn('Failed to fetch TURN credentials, using default STUN:', err);
		// Fallback to public STUN server
		return [{ urls: 'stun:stun.l.google.com:19302' }];
	}
}

async function createPeer(id?: string): Promise<Peer> {
	const iceServers = await getIceServers();

	return new Promise((resolve, reject) => {
		const newPeer = new Peer(id || generateRoomId(), {
			config: {
				iceServers
			}
		});

		newPeer.on('open', (id) => {
			peer = newPeer;
			peerId = id;
			resolve(newPeer);
		});

		newPeer.on('error', (err) => {
			error = err.message;
			reject(err);
		});
	});
}

// Host: start sharing and wait for connections
async function startHost(passcode: string = '', existingId?: string): Promise<string> {
	if (peer) {
		peer.destroy();
	}

	isHost = true;
	hostPasscode = passcode;
	error = null;
	canReconnect = false;
	isReconnecting = false;

	const newPeer = await createPeer(existingId);

	// Save for reconnection
	wasHost = true;
	lastPasscode = passcode;

	// Handle peer disconnection/error for reconnection
	newPeer.on('disconnected', () => {
		if (tearingDown) return;
		console.log('Host peer disconnected from server');
		if (!canReconnect && isHost) {
			canReconnect = true;
			isConnected = false;
			error = 'Disconnected from server';
			startReconnectLoop();
		}
	});

	newPeer.on('close', () => {
		if (tearingDown) return;
		console.log('Host peer closed');
		if (!canReconnect && isHost) {
			canReconnect = true;
			isConnected = false;
			startReconnectLoop();
		}
	});

	newPeer.on('connection', (conn) => {
		console.log('Guest attempting to connect:', conn.peer);

		conn.on('open', () => {
			// Send auth request to guest
			conn.send({ type: 'authRequest', requiresPasscode: !!hostPasscode } as AuthRequestMessage);
		});

		conn.on('data', (data) => {
			// Defensive: validate message shape before trusting any field.
			if (!data || typeof data !== 'object') return;
			const message = data as PeerMessage;
			if (typeof (message as { type?: unknown }).type !== 'string') return;

			if (message.type === 'authResponse') {
				if (typeof message.passcode !== 'string') return;
				// Validate passcode
				if (!hostPasscode || message.passcode === hostPasscode) {
					// Auth successful - record per-conn auth + add to connections + send state
					authenticatedConns.add(conn);
					connections = [...connections, conn];
					conn.send({ type: 'authResult', success: true } as AuthResultMessage);

					if (getState) {
						const raw = getState();
						const state = stateFilter ? stateFilter(raw) : raw;
						conn.send({ type: 'sync', payload: state } as SyncMessage);
					}
					conn.send({ type: 'peerCount', count: connections.length + 1 } as PeerCountMessage);
					broadcastPeerCount();
					isConnected = true;
				} else {
					// Auth failed
					conn.send({ type: 'authResult', success: false, error: 'Incorrect passcode' } as AuthResultMessage);
					conn.close();
				}
			} else if (message.type === 'action' && onAction) {
				// Reject any action from an unauthenticated peer.
				if (!authenticatedConns.has(conn)) return;
				if (typeof message.action !== 'string') return;
				if (!Array.isArray(message.args)) return;
				if (message.action.length > 64) return;
				// Cap payload size to avoid OOM / DoS via giant arg arrays.
				if (message.args.length > 16) return;
				onAction(message.action, message.args);
			}
		});

		conn.on('close', () => {
			authenticatedConns.delete(conn);
			connections = connections.filter(c => c !== conn);
			broadcastPeerCount();
			if (connections.length === 0) {
				isConnected = false;
			}
		});
	});

	return peerId!;
}

// Guest: connect to host. `isReconnect` keeps the full-screen connecting takeover
// off during auto-reconnect — the header "Reconnecting…" banner covers that case,
// matching host behavior (host restarts don't blank the app either).
async function joinHost(hostId: string, passcode: string = '', isReconnect: boolean = false): Promise<void> {
	if (peer) {
		peer.destroy();
	}

	isHost = false;
	error = null;
	awaitingPasscode = false;
	if (!isReconnect) {
		canReconnect = false;
		isReconnecting = false;
		isJoining = true;
	}

	// Save for reconnection
	lastHostId = hostId;
	lastPasscode = passcode;
	wasHost = false;

	const providedPasscode = passcode;
	const newPeer = await createPeer();

	// Handle peer disconnection for reconnection
	newPeer.on('disconnected', () => {
		if (tearingDown) return;
		console.log('Guest peer disconnected from server');
		if (!canReconnect && !isHost && lastHostId) {
			canReconnect = true;
			isConnected = false;
			error = 'Disconnected from server';
			startReconnectLoop();
		}
	});

	newPeer.on('close', () => {
		if (tearingDown) return;
		console.log('Guest peer closed');
		if (!canReconnect && !isHost && lastHostId) {
			canReconnect = true;
			isConnected = false;
			startReconnectLoop();
		}
	});

	return new Promise((resolve, reject) => {
		// Settle exactly once and tear down this attempt's timeout. Without this,
		// a failed attempt's 30s timeout fires later and flips isJoining off mid-retry,
		// and a fast peer error followed by the timeout would double-settle.
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

		const conn = newPeer.connect(hostId, { reliable: true });

		// Peer-level errors (host offline / bad room id → 'peer-unavailable', network
		// failures, etc.) fire on the Peer, not the connection. Without handling them
		// the attempt would hang until the 30s timeout. Fail fast so the retry loop can
		// back off. Ignore once connected or while waiting on a passcode prompt.
		newPeer.on('error', (err) => {
			if (isConnected || awaitingPasscode) return;
			fail(err instanceof Error ? err : new Error(String(err)));
		});

		conn.on('open', () => {
			pendingConnection = conn;
			// Wait for auth request from host
		});

		conn.on('data', (data) => {
			const message = data as PeerMessage;

			if (message.type === 'authRequest') {
				if (message.requiresPasscode && !providedPasscode) {
					// Need passcode and none provided - wait for user input
					awaitingPasscode = true;
				} else {
					// Send provided passcode (or empty if not required)
					conn.send({ type: 'authResponse', passcode: providedPasscode } as AuthResponseMessage);
				}
			} else if (message.type === 'authResult') {
				if (message.success) {
					hostConnection = conn;
					pendingConnection = null;
					awaitingPasscode = false;
					isConnected = true;
					isJoining = false;
					succeed();
				} else {
					awaitingPasscode = false;
					pendingConnection = null;
					fail(new Error(message.error || 'Authentication failed'));
				}
			} else if (message.type === 'sync' && onStateSync) {
				onStateSync(message.payload);
			} else if (message.type === 'peerCount') {
				totalUsers = message.count;
			}
		});

		conn.on('close', () => {
			const wasConnected = isConnected;
			hostConnection = null;
			pendingConnection = null;
			isConnected = false;
			isJoining = false;
			// Settle the join promise so an attempt closed by teardown/destroy doesn't
			// hang until the 30s timeout (which would keep the connect spinner up).
			if (!settled) fail(new Error('Connection closed'));
			if (tearingDown) return;
			// Only treat as a recoverable disconnect (show Reconnect banner) if we had
			// actually connected. A close on an attempt that never opened is a failed
			// join — the retry loop handles it, no spurious banner.
			if (wasConnected) {
				if (!error) error = 'Disconnected from host';
				if (lastHostId && !canReconnect) {
					canReconnect = true;
					startReconnectLoop();
				}
			}
		});

		conn.on('error', (err) => {
			fail(err instanceof Error ? err : new Error(String(err)));
		});

		// Timeout (longer to allow passcode entry). Cleared on settle.
		timeoutId = setTimeout(() => {
			if (!isConnected && !awaitingPasscode) {
				fail(new Error('Connection timeout'));
			}
		}, 30000);
	});
}

// Guest: connect with capped exponential-backoff retry.
// joinHost rejects on timeout/error but NOT while awaiting a passcode, so the
// passcode prompt never counts as a failed attempt. isJoining stays true through
// backoff waits so the UI keeps showing the connect screen.
async function joinWithRetry(hostId: string, passcode: string = ''): Promise<void> {
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
			await joinHost(hostId, passcode);
			return; // Connected.
		} catch {
			if (joinAborted) return;
			if (joinAttempts >= MAX_JOIN_ATTEMPTS) {
				joinFailed = true;
				isJoining = false;
				return;
			}
			// Keep the connect screen up while we wait out the backoff.
			isJoining = true;
			const delay = Math.min(1000 * 2 ** (joinAttempts - 1), 30000);
			// Cancelable sleep: exitRoom()/disconnect() resolve this immediately so the
			// loop can notice joinAborted instead of hanging on a cleared timer.
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

// Guest: manual retry after attempts were exhausted.
async function retryJoin(): Promise<void> {
	if (!lastHostId) return;
	await joinWithRetry(lastHostId, lastPasscode);
}

// Cancel an in-progress backoff sleep: clear the timer AND resolve the awaited
// promise, otherwise joinWithRetry would hang forever waiting on a dead timer.
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

// Guest: give up and leave the room (cancels any pending retry + clears the URL).
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

// Guest: submit passcode
function submitPasscode(passcode: string): void {
	if (pendingConnection && awaitingPasscode) {
		pendingConnection.send({ type: 'authResponse', passcode } as AuthResponseMessage);
	}
}

// Reconnect after disconnection
async function reconnect(): Promise<void> {
	if (!canReconnect || isReconnecting) return;

	isReconnecting = true;
	error = null;

	try {
		if (wasHost && peerId) {
			// Host: restart with same ID
			await startHost(lastPasscode, peerId);
		} else if (lastHostId) {
			// Guest: reconnect to host (keeps the header banner, no full-screen takeover)
			await joinHost(lastHostId, lastPasscode, true);
		}
		canReconnect = false;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Reconnection failed';
		canReconnect = true;
	} finally {
		isReconnecting = false;
	}
}

// Auto-reconnect loop: kicked off whenever an established session drops (host or
// guest). Keeps retrying reconnect() with capped exponential backoff until we're
// back online or the user dismisses/leaves. Only one loop runs at a time.
async function startReconnectLoop(): Promise<void> {
	if (reconnectLoopActive) return;
	reconnectLoopActive = true;
	reconnectAborted = false;
	reconnectAttempts = 0;

	while (canReconnect && !reconnectAborted) {
		reconnectAttempts++;
		// reconnect() clears canReconnect on success, re-sets it on failure. This is
		// the right signal for both roles — a host is "back" once its peer re-opens,
		// even with no guests yet (isConnected would still be false there).
		await reconnect();
		if (!canReconnect) break; // reconnected
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

// Stop the auto-reconnect loop and cancel any pending backoff timer.
function stopReconnectLoop(): void {
	reconnectAborted = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	reconnectAttempts = 0;
}

// Clear reconnection state
function clearReconnect(): void {
	stopReconnectLoop();
	canReconnect = false;
	lastHostId = null;
	lastPasscode = '';
	wasHost = false;
}

// Host: broadcast state to all guests
function broadcastState(): void {
	if (!isHost || !getState) return;

	const raw = getState();
	const state = stateFilter ? stateFilter(raw) : raw;
	const message: SyncMessage = { type: 'sync', payload: state };

	for (const conn of connections) {
		if (conn.open) {
			conn.send(message);
		}
	}
}

function setStateFilter(fn: ((s: SyncMessage['payload']) => SyncMessage['payload']) | null): void {
	stateFilter = fn;
}

// Host: broadcast peer count to all guests
function broadcastPeerCount(): void {
	if (!isHost) return;

	const count = connections.length + 1; // guests + host
	const message: PeerCountMessage = { type: 'peerCount', count };

	for (const conn of connections) {
		if (conn.open) {
			conn.send(message);
		}
	}
}

// Guest: send action to host
function sendAction(action: string, args: unknown[]): void {
	if (isHost || !hostConnection) return;

	const message: ActionMessage = { type: 'action', action, args };
	hostConnection.send(message);
}

// Disconnect and cleanup
function disconnect(): void {
	// Stop the join retry loop first so the peer.destroy() teardown events below
	// don't re-arm reconnection, and any pending backoff sleep unblocks.
	joinAborted = true;
	cancelJoinRetryWait();
	tearingDown = true;
	if (peer) {
		peer.destroy();
		peer = null;
	}
	tearingDown = false;
	peerId = null;
	isHost = false;
	isConnected = false;
	connections = [];
	hostConnection = null;
	pendingConnection = null;
	error = null;
	totalUsers = 1;
	hostPasscode = '';
	awaitingPasscode = false;
	isJoining = false;
	joinFailed = false;
	joinAttempts = 0;
	// Clear reconnection state on intentional disconnect
	clearReconnect();
}

// Get share URL
function getShareUrl(): string {
	if (!peerId) return '';
	const url = new URL(window.location.href);
	url.searchParams.set('room', peerId);
	if (hostPasscode) {
		url.searchParams.set('p', hostPasscode);
	}
	return url.toString();
}

// Check URL for room parameter
function getRoomFromUrl(): { roomId: string; passcode: string } | null {
	if (typeof window === 'undefined') return null;
	const url = new URL(window.location.href);
	const roomId = url.searchParams.get('room');
	if (!roomId) return null;
	const passcode = url.searchParams.get('p') || '';
	return { roomId, passcode };
}

// Register callbacks
function registerCallbacks(
	stateSyncCallback: (state: SyncMessage['payload']) => void,
	actionCallback: (action: string, args: unknown[]) => void,
	getStateCallback: () => SyncMessage['payload']
): void {
	onStateSync = stateSyncCallback;
	onAction = actionCallback;
	getState = getStateCallback;
}

// Check if currently connected as a guest
function isGuest(): boolean {
	return isConnected && !isHost;
}

export const peerStore = {
	get peer() { return peer; },
	get peerId() { return peerId; },
	get isHost() { return isHost; },
	get isConnected() { return isConnected; },
	get isGuest() { return isGuest(); },
	get guestCount() { return connections.length; },
	get totalUsers() { return isHost ? connections.length + 1 : totalUsers; },
	get error() { return error; },
	get awaitingPasscode() { return awaitingPasscode; },
	get hasPasscode() { return !!hostPasscode; },
	get canReconnect() { return canReconnect; },
	get isReconnecting() { return isReconnecting; },
	get reconnectAttempts() { return reconnectAttempts; },
	get isJoining() { return isJoining; },
	get wasHost() { return wasHost; },
	get joinFailed() { return joinFailed; },
	get joinAttempts() { return joinAttempts; },
	get maxJoinAttempts() { return MAX_JOIN_ATTEMPTS; },

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
	disconnect,
	getShareUrl,
	getRoomFromUrl,
	registerCallbacks,
	setStateFilter
};
