<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';

	let titleInput = $state(syncedBillStore.settings.title ?? '');
	let prevStoreTitle = syncedBillStore.settings.title ?? '';

	// Sync from store on external changes (e.g., peer sync, import)
	$effect(() => {
		const storeTitle = syncedBillStore.settings.title ?? '';
		if (storeTitle !== prevStoreTitle) {
			prevStoreTitle = storeTitle;
			titleInput = storeTitle;
		}
	});

	function commit() {
		const next = titleInput.trim();
		if (next === (syncedBillStore.settings.title ?? '')) return;
		prevStoreTitle = next;
		syncedBillStore.updateSettings({ title: next });
	}
</script>

{#if !peerStore.isGuest}
	<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
		<label for="bill-title" class="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Bill title</label>
		<input
			id="bill-title"
			bind:value={titleInput}
			type="text"
			placeholder="e.g., Dinner at Chipotle (Nov 30)"
			class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-semibold text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			onblur={commit}
			onkeydown={(e) => {
				if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
			}}
		/>
	</div>
{:else if syncedBillStore.settings.title}
	<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
		<p class="text-xs font-medium uppercase tracking-wide text-gray-500">Bill</p>
		<p class="text-base font-semibold text-gray-800">{syncedBillStore.settings.title}</p>
	</div>
{/if}
