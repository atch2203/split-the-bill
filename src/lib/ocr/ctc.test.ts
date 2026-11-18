import { describe, it, expect } from 'vitest';
import { reduceCtc } from './ctc';

const rows = (r: number[][]) => new Float32Array(r.flat());

describe('reduceCtc', () => {
	const alphabet = ['a', 'b'];

	it('collapses repeated runs', () => {
		const p = rows([
			[0.1, 0.8, 0.1],
			[0.1, 0.8, 0.1],
			[0.8, 0.1, 0.1],
			[0.1, 0.1, 0.8]
		]);
		const r = reduceCtc(p, 4, 3, alphabet);
		expect(r.text).toBe('ab');
		expect(r.dists).toHaveLength(2);
	});

	it('splits identical classes separated by blank', () => {
		const p = rows([
			[0.1, 0.8, 0.1],
			[0.8, 0.1, 0.1],
			[0.1, 0.8, 0.1]
		]);
		expect(reduceCtc(p, 3, 3, alphabet).text).toBe('aa');
	});

	it('returns empty for all blank', () => {
		const p = rows([
			[0.9, 0.05, 0.05],
			[0.9, 0.05, 0.05]
		]);
		expect(reduceCtc(p, 2, 3, alphabet)).toEqual({ text: '', dists: [] });
	});

	it('averages run rows, drops blank, renormalizes', () => {
		const p = rows([
			[0.1, 0.8, 0.1],
			[0.1, 0.6, 0.3]
		]);
		const d = reduceCtc(p, 2, 3, alphabet).dists[0];
		expect(d).toHaveLength(2);
		expect(d[0]).toBeCloseTo(0.7 / 0.9, 6);
		expect(d[1]).toBeCloseTo(0.2 / 0.9, 6);
	});

	it('throws on class count mismatch', () => {
		expect(() => reduceCtc(new Float32Array(8), 2, 4, alphabet)).toThrow();
	});
});
