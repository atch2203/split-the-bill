// Confetti + fireworks celebration, backed by canvas-confetti (single shared
// canvas, requestAnimationFrame-driven → cheap to fire repeatedly / spam).
// canvas-confetti touches `document`, so it's imported lazily to stay SSR-safe
// under adapter-static prerendering.

type ConfettiFn = (opts?: Record<string, unknown>) => unknown;

let confettiPromise: Promise<ConfettiFn> | null = null;

function getConfetti(): Promise<ConfettiFn> {
	if (!confettiPromise) {
		// canvas-confetti is a CommonJS `export =` module; under ESM interop the
		// callable is on `.default`, but fall back to the namespace just in case.
		confettiPromise = import('canvas-confetti').then(
			(m) => ((m as { default?: ConfettiFn }).default ?? (m as unknown as ConfettiFn))
		);
	}
	return confettiPromise;
}

const COLORS = ['#f87171', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9', '#fb7185'];

// Fire a burst of confetti plus a short fireworks shower. Safe to call rapidly;
// overlapping calls just add more particles to the same canvas.
export async function celebrate(): Promise<void> {
	if (typeof window === 'undefined') return;
	const confetti = await getConfetti();

	// Big opening burst from the bottom-center.
	confetti({ particleCount: 160, spread: 100, startVelocity: 45, origin: { y: 0.6 }, colors: COLORS });

	// ~1.2s of fireworks: side cannons + random aerial bursts.
	const end = Date.now() + 1200;
	(function frame() {
		confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors: COLORS });
		confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors: COLORS });
		confetti({
			particleCount: 30,
			spread: 360,
			startVelocity: 30,
			ticks: 60,
			origin: { x: Math.random(), y: Math.random() * 0.5 },
			colors: COLORS
		});
		if (Date.now() < end) requestAnimationFrame(frame);
	})();
}
