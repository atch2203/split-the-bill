import type { Peer } from '$lib/types';
import { browser } from '$app/environment';

// Reactive state
let isConnected = $state(false);
let isHost = $state(false);
let roomId = $state<string | null>(null);
let password = $state<string | null>(null);
let peers = $state<Peer[]>([]);
let connectionError = $state<string | null>(null);

// Derived values
const peerCount = $derived(peers.length);
const shareUrl = $derived.by(() => {
	if (!roomId || !browser) return null;
	const url = new URL(window.location.origin + window.location.pathname);
	url.searchParams.set('room', roomId);
	if (password) {
		url.searchParams.set('p', password);
	}
	return url.toString();
});
const canScan = $derived(!roomId || isHost);
const canReset = $derived(!roomId || isHost);

// Actions
function setConnected(connected: boolean): void {
	isConnected = connected;
}

function setHost(host: boolean): void {
	isHost = host;
}

function setRoomId(id: string | null): void {
	roomId = id;
}

function setPassword(pw: string | null): void {
	password = pw;
}

function addPeer(peerId: string): void {
	if (!peers.find((p) => p.peerId === peerId)) {
		peers.push({ peerId });
	}
}

function removePeer(peerId: string): void {
	const index = peers.findIndex((p) => p.peerId === peerId);
	if (index !== -1) {
		peers.splice(index, 1);
	}
}

function setError(error: string | null): void {
	connectionError = error;
}

function reset(): void {
	isConnected = false;
	isHost = false;
	roomId = null;
	password = null;
	peers.length = 0;
	connectionError = null;
}

function getRoomFromUrl(): { roomId: string; password: string | null } | null {
	if (!browser) return null;
	const params = new URLSearchParams(window.location.search);
	const roomId = params.get('room');
	if (!roomId) return null;
	return {
		roomId,
		password: params.get('p')
	};
}

export const multiplayerStore = {
	// State getters
	get isConnected() {
		return isConnected;
	},
	get isHost() {
		return isHost;
	},
	get roomId() {
		return roomId;
	},
	get password() {
		return password;
	},
	get peers() {
		return peers;
	},
	get peerCount() {
		return peerCount;
	},
	get shareUrl() {
		return shareUrl;
	},
	get connectionError() {
		return connectionError;
	},
	get canScan() {
		return canScan;
	},
	get canReset() {
		return canReset;
	},

	// Actions
	setConnected,
	setHost,
	setRoomId,
	setPassword,
	addPeer,
	removePeer,
	setError,
	reset,
	getRoomFromUrl
};
