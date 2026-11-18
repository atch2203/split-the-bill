import type { OcrEngine } from './engine';

export interface TesseractEngine extends OcrEngine {
	/** Called with a data URL of the binarized image used for recognition. */
	onPreprocessed?: (dataUrl: string) => void;
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

async function preprocessImage(
	img: ImageBitmap,
	onPreprocessed?: (dataUrl: string) => void
): Promise<Blob> {
	console.log('[OCR] Preprocessing image...');

	return new Promise((resolve, reject) => {
		{
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
			onPreprocessed?.(canvas.toDataURL('image/png'));

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
		}
	});
}

async function recognizeTesseract(img: ImageBitmap): Promise<string> {
	// Preprocess image to black and white
	const processedBlob = await preprocessImage(img, tesseractEngine.onPreprocessed);

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

	return result.data.text;
}

export const tesseractEngine: TesseractEngine = {
	name: 'tesseract',
	recognize: recognizeTesseract
};
