import { describe, it, expect } from 'vitest';
import { LineProfile } from './fusion';
import { ALPHABET, obs } from './testUtils';

const profile = (first: string, p = 0.9) => new LineProfile(ALPHABET, obs(first, p));

describe('LineProfile', () => {
	it('consistent', () => {
		const lp = profile('BURGER');
		for (let i = 0; i < 4; i++) lp.observe(obs('BURGER'));
		expect(lp.readout()).toBe('BURGER');
		expect(lp.frames).toBe(5);
		expect(lp.isLocked()).toBe(true);
	});

	it('not locked after one frame, locked after minFrames (2) agreeing frames', () => {
		const lp = profile('BURGER');
		expect(lp.isLocked()).toBe(false);
		lp.observe(obs('BURGER'));
		expect(lp.isLocked()).toBe(true);
	});

	it('one very confident frame alone never locks', () => {
		const lp = profile('12.99', 0.999);
		expect(lp.isLocked()).toBe(false);
	});

	it('substitution majority', () => {
		const lp = profile('12.99');
		const seq = ['12.99', '12.89', '12.99', '12.99', '12.89', '12.99', '12.99', '12.89', '12.99'];
		for (const s of seq) lp.observe(obs(s));
		expect(lp.readout()).toBe('12.99');
	});

	it('deletion tolerated', () => {
		const lp = profile('BURGER');
		const seq = ['BURGER', 'BUGER', 'BURGER', 'BURGER', 'BURGER', 'BUGER', 'BURGER', 'BURGER', 'BURGER'];
		for (const s of seq) lp.observe(obs(s));
		expect(lp.readout()).toBe('BURGER');
		expect(lp.columnCount).toBe(6);
	});

	it('insertion tolerated', () => {
		const lp = profile('BURGER');
		const seq = ['BURGGER', 'BURGER', 'BURGER', 'BURGER', 'BURGGER', 'BURGER', 'BURGER', 'BURGER', 'BURGER'];
		for (const s of seq) lp.observe(obs(s));
		expect(lp.readout()).toBe('BURGER');
		expect(lp.columnCount).toBe(6);
	});

	it('bad first frame', () => {
		const lp = profile('BURRGER');
		for (let i = 0; i < 9; i++) lp.observe(obs('BURGER'));
		expect(lp.readout()).toBe('BURGER');
	});

	it('confident wrong loses', () => {
		const lp = profile('12.99', 0.999);
		for (let i = 0; i < 6; i++) lp.observe(obs('12.89', 0.7));
		expect(lp.readout()).toBe('12.89');
	});

	it('unlocks', () => {
		const lp = profile('12.99');
		for (let i = 0; i < 4; i++) lp.observe(obs('12.99'));
		expect(lp.isLocked()).toBe(true);
		for (let i = 0; i < 5; i++) lp.observe(obs('12.89'));
		expect(lp.isLocked()).toBe(false);
	});

	it('contested stays real', () => {
		const lp = profile('12.99');
		for (let i = 0; i < 5; i++) lp.observe(obs('12.99'));
		for (let i = 0; i < 6; i++) lp.observe(obs('12.89'));
		expect(lp.readout().length).toBe(5);
		expect(lp.isLocked()).toBe(false);
	});

	it('empty obs', () => {
		const lp = profile('AB');
		lp.observe(obs('AB'));
		lp.observe(obs('AB'));
		lp.observe([]);
		lp.observe([]);
		expect(lp.readout()).toBe('AB');
	});

	it('confidence is 1 with no non-epsilon columns', () => {
		const lp = new LineProfile(ALPHABET, []);
		expect(lp.readout()).toBe('');
		expect(lp.confidence()).toBe(1);
	});
});
