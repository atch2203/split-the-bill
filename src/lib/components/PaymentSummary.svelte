<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';

	function getPersonColor(personId: string): string {
		const person = syncedBillStore.people.find((p) => p.id === personId);
		return person?.color || '#gray';
	}

	const billTotal = $derived(
		syncedBillStore.subtotal + syncedBillStore.settings.taxAmount + syncedBillStore.effectiveTipAmount
	);
	const sumOfShares = $derived(
		syncedBillStore.personTotals.reduce((sum, t) => sum + t.grandTotal, 0)
	);
	const roundingDifference = $derived(Math.abs(billTotal - syncedBillStore.effectiveCashBack - sumOfShares));
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<h2 class="mb-3 text-lg font-semibold text-gray-800">Summary</h2>

	{#if syncedBillStore.items.length > 0}
		<!-- Bill Total -->
		<div class="space-y-1 text-sm text-gray-600">
			<div class="flex justify-between">
				<span>Subtotal</span>
				<span>{formatPrice(syncedBillStore.subtotal)}</span>
			</div>
			{#if syncedBillStore.settings.taxAmount > 0}
				<div class="flex justify-between">
					<span>Tax</span>
					<span>{formatPrice(syncedBillStore.settings.taxAmount)}</span>
				</div>
			{/if}
			{#if syncedBillStore.effectiveTipAmount > 0}
				<div class="flex justify-between">
					<span>Tip</span>
					<span>{formatPrice(syncedBillStore.effectiveTipAmount)}</span>
				</div>
			{/if}
			<div class="flex justify-between border-t border-gray-200 pt-1 font-semibold text-gray-800">
				<span>Total</span>
				<span>{formatPrice(billTotal)}</span>
			</div>
		</div>

		{#if syncedBillStore.people.length > 0}
			<!-- Per-person breakdown -->
			<div class="mt-4 space-y-3">
				{#each syncedBillStore.personTotals as total (total.personId)}
					<div
						class="rounded-lg border-2 p-3"
						style="border-color: {getPersonColor(total.personId)};"
					>
						<div class="mb-2 flex items-center justify-between">
							<span
								class="font-semibold"
								style="color: {getPersonColor(total.personId)};"
							>
								{total.personName}
							</span>
							<span class="text-xl font-bold text-gray-800">
								{formatPrice(total.grandTotal)}
							</span>
						</div>

						<div class="space-y-1 text-sm text-gray-600">
							<div class="flex justify-between">
								<span>Items</span>
								<span>{formatPrice(total.itemsTotal)}</span>
							</div>
							{#if total.taxShare > 0}
								<div class="flex justify-between">
									<span>Tax</span>
									<span>{formatPrice(total.taxShare)}</span>
								</div>
							{/if}
							{#if total.tipShare > 0}
								<div class="flex justify-between">
									<span>Tip</span>
									<span>{formatPrice(total.tipShare)}</span>
								</div>
							{/if}
							{#if total.cashBackShare > 0}
								<div class="flex justify-between text-green-600">
									<span>Cash Back</span>
									<span>-{formatPrice(total.cashBackShare)}</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- Verification -->
			{#if roundingDifference > 0.01}
				<p class="mt-3 text-sm text-yellow-600">
					Note: Individual totals may differ by {formatPrice(roundingDifference)} due to rounding
				</p>
			{/if}
		{:else}
			<div class="mt-4 py-4 text-center text-gray-500">
				<p>Add people to see the payment breakdown</p>
			</div>
		{/if}
	{:else}
		<div class="py-8 text-center text-gray-500">
			<p>Add items to calculate payments</p>
		</div>
	{/if}
</div>
