import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Pre-bundle canvas-confetti so its lazy dynamic import resolves in dev (it's
	// imported dynamically only, which Vite otherwise skips during dep optimization).
	optimizeDeps: {
		include: ['canvas-confetti']
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
