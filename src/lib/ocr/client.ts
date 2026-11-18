import { base } from '$app/paths';
import { connectOcrClient, type OcrClient } from './clientCore';
import type { LoadProgress } from './download';

export type { OcrClient } from './clientCore';
export { OcrClientDeadError, isClientDead } from './clientCore';
export type { LoadProgress } from './download';

/**
 * Spawns the PaddleOCR worker and waits for its models. Rejects on load/session
 * failure. `onProgress` gets download bytes, then a 'starting' stage.
 */
export function createOcrClient(onProgress?: (p: LoadProgress) => void): Promise<OcrClient> {
	const worker = new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' });
	return connectOcrClient(worker, base, onProgress);
}
