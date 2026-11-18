import { base } from '$app/paths';
import { connectOcrClient, type OcrClient } from './clientCore';

export type { OcrClient } from './clientCore';

/** Spawns the PaddleOCR worker and waits for its models. Rejects on load/session failure. */
export function createOcrClient(): Promise<OcrClient> {
	const worker = new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' });
	return connectOcrClient(worker, base);
}
