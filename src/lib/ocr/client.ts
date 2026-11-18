import { base } from '$app/paths';
import type { FrameResult } from './session';
import type { Backend, WorkerRequest, WorkerResponse } from './paddleProtocol';

export interface OcrClient {
	alphabet: string[];
	backend: 'webgpu' | 'wasm';
	/** OCR one frame. The bitmap is transferred to the worker (unusable afterwards) and closed there. */
	process(frame: ImageBitmap): Promise<FrameResult>;
	dispose(): void;
}

/** Spawns the PaddleOCR worker and waits for its models. Rejects on load/session failure. */
export function createOcrClient(): Promise<OcrClient> {
	const worker = new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, { resolve: (r: FrameResult) => void; reject: (e: Error) => void }>();
	let nextId = 1;
	let disposed = false;

	const send = (msg: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
	const failAll = (err: Error) => {
		for (const p of pending.values()) p.reject(err);
		pending.clear();
	};

	return new Promise<OcrClient>((resolveInit, rejectInit) => {
		let ready = false;

		worker.onerror = (e) => {
			const err = new Error(`OCR worker error: ${e.message || 'unknown'}`);
			if (!ready) rejectInit(err);
			failAll(err);
		};

		worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
			const msg = e.data;
			if (msg.type === 'ready') {
				ready = true;
				resolveInit(client(msg.backend, msg.alphabet));
			} else if (msg.type === 'result') {
				pending.get(msg.id)?.resolve(msg.result);
				pending.delete(msg.id);
			} else if (msg.type === 'error') {
				const err = new Error(msg.message);
				if (msg.id === undefined) {
					if (!ready) {
						worker.terminate();
						rejectInit(err);
					} else failAll(err);
				} else {
					pending.get(msg.id)?.reject(err);
					pending.delete(msg.id);
				}
			}
		};

		function client(backend: Backend, alphabet: string[]): OcrClient {
			return {
				alphabet,
				backend,
				process(frame) {
					if (disposed) return Promise.reject(new Error('OCR client disposed'));
					const id = nextId++;
					return new Promise<FrameResult>((resolve, reject) => {
						pending.set(id, { resolve, reject });
						send({ type: 'frame', id, bitmap: frame }, [frame]);
					});
				},
				dispose() {
					if (disposed) return;
					disposed = true;
					worker.terminate();
					failAll(new Error('OCR client disposed'));
				}
			};
		}

		send({ type: 'init', base });
	});
}
