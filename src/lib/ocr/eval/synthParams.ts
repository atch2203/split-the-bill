export interface SynthParams {
	/** Translation as a fraction of width/height. */
	dx: number;
	dy: number;
	rotateDeg: number;
	/** 0 = no blur. */
	blurPx: number;
	brightness: number;
	/** Glare ellipse: centre and radii as fractions of the image, white alpha. */
	glare: { cx: number; cy: number; rx: number; ry: number; alpha: number } | null;
	/** Downscale factor applied then undone. */
	scale: number;
	/** JPEG quality for the round-trip. */
	quality: number;
}

const between = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);

/** Random per-frame degradation parameters (pure; all randomness comes from `rng`). */
export function synthParams(rng: () => number): SynthParams {
	const dx = between(rng, -0.02, 0.02);
	const dy = between(rng, -0.02, 0.02);
	const rotateDeg = between(rng, -1.5, 1.5);
	const blurPx = rng() < 0.3 ? between(rng, 0, 2) : 0;
	const brightness = between(rng, 0.8, 1.2);
	const glare =
		rng() < 0.2
			? {
					cx: between(rng, 0.2, 0.8),
					cy: between(rng, 0.2, 0.8),
					rx: between(rng, 0.1, 0.3),
					ry: between(rng, 0.05, 0.2),
					alpha: between(rng, 0.3, 0.6)
				}
			: null;
	const scale = between(rng, 0.7, 1);
	const quality = between(rng, 0.6, 0.9);
	return { dx, dy, rotateDeg, blurPx, brightness, glare, scale, quality };
}
