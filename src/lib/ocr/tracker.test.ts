import { describe, it, expect } from 'vitest';
import { Tracker, type FrameBox } from './tracker';
import { ALPHABET, obs } from './testUtils';

const fb = (x: number, y: number, w: number, h: number, text: string): FrameBox => ({
	box: { x, y, w, h },
	text,
	dists: obs(text)
});

const base = (dx = 0, dy = 0) => [
	fb(20 + dx, 50 + dy, 320, 20, 'BURGER 12.99'),
	fb(20 + dx, 100 + dy, 320, 20, 'FRIES 4.50'),
	fb(20 + dx, 150 + dy, 320, 20, 'COLA 2.00')
];

describe('Tracker', () => {
	it('confirms 3 stable tracks after 3 frames', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		for (let i = 0; i < 3; i++) t.update(base());
		expect(t.tracks.length).toBe(3);
		expect(t.tracks.every((k) => k.confirmed)).toBe(true);
	});

	it('absorbs a small shift', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		t.update(base());
		t.update(base());
		const ids = t.tracks.map((k) => k.id);
		const r = t.update(base(6, 4));
		expect(t.tracks.map((k) => k.id)).toEqual(ids);
		expect(r.shift.dx).toBeCloseTo(6);
		expect(r.shift.dy).toBeCloseTo(4);
		expect(r.moved).toBe(false);
	});

	it('flags a large shift as moved', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		t.update(base());
		const r = t.update(base(60, 0));
		expect(r.moved).toBe(true);
	});

	it('drops a box seen in 1 of 10 frames', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		t.update([...base(), fb(20, 300, 320, 20, 'GHOST 9.99')]);
		for (let i = 0; i < 9; i++) t.update(base());
		const final = t.finalTracks();
		expect(final.length).toBe(3);
		// The ghost never confirmed and stopped matching, so it was pruned.
		expect(t.tracks.length).toBe(3);
	});

	it('prunes tentative tracks unseen for more than pruneFrames, keeps confirmed ones', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		for (let i = 0; i < 3; i++) t.update(base()); // base tracks confirm
		t.update([...base(), fb(20, 300, 320, 20, 'GHOST 9.99')]);
		for (let i = 0; i < 3; i++) t.update(base());
		expect(t.tracks.length).toBe(4); // ghost unseen for 3 frames: kept
		t.update(base());
		expect(t.tracks.length).toBe(3); // unseen for 4: pruned
		for (let i = 0; i < 10; i++) t.update([]);
		expect(t.tracks.length).toBe(3); // confirmed tracks are never pruned
		expect(t.tracks.every((tr) => tr.lastSeen === 8)).toBe(true);
	});

	it('ignores split boxes inside a track (review focus 1)', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		for (let i = 0; i < 5; i++) t.update([fb(10, 100, 300, 20, 'BURGER  12.99')]);
		for (let i = 0; i < 2; i++) {
			const r = t.update([fb(10, 100, 120, 20, 'BURGER'), fb(240, 100, 70, 20, '12.99')]);
			expect(r.moved).toBe(false);
			expect(Math.abs(r.shift.dx)).toBeLessThan(1);
			expect(Math.abs(r.shift.dy)).toBeLessThan(1);
		}
		const final = t.finalTracks();
		expect(final.length).toBe(1);
		expect(final[0].profile.readout()).toBe('BURGER  12.99');
	});

	it('keeps overlapping boxes of the same frame as separate tracks', () => {
		const t = new Tracker(ALPHABET, 640, 480, { confirmFrames: 1 });
		// 40-px box with 32 px (80%) inside the 300-px box, as from unclipped det boxes.
		t.update([fb(10, 100, 300, 20, 'BURGER'), fb(278, 100, 40, 20, '12')]);
		expect(t.tracks.length).toBe(2);
		expect(t.finalTracks().map((k) => k.profile.readout())).toEqual(['BURGER', '12']);
	});

	it('handles empty frames', () => {
		const t = new Tracker(ALPHABET, 640, 480);
		expect(() => t.update([])).not.toThrow();
		expect(t.frameIndex).toBe(1);
		t.update([]);
		expect(t.frameIndex).toBe(2);
	});
});
