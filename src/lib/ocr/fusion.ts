import type { CharDist } from './ctc';

export interface FusionConfig {
	/** Evidence tempering applied to every per-frame log-likelihood. */
	alpha: number;
	/** Added to probabilities before taking logs. */
	probFloor: number;
	/** P(a frame skips a real char). */
	pMiss: number;
	/** Needleman–Wunsch penalty when the frame inserts a char. */
	gapIns: number;
	/** Needleman–Wunsch penalty when the frame deletes a char, scaled by (1 - P_k(ε)). */
	gapDel: number;
	/** Lock threshold for every non-ε column. */
	lockTau: number;
	/** Lock threshold for columns in the trailing [0-9.] run (the price). */
	priceLockTau: number;
	/** Minimum frames observed before the line can lock. */
	minFrames: number;
	/** Starting ε log-evidence (relative to the chars) for first-frame columns. */
	initEpsLogit: number;
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
	alpha: 0.5,
	probFloor: 1e-3,
	pMiss: 0.05,
	gapIns: -4,
	gapDel: -4,
	lockTau: 0.95,
	priceLockTau: 0.98,
	minFrames: 3,
	initEpsLogit: -3
};

const PRICE_CHAR = /[0-9.]/;

function logSumExp(v: Float64Array, n: number): number {
	let max = -Infinity;
	for (let i = 0; i < n; i++) if (v[i] > max) max = v[i];
	if (max === -Infinity) return max;
	let s = 0;
	for (let i = 0; i < n; i++) s += Math.exp(v[i] - max);
	return max + Math.log(s);
}

/** Numerically stable softmax over all A + 1 entries. */
function softmax(logp: Float64Array): Float64Array {
	const lse = logSumExp(logp, logp.length);
	const out = new Float64Array(logp.length);
	for (let i = 0; i < logp.length; i++) out[i] = Math.exp(logp[i] - lse);
	return out;
}

/**
 * Fuses per-frame readings of one text line into per-column posteriors over
 * alphabet ∪ {ε}. Each frame is aligned to the columns with global
 * Needleman–Wunsch, so frames may insert or drop characters.
 */
export class LineProfile {
	private readonly A: number;
	private readonly cfg: FusionConfig;
	private cols: Float64Array[];
	private n = 1;

	constructor(
		private readonly alphabet: string[],
		first: CharDist[],
		cfg: FusionConfig = DEFAULT_FUSION_CONFIG
	) {
		this.A = alphabet.length;
		this.cfg = cfg;
		this.cols = first.map((d) => {
			const col = this.charEvidence(d);
			col[this.A] = logSumExp(col, this.A) + cfg.initEpsLogit;
			return col;
		});
	}

	get frames(): number {
		return this.n;
	}

	get columnCount(): number {
		return this.readoutColumns().length;
	}

	observe(obs: CharDist[]): void {
		const { A, cfg } = this;
		const { alpha } = cfg;
		const nPrev = this.n;
		const cols = this.cols;
		const n = cols.length;
		const m = obs.length;
		const post = cols.map(softmax);

		// Needleman–Wunsch: dp[i][j] = best score aligning cols[0..i) with obs[0..j).
		const W = m + 1;
		const dp = new Float64Array((n + 1) * W);
		const del = post.map((p) => cfg.gapDel * (1 - p[A]));
		for (let i = 1; i <= n; i++) dp[i * W] = dp[(i - 1) * W] + del[i - 1];
		for (let j = 1; j <= m; j++) dp[j] = dp[j - 1] + cfg.gapIns;
		const matchScore = (i: number, j: number) => {
			const p = post[i];
			const d = obs[j];
			let s = 0;
			for (let c = 0; c < A; c++) s += p[c] * d[c];
			return Math.log(s + cfg.probFloor);
		};
		for (let i = 1; i <= n; i++) {
			for (let j = 1; j <= m; j++) {
				dp[i * W + j] = Math.max(
					dp[(i - 1) * W + j - 1] + matchScore(i - 1, j - 1),
					dp[(i - 1) * W + j] + del[i - 1],
					dp[i * W + j - 1] + cfg.gapIns
				);
			}
		}

		// Traceback (right to left), applying updates and collecting columns in reverse.
		const logMiss = alpha * Math.log(cfg.pMiss);
		const logHit = alpha * Math.log(1 - cfg.pMiss);
		const out: Float64Array[] = [];
		let i = n;
		let j = m;
		while (i > 0 || j > 0) {
			const here = dp[i * W + j];
			if (i > 0 && j > 0 && here === dp[(i - 1) * W + j - 1] + matchScore(i - 1, j - 1)) {
				const col = cols[i - 1];
				const ev = this.charEvidence(obs[j - 1]);
				for (let c = 0; c < A; c++) col[c] += ev[c];
				col[A] += logMiss;
				out.push(col);
				i--;
				j--;
			} else if (i > 0 && (j === 0 || here === dp[(i - 1) * W + j] + del[i - 1])) {
				const col = cols[i - 1];
				for (let c = 0; c < A; c++) col[c] += logMiss;
				col[A] += logHit;
				out.push(col);
				i--;
			} else {
				// Insertion: carries the ε evidence of nPrev skips, relative to the chars.
				const col = this.charEvidence(obs[j - 1]);
				col[A] = logSumExp(col, A) + nPrev * (logHit - logMiss);
				out.push(col);
				j--;
			}
		}
		out.reverse();
		for (const col of out) normalize(col);
		this.cols = out;
		this.n++;
	}

	readout(): string {
		return this.readoutColumns()
			.map((k) => this.alphabet[argmaxChar(softmax(this.cols[k]), this.A)])
			.join('');
	}

	confidence(): number {
		let min = 1;
		for (const k of this.readoutColumns()) min = Math.min(min, maxCharProb(softmax(this.cols[k]), this.A));
		return min;
	}

	isLocked(): boolean {
		if (this.n < this.cfg.minFrames) return false;
		const ks = this.readoutColumns();
		const posts = ks.map((k) => softmax(this.cols[k]));
		const chars = posts.map((p) => this.alphabet[argmaxChar(p, this.A)]);
		let priceStart = chars.length;
		while (priceStart > 0 && PRICE_CHAR.test(chars[priceStart - 1])) priceStart--;
		return posts.every((p, idx) => {
			const tau = idx >= priceStart ? this.cfg.priceLockTau : this.cfg.lockTau;
			return maxCharProb(p, this.A) >= tau;
		});
	}

	/** Indices of columns with P(ε) < 0.5. */
	private readoutColumns(): number[] {
		const ks: number[] = [];
		this.cols.forEach((col, k) => {
			if (softmax(col)[this.A] < 0.5) ks.push(k);
		});
		return ks;
	}

	/** New column (length A + 1, ε = 0) holding α·log(probFloor + d(c)) for each char. */
	private charEvidence(d: CharDist): Float64Array {
		const col = new Float64Array(this.A + 1);
		for (let c = 0; c < this.A; c++) col[c] = this.cfg.alpha * Math.log(this.cfg.probFloor + d[c]);
		return col;
	}
}

/** Shift so the max entry is 0; softmax is unchanged and magnitudes stay bounded. */
function normalize(col: Float64Array): void {
	let max = -Infinity;
	for (let i = 0; i < col.length; i++) if (col[i] > max) max = col[i];
	for (let i = 0; i < col.length; i++) col[i] -= max;
}

function argmaxChar(p: Float64Array, A: number): number {
	let best = 0;
	for (let c = 1; c < A; c++) if (p[c] > p[best]) best = c;
	return best;
}

function maxCharProb(p: Float64Array, A: number): number {
	return p[argmaxChar(p, A)];
}
