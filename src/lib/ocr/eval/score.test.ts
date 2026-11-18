import { describe, expect, it } from 'vitest';
import { scoreParse, type ExpectedReceipt } from './score';
import type { ParseResult } from '$lib/utils/receiptParser';

function got(items: [string, number][], over: Partial<ParseResult> = {}): ParseResult {
	return {
		items: items.map(([name, price], i) => ({
			id: String(i),
			name,
			price,
			quantity: 1,
			assignedTo: []
		})),
		taxAmount: null,
		subtotal: null,
		total: null,
		tipAmount: null,
		...over
	};
}

function expected(items: [string, number][], over: Partial<ExpectedReceipt> = {}): ExpectedReceipt {
	return {
		items: items.map(([name, price]) => ({ name, qty: 1, price })),
		tax: null,
		tip: null,
		subtotal: null,
		total: null,
		...over
	};
}

describe('scoreParse', () => {
	it('counts only items with exact price', () => {
		const s = scoreParse(
			expected([['Burger', 12.99], ['Fries', 3], ['Soda', 2.5]]),
			got([['Burger', 12.89], ['Fries', 3], ['Soda', 2.5]])
		);
		expect(s).toMatchObject({ itemsExpected: 3, itemsMatched: 2 });
	});

	it('matches fuzzy names at same price', () => {
		const s = scoreParse(expected([['Burger', 9]]), got([['BURGR', 9]]));
		expect(s.itemsMatched).toBe(1);
	});

	it('does not match dissimilar names', () => {
		const s = scoreParse(expected([['Burger', 9]]), got([['Salad', 9]]));
		expect(s.itemsMatched).toBe(0);
	});

	it('matches each expected item at most once', () => {
		const s = scoreParse(expected([['Fries', 3]]), got([['Fries', 3], ['Fries', 3]]));
		expect(s.itemsMatched).toBe(1);
	});

	it('scores tax and total exactness', () => {
		expect(scoreParse(expected([], { tax: 1.23 }), got([], { taxAmount: 1.23 })).taxExact).toBe(true);
		expect(scoreParse(expected([], { tax: 1.23 }), got([], { taxAmount: null })).taxExact).toBe(false);
		expect(scoreParse(expected([], { total: 5 }), got([], { total: 5 })).totalExact).toBe(true);
	});
});
