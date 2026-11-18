import { describe, it, expect } from 'vitest';
import { ScanSession, type FrameResult, type SessionStatus } from './session';
import type { FrameBox } from './tracker';
import { ALPHABET, obs } from './testUtils';

const fb = (y: number, h: number, text: string): FrameBox => ({
	box: { x: 20, y, w: 320, h },
	text,
	dists: obs(text)
});
const three = (h = 24): FrameBox[] => [
	fb(50, h, 'BURGER 12.99'),
	fb(100, h, 'FRIES 4.50'),
	fb(150, h, 'COLA 2.00')
];
const frame = (boxes: FrameBox[]): FrameResult => ({ width: 640, height: 480, boxes });

describe('ScanSession', () => {
	it('is done only after settle time', () => {
		const s = new ScanSession(ALPHABET);
		let st = s.addFrame(frame(three()), 0);
		for (let t = 100; t <= 400; t += 100) st = s.addFrame(frame(three()), t);
		expect(st.confirmed).toBe(3);
		expect(st.locked).toBe(st.confirmed);
		expect(st.done).toBe(false);
		st = s.addFrame(frame(three()), 1500);
		expect(st.done).toBe(true);
		expect(s.rows().length).toBe(3);
	});

	it('new confirmed box resets settle', () => {
		const s = new ScanSession(ALPHABET);
		for (let t = 0; t <= 400; t += 100) s.addFrame(frame(three()), t);
		const four = () => [...three(), fb(200, 24, 'PIZZA 9.00')];
		s.addFrame(frame(four()), 1200);
		s.addFrame(frame(four()), 1300);
		let st = s.addFrame(frame(four()), 1400);
		expect(st.confirmed).toBe(4);
		st = s.addFrame(frame(four()), 1500);
		expect(st.done).toBe(false);
		st = s.addFrame(frame(four()), 2500);
		expect(st.done).toBe(true);
	});

	it('empty frames never finish', () => {
		const s = new ScanSession(ALPHABET);
		let st: SessionStatus | undefined;
		expect(s.rows()).toEqual([]);
		expect(s.tracks()).toEqual([]);
		for (let i = 0; i < 10; i++) st = s.addFrame(frame([]), i * 500);
		expect(st!.done).toBe(false);
		expect(st!.tooSmall).toBe(false);
		expect(s.rows()).toEqual([]);
	});

	it('single-frame path yields rows with confirmFrames 1', () => {
		const s = new ScanSession(ALPHABET, { tracker: { confirmFrames: 1 } });
		const st = s.addFrame(frame([fb(50, 24, 'BURGER 12.99'), fb(100, 24, 'COLA 2.00')]), 0);
		expect(st.confirmed).toBe(2);
		const rows = s.rows();
		expect(rows.length).toBe(2);
		expect(rows.map((r) => r.text)).toEqual(['BURGER 12.99', 'COLA 2.00']);
	});

	it('flags small text', () => {
		expect(new ScanSession(ALPHABET).addFrame(frame(three(10)), 0).tooSmall).toBe(true);
		expect(new ScanSession(ALPHABET).addFrame(frame(three(24)), 0).tooSmall).toBe(false);
	});
});
