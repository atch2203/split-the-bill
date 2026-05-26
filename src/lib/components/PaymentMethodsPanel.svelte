<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';

	let newLabel = $state('');
	let newValue = $state('');

	const myTotal = $derived.by(() => {
		if (!identityStore.currentPersonId) return null;
		const t = syncedBillStore.personTotals.find(
			(t) => t.personId === identityStore.currentPersonId
		);
		return t ? t.grandTotal : null;
	});

	function buildPayUrl(label: string, value: string, amount: number): string | null {
		const l = label.toLowerCase().trim();
		const v = value.trim();
		const amt = amount.toFixed(2);
		const titleText = (syncedBillStore.settings.title ?? '').trim();
		const note = encodeURIComponent(titleText || 'Bill split');
		if (l.includes('venmo')) {
			const user = encodeURIComponent(v.replace(/^@/, ''));
			if (!user) return null;
			return `https://venmo.com/${user}?txn=pay&amount=${amt}&note=${note}`;
		}
		if (l.includes('cash app') || l.includes('cashapp') || l === 'cash') {
			const tag = encodeURIComponent(v.replace(/^\$/, ''));
			if (!tag) return null;
			return `https://cash.app/$${tag}/${amt}`;
		}
		if (l.includes('paypal')) {
			const user = encodeURIComponent(v.replace(/^@/, ''));
			if (!user) return null;
			return `https://www.paypal.com/paypalme/${user}/${amt}`;
		}
		return null;
	}

	function handleAdd() {
		const label = newLabel.trim();
		const value = newValue.trim();
		if (!label && !value) return;
		syncedBillStore.addPaymentMethod(label, value);
		newLabel = '';
		newValue = '';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') handleAdd();
	}

	// During tour, guests see a demo entry so they can preview the Pay button experience
	// even when the host hasn't added any methods yet.
	const showGuestDemo = $derived(peerStore.isGuest && identityStore.tourActive);
	const demoMyTotal = $derived(myTotal !== null && myTotal > 0 ? myTotal : 12.5);
</script>

{#if !peerStore.isGuest || syncedBillStore.paymentMethods.length > 0 || identityStore.tourActive}
	<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
		<h2 class="mb-3 text-lg font-semibold text-gray-800">Payment Methods</h2>

		{#if showGuestDemo}
			<ul class="mb-3 space-y-1.5">
				<li class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
					<span class="font-semibold text-gray-700">Venmo:</span>
					<span class="break-all text-gray-700">@sample-handle</span>
					<a
						href={`https://venmo.com/sample-handle?txn=pay&amount=${demoMyTotal.toFixed(2)}&note=Bill+split`}
						target="_blank"
						rel="noopener noreferrer"
						class="ml-auto rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-green-600"
					>
						Pay {formatPrice(demoMyTotal)}
					</a>
				</li>
			</ul>
		{/if}

		{#if syncedBillStore.paymentMethods.length > 0}
			<ul class="mb-3 space-y-1.5">
				{#each syncedBillStore.paymentMethods as pm (pm.id)}
					<li class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
						{#if !peerStore.isGuest}
							<input
								value={pm.label}
								oninput={(e) =>
									syncedBillStore.updatePaymentMethod(pm.id, {
										label: (e.target as HTMLInputElement).value
									})}
								type="text"
								placeholder="Label (e.g., Venmo)"
								class="w-28 min-w-0 flex-shrink rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
							/>
							<input
								value={pm.value}
								oninput={(e) =>
									syncedBillStore.updatePaymentMethod(pm.id, {
										value: (e.target as HTMLInputElement).value
									})}
								type="text"
								placeholder="Handle / number"
								class="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
							/>
							<button
								onclick={() => syncedBillStore.removePaymentMethod(pm.id)}
								class="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600"
								title="Remove"
								aria-label="Remove payment method"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						{:else}
							<span class="font-semibold text-gray-700">{pm.label || 'Payment'}:</span>
							<span class="break-all text-gray-700">{pm.value}</span>
							{#if myTotal !== null && myTotal > 0}
								{@const url = buildPayUrl(pm.label, pm.value, myTotal)}
								{#if url}
									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										class="ml-auto rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-green-600"
									>
										Pay {formatPrice(myTotal)}
									</a>
								{/if}
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{:else if !peerStore.isGuest}
			<p class="mb-3 text-sm text-gray-500">
				Add ways guests can pay you (e.g., Zelle, Venmo, cash app).
			</p>
		{/if}

		{#if !peerStore.isGuest}
			<div class="flex flex-wrap gap-2">
				<input
					bind:value={newLabel}
					type="text"
					placeholder="Label (e.g., Zelle)"
					class="w-32 min-w-0 flex-shrink rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					onkeydown={handleKeydown}
				/>
				<input
					bind:value={newValue}
					type="text"
					placeholder="Handle / number"
					class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					onkeydown={handleKeydown}
				/>
				<button
					onclick={handleAdd}
					disabled={!newLabel.trim() && !newValue.trim()}
					class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
				>
					+ Add
				</button>
			</div>
		{/if}
	</div>
{/if}
