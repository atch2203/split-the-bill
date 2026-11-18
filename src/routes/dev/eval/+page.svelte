<script lang="ts">
	import { parseReceiptText } from '$lib/utils/receiptParser';
	import { tesseractEngine } from '$lib/ocr/tesseractEngine';
	import { scoreParse, type ExpectedReceipt, type Score } from '$lib/ocr/eval/score';
	import { createOcrClient, type OcrClient } from '$lib/ocr/client';
	import { rowsToText } from '$lib/ocr/rows';
	import { ScanSession } from '$lib/ocr/session';
	import { synthFrames } from '$lib/ocr/eval/synth';
	import { replayFrames, type Recording } from '$lib/ocr/eval/replay';
	import { hash } from '$lib/ocr/eval/rng';
	import { onDestroy } from 'svelte';

	interface EvalEngine {
		name: string;
		/** 'recording' engines take `<name>.recording.json` files instead of images. */
		input?: 'image' | 'recording';
		run(files: File[], name: string): Promise<string>;
	}

	// Lazily created, shared PaddleOCR worker client.
	let paddle: Promise<OcrClient> | null = null;
	function getPaddle(): Promise<OcrClient> {
		paddle ??= createOcrClient().then(
			(c) => {
				console.info(`[eval] paddle backend: ${c.backend}`);
				return c;
			},
			(err) => {
				paddle = null; // allow a retry on the next run
				throw err;
			}
		);
		return paddle;
	}

	onDestroy(() => {
		paddle?.then((c) => c.dispose(), () => {});
		paddle = null;
	});

	async function decodeDataUrl(url: string): Promise<ImageBitmap> {
		return createImageBitmap(await (await fetch(url)).blob());
	}

	const engines: EvalEngine[] = [
		{
			name: tesseractEngine.name,
			async run(files) {
				const bitmap = await createImageBitmap(files[0]);
				try {
					return await tesseractEngine.recognize(bitmap);
				} finally {
					bitmap.close();
				}
			}
		},
		{
			name: 'paddle-single',
			async run(files) {
				const client = await getPaddle();
				const result = await client.process(await createImageBitmap(files[0]));
				const session = new ScanSession(client.alphabet, { tracker: { confirmFrames: 1 } });
				session.addFrame(result, 0);
				return rowsToText(session.rows());
			}
		},
		{
			name: 'paddle-fused',
			async run(files, name) {
				const client = await getPaddle();
				const img = await createImageBitmap(files[0]);
				try {
					const frames = await synthFrames(img, 20, hash(name));
					return (await replayFrames(client, frames)).text;
				} finally {
					img.close();
				}
			}
		},
		{
			name: 'recording',
			input: 'recording',
			async run(files) {
				const client = await getPaddle();
				const rec = JSON.parse(await files[0].text()) as Recording;
				if (rec.version !== 1 || !Array.isArray(rec.frames)) throw new Error('not a Recording v1 file');
				const frames = await Promise.all(rec.frames.map(decodeDataUrl));
				return (await replayFrames(client, frames)).text;
			}
		}
	];

	interface Row {
		name: string;
		score: Score | null;
		rawText: string;
		error?: string;
	}

	let engineName = $state(engines[0].name);
	let files = $state<File[]>([]);
	let rows = $state<Row[]>([]);
	let running = $state(false);

	const totals = $derived({
		expected: rows.reduce((n, r) => n + (r.score?.itemsExpected ?? 0), 0),
		matched: rows.reduce((n, r) => n + (r.score?.itemsMatched ?? 0), 0),
		tax: rows.filter((r) => r.score?.taxExact).length,
		total: rows.filter((r) => r.score?.totalExact).length
	});

	function onFiles(e: Event) {
		files = Array.from((e.target as HTMLInputElement).files ?? []);
	}

	async function runEval() {
		const engine = engines.find((x) => x.name === engineName);
		if (!engine) return;
		running = true;
		rows = [];
		const stem = (n: string) => n.replace(/\.recording\.json$/i, '').replace(/\.[^.]+$/, '');
		const expectedFiles = new Map(
			files.filter((f) => f.name.endsWith('.expected.json')).map((f) => [f.name.replace(/\.expected\.json$/, ''), f])
		);
		const isRec = engine.input === 'recording';
		const images = files.filter((f) =>
			isRec ? /\.recording\.json$/i.test(f.name) : /\.(jpe?g|png)$/i.test(f.name)
		);
		for (const img of images) {
			const name = stem(img.name);
			try {
				const expFile = expectedFiles.get(name);
				if (!expFile) throw new Error(`missing ${name}.expected.json`);
				const expected = JSON.parse(await expFile.text()) as ExpectedReceipt;
				const rawText = await engine.run([img], name);
				rows.push({ name, score: scoreParse(expected, parseReceiptText(rawText)), rawText });
			} catch (err) {
				rows.push({ name, score: null, rawText: '', error: err instanceof Error ? err.message : String(err) });
			}
		}
		running = false;
	}

	function download() {
		const out = {
			engine: engineName,
			date: new Date().toISOString(),
			perReceipt: rows.map((r) => ({ name: r.name, score: r.score, rawText: r.rawText }))
		};
		const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `eval-${engineName}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

{#if !import.meta.env.DEV}
	<p class="p-6 text-gray-600">dev only</p>
{:else}
	<main class="mx-auto max-w-3xl space-y-4 p-6">
		<h1 class="text-xl font-bold">OCR eval</h1>
		<div class="flex flex-wrap items-center gap-3">
			<input type="file" multiple accept=".jpg,.jpeg,.png,.json" onchange={onFiles} />
			<select bind:value={engineName} class="rounded border px-2 py-1">
				{#each engines as e (e.name)}
					<option value={e.name}>{e.name}</option>
				{/each}
			</select>
			<button
				onclick={runEval}
				disabled={running || files.length === 0}
				class="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
			>
				{running ? 'Running...' : 'Run'}
			</button>
			<button
				onclick={download}
				disabled={rows.length === 0}
				class="rounded border px-3 py-1 disabled:opacity-50"
			>
				Download results JSON
			</button>
		</div>

		{#if rows.length > 0}
			<table class="w-full text-left text-sm">
				<thead>
					<tr><th>Receipt</th><th>Items</th><th>Tax</th><th>Total</th></tr>
				</thead>
				<tbody>
					{#each rows as r (r.name)}
						<tr class="border-t">
							<td>{r.name}</td>
							{#if r.score}
								<td>{r.score.itemsMatched}/{r.score.itemsExpected}</td>
								<td>{r.score.taxExact ? '✓' : '✗'}</td>
								<td>{r.score.totalExact ? '✓' : '✗'}</td>
							{:else}
								<td colspan="3" class="text-red-600">{r.error}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t font-semibold">
						<td>Total</td>
						<td>{totals.matched}/{totals.expected}</td>
						<td>{totals.tax}/{rows.length}</td>
						<td>{totals.total}/{rows.length}</td>
					</tr>
				</tfoot>
			</table>
		{/if}
	</main>
{/if}
