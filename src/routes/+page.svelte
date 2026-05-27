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

	// People who haven't marked themselves done selecting yet.
	const peopleNotDone = $derived(billStore.people.filter((p) => !p.done));
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
		{#if peerStore.isJoining || peerStore.joinFailed}
			<div
				class="rounded-lg border p-6 text-center shadow-sm {peerStore.joinFailed
					? 'border-red-200 bg-red-50'
					: 'border-blue-200 bg-blue-50'}"
			>
				{#if peerStore.joinFailed}
					<svg
						class="mx-auto mb-3 h-6 w-6 text-red-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<p class="font-semibold text-gray-800">Couldn't connect to the room</p>
					<p class="mt-1 text-sm text-gray-600">
						Gave up after {peerStore.maxJoinAttempts} attempts.
					</p>
					{#if peerStore.error}
						<p class="mt-1 text-sm text-red-600">{peerStore.error}</p>
					{/if}
				{:else if peerStore.awaitingPasscode}
					<svg
						class="mx-auto mb-3 h-6 w-6 text-blue-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 11c0-1.105.895-2 2-2s2 .895 2 2-.895 2-2 2-2-.895-2-2zm-6 7a6 6 0 1112 0H6z"
						/>
					</svg>
					<p class="font-semibold text-gray-800">Enter the passcode to join</p>
					<p class="mt-1 text-sm text-gray-600">Use the passcode field in the header.</p>
				{:else}
					<svg class="mx-auto mb-3 h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" />
						<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75" />
					</svg>
					<p class="font-semibold text-gray-800">Connecting to host…</p>
					<p class="mt-1 text-sm text-gray-600">
						{#if peerStore.joinAttempts > 1}
							Retrying… attempt {peerStore.joinAttempts} of {peerStore.maxJoinAttempts}.
						{:else}
							Waiting for the room to accept your connection.
						{/if}
					</p>
				{/if}
				{#if !peerStore.joinFailed && peerStore.error}
					<p class="mt-2 text-sm text-red-600">{peerStore.error}</p>
				{/if}
				<!-- Always offer a way out; Retry only once attempts are exhausted. -->
				<div class="mt-4 flex justify-center gap-2">
					{#if peerStore.joinFailed}
						<button
							onclick={() => peerStore.retryJoin()}
							class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
						>
							Retry
						</button>
					{/if}
					<button
						onclick={() => peerStore.exitRoom()}
						class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
					>
						Exit room
					</button>
				</div>
			</div>
		{:else}
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
		{#if billStore.people.length > 0 && peopleNotDone.length > 0}
			<div class="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 shadow-sm">
				<svg class="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
				</svg>
				<span>
					Still selecting:
					<span class="font-medium">{peopleNotDone.map((p) => p.name).join(', ')}</span>.
					Totals may change until everyone's done.
				</span>
			</div>
		{/if}
		<div data-tour="summary">
			<PaymentSummary />
		</div>
		<div data-tour="export">
			<ExportImport />
		</div>
		{/if}
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
