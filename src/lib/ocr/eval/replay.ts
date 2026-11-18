import type { OcrClient } from '../clientCore';
import { rowsToText } from '../rows';
import { ScanSession, type SessionStatus } from '../session';

/** Recorded camera frames (JPEG data URLs), produced by the camera component. */
export interface Recording {
	version: 1;
	frames: string[];
}

/** Simulated frame interval in ms. */
export const FRAME_INTERVAL_MS = 250;

/**
 * Feeds frames through `client` into a fresh ScanSession (frame i at nowMs = i * 250).
 * A frame whose `process` rejects is skipped (the session just doesn't see it; time
 * still advances) so one bad frame doesn't abort the replay.
 */
export async function replayFrames(
	client: OcrClient,
	frames: ImageBitmap[]
): Promise<{ text: string; status: SessionStatus }> {
	const session = new ScanSession(client.alphabet);
	let status: SessionStatus = { confirmed: 0, locked: 0, moved: false, tooSmall: false, done: false };
	for (let i = 0; i < frames.length; i++) {
		try {
			const result = await client.process(frames[i]);
			status = session.addFrame(result, i * FRAME_INTERVAL_MS);
		} catch (err) {
			console.warn(`[replay] frame ${i} failed, skipping`, err);
		}
	}
	return { text: rowsToText(session.rows()), status };
}
