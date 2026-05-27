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

const EMOJIS = ['🎉', '🎊', '🥳', '🎈', '✨', '🍾', '💸'];

// Float a batch of celebration emojis up the screen. Uses the Web Animations API
// (GPU-composited transform/opacity) and removes each node when its animation ends,
// so repeated calls don't accumulate DOM.
function floatEmojis(count = 18): void {
	for (let i = 0; i < count; i++) {
		const el = document.createElement('div');
		el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
		el.setAttribute('aria-hidden', 'true');
		el.style.cssText =
			`position:fixed;left:${Math.random() * 100}vw;bottom:-60px;` +
			`font-size:${24 + Math.random() * 28}px;pointer-events:none;` +
			`z-index:9999;will-change:transform,opacity;user-select:none;`;
		document.body.appendChild(el);

		const driftX = (Math.random() - 0.5) * 220;
		const rise = window.innerHeight + 140;
		const anim = el.animate(
			[
				{ transform: 'translate(0,0) rotate(0deg)', opacity: 0 },
				{ opacity: 1, offset: 0.12 },
				{ opacity: 1, offset: 0.8 },
				{ transform: `translate(${driftX}px,-${rise}px) rotate(${(Math.random() - 0.5) * 120}deg)`, opacity: 0 }
			],
			{ duration: 2200 + Math.random() * 1500, easing: 'ease-out', delay: Math.random() * 250 }
		);
		const cleanup = () => el.remove();
		anim.onfinish = cleanup;
		anim.oncancel = cleanup;
	}
}

// Fire a burst of confetti plus a short fireworks shower. Safe to call rapidly;
// overlapping calls just add more particles to the same canvas.
export async function celebrate(): Promise<void> {
	if (typeof window === 'undefined') return;
	const confetti = await getConfetti();

	// Floating celebration emojis alongside the confetti.
	floatEmojis(12);

	// Opening burst from the bottom-center.
	confetti({ particleCount: 90, spread: 90, startVelocity: 45, origin: { y: 0.6 }, colors: COLORS });

	// A few timed aerial bursts (not every animation frame — that's what lagged).
	let bursts = 4;
	const timer = setInterval(() => {
		confetti({
			particleCount: 25,
			spread: 360,
			startVelocity: 28,
			ticks: 55,
			origin: { x: Math.random(), y: Math.random() * 0.5 },
			colors: COLORS
		});
		if (--bursts <= 0) clearInterval(timer);
	}, 250);
}
