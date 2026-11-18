import { assembleRows, type LineResult, type Row } from './rows';
import { Tracker, type Box, type FrameBox, type Track, type TrackerConfig } from './tracker';

export interface FrameResult {
	width: number;
	height: number;
	boxes: FrameBox[];
}
export interface SessionStatus {
	/** Confirmed, in-view lines the scan waits on (item/price rows; see `addFrame`). */
	confirmed: number;
	/** How many of those are locked. */
	locked: number;
	moved: boolean;
	tooSmall: boolean;
	done: boolean;
}

/** How a track is drawn: still forming, not waited on, waited on, or done. */
export type TrackState = 'tentative' | 'ignored' | 'pending' | 'locked';
export interface OverlayBox {
	box: Box;
	state: TrackState;
}

/** A price-like token: digits, a decimal mark, exactly two digits. */
const PRICE = /\d[.,]\d{2}(?!\d)/;

const yc = (b: Box) => b.y + b.h / 2;
const sameRow = (a: Box, b: Box) => Math.abs(yc(a) - yc(b)) <= 0.5 * Math.max(a.h, b.h);

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class ScanSession {
	private tracker: Tracker | null = null;
	private settleMs: number;
	private minTextPx: number;
	private trackerCfg: Partial<TrackerConfig>;
	private activeFrames: number;
	private prevConfirmed = 0;
	private lastConfirmAt = 0;
	private required = new Set<Track>();

	constructor(
		private alphabet: string[],
		opts: {
			settleMs?: number;
			minTextPx?: number;
			/** Confirmed tracks unseen for this many frames no longer hold up the scan. */
			activeFrames?: number;
			tracker?: Partial<TrackerConfig>;
		} = {}
	) {
		this.settleMs = opts.settleMs ?? 500;
		this.activeFrames = opts.activeFrames ?? 10;
		this.minTextPx = opts.minTextPx ?? 16;
		this.trackerCfg = opts.tracker ?? {};
	}

	addFrame(r: FrameResult, nowMs: number): SessionStatus {
		this.tracker ??= new Tracker(this.alphabet, r.width, r.height, this.trackerCfg);
		const { moved } = this.tracker.update(r.boxes);
		const frame = this.tracker.frameIndex;
		// Lines out of view (camera moved) can't improve, so they don't hold up the scan.
		const active = this.tracker.tracks.filter(
			(t) => t.confirmed && frame - t.lastSeen < this.activeFrames
		);
		// Only rows with a price are waited on (items, tax, totals); store name,
		// address, dates and footers don't block. Without any price yet, wait on all.
		const priced = active.filter((t) => PRICE.test(t.profile.readout()));
		const required = priced.length
			? active.filter((t) => priced.some((p) => sameRow(t.box, p.box)))
			: active;
		this.required = new Set(required);
		const confirmed = required.length;
		const locked = required.filter((t) => t.profile.isLocked()).length;
		if (confirmed > this.prevConfirmed) this.lastConfirmAt = nowMs;
		this.prevConfirmed = confirmed;
		const tooSmall =
			r.boxes.length > 0 && median(r.boxes.map((b) => b.box.h)) < this.minTextPx;
		const done =
			confirmed > 0 && locked === confirmed && nowMs - this.lastConfirmAt >= this.settleMs;
		return { confirmed, locked, moved, tooSmall, done };
	}

	rows(): Row[] {
		if (!this.tracker) return [];
		const lines: LineResult[] = [];
		for (const t of this.tracker.finalTracks()) {
			const text = t.profile.readout();
			if (!text) continue;
			lines.push({ box: t.box, text, confidence: t.profile.confidence() });
		}
		return assembleRows(lines);
	}

	tracks(): readonly Track[] {
		return this.tracker?.tracks ?? [];
	}

	/** Boxes to draw: only tracks matched in the last 2 frames, so stale boxes don't linger. */
	overlay(): OverlayBox[] {
		if (!this.tracker) return [];
		const frame = this.tracker.frameIndex;
		return this.tracker.tracks
			.filter((t) => frame - t.lastSeen < 2)
			.map((t) => ({
				box: t.box,
				state: !t.confirmed
					? 'tentative'
					: !this.required.has(t)
						? 'ignored'
						: t.profile.isLocked()
							? 'locked'
							: 'pending'
			}));
	}
}
