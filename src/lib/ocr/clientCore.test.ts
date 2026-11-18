import { describe, expect, it, vi } from 'vitest';
import { connectOcrClient, type WorkerLike } from './clientCore';
import type { WorkerRequest, WorkerResponse } from './paddleProtocol';
import type { FrameResult } from './session';

class FakeWorker implements WorkerLike {
	sent: WorkerRequest[] = [];
	terminated = false;
	onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	onmessageerror: ((e: MessageEvent) => void) | null = null;
	postMessage(msg: WorkerRequest) {
		this.sent.push(msg);
	}
	terminate() {
		this.terminated = true;
	}
	reply(msg: WorkerResponse) {
		this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
	}
	crash(message = 'boom') {
		this.onerror?.({ message } as ErrorEvent);
	}
}

const fakeBitmap = () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
const RESULT: FrameResult = { width: 1, height: 1, boxes: [] };

async function ready(w: FakeWorker) {
	const p = connectOcrClient(w, '/base');
	w.reply({ type: 'ready', backend: 'wasm', alphabet: ['a', ' '] });
	return p;
}

describe('connectOcrClient', () => {
	it('sends init with base and resolves on ready', async () => {
		const w = new FakeWorker();
		const c = await ready(w);
		expect(w.sent[0]).toEqual({ type: 'init', base: '/base' });
		expect(c.backend).toBe('wasm');
		expect(c.alphabet).toEqual(['a', ' ']);
	});

	it('rejects and terminates on an init error message', async () => {
		const w = new FakeWorker();
		const p = connectOcrClient(w, '');
		w.reply({ type: 'error', message: 'no model' });
		await expect(p).rejects.toThrow('no model');
		expect(w.terminated).toBe(true);
	});

	it('rejects and terminates when the worker crashes before ready', async () => {
		const w = new FakeWorker();
		const p = connectOcrClient(w, '');
		w.crash('script failed');
		await expect(p).rejects.toThrow('script failed');
		expect(w.terminated).toBe(true);
	});

	it('rejects and terminates on messageerror before ready', async () => {
		const w = new FakeWorker();
		const p = connectOcrClient(w, '');
		w.onmessageerror?.({} as MessageEvent);
		await expect(p).rejects.toThrow(/deserialize/);
		expect(w.terminated).toBe(true);
	});

	it('resolves and rejects frames by id', async () => {
		const w = new FakeWorker();
		const c = await ready(w);
		const a = c.process(fakeBitmap());
		const b = c.process(fakeBitmap());
		const [fa, fb] = w.sent.slice(1) as { id: number }[];
		w.reply({ type: 'error', id: fb.id, message: 'bad frame' });
		w.reply({ type: 'result', id: fa.id, result: RESULT });
		await expect(a).resolves.toBe(RESULT);
		await expect(b).rejects.toThrow('bad frame');
	});

	it('after a crash, fails pending frames and rejects later calls instead of hanging', async () => {
		const w = new FakeWorker();
		const c = await ready(w);
		const pending = c.process(fakeBitmap());
		w.crash('oom');
		await expect(pending).rejects.toThrow('oom');
		expect(w.terminated).toBe(true);
		const bmp = fakeBitmap();
		await expect(c.process(bmp)).rejects.toThrow(/oom|disposed/);
		expect(bmp.close).toHaveBeenCalled();
		expect(w.sent).toHaveLength(2); // init + first frame only
	});

	it('after messageerror, fails pending frames and rejects later calls', async () => {
		const w = new FakeWorker();
		const c = await ready(w);
		const pending = c.process(fakeBitmap());
		w.onmessageerror?.({} as MessageEvent);
		await expect(pending).rejects.toThrow(/deserialize/);
		expect(w.terminated).toBe(true);
		await expect(c.process(fakeBitmap())).rejects.toThrow();
	});

	it('closes the frame when process() is called after dispose', async () => {
		const w = new FakeWorker();
		const c = await ready(w);
		const pending = c.process(fakeBitmap());
		c.dispose();
		await expect(pending).rejects.toThrow('disposed');
		const bmp = fakeBitmap();
		await expect(c.process(bmp)).rejects.toThrow('disposed');
		expect(bmp.close).toHaveBeenCalled();
		expect(w.terminated).toBe(true);
	});
});
