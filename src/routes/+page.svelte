<script lang="ts">
	import ReceiptScanner from '$lib/components/ReceiptScanner.svelte';
	import PeopleManager from '$lib/components/PeopleManager.svelte';
	import IdentityPicker from '$lib/components/IdentityPicker.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import PaymentSummary from '$lib/components/PaymentSummary.svelte';
	import ExportImport from '$lib/components/ExportImport.svelte';
	import PaymentMethodsPanel from '$lib/components/PaymentMethodsPanel.svelte';
	import BillTitle from '$lib/components/BillTitle.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ShareLinkBanner from '$lib/components/ShareLinkBanner.svelte';
	import Tour from '$lib/components/Tour.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import icon from "$lib/assets/favicon.png"

	let tourActive = $state(false);
</script>

<div class="min-h-screen bg-gray-100">
	<!-- Header -->
	<header class="bg-white shadow-sm">
		<div
			class="header-grid mx-auto max-w-2xl px-4 py-3 sm:py-4"
			class:is-guest={peerStore.isGuest}
		>
			<div class="area-logo flex min-w-0 items-center gap-2">
				<img src={icon} alt="" class="max-h-8 flex-shrink-0 object-contain" />
				<h1 class="truncate text-xl font-bold text-gray-900">Split the Bill</h1>
			</div>
			<button
				onclick={() => (tourActive = true)}
				class="area-tour justify-self-start rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 sm:justify-self-auto"
				title="Quick start tour"
			>
				? Tour
			</button>
			<div class="area-share justify-self-end" data-tour="share">
				<ShareButton />
			</div>
			{#if !peerStore.isGuest}
				<button
					onclick={() => {
						if (confirm('Reset everything?')) {
							billStore.resetAll();
						}
					}}
					class="area-reset justify-self-end rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
				>
					Reset
				</button>
			{/if}
		</div>
	</header>

	<!-- Main Content -->
	<main class="mx-auto max-w-2xl space-y-4 px-4 py-4">
		<ShareLinkBanner />
		<BillTitle />
		{#if !peerStore.isGuest}
			<div data-tour="parse">
				<ReceiptScanner />
			</div>
		{/if}
		<IdentityPicker />
		{#if !peerStore.isGuest}
			<PeopleManager />
		{/if}
		<div data-tour="items">
			<ItemList />
		</div>
		<div data-tour="settings">
			<SettingsPanel />
		</div>
		<div data-tour="payments">
			<PaymentMethodsPanel />
		</div>
		<div data-tour="summary">
			<PaymentSummary />
		</div>
		<div data-tour="export">
			<ExportImport />
		</div>
	</main>

	{#if tourActive}
		<Tour onClose={() => (tourActive = false)} />
	{/if}

	<!-- Footer -->
	<footer class="py-8 text-center text-sm text-gray-500">
		<p>All calculations, image processing, and OCR are done locally in your browser.</p>
		{#if peerStore.isConnected}
			<p class="mt-1">Synced in real-time with connected users (P2P) with no data stored outside of user devices.</p>
		{/if}
		<p class="mt-1">Feel free to report issues or request features on <a href="https://github.com/atch2203/split-the-bill/issues" class="text-blue-600 underline hover:text-blue-800">github</a>, or check out some of my other work on my <a href="https://atch2203.github.io" class="text-blue-600 underline hover:text-blue-800">main site</a>!</p>
	</footer>
</div>

<style>
	.header-grid {
		display: grid;
		align-items: center;
		gap: 0.5rem;
		grid-template-areas:
			'logo share'
			'tour reset';
		grid-template-columns: 1fr auto;
	}
	/* Guests have no Reset button — collapse Tour + Share onto a single row. */
	.header-grid.is-guest {
		grid-template-areas:
			'logo logo'
			'tour share';
		grid-template-columns: 1fr auto;
	}
	@media (min-width: 640px) {
		.header-grid {
			grid-template-areas: 'logo tour share reset';
			grid-template-columns: 1fr auto auto auto;
		}
		.header-grid.is-guest {
			grid-template-areas: 'logo tour share';
			grid-template-columns: 1fr auto auto;
		}
	}
	.area-logo {
		grid-area: logo;
	}
	.area-share {
		grid-area: share;
	}
	.area-tour {
		grid-area: tour;
	}
	.area-reset {
		grid-area: reset;
	}
</style>
