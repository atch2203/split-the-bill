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

describe('parseReceiptText: tax/flag letters after the price', () => {
	it('drops a 1–2 letter flag after the price', () => {
		expect(items('GV MILK  3.48 N\nBURGER 7.99 T\nPAPER TOWELS  12.49 TX\nBANANAS\n1.36 F')).toEqual([
			['GV MILK', 1, 3.48],
			['BURGER', 1, 7.99],
			['PAPER TOWELS', 1, 12.49],
			['BANANAS', 1, 1.36]
		]);
	});

	it('with an item code and a flag', () => {
		expect(items('KS WATER 1234567  4.99 A')).toEqual([['KS WATER', 1, 4.99]]);
	});

	it('a trailing word that is part of the name is kept', () => {
		expect(items('VITAMIN C  12.99')).toEqual([['VITAMIN C', 1, 12.99]]);
	});
});

describe('parseReceiptText: add-ons fold into the item above', () => {
	it('"+", "Add" and "w/" lines add their price and name', () => {
		expect(items('Latte  4.75\n+ Oat Milk  0.75\nAdd Extra Shot 1.00\nBagel 3.00\nw/ Cream Cheese 0.50')).toEqual([
			['Latte + Oat Milk + Extra Shot', 1, 6.5],
			['Bagel + Cream Cheese', 1, 3.5]
		]);
	});

	it('free modifiers only change the name', () => {
		expect(items('Burger  12.99\n- No Onion\n+ Well Done\nFries 4.50')).toEqual([
			['Burger - No Onion + Well Done', 1, 12.99],
			['Fries', 1, 4.5]
		]);
	});

	it('an add-on on a multi-quantity item is split per unit', () => {
		expect(items('2 Latte  9.50\n+ Oat Milk  1.50')).toEqual([['Latte + Oat Milk', 2, 5.5]]);
	});

	it('an add-on after a two-line item attaches to it', () => {
		expect(items('Grilled Chicken Sandwich\n11.50\n+ Bacon 2.00')).toEqual([
			['Grilled Chicken Sandwich + Bacon', 1, 13.5]
		]);
	});

	it('"Extra ..." is a normal item, not an add-on', () => {
		expect(items('Burger  12.99\nExtra Large Pizza  14.99')).toEqual([
			['Burger', 1, 12.99],
			['Extra Large Pizza', 1, 14.99]
		]);
	});

	it('with no item above, an add-on line is its own item', () => {
		expect(items('+ Oat Milk  0.75')).toEqual([['Oat Milk', 1, 0.75]]);
	});
});
