/** Dense distribution over the alphabet (no blank), sums to 1. */
export type CharDist = Float32Array;

/**
 * Reduce CTC softmax output (row-major [T][C], class 0 = blank, class i -> alphabet[i-1])
 * to text plus one distribution per emitted character.
 */
export function reduceCtc(
	probs: Float32Array,
	T: number,
	C: number,
	alphabet: string[]
): { text: string; dists: CharDist[] } {
	if (C !== alphabet.length + 1) {
		throw new Error(`CTC class count ${C} does not match alphabet length ${alphabet.length} + 1`);
	}
	const A = C - 1;
	let text = '';
	const dists: CharDist[] = [];

	let runClass = 0;
	let acc: Float64Array | null = null;
	let runLen = 0;

	const flush = () => {
		if (runClass === 0 || !acc) return;
		const dist = new Float32Array(A);
		let sum = 0;
		for (let i = 0; i < A; i++) sum += acc[i + 1] / runLen;
		for (let i = 0; i < A; i++) dist[i] = sum > 0 ? acc[i + 1] / runLen / sum : 1 / A;
		text += alphabet[runClass - 1];
		dists.push(dist);
	};

	for (let t = 0; t < T; t++) {
		const off = t * C;
		let best = 0;
		for (let c = 1; c < C; c++) if (probs[off + c] > probs[off + best]) best = c;
		if (best !== runClass) {
			flush();
			runClass = best;
			acc = new Float64Array(C);
			runLen = 0;
		}
		if (runClass !== 0 && acc) {
			for (let c = 0; c < C; c++) acc[c] += probs[off + c];
			runLen++;
		}
	}
	flush();
	return { text, dists };
}
