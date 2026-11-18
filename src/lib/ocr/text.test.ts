import { describe, expect, it } from 'vitest';
import { levenshtein } from './text';

describe('levenshtein', () => {
	it('computes edit distance', () => {
		expect(levenshtein('kitten', 'sitting')).toBe(3);
		expect(levenshtein('', 'abc')).toBe(3);
		expect(levenshtein('same', 'same')).toBe(0);
	});
});
