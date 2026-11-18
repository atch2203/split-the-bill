<script lang="ts">
	import { billStore } from '$lib/stores/billStore.svelte';
	import { parseReceiptText } from '$lib/utils/receiptParser';
	import { tesseractEngine } from '$lib/ocr/tesseractEngine';

	let fileInput: HTMLInputElement;
	let imagePreview = $state<string | null>(null);
	let processedPreview = $state<string | null>(null);
	let isScanning = $state(false);
	let scanError = $state<string | null>(null);
	let showRawText = $state(false);
	let showProcessed = $state(false);

	// Input mode: 'scan' for OCR, 'text' for manual text entry
	let inputMode = $state<'scan' | 'text'>('text');
	let manualText = $state('');
	let showInstructions = $state(false);

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

	async function scanImage(file: File) {
		console.log('[OCR] Starting scan...');
		console.log('[OCR] File:', file.name, 'Type:', file.type, 'Size:', file.size, 'bytes');
		isScanning = true;
		scanError = null;

		try {
			const bitmap = await createImageBitmap(file);
			tesseractEngine.onPreprocessed = (url) => (processedPreview = url);
			const text = await tesseractEngine.recognize(bitmap);
			bitmap.close();


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
