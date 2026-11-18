<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { OcrClient } from '$lib/ocr/client';
	import { ScanSession, type SessionStatus } from '$lib/ocr/session';
	import { ScanFlow, containRect, fitLongSide } from '$lib/ocr/scanFlow';
	import type { Recording } from '$lib/ocr/eval/replay';

	interface Props {
		/** Owned by the parent: this component never disposes it. */
		client: OcrClient;
		onfinish: (text: string) => void;
		/** No message: user cancelled. With a message: camera unavailable, parent shows it. */
		oncancel: (message?: string) => void;
		onfatal: (message: string) => void;
	}
	let { client, onfinish, oncancel, onfatal }: Props = $props();

	const CAMERA_ERROR = 'Camera unavailable. Upload a photo instead.';
	const FATAL_ERROR = "Scanning isn't supported on this device";
	// Tailwind palette: gray-400, amber-400, green-500
	const COLOR_TENTATIVE = '#9ca3af';
	const COLOR_CONFIRMED = '#fbbf24';
	const COLOR_LOCKED = '#22c55e';

	const EMPTY_STATUS: SessionStatus = {
		confirmed: 0,
		locked: 0,
		moved: false,
		tooSmall: false,
		done: false
	};

	let videoEl: HTMLVideoElement;
	let canvasEl: HTMLCanvasElement;

	let phase = $state<'starting' | 'scanning' | 'between' | 'ended'>('starting');
	let status = $state<SessionStatus>({ ...EMPTY_STATUS });
	let part = $state(1);
	let cameraError = $state<string | null>(null);

	const flow = new ScanFlow();
	// svelte-ignore state_referenced_locally
	let session = new ScanSession(client.alphabet);
	let stream: MediaStream | null = null;
	/** Set once torn down: nothing may start again. */
	let stopped = false;
	/** Bumped whenever in-flight results must be ignored (part end, teardown). */
	let gen = 0;
	/** A `process` call is in flight (at most one at a time). */
	let busy = false;

	// Loop handles; `loopVideo` keeps the element so we can cancel after unbind.
	let loopVideo: HTMLVideoElement | null = null;
	let vfcId: number | null = null;
	let rafId: number | null = null;
	let looping = false;

	// Dev-only recording (dead code in production builds).
	let recording = $state(false);
	let recCount = $state(0);
	let recFrames: string[] | null = null;

	onMount(() => {
		void startCamera();
	});

	onDestroy(() => {
		flow.end(); // unmounted: no callback may fire afterwards
		teardown();
	});

	async function startCamera() {
		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			cameraFailed();
			return;
		}
		let s: MediaStream;
		try {
			s = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 1920 },
					height: { ideal: 1080 }
				},
				audio: false
			});
		} catch (err) {
			// NotAllowedError, NotFoundError, NotReadableError, OverconstrainedError, ...
			console.warn('[camera] getUserMedia failed', err);
			if (!stopped) cameraFailed();
			return;
		}
		if (stopped) {
			s.getTracks().forEach((t) => t.stop());
			return;
		}
		stream = s;
		videoEl.srcObject = s;
		try {
			await videoEl.play();
		} catch (err) {
			if (stopped) return;
			console.warn('[camera] video.play failed', err);
			cameraFailed();
			return;
		}
		if (stopped) return;
		phase = 'scanning';
		startLoop();
	}

	function cameraFailed() {
		cameraError = CAMERA_ERROR;
		terminate(() => oncancel(CAMERA_ERROR));
	}

	/**
	 * The single exit: claims the terminal transition (so exactly one of
	 * onfinish / oncancel / onfatal ever fires), tears down, then calls `cb`.
	 */
	function terminate(cb: () => void) {
		if (!flow.end()) return;
		teardown();
		phase = 'ended';
		cb();
	}

	/** A frame failed (bitmap capture or `process`): retry, or go fatal. */
	function frameFailed(what: string, err: unknown) {
		console.warn(`[camera] ${what} failed`, err);
		if (flow.onFrameError() === 'fatal') terminate(() => onfatal(FATAL_ERROR));
	}

	function startLoop() {
		if (stopped || looping) return;
		looping = true;
		loopVideo = videoEl;
		schedule();
	}

	function schedule() {
		if (!looping || !loopVideo) return;
		if ('requestVideoFrameCallback' in loopVideo) {
			vfcId = loopVideo.requestVideoFrameCallback(tick);
		} else {
			rafId = requestAnimationFrame(tick);
		}
	}

	function stopLoop() {
		looping = false;
		if (vfcId !== null && loopVideo && 'cancelVideoFrameCallback' in loopVideo) {
			loopVideo.cancelVideoFrameCallback(vfcId);
		}
		if (rafId !== null) cancelAnimationFrame(rafId);
		vfcId = null;
		rafId = null;
	}

	function tick() {
		vfcId = null;
		rafId = null;
		if (!looping) return;
		if (!busy && videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
			void processFrame();
		}
		schedule();
	}

	async function processFrame() {
		busy = true;
		const myGen = gen;
		try {
			let bitmap: ImageBitmap;
			try {
				bitmap = await createImageBitmap(videoEl);
			} catch (err) {
				if (myGen === gen) frameFailed('createImageBitmap', err);
				return;
			}
			if (myGen !== gen) {
				bitmap.close();
				return;
			}
			if (import.meta.env.DEV && recFrames) {
				try {
					recFrames.push(toJpeg(bitmap));
					recCount = recFrames.length;
				} catch (err) {
					console.warn('[camera] recording frame failed', err);
				}
			}
			let result;
			try {
				result = await client.process(bitmap); // transfers + closes the bitmap
			} catch (err) {
				if (myGen === gen) frameFailed('process', err);
				return;
			}
			if (myGen !== gen) return;
			flow.onFrameOk();
			status = session.addFrame(result, performance.now());
			drawOverlay(result.width, result.height);
			if (status.done) endPart();
		} finally {
			// Not gen-gated: a stale call still occupies the worker, so the next
			// part waits for it before sending another frame.
			busy = false;
		}
	}

	function drawOverlay(frameW: number, frameH: number) {
		if (!canvasEl || !videoEl) return;
		const dpr = window.devicePixelRatio || 1;
		const cw = videoEl.clientWidth;
		const ch = videoEl.clientHeight;
		const pw = Math.round(cw * dpr);
		const ph = Math.round(ch * dpr);
		if (canvasEl.width !== pw || canvasEl.height !== ph) {
			canvasEl.width = pw;
			canvasEl.height = ph;
		}
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		// The video uses object-contain: map frame px to the letterboxed display rect.
		const { scale, dx, dy } = containRect(frameW, frameH, cw, ch);
		if (scale === 0) return;
		ctx.lineWidth = 2;
		for (const t of session.tracks()) {
			ctx.strokeStyle = !t.confirmed
				? COLOR_TENTATIVE
				: t.profile.isLocked()
					? COLOR_LOCKED
					: COLOR_CONFIRMED;
			ctx.strokeRect(dx + t.box.x * scale, dy + t.box.y * scale, t.box.w * scale, t.box.h * scale);
		}
	}

	function clearOverlay() {
		const ctx = canvasEl?.getContext('2d');
		if (ctx) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		}
	}

	/** Ends the current part (auto on `done`, or the Done button). */
	function endPart() {
		if (phase !== 'scanning') return;
		gen++; // ignore any in-flight result for this part
		stopLoop();
		flow.endPart(session.rows());
		phase = 'between';
		// Freeze the frame so the last overlay stays aligned with what was scanned.
		// The stream keeps running, so the next part starts without re-prompting.
		videoEl?.pause();
	}

	function scanNextPart() {
		if (stopped || phase !== 'between') return;
		flow.nextPart();
		part = flow.part;
		session = new ScanSession(client.alphabet);
		status = { ...EMPTY_STATUS };
		clearOverlay();
		phase = 'scanning';
		videoEl?.play().catch((err) => console.warn('[camera] video.play failed', err));
		startLoop();
	}

	function finish() {
		const text = flow.finishText();
		terminate(() => onfinish(text));
	}

	function cancel() {
		terminate(() => oncancel());
	}

	/** Idempotent: stop camera tracks and loop, ignore pending results. */
	function teardown() {
		stopped = true;
		gen++;
		stopLoop();
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (videoEl) videoEl.srcObject = null;
		recFrames = null;
		recording = false;
	}

	// ---- Dev-only recording ----
	let jpegCanvas: HTMLCanvasElement | null = null;

	function toJpeg(bitmap: ImageBitmap): string {
		const { w, h } = fitLongSide(bitmap.width, bitmap.height, 1280);
		jpegCanvas ??= document.createElement('canvas');
		jpegCanvas.width = w;
		jpegCanvas.height = h;
		jpegCanvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h);
		return jpegCanvas.toDataURL('image/jpeg', 0.8);
	}

	function toggleRecord() {
		if (!import.meta.env.DEV) return;
		if (!recording) {
			recFrames = [];
			recCount = 0;
			recording = true;
			return;
		}
		const rec: Recording = { version: 1, frames: recFrames ?? [] };
		recFrames = null;
		recording = false;
		const url = URL.createObjectURL(new Blob([JSON.stringify(rec)], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="space-y-3">
	<div class="relative overflow-hidden rounded-lg border border-gray-200 bg-black">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			playsinline
			muted
			autoplay
			class="block h-[60vh] max-h-[32rem] w-full object-contain"
		></video>
		<canvas bind:this={canvasEl} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>

		{#if phase === 'starting' && !cameraError}
			<div class="absolute inset-0 flex items-center justify-center text-sm text-white/80">
				<span class="mr-2 inline-block animate-spin">&#x21bb;</span> Starting camera...
			</div>
		{/if}

		{#if part > 1}
			<div
				class="absolute top-2 left-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white"
			>
				Part {part}
			</div>
		{/if}

		{#if phase === 'scanning' && (status.moved || status.tooSmall)}
			<div
				class="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-md bg-black/70 px-3 py-1 text-sm font-medium text-white"
			>
				{status.moved ? 'Hold steady' : 'Move closer; scan in parts'}
			</div>
		{/if}
	</div>

	{#if cameraError}
		<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{cameraError}</div>
	{/if}

	<p class="text-center text-sm text-gray-600">
		{status.locked}/{status.confirmed} lines locked
	</p>

	<div class="flex gap-2" class:hidden={phase === 'ended'}>
		<button
			onclick={cancel}
			class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
		>
			Cancel
		</button>
		{#if phase === 'between'}
			<button
				onclick={scanNextPart}
				class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
			>
				Scan next part
			</button>
			<button
				onclick={finish}
				class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
			>
				Finish
			</button>
		{:else}
			<button
				onclick={endPart}
				class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
			>
				Done
			</button>
		{/if}
		{#if import.meta.env.DEV}
			<button
				onclick={toggleRecord}
				class="rounded-lg border px-3 py-2 text-xs transition-colors {recording
					? 'border-red-400 bg-red-50 text-red-700'
					: 'border-gray-300 text-gray-600 hover:bg-gray-100'}"
			>
				{recording ? `Stop (${recCount})` : 'Record'}
			</button>
		{/if}
	</div>
</div>
