import type { ParseResult } from '$lib/utils/receiptParser';
import { levenshtein } from '../text';

export interface ExpectedReceipt {
	items: { name: string; qty: number; price: number }[];
	tax: number | null;
	tip: number | null;
	subtotal: number | null;
	total: number | null;
}

export interface Score {
	itemsExpected: number;
	itemsMatched: number;
	taxExact: boolean;
	totalExact: boolean;
}

const PRICE_EPS = 0.005;
const MIN_SIMILARITY = 0.6;

function nameSimilarity(a: string, b: string): number {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	const max = Math.max(x.length, y.length);
	if (max === 0) return 1;
	return 1 - levenshtein(x, y) / max;
}

function amountExact(expected: number | null, got: number | null): boolean {
	if (expected === null || got === null) return false;
	return Math.abs(expected - got) < PRICE_EPS;
}

export function scoreParse(expected: ExpectedReceipt, got: ParseResult): Score {
	const candidates: { e: number; g: number; sim: number }[] = [];
	expected.items.forEach((ei, e) => {
		got.items.forEach((gi, g) => {
			if (Math.abs(ei.price - gi.price) >= PRICE_EPS) return;
			const sim = nameSimilarity(ei.name, gi.name);
			if (sim >= MIN_SIMILARITY) candidates.push({ e, g, sim });
		});
	});
	candidates.sort((a, b) => b.sim - a.sim);

	const usedE = new Set<number>();
	const usedG = new Set<number>();
	for (const c of candidates) {
		if (usedE.has(c.e) || usedG.has(c.g)) continue;
		usedE.add(c.e);
		usedG.add(c.g);
	}

	return {
		itemsExpected: expected.items.length,
		itemsMatched: usedE.size,
		taxExact: amountExact(expected.tax, got.taxAmount),
		totalExact: amountExact(expected.total, got.total)
	};
}
