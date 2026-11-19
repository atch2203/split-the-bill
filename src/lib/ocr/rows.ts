import type { Box } from './tracker';
import { levenshtein } from './text';

export interface LineResult {
	box: Box;
	text: string;
	confidence: number;
}
export interface Row {
	text: string;
	confidence: number;
	y: number;
}

const yc = (b: Box) => b.y + b.h / 2;
const xc = (b: Box) => b.x + b.w / 2;

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The receipt's tilt as dy/dx: median slope between each box and its nearest
 * box to the right on about the same line. 0 when there's too little evidence.
 */
export function estimateSkew(boxes: Box[], medH: number): number {
	const slopes: number[] = [];
	for (const a of boxes) {
		let best: Box | null = null;
		for (const b of boxes) {
			if (b === a || b.x < a.x + a.w - medH) continue; // must sit to the right
			if (Math.abs(yc(b) - yc(a)) > 1.5 * medH) continue;
			if (!best || b.x - (a.x + a.w) < best.x - (a.x + a.w)) best = b;
		}
		if (best) slopes.push((yc(best) - yc(a)) / (xc(best) - xc(a)));
	}
	if (slopes.length < 3) return 0;
	return Math.max(-0.2, Math.min(0.2, median(slopes)));
}

/**
 * Groups boxes into receipt rows, top to bottom, left to right. Rows follow the
 * receipt's tilt (estimated from the boxes) and use the median text height as
 * the tolerance, so one tall box can't chain neighbouring rows together.
 */
export function assembleRows(lines: LineResult[]): Row[] {
	if (lines.length === 0) return [];
	const medH = median(lines.map((l) => l.box.h));
	const skew = estimateSkew(
		lines.map((l) => l.box),
		medH
	);
	const key = (l: LineResult) => yc(l.box) - skew * xc(l.box);
	const sorted = [...lines].sort((a, b) => key(a) - key(b));
	const groups: LineResult[][] = [];
	let rowKey = 0;
	for (const l of sorted) {
		const cur = groups[groups.length - 1];
		if (cur && Math.abs(key(l) - rowKey) <= 0.5 * medH) {
			cur.push(l);
			rowKey = cur.reduce((s, m) => s + key(m), 0) / cur.length;
		} else {
			groups.push([l]);
			rowKey = key(l);
		}
	}
	return groups.map((g) => ({
		text: [...g]
			.sort((a, b) => a.box.x - b.box.x)
			.map((m) => m.text)
			.join('  '),
		confidence: Math.min(...g.map((m) => m.confidence)),
		y: g.reduce((s, m) => s + yc(m.box), 0) / g.length
	}));
}

export function rowsToText(rows: Row[]): string {
	return rows.map((r) => r.text).join('\n');
}

function normDist(a: string, b: string): number {
	const m = Math.max(a.length, b.length);
	return m === 0 ? 0 : levenshtein(a, b) / m;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function mergeParts(acc: Row[], next: Row[], maxDist = 0.2): Row[] {
	let L = 0;
	for (let k = Math.min(acc.length, next.length); k > 0; k--) {
		let ok = true;
		for (let i = 0; i < k; i++) {
			const a = acc[acc.length - k + i].text;
			const b = next[i].text;
			if (normDist(a, b) > maxDist || digits(a) !== digits(b)) {
				ok = false;
				break;
			}
		}
		if (ok) {
			L = k;
			break;
		}
	}
	const out = acc.map((r) => ({ ...r }));
	for (let i = 0; i < L; i++) {
		const idx = acc.length - L + i;
		if (next[i].confidence > out[idx].confidence) out[idx] = { ...next[i] };
	}
	return [...out, ...next.slice(L).map((r) => ({ ...r }))];
}
