// Copies the onnxruntime-web wasm runtime files into static/ort/ so they are
// served at `${base}/ort/` (see ort.env.wasm.wasmPaths in paddle.worker.ts).
// Runs from `npm prepare`; static/ort is gitignored.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(root, 'static', 'ort');

if (!existsSync(src)) {
	console.error(`copy-ort: ${src} not found. Run \`npm install\` first (onnxruntime-web missing).`);
	process.exit(1);
}

// Only the runtime files ORT fetches via wasmPaths (the .wasm binaries and
// their .mjs loaders); the ort.*.mjs API bundles are imported by Vite instead.
const files = readdirSync(src).filter((f) => /^ort-wasm.*\.(wasm|mjs)$/.test(f));
if (files.length === 0) {
	console.error(`copy-ort: no ort-wasm*.{wasm,mjs} files in ${src}`);
	process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`copy-ort: copied ${files.length} files to static/ort/`);
