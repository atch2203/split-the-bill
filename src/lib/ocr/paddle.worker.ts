/**
 * PaddleOCR (PP-OCRv5 mobile det + English rec) in a Web Worker on
 * onnxruntime-web. Protocol:
 *   in:  {type:'init', base}            out: {type:'progress', progress}*, then
 *                                            {type:'ready', backend, alphabet} | {type:'error', message}
 *   in:  {type:'frame', id, bitmap, opts?} out: {type:'result', id, result}      | {type:'error', id, message}
 */
import * as ort from 'onnxruntime-web/webgpu';
import { fetchAllWithProgress } from './download';
import { parseDict, recognizeFrame, REC_HEIGHT, REC_MIN_WIDTH, type RunModel } from './paddlePre';
import type { Backend, ProcessOptions, WorkerRequest, WorkerResponse } from './paddleProtocol';
import type { FrameResult } from './session';

// Typed minimally so this file type-checks under the DOM lib used by the app.
const ctx = self as unknown as {
	postMessage(msg: WorkerResponse): void;
	onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

interface Models {
	det: RunModel;
	rec: RunModel;
	alphabet: string[];
}
let models: Models | null = null;
// Serialize all work: ORT sessions must not run concurrently.
let queue: Promise<void> = Promise.resolve();

function post(msg: WorkerResponse) {
	ctx.postMessage(msg);
}

function errMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function runner(session: ort.InferenceSession): RunModel {
	return async (data, dims) => {
		const input = new ort.Tensor('float32', data, dims);
		const out = await session.run({ [session.inputNames[0]]: input });
		const t = out[session.outputNames[0]];
		const result = { data: (await t.getData()) as Float32Array, dims: t.dims };
		input.dispose();
		t.dispose();
		return result;
	};
}

/** Creates both sessions on `backend` and warms them up; returns the rec class count. */
async function load(detBytes: Uint8Array, recBytes: Uint8Array, backend: Backend) {
	const opts: ort.InferenceSession.SessionOptions = { executionProviders: [backend] };
	const sessions: ort.InferenceSession[] = [];
	try {
		sessions.push(await ort.InferenceSession.create(detBytes, opts));
		sessions.push(await ort.InferenceSession.create(recBytes, opts));
		const [det, rec] = sessions.map(runner);
		const probe = await rec(new Float32Array(3 * REC_HEIGHT * REC_MIN_WIDTH), [1, 3, REC_HEIGHT, REC_MIN_WIDTH]);
		return { det, rec, C: probe.dims[2] };
	} catch (e) {
		await Promise.all(sessions.map((s) => s.release()));
		throw e;
	}
}

async function init(base: string) {
	ort.env.wasm.wasmPaths = base + '/ort/';
	ort.env.wasm.numThreads = 1;

	const dictRes = await fetch(`${base}/models/dict.txt`);
	if (!dictRes.ok) throw new Error(`failed to load dict.txt: HTTP ${dictRes.status}`);
	const alphabet = parseDict(await dictRes.text());

	// Download the big files ourselves so the UI can show a progress bar; ORT
	// would otherwise fetch the wasm and models with no progress reporting.
	const [detBytes, recBytes, wasm] = await fetchAllWithProgress(
		[`${base}/models/det.onnx`, `${base}/models/rec.onnx`, `${base}/ort/ort-wasm-simd-threaded.jsep.wasm`],
		(progress) => post({ type: 'progress', progress })
	);
	ort.env.wasm.wasmBinary = wasm;
	post({ type: 'progress', progress: { stage: 'starting' } });

	let backend: Backend = 'webgpu';
	let loaded: Awaited<ReturnType<typeof load>>;
	try {
		if (!('gpu' in navigator)) throw new Error('WebGPU not available');
		loaded = await load(detBytes, recBytes, 'webgpu');
	} catch (e) {
		console.warn('[paddle] WebGPU failed, falling back to wasm:', errMessage(e));
		backend = 'wasm';
		loaded = await load(detBytes, recBytes, 'wasm');
	}
	// C must equal alphabet.length + 1 (CTC blank at class 0).
	if (loaded.C !== alphabet.length + 1) {
		throw new Error(`rec model has ${loaded.C} classes but alphabet has ${alphabet.length} (+1 blank expected)`);
	}
	models = { det: loaded.det, rec: loaded.rec, alphabet };
	console.info(`[paddle] ready on ${backend}`);
	post({ type: 'ready', backend, alphabet });
}

async function processFrame(bitmap: ImageBitmap, opts: ProcessOptions = {}): Promise<FrameResult> {
	const { width: W, height: H } = bitmap;
	try {
		if (!models) throw new Error('worker not initialized');
		const canvas = new OffscreenCanvas(W, H);
		const c2d = canvas.getContext('2d', { willReadFrequently: true });
		if (!c2d) throw new Error('OffscreenCanvas 2d context unavailable');
		c2d.drawImage(bitmap, 0, 0);
		const { data } = c2d.getImageData(0, 0, W, H);
		return await recognizeFrame(data, W, H, models.det, models.rec, models.alphabet, opts);
	} finally {
		bitmap.close();
	}
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const msg = e.data;
	queue = queue.then(async () => {
		if (msg.type === 'init') {
			try {
				await init(msg.base);
			} catch (err) {
				post({ type: 'error', message: errMessage(err) });
			}
		} else if (msg.type === 'frame') {
			try {
				post({ type: 'result', id: msg.id, result: await processFrame(msg.bitmap, msg.opts) });
			} catch (err) {
				post({ type: 'error', id: msg.id, message: errMessage(err) });
			}
		}
	});
};
