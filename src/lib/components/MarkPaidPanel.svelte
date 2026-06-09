<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';

	const allPaid = $derived(
		syncedBillStore.people.length > 0 && syncedBillStore.people.every((p) => p.paid)
	);

	// Auto-mark the host as paid once they pick their identity. Track ids we've
	// already auto-marked so a later manual toggle-off isn't undone by this effect.
	const autoMarked = new Set<string>();
	$effect(() => {
		const id = identityStore.currentPersonId;
		if (!id || autoMarked.has(id)) return;
		const person = syncedBillStore.people.find((p) => p.id === id);
		if (!person) return;
		autoMarked.add(id);
		if (!person.paid) syncedBillStore.setPersonPaid(id, true);
	});
</script>

{#if syncedBillStore.personTotals.length > 0}
	<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
		<div class="mb-3 flex items-center gap-2">
			<h2 class="text-lg font-semibold text-gray-800">Mark paid</h2>
			{#if allPaid}
				<span
					class="flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-white"
				>
					🎉 Everyone's paid!
				</span>
			{/if}
		</div>
		<div class="space-y-2">
			{#each syncedBillStore.personTotals as total (total.personId)}
				{@const person = syncedBillStore.people.find((p) => p.id === total.personId)}
				<div class="flex items-center justify-between gap-2">
					<span class="flex min-w-0 items-center gap-2 font-medium" style="color: {person?.color};">
						<span
							class="inline-block h-3 w-3 flex-shrink-0 rounded-full"
							style="background-color: {person?.color};"
						></span>
						<span class="truncate">{total.personName}</span>
						<span class="flex-shrink-0 text-sm text-gray-500 tabular-nums">
							{formatPrice(total.grandTotal)}
						</span>
					</span>
					<button
						onclick={() => syncedBillStore.setPersonPaid(total.personId, !person?.paid)}
						class="flex flex-shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors {person?.paid
							? 'bg-green-500 text-white hover:bg-green-600'
							: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
						title={person?.paid ? 'Payment confirmed — click to undo' : 'Mark payment confirmed'}
					>
						{#if person?.paid}
							<span>&#10003;</span> Paid
						{:else}
							Mark paid
						{/if}
					</button>
				</div>
			{/each}
		</div>
	</div>
{/if}
