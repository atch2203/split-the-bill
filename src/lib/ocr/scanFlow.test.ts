import { describe, expect, it } from 'vitest';
import { ScanFlow, containRect, fitLongSide } from './scanFlow';
import { mergeParts, rowsToText, type Row } from './rows';

const rows = (texts: string[], conf = 0.9): Row[] =>
	texts.map((text, i) => ({ text, confidence: conf, y: i * 30 }));

describe('ScanFlow errors', () => {
	it('first rejection retries, second consecutive is fatal', () => {
		const f = new ScanFlow();
		expect(f.onFrameError()).toBe('retry');
		expect(f.onFrameError()).toBe('fatal');
	});
	it('a success resets the count (error, ok, error is not fatal)', () => {
		const f = new ScanFlow();
		expect(f.onFrameError()).toBe('retry');
		f.onFrameOk();
		expect(f.onFrameError()).toBe('retry');
	});
});

describe('ScanFlow parts', () => {
	it('starts at part 1 with no rows', () => {
		const f = new ScanFlow();
		expect(f.part).toBe(1);
		expect(f.finishText()).toBe('');
	});
	it('merges two parts via mergeParts and bumps the part number', () => {
		const a = rows(['BURGER 12.99', 'FRIES 4.50']);
		const b = rows(['FRIES 4.50', 'TOTAL 17.49']);
		const f = new ScanFlow();
		f.endPart(a);
		f.nextPart();
		expect(f.part).toBe(2);
		f.endPart(b);
		expect(f.rows).toEqual(mergeParts(mergeParts([], a), b));
		expect(f.rows.map((r) => r.text)).toEqual(['BURGER 12.99', 'FRIES 4.50', 'TOTAL 17.49']);
	});
	it('finishText uses rowsToText', () => {
		const f = new ScanFlow();
		f.endPart(rows(['A 1.00', 'B 2.00']));
		expect(f.finishText()).toBe(rowsToText([...f.rows]));
		expect(f.finishText()).toBe('A 1.00\nB 2.00');
	});
	it('nextPart resets the error count', () => {
		const f = new ScanFlow();
		f.onFrameError();
		f.nextPart();
		expect(f.onFrameError()).toBe('retry');
	});
});

describe('containRect', () => {
	it('letterboxes a tall frame in a wide element', () => {
		// 100x200 frame in 400x200 element: scale 1, 150px bars left/right
		expect(containRect(100, 200, 400, 200)).toEqual({ scale: 1, dx: 150, dy: 0 });
	});
	it('pillarboxes a wide frame in a tall element', () => {
		expect(containRect(200, 100, 100, 200)).toEqual({ scale: 0.5, dx: 0, dy: 75 });
	});
	it('returns scale 0 for empty sizes', () => {
		expect(containRect(0, 0, 100, 100).scale).toBe(0);
	});
});

describe('fitLongSide', () => {
	it('downscales so the long side is at most max', () => {
		expect(fitLongSide(1920, 1080, 1280)).toEqual({ w: 1280, h: 720 });
		expect(fitLongSide(1080, 1920, 1280)).toEqual({ w: 720, h: 1280 });
	});
	it('never upscales', () => {
		expect(fitLongSide(640, 480, 1280)).toEqual({ w: 640, h: 480 });
	});
});
