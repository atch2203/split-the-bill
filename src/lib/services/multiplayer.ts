import { joinRoom } from 'trystero/mqtt';
import type { Room } from 'trystero';
import type { BillState, StateUpdate } from '$lib/types';
import { data } from 'autoprefixer';

const APP_ID = 'split-the-bill-stb-2024';

// Simple hash function to combine roomId and password
function hashRoom(roomId: string, password: string | null): string {
	if (!password) return roomId;
	// Simple string combination - the password makes the room name unique
	let hash = 0;
	const str = roomId + ':' + password;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return roomId + '-' + Math.abs(hash).toString(36);
}

type SyncMessageType = 'FULL_STATE' | 'STATE_UPDATE' | 'REQUEST_STATE';

interface SyncMessage {
	type: SyncMessageType;
	payload: BillState | StateUpdate | null;
	timestamp: number;
}

// Room instance (singleton for the session)
let room: Room | null = null;
let sendState: ((data: SyncMessage, peerId?: string) => void) | null = null;

export function generateRoomId(): string {
	return Math.random().toString(36).substring(2, 8);
}

export interface MultiplayerCallbacks {
	getState: () => BillState;
	applyState: (state: BillState) => void;
	applyUpdate: (update: StateUpdate) => void;
	onPeerJoin: (peerId: string) => void;
	onPeerLeave: (peerId: string) => void;
}

export async function initMultiplayer(
	roomId: string,
	isHost: boolean,
	callbacks: MultiplayerCallbacks,
	password: string | null = null
): Promise<() => void> {
	const { getState, applyState, applyUpdate, onPeerJoin, onPeerLeave } = callbacks;

	// Join the room (use hashed name if password is set)
	const actualRoomName = hashRoom(roomId, password);
	console.log('[Multiplayer] Joining room:', actualRoomName, 'as', isHost ? 'host' : 'guest');

	// Get turn server creds
	const response = await fetch("https://lucky-poetry-9bdc.atch22037433.workers.dev/");
  const { iceServers } = await response.json();

	console.log('[Multiplayer] Received ICE Servers, Joining Room')

	room = joinRoom({ appId: APP_ID, relayUrls: ['wss://broker.hivemq.com:8884/mqtt'], rtcConfig: {
		iceServers: iceServers,
	}}, actualRoomName);

	// Set up data channel for state sync
	const [sendStateMsg, receiveStateMsg] = room.makeAction<SyncMessage>('state');
	sendState = sendStateMsg;

	// Handle incoming messages
	receiveStateMsg((message, peerId) => {
		handleMessage(message, peerId, isHost, getState, applyState, applyUpdate);
	});

	// Handle peer events
	room.onPeerJoin((peerId) => {
		console.log('[Multiplayer] Peer joined:', peerId);
		onPeerJoin(peerId);

		// If we're host, send current state to new peer
		if (isHost && getState) {
			const state = getState();
			sendState?.(
				{
					type: 'FULL_STATE',
					payload: state,
					timestamp: Date.now()
				},
				peerId
			);
		}
	});

	room.onPeerLeave((peerId) => {
		console.log('[Multiplayer] Peer left:', peerId);
		onPeerLeave(peerId);
	});

	// If guest, request state from host after connection is established
	// Use longer delay to ensure WebRTC connection is ready
	if (!isHost) {
		setTimeout(() => {
			console.log('[Multiplayer] Guest requesting state from host');
			sendState?.({
				type: 'REQUEST_STATE',
				payload: null,
				timestamp: Date.now()
			});
		}, 1500);

		// Retry after a longer delay if no response
		setTimeout(() => {
			console.log('[Multiplayer] Guest retrying state request');
			sendState?.({
				type: 'REQUEST_STATE',
				payload: null,
				timestamp: Date.now()
			});
		}, 5000);
	}

	// Return cleanup function
	return () => {
		room?.leave();
		room = null;
		sendState = null;
	};
}

function handleMessage(
	message: SyncMessage,
	peerId: string,
	isHost: boolean,
	getState: () => BillState,
	applyState: (state: BillState) => void,
	applyUpdate: (update: StateUpdate) => void
) {
	console.log('[Multiplayer] Received message:', message.type, 'from', peerId);

	switch (message.type) {
		case 'FULL_STATE':
			// Apply full state (typically received by guests)
			if (!isHost && message.payload) {
				console.log('[Multiplayer] Applying full state');
				applyState(message.payload as BillState);
			}
			break;

		case 'STATE_UPDATE':
			// Apply incremental update
			if (message.payload) {
				console.log('[Multiplayer] Applying update:', (message.payload as StateUpdate).action);
				applyUpdate(message.payload as StateUpdate);
			}
			break;

		case 'REQUEST_STATE':
			// Someone is requesting state (host responds)
			if (isHost && getState && sendState) {
				console.log('[Multiplayer] Host sending full state to', peerId);
				sendState(
					{
						type: 'FULL_STATE',
						payload: getState(),
						timestamp: Date.now()
					},
					peerId
				);
			}
			break;
	}
}

// Broadcast state update to all peers
export function broadcastUpdate(update: StateUpdate): void {
	if (sendState) {
		sendState({
			type: 'STATE_UPDATE',
			payload: update,
			timestamp: Date.now()
		});
	}
}

// Broadcast full state (for host after major changes)
export function broadcastFullState(state: BillState): void {
	if (sendState) {
		sendState({
			type: 'FULL_STATE',
			payload: state,
			timestamp: Date.now()
		});
	}
}

export function isConnected(): boolean {
	return room !== null;
}
