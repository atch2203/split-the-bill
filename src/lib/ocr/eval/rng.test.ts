import { describe, it, expect } from 'vitest';
import { mulberry32, hash } from './rng';
import { synthParams } from './synthParams';

describe('mulberry32', () => {
	it('is deterministic with known values', () => {
		const r = mulberry32(1);
		expect([r(), r()]).toEqual([0.6270739405881613, 0.002735721180215478]);
	});
	it('same seed gives same sequence, different seed differs', () => {
		const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
		const sa = Array.from({ length: 10 }, a);
		expect(Array.from({ length: 10 }, b)).toEqual(sa);
		expect(Array.from({ length: 10 }, c)).not.toEqual(sa);
		for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
	});
});

describe('hash', () => {
	it('is deterministic and distinguishes names', () => {
		expect(hash('receipt-1')).toBe(hash('receipt-1'));
		expect(hash('receipt-1')).not.toBe(hash('receipt-2'));
		expect(hash('a')).toBe(0xe40c292c); // FNV-1a 32-bit of "a"
	});
});

describe('synthParams', () => {
	it('stays within spec ranges and hits both branches', () => {
		const rng = mulberry32(7);
		let blurred = 0, glared = 0;
		const N = 2000;
		for (let i = 0; i < N; i++) {
			const p = synthParams(rng);
			expect(Math.abs(p.dx)).toBeLessThanOrEqual(0.02);
			expect(Math.abs(p.dy)).toBeLessThanOrEqual(0.02);
			expect(Math.abs(p.rotateDeg)).toBeLessThanOrEqual(1.5);
			expect(p.blurPx).toBeGreaterThanOrEqual(0);
			expect(p.blurPx).toBeLessThanOrEqual(2);
			expect(p.brightness).toBeGreaterThanOrEqual(0.8);
			expect(p.brightness).toBeLessThanOrEqual(1.2);
			expect(p.scale).toBeGreaterThanOrEqual(0.7);
			expect(p.scale).toBeLessThanOrEqual(1);
			expect(p.quality).toBeGreaterThanOrEqual(0.6);
			expect(p.quality).toBeLessThanOrEqual(0.9);
			if (p.blurPx > 0) blurred++;
			if (p.glare) {
				glared++;
				expect(p.glare.alpha).toBeGreaterThanOrEqual(0.3);
				expect(p.glare.alpha).toBeLessThanOrEqual(0.6);
			}
		}
		expect(blurred / N).toBeGreaterThan(0.25);
		expect(blurred / N).toBeLessThan(0.35);
		expect(glared / N).toBeGreaterThan(0.15);
		expect(glared / N).toBeLessThan(0.25);
	});
});
