<script lang="ts">
	import { onMount } from 'svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';

	let isSharing = $state(false);
	let shareUrl = $state('');
	let copied = $state(false);
	let connecting = $state(false);

	// Passcode UI state
	let showPasscodeSetup = $state(false);
	let hostPasscodeInput = $state('');
	let guestPasscodeInput = $state('');

	// Register callbacks when component mounts
	onMount(() => {
		// Register peer store callbacks
		peerStore.registerCallbacks(
			// onStateSync - when guest receives state from host
			(state) => {
				billStore.setState(state);
			},
			// onAction - when host receives action from guest
			(action, args) => {
				const fn = (billStore as Record<string, unknown>)[action];
				if (typeof fn === 'function') {
					(fn as (...args: unknown[]) => void)(...args);
				}
			},
			// getState - for host to get current state
			() => billStore.getState()
		);

		// Set up broadcast on state changes (only for host)
		billStore.setOnStateChange(() => {
			if (peerStore.isHost) {
				peerStore.broadcastState();
			}
		});

		// Check if we should auto-join a room
		const roomInfo = peerStore.getRoomFromUrl();
		if (roomInfo) {
			joinRoom(roomInfo.roomId, roomInfo.passcode);
		}

		return () => {
			billStore.setOnStateChange(null);
		};
	});

	function openPasscodeSetup() {
		showPasscodeSetup = true;
		hostPasscodeInput = '';
	}

	async function startSharing(passcode: string = '') {
		showPasscodeSetup = false;
		connecting = true;
		try {
			await peerStore.startHost(passcode);
			isSharing = true;
			shareUrl = peerStore.getShareUrl();
		} catch {
			// Error is available in peerStore.error
		}
		connecting = false;
	}

	async function joinRoom(roomId: string, passcode: string = '') {
		connecting = true;
		try {
			await peerStore.joinHost(roomId, passcode);
			isSharing = true;
		} catch {
			// Error is available in peerStore.error
		}
		connecting = false;
	}

	function submitGuestPasscode() {
		peerStore.submitPasscode(guestPasscodeInput);
		guestPasscodeInput = '';
	}

	function copyLink() {
		navigator.clipboard.writeText(shareUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function stopSharing() {
		peerStore.disconnect();
		isSharing = false;
		shareUrl = '';
		showPasscodeSetup = false;
		hostPasscodeInput = '';
		guestPasscodeInput = '';
		// Clear URL parameters
		const url = new URL(window.location.href);
		url.searchParams.delete('room');
		url.searchParams.delete('p');
		window.history.replaceState({}, '', url.toString());
	}
</script>

{#if showPasscodeSetup}
	<div class="flex items-center gap-2">
		<input
			type="text"
			bind:value={hostPasscodeInput}
			placeholder="Passcode (optional)"
			class="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
			onkeydown={(e) => e.key === 'Enter' && startSharing(hostPasscodeInput)}
		/>
		<button
			onclick={() => startSharing(hostPasscodeInput)}
			class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-600"
		>
			Start
		</button>
		<button
			onclick={() => (showPasscodeSetup = false)}
			class="rounded-lg bg-gray-100 px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-200"
		>
			Cancel
		</button>
	</div>
{:else if peerStore.awaitingPasscode}
	<div class="flex items-center gap-2">
		<input
			type="text"
			bind:value={guestPasscodeInput}
			placeholder="Enter passcode"
			class="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
			onkeydown={(e) => e.key === 'Enter' && submitGuestPasscode()}
		/>
		<button
			onclick={submitGuestPasscode}
			class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-600"
		>
			Join
		</button>
		<button
			onclick={stopSharing}
			class="rounded-lg bg-gray-100 px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-200"
		>
			Cancel
		</button>
	</div>
{:else if connecting}
	<button
		disabled
		class="flex items-center gap-2 rounded-lg bg-gray-300 px-3 py-1.5 text-sm text-gray-500"
	>
		<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
			<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" />
			<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75" />
		</svg>
		Connecting...
	</button>
{:else if !isSharing}
	<button
		onclick={openPasscodeSetup}
		class="flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-600"
	>
		<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
		</svg>
		Share
	</button>
{:else if peerStore.isHost}
	<div class="flex items-center gap-2">
		<div class="flex items-center gap-1 rounded-lg bg-green-100 px-2 py-1 text-sm text-green-700">
			<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
				<circle cx="12" cy="12" r="10" />
			</svg>
			{peerStore.guestCount} connected
		</div>
		{#if peerStore.hasPasscode}
			<div class="flex items-center gap-1 rounded-lg bg-yellow-100 px-2 py-1 text-sm text-yellow-700" title="Passcode protected">
				<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
					<path d="M12 1C8.676 1 6 3.676 6 7v2H4v14h16V9h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v2H8V7c0-2.276 1.724-4 4-4z"/>
				</svg>
			</div>
		{/if}
		<button
			onclick={stopSharing}
			class="rounded-lg bg-gray-100 px-2 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-200"
		>
			Stop
		</button>
	</div>
{:else}
	<div class="flex items-center gap-2">
		<div class="flex items-center gap-1 rounded-lg bg-blue-100 px-2 py-1 text-sm text-blue-700">
			<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
				<circle cx="12" cy="12" r="10" />
			</svg>
			{peerStore.totalUsers} in session
		</div>
		<button
			onclick={stopSharing}
			class="rounded-lg bg-gray-100 px-2 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-200"
		>
			Leave
		</button>
	</div>
{/if}

{#if peerStore.error}
	<p class="mt-1 text-xs text-red-500">{peerStore.error}</p>
{/if}
