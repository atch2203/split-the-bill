import { mergeParts, rowsToText, type Row } from './rows';

/** Consecutive `process` rejections that make scanning fatal. */
export const MAX_CONSECUTIVE_ERRORS = 2;
/** OCR worker deaths within one camera scan that make scanning fatal. */
export const MAX_WORKER_DEATHS = 2;

/**
 * Counts consecutive `process` rejections outside the camera flow (photo upload).
 * Persists across scans; a successful `process` resets it.
 */
export class ProcessErrorCounter {
	private errors = 0;

	onOk(): void {
		this.errors = 0;
	}

	onError(): 'retry' | 'fatal' {
		this.errors++;
		return this.errors >= MAX_CONSECUTIVE_ERRORS ? 'fatal' : 'retry';
	}
}

/**
 * Multi-part camera scan state, kept free of DOM so it can be unit tested.
 * Each part's rows are merged into the accumulated rows with `mergeParts`.
 */
export class ScanFlow {
	private _rows: Row[] = [];
	private _part = 1;
	private errors = 0;
	private deaths = 0;
	private _ended = false;

	get part(): number {
		return this._part;
	}

	get rows(): readonly Row[] {
		return this._rows;
	}

	/** A frame was processed: reset the consecutive-error count. */
	onFrameOk(): void {
		this.errors = 0;
	}

	/** A frame's `process` rejected on a live worker: retry on the next frame, or give up. */
	onFrameError(): 'retry' | 'fatal' {
		this.errors++;
		return this.errors >= MAX_CONSECUTIVE_ERRORS ? 'fatal' : 'retry';
	}

	/**
	 * The OCR worker died (`process` rejected with a dead-client error): get a
	 * fresh client and continue, or give up on the 2nd death in this scan.
	 * The fresh worker starts with a clean consecutive-error count.
	 */
	onWorkerDeath(): 'recover' | 'fatal' {
		this.deaths++;
		this.errors = 0;
		return this.deaths >= MAX_WORKER_DEATHS ? 'fatal' : 'recover';
	}

	/** End the current part, merging its rows into the accumulated rows. */
	endPart(sessionRows: Row[]): void {
		this._rows = mergeParts(this._rows, sessionRows);
	}

	/** Start the next part (the caller creates a fresh ScanSession). */
	nextPart(): void {
		this._part++;
		this.errors = 0;
	}

	/** True once a terminal callback (finish, cancel, fatal) has been claimed. */
	get ended(): boolean {
		return this._ended;
	}

	/**
	 * Claim the single terminal transition. Returns true only on the first
	 * call, so exactly one of onfinish / oncancel / onfatal ever fires.
	 */
	end(): boolean {
		if (this._ended) return false;
		this._ended = true;
		return true;
	}

	finishText(): string {
		return rowsToText(this._rows);
	}
}

/**
 * Where a frame of `fw`x`fh` lands inside an element of `ew`x`eh` with
 * `object-fit: contain`: displayed px = frame px * scale + (dx, dy).
 */
export function containRect(
	fw: number,
	fh: number,
	ew: number,
	eh: number
): { scale: number; dx: number; dy: number } {
	if (fw <= 0 || fh <= 0 || ew <= 0 || eh <= 0) return { scale: 0, dx: 0, dy: 0 };
	const scale = Math.min(ew / fw, eh / fh);
	return { scale, dx: (ew - fw * scale) / 2, dy: (eh - fh * scale) / 2 };
}

/** Size with the long side at most `max` (never upscales), rounded to whole px. */
export function fitLongSide(w: number, h: number, max: number): { w: number; h: number } {
	const s = Math.min(1, max / Math.max(w, h));
	return { w: Math.round(w * s), h: Math.round(h * s) };
}
