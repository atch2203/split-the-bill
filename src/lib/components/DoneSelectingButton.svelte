<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';

	const currentPerson = $derived(
		identityStore.currentPersonId
			? syncedBillStore.people.find((p) => p.id === identityStore.currentPersonId)
			: null
	);

	function toggleDone() {
		if (!currentPerson) return;
		syncedBillStore.setPersonDone(currentPerson.id, !currentPerson.done);
	}
</script>

{#if currentPerson}
	<button
		onclick={toggleDone}
		class="flex w-full items-center justify-center gap-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors {currentPerson.done
			? 'bg-green-100 text-green-700 hover:bg-green-200'
			: 'bg-blue-500 text-white hover:bg-blue-600'}"
	>
		{#if currentPerson.done}
			<span>&#10003;</span> Done selecting
		{:else}
			I'm done selecting
		{/if}
	</button>
{/if}
