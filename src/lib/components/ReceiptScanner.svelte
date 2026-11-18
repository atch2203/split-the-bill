<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { parseReceiptText } from '$lib/utils/receiptParser';
	// Importing client.ts does not start the worker; only createOcrClient() does.
	import { createOcrClient, type LoadProgress, type OcrClient } from '$lib/ocr/client';
	import { ScanSession, type FrameResult } from '$lib/ocr/session';
	import { ProcessErrorCounter } from '$lib/ocr/scanFlow';
	import { UPLOAD_DET_MAX_SIDE } from '$lib/ocr/paddlePre';
	import { rowsToText } from '$lib/ocr/rows';
	import CameraScanner from './CameraScanner.svelte';
	import ScannerLoading from './ScannerLoading.svelte';

	const UNSUPPORTED_ERROR = "Scanning isn't supported on this device";

	let fileInput = $state<HTMLInputElement>();
	let imagePreview = $state<string | null>(null);
	let isScanning = $state(false);
	let isLoadingScanner = $state(false);
	/** Progress of the in-flight client load; null once it settles. */
	let loadProgress = $state<LoadProgress | null>(null);
	let scanError = $state<string | null>(null);

	// Input mode: 'scan' for OCR, 'text' for manual text entry
	let inputMode = $state<'scan' | 'text'>('scan');
	// Starts with the last scanned/parsed text so it can be edited and re-parsed.
	let manualText = $state(billStore.rawOcrText);
	/** The text box holds scanner output (shows an edit hint). */
	let textFromScan = $state(false);
	let showInstructions = $state(false);

	// Live camera scanning: set after mount so SSR/prerender markup matches hydration.
	let cameraSupported = $state(false);
	/** The camera scanner is mounted (it loads the client itself, after the camera is granted). */
	let cameraOpen = $state(false);

	/** Lazily created on first user action; shared by camera and upload. */
	let clientPromise: Promise<OcrClient> | null = null;
	let destroyed = false;
	/** Consecutive upload `process` failures; the 2nd is fatal. */
	const uploadErrors = new ProcessErrorCounter();

	onMount(() => {
		cameraSupported = !!navigator.mediaDevices?.getUserMedia;
	});

	onDestroy(() => {
		destroyed = true;
		dropClient();
	});

	function getClient(): Promise<OcrClient> {
		if (!clientPromise) {
			loadProgress = null;
			const p = createOcrClient((progress) => {
				if (p === clientPromise) loadProgress = progress;
			});
			clientPromise = p;
			p.then(
				() => {
					if (p === clientPromise) loadProgress = null;
				},
				() => {
					// Don't keep a failed load memoized: a later attempt retries.
					if (p === clientPromise) {
						clientPromise = null;
						loadProgress = null;
					}
				}
			);
		}
		return clientPromise;
	}

	/** Disposes the current client (now or once it loads) so the next use starts fresh. */
	function dropClient() {
		clientPromise?.then(
			(c) => c.dispose(),
			() => {}
		);
		clientPromise = null;
	}

	/** Load failure, or a fatal error from the camera scanner. */
	function scannerUnsupported() {
		dropClient();
		uploadErrors.onOk(); // a later retry starts with a fresh count
		cameraOpen = false;
		scanError = UNSUPPORTED_ERROR;
		inputMode = 'text';
	}

	/** Resolves the client with the `Loading scanner…` state; null if it failed to load. */
	async function loadClient(): Promise<OcrClient | null> {
		isLoadingScanner = true;
		try {
			return await getClient();
		} catch (err) {
			console.error('[OCR] Scanner failed to load:', err);
			if (!destroyed) scannerUnsupported();
			return null;
		} finally {
			isLoadingScanner = false;
		}
	}

	function startCamera() {
		if (isLoadingScanner || isScanning || cameraOpen) return;
		scanError = null;
		cameraOpen = true;
	}

	function handleCameraFinish(text: string) {
		cameraOpen = false;
		applyOcrText(text);
	}

	function handleCameraCancel(message?: string) {
		cameraOpen = false;
		scanError = message ?? null;
	}

	function handleCameraFatal(message: string) {
		console.error('[OCR] Camera scanner fatal:', message);
		scannerUnsupported();
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Show preview
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		imagePreview = URL.createObjectURL(file);
		scanError = null;

		// Auto-scan
		await scanImage(file);
	}

	async function scanImage(file: File) {
		console.log('[OCR] Starting scan...');
		console.log('[OCR] File:', file.name, 'Type:', file.type, 'Size:', file.size, 'bytes');
		const client = await loadClient();
		if (!client || destroyed) return;

		isScanning = true;
		scanError = null;
		let text: string;
		try {
			let bitmap: ImageBitmap;
			try {
				// Honour EXIF orientation (rotated phone photos).
				bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
			} catch (err) {
				// Bad image file: not a scanner problem, keep the client.
				reportScanError(err);
				return;
			}
			let result: FrameResult;
			try {
				// `process` consumes (closes) the bitmap. Uploads get a larger det
				// resolution than camera frames: small text on big photos survives.
				result = await client.process(bitmap, { detMaxSide: UPLOAD_DET_MAX_SIDE });
			} catch (err) {
				reportScanError(err);
				if (destroyed) return;
				if (uploadErrors.onError() === 'fatal') {
					scannerUnsupported();
				} else {
					// The worker may have died (dead-client error) or be unhealthy:
					// drop it so the next upload starts a fresh one.
					dropClient();
				}
				return;
			}
			uploadErrors.onOk();
			try {
				const session = new ScanSession(client.alphabet, { tracker: { confirmFrames: 1 } });
				session.addFrame(result, 0);
				text = rowsToText(session.rows());
			} catch (err) {
				reportScanError(err);
				return;
			}
		} finally {
			isScanning = false;
			console.log('[OCR] Scan complete');
		}
		if (destroyed) return;
		applyOcrText(text);
	}

	function reportScanError(err: unknown) {
		console.error('[OCR] Error:', err);
		console.error('[OCR] Error stack:', err instanceof Error ? err.stack : 'N/A');
		scanError = `Failed to scan receipt: ${err instanceof Error ? err.message : 'Unknown error'}`;
	}

	function applyOcrText(text: string) {
		console.log('[OCR] Extracted text length:', text.length);
		console.log('[OCR] Raw text:\n', text);

		// Store raw OCR text
		billStore.setRawOcrText(text);

		// Put the scanned text in the editable text box so misreads can be fixed
		// and re-parsed; show that tab.
		manualText = text;
		textFromScan = true;
		inputMode = 'text';
		cameraOpen = false;

		// Parse the text into items
		console.log('[OCR] Parsing text into items...');
		const parseResult = parseReceiptText(text);
		console.log('[OCR] Parse result:', parseResult);

		if (parseResult.items.length > 0) {
			billStore.setItems(parseResult.items);
			console.log('[OCR] Items set in store');

			// Auto-fill tax and tip if detected
			const settingsUpdate: { taxAmount?: number; tipAmount?: number } = {};
			if (parseResult.taxAmount !== null) {
				settingsUpdate.taxAmount = parseResult.taxAmount;
				console.log('[OCR] Tax auto-filled:', parseResult.taxAmount);
			}
			if (parseResult.tipAmount !== null) {
				settingsUpdate.tipAmount = parseResult.tipAmount;
				console.log('[OCR] Tip auto-filled:', parseResult.tipAmount);
			}
			if (Object.keys(settingsUpdate).length > 0) {
				billStore.updateSettings(settingsUpdate);
			}
		} else {
			scanError = 'No items found in receipt. Try adding items manually.';
			console.log('[OCR] No items found');
		}
	}

	function clearImage() {
		if (imagePreview) {
			URL.revokeObjectURL(imagePreview);
		}
		imagePreview = null;
		if (fileInput) {
			fileInput.value = '';
		}
	}

	function handleTextSubmit() {
		if (!manualText.trim()) {
			scanError = 'Please enter some text to parse.';
			return;
		}

		scanError = null;

		// Store raw text
		billStore.setRawOcrText(manualText);

		// Parse the text into items
		const parseResult = parseReceiptText(manualText);

		if (parseResult.items.length > 0) {
			billStore.setItems(parseResult.items);

			// Auto-fill tax and tip if detected
			const settingsUpdate: { taxAmount?: number; tipAmount?: number } = {};
			if (parseResult.taxAmount !== null) {
				settingsUpdate.taxAmount = parseResult.taxAmount;
			}
			if (parseResult.tipAmount !== null) {
				settingsUpdate.tipAmount = parseResult.tipAmount;
			}
			if (Object.keys(settingsUpdate).length > 0) {
				billStore.updateSettings(settingsUpdate);
			}
		} else {
			scanError = 'No items found in text. Make sure each item has a name and price.';
		}
	}
</script>

<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
	<!-- Tab Buttons -->
	<div class="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1">
		<button
			onclick={() => (inputMode = 'scan')}
			class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {inputMode === 'scan'
				? 'bg-white text-gray-900 shadow-sm'
				: 'text-gray-600 hover:text-gray-900'}"
		>
			Scan Image
		</button>
		<button
			onclick={() => {
				inputMode = 'text';
				cameraOpen = false; // unmounts the camera scanner, stopping the stream
			}}
			class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {inputMode === 'text'
				? 'bg-white text-gray-900 shadow-sm'
				: 'text-gray-600 hover:text-gray-900'}"
		>
			Enter Text (Google Lens, etc)
		</button>
	</div>

	<div class="space-y-3">
		{#if inputMode === 'scan'}
			{#if cameraOpen}
				<CameraScanner
					{getClient}
					{loadProgress}
					onclientdead={dropClient}
					onfinish={handleCameraFinish}
					oncancel={handleCameraCancel}
					onfatal={handleCameraFatal}
				/>
			{:else if isLoadingScanner}
				<div class="flex justify-center rounded-lg border border-gray-200 bg-gray-50 p-4">
					<ScannerLoading progress={loadProgress} />
				</div>
			{:else}
				<div class="flex gap-2">
					{#if cameraSupported}
						<button
							onclick={startCamera}
							disabled={isScanning}
							class="flex-1 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
						>
							<span class="text-2xl">&#127909;</span>
							<p class="mt-1 text-sm">Use camera</p>
						</button>
					{/if}
					<label
						class="flex-1 cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center transition-colors hover:border-blue-400 hover:bg-blue-50"
					>
						<input
							bind:this={fileInput}
							type="file"
							accept="image/*"
							class="hidden"
							disabled={isScanning}
							onchange={handleFileSelect}
						/>
						<div class="text-gray-600">
							{#if isScanning}
								<span class="inline-block animate-spin">&#x21bb;</span> Scanning...
							{:else}
								<span class="text-2xl">&#128247;</span>
								<p class="mt-1 text-sm">Upload photo</p>
							{/if}
						</div>
					</label>

					{#if imagePreview}
						<button
							onclick={clearImage}
							class="rounded-lg border border-gray-300 px-3 py-2 text-gray-600 transition-colors hover:bg-gray-100"
							title="Clear image"
						>
							&#x2715;
						</button>
					{/if}
				</div>
			{/if}

			<!-- Image Preview -->
			{#if imagePreview && !cameraOpen}
				<div class="relative overflow-hidden rounded-lg border border-gray-200">
					<img src={imagePreview} alt="Receipt preview" class="max-h-48 w-full object-contain" />
					{#if isScanning}
						<div
							class="absolute inset-0 flex items-center justify-center bg-white/80"
						>
							<div class="text-center">
								<div class="mb-2 text-2xl animate-spin">&#x21bb;</div>
								<p class="text-sm text-gray-600">Processing OCR...</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
			<!-- Text Input Mode -->
			<div class="space-y-3">
				<!-- Instructions -->
				<div class="rounded-lg bg-blue-50">
					<button
						onclick={() => (showInstructions = !showInstructions)}
						class="flex w-full items-center justify-between p-3 text-sm font-medium text-blue-800"
					>
						<span>How to extract text from your receipt</span>
						<span class="text-xs">{showInstructions ? '▲' : '▼'}</span>
					</button>
					{#if showInstructions}
						<ul class="list-inside list-disc space-y-1 px-3 pb-3 text-sm text-blue-700">
							<li><strong>iPhone/iPad:</strong> Open Camera, point at receipt, tap the Live Text icon, select all text, copy and paste here</li>
							<li><strong>Android:</strong> Open Google Lens (or hold the photo in Gallery), select all text, copy and paste here</li>
						</ul>
					{/if}
				</div>

				{#if textFromScan}
					<p class="text-sm text-gray-600">
						Scanned text below. Fix any misreads, then tap <strong>Parse Text</strong> to update the
						items.
					</p>
				{/if}
				<textarea
					bind:value={manualText}
					placeholder="Paste or type receipt text here...&#10;&#10;Example:&#10;Burger $12.99&#10;Fries $4.50&#10;Drink $2.99"
					class="h-40 w-full resize-y rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
				></textarea>
				<button
					onclick={handleTextSubmit}
					class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
				>
					Parse Text
				</button>
			</div>
		{/if}

		<!-- Error Message -->
		{#if scanError}
			<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">
				{scanError}
			</div>
		{/if}
	</div>
</div>
