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

	it('unclips by d = area * unclipRatio / perimeter on every side', () => {
		// 40x10 block: d = 400 * 1.5 / 100 = 6
		const [b] = detPostprocess(map(100, 50, [[10, 20, 40, 10, 0.9]]), 100, 50);
		expect(b).toEqual({ x: 4, y: 14, w: 52, h: 22 });
	});

	it('honours a custom unclipRatio', () => {
		// d = 400 * 1 / 100 = 4
		const [b] = detPostprocess(map(100, 50, [[10, 20, 40, 10, 0.9]]), 100, 50, { unclipRatio: 1 });
		expect(b).toEqual({ x: 6, y: 16, w: 48, h: 18 });
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
		// d = 6: left/top clamp to 0, right/bottom = 40 + 6, 10 + 6
		const [b] = detPostprocess(map(100, 50, [[0, 0, 40, 10, 0.9]]), 100, 50);
		expect(b).toEqual({ x: 0, y: 0, w: 46, h: 16 });
	});
});
