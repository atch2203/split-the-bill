// Node smoke test for the PaddleOCR pipeline (no browser needed).
// Loads static/models/{det,rec}.onnx with onnxruntime-web (wasm backend, which
// runs in Node), renders known text with a built-in 5x7 bitmap font, and runs
// the same det -> rec -> CTC code the Web Worker uses (src/lib/ocr/paddlePre.ts,
// loaded through Vite's module runner so no TS runner dependency is needed).
//
//   node scripts/smoke-ocr.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { runnerImport } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = join(root, 'static', 'models');

// prettier-ignore
const FONT = {
	'0': ['01110','10001','10011','10101','11001','10001','01110'],
	'1': ['00100','01100','00100','00100','00100','00100','01110'],
	'2': ['01110','10001','00001','00010','00100','01000','11111'],
	'3': ['11111','00010','00100','00010','00001','10001','01110'],
	'4': ['00010','00110','01010','10010','11111','00010','00010'],
	'5': ['11111','10000','11110','00001','00001','10001','01110'],
	'6': ['00110','01000','10000','11110','10001','10001','01110'],
	'7': ['11111','00001','00010','00100','01000','01000','01000'],
	'8': ['01110','10001','10001','01110','10001','10001','01110'],
	'9': ['01110','10001','10001','01111','00001','00010','01100'],
	'.': ['00000','00000','00000','00000','00000','01100','01100'],
	A: ['01110','10001','10001','11111','10001','10001','10001'],
	C: ['01110','10001','10000','10000','10000','10001','01110'],
	E: ['11111','10000','10000','11110','10000','10000','11111'],
	F: ['11111','10000','10000','11110','10000','10000','10000'],
	L: ['10000','10000','10000','10000','10000','10000','11111'],
	O: ['01110','10001','10001','10001','10001','10001','01110'],
	T: ['11111','00100','00100','00100','00100','00100','00100'],
	' ': ['00000','00000','00000','00000','00000','00000','00000']
};

/** Renders lines of text (black on white) to an RGBA buffer, lightly blurred. */
function render(lines, scale = 6, margin = 48, lineGap = 40) {
	const cols = Math.max(...lines.map((l) => l.length));
	const W = margin * 2 + cols * 6 * scale;
	const H = margin * 2 + lines.length * 7 * scale + (lines.length - 1) * lineGap;
	const gray = new Float32Array(W * H).fill(255);
	lines.forEach((line, li) => {
		[...line].forEach((ch, ci) => {
			const g = FONT[ch];
			if (!g) throw new Error(`no glyph for ${ch}`);
			for (let r = 0; r < 7; r++)
				for (let c = 0; c < 5; c++) {
					if (g[r][c] !== '1') continue;
					const x0 = margin + (ci * 6 + c) * scale;
					const y0 = margin + li * (7 * scale + lineGap) + r * scale;
					for (let y = y0; y < y0 + scale; y++) for (let x = x0; x < x0 + scale; x++) gray[y * W + x] = 20;
				}
		});
	});
	const rgba = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let s = 0;
			let n = 0;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx;
					const yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
					s += gray[yy * W + xx];
					n++;
				}
			rgba.set([s / n, s / n, s / n, 255], (y * W + x) * 4);
		}
	return { rgba, W, H };
}

function assert(cond, msg) {
	if (!cond) {
		console.error(`FAIL: ${msg}`);
		process.exit(1);
	}
}

ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

const { module: pre } = await runnerImport(join(root, 'src/lib/ocr/paddlePre.ts'), { configFile: false, logLevel: 'error' });

const alphabet = pre.parseDict(readFileSync(join(models, 'dict.txt'), 'utf8'));
const detS = await ort.InferenceSession.create(join(models, 'det.onnx'), { executionProviders: ['wasm'], logSeverityLevel: 3 });
const recS = await ort.InferenceSession.create(join(models, 'rec.onnx'), { executionProviders: ['wasm'], logSeverityLevel: 3 });
console.log(`onnxruntime-web ${ort.env.versions?.web ?? ''} backend=wasm (Node ${process.version})`);
console.log(`alphabet: ${alphabet.length} chars (dict + space)`);

const detShapes = [];
const recShapes = [];
const runner = (s, log) => async (data, dims) => {
	const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, dims) });
	const t = out[s.outputNames[0]];
	log.push({ in: dims, out: [...t.dims] });
	return { data: t.data, dims: t.dims };
};

const expected = ['COFFEE 3.50', 'TOTAL 12.99'];
const { rgba, W, H } = render(expected);
console.log(`image: ${W}x${H}, lines: ${JSON.stringify(expected)}`);

const t0 = performance.now();
const res = await pre.recognizeFrame(rgba, W, H, runner(detS, detShapes), runner(recS, recShapes), alphabet);
const ms = Math.round(performance.now() - t0);

const d = detShapes[0];
console.log(`det: in [${d.in}] -> out [${d.out}]`);
assert(d.out.length === 4 && d.out[0] === 1 && d.out[1] === 1 && d.out[2] === d.in[2] && d.out[3] === d.in[3], 'det output must be [1,1,H,W] matching input');
assert(recShapes.length > 0, 'no boxes detected');
for (const r of recShapes) {
	console.log(`rec: in [${r.in}] -> out [${r.out}]`);
	assert(r.out[2] === alphabet.length + 1, `C (${r.out[2]}) !== alphabet.length + 1 (${alphabet.length + 1})`);
}
// Det emits one box per word here (the bitmap font's spaces are wide), so
// group boxes into lines by vertical centre, then order each line by x.
const lines = [];
for (const b of [...res.boxes].sort((a, b) => a.box.y - b.box.y)) {
	const cy = b.box.y + b.box.h / 2;
	const line = lines.find((l) => Math.abs(l.cy - cy) < b.box.h / 2);
	if (line) line.boxes.push(b);
	else lines.push({ cy, boxes: [b] });
}
const got = lines.map((l) =>
	l.boxes
		.sort((a, b) => a.box.x - b.box.x)
		.map((b) => {
			const { x, y, w, h } = b.box;
			console.log(`box (${x.toFixed(0)},${y.toFixed(0)} ${w.toFixed(0)}x${h.toFixed(0)}): ${JSON.stringify(b.text)}`);
			return b.text.trim();
		})
		.join(' ')
);
console.log(`decoded lines: ${JSON.stringify(got)}`);
console.log(`total ${ms} ms`);
assert(JSON.stringify(got) === JSON.stringify(expected), `decoded ${JSON.stringify(got)} !== ${JSON.stringify(expected)}`);
console.log('PASS');
