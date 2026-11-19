// Scores row assembly + parseReceiptText on local receipts: every
// <name>.boxes.json (from scripts/ocr-receipts.mjs) with a hand-written
// <name>.expected.json. Rows are rebuilt from the boxes with the current
// src/lib/ocr/rows.ts, so row changes are measured without re-running OCR.
// Prints per-receipt matched items, tax/total, and (with -v) the misses.
//
//   node scripts/eval-parser.mjs [dir] [-v]     (default: receipts/)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const dir = args.find((a) => a !== '-v') ?? join(root, 'receipts');
const load = (p) => runnerImport(join(root, p), { configFile: false, logLevel: 'error' }).then((r) => r.module);
const { parseReceiptText } = await load('src/lib/utils/receiptParser.ts');
const { scoreParse } = await load('src/lib/ocr/eval/score.ts');
const { assembleRows, rowsToText } = await load('src/lib/ocr/rows.ts');

console.log = ((log) => (...a) => (String(a[0]).startsWith('[Parser]') ? undefined : log(...a)))(console.log);

let matched = 0;
let expected = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.boxes.json')).sort()) {
	const name = f.slice(0, -'.boxes.json'.length);
	const expPath = join(dir, `${name}.expected.json`);
	if (!existsSync(expPath)) continue;
	const exp = JSON.parse(readFileSync(expPath, 'utf8'));
	const { boxes } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
	const text = rowsToText(assembleRows(boxes.map((b) => ({ box: b.box, text: b.text, confidence: 1 }))));
	const got = parseReceiptText(text);
	const s = scoreParse(exp, got);
	matched += s.itemsMatched;
	expected += s.itemsExpected;
	const mark = (b) => (b ? '✓' : '✗');
	console.log(
		`${name.padEnd(28)} items ${String(s.itemsMatched).padStart(2)}/${String(s.itemsExpected).padEnd(2)}` +
			`  parsed ${String(got.items.length).padStart(2)}  tax ${mark(s.taxExact)}  total ${mark(s.totalExact)}`
	);
	if (verbose) {
		console.log(text.replace(/^/gm, '    | '));
		for (const i of got.items) console.log(`    got  ${i.quantity} × ${i.price.toFixed(2)}  ${i.name}`);
		for (const i of exp.items) console.log(`    want ${i.qty} × ${i.price.toFixed(2)}  ${i.name}`);
		console.log(`    tax ${got.taxAmount}/${exp.tax}  sub ${got.subtotal}/${exp.subtotal}  tip ${got.tipAmount}/${exp.tip}  total ${got.total}/${exp.total}`);
	}
}
console.log(`TOTAL items ${matched}/${expected} (${expected ? Math.round((100 * matched) / expected) : 0}%)`);
