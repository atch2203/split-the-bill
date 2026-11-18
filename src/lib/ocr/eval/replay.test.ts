import { describe, it, expect, vi } from 'vitest';
import { replayFrames } from './replay';
import type { OcrClient } from '../clientCore';
import type { FrameResult } from '../session';
import { ALPHABET, obs } from '../testUtils';

const result: FrameResult = {
	width: 640,
	height: 480,
	boxes: [
		{ box: { x: 20, y: 50, w: 320, h: 24 }, text: 'BURGER 12.99', dists: obs('BURGER 12.99') },
		{ box: { x: 20, y: 100, w: 320, h: 24 }, text: 'FRIES 4.50', dists: obs('FRIES 4.50') }
	]
};
const frames = (n: number) =>
	Array.from({ length: n }, () => ({ close() {} }) as unknown as ImageBitmap);
const fake = (process: OcrClient['process']): OcrClient => ({
	alphabet: ALPHABET,
	backend: 'wasm',
	process,
	dispose() {}
});

describe('replayFrames', () => {
	it('fuses identical frames into both lines', async () => {
		const { text, status } = await replayFrames(fake(async () => result), frames(6));
		expect(text).toContain('BURGER 12.99');
		expect(text).toContain('FRIES 4.50');
		expect(status.confirmed).toBe(2);
	});

	it('skips a rejecting frame and continues', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		let call = 0;
		const { text } = await replayFrames(
			fake(async () => {
				if (call++ === 2) throw new Error('boom');
				return result;
			}),
			frames(6)
		);
		expect(call).toBe(6);
		expect(text).toContain('BURGER 12.99');
		expect(text).toContain('FRIES 4.50');
	});
});
