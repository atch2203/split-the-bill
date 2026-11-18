import { describe, expect, it } from 'vitest';
import { assembleRows, mergeParts, rowsToText, type LineResult, type Row } from './rows';

const line = (text: string, x: number, yc: number, h = 20): LineResult => ({
	box: { x, y: yc - h / 2, w: 50, h },
	text,
	confidence: 0.9
});
const rows = (texts: string[], conf = 0.9): Row[] =>
	texts.map((text, i) => ({ text, confidence: conf, y: i * 30 }));

describe('assembleRows', () => {
	it('joins boxes on one row with two spaces, ordered by x', () => {
		const out = assembleRows([line('12.99', 240, 100), line('BURGER', 10, 100)]);
		expect(out.map((r) => r.text)).toEqual(['BURGER  12.99']);
	});
	it('groups yc 100 and 108 (h=20) into one row', () => {
		expect(assembleRows([line('A', 0, 100), line('B', 100, 108)])).toHaveLength(1);
	});
	it('splits yc 100 and 125 (h=20) into two rows', () => {
		expect(assembleRows([line('A', 0, 100), line('B', 100, 125)])).toHaveLength(2);
	});
	it('uses min confidence and mean y-centre', () => {
		const a = { ...line('A', 0, 100), confidence: 0.5 };
		const out = assembleRows([a, line('B', 100, 108)]);
		expect(out[0].confidence).toBe(0.5);
		expect(out[0].y).toBe(104);
	});
	it('rowsToText is top-to-bottom', () => {
		const out = assembleRows([line('LOW', 0, 300), line('HIGH', 0, 100)]);
		expect(rowsToText(out)).toBe('HIGH\nLOW');
	});
});

describe('mergeParts', () => {
	it('drops the overlap', () => {
		const out = mergeParts(rows(['A 1', 'B 2', 'C 3']), rows(['B 2', 'C 3', 'D 4']));
		expect(out.map((r) => r.text)).toEqual(['A 1', 'B 2', 'C 3', 'D 4']);
	});
	it('tolerates noise and keeps higher-confidence row', () => {
		const acc = rows(['A 1', 'CHEESE 3.50']);
		const next: Row[] = [{ text: 'CHEESE 3.50.', confidence: 0.99, y: 0 }, { text: 'D 4', confidence: 0.9, y: 30 }];
		const out = mergeParts(acc, next);
		expect(out.map((r) => r.text)).toEqual(['A 1', 'CHEESE 3.50.', 'D 4']);
	});
	it('keeps acc row when it has higher confidence', () => {
		const out = mergeParts(rows(['CHEESE 3.50'], 0.95), rows(['CHEESE 3.50.'], 0.5));
		expect(out.map((r) => r.text)).toEqual(['CHEESE 3.50']);
	});
	it('concatenates when no overlap', () => {
		const out = mergeParts(rows(['A 1', 'B 2']), rows(['X 9', 'Y 8']));
		expect(out.map((r) => r.text)).toEqual(['A 1', 'B 2', 'X 9', 'Y 8']);
	});
	it('returns next when acc empty', () => {
		const next = rows(['A 1']);
		expect(mergeParts([], next)).toEqual(next);
	});
	it('does not mutate inputs', () => {
		const acc = rows(['CHEESE 3.50'], 0.5);
		const next = rows(['CHEESE 3.50.'], 0.9);
		mergeParts(acc, next);
		expect(acc[0]).toEqual({ text: 'CHEESE 3.50', confidence: 0.5, y: 0 });
	});
});
