/**
 * Pure PP-OCR pre/post-processing shared by the Web Worker and the Node smoke
 * script. No DOM, no onnxruntime import: models are passed in as `RunModel`.
 */
import { reduceCtc } from './ctc';
import { detPostprocess } from './detPost';
import type { FrameResult } from './session';
import type { Box, FrameBox } from './tracker';

export const DET_MAX_SIDE = 960;
export const DET_MEAN = [0.485, 0.456, 0.406] as const;
export const DET_STD = [0.229, 0.224, 0.225] as const;
export const REC_HEIGHT = 48;
/** PP-OCRv5 rec documented image_shape [3, 48, 320]: short crops are padded to this width. */
export const REC_MIN_WIDTH = 320;
/** Upper bound of the rec model's documented dynamic width (inference.yml trt max shape). */
export const REC_MAX_WIDTH = 3200;

/** Runs one model on an NCHW float32 tensor; returns the first output. */
export type RunModel = (
	data: Float32Array,
	dims: number[]
) => Promise<{ data: Float32Array; dims: readonly number[] }>;

/** Alphabet = dict lines + ' ' (PaddleOCR `use_space_char`). */
export function parseDict(text: string): string[] {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === '') lines.pop();
	return [...lines, ' '];
}

/** Long side <= 960 (never upscaled), both sides rounded to multiples of 32 (min 32). */
export function detResizeDims(w: number, h: number): { w: number; h: number } {
	const ratio = Math.min(1, DET_MAX_SIDE / Math.max(w, h));
	const r32 = (v: number) => Math.max(32, Math.round((v * ratio) / 32) * 32);
	return { w: r32(w), h: r32(h) };
}

/**
 * Resample `region` of an RGBA image into a `dw`×`dh` area of a planar BGR
 * float tensor that is `outW` wide, applying `norm(value0to255, bgrChannel)`.
 * Bilinear sampling, supersampled (box filter) when downscaling.
 */
function sampleToBgrPlanes(
	rgba: ArrayLike<number>,
	W: number,
	H: number,
	region: Box,
	dw: number,
	dh: number,
	outW: number,
	norm: (v: number, c: number) => number
): Float32Array {
	const out = new Float32Array(3 * dh * outW);
	const plane = dh * outW;
	const sx = region.w / dw;
	const sy = region.h / dh;
	const nx = Math.max(1, Math.ceil(sx));
	const ny = Math.max(1, Math.ceil(sy));
	const inv = 1 / (nx * ny);
	const acc = [0, 0, 0];
	const bilinear = (x: number, y: number) => {
		x = Math.min(Math.max(x, 0), W - 1);
		y = Math.min(Math.max(y, 0), H - 1);
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = Math.min(x0 + 1, W - 1);
		const y1 = Math.min(y0 + 1, H - 1);
		const fx = x - x0;
		const fy = y - y0;
		const i00 = (y0 * W + x0) * 4;
		const i01 = (y0 * W + x1) * 4;
		const i10 = (y1 * W + x0) * 4;
		const i11 = (y1 * W + x1) * 4;
		for (let c = 0; c < 3; c++) {
			const top = rgba[i00 + c] * (1 - fx) + rgba[i01 + c] * fx;
			const bot = rgba[i10 + c] * (1 - fx) + rgba[i11 + c] * fx;
			acc[c] += top * (1 - fy) + bot * fy;
		}
	};
	for (let v = 0; v < dh; v++) {
		for (let u = 0; u < dw; u++) {
			acc[0] = acc[1] = acc[2] = 0;
			for (let j = 0; j < ny; j++) {
				const y = region.y + (v + (j + 0.5) / ny) * sy - 0.5;
				for (let i = 0; i < nx; i++) bilinear(region.x + (u + (i + 0.5) / nx) * sx - 0.5, y);
			}
			const o = v * outW + u;
			// acc is RGB; output planes are B, G, R.
			out[o] = norm(acc[2] * inv, 0);
			out[plane + o] = norm(acc[1] * inv, 1);
			out[2 * plane + o] = norm(acc[0] * inv, 2);
		}
	}
	return out;
}

/** Det model input: resized, ImageNet-normalized (mean/std indexed by BGR channel), NCHW. */
export function detInput(rgba: ArrayLike<number>, W: number, H: number): { data: Float32Array; w: number; h: number } {
	const { w, h } = detResizeDims(W, H);
	const data = sampleToBgrPlanes(rgba, W, H, { x: 0, y: 0, w: W, h: H }, w, h, w, (v, c) => (v / 255 - DET_MEAN[c]) / DET_STD[c]);
	return { data, w, h };
}

/**
 * Rec model input for one box (frame pixels): height 48, aspect ratio kept,
 * normalized (x/255 - 0.5)/0.5 in BGR, zero-padded on the right to >= 320.
 */
export function recInput(
	rgba: ArrayLike<number>,
	W: number,
	H: number,
	box: Box
): { data: Float32Array; width: number; contentWidth: number } {
	const contentWidth = Math.max(1, Math.min(REC_MAX_WIDTH, Math.ceil((REC_HEIGHT * box.w) / box.h)));
	const width = Math.max(REC_MIN_WIDTH, contentWidth);
	const data = sampleToBgrPlanes(rgba, W, H, box, contentWidth, REC_HEIGHT, width, (v) => (v / 255 - 0.5) / 0.5);
	return { data, width, contentWidth };
}

export function scaleBox(b: Box, sx: number, sy: number): Box {
	return { x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy };
}

/**
 * Full single-frame pipeline: det -> detPostprocess -> per-box rec -> CTC.
 * Boxes in the result are in frame pixels; boxes with empty text are dropped.
 */
export async function recognizeFrame(
	rgba: ArrayLike<number>,
	W: number,
	H: number,
	det: RunModel,
	rec: RunModel,
	alphabet: string[]
): Promise<FrameResult> {
	const d = detInput(rgba, W, H);
	const prob = await det(d.data, [1, 3, d.h, d.w]);
	const [, , ph, pw] = prob.dims;
	if (prob.dims.length !== 4 || ph !== d.h || pw !== d.w) {
		throw new Error(`unexpected det output shape [${prob.dims.join(',')}] for input ${d.w}x${d.h}`);
	}
	const sx = W / pw;
	const sy = H / ph;
	const boxes: FrameBox[] = [];
	for (const pb of detPostprocess(prob.data, pw, ph)) {
		const box = scaleBox(pb, sx, sy);
		if (box.w < 1 || box.h < 1) continue;
		const r = recInput(rgba, W, H, box);
		const out = await rec(r.data, [1, 3, REC_HEIGHT, r.width]);
		if (out.dims.length !== 3) throw new Error(`unexpected rec output shape [${out.dims.join(',')}]`);
		const [, T, C] = out.dims;
		const { text, dists } = reduceCtc(out.data, T, C, alphabet);
		if (text.trim()) boxes.push({ box, text, dists });
	}
	return { width: W, height: H, boxes };
}
