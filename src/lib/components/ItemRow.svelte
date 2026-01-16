<script lang="ts">
	import type { ReceiptItem } from '$lib/types';
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import PersonBadge from './PersonBadge.svelte';
	import { formatPrice, parsePrice } from '$lib/utils/receiptParser';

	interface Props {
		item: ReceiptItem;
	}

	let { item }: Props = $props();

	let isEditing = $state(false);
	let editName = $state('');
	let editPrice = $state('');
	let editQuantity = $state('');
	let editTotal = $state(0); // Store the total to preserve when quantity changes

	function startEditing() {
		editName = item.name;
		editPrice = item.price.toString();
		editQuantity = item.quantity.toString();
		editTotal = item.price * item.quantity;
		isEditing = true;
	}

	// When quantity changes, adjust price to keep total the same
	function handleQuantityChange(event: Event) {
		const input = event.target as HTMLInputElement;
		const newQuantity = parseInt(input.value) || 1;
		if (newQuantity > 0 && editTotal > 0) {
			const newPrice = editTotal / newQuantity;
			editPrice = newPrice.toFixed(2);
		}
		editQuantity = input.value;
	}

	function saveEditing() {
		syncedBillStore.updateItem(item.id, {
			name: editName.trim() || 'Item',
			price: parsePrice(editPrice),
			quantity: Math.max(1, parseInt(editQuantity) || 1)
		});
		isEditing = false;
	}

	function cancelEditing() {
		isEditing = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			saveEditing();
		} else if (event.key === 'Escape') {
			cancelEditing();
		}
	}

	const totalPrice = $derived(item.price * item.quantity);
	const isUnassigned = $derived(item.assignedTo.length === 0);
</script>

<div
	class="rounded-lg border p-3 transition-colors {isUnassigned
		? 'border-yellow-300 bg-yellow-50'
		: 'border-gray-200 bg-white'}"
>
	{#if isEditing}
		<!-- Edit Mode -->
		<div class="space-y-2">
			<div class="flex gap-2">
				<input
					bind:value={editName}
					type="text"
					placeholder="Item name"
					class="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
					onkeydown={handleKeydown}
				/>
				<input
					value={editQuantity}
					oninput={handleQuantityChange}
					type="number"
					min="1"
					placeholder="Qty"
					class="w-16 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
					onkeydown={handleKeydown}
					title="Changing quantity adjusts price to keep total the same"
				/>
				<input
					bind:value={editPrice}
					type="text"
					inputmode="decimal"
					placeholder="Price"
					class="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
					onkeydown={handleKeydown}
				/>
			</div>
			<div class="flex justify-end gap-2">
				<button
					onclick={cancelEditing}
					class="rounded px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100"
				>
					Cancel
				</button>
				<button
					onclick={saveEditing}
					class="rounded bg-blue-500 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-600"
				>
					Save
				</button>
			</div>
		</div>
	{:else}
		<!-- View Mode -->
		<div class="flex items-start justify-between gap-2">
			<div class="flex-1">
				<div class="flex items-center gap-2">
					<button
						onclick={startEditing}
						class="text-left font-medium text-gray-800 hover:text-blue-600"
					>
						{item.name}
					</button>
					{#if item.quantity > 1}
						<span class="text-xs text-gray-500">x{item.quantity}</span>
					{/if}
				</div>

				<!-- Person Assignment -->
				<div class="mt-2 flex flex-wrap gap-1">
					{#if syncedBillStore.people.length > 0}
						{#each syncedBillStore.people as person (person.id)}
							<PersonBadge
								{person}
								selected={item.assignedTo.includes(person.id)}
								onclick={() => syncedBillStore.toggleAssignment(item.id, person.id)}
							/>
						{/each}
					{:else}
						<span class="text-xs text-gray-400">Add people to assign</span>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2">
				<span class="font-semibold text-gray-800">{formatPrice(totalPrice)}</span>
				<button
					onclick={() => syncedBillStore.removeItem(item.id)}
					class="rounded p-1 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600"
					title="Remove item"
				>
					&#x2715;
				</button>
			</div>
		</div>

		{#if isUnassigned}
			<div class="mt-2 text-xs text-yellow-700">Not assigned to anyone</div>
		{/if}
	{/if}
</div>
