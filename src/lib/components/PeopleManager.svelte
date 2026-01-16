<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import PersonBadge from './PersonBadge.svelte';

	let newPersonName = $state('');
	let inputElement: HTMLInputElement;

	function handleAddPerson() {
		const name = newPersonName.trim();
		if (name) {
			syncedBillStore.addPerson(name);
			newPersonName = '';
			inputElement?.focus();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleAddPerson();
		}
	}
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<h2 class="mb-3 text-lg font-semibold text-gray-800">People</h2>

	<div class="space-y-3">
		<!-- Add Person Input -->
		<div class="flex gap-2">
			<input
				bind:this={inputElement}
				bind:value={newPersonName}
				type="text"
				placeholder="Enter name..."
				class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
				onkeydown={handleKeydown}
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
		{:else}
			<p class="text-sm text-gray-500">No people added yet. Add people to split the bill.</p>
		{/if}
	</div>
</div>
