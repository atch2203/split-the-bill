import type { ReceiptItem } from '$lib/types';
import { classifyLine, type ReceiptLine, type SummaryField } from './receiptLines';

interface PendingItem {
	name: string;
	quantity: number;
	unitPrice: number | null;
	lineTotal: number | null;
	/** Add-on prices for the whole line, spread over the quantity when built. */
	addOns: number;
	/** Started by a line with a quantity ("1 Vegetable & Pork Spicy"). */
	hasQty: boolean;
}

export interface ParseResult {
	items: ReceiptItem[];
	taxAmount: number | null;
	subtotal: number | null;
	total: number | null;
	tipAmount: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Generate unique ID
function generateId(): string {
	return Math.random().toString(36).substring(2, 9);
}

// Build a ReceiptItem from a completed PendingItem, or null if price is missing
function buildItem(pending: PendingItem): ReceiptItem | null {
	let price: number | null = null;
	if (pending.unitPrice !== null) {
		price = pending.unitPrice;
	} else if (pending.lineTotal !== null) {
		price = Math.round((pending.lineTotal / pending.quantity) * 100) / 100;
	}
	if (price === null && pending.addOns > 0) {
		// "Pineapple Fried Rice" / "-Chicken  11.45": the add-on line carries the price.
		price = round2(pending.addOns / pending.quantity);
	} else if (price !== null) {
		price = round2(price + pending.addOns / pending.quantity);
	}
	if (price === null || price <= 0) return null;
	return {
		id: generateId(),
		name: pending.name,
		price,
		quantity: pending.quantity,
		assignedTo: []
	};
}

/**
 * Parses receipt text into items plus tax/subtotal/total/tip. Each line is
 * classified on its own (`classifyLine`), then lines are combined: a name
 * followed by a price (or "N @ price") becomes one item, a bare quantity
 * attaches to the item next to it, and a summary label takes its value from
 * the next line.
 */
/** A bare name followed by one of these starts a new item instead of being an option. */
function nextCarriesPrice(next: ReceiptLine | undefined): boolean {
	return (
		next?.kind === 'price' ||
		next?.kind === 'qtyUnit' ||
		(next?.kind === 'modifier' && next.price !== null)
	);
}

export function parseReceiptText(text: string): ParseResult {
	// Blank lines never separate a label from its value or a name from its price.
	const lines = text
		.split('\n')
		.filter((l) => l.trim())
		.map(classifyLine);
	const items: ReceiptItem[] = [];
	const summary: Record<SummaryField, number | null> = { tax: null, subtotal: null, total: null, tip: null };
	let pending: PendingItem | null = null;
	let qtyStash: number | null = null;
	// Receipts that print a quantity on each item ("1 Pad Thai  18.95") put
	// options on the bare lines under it ("Chicken", "Medium").
	const qtyStyle =
		lines.filter((l) => (l.kind === 'item' || l.kind === 'name') && l.hasQty).length +
			lines.filter((l) => l.kind === 'qtyPrice').length >=
		3;

	function flushPending() {
		if (pending !== null) {
			const item = buildItem(pending);
			if (item) items.push(item);
			pending = null;
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const next = lines[i + 1];
		// Everything after the total is payment details, tip suggestions, ads.
		if (summary.total !== null && line.kind !== 'summary') continue;
		switch (line.kind) {
			case 'summary': {
				// Only the first occurrence of each field counts.
				if (summary[line.field] !== null) break;
				let value = line.value;
				if (value === null && next?.kind === 'price') {
					value = next.price; // "Sales Tax" / "1.04"
					i++;
				}
				if (value !== null) {
					summary[line.field] = value;
					flushPending();
				}
				break;
			}
			case 'item':
				if (pending !== null && pending.hasQty && !line.hasQty && pending.lineTotal === null && pending.unitPrice === null) {
					// "1 Vegetable & Pork Spicy" / "Wontons  $15.00": a wrapped name.
					pending.name += ' ' + line.name;
					pending.lineTotal = line.price * line.quantity;
					flushPending();
					break;
				}
				flushPending();
				items.push({
					id: generateId(),
					name: line.name,
					price: line.price,
					quantity: line.quantity,
					assignedTo: []
				});
				break;
			case 'qtyPrice':
				// "1 M5   16.95" then the name on the next line.
				flushPending();
				if (next?.kind === 'name') {
					items.push({
						id: generateId(),
						name: next.name,
						price: round2(line.price / line.quantity),
						quantity: line.quantity,
						assignedTo: []
					});
					i++;
				}
				break;
			case 'qtyUnit':
				// "3 @ 0.25" under a name.
				if (pending !== null) {
					pending.quantity = line.quantity;
					pending.unitPrice = line.unitPrice;
				}
				break;
			case 'qty':
				// A bare quantity before a name starts that item; otherwise it belongs
				// to the item above (or waits for the next one).
				if (next?.kind === 'name') {
					flushPending();
					qtyStash = line.quantity;
				} else if (pending !== null) {
					pending.quantity = line.quantity;
				} else {
					qtyStash = line.quantity;
				}
				break;
			case 'price':
				// Completes the pending item (also "12354384  253.24": code + price).
				if (pending !== null) {
					pending.lineTotal = line.price;
					flushPending();
				}
				break;
			case 'name':
				if (
					qtyStyle &&
					pending === null &&
					qtyStash === null &&
					!line.hasQty &&
					items.length > 0 &&
					!nextCarriesPrice(next)
				) {
					// "Chicken" / "Medium" under "1 Pad Thai  18.95": an option of that item.
					items[items.length - 1].name += ' ' + line.name;
					break;
				}
				if (
					qtyStash !== null ||
					pending === null ||
					line.hasQty ||
					pending.unitPrice !== null ||
					pending.lineTotal !== null
				) {
					// A stashed quantity signals a new item, or there's no pending one.
					flushPending();
					pending = {
						name: line.name,
						quantity: qtyStash ?? line.quantity,
						unitPrice: null,
						lineTotal: null,
						addOns: 0,
						hasQty: line.hasQty || qtyStash !== null
					};
					qtyStash = null;
				} else {
					// Pending item has no price yet: this continues its name.
					pending.name += ' ' + line.name;
				}
				break;
			case 'modifier': {
				// Folds into the item it belongs to: the one still being read, else
				// the last finished one. Its price is for the whole line.
				const suffix = ` ${line.sign} ${line.name}`;
				const last = items.at(-1);
				if (pending !== null) {
					pending.name += suffix;
					pending.addOns += line.price ?? 0;
				} else if (last) {
					last.name += suffix;
					last.price = round2(last.price + (line.price ?? 0) / last.quantity);
				} else if (line.price !== null) {
					items.push({ id: generateId(), name: line.name, price: line.price, quantity: 1, assignedTo: [] });
				}
				break;
			}
			case 'other':
				// Noise between a name and its price leaves the pending item intact.
				break;
		}
	}
	flushPending();

	return {
		items,
		taxAmount: summary.tax,
		subtotal: summary.subtotal,
		total: summary.total,
		tipAmount: summary.tip
	};
}

// Utility to format price for display
export function formatPrice(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

// Utility to parse price from string input
export function parsePrice(input: string): number {
	const cleaned = input.replace(/[$,\s]/g, '');
	const parsed = parseFloat(cleaned);
	return isNaN(parsed) ? 0 : Math.max(0, parsed);
}
