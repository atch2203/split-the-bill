<script lang="ts">
	import ReceiptScanner from '$lib/components/ReceiptScanner.svelte';
	import PeopleManager from '$lib/components/PeopleManager.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import PaymentSummary from '$lib/components/PaymentSummary.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
</script>

<div class="min-h-screen bg-gray-100">
	<!-- Header -->
	<header class="bg-white shadow-sm">
		<div class="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
			<h1 class="text-xl font-bold text-gray-900">Split the Bill</h1>
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
		</div>
	</header>

	<!-- Main Content -->
	<main class="mx-auto max-w-2xl space-y-4 px-4 py-4">
		<ReceiptScanner />
		<PeopleManager />
		<ItemList />
		<SettingsPanel />
		<PaymentSummary />
	</main>

	<!-- Footer -->
	<footer class="py-8 text-center text-sm text-gray-500">
		<p>All calculations are done locally in your browser.</p>
	</footer>
</div>
