<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';

	const showGuestDemo = $derived(peerStore.isGuest && identityStore.tourActive);
	const DEMO_COLOR = '#818cf8';
	const DEMO_AMOUNT = 12.5;

	function getPersonColor(personId: string): string {
		const person = syncedBillStore.people.find((p) => p.id === personId);
		return person?.color || '#gray';
	}

	function getItemShare(
		item: { price: number; quantity: number; assignedTo: string[]; isMultipart?: boolean; portions?: Record<string, number> },
		personId: string
	): number {
		const itemTotal = item.price * item.quantity;
		if (item.isMultipart && item.portions) {
			const totalPortions = item.assignedTo.reduce(
				(sum, id) => sum + (item.portions?.[id] ?? 1),
				0
			);
			if (totalPortions <= 0) return 0;
			return itemTotal * ((item.portions[personId] ?? 1) / totalPortions);
		}
		return itemTotal / item.assignedTo.length;
	}

	const myItems = $derived.by(() => {
		const id = identityStore.currentPersonId;
		if (!id) return [];
		const out: { name: string; quantity: number; share: number; portion?: number; totalPortions?: number }[] = [];
		for (const item of syncedBillStore.items) {
			if (!item.assignedTo.includes(id)) continue;
			const share = getItemShare(item, id);
			const entry: { name: string; quantity: number; share: number; portion?: number; totalPortions?: number } = {
				name: item.name,
				quantity: item.quantity,
				share
			};
			if (item.isMultipart && item.portions) {
				entry.portion = item.portions[id] ?? 1;
				entry.totalPortions = item.assignedTo.reduce((s, pid) => s + (item.portions?.[pid] ?? 1), 0);
			}
			out.push(entry);
		}
		return out;
	});

	const billTotal = $derived(
		syncedBillStore.subtotal + syncedBillStore.settings.taxAmount + syncedBillStore.effectiveTipAmount
	);
	const sumOfShares = $derived(
		syncedBillStore.personTotals.reduce((sum, t) => sum + t.grandTotal, 0)
	);
	const roundingDifference = $derived(Math.abs(billTotal - syncedBillStore.effectiveCashBack - sumOfShares));
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<div class="mb-3">
		<h2 class="text-lg font-semibold text-gray-800">Summary</h2>
		{#if syncedBillStore.settings.title}
			<p class="text-sm text-gray-500">{syncedBillStore.settings.title}</p>
		{/if}
	</div>

	{#if syncedBillStore.items.length > 0 || showGuestDemo}
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

		{#if syncedBillStore.people.length > 0 || showGuestDemo}
			<!-- Per-person breakdown -->
			<div class="mt-4 space-y-3">
				{#if showGuestDemo}
					<!-- Static demo "you" card so guests on the tour can see the self-highlight UI -->
					<div
						class="rounded-lg border-2 p-3"
						style="border-color: {DEMO_COLOR}; background-color: {DEMO_COLOR}26; box-shadow: 0 0 0 3px {DEMO_COLOR};"
					>
						<div class="mb-2 flex items-center justify-between">
							<span class="flex items-center gap-2 font-semibold" style="color: {DEMO_COLOR};">
								You (sample)
								<span
									class="rounded-full px-2 py-0.5 text-xs font-bold text-white"
									style="background-color: {DEMO_COLOR};"
								>You</span>
							</span>
							<span class="text-xl font-bold text-gray-800">{formatPrice(DEMO_AMOUNT)}</span>
						</div>
						<div class="space-y-1 text-sm text-gray-600">
							<div class="flex justify-between">
								<span>Items</span>
								<span>{formatPrice(DEMO_AMOUNT)}</span>
							</div>
						</div>
						<div class="mt-3 border-t pt-2" style="border-color: {DEMO_COLOR}66;">
							<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Your items</p>
							<ul class="space-y-0.5 text-sm text-gray-700">
								<li class="flex justify-between gap-2">
									<span class="truncate">Sample burger</span>
									<span class="flex-shrink-0 tabular-nums">{formatPrice(DEMO_AMOUNT)}</span>
								</li>
							</ul>
						</div>
					</div>
				{/if}
				{#each syncedBillStore.personTotals as total (total.personId)}
					{@const isMe = total.personId === identityStore.currentPersonId}
					{@const color = getPersonColor(total.personId)}
					<div
						class="rounded-lg border-2 p-3"
						style="border-color: {color}; {isMe
							? `background-color: ${color}26; box-shadow: 0 0 0 3px ${color};`
							: ''}"
					>
						<div class="mb-2 flex items-center justify-between">
							<span
								class="flex items-center gap-2 font-semibold"
								style="color: {color};"
							>
								{total.personName}
								{#if isMe}
									<span
										class="rounded-full px-2 py-0.5 text-xs font-bold text-white"
										style="background-color: {color};"
									>You</span>
								{/if}
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

						{#if isMe && myItems.length > 0}
							<div class="mt-3 border-t pt-2" style="border-color: {color}66;">
								<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Your items</p>
								<ul class="space-y-0.5 text-sm text-gray-700">
									{#each myItems as it}
										<li class="flex justify-between gap-2">
											<span class="truncate">
												{it.name}{#if it.quantity > 1} x{it.quantity}{/if}{#if it.portion !== undefined && it.totalPortions !== undefined && it.totalPortions > 0}
													<span class="text-xs text-gray-500"> ({it.portion}/{it.totalPortions})</span>
												{/if}
											</span>
											<span class="flex-shrink-0 tabular-nums">{formatPrice(it.share)}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
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
