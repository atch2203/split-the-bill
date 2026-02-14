<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import PersonBadge from './PersonBadge.svelte';

	let splitCount = $state(2);
	let newPersonName = $state('');
	let nameInputElement: HTMLInputElement;

	function handleQuickSplit() {
		if (splitCount < 1) return;
		// Clear existing people
		for (const person of [...syncedBillStore.people]) {
			syncedBillStore.removePerson(person.id);
		}
		// Add generic people
		for (let i = 1; i <= splitCount; i++) {
			syncedBillStore.addPerson(`Person ${i}`);
		}
		// Assign every item to all people now in the store
		const allIds = syncedBillStore.people.map((p) => p.id);
		for (const item of syncedBillStore.items) {
			syncedBillStore.updateItem(item.id, { assignedTo: [...allIds] });
		}
	}

	function handleAddPerson() {
		const name = newPersonName.trim();
		if (name) {
			syncedBillStore.addPerson(name);
			newPersonName = '';
			nameInputElement?.focus();
		}
	}

	function handleNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') handleAddPerson();
	}
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<h2 class="mb-3 text-lg font-semibold text-gray-800">People</h2>

	<div class="space-y-3">
		<!-- Quick split by number -->
		<div class="flex items-center gap-2">
			<span class="text-sm text-gray-600">Split evenly among</span>
			<input
				type="number"
				min="1"
				max="99"
				bind:value={splitCount}
				class="w-16 rounded-lg border border-gray-300 px-2 py-2 text-center text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			/>
			<span class="text-sm text-gray-600">people</span>
			<button
				onclick={handleQuickSplit}
				disabled={splitCount < 1}
				class="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				Split
			</button>
		</div>

		<!-- Divider -->
		<div class="flex items-center gap-2">
			<div class="h-px flex-1 bg-gray-200"></div>
			<span class="text-xs text-gray-400">or add by name</span>
			<div class="h-px flex-1 bg-gray-200"></div>
		</div>

		<!-- Manual name add -->
		<div class="flex gap-2">
			<input
				bind:this={nameInputElement}
				bind:value={newPersonName}
				type="text"
				placeholder="Enter name..."
				class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
				onkeydown={handleNameKeydown}
			/>
			<button
				onclick={handleAddPerson}
				disabled={!newPersonName.trim()}
				class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				+ Add
			</button>
		</div>

		<!-- People List -->
		{#if syncedBillStore.people.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each syncedBillStore.people as person (person.id)}
					<PersonBadge
						{person}
						showRemove={true}
						onremove={() => syncedBillStore.removePerson(person.id)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>
