<script lang="ts">
	import ReceiptScanner from '$lib/components/ReceiptScanner.svelte';
	import PeopleManager from '$lib/components/PeopleManager.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import PaymentSummary from '$lib/components/PaymentSummary.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ShareLinkBanner from '$lib/components/ShareLinkBanner.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import icon from "$lib/assets/favicon.png"
</script>

<div class="min-h-screen bg-gray-100">
	<!-- Header -->
	<header class="bg-white shadow-sm">
		<div class="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
			<div class="flex items-center gap-2">
			<img src={icon} alt="" class="max-h-8 object-contain" />
			<h1 class="text-xl font-bold text-gray-900">Split the Bill</h1>
			</div>
			<div class="flex items-center gap-2">
				<ShareButton />
				{#if !peerStore.isGuest}
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

	<!-- Main Content -->
	<main class="mx-auto max-w-2xl space-y-4 px-4 py-4">
		<ShareLinkBanner />
		{#if !peerStore.isGuest}
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
		{#if peerStore.isConnected}
			<p class="mt-1">Synced in real-time with connected users (P2P) with no data stored outside of user devices.</p>
		{/if}
	</footer>
</div>
