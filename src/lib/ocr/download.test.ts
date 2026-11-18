import { describe, it, expect } from 'vitest';
import { fetchAllWithProgress, type LoadProgress } from './download';

function streamed(chunks: number[], headers: Record<string, string> = {}): Response {
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			chunks.forEach((n, i) => c.enqueue(new Uint8Array(n).fill(i + 1)));
			c.close();
		}
	});
	return new Response(body, { headers });
}

const fakeFetch =
	(map: Record<string, () => Response>): typeof fetch =>
	async (url) =>
		map[String(url)]();

describe('fetchAllWithProgress', () => {
	it('returns bodies in order and reports combined progress up to the known total', async () => {
		const seen: LoadProgress[] = [];
		let t = 0;
		const [a, b] = await fetchAllWithProgress(
			['/a', '/b'],
			(p) => seen.push(p),
			fakeFetch({
				'/a': () => streamed([3, 2], { 'content-length': '5' }),
				'/b': () => streamed([4], { 'content-length': '4' })
			}),
			() => (t += 1000) // every chunk is reported
		);
		expect([...a]).toEqual([1, 1, 1, 2, 2]);
		expect(b.length).toBe(4);
		const last = seen.at(-1)!;
		expect(last).toEqual({ stage: 'download', loaded: 9, total: 9 });
		const loads = seen.map((p) => (p.stage === 'download' ? p.loaded : -1));
		expect(loads).toEqual([...loads].sort((x, y) => x - y)); // monotonic
		expect(seen.every((p) => p.stage === 'download' && p.total === 9)).toBe(true);
	});

	it('total is null while a size is unknown or the body is compressed', async () => {
		const seen: LoadProgress[] = [];
		let t = 0;
		await fetchAllWithProgress(
			['/a', '/b'],
			(p) => seen.push(p),
			fakeFetch({
				'/a': () => streamed([3], { 'content-length': '3' }),
				'/b': () => streamed([4, 4], { 'content-length': '2', 'content-encoding': 'gzip' })
			}),
			() => (t += 1000)
		);
		const mid = seen.slice(0, -1);
		expect(mid.some((p) => p.stage === 'download' && p.total === null)).toBe(true);
		// Once everything finished the exact sizes are known.
		expect(seen.at(-1)).toEqual({ stage: 'download', loaded: 11, total: 11 });
	});

	it('throttles reports but always sends the final one', async () => {
		const seen: LoadProgress[] = [];
		await fetchAllWithProgress(
			['/a'],
			(p) => seen.push(p),
			fakeFetch({ '/a': () => streamed([1, 1, 1, 1, 1], { 'content-length': '5' }) }),
			() => 0 // clock never advances
		);
		expect(seen.length).toBe(2); // first chunk + forced final
		expect(seen.at(-1)).toEqual({ stage: 'download', loaded: 5, total: 5 });
	});

	it('rejects on an HTTP error', async () => {
		await expect(
			fetchAllWithProgress(['/x'], () => {}, async () => new Response('nope', { status: 404 }))
		).rejects.toThrow('HTTP 404');
	});
});
