// OCR receipt photos locally with the app's exact upload path (no browser):
// JPEG decode + EXIF orientation -> PaddleOCR det/rec (src/lib/ocr/paddlePre.ts,
// det long side 2560) -> single-frame ScanSession -> rowsToText.
// Writes <photo>.ocr.txt (parser input) and <photo>.boxes.json (raw boxes, so
// row assembly can be re-run without OCR) next to each photo. Nothing leaves
// the machine.
//
//   node scripts/ocr-receipts.mjs [dir]        (default: receipts/)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import jpeg from 'jpeg-js';
import { runnerImport } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = join(root, 'static', 'models');
const dir = process.argv[2] ?? join(root, 'receipts');

/** EXIF orientation (1–8) from a JPEG's APP1 segment; 1 if absent. */
function exifOrientation(buf) {
	let i = 2;
	while (i + 4 < buf.length && buf[i] === 0xff) {
		const marker = buf[i + 1];
		const len = buf.readUInt16BE(i + 2);
		if (marker === 0xe1 && buf.toString('ascii', i + 4, i + 10) === 'Exif\0\0') {
			const t = i + 10;
			const le = buf.toString('ascii', t, t + 2) === 'II';
			const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
			const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
			const ifd = t + u32(t + 4);
			for (let e = 0; e < u16(ifd); e++) {
				const p = ifd + 2 + e * 12;
				if (u16(p) === 0x0112) return u16(p + 8);
			}
			return 1;
		}
		if (marker === 0xda) break; // start of scan: no more metadata
		i += 2 + len;
	}
	return 1;
}

/** Applies EXIF orientation to an RGBA image (what browsers do with 'from-image'). */
function orient({ data, width: W, height: H }, o) {
	if (o === 1) return { data, W, H };
	const swap = o >= 5;
	const w = swap ? H : W;
	const h = swap ? W : H;
	const out = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let nx, ny;
			switch (o) {
				case 2: nx = W - 1 - x; ny = y; break;
				case 3: nx = W - 1 - x; ny = H - 1 - y; break;
				case 4: nx = x; ny = H - 1 - y; break;
				case 5: nx = y; ny = x; break;
				case 6: nx = H - 1 - y; ny = x; break;
				case 7: nx = H - 1 - y; ny = W - 1 - x; break;
				case 8: nx = y; ny = W - 1 - x; break;
				default: nx = x; ny = y;
			}
			const s = (y * W + x) * 4;
			const d = (ny * w + nx) * 4;
			out[d] = data[s];
			out[d + 1] = data[s + 1];
			out[d + 2] = data[s + 2];
			out[d + 3] = 255;
		}
	return { data: out, W: w, H: h };
}

ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
const load = (p) => runnerImport(join(root, p), { configFile: false, logLevel: 'error' }).then((r) => r.module);
const pre = await load('src/lib/ocr/paddlePre.ts');
const { ScanSession } = await load('src/lib/ocr/session.ts');
const { rowsToText } = await load('src/lib/ocr/rows.ts');

const alphabet = pre.parseDict(readFileSync(join(models, 'dict.txt'), 'utf8'));
const opts = { executionProviders: ['wasm'], logSeverityLevel: 3 };
const det = await ort.InferenceSession.create(join(models, 'det.onnx'), opts);
const rec = await ort.InferenceSession.create(join(models, 'rec.onnx'), opts);
const runner = (s) => async (data, dims) => {
	const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, dims) });
	const t = out[s.outputNames[0]];
	return { data: t.data, dims: t.dims };
};

const photos = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f));
for (const f of photos) {
	const buf = readFileSync(join(dir, f));
	const t0 = performance.now();
	const img = orient(jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 }), exifOrientation(buf));
	const result = await pre.recognizeFrame(img.data, img.W, img.H, runner(det), runner(rec), alphabet, {
		detMaxSide: pre.UPLOAD_DET_MAX_SIDE
	});
	const session = new ScanSession(alphabet, { tracker: { confirmFrames: 1 } });
	session.addFrame(result, 0);
	const text = rowsToText(session.rows());
	const out = join(dir, basename(f, extname(f)) + '.ocr.txt');
	writeFileSync(out, text + '\n');
	const boxes = result.boxes.map((b) => ({ box: b.box, text: b.text }));
	writeFileSync(join(dir, basename(f, extname(f)) + '.boxes.json'), JSON.stringify({ width: result.width, height: result.height, boxes }));
	console.log(`${f}: ${img.W}x${img.H}, ${result.boxes.length} boxes, ${Math.round(performance.now() - t0)} ms -> ${basename(out)}`);
}
