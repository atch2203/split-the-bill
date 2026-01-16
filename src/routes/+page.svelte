<script lang="ts">
	import ReceiptScanner from '$lib/components/ReceiptScanner.svelte';
	import PeopleManager from '$lib/components/PeopleManager.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import PaymentSummary from '$lib/components/PaymentSummary.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { multiplayerStore } from '$lib/stores/multiplayerStore.svelte';

	let shareLinkExpanded = $state(true);
	let showCopied = $state(false);

	async function copyShareLink() {
		if (multiplayerStore.shareUrl) {
			await navigator.clipboard.writeText(multiplayerStore.shareUrl);
			showCopied = true;
			setTimeout(() => {
				showCopied = false;
			}, 2000);
		}
	}
</script>

<div class="min-h-screen bg-gray-100">
	<!-- Header -->
	<header class="bg-white shadow-sm">
		<div class="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
			<h1 class="text-xl font-bold text-gray-900">Split the Bill</h1>
			<div class="flex items-center gap-2">
				<ShareButton />
				{#if multiplayerStore.canReset}
					<button
						onclick={() => {
							if (confirm('Reset everything?')) {
								billStore.resetAll();
							}
						}}
						class="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
					>
						Reset
					</button>
				{/if}
			</div>
		</div>
	</header>

	<!-- Connection Status Banner -->
	{#if multiplayerStore.roomId}
		<div class="border-b border-blue-100 bg-blue-50">
			<div class="mx-auto max-w-2xl px-4 py-2">
				<div class="flex items-center justify-between text-sm text-blue-700">
					<span>
						{#if multiplayerStore.isHost}
							You're hosting
						{:else}
							You've joined as a guest
						{/if}
						{#if multiplayerStore.peerCount > 0}
							<span class="ml-1">({multiplayerStore.peerCount + 1} connected)</span>
						{/if}
					</span>
					<button
						onclick={() => (shareLinkExpanded = !shareLinkExpanded)}
						class="text-blue-600 hover:text-blue-800"
					>
						{shareLinkExpanded ? 'Hide link' : 'Show link'}
					</button>
				</div>
				{#if shareLinkExpanded && multiplayerStore.shareUrl}
					<div class="mt-2 flex items-center gap-2">
						<input
							type="text"
							readonly
							value={multiplayerStore.shareUrl}
							class="flex-1 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-gray-700"
							onclick={(e) => e.currentTarget.select()}
						/>
						<button
							onclick={copyShareLink}
							class="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
						>
							{showCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
					{#if multiplayerStore.password}
						<p class="mt-1 text-xs text-blue-600">Password protected</p>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<!-- Main Content -->
	<main class="mx-auto max-w-2xl space-y-4 px-4 py-4">
		{#if multiplayerStore.canScan}
			<ReceiptScanner />
		{/if}
		<PeopleManager />
		<ItemList />
		<SettingsPanel />
		<PaymentSummary />
	</main>

	<!-- Footer -->
	<footer class="py-8 text-center text-sm text-gray-500">
		<p>All calculations, image processing, and OCR are done locally in your browser.</p>
		{#if multiplayerStore.roomId}
			<p class="mt-1">Synced in real-time with connected users (P2P) with no data stored anywhere.</p>
		{/if}
	</footer>
</div>
