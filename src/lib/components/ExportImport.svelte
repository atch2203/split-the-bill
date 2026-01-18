<script lang="ts">
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { formatPrice } from '$lib/utils/receiptParser';

	let exportMessage = $state<string | null>(null);
	let isError = $state(false);
	let dataText = $state('');
	let showDataField = $state(false);

	function clearMessages() {
		setTimeout(() => {
			exportMessage = null;
		}, 3000);
	}

	// Get items assigned to a person
	function getPersonItems(personId: string): { name: string; quantity: number; share: number }[] {
		const items: { name: string; quantity: number; share: number }[] = [];
		for (const item of syncedBillStore.items) {
			if (item.assignedTo.includes(personId)) {
				const shareAmount = (item.price * item.quantity) / item.assignedTo.length;
				items.push({
					name: item.name,
					quantity: item.quantity,
					share: shareAmount
				});
			}
		}
		return items;
	}

	// Generate text summary for clipboard
	function generateTextSummary(): string {
		const lines: string[] = [];

		lines.push('=== Split the Bill Summary ===');
		lines.push('');

		// Totals
		const billTotal = syncedBillStore.subtotal + syncedBillStore.settings.taxAmount + syncedBillStore.effectiveTipAmount;
		lines.push(`Subtotal: ${formatPrice(syncedBillStore.subtotal)}`);
		if (syncedBillStore.settings.taxAmount > 0) {
			lines.push(`Tax: ${formatPrice(syncedBillStore.settings.taxAmount)}`);
		}
		if (syncedBillStore.effectiveTipAmount > 0) {
			lines.push(`Tip: ${formatPrice(syncedBillStore.effectiveTipAmount)}`);
		}
		lines.push(`Total: ${formatPrice(billTotal)}`);
		lines.push('');

		// Per-person breakdown with items
		if (syncedBillStore.personTotals.length > 0) {
			lines.push('Each Person Owes:');
			for (const total of syncedBillStore.personTotals) {
				const personItems = getPersonItems(total.personId);
				const itemNames = personItems.map(item => {
					const qtyStr = item.quantity > 1 ? ` x${item.quantity}` : '';
					return `${item.name}${qtyStr}`;
				}).join(', ');
				const itemsStr = itemNames ? ` (${itemNames})` : '';
				lines.push(`  ${total.personName}: ${formatPrice(total.grandTotal)}${itemsStr}`);
			}
		}

		return lines.join('\n');
	}

	// Generate JSON for import/export
	function generateJsonExport(): string {
		const data = {
			version: 1,
			items: syncedBillStore.items,
			people: syncedBillStore.people,
			settings: syncedBillStore.settings
		};
		return JSON.stringify(data, null, 2);
	}

	async function exportToClipboard() {
		try {
			const text = generateTextSummary();
			await navigator.clipboard.writeText(text);
			exportMessage = 'Summary copied to clipboard!';
			isError = false;
			clearMessages();
		} catch {
			exportMessage = 'Failed to copy to clipboard';
			isError = true;
			clearMessages();
		}
	}

	function exportDataToField() {
		dataText = generateJsonExport();
		showDataField = true;
		exportMessage = 'Data exported to field below';
		isError = false;
		clearMessages();
	}

	function importDataFromField() {
		try {
			if (!dataText.trim()) {
				throw new Error('No data to import');
			}

			const data = JSON.parse(dataText);

			if (data.version !== 1 || !data.items || !data.people || !data.settings) {
				throw new Error('Invalid data format');
			}

			// Import the data
			billStore.setItems(data.items);
			// Clear existing people and add new ones
			while (billStore.people.length > 0) {
				billStore.removePerson(billStore.people[0].id);
			}
			for (const person of data.people) {
				billStore.addPerson(person.name);
			}
			// Update assignments to use new person IDs
			const personIdMap = new Map<string, string>();
			data.people.forEach((oldPerson: { id: string; name: string }, index: number) => {
				personIdMap.set(oldPerson.id, billStore.people[index].id);
			});
			for (const item of billStore.items) {
				item.assignedTo = item.assignedTo
					.map((oldId: string) => personIdMap.get(oldId))
					.filter((id): id is string => id !== undefined);
			}
			billStore.updateSettings(data.settings);

			exportMessage = 'Data imported successfully!';
			isError = false;
			dataText = '';
			showDataField = false;
			clearMessages();
		} catch {
			exportMessage = 'Failed to import - invalid data format';
			isError = true;
			clearMessages();
		}
	}

	async function exportToPdf() {
		// Create a printable HTML document
		const billTotal = syncedBillStore.subtotal + syncedBillStore.settings.taxAmount + syncedBillStore.effectiveTipAmount;

		// Create a map of person IDs to their data for quick lookup
		const peopleMap = new Map(syncedBillStore.people.map(p => [p.id, p]));

		let itemsHtml = '';
		for (const item of syncedBillStore.items) {
			const total = item.price * item.quantity;
			const qtyStr = item.quantity > 1 ? ` x${item.quantity}` : '';
			const assignedBadges = item.assignedTo
				.map(id => {
					const person = peopleMap.get(id);
					if (!person) return '';
					const bgColor = person.color || '#888';
					return '<span class="badge" style="background-color: ' + bgColor + ';">' + person.name + '</span>';
				})
				.filter(Boolean)
				.join(' ');
			const assignedStr = assignedBadges || '<span style="color: #999; font-size: 13px; margin-left: 6px;">(unassigned)</span>';
			itemsHtml += '<tr><td>' + item.name + qtyStr + ' ' + assignedStr + '</td><td style="text-align: right;">' + formatPrice(total) + '</td></tr>';
		}

		let personHtml = '';
		for (const total of syncedBillStore.personTotals) {
			personHtml += `
				<div style="border: 2px solid ${syncedBillStore.people.find(p => p.id === total.personId)?.color || '#ccc'}; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
					<div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 8px;">
						<span style="color: ${syncedBillStore.people.find(p => p.id === total.personId)?.color || '#333'};">${total.personName}</span>
						<span>${formatPrice(total.grandTotal)}</span>
					</div>
					<div style="font-size: 12px; color: #666;">
						<div style="display: flex; justify-content: space-between;"><span>Items</span><span>${formatPrice(total.itemsTotal)}</span></div>
						${total.taxShare > 0 ? `<div style="display: flex; justify-content: space-between;"><span>Tax</span><span>${formatPrice(total.taxShare)}</span></div>` : ''}
						${total.tipShare > 0 ? `<div style="display: flex; justify-content: space-between;"><span>Tip</span><span>${formatPrice(total.tipShare)}</span></div>` : ''}
						${total.cashBackShare > 0 ? `<div style="color: green; display: flex; justify-content: space-between;"><span>Cash Back</span><span>-${formatPrice(total.cashBackShare)}</span></div>` : ''}
					</div>
				</div>
			`;
		}

		const html = `
			<!DOCTYPE html>
			<html>
			<head>
				<title>Split the Bill Summary</title>
				<style>
					* { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
					h1 { font-size: 24px; margin-bottom: 20px; }
					h2 { font-size: 18px; margin-top: 24px; margin-bottom: 12px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
					table { width: 100%; border-collapse: collapse; }
					td { padding: 4px 0; }
					.totals { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; }
					.total-row { display: flex; justify-content: space-between; padding: 2px 0; }
					.grand-total { font-weight: bold; font-size: 18px; margin-top: 8px; padding-top: 8px; border-top: 2px solid #333; }
					.badge { color: white; padding: 2px 8px; border-radius: 12px; font-size: 13px; margin-left: 6px; display: inline-block; }
				</style>
			</head>
			<body>
				<h1>Split the Bill Summary</h1>

				${syncedBillStore.items.length > 0 ? `
					<h2>Items</h2>
					<table>
						${itemsHtml}
					</table>
				` : ''}

				<div class="totals">
					<div class="total-row"><span>Subtotal</span><span>${formatPrice(syncedBillStore.subtotal)}</span></div>
					${syncedBillStore.settings.taxAmount > 0 ? `<div class="total-row"><span>Tax</span><span>${formatPrice(syncedBillStore.settings.taxAmount)}</span></div>` : ''}
					${syncedBillStore.effectiveTipAmount > 0 ? `<div class="total-row"><span>Tip</span><span>${formatPrice(syncedBillStore.effectiveTipAmount)}</span></div>` : ''}
					<div class="total-row grand-total"><span>Total</span><span>${formatPrice(billTotal)}</span></div>
				</div>

				${syncedBillStore.personTotals.length > 0 ? `
					<h2>Each Person Owes</h2>
					${personHtml}
				` : ''}
			</body>
			</html>
		`;

		// Open in new window for screenshot
		const newWindow = window.open('', '_blank');
		if (newWindow) {
			newWindow.document.write(html);
			newWindow.document.close();
		} else {
			exportMessage = 'Please allow popups to view summary';
			isError = true;
			clearMessages();
		}
	}
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<h2 class="mb-3 text-lg font-semibold text-gray-800">Export / Import</h2>

	<div class="flex flex-wrap gap-2">
		<button
			onclick={exportToPdf}
			class="flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
			</svg>
			View for Screenshot/PDF
		</button>

		<button
			onclick={exportToClipboard}
			class="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
			</svg>
			Copy Summary
		</button>

		<button
			onclick={() => (showDataField = !showDataField)}
			class="flex items-center gap-1.5 rounded-lg bg-gray-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
			</svg>
			{peerStore.isGuest ? 'Export Data' : 'Import / Export Data'}
		</button>
	</div>

	{#if showDataField}
		<div class="mt-3 space-y-2">
			<textarea
				bind:value={dataText}
				placeholder="Paste exported data here to import, or click Export to fill this field..."
				class="h-32 w-full resize-none rounded-lg border border-gray-300 p-3 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			></textarea>
			<div class="flex gap-2">
				<button
					onclick={exportDataToField}
					class="flex items-center gap-1.5 rounded-lg bg-gray-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-700"
				>
					Export Data
				</button>
				{#if !peerStore.isGuest}
					<button
						onclick={importDataFromField}
						class="flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-600"
					>
						Import Data
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if exportMessage}
		<p class="mt-2 text-sm {isError ? 'text-red-600' : 'text-green-600'}">{exportMessage}</p>
	{/if}
</div>
