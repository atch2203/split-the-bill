/** Scanner load progress, reported by the worker while it starts up. */
export type LoadProgress =
	| {
			stage: 'download';
			loaded: number;
			/** Sum of all Content-Lengths; null while any is unknown or compressed. */
			total: number | null;
	  }
	| { stage: 'starting' };

/** Minimum gap between progress reports, in ms (the last one always goes out). */
const REPORT_EVERY_MS = 100;

/**
 * Fetches every URL in parallel and reports the combined byte progress.
 * Resolves with each body in `urls` order; rejects on any HTTP error.
 */
export async function fetchAllWithProgress(
	urls: string[],
	onProgress: (p: LoadProgress) => void,
	fetchFn: typeof fetch = fetch,
	now: () => number = Date.now
): Promise<Uint8Array[]> {
	const loaded = urls.map(() => 0);
	const sizes: (number | null)[] = urls.map(() => null);
	let lastReport = -Infinity;

	const report = (force = false) => {
		const t = now();
		if (!force && t - lastReport < REPORT_EVERY_MS) return;
		lastReport = t;
		const known = sizes.every((s) => s !== null);
		onProgress({
			stage: 'download',
			loaded: loaded.reduce((a, b) => a + b, 0),
			total: known ? (sizes as number[]).reduce((a, b) => a + b, 0) : null
		});
	};

	const bodies = await Promise.all(
		urls.map(async (url, i) => {
			const res = await fetchFn(url);
			if (!res.ok) throw new Error(`failed to load ${url}: HTTP ${res.status}`);
			const len = Number(res.headers.get('content-length'));
			// A compressed body's Content-Length doesn't match the bytes we read.
			if (len > 0 && !res.headers.get('content-encoding')) sizes[i] = len;
			if (!res.body) {
				const buf = new Uint8Array(await res.arrayBuffer());
				loaded[i] = sizes[i] = buf.length;
				report();
				return buf;
			}
			const chunks: Uint8Array[] = [];
			const reader = res.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				loaded[i] += value.length;
				report();
			}
			sizes[i] = loaded[i]; // exact once finished
			const out = new Uint8Array(loaded[i]);
			let off = 0;
			for (const c of chunks) {
				out.set(c, off);
				off += c.length;
			}
			return out;
		})
	);
	report(true);
	return bodies;
}
