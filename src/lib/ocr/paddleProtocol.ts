import type { LoadProgress } from './download';
import type { FrameResult } from './session';

/** Message protocol between client.ts and paddle.worker.ts. */
export type Backend = 'webgpu' | 'wasm';
export type WorkerRequest = { type: 'init'; base: string } | { type: 'frame'; id: number; bitmap: ImageBitmap; opts?: ProcessOptions };
/** Per-frame options. `detMaxSide`: det long-side cap (default DET_MAX_SIDE = 960). */
export interface ProcessOptions {
	detMaxSide?: number;
}
export type WorkerResponse =
	| { type: 'progress'; progress: LoadProgress }
	| { type: 'ready'; backend: Backend; alphabet: string[] }
	| { type: 'result'; id: number; result: FrameResult }
	| { type: 'error'; id?: number; message: string };
