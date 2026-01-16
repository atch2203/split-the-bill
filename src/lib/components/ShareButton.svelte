<script lang="ts">
	import { multiplayerStore } from '$lib/stores/multiplayerStore.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { generateRoomId, initMultiplayer, broadcastUpdate } from '$lib/services/multiplayer';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let cleanupFn: (() => void) | null = null;
	let showCopied = $state(false);
	let showShareModal = $state(false);
	let passwordInput = $state('');

	onMount(() => {
		// Check if joining via URL
		const urlData = multiplayerStore.getRoomFromUrl();
		if (urlData) {
			joinRoom(urlData.roomId, false, urlData.password);
		}

		return () => {
			cleanupFn?.();
		};
	});

	async function joinRoom(roomId: string, asHost: boolean, password: string | null = null) {
		multiplayerStore.setRoomId(roomId);
		multiplayerStore.setHost(asHost);
		multiplayerStore.setPassword(password);

		// Set up broadcast function in billStore
		billStore.setBroadcastFunction(broadcastUpdate);

		cleanupFn = await initMultiplayer(
			roomId,
			asHost,
			{
				getState: () => billStore.getSnapshot(),
				applyState: (state) => billStore.applySnapshot(state),
				applyUpdate: (update) => billStore.applyUpdate(update),
				onPeerJoin: (peerId) => {
					multiplayerStore.addPeer(peerId);
					multiplayerStore.setConnected(true);
				},
				onPeerLeave: (peerId) => {
					multiplayerStore.removePeer(peerId);
					if (multiplayerStore.peerCount === 0) {
						multiplayerStore.setConnected(false);
					}
				}
			},
			password
		);

		// Update URL
		if (browser) {
			const url = new URL(window.location.href);
			url.searchParams.set('room', roomId);
			if (password) {
				url.searchParams.set('p', password);
			}
			window.history.replaceState({}, '', url.toString());
		}
	}

	function openShareModal() {
		passwordInput = '';
		showShareModal = true;
	}

	function handleCreateRoom() {
		const roomId = generateRoomId();
		const password = passwordInput.trim() || null;
		showShareModal = false;
		joinRoom(roomId, true, password);
	}

	function handleDisconnect() {
		cleanupFn?.();
		cleanupFn = null;
		multiplayerStore.reset();
		billStore.setBroadcastFunction(null);

		// Remove room from URL
		if (browser) {
			const url = new URL(window.location.href);
			url.searchParams.delete('room');
			url.searchParams.delete('p');
			window.history.replaceState({}, '', url.toString());
		}
	}

	async function copyLink() {
		if (multiplayerStore.shareUrl) {
			await navigator.clipboard.writeText(multiplayerStore.shareUrl);
			showCopied = true;
			setTimeout(() => {
				showCopied = false;
			}, 2000);
		}
	}
</script>

{#if multiplayerStore.roomId}
	<!-- Connected state -->
	<div class="flex items-center gap-2">
		<span class="text-sm text-green-700">
			{multiplayerStore.peerCount + 1} in room
		</span>
		<button
			onclick={copyLink}
			class="rounded-lg bg-green-100 px-3 py-1.5 text-sm text-green-700 transition-colors hover:bg-green-200"
		>
			{showCopied ? 'Copied!' : 'Copy Link'}
		</button>
		<button
			onclick={handleDisconnect}
			class="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
		>
			Leave
		</button>
	</div>
{:else if showShareModal}
	<!-- Share modal -->
	<div class="flex items-center gap-2">
		<input
			bind:value={passwordInput}
			type="text"
			placeholder="Password (optional)"
			class="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
			onkeydown={(e) => e.key === 'Enter' && handleCreateRoom()}
		/>
		<button
			onclick={handleCreateRoom}
			class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		>
			Create Room
		</button>
		<button
			onclick={() => (showShareModal = false)}
			class="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
		>
			Cancel
		</button>
	</div>
{:else}
	<!-- Not connected -->
	<button
		onclick={openShareModal}
		class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
	>
		Share
	</button>
{/if}

