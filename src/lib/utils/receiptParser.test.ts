import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseReceiptText } from './receiptParser';

beforeAll(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

/** Items as plain [name, quantity, unit price] tuples, for compact assertions. */
const items = (text: string) =>
	parseReceiptText(text).items.map((i) => [i.name, i.quantity, i.price] as const);

describe('parseReceiptText: single-line items', () => {
	it('name and price separated by spaces or a dollar sign', () => {
		expect(items('Burger    12.99\nFries $4.50\nCOLA 2.00')).toEqual([
			['Burger', 1, 12.99],
			['Fries', 1, 4.5],
			['COLA', 1, 2]
		]);
	});

	it('repairs OCR-damaged prices', () => {
		expect(items('Burger    1299\nFries    4 50')).toEqual([
			['Burger', 1, 12.99],
			['Fries', 1, 4.5]
		]);
	});

	it('quantity before the name: price is the line total', () => {
		expect(items('2 Burger 25.98\n3x Taco 9.00')).toEqual([
			['Burger', 2, 12.99],
			['Taco', 3, 3]
		]);
	});

	it('quantity after the name', () => {
		expect(items('Taco x3 9.00\nSoda 2 @ 4.00')).toEqual([
			['Taco', 3, 3],
			['Soda', 2, 2]
		]);
	});
});

describe('parseReceiptText: multi-line items', () => {
	it('price on the next line', () => {
		expect(items('Grilled Chicken Sandwich\n$11.50')).toEqual([['Grilled Chicken Sandwich', 1, 11.5]]);
	});

	it('name over two lines, then price', () => {
		expect(items('Grilled Chicken\nSandwich\n11.50')).toEqual([['Grilled Chicken Sandwich', 1, 11.5]]);
	});

	it('N @ unit price line under the name', () => {
		expect(items('Bananas\n3 @ 0.25\n0.75')).toEqual([['Bananas', 3, 0.25]]);
	});

	it('bare quantity line before the name', () => {
		expect(items('2\nIced Tea\n6.00')).toEqual([['Iced Tea', 2, 3]]);
	});
});

describe('parseReceiptText: summary lines', () => {
	it('tax, subtotal, total and tip on one line', () => {
		const r = parseReceiptText('Burger 12.99\nSubtotal 12.99\nTax 1.04\nTip 2.00\nTotal 16.03');
		expect(r.items.map((i) => i.name)).toEqual(['Burger']);
		expect([r.subtotal, r.taxAmount, r.tipAmount, r.total]).toEqual([12.99, 1.04, 2, 16.03]);
	});

	it('label then value on the next line', () => {
		const r = parseReceiptText('Burger 12.99\nSales Tax\n1.04\nTotal\n14.03');
		expect(r.items.map((i) => i.name)).toEqual(['Burger']);
		expect([r.taxAmount, r.total]).toEqual([1.04, 14.03]);
	});

	it('blank lines between label and value, or name and price', () => {
		const r = parseReceiptText('Iced Tea\n\n3.00\nTax\n\n0.24');
		expect(r.items.map((i) => [i.name, i.price])).toEqual([['Iced Tea', 3]]);
		expect(r.taxAmount).toBe(0.24);
	});

	it('summary lines are not items', () => {
		expect(items('Burger 12.99\nSubtotal 12.99\nTotal 12.99\nVisa 12.99\nChange 0.00')).toEqual([
			['Burger', 1, 12.99]
		]);
	});
});

describe('parseReceiptText: noise', () => {
	it('skips header, address, dates and footer', () => {
		const text = [
			'TACO PALACE',
			'123 Main Street',
			'Springfield, IL 62704',
			'(217) 555-0199',
			'11/18/2026 7:42 PM',
			'Server: Dana',
			'Burger 12.99',
			'Thank you!'
		].join('\n');
		expect(items(text)).toEqual([['Burger', 1, 12.99]]);
	});
});

describe('parseReceiptText: sizes and item codes', () => {
	it('a size like "6 pc" stays in the name, not the quantity', () => {
		expect(items('6 pc chicken nuggets  7.99')).toEqual([['6 pc chicken nuggets', 1, 7.99]]);
		expect(items('12 oz Latte  4.75\n2 lb Ground Beef  9.98')).toEqual([
			['12 oz Latte', 1, 4.75],
			['2 lb Ground Beef', 1, 9.98]
		]);
	});

	it('a real quantity before a sized name still counts', () => {
		expect(items('2x 6 pc nuggets  15.98')).toEqual([['6 pc nuggets', 2, 7.99]]);
	});

	it('an item code before the price on the next line', () => {
		expect(items('really long item name\n12354384      253.24')).toEqual([
			['really long item name', 1, 253.24]
		]);
	});

	it('an item code on the same line as name and price is dropped', () => {
		expect(items('012345678 KS PAPER TOWELS  19.99\nMILK 2% GAL 553219  3.49')).toEqual([
			['KS PAPER TOWELS', 1, 19.99],
			['MILK 2% GAL', 1, 3.49]
		]);
	});
});
