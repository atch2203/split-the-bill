import type { Box } from './tracker';

export interface DetPostOptions {
	thresh?: number;
	boxThresh?: number;
	unclipRatio?: number;
	minSize?: number;
}

/**
 * DB-style post-processing of a text-probability map (row-major [h][w]) into
 * axis-aligned boxes in prob-map pixels. No OpenCV: binarize, 4-connected
 * components via iterative flood fill, score/size filter, unclip, clamp.
 */
export function detPostprocess(prob: Float32Array, w: number, h: number, opts: DetPostOptions = {}): Box[] {
	const thresh = opts.thresh ?? 0.3;
	const boxThresh = opts.boxThresh ?? 0.6;
	const unclipRatio = opts.unclipRatio ?? 1.5;
	const minSize = opts.minSize ?? 3;

	const n = w * h;
	const visited = new Uint8Array(n);
	const stack = new Int32Array(n);
	const boxes: Box[] = [];

	for (let start = 0; start < n; start++) {
		if (visited[start] || prob[start] <= thresh) continue;
		let sp = 0;
		stack[sp++] = start;
		visited[start] = 1;
		let minX = w, minY = h, maxX = -1, maxY = -1;
		let sum = 0;
		let count = 0;
		while (sp > 0) {
			const p = stack[--sp];
			const x = p % w;
			const y = (p - x) / w;
			sum += prob[p];
			count++;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (x > 0 && !visited[p - 1] && prob[p - 1] > thresh) { visited[p - 1] = 1; stack[sp++] = p - 1; }
			if (x < w - 1 && !visited[p + 1] && prob[p + 1] > thresh) { visited[p + 1] = 1; stack[sp++] = p + 1; }
			if (y > 0 && !visited[p - w] && prob[p - w] > thresh) { visited[p - w] = 1; stack[sp++] = p - w; }
			if (y < h - 1 && !visited[p + w] && prob[p + w] > thresh) { visited[p + w] = 1; stack[sp++] = p + w; }
		}
		const bw = maxX - minX + 1;
		const bh = maxY - minY + 1;
		if (Math.min(bw, bh) < minSize) continue;
		if (sum / count < boxThresh) continue;

		const d = (bw * bh * unclipRatio) / (2 * (bw + bh));
		const x0 = Math.max(0, minX - d);
		const y0 = Math.max(0, minY - d);
		const x1 = Math.min(w, minX + bw + d);
		const y1 = Math.min(h, minY + bh + d);
		boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
	}
	return boxes;
}
