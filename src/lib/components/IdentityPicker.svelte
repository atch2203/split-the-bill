<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';

	let newName = $state('');
	let pendingName = $state<string | null>(null);
	let nameInputElement: HTMLInputElement;

	const currentPerson = $derived(
		identityStore.currentPersonId
			? syncedBillStore.people.find((p) => p.id === identityStore.currentPersonId)
			: null
	);

	const isDuplicateName = $derived(
		peerStore.isGuest &&
			newName.trim().length > 0 &&
			syncedBillStore.people.some(
				(p) => p.name.toLowerCase() === newName.trim().toLowerCase()
			)
	);

	function selectPerson(id: string) {
		identityStore.setCurrentPerson(id);
	}

	function createAndSelect() {
		const name = newName.trim();
		if (!name) return;
		if (isDuplicateName) return;
		const person = syncedBillStore.addPerson(name);
		if (person) {
			identityStore.setCurrentPerson(person.id);
		} else {
			// Guest mode: addPerson routes to host; wait for sync to pick up the new person by name
			pendingName = name;
		}
		newName = '';
	}

	$effect(() => {
		if (pendingName) {
			const match = syncedBillStore.people.find((p) => p.name === pendingName);
			if (match) {
				identityStore.setCurrentPerson(match.id);
				pendingName = null;
			}
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') createAndSelect();
	}

	function changePerson() {
		identityStore.clear();
	}

	function toggleDone() {
		if (!currentPerson) return;
		syncedBillStore.setPersonDone(currentPerson.id, !currentPerson.done);
	}
</script>

{#if currentPerson}
	<!-- Identity set — compact display -->
	<div class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
		<div class="flex min-w-0 items-center gap-2">
			<span
				class="inline-block h-3 w-3 flex-shrink-0 rounded-full"
				style="background-color: {currentPerson.color};"
			></span>
			<span class="text-sm text-gray-600">You are</span>
			<span class="truncate font-semibold text-gray-800">{currentPerson.name}</span>
		</div>
		<div class="flex flex-shrink-0 items-center gap-2">
			<button
				onclick={toggleDone}
				class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors {currentPerson.done
					? 'bg-green-100 text-green-700 hover:bg-green-200'
					: 'bg-blue-500 text-white hover:bg-blue-600'}"
			>
				{#if currentPerson.done}
					<span>&#10003;</span> Done selecting
				{:else}
					I'm done selecting
				{/if}
			</button>
			<button
				onclick={changePerson}
				class="rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
			>
				Change
			</button>
		</div>
	</div>
{:else}
	<!-- Identity not set — picker -->
	<div class="rounded-lg border-2 border-blue-200 bg-blue-50 p-4 shadow-sm">
		<h2 class="mb-3 text-lg font-semibold text-gray-800">Who are you?</h2>

		{#if syncedBillStore.people.length > 0}
			<p class="mb-2 text-sm text-gray-600">Select yourself:</p>
			<div class="mb-3 flex flex-wrap gap-2">
				{#each syncedBillStore.people as person (person.id)}
					<button
						onclick={() => selectPerson(person.id)}
						class="rounded-full border-2 px-4 py-1.5 text-sm font-medium transition-all hover:scale-105"
						style="border-color: {person.color}; background-color: {person.color}40;"
					>
						{person.name}
					</button>
				{/each}
			</div>
			<div class="flex items-center gap-2">
				<div class="h-px flex-1 bg-blue-200"></div>
				<span class="text-xs text-gray-400">or create new</span>
				<div class="h-px flex-1 bg-blue-200"></div>
			</div>
		{/if}

		<div class="mt-3 flex gap-2">
			<input
				bind:this={nameInputElement}
				bind:value={newName}
				type="text"
				placeholder="Enter your name..."
				class="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 {isDuplicateName
					? 'border-red-400 focus:border-red-500 focus:ring-red-500'
					: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
				onkeydown={handleKeydown}
			/>
			<button
				onclick={createAndSelect}
				disabled={!newName.trim() || isDuplicateName}
				class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				Join
			</button>
		</div>
		{#if isDuplicateName}
			<p class="mt-2 text-xs text-red-600">
				Name already taken. Select existing person above or pick different name.
			</p>
		{/if}
	</div>
{/if}
