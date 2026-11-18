import type { CharDist } from './ctc';
import { DEFAULT_FUSION_CONFIG, LineProfile, type FusionConfig } from './fusion';
import { levenshtein } from './text';

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}
export interface FrameBox {
	box: Box;
	text: string;
	dists: CharDist[];
}
export interface Track {
	id: number;
	box: Box;
	profile: LineProfile;
	seen: number;
	firstFrame: number;
	/** Frame index (1-based) this track was last matched in. */
	lastSeen: number;
	confirmed: boolean;
}
export interface TrackerConfig {
	iouMin: number;
	textSimMin: number;
	confirmFrames: number;
	minSeenFrac: number;
	moveFrac: number;
	containFrac: number;
	/** Tentative tracks unseen for more than this many frames are dropped (camera-motion debris). */
	pruneFrames: number;
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
	iouMin: 0.3,
	textSimMin: 0.5,
	confirmFrames: 3,
	minSeenFrac: 0.3,
	moveFrac: 0.05,
	containFrac: 0.8,
	pruneFrames: 3
};

const area = (b: Box) => b.w * b.h;

function intersection(a: Box, b: Box): number {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

function iou(a: Box, b: Box): number {
	const i = intersection(a, b);
	const u = area(a) + area(b) - i;
	return u > 0 ? i / u : 0;
}

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function textSim(a: string, b: string): number {
	const m = Math.max(a.length, b.length);
	return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}

export class Tracker {
	private _tracks: Track[] = [];
	private nextId = 1;
	private _frameIndex = 0;
	private cfg: TrackerConfig;

	constructor(
		private alphabet: string[],
		private frameW: number,
		private frameH: number,
		cfg: Partial<TrackerConfig> = {},
		private fusion: FusionConfig = DEFAULT_FUSION_CONFIG
	) {
		this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...cfg };
	}

	get tracks(): readonly Track[] {
		return this._tracks;
	}

	get frameIndex(): number {
		return this._frameIndex;
	}

	update(boxes: FrameBox[]): { shift: { dx: number; dy: number }; moved: boolean } {
		this._frameIndex++;
		const c = this.cfg;

		// Shift: median centre offset of each new box vs its max-IoU track.
		const dxs: number[] = [];
		const dys: number[] = [];
		for (const b of boxes) {
			let best: Track | null = null;
			let bestIou = 0;
			for (const t of this._tracks) {
				const v = iou(t.box, b.box);
				if (v > bestIou) {
					bestIou = v;
					best = t;
				}
			}
			if (
				best &&
				bestIou >= c.iouMin &&
				textSim(b.text, best.profile.readout()) >= c.textSimMin
			) {
				const a = centre(best.box);
				const n = centre(b.box);
				dxs.push(n.x - a.x);
				dys.push(n.y - a.y);
			}
		}
		const dx = dxs.length ? median(dxs) : 0;
		const dy = dys.length ? median(dys) : 0;
		const moved = Math.hypot(dx, dy) > c.moveFrac * Math.max(this.frameW, this.frameH);
		const shifted = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

		// Greedy max-IoU matching against shifted track boxes.
		const pairs: { ti: number; bi: number; v: number }[] = [];
		this._tracks.forEach((t, ti) => {
			const sb = shifted(t.box);
			boxes.forEach((b, bi) => {
				const v = iou(sb, b.box);
				if (v >= c.iouMin) pairs.push({ ti, bi, v });
			});
		});
		pairs.sort((a, b) => b.v - a.v);
		const usedT = new Set<number>();
		const usedB = new Set<number>();
		for (const p of pairs) {
			if (usedT.has(p.ti) || usedB.has(p.bi)) continue;
			const t = this._tracks[p.ti];
			const b = boxes[p.bi];
			if (textSim(b.text, t.profile.readout()) < c.textSimMin) continue;
			usedT.add(p.ti);
			usedB.add(p.bi);
			t.box = b.box;
			t.profile.observe(b.dists);
			t.seen++;
			t.lastSeen = this._frameIndex;
			if (t.seen >= c.confirmFrames) t.confirmed = true;
		}

		// Unmatched boxes: ignore split/merge fragments of tracks from earlier
		// frames, else start new tracks. Boxes of the same frame never suppress
		// each other (a short price mostly inside a neighbour's box is real).
		const prior = this._tracks.slice();
		boxes.forEach((b, bi) => {
			if (usedB.has(bi)) return;
			const ab = area(b.box);
			for (const t of prior) {
				const tb = shifted(t.box);
				const i = intersection(b.box, tb);
				if (i >= c.containFrac * ab || i >= c.containFrac * area(tb)) return;
			}
			this._tracks.push({
				id: this.nextId++,
				box: b.box,
				profile: new LineProfile(this.alphabet, b.dists, this.fusion),
				seen: 1,
				firstFrame: this._frameIndex,
				lastSeen: this._frameIndex,
				confirmed: 1 >= c.confirmFrames
			});
		});

		// Tentative tracks that stopped matching are debris from camera motion.
		this._tracks = this._tracks.filter(
			(t) => t.confirmed || this._frameIndex - t.lastSeen <= c.pruneFrames
		);

		return { shift: { dx, dy }, moved };
	}

	finalTracks(): Track[] {
		// Frames since creation, inclusive: frameIndex counts processed frames; firstFrame is the 1-based frame a track appeared in.
		return this._tracks.filter(
			(t) => t.confirmed && t.seen / (this._frameIndex - t.firstFrame + 1) >= this.cfg.minSeenFrac
		);
	}
}
