import { describe, expect, it } from 'vitest';
import { detPostprocess } from './detPost';

function map(w: number, h: number, blocks: [number, number, number, number, number][]): Float32Array {
	const m = new Float32Array(w * h);
	for (const [x0, y0, bw, bh, v] of blocks)
		for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) m[y * w + x] = v;
	return m;
}

describe('detPostprocess', () => {
	it('returns one unclipped, clamped box for a single block', () => {
		const boxes = detPostprocess(map(100, 50, [[10, 20, 40, 10, 0.9]]), 100, 50);
		expect(boxes).toHaveLength(1);
		const b = boxes[0];
		expect(b.x).toBeLessThan(10);
		expect(b.y).toBeLessThan(20);
		expect(b.x + b.w).toBeGreaterThan(50);
		expect(b.y + b.h).toBeGreaterThan(30);
		expect(b.x).toBeGreaterThanOrEqual(0);
		expect(b.y).toBeGreaterThanOrEqual(0);
		expect(b.x + b.w).toBeLessThanOrEqual(100);
		expect(b.y + b.h).toBeLessThanOrEqual(50);
	});

	it('returns two boxes for two separated blocks', () => {
		const boxes = detPostprocess(
			map(100, 50, [
				[5, 5, 30, 8, 0.9],
				[50, 30, 30, 8, 0.8]
			]),
			100,
			50
		);
		expect(boxes).toHaveLength(2);
	});

	it('drops a block below boxThresh', () => {
		expect(detPostprocess(map(100, 50, [[10, 20, 40, 10, 0.4]]), 100, 50)).toHaveLength(0);
	});

	it('drops a block smaller than minSize', () => {
		expect(detPostprocess(map(100, 50, [[10, 20, 2, 2, 0.9]]), 100, 50)).toHaveLength(0);
	});

	it('clamps a box touching the image edge', () => {
		const [b] = detPostprocess(map(100, 50, [[0, 0, 40, 10, 0.9]]), 100, 50);
		expect(b.x).toBe(0);
		expect(b.y).toBe(0);
	});
});
