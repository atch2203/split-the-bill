import { describe, it, expect } from 'vitest';
import { classifyLine, stripItemCodes } from './receiptLines';

describe('stripItemCodes', () => {
	it('drops 5+ digit codes before the last token, keeping spacing', () => {
		expect(stripItemCodes('12354384      253.24')).toBe('253.24');
		expect(stripItemCodes('MILK 2% GAL 553219  3.49')).toBe('MILK 2% GAL   3.49');
		expect(stripItemCodes('012345678 KS PAPER TOWELS  19.99')).toBe('KS PAPER TOWELS  19.99');
	});

	it('keeps the last token (a price, or a zip/phone that skip patterns handle)', () => {
		expect(stripItemCodes('Burger    12399')).toBe('Burger    12399');
		expect(stripItemCodes('Springfield, IL 62704')).toBe('Springfield, IL 62704');
	});

	it('keeps short numbers', () => {
		expect(stripItemCodes('Room 1234 Service  5.00')).toBe('Room 1234 Service  5.00');
	});
});

describe('classifyLine', () => {
	it('summary lines with and without a value', () => {
		expect(classifyLine('Tax 1.04')).toEqual({ kind: 'summary', field: 'tax', value: 1.04 });
		expect(classifyLine('Sales Tax')).toEqual({ kind: 'summary', field: 'tax', value: null });
		expect(classifyLine('Subtotal: $12.99')).toEqual({ kind: 'summary', field: 'subtotal', value: 12.99 });
	});

	it('sizes are part of the name, quantities are not', () => {
		expect(classifyLine('6 pc chicken nuggets  7.99')).toEqual({
			kind: 'item',
			name: '6 pc chicken nuggets',
			quantity: 1,
			price: 7.99
		});
		expect(classifyLine('6 chicken nuggets  7.98')).toEqual({
			kind: 'item',
			name: 'chicken nuggets',
			quantity: 6,
			price: 1.33
		});
		expect(classifyLine('6 pc chicken nuggets')).toEqual({
			kind: 'name',
			name: '6 pc chicken nuggets',
			quantity: 1
		});
	});

	it('code + price is a price line', () => {
		expect(classifyLine('12354384      253.24')).toEqual({ kind: 'price', price: 253.24 });
	});

	it('quantity lines', () => {
		expect(classifyLine('2')).toEqual({ kind: 'qty', quantity: 2 });
		expect(classifyLine('3 @ 0.25')).toEqual({ kind: 'qtyUnit', quantity: 3, unitPrice: 0.25 });
	});

	it('noise is other', () => {
		expect(classifyLine('Thank you!')).toEqual({ kind: 'other' });
		expect(classifyLine('   ')).toEqual({ kind: 'other' });
	});
});
