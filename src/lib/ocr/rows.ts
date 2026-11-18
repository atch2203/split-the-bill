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

export function assembleRows(lines: LineResult[]): Row[] {
	const sorted = [...lines].sort((a, b) => yc(a.box) - yc(b.box));
	const groups: LineResult[][] = [];
	let rowYc = 0;
	let rowH = 0;
	for (const l of sorted) {
		const cur = groups[groups.length - 1];
		if (cur && Math.abs(yc(l.box) - rowYc) <= 0.5 * Math.max(l.box.h, rowH)) {
			cur.push(l);
			rowYc = cur.reduce((s, m) => s + yc(m.box), 0) / cur.length;
			rowH = Math.max(rowH, l.box.h);
		} else {
			groups.push([l]);
			rowYc = yc(l.box);
			rowH = l.box.h;
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
