<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import ItemRow from './ItemRow.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';
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
