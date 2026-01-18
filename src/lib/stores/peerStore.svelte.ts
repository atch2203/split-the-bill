import Peer, { type DataConnection } from 'peerjs';
import type { ReceiptItem, Person, BillSettings } from '$lib/types';

// Message types for peer communication
type SyncMessage = {
	type: 'sync';
	payload: {
		items: ReceiptItem[];
		people: Person[];
		settings: BillSettings;
		colorIndex: number;
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
let hostConnection = $state<DataConnection | null>(null);
let error = $state<string | null>(null);
let totalUsers = $state<number>(1); // Total users in session (for guests to display)

// Passcode state
let hostPasscode = $state<string>(''); // Passcode set by host
let awaitingPasscode = $state<boolean>(false); // Guest waiting to enter passcode
let pendingConnection = $state<DataConnection | null>(null); // Connection waiting for auth

// Reconnection state
let lastHostId = $state<string | null>(null); // For guests: the host they were connected to
let lastPasscode = $state<string>(''); // Passcode used in last connection
let wasHost = $state<boolean>(false); // Were we hosting before disconnect?
let canReconnect = $state<boolean>(false); // Can we attempt to reconnect?
let isReconnecting = $state<boolean>(false); // Currently attempting to reconnect

// Callbacks for store integration
let onStateSync: ((state: SyncMessage['payload']) => void) | null = null;
let onAction: ((action: string, args: unknown[]) => void) | null = null;
let getState: (() => SyncMessage['payload']) | null = null;

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
		console.log('Host peer disconnected from server');
		if (!canReconnect && isHost) {
			canReconnect = true;
			isConnected = false;
			error = 'Disconnected from server';
		}
	});

	newPeer.on('close', () => {
		console.log('Host peer closed');
		if (!canReconnect && isHost) {
			canReconnect = true;
			isConnected = false;
		}
	});

	newPeer.on('connection', (conn) => {
		console.log('Guest attempting to connect:', conn.peer);

		conn.on('open', () => {
			// Send auth request to guest
			conn.send({ type: 'authRequest', requiresPasscode: !!hostPasscode } as AuthRequestMessage);
		});

		conn.on('data', (data) => {
			const message = data as PeerMessage;

			if (message.type === 'authResponse') {
				// Validate passcode
				if (!hostPasscode || message.passcode === hostPasscode) {
					// Auth successful - add to connections and send state
					connections = [...connections, conn];
					conn.send({ type: 'authResult', success: true } as AuthResultMessage);

					if (getState) {
						const state = getState();
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
				// Execute action from guest
				onAction(message.action, message.args);
			}
		});

		conn.on('close', () => {
			connections = connections.filter(c => c !== conn);
			broadcastPeerCount();
			if (connections.length === 0) {
				isConnected = false;
			}
		});
	});

	return peerId!;
}

// Guest: connect to host
async function joinHost(hostId: string, passcode: string = ''): Promise<void> {
	if (peer) {
		peer.destroy();
	}

	isHost = false;
	error = null;
	awaitingPasscode = false;
	canReconnect = false;
	isReconnecting = false;

	// Save for reconnection
	lastHostId = hostId;
	lastPasscode = passcode;
	wasHost = false;

	const providedPasscode = passcode;
	const newPeer = await createPeer();

	// Handle peer disconnection for reconnection
	newPeer.on('disconnected', () => {
		console.log('Guest peer disconnected from server');
		if (!canReconnect && !isHost && lastHostId) {
			canReconnect = true;
			isConnected = false;
			error = 'Disconnected from server';
		}
	});

	newPeer.on('close', () => {
		console.log('Guest peer closed');
		if (!canReconnect && !isHost && lastHostId) {
			canReconnect = true;
			isConnected = false;
		}
	});

	return new Promise((resolve, reject) => {
		const conn = newPeer.connect(hostId, { reliable: true });

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
					resolve();
				} else {
					error = message.error || 'Authentication failed';
					awaitingPasscode = false;
					pendingConnection = null;
					reject(new Error(message.error || 'Authentication failed'));
				}
			} else if (message.type === 'sync' && onStateSync) {
				onStateSync(message.payload);
			} else if (message.type === 'peerCount') {
				totalUsers = message.count;
			}
		});

		conn.on('close', () => {
			hostConnection = null;
			pendingConnection = null;
			isConnected = false;
			if (!error) {
				error = 'Disconnected from host';
			}
			// Enable reconnection if we had a valid connection
			if (lastHostId && !canReconnect) {
				canReconnect = true;
			}
		});

		conn.on('error', (err) => {
			error = err.message;
			reject(err);
		});

		// Timeout after 30 seconds (longer to allow passcode entry)
		setTimeout(() => {
			if (!isConnected && !awaitingPasscode) {
				reject(new Error('Connection timeout'));
			}
		}, 30000);
	});
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
			// Guest: reconnect to host
			await joinHost(lastHostId, lastPasscode);
		}
		canReconnect = false;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Reconnection failed';
		canReconnect = true;
	} finally {
		isReconnecting = false;
	}
}

// Clear reconnection state
function clearReconnect(): void {
	canReconnect = false;
	lastHostId = null;
	lastPasscode = '';
	wasHost = false;
}

// Host: broadcast state to all guests
function broadcastState(): void {
	if (!isHost || !getState) return;

	const state = getState();
	const message: SyncMessage = { type: 'sync', payload: state };

	for (const conn of connections) {
		if (conn.open) {
			conn.send(message);
		}
	}
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
	if (peer) {
		peer.destroy();
		peer = null;
	}
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
	get wasHost() { return wasHost; },

	startHost,
	joinHost,
	submitPasscode,
	reconnect,
	clearReconnect,
	broadcastState,
	sendAction,
	disconnect,
	getShareUrl,
	getRoomFromUrl,
	registerCallbacks
};
