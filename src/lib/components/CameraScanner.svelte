<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { isClientDead, type OcrClient } from '$lib/ocr/client';
	import { ScanSession, type SessionStatus, type TrackState } from '$lib/ocr/session';
	import { ScanFlow, containRect, fitLongSide } from '$lib/ocr/scanFlow';
	import type { Recording } from '$lib/ocr/eval/replay';
	import type { LoadProgress } from '$lib/ocr/client';
	import ScannerLoading from './ScannerLoading.svelte';

	interface Props {
		/**
		 * Resolves the parent's shared OCR client (owned by the parent: this
		 * component never disposes it). Called only after the camera is granted.
		 */
		getClient: () => Promise<OcrClient>;
		/** Progress of the parent's client load, for the loading bar. */
		loadProgress?: LoadProgress | null;
		/** The client's worker died: the parent drops it so `getClient` builds a fresh one. */
		onclientdead: () => void;
		onfinish: (text: string) => void;
		/** No message: user cancelled. With a message: camera unavailable, parent shows it. */
		oncancel: (message?: string) => void;
		onfatal: (message: string) => void;
	}
	let { getClient, loadProgress = null, onclientdead, onfinish, oncancel, onfatal }: Props = $props();

	const CAMERA_ERROR = 'Camera unavailable. Upload a photo instead.';
	const FATAL_ERROR = "Scanning isn't supported on this device";
	// Tailwind palette: gray-400, amber-400, green-500
	const COLORS: Record<TrackState, string> = {
		tentative: '#9ca3af', // grey: still forming
		ignored: 'rgba(255,255,255,0.35)', // faint: not an item line, not waited on
		pending: '#fbbf24', // amber: item line, fusing
		locked: '#22c55e' // green: item line, confident
	};

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
	/** The camera is running and the OCR client is still loading. */
	let loadingScanner = $state(false);

	const flow = new ScanFlow();
	/** Set once loaded (after the camera is granted); replaced after a worker death. */
	let client: OcrClient | null = null;
	let session: ScanSession | null = null;
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

	/** Last frame size drawn, so the overlay can be redrawn on resize/rotate. */
	let lastFrame: { w: number; h: number } | null = null;
	let prevBodyOverflow = '';

	function redraw() {
		if (lastFrame) drawOverlay(lastFrame.w, lastFrame.h);
	}

	onMount(() => {
		// Full-screen view: the page behind it must not scroll.
		prevBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		window.addEventListener('resize', redraw);
		void startCamera();
	});

	onDestroy(() => {
		flow.end(); // unmounted: no callback may fire afterwards
		teardown();
		if (typeof document !== 'undefined') {
			document.body.style.overflow = prevBodyOverflow;
			window.removeEventListener('resize', redraw);
		}
	});

	/**
	 * Camera first, then the OCR client: a denied permission must not
	 * download the models. Video playback starts while the models load.
	 */
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
		loadingScanner = true;
		const clientP = getClient();
		clientP.catch(() => {}); // handled below; avoid an unhandled rejection if play() fails first
		try {
			await videoEl.play();
		} catch (err) {
			if (stopped) return;
			console.warn('[camera] video.play failed', err);
			cameraFailed();
			return;
		}
		if (stopped) return;
		try {
			client = await clientP;
		} catch (err) {
			console.error('[camera] scanner failed to load', err);
			terminate(() => onfatal(FATAL_ERROR));
			return;
		} finally {
			loadingScanner = false;
		}
		if (stopped) return;
		session = new ScanSession(client.alphabet);
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

	/** A frame failed (bitmap capture or `process` on a live worker): retry, or go fatal. */
	function frameFailed(what: string, err: unknown) {
		console.warn(`[camera] ${what} failed`, err);
		if (flow.onFrameError() === 'fatal') terminate(() => onfatal(FATAL_ERROR));
	}

	/**
	 * The OCR worker died: get a fresh client once and keep scanning the same
	 * part; a 2nd death in this scan is fatal. Runs while `busy`, so no frame
	 * is sent until the new client is ready.
	 */
	async function workerDied(err: unknown) {
		console.warn('[camera] OCR worker died', err);
		if (flow.onWorkerDeath() === 'fatal') {
			terminate(() => onfatal(FATAL_ERROR));
			return;
		}
		onclientdead();
		try {
			const fresh = await getClient();
			if (!stopped) client = fresh;
		} catch (e) {
			console.error('[camera] scanner failed to reload', e);
			terminate(() => onfatal(FATAL_ERROR));
		}
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
		if (!busy && client && session && videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
			void processFrame();
		}
		schedule();
	}

	async function processFrame() {
		if (!client || !session) return;
		busy = true;
		const myGen = gen;
		const c = client;
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
				result = await c.process(bitmap); // transfers + closes the bitmap
			} catch (err) {
				if (stopped) return;
				// A death is handled even for a stale part: the client must be replaced.
				if (isClientDead(err)) await workerDied(err);
				else if (myGen === gen) frameFailed('process', err);
				return;
			}
			if (myGen !== gen || !session) return;
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
		lastFrame = { w: frameW, h: frameH };
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
		for (const { box, state } of session?.overlay() ?? []) {
			ctx.lineWidth = state === 'ignored' || state === 'tentative' ? 1 : 2;
			ctx.strokeStyle = COLORS[state];
			ctx.strokeRect(dx + box.x * scale, dy + box.y * scale, box.w * scale, box.h * scale);
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
		if (phase !== 'scanning' || !session) return;
		gen++; // ignore any in-flight result for this part
		stopLoop();
		flow.endPart(session.rows());
		phase = 'between';
		// Freeze the frame so the last overlay stays aligned with what was scanned.
		// The stream keeps running, so the next part starts without re-prompting.
		videoEl?.pause();
	}

	function scanNextPart() {
		if (stopped || phase !== 'between' || !client) return;
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

<!-- Full-screen camera: video fills the viewport (object-contain, so the
     overlay maps 1:1 to what's scanned); controls float over it. -->
<div
	class="fixed inset-0 z-50 flex flex-col bg-black text-white"
	style="height: 100dvh"
	role="dialog"
	aria-modal="true"
	aria-label="Scan receipt"
>
	<div class="relative min-h-0 flex-1">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			playsinline
			muted
			autoplay
			class="absolute inset-0 h-full w-full object-contain"
		></video>
		<canvas bind:this={canvasEl} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>

		<!-- Top bar -->
		<div
			class="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6"
			style="padding-top: max(0.75rem, env(safe-area-inset-top))"
		>
			<button
				onclick={cancel}
				class="rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium backdrop-blur hover:bg-black/70"
				class:invisible={phase === 'ended'}
				aria-label="Close scanner"
			>
				&#x2715; Close
			</button>
			<div class="flex items-center gap-2 text-sm">
				{#if part > 1}
					<span class="rounded-full bg-black/50 px-3 py-1.5 font-medium backdrop-blur">Part {part}</span>
				{/if}
				{#if phase === 'scanning' || phase === 'between'}
					<span class="rounded-full bg-black/50 px-3 py-1.5 backdrop-blur">
						{status.locked}/{status.confirmed} lines locked
					</span>
				{/if}
			</div>
		</div>

		{#if phase === 'starting' && !cameraError}
			<div class="absolute inset-0 flex items-center justify-center px-6 text-sm text-white/80">
				{#if loadingScanner}
					<ScannerLoading progress={loadProgress} dark />
				{:else}
					<span class="mr-2 inline-block animate-spin">&#x21bb;</span> Starting camera...
				{/if}
			</div>
		{/if}

		{#if phase === 'scanning' && (status.moved || status.tooSmall)}
			<div
				class="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/70 px-4 py-1.5 text-sm font-medium"
			>
				{status.moved ? 'Hold steady' : 'Move closer; scan in parts'}
			</div>
		{/if}

		{#if phase === 'between'}
			<div
				class="absolute inset-x-0 bottom-4 mx-auto w-fit max-w-[90%] rounded-full bg-black/70 px-4 py-1.5 text-center text-sm"
			>
				Part {part} captured. Scan the rest, or finish.
			</div>
		{/if}
	</div>

	{#if cameraError}
		<div class="bg-red-600/90 px-4 py-3 text-sm">{cameraError}</div>
	{/if}

	<!-- Bottom controls -->
	<div
		class="flex gap-2 bg-black px-4 pt-3"
		class:hidden={phase === 'ended'}
		style="padding-bottom: max(1rem, env(safe-area-inset-bottom))"
	>
		{#if phase === 'between'}
			<button
				onclick={scanNextPart}
				class="flex-1 rounded-xl border border-white/30 px-4 py-3 text-base font-medium hover:bg-white/10"
			>
				Scan next part
			</button>
			<button
				onclick={finish}
				class="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-base font-medium hover:bg-blue-700"
			>
				Finish
			</button>
		{:else}
			<button
				onclick={endPart}
				class="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-base font-medium hover:bg-blue-700"
			>
				Done
			</button>
		{/if}
		{#if import.meta.env.DEV}
			<button
				onclick={toggleRecord}
				class="rounded-xl border px-3 py-3 text-xs {recording
					? 'border-red-400 bg-red-600/30 text-red-200'
					: 'border-white/30 hover:bg-white/10'}"
			>
				{recording ? `Stop (${recCount})` : 'Record'}
			</button>
		{/if}
	</div>
</div>
