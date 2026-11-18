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

	// A line whose middle character keeps flipping never locks.
	const noisy = (i: number, a: string, b: string) => (i % 2 ? a : b);

	it('a line without a price (store name) does not hold up the scan', () => {
		const s = new ScanSession(ALPHABET);
		let st: SessionStatus | undefined;
		for (let i = 0; i < 8; i++) {
			st = s.addFrame(frame([fb(10, 24, noisy(i, 'TACO PALACE', 'TACD PALACE')), ...three()]), i * 100);
		}
		expect(st!.confirmed).toBe(3);
		expect(st!.locked).toBe(3);
		expect(st!.done).toBe(true);
		expect(s.overlay().find((o) => o.box.y === 10)?.state).toBe('ignored');
		// It is still part of the output for the parser.
		expect(s.rows().length).toBe(4);
	});

	it('a name box on a price row is waited on', () => {
		const s = new ScanSession(ALPHABET);
		const box = (x: number, y: number, w: number, text: string): FrameBox => ({
			box: { x, y, w, h: 24 },
			text,
			dists: obs(text)
		});
		let st: SessionStatus | undefined;
		for (let i = 0; i < 12; i++) {
			const name = box(20, 50, 300, noisy(i, 'BURGER', 'BURGFR'));
			st = s.addFrame(frame([name, box(400, 52, 100, '12.99')]), i * 100);
		}
		expect(st!.confirmed).toBe(2);
		expect(st!.locked).toBe(1);
		expect(st!.done).toBe(false);
	});

	it('confirmed lines out of view stop holding up the scan', () => {
		const s = new ScanSession(ALPHABET);
		let st: SessionStatus | undefined;
		// A noisy priced line is seen for 4 frames, then the camera moves off it.
		for (let i = 0; i < 4; i++) {
			st = s.addFrame(frame([fb(10, 24, noisy(i, 'TIP 3.00', 'TIP 8.00')), ...three()]), i * 100);
		}
		expect(st!.confirmed).toBe(4);
		expect(st!.done).toBe(false);
		for (let i = 4; i < 16; i++) st = s.addFrame(frame(three()), i * 100);
		expect(st!.confirmed).toBe(3);
		expect(st!.done).toBe(true);
	});

	it('overlay shows only recently matched tracks', () => {
		const s = new ScanSession(ALPHABET);
		for (let i = 0; i < 3; i++) s.addFrame(frame(three()), i * 100);
		expect(s.overlay().length).toBe(3);
		s.addFrame(frame([]), 300);
		expect(s.overlay().length).toBe(3); // missed one frame: still drawn
		s.addFrame(frame([]), 400);
		expect(s.overlay().length).toBe(0);
	});
});
