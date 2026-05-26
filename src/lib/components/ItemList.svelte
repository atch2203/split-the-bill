<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';
	import ItemRow from './ItemRow.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';

	const showGuestDemoItem = $derived(peerStore.isGuest && identityStore.tourActive);
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-lg font-semibold text-gray-800">Items</h2>
		<button
			onclick={() => syncedBillStore.addItem()}
			class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		>
			+ Add Item
		</button>
	</div>

	<div class="space-y-2">
		{#if showGuestDemoItem}
			<!-- Static demo row used by the tour to point out all parts of an item -->
			<div
				data-item-id="tour-demo"
				class="rounded-lg border border-gray-200 bg-white p-3"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<span class="font-medium text-gray-800">Sample burger</span>
							<span class="text-xs text-gray-500">x1</span>
							<span class="rounded p-1 text-gray-400" title="Edit item">
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
								</svg>
							</span>
							<span class="rounded p-1 text-gray-400" title="Portion-based split">
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
								</svg>
							</span>
						</div>
						<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
							<span class="rounded-full border border-blue-300 bg-blue-100 px-3 py-0.5 text-xs font-medium text-blue-700">+ Me</span>
							<span class="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600">+ Other ▾</span>
						</div>
					</div>
					<span class="font-semibold text-gray-800">{formatPrice(12.5)}</span>
				</div>
			</div>
		{/if}
		{#if syncedBillStore.items.length > 0}
			{#each syncedBillStore.items as item (item.id)}
				<ItemRow {item} />
			{/each}

			<!-- Subtotal -->
			<div class="mt-4 flex justify-between border-t border-gray-200 pt-3">
				<span class="font-medium text-gray-600">Subtotal</span>
				<span class="font-semibold text-gray-800">{formatPrice(syncedBillStore.subtotal)}</span>
			</div>

			<!-- Unassigned Warning -->
			{#if syncedBillStore.unassignedItems.length > 0}
				<div class="mt-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
					<strong>{syncedBillStore.unassignedItems.length}</strong> item{syncedBillStore.unassignedItems
						.length === 1
						? ' is'
						: 's are'} not assigned to anyone
				</div>
			{/if}
		{:else}
			<div class="py-8 text-center text-gray-500">
				<p class="mb-2">No items yet</p>
				<p class="text-sm">Scan a receipt or add items manually</p>
			</div>
		{/if}
	</div>
</div>
