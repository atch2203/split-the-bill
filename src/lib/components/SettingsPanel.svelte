<script lang="ts">
	import { billStore } from '$lib/stores/billStore.svelte';
	import { parsePrice, formatPrice } from '$lib/utils/receiptParser';
	import { untrack } from 'svelte';

	let taxInput = $state(billStore.settings.taxAmount > 0 ? billStore.settings.taxAmount.toFixed(2) : '');
	let tipPercentInput = $state(billStore.settings.tipPercent.toString());
	let tipAmountInput = $state('');
	let cashBackPercentInput = $state(billStore.settings.cashBackPercent.toString());

	let tipMode = $state<'percent' | 'dollar'>('percent');

	// Track previous store values to detect external changes
	let prevTaxAmount = $state(billStore.settings.taxAmount);
	let prevTipAmount = $state(billStore.settings.tipAmount);
	let prevTipPercent = $state(billStore.settings.tipPercent);
	let prevCashBackPercent = $state(billStore.settings.cashBackPercent);

	// Sync inputs when store is updated externally (e.g., from receipt scanner or multiplayer)
	$effect(() => {
		const storeTax = billStore.settings.taxAmount;
		const storeTipAmount = billStore.settings.tipAmount;
		const storeTipPercent = billStore.settings.tipPercent;
		const storeCashBack = billStore.settings.cashBackPercent;

		// Only update inputs if store changed externally (not from our own updates)
		if (storeTax !== prevTaxAmount) {
			taxInput = storeTax > 0 ? storeTax.toFixed(2) : '';
			prevTaxAmount = storeTax;
		}
		if (storeTipAmount !== prevTipAmount) {
			if (storeTipAmount > 0) {
				tipAmountInput = storeTipAmount.toFixed(2);
				tipMode = 'dollar';
			}
			prevTipAmount = storeTipAmount;
		}
		if (storeTipPercent !== prevTipPercent) {
			tipPercentInput = storeTipPercent.toString();
			prevTipPercent = storeTipPercent;
		}
		if (storeCashBack !== prevCashBackPercent) {
			cashBackPercentInput = storeCashBack.toString();
			prevCashBackPercent = storeCashBack;
		}
	});

	function updateTax() {
		const value = parsePrice(taxInput);
		prevTaxAmount = value;
		billStore.updateSettings({ taxAmount: value });
	}

	function updateTipPercent() {
		const percent = Math.max(0, Math.min(100, parseFloat(tipPercentInput) || 0));
		prevTipPercent = percent;
		prevTipAmount = 0;
		billStore.updateSettings({ tipPercent: percent, tipAmount: 0 });
	}

	function updateTipAmount() {
		const amount = parsePrice(tipAmountInput);
		prevTipAmount = amount;
		billStore.updateSettings({ tipAmount: amount });
	}

	function updateCashBackPercent() {
		const percent = Math.max(0, Math.min(100, parseFloat(cashBackPercentInput) || 0));
		prevCashBackPercent = percent;
		billStore.updateSettings({ cashBackPercent: percent });
	}

	function toggleTipMode() {
		if (tipMode === 'percent') {
			tipMode = 'dollar';
			// Set dollar amount based on current effective tip
			tipAmountInput = billStore.effectiveTipAmount.toFixed(2);
			updateTipAmount();
		} else {
			tipMode = 'percent';
			// Clear the fixed tip amount, revert to percentage
			prevTipAmount = 0;
			billStore.updateSettings({ tipAmount: 0 });
		}
	}

	// Preset tip percentages
	const tipPresets = [15, 18, 20, 25];
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<h2 class="mb-3 text-lg font-semibold text-gray-800">Settings</h2>

	<div class="space-y-4">
		<!-- Tax -->
		<div>
			<label class="mb-1 block text-sm font-medium text-gray-700">Tax Amount</label>
			<div class="relative">
				<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
				<input
					bind:value={taxInput}
					type="text"
					inputmode="decimal"
					placeholder="0.00"
					class="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					onblur={updateTax}
					onkeydown={(e) => e.key === 'Enter' && updateTax()}
				/>
			</div>
		</div>

		<!-- Tip -->
		<div>
			<div class="mb-1 flex items-center justify-between">
				<label class="text-sm font-medium text-gray-700">Tip</label>
				<!-- Mode Toggle Button -->
				<button
					onclick={toggleTipMode}
					class="flex rounded-md border border-gray-300 text-xs font-medium"
				>
					<span
						class="rounded-l-md px-2 py-1 transition-colors {tipMode === 'percent'
							? 'bg-blue-500 text-white'
							: 'bg-white text-gray-600 hover:bg-gray-50'}"
					>
						%
					</span>
					<span
						class="rounded-r-md border-l border-gray-300 px-2 py-1 transition-colors {tipMode === 'dollar'
							? 'bg-blue-500 text-white'
							: 'bg-white text-gray-600 hover:bg-gray-50'}"
					>
						$
					</span>
				</button>
			</div>

			{#if tipMode === 'percent'}
				<!-- Tip Presets -->
				<div class="mb-2 flex gap-2">
					{#each tipPresets as percent}
						<button
							onclick={() => {
								tipPercentInput = percent.toString();
								updateTipPercent();
							}}
							class="flex-1 rounded-lg border py-1.5 text-sm transition-colors {billStore.settings.tipPercent === percent && billStore.settings.tipAmount === 0
								? 'border-blue-500 bg-blue-50 text-blue-700'
								: 'border-gray-300 text-gray-600 hover:bg-gray-50'}"
						>
							{percent}%
						</button>
					{/each}
				</div>

				<!-- Tip Percent Input -->
				<div class="relative">
					<input
						bind:value={tipPercentInput}
						type="text"
						inputmode="decimal"
						placeholder="18"
						class="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-7 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						onblur={updateTipPercent}
						onkeydown={(e) => e.key === 'Enter' && updateTipPercent()}
					/>
					<span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
				</div>
			{:else}
				<!-- Tip Amount Input -->
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						bind:value={tipAmountInput}
						type="text"
						inputmode="decimal"
						placeholder="0.00"
						class="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						onblur={updateTipAmount}
						onkeydown={(e) => e.key === 'Enter' && updateTipAmount()}
					/>
				</div>
			{/if}

			<p class="mt-1 text-xs text-gray-500">
				Tip: {formatPrice(billStore.effectiveTipAmount)}
			</p>
		</div>

		<!-- Cash Back -->
		<div>
			<label class="mb-1 block text-sm font-medium text-gray-700">Cash Back (subtract from total)</label>
			<div class="relative">
				<input
					bind:value={cashBackPercentInput}
					type="text"
					inputmode="decimal"
					placeholder="0"
					class="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-7 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					onblur={updateCashBackPercent}
					onkeydown={(e) => e.key === 'Enter' && updateCashBackPercent()}
				/>
				<span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
			</div>
			{#if billStore.effectiveCashBack > 0}
				<p class="mt-1 text-xs text-gray-500">
					Cash back: {formatPrice(billStore.effectiveCashBack)}
				</p>
			{/if}
		</div>
	</div>
</div>
