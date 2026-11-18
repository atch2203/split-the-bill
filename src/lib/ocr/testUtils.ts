import type { CharDist } from './ctc';

export const ALPHABET = '0123456789.$ ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** One dist per char of `s`: `p` on the char, (1 - p) spread evenly over the rest of the alphabet. */
export function obs(s: string, p = 0.9, alphabet: string[] = ALPHABET): CharDist[] {
	const A = alphabet.length;
	const rest = (1 - p) / (A - 1);
	return s.split('').map((ch) => {
		const idx = alphabet.indexOf(ch);
		if (idx < 0) throw new Error(`char ${JSON.stringify(ch)} not in alphabet`);
		const d = new Float32Array(A).fill(rest);
		d[idx] = p;
		return d;
	});
}
