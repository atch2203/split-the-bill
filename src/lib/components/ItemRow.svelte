<script lang="ts">
	import type { ReceiptItem } from '$lib/types';
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';
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

	const isSelfAssigned = $derived(
		identityStore.currentPersonId ? item.assignedTo.includes(identityStore.currentPersonId) : false
	);

	const assignedPeople = $derived(
		item.assignedTo
			.map((id) => syncedBillStore.people.find((p) => p.id === id))
			.filter((p): p is NonNullable<typeof p> => p != null)
	);

	const unassignedOthers = $derived(
		syncedBillStore.people.filter(
			(p) => !item.assignedTo.includes(p.id) && p.id !== identityStore.currentPersonId
		)
	);

	function handleAddOther(event: Event) {
		const select = event.target as HTMLSelectElement;
		const personId = select.value;
		if (personId) {
			syncedBillStore.toggleAssignment(item.id, personId);
			select.value = '';
		}
	}

	const canEditItem = $derived(
		!peerStore.isGuest || syncedBillStore.settings.guestsCanEditItems !== false
	);

	function getPortion(personId: string): number {
		return item.portions?.[personId] ?? 1;
	}

	function incrementPortion(personId: string) {
		syncedBillStore.setPortion(item.id, personId, getPortion(personId) + 1);
	}

	function decrementPortion(personId: string) {
		const current = getPortion(personId);
		if (current > 1) {
			syncedBillStore.setPortion(item.id, personId, current - 1);
		}
	}
</script>

<div
	data-item-id={item.id}
	class="rounded-lg border p-3 transition-colors {isUnassigned
		? 'border-yellow-300 bg-yellow-50'
		: 'border-gray-200 bg-white'}"
>
	{#if isEditing}
		<!-- Edit Mode -->
		<div class="space-y-2">
			<div class="flex flex-wrap gap-2">
				<label class="flex w-full min-w-0 flex-1 basis-full flex-col gap-0.5 sm:basis-0">
					<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Name</span>
					<input
						bind:value={editName}
						type="text"
						placeholder="Item name"
						class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
						onkeydown={handleKeydown}
					/>
				</label>
				<label class="flex w-20 min-w-0 flex-1 flex-col gap-0.5 sm:w-16 sm:flex-initial">
					<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500" title="Quantity">Quantity</span>
					<input
						value={editQuantity}
						oninput={handleQuantityChange}
						type="number"
						min="1"
						placeholder="1"
						class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
						onkeydown={handleKeydown}
						title="Changing quantity adjusts price to keep total the same"
					/>
				</label>
				<label class="flex w-24 min-w-0 flex-1 flex-col gap-0.5 sm:flex-initial">
					<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Price ($)</span>
					<input
						bind:value={editPrice}
						type="text"
						inputmode="decimal"
						placeholder="0.00"
						class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
						onkeydown={handleKeydown}
					/>
				</label>
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
					<span class="font-medium text-gray-800">{item.name}</span>
					{#if item.quantity > 1}
						<span class="text-xs text-gray-500">x{item.quantity}</span>
					{/if}
					{#if canEditItem}
						<button
							onclick={startEditing}
							class="rounded p-1 text-gray-400 transition-colors hover:bg-blue-100 hover:text-blue-600"
							title="Edit item"
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
							</svg>
						</button>
					{/if}
					<button
						onclick={() => syncedBillStore.toggleMultipart(item.id)}
						class="rounded p-1 transition-colors {item.isMultipart
							? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
							: 'text-gray-400 hover:bg-purple-100 hover:text-purple-600'}"
						title={item.isMultipart ? 'Switch to equal split' : 'Switch to portion-based split'}
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
						</svg>
					</button>
				</div>

				<!-- Assigned People -->
				{#if assignedPeople.length > 0}
					<div class="mt-1.5 flex flex-wrap gap-1">
						{#each assignedPeople as person (person.id)}
							{#if item.isMultipart}
								<span
									class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
									style="background-color: {person.color}40; border: 1px solid {person.color};"
								>
									<span>{person.name}</span>
									<button
										onclick={() => decrementPortion(person.id)}
										disabled={getPortion(person.id) <= 1}
										class="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm leading-none transition-colors hover:bg-gray-100 disabled:opacity-40"
										title="Decrease portion"
										aria-label="Decrease {person.name}'s portion"
									>&minus;</button>
									<span class="min-w-4 text-center font-semibold tabular-nums">{getPortion(person.id)}</span>
									<button
										onclick={() => incrementPortion(person.id)}
										class="flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm leading-none transition-colors hover:bg-gray-100"
										title="Increase portion"
										aria-label="Increase {person.name}'s portion"
									>+</button>
									<button
										onclick={() => syncedBillStore.toggleAssignment(item.id, person.id)}
										class="ml-0.5 leading-none opacity-60 transition-opacity hover:opacity-100"
										title="Remove {person.name}"
									>&times;</button>
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
									style="background-color: {person.color}40; border: 1px solid {person.color};"
								>
									{person.name}
									<button
										onclick={() => syncedBillStore.toggleAssignment(item.id, person.id)}
										class="ml-0.5 leading-none opacity-60 transition-opacity hover:opacity-100"
										title="Remove {person.name}"
									>&times;</button>
								</span>
							{/if}
						{/each}
					</div>
				{/if}

				<!-- Assignment Controls -->
				<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
					{#if identityStore.currentPersonId}
						<button
							onclick={() => syncedBillStore.toggleAssignment(item.id, identityStore.currentPersonId!)}
							class="rounded-full px-3 py-0.5 text-xs font-medium transition-colors {isSelfAssigned
								? 'bg-green-100 text-green-800 border border-green-300 hover:bg-red-50 hover:text-red-700 hover:border-red-300'
								: 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'}"
						>
							{isSelfAssigned ? '✓ Me' : '+ Me'}
						</button>
					{/if}
					{#if unassignedOthers.length > 0}
						<select
							onchange={handleAddOther}
							class="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600 focus:border-blue-500 focus:outline-none"
						>
							<option value="">+ Other</option>
							{#each unassignedOthers as person (person.id)}
								<option value={person.id}>{person.name}</option>
							{/each}
						</select>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2">
				<span class="font-semibold text-gray-800">{formatPrice(totalPrice)}</span>
				{#if canEditItem}
					<button
						onclick={() => syncedBillStore.removeItem(item.id)}
						class="rounded p-1 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600"
						title="Remove item"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>
		</div>

		{#if isUnassigned}
			<div class="mt-2 text-xs text-yellow-700">Not assigned to anyone</div>
		{/if}
	{/if}
</div>
