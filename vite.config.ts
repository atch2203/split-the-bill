import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * onnxruntime-web's webgpu bundle references its wasm via
 * `new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url)`, which makes
 * Vite emit a ~22 MB hashed copy. That branch is dead: paddle.worker.ts sets
 * `ort.env.wasm.wasmPaths`, so ORT uses `locateFile` and fetches
 * `${base}/ort/` (copied by scripts/copy-ort.mjs). Replace the reference with
 * the bare file name so no duplicate asset is emitted.
 */
function stripOrtWasmUrl(): Plugin {
	const ref = 'new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url).href';
	return {
		name: 'strip-ort-wasm-url',
		enforce: 'pre',
		transform(code, id) {
			if (!/onnxruntime-web[\\/]dist[\\/]ort\.webgpu\.bundle\.min\.mjs$/.test(id.split('?')[0])) return null;
			if (!code.includes(ref)) {
				this.warn('onnxruntime-web wasm URL reference not found; Vite may emit a duplicate wasm asset');
				return null;
			}
			return { code: code.replaceAll(ref, '"ort-wasm-simd-threaded.jsep.wasm"'), map: null };
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// The ORT import lives only in paddle.worker.ts, which Vite bundles separately.
	worker: {
		plugins: () => [stripOrtWasmUrl()]
	},
	// Pre-bundle canvas-confetti so its lazy dynamic import resolves in dev (it's
	// imported dynamically only, which Vite otherwise skips during dep optimization).
	optimizeDeps: {
		include: ['canvas-confetti']
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
