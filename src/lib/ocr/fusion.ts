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
	/** Needleman–Wunsch penalty when the frame deletes a char, scaled by P_k(real). */
	gapDel: number;
	/** Lock threshold for every non-ε column. */
	lockTau: number;
	/** Lock threshold for columns in the trailing [0-9.] run (the price). */
	priceLockTau: number;
	/** Minimum frames observed before the line can lock. */
	minFrames: number;
	/** Starting ε log-odds for a new column; its existence log-odds start at -initEpsLogit. */
	initEpsLogit: number;
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
	alpha: 0.5,
	probFloor: 1e-3,
	pMiss: 0.1,
	gapIns: -4,
	gapDel: -4,
	lockTau: 0.8,
	priceLockTau: 0.95,
	minFrames: 2,
	initEpsLogit: -3
};

const PRICE_CHAR = /[0-9.]/;

/**
 * One column of the line. Existence and identity are factorized so that
 * contested identity evidence never leaks into P(ε).
 */
interface Column {
	/** Existence log-odds, log P(real) / P(ε). */
	e: number;
	/** Identity log-evidence over the A alphabet symbols (no ε slot). */
	logp: Float64Array;
}

/** Numerically stable softmax (max-shifted log-sum-exp). */
function softmax(v: Float64Array): Float64Array {
	let max = -Infinity;
	for (let i = 0; i < v.length; i++) if (v[i] > max) max = v[i];
	const out = new Float64Array(v.length);
	let s = 0;
	for (let i = 0; i < v.length; i++) s += out[i] = Math.exp(v[i] - max);
	for (let i = 0; i < v.length; i++) out[i] /= s;
	return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Fuses per-frame readings of one text line into per-column posteriors:
 * P(real) via existence log-odds, and identity over the alphabet. Each frame is
 * aligned to the columns with global Needleman–Wunsch, so frames may insert or
 * drop characters.
 */
export class LineProfile {
	private readonly A: number;
	private readonly cfg: FusionConfig;
	/** α·log((1 - pMiss) / pMiss): existence evidence of one match or one skip. */
	private readonly existStep: number;
	private cols: Column[];
	private n = 1;

	constructor(
		private readonly alphabet: string[],
		first: CharDist[],
		cfg: FusionConfig = DEFAULT_FUSION_CONFIG
	) {
		this.A = alphabet.length;
		this.cfg = cfg;
		this.existStep = cfg.alpha * Math.log((1 - cfg.pMiss) / cfg.pMiss);
		this.cols = first.map((d) => ({ e: -cfg.initEpsLogit, logp: this.charEvidence(d) }));
	}

	get frames(): number {
		return this.n;
	}

	get columnCount(): number {
		return this.realColumns().length;
	}

	observe(obs: CharDist[]): void {
		const { A, cfg, existStep } = this;
		const nPrev = this.n;
		const cols = this.cols;
		const n = cols.length;
		const m = obs.length;
		const post = cols.map((col) => softmax(col.logp));

		// Needleman–Wunsch: dp[i][j] = best score aligning cols[0..i) with obs[0..j).
		const W = m + 1;
		const dp = new Float64Array((n + 1) * W);
		const del = cols.map((col) => cfg.gapDel * sigmoid(col.e));
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
		const out: Column[] = [];
		let i = n;
		let j = m;
		while (i > 0 || j > 0) {
			const here = dp[i * W + j];
			if (i > 0 && j > 0 && here === dp[(i - 1) * W + j - 1] + matchScore(i - 1, j - 1)) {
				const col = cols[i - 1];
				const ev = this.charEvidence(obs[j - 1]);
				for (let c = 0; c < A; c++) col.logp[c] += ev[c];
				col.e += existStep;
				out.push(col);
				i--;
				j--;
			} else if (i > 0 && (j === 0 || here === dp[(i - 1) * W + j] + del[i - 1])) {
				const col = cols[i - 1];
				col.e -= existStep;
				out.push(col);
				i--;
			} else {
				// Prior, nPrev skips, and this match.
				out.push({
					e: -cfg.initEpsLogit + (1 - nPrev) * existStep,
					logp: this.charEvidence(obs[j - 1])
				});
				j--;
			}
		}
		out.reverse();
		for (const col of out) normalize(col.logp);
		this.cols = out;
		this.n++;
	}

	readout(): string {
		return this.realPosteriors()
			.map((p) => this.alphabet[argmax(p)])
			.join('');
	}

	confidence(): number {
		let min = 1;
		for (const p of this.realPosteriors()) min = Math.min(min, p[argmax(p)]);
		return min;
	}

	isLocked(): boolean {
		if (this.n < this.cfg.minFrames) return false;
		const posts = this.realPosteriors();
		const chars = posts.map((p) => this.alphabet[argmax(p)]);
		let priceStart = chars.length;
		while (priceStart > 0 && PRICE_CHAR.test(chars[priceStart - 1])) priceStart--;
		return posts.every((p, idx) => {
			const tau = idx >= priceStart ? this.cfg.priceLockTau : this.cfg.lockTau;
			return p[argmax(p)] >= tau;
		});
	}

	/** Columns with P(ε) = sigmoid(-e) < 0.5, i.e. e > 0. */
	private realColumns(): Column[] {
		return this.cols.filter((col) => col.e > 0);
	}

	private realPosteriors(): Float64Array[] {
		return this.realColumns().map((col) => softmax(col.logp));
	}

	/** α·log(probFloor + d(c)) for each alphabet symbol. */
	private charEvidence(d: CharDist): Float64Array {
		const ev = new Float64Array(this.A);
		for (let c = 0; c < this.A; c++) ev[c] = this.cfg.alpha * Math.log(this.cfg.probFloor + d[c]);
		return ev;
	}
}

/** Shift so the max entry is 0; softmax is unchanged and magnitudes stay bounded. */
function normalize(v: Float64Array): void {
	let max = -Infinity;
	for (let i = 0; i < v.length; i++) if (v[i] > max) max = v[i];
	for (let i = 0; i < v.length; i++) v[i] -= max;
}

function argmax(p: Float64Array): number {
	let best = 0;
	for (let c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
	return best;
}
