import type { Backend, ProcessOptions, WorkerRequest, WorkerResponse } from './paddleProtocol';
import type { FrameResult } from './session';

export interface OcrClient {
	alphabet: string[];
	backend: Backend;
	/**
	 * OCR one frame. The bitmap is transferred to the worker (unusable afterwards) and closed there.
	 * Rejects with `OcrClientDeadError` once the worker has died or the client was disposed.
	 */
	process(frame: ImageBitmap, opts?: ProcessOptions): Promise<FrameResult>;
	dispose(): void;
}

/**
 * Rejection reason for every `process()` call that fails because the client is
 * dead (worker crashed, message error, or disposed). A fresh client may work;
 * any other rejection is a per-frame error on a live worker.
 */
export class OcrClientDeadError extends Error {
	readonly code = 'client-dead';
	constructor(message: string) {
		super(message);
		this.name = 'OcrClientDeadError';
	}
}

export function isClientDead(err: unknown): err is OcrClientDeadError {
	return err instanceof OcrClientDeadError;
}

/** The subset of `Worker` the client uses (lets tests inject a fake). */
export interface WorkerLike {
	postMessage(msg: WorkerRequest, transfer: Transferable[]): void;
	terminate(): void;
	onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
	onerror: ((e: ErrorEvent) => void) | null;
	onmessageerror: ((e: MessageEvent) => void) | null;
}

/**
 * Drives the PaddleOCR worker protocol over `worker`: sends `init`, resolves
 * once the worker is ready, rejects (and terminates it) on any init failure.
 * After a worker crash or `messageerror` the client is dead: pending and later
 * `process()` calls reject, never hang.
 */
export function connectOcrClient(worker: WorkerLike, base: string): Promise<OcrClient> {
	const pending = new Map<number, { resolve: (r: FrameResult) => void; reject: (e: Error) => void }>();
	let nextId = 1;
	/** Set once the client can no longer process frames (disposed or worker died). */
	let dead: OcrClientDeadError | null = null;

	const kill = (err: Error) => {
		if (!dead) {
			dead = err instanceof OcrClientDeadError ? err : new OcrClientDeadError(err.message);
			worker.terminate();
		}
		for (const p of pending.values()) p.reject(dead);
		pending.clear();
	};

	return new Promise<OcrClient>((resolveInit, rejectInit) => {
		const fatal = (err: Error) => {
			kill(err);
			rejectInit(dead); // no-op once resolved
		};

		worker.onerror = (e) => fatal(new Error(`OCR worker error: ${e.message || 'unknown'}`));
		worker.onmessageerror = () => fatal(new Error('OCR worker message could not be deserialized'));

		worker.onmessage = (e) => {
			const msg = e.data;
			if (msg.type === 'ready') {
				resolveInit(client(msg.backend, msg.alphabet));
			} else if (msg.type === 'result') {
				pending.get(msg.id)?.resolve(msg.result);
				pending.delete(msg.id);
			} else if (msg.type === 'error') {
				const err = new Error(msg.message);
				if (msg.id === undefined) fatal(err);
				else {
					pending.get(msg.id)?.reject(err);
					pending.delete(msg.id);
				}
			}
		};

		function client(backend: Backend, alphabet: string[]): OcrClient {
			return {
				alphabet,
				backend,
				process(frame, opts) {
					if (dead) {
						frame.close();
						return Promise.reject(dead);
					}
					const id = nextId++;
					return new Promise<FrameResult>((resolve, reject) => {
						pending.set(id, { resolve, reject });
						try {
							worker.postMessage({ type: 'frame', id, bitmap: frame, opts }, [frame]);
						} catch (err) {
							pending.delete(id);
							frame.close();
							reject(err instanceof Error ? err : new Error(String(err)));
						}
					});
				},
				dispose() {
					kill(dead ?? new Error('OCR client disposed'));
				}
			};
		}

		worker.postMessage({ type: 'init', base }, []);
	});
}
