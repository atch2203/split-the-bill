<script lang="ts">
	import { billStore } from '$lib/stores/billStore.svelte';
	import { parseReceiptText } from '$lib/utils/receiptParser';

	let fileInput: HTMLInputElement;
	let imagePreview = $state<string | null>(null);
	let processedPreview = $state<string | null>(null);
	let isScanning = $state(false);
	let scanError = $state<string | null>(null);
	let showRawText = $state(false);
	let showProcessed = $state(false);

	// Input mode: 'scan' for OCR, 'text' for manual text entry
	let inputMode = $state<'scan' | 'text'>('scan');
	let manualText = $state('');

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Show preview
		imagePreview = URL.createObjectURL(file);
		scanError = null;

		// Auto-scan
		await scanImage(file);
	}

	// Find the content bounds by analyzing where the dark pixels are concentrated
	function findContentBounds(
		data: Uint8ClampedArray,
		width: number,
		height: number,
		threshold: number
	): { left: number; right: number; top: number; bottom: number } {
		// Calculate row and column darkness profiles
		const colDarkness = new Array(width).fill(0);
		const rowDarkness = new Array(height).fill(0);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;
				const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
				if (gray < threshold) {
					colDarkness[x]++;
					rowDarkness[y]++;
				}
			}
		}

		// Find left/right bounds where content starts (>5% of column is dark)
		const darkThreshold = height * 0.02;
		let left = 0;
		let right = width - 1;
		let top = 0;
		let bottom = height - 1;

		// Find left edge
		for (let x = 0; x < width; x++) {
			if (colDarkness[x] > darkThreshold) {
				left = Math.max(0, x - 10); // Small margin
				break;
			}
		}

		// Find right edge
		for (let x = width - 1; x >= 0; x--) {
			if (colDarkness[x] > darkThreshold) {
				right = Math.min(width - 1, x + 10);
				break;
			}
		}

		// Find top edge
		for (let y = 0; y < height; y++) {
			if (rowDarkness[y] > width * 0.01) {
				top = Math.max(0, y - 10);
				break;
			}
		}

		// Find bottom edge
		for (let y = height - 1; y >= 0; y--) {
			if (rowDarkness[y] > width * 0.01) {
				bottom = Math.min(height - 1, y + 10);
				break;
			}
		}

		console.log('[OCR] Content bounds: left=', left, 'right=', right, 'top=', top, 'bottom=', bottom);
		return { left, right, top, bottom };
	}

	async function preprocessImage(file: File): Promise<Blob> {
		console.log('[OCR] Preprocessing image...');

		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				console.log('[OCR] Original image:', img.width, 'x', img.height);

				// First pass: load full image to find content bounds
				const tempCanvas = document.createElement('canvas');
				tempCanvas.width = img.width;
				tempCanvas.height = img.height;
				const tempCtx = tempCanvas.getContext('2d');
				if (!tempCtx) {
					reject(new Error('Could not get canvas context'));
					return;
				}
				tempCtx.drawImage(img, 0, 0);
				const tempData = tempCtx.getImageData(0, 0, img.width, img.height);

				// Find content bounds to crop out empty margins
				// Use higher threshold (220) to detect lighter/thinner text
				const bounds = findContentBounds(tempData.data, img.width, img.height, 220);
				const cropWidth = bounds.right - bounds.left;
				const cropHeight = bounds.bottom - bounds.top;
				console.log('[OCR] Cropped size:', cropWidth, 'x', cropHeight);

				// Scale up small images - Tesseract works better with higher resolution
				const MIN_WIDTH = 1200;
				let scale = 1;
				if (cropWidth < MIN_WIDTH) {
					scale = MIN_WIDTH / cropWidth;
					console.log('[OCR] Scaling up by', scale.toFixed(2) + 'x');
				}

				const canvas = document.createElement('canvas');
				canvas.width = Math.round(cropWidth * scale);
				canvas.height = Math.round(cropHeight * scale);
				console.log('[OCR] Final canvas size:', canvas.width, 'x', canvas.height);

				const ctx = canvas.getContext('2d');
				if (!ctx) {
					reject(new Error('Could not get canvas context'));
					return;
				}

				// Use better image scaling
				ctx.imageSmoothingEnabled = true;
				ctx.imageSmoothingQuality = 'high';

				// Draw cropped and scaled image
				ctx.drawImage(
					img,
					bounds.left, bounds.top, cropWidth, cropHeight, // Source rect
					0, 0, canvas.width, canvas.height // Dest rect
				);

				// Get image data
				const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
				const data = imageData.data;

				// Step 1: Convert to grayscale and collect histogram
				const grayValues: number[] = [];
				for (let i = 0; i < data.length; i += 4) {
					const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
					grayValues.push(gray);
				}

				// Step 2: Calculate Otsu's threshold for adaptive binarization
				const histogram = new Array(256).fill(0);
				for (const g of grayValues) {
					histogram[g]++;
				}

				const total = grayValues.length;
				let sum = 0;
				for (let i = 0; i < 256; i++) sum += i * histogram[i];

				let sumB = 0;
				let wB = 0;
				let maxVariance = 0;
				let threshold = 128;

				for (let t = 0; t < 256; t++) {
					wB += histogram[t];
					if (wB === 0) continue;

					const wF = total - wB;
					if (wF === 0) break;

					sumB += t * histogram[t];
					const mB = sumB / wB;
					const mF = (sum - sumB) / wF;
					const variance = wB * wF * (mB - mF) * (mB - mF);

					if (variance > maxVariance) {
						maxVariance = variance;
						threshold = t;
					}
				}

				// Step 3: Adjust threshold to be more tolerant of thin/light text
				// Boost threshold by 20% toward white to capture lighter gray as black
				const toleranceBoost = 0.20;
				const boostedThreshold = Math.min(255, threshold + (255 - threshold) * toleranceBoost);
				console.log('[OCR] Otsu threshold:', threshold, '-> boosted:', Math.round(boostedThreshold));

				// Step 4: Apply contrast stretch before thresholding
				let minGray = 255, maxGray = 0;
				for (const g of grayValues) {
					if (g < minGray) minGray = g;
					if (g > maxGray) maxGray = g;
				}
				const range = maxGray - minGray || 1;
				console.log('[OCR] Gray range:', minGray, '-', maxGray);

				// Step 5: Apply adaptive threshold with contrast stretching
				let idx = 0;
				for (let i = 0; i < data.length; i += 4) {
					// Stretch contrast
					const stretched = ((grayValues[idx] - minGray) / range) * 255;
					// Use boosted threshold for more tolerance on thin text
					const finalThreshold = ((boostedThreshold - minGray) / range) * 255;
					// Apply threshold - make text black (0) on white (255) background
					const bw = stretched > finalThreshold ? 255 : 0;
					data[i] = bw;
					data[i + 1] = bw;
					data[i + 2] = bw;
					idx++;
				}

				ctx.putImageData(imageData, 0, 0);
				console.log('[OCR] Preprocessing complete');

				// Save preview of processed image
				processedPreview = canvas.toDataURL('image/png');

				canvas.toBlob(
					(blob) => {
						if (blob) {
							console.log('[OCR] Preprocessed blob size:', blob.size, 'bytes');
							resolve(blob);
						} else {
							reject(new Error('Failed to create blob from canvas'));
						}
					},
					'image/png',
					1.0
				);
			};

			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = URL.createObjectURL(file);
		});
	}

	async function scanImage(file: File) {
		console.log('[OCR] Starting scan...');
		console.log('[OCR] File:', file.name, 'Type:', file.type, 'Size:', file.size, 'bytes');
		isScanning = true;
		scanError = null;

		try {
			// Preprocess image to black and white
			const processedBlob = await preprocessImage(file);

			// Dynamic import of tesseract.js
			console.log('[OCR] Importing tesseract.js...');
			const Tesseract = await import('tesseract.js');
			console.log('[OCR] Tesseract imported:', Object.keys(Tesseract));

			// Create worker with English language
			// Using eng but with settings optimized for receipts
			console.log('[OCR] Creating worker...');
			const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
				logger: (m: { status: string; progress: number }) => {
					if (m.status === 'recognizing text') {
						console.log('[OCR] Progress:', Math.round(m.progress * 100) + '%');
					}
				}
			});

			// Configure Tesseract for receipt scanning
			// PSM 6 = Assume a single uniform block of text
			// PSM 4 = Assume a single column of text of variable sizes
			console.log('[OCR] Setting parameters for receipt scanning...');
			await worker.setParameters({
				tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
				// Preserve spaces between words
				preserve_interword_spaces: '1',
				// Character whitelist: letters, numbers, common receipt symbols
				tessedit_char_whitelist:
					'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .$%@#&*()-+=:;\'",./\\!?<>[]{}|~`_^'
			});

			console.log('[OCR] Starting recognition...');
			const result = await worker.recognize(processedBlob);
			console.log('[OCR] Recognition complete');
			console.log('[OCR] Confidence:', result.data.confidence);
			console.log('[OCR] Lines found:', result.data.lines?.length || 0);

			await worker.terminate();
			console.log('[OCR] Worker terminated');

			const text = result.data.text;
			console.log('[OCR] Extracted text length:', text.length);
			console.log('[OCR] Raw text:\n', text);

			// Store raw OCR text
			billStore.setRawOcrText(text);

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
		} catch (err) {
			console.error('[OCR] Error:', err);
			console.error('[OCR] Error stack:', err instanceof Error ? err.stack : 'N/A');
			scanError = `Failed to scan receipt: ${err instanceof Error ? err.message : 'Unknown error'}`;
		} finally {
			isScanning = false;
			console.log('[OCR] Scan complete');
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
			Scan Image (Flash Recommended)
		</button>
		<button
			onclick={() => (inputMode = 'text')}
			class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {inputMode === 'text'
				? 'bg-white text-gray-900 shadow-sm'
				: 'text-gray-600 hover:text-gray-900'}"
		>
			Enter Text (Google Lens, etc)
		</button>
	</div>

	<div class="space-y-3">
		{#if inputMode === 'scan'}
			<!-- File Input -->
			<div class="flex gap-2">
				<label
					class="flex-1 cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center transition-colors hover:border-blue-400 hover:bg-blue-50"
				>
					<input
						bind:this={fileInput}
						type="file"
						accept="image/*"
						capture="environment"
						class="hidden"
						onchange={handleFileSelect}
					/>
					<div class="text-gray-600">
						{#if isScanning}
							<span class="inline-block animate-spin">&#x21bb;</span> Scanning...
						{:else}
							<span class="text-2xl">&#128247;</span>
							<p class="mt-1 text-sm">Tap to take photo or choose image</p>
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

			<!-- Image Preview -->
			{#if imagePreview}
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
				<textarea
					bind:value={manualText}
					placeholder="Paste or type receipt text here...&#10;&#10;Example:&#10;Burger $12.99&#10;Fries $4.50&#10;Drink $2.99"
					class="h-40 w-full resize-none rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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

		<!-- Processed Image Preview -->
		{#if processedPreview}
			<div>
				<button
					onclick={() => (showProcessed = !showProcessed)}
					class="flex w-full items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
				>
					<span>Processed Image (what OCR sees)</span>
					<span class="text-xs">{showProcessed ? '▲' : '▼'}</span>
				</button>

				{#if showProcessed}
					<img
						src={processedPreview}
						alt="Processed receipt"
						class="mt-2 max-h-64 w-full rounded-lg border border-gray-200 object-contain"
					/>
				{/if}
			</div>
		{/if}

		<!-- Raw Input Text Toggle -->
		{#if billStore.rawOcrText}
			<div>
				<button
					onclick={() => (showRawText = !showRawText)}
					class="flex w-full items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
				>
					<span>Raw Input Text</span>
					<span class="text-xs">{showRawText ? '▲' : '▼'}</span>
				</button>

				{#if showRawText}
					<pre
						class="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{billStore.rawOcrText}</pre>
				{/if}
			</div>
		{/if}
	</div>
</div>
