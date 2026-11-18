import { assembleRows, type LineResult, type Row } from './rows';
import { Tracker, type FrameBox, type Track, type TrackerConfig } from './tracker';

export interface FrameResult {
	width: number;
	height: number;
	boxes: FrameBox[];
}
export interface SessionStatus {
	confirmed: number;
	locked: number;
	moved: boolean;
	tooSmall: boolean;
	done: boolean;
}

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
	private prevConfirmed = 0;
	private lastConfirmAt = 0;

	constructor(
		private alphabet: string[],
		opts: { settleMs?: number; minTextPx?: number; tracker?: Partial<TrackerConfig> } = {}
	) {
		this.settleMs = opts.settleMs ?? 1000;
		this.minTextPx = opts.minTextPx ?? 16;
		this.trackerCfg = opts.tracker ?? {};
	}

	addFrame(r: FrameResult, nowMs: number): SessionStatus {
		this.tracker ??= new Tracker(this.alphabet, r.width, r.height, this.trackerCfg);
		const { moved } = this.tracker.update(r.boxes);
		const conf = this.tracker.tracks.filter((t) => t.confirmed);
		const confirmed = conf.length;
		const locked = conf.filter((t) => t.profile.isLocked()).length;
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
}
