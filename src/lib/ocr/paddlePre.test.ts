import { describe, expect, it } from 'vitest';
import {
	DET_MAX_SIDE,
	UPLOAD_DET_MAX_SIDE,
	REC_HEIGHT,
	REC_MIN_WIDTH,
	REC_MAX_WIDTH,
	detInput,
	detResizeDims,
	parseDict,
	recInput,
	recognizeFrame,
	scaleBox,
	type RunModel
} from './paddlePre';

/** Solid-colour RGBA image. */
function solid(w: number, h: number, [r, g, b]: [number, number, number]): Uint8ClampedArray {
	const px = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4);
	return px;
}

describe('detResizeDims', () => {
	it('keeps sides multiples of 32 and the long side <= 960', () => {
		for (const [w, h] of [
			[1920, 1080],
			[1080, 1920],
			[4000, 3000],
			[333, 777],
			[961, 10]
		]) {
			const d = detResizeDims(w, h);
			expect(d.w % 32).toBe(0);
			expect(d.h % 32).toBe(0);
			expect(Math.max(d.w, d.h)).toBeLessThanOrEqual(DET_MAX_SIDE);
			expect(Math.min(d.w, d.h)).toBeGreaterThanOrEqual(32);
		}
	});
	it('scales 1920x1080 to 960x544', () => {
		expect(detResizeDims(1920, 1080)).toEqual({ w: 960, h: 544 });
	});
	it('does not upscale small images beyond rounding', () => {
		expect(detResizeDims(320, 100)).toEqual({ w: 320, h: 96 });
	});
	it('honours a larger maxSide (uploads), keeping multiples of 32', () => {
		expect(detResizeDims(4000, 3000, UPLOAD_DET_MAX_SIDE)).toEqual({ w: 2560, h: 1920 });
		expect(detResizeDims(3024, 4032, UPLOAD_DET_MAX_SIDE)).toEqual({ w: 1920, h: 2560 });
		// Below the cap: only rounded, never upscaled.
		expect(detResizeDims(1920, 1080, UPLOAD_DET_MAX_SIDE)).toEqual({ w: 1920, h: 1088 });
		const d = detResizeDims(4001, 2999, UPLOAD_DET_MAX_SIDE);
		expect(d.w % 32).toBe(0);
		expect(d.h % 32).toBe(0);
		expect(Math.max(d.w, d.h)).toBeLessThanOrEqual(UPLOAD_DET_MAX_SIDE);
	});
	it('defaults to DET_MAX_SIDE', () => {
		expect(detResizeDims(4000, 3000)).toEqual(detResizeDims(4000, 3000, DET_MAX_SIDE));
	});
});

describe('detInput', () => {
	it('normalizes with ImageNet mean/std in BGR order, NCHW', () => {
		const { data, w, h } = detInput(solid(64, 32, [255, 0, 128]), 64, 32);
		expect([w, h]).toEqual([64, 32]);
		expect(data.length).toBe(3 * 64 * 32);
		const plane = w * h;
		// channel 0 = B (128), channel 1 = G (0), channel 2 = R (255)
		expect(data[0]).toBeCloseTo((128 / 255 - 0.485) / 0.229, 4);
		expect(data[plane]).toBeCloseTo((0 - 0.456) / 0.224, 4);
		expect(data[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 4);
		expect(data[plane - 1]).toBeCloseTo(data[0], 4);
	});
});

describe('recInput', () => {
	it('resizes to height 48, keeps aspect ratio, pads to the minimum width with zeros', () => {
		const img = solid(200, 100, [255, 0, 0]);
		const r = recInput(img, 200, 100, { x: 10, y: 10, w: 96, h: 24 });
		expect(r.width).toBe(REC_MIN_WIDTH);
		expect(r.contentWidth).toBe(192);
		expect(r.data.length).toBe(3 * REC_HEIGHT * REC_MIN_WIDTH);
		const plane = REC_HEIGHT * r.width;
		// BGR: channel 0 = B (0) -> -1, channel 2 = R (255) -> 1
		expect(r.data[0]).toBeCloseTo(-1, 4);
		expect(r.data[2 * plane]).toBeCloseTo(1, 4);
		// padding column stays 0
		expect(r.data[r.width - 1]).toBe(0);
	});
	it('grows past the minimum width for long boxes, capped at the max width', () => {
		const img = solid(4000, 100, [0, 0, 0]);
		expect(recInput(img, 4000, 100, { x: 0, y: 0, w: 480, h: 24 }).width).toBe(960);
		expect(recInput(img, 4000, 100, { x: 0, y: 0, w: 4000, h: 20 }).width).toBe(REC_MAX_WIDTH);
	});
});

describe('scaleBox', () => {
	it('scales a prob-map box to frame pixels', () => {
		expect(scaleBox({ x: 10, y: 5, w: 20, h: 4 }, 2, 3)).toEqual({ x: 20, y: 15, w: 40, h: 12 });
	});
});

describe('parseDict', () => {
	it('splits lines, drops the trailing newline and appends a space', () => {
		expect(parseDict('a\nb\r\nc\n')).toEqual(['a', 'b', 'c', ' ']);
	});
});

describe('recognizeFrame', () => {
	it('runs det -> boxes -> rec -> ctc and returns frame-pixel boxes', async () => {
		const alphabet = parseDict('A\nB\n'); // A, B, ' '
		const det: RunModel = async (_x, dims) => {
			const [, , h, w] = dims;
			const prob = new Float32Array(h * w);
			for (let y = 8; y < 16; y++) for (let x = 8; x < 40; x++) prob[y * w + x] = 0.9;
			return { data: prob, dims: [1, 1, h, w] };
		};
		const recDims: number[][] = [];
		const rec: RunModel = async (_x, dims) => {
			recDims.push([...dims]);
			// T=3: A, blank, B
			const C = 4;
			const p = new Float32Array(3 * C);
			p[0 * C + 1] = 1;
			p[1 * C + 0] = 1;
			p[2 * C + 2] = 1;
			return { data: p, dims: [1, 3, C] };
		};
		const res = await recognizeFrame(solid(128, 64, [255, 255, 255]), 128, 64, det, rec, alphabet);
		expect(res.width).toBe(128);
		expect(res.height).toBe(64);
		expect(res.boxes).toHaveLength(1);
		expect(res.boxes[0].text).toBe('AB');
		expect(res.boxes[0].dists).toHaveLength(2);
		expect(res.boxes[0].box.x).toBeLessThan(8);
		expect(recDims[0].slice(0, 3)).toEqual([1, 3, REC_HEIGHT]);
	});

	it('passes detMaxSide through to the det input size', async () => {
		const detDims: number[][] = [];
		const det: RunModel = async (_x, dims) => {
			detDims.push([...dims]);
			return { data: new Float32Array(dims[2] * dims[3]), dims: [1, 1, dims[2], dims[3]] };
		};
		const rec: RunModel = async () => ({ data: new Float32Array(4), dims: [1, 1, 4] });
		const img = solid(2048, 1024, [255, 255, 255]);
		await recognizeFrame(img, 2048, 1024, det, rec, ['A']);
		await recognizeFrame(img, 2048, 1024, det, rec, ['A'], { detMaxSide: 2560 });
		expect(detDims).toEqual([
			[1, 3, 480, 960],
			[1, 3, 1024, 2048]
		]);
	});
});
