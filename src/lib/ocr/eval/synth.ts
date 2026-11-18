import { mulberry32 } from './rng';
import { synthParams, type SynthParams } from './synthParams';

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): Canvas2D {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}

function ctxOf(c: Canvas2D): Ctx {
	const ctx = c.getContext('2d') as Ctx | null;
	if (!ctx) throw new Error('2d canvas context unavailable');
	return ctx;
}

async function toJpegBlob(c: Canvas2D, quality: number): Promise<Blob> {
	if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality });
	return new Promise((resolve, reject) =>
		(c as HTMLCanvasElement).toBlob(
			(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
			'image/jpeg',
			quality
		)
	);
}

async function degrade(img: ImageBitmap, p: SynthParams): Promise<ImageBitmap> {
	const W = img.width;
	const H = img.height;

	// Geometry, blur, brightness and glare on a full-size canvas.
	const full = makeCanvas(W, H);
	const g = ctxOf(full);
	g.fillStyle = '#fff';
	g.fillRect(0, 0, W, H);
	g.save();
	g.translate(W / 2 + p.dx * W, H / 2 + p.dy * H);
	g.rotate((p.rotateDeg * Math.PI) / 180);
	g.filter = `blur(${p.blurPx}px) brightness(${p.brightness})`;
	g.drawImage(img, -W / 2, -H / 2);
	g.restore();
	g.filter = 'none';
	if (p.glare) {
		const { cx, cy, rx, ry, alpha } = p.glare;
		g.save();
		g.translate(cx * W, cy * H);
		g.scale(rx * W, ry * H);
		const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
		grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
		grad.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = grad;
		g.beginPath();
		g.arc(0, 0, 1, 0, Math.PI * 2);
		g.fill();
		g.restore();
	}

	// Downscale and back up.
	const sw = Math.max(1, Math.round(W * p.scale));
	const sh = Math.max(1, Math.round(H * p.scale));
	const small = makeCanvas(sw, sh);
	ctxOf(small).drawImage(full as CanvasImageSource, 0, 0, sw, sh);
	const up = makeCanvas(W, H);
	ctxOf(up).drawImage(small as CanvasImageSource, 0, 0, W, H);

	// JPEG round-trip.
	const blob = await toJpegBlob(up, p.quality);
	return createImageBitmap(blob);
}

/** Browser-only: n degraded copies of `img` simulating video frames. Does not consume `img`. */
export async function synthFrames(img: ImageBitmap, n: number, seed: number): Promise<ImageBitmap[]> {
	const rng = mulberry32(seed);
	const out: ImageBitmap[] = [];
	for (let i = 0; i < n; i++) out.push(await degrade(img, synthParams(rng)));
	return out;
}
