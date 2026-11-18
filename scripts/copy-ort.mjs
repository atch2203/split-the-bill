// Copies the onnxruntime-web wasm binary into static/ort/ so it is served at
// `${base}/ort/` (see ort.env.wasm.wasmPaths in paddle.worker.ts).
// Runs from `npm prepare`; static/ort is gitignored.
//
// The worker imports `onnxruntime-web/webgpu` (dist/ort.webgpu.bundle.min.mjs).
// That bundle embeds its Emscripten loader, so the only file it fetches is
// ort-wasm-simd-threaded.jsep.wasm (used by both the webgpu and the wasm EP);
// with numThreads = 1 no worker .mjs is loaded either. The other dist files
// (ort-wasm-simd-threaded.wasm, *.mjs loaders) are for other bundles and would
// only bloat the deploy. The bundle's own `new URL(..., import.meta.url)`
// reference is stripped in vite.config.ts so Vite does not emit a second copy.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(root, 'static', 'ort');
const FILES = ['ort-wasm-simd-threaded.jsep.wasm'];

if (!existsSync(src)) {
	console.error(`copy-ort: ${src} not found. Run \`npm install\` first (onnxruntime-web missing).`);
	process.exit(1);
}
const missing = FILES.filter((f) => !existsSync(join(src, f)));
if (missing.length) {
	console.error(`copy-ort: missing in ${src}: ${missing.join(', ')}`);
	process.exit(1);
}
// Start clean so files dropped from FILES do not linger in static/ort.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of FILES) copyFileSync(join(src, f), join(dest, f));
console.log(`copy-ort: copied ${FILES.length} file(s) to static/ort/`);
