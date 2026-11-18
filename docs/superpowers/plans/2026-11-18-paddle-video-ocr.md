# PaddleOCR + Video Bayesian Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tesseract receipt OCR with in-browser PaddleOCR, and add a hold-steady camera scan. The camera scan fuses per-character evidence across frames (tolerating insertions and deletions) and supports multi-part scans for long receipts.

**Architecture:** A Web Worker runs the PP-OCR det + rec ONNX models on `onnxruntime-web`. It returns per-box character distributions, reduced from the CTC softmax. On the main thread, pure TypeScript modules handle the rest: box tracking (`tracker.ts`), Needleman–Wunsch profile fusion (`fusion.ts`), row assembly and multi-part merge (`rows.ts`), and a `ScanSession` that adds lock/finish logic. The final text goes to the existing `parseReceiptText`. A dev-only eval page scores engines on the user's receipt photos, using synthetic video, against a Tesseract baseline captured before Tesseract is removed.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Vite 7, `onnxruntime-web@1.20.1`, `vitest`, PP-OCR mobile ONNX models.

**Spec:** `docs/superpowers/specs/2026-11-18-paddle-video-ocr-design.md`

## Global Constraints

- Static site on GitHub Pages. No server and no third-party CDN at runtime: models, dictionary and ORT wasm are served from `static/`, with URLs prefixed by `$app/paths` `base`.
- Inference never runs on the main thread. Models load only when the scanner opens.
- ORT: WebGPU EP when available, else WASM with `ort.env.wasm.numThreads = 1`. No COOP/COEP or coi-serviceworker.
- Camera: `getUserMedia({ video: { facingMode: 'environment' } })`.
- Process the next frame only when the worker is idle (no queue).
- All fusion constants live in one exported config object (`DEFAULT_FUSION_CONFIG`).
- On Paddle failure (download, session creation, OOM, 2 consecutive worker errors), show `Scanning isn't supported on this device` and switch to manual text mode. Don't add a second OCR engine.
- Keep manual text mode unchanged. Don't change `receiptParser.ts` regexes.
- `test-receipts/` is gitignored, because it holds private receipt data.
- Remove Tesseract only after the baseline has been captured (Task 1 before Task 10).

## Review Focus

1. **Paddle splits a row differently across frames.** For example, one frame detects `BURGER 12.99` as a single box and the next as two. This must not produce duplicate or garbled rows. Pinned by test in Task 4.
2. **Frames with zero detected text** (receipt out of view, lens covered). The session must stay not-done with empty rows and must not throw. Pinned by test in Task 6.
3. **Slightly tilted receipt.** Boxes in the same row have y-centres offset by up to ~40% of box height, and must still group into one row. Pinned by test in Task 5.
4. **Camera permission denied, no camera, or insecure context.** The user sees a message and can still upload a photo. Pinned by a manual check in Task 9.
5. **Leaving mid-scan** (mode switch, unmount) or the worker crashing. The camera light turns off, there are no further worker posts, and 2 consecutive errors trigger the manual-mode fallback. Pinned by a manual check in Task 9 and an integration check in Task 10.

---

### Task 1: Test runner, scoring, and Tesseract baseline eval page

**Files:**
- Modify: `package.json` (add `vitest` devDependency, `"test": "vitest run"`)
- Modify: `vite.config.ts` (add `test: { include: ['src/**/*.test.ts'] }`)
- Modify: `.gitignore` (add `/test-receipts`)
- Create: `src/lib/ocr/eval/score.ts`, `src/lib/ocr/eval/score.test.ts`
- Create: `src/lib/ocr/engine.ts` (engine interface)
- Create: `src/lib/ocr/tesseractEngine.ts` (moves the current Tesseract call out of `ReceiptScanner.svelte`, unchanged in behaviour, including `preprocessImage`)
- Create: `src/routes/dev/eval/+page.svelte`

**Interfaces:**
- Produces:
  - `interface ExpectedReceipt { items: { name: string; qty: number; price: number }[]; tax: number | null; tip: number | null; subtotal: number | null; total: number | null }`. `price` is the unit price, matching `ReceiptItem.price`.
  - `interface Score { itemsExpected: number; itemsMatched: number; taxExact: boolean; totalExact: boolean }`
  - `scoreParse(expected: ExpectedReceipt, got: ParseResult): Score`
  - `interface OcrEngine { name: string; recognize(img: ImageBitmap): Promise<string> }` in `engine.ts`
  - `tesseractEngine: OcrEngine`
- An item matches when the price is exactly equal (within 0.005) and `nameSimilarity ≥ 0.6`, where `nameSimilarity = 1 − levenshtein(lower(a), lower(b)) / max(len)`. Each expected item is matched at most once (greedy, best similarity first). Export `levenshtein(a: string, b: string): number`; Task 5 reuses it.

- [ ] **Step 1: Write failing tests** in `score.test.ts`:
  - `scoreParse` with 3 expected items and a parse containing two exact matches, plus one with `price` 12.89 vs expected 12.99, gives `{ itemsExpected: 3, itemsMatched: 2 }`.
  - Name `"BURGR"` vs `"Burger"` at the same price matches.
  - Two parsed `"Fries" 3.00` items vs one expected `"Fries" 3.00` gives `itemsMatched: 1`.
  - `taxExact` is true when `got.taxAmount === 1.23` and expected tax is 1.23. It is false when the parse gives `null`.
  - `levenshtein('kitten','sitting') === 3`.
- [ ] **Step 2:** `npm i -D vitest && npm test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `score.ts` and `engine.ts`. Move the Tesseract code into `tesseractEngine.ts`. `ReceiptScanner.svelte` now calls `tesseractEngine.recognize`, so it still works.
- [ ] **Step 4:** `npm test`. Expected: PASS. `npm run check`. Expected: 0 errors.
- [ ] **Step 5: Eval page.** Build `src/routes/dev/eval/+page.svelte`. Render it only when `import.meta.env.DEV`; otherwise show "dev only". The page has:
  - a multi-file input taking `*.jpg|*.png` plus matching `<name>.expected.json`;
  - an engine selector (an array of `{ name, run(files) }`, extended in Task 8);
  - a per-receipt results table (matched/expected, tax ✓/✗, total ✓/✗) and totals;
  - a **Download results JSON** button, producing `{ engine, date, perReceipt: {name, score, rawText}[] }`.
- [ ] **Step 6: Manual check.** Run `npm run dev`, open `/dev/eval`, and load one receipt with a hand-written expected JSON. The table renders with the Tesseract engine.
- [ ] **Step 7: Commit** with `feat(ocr): add vitest, receipt scoring and dev eval page`.
- [ ] **Step 8: USER STEP: capture the baseline.** The user puts their photos and `*.expected.json` in `test-receipts/`, runs the Tesseract engine over all of them, and saves the downloaded JSON as `test-receipts/baseline-tesseract.json`. **Don't start Task 10 until this file exists.**

---

### Task 2: CTC reduction

**Files:**
- Create: `src/lib/ocr/ctc.ts`, `src/lib/ocr/ctc.test.ts`

**Interfaces:**
- Produces:
  - `type CharDist = Float32Array`: a dense distribution over the alphabet (length `A`, no blank), summing to 1.
  - `reduceCtc(probs: Float32Array, T: number, C: number, alphabet: string[]): { text: string; dists: CharDist[] }`. `probs` is row-major `[T][C]` softmax. Class 0 is the CTC blank, and class `i ≥ 1` maps to `alphabet[i-1]`, so `C === alphabet.length + 1`.
- Algorithm (from the spec): argmax per timestep, then collapse runs of the same non-blank class into one character. That character's dist is the mean of the run's softmax rows, with class 0 removed and the rest renormalized. A blank between two identical classes splits them into two characters.

- [ ] **Step 1: Write failing tests:**
  - alphabet `['a','b']`, rows argmax `[a,a,blank,b]` gives `text 'ab'` and 2 dists.
  - rows `[a,blank,a]` gives `'aa'`.
  - all-blank gives `''` and `[]`.
  - Dist of a 2-row run `[.1,.8,.1]`, `[.1,.6,.3]` (blank, a, b) equals the mean `[.7,.2]` renormalized, giving `[.7/.9, .2/.9]` within 1e-6.
  - `C !== alphabet.length + 1` throws.
- [ ] **Step 2:** `npm test -- ctc`. Expected: FAIL.
- [ ] **Step 3: Implement** `reduceCtc`.
- [ ] **Step 4:** `npm test -- ctc`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(ocr): reduce CTC softmax to per-character distributions`.

---

### Task 3: Per-character Bayesian fusion

**Files:**
- Create: `src/lib/ocr/fusion.ts`, `src/lib/ocr/fusion.test.ts`

**Interfaces:**
- Consumes: `CharDist` (Task 2).
- Produces:
  ```ts
  export interface FusionConfig {
    alpha: number;        // evidence tempering, 0.5
    probFloor: number;    // added before log, 1e-3
    pMiss: number;        // P(frame skips a real char), 0.1
    gapIns: number;       // NW penalty, frame inserts a char, -4
    gapDel: number;       // NW penalty, frame deletes a char, -4 (scaled down by (1 - P_k(ε)))
    lockTau: number;      // 0.95
    priceLockTau: number; // 0.98, for trailing [0-9.] columns
    minFrames: number;    // 3
    initEpsLogit: number; // starting ε log-evidence for first-frame columns, -3
  }
  export const DEFAULT_FUSION_CONFIG: FusionConfig;
  export class LineProfile {
    constructor(alphabet: string[], first: CharDist[], cfg?: FusionConfig);
    observe(obs: CharDist[]): void;
    readout(): string;
    confidence(): number;   // min over non-ε columns of max_c P_k(c); 1 if none
    isLocked(): boolean;
    readonly frames: number;
    readonly columnCount: number; // non-ε columns
  }
  ```
- Internal state per column: `logp: Float64Array` of length `A + 1`, with index `A` = ε. Posterior = softmax(logp).
- Alignment: global Needleman–Wunsch between columns `k` and obs `j`.
  - Match score `log(Σ_c P_k(c)·d_j(c) + probFloor)`.
  - Deletion (column skipped) `gapDel · (1 − P_k(ε))`.
  - Insertion `gapIns`.
  - Full O(nm) is fine; skip the band.
- Update rules (verbatim from the spec, with `n_prev = frames` before this observation):
  - **Matched:** `logp[c] += α·log(probFloor + d(c))` for c < A, and `logp[ε] += α·log(pMiss)`.
  - **Skipped:** `logp[ε] += α·log(1 − pMiss)`.
  - **Inserted:** new column with `logp[c] = α·log(probFloor + d(c))`, and `logp[ε] = n_prev · α·log(1 − pMiss) − n_prev · α·log(pMiss)` relative to the characters. In effect, it carries the ε evidence of `n_prev` skips.
- Read-out: columns with `P(ε) < 0.5`, argmax char. Lock: `frames ≥ minFrames` and every non-ε column has max P ≥ `lockTau`, or ≥ `priceLockTau` if it lies in the trailing run of `[0-9.]` chars of the readout. Not sticky.

- [ ] **Step 1: Write failing tests.** Use helper `obs(s: string, p = 0.9)`. It returns one dist per char: `p` on the char, and `(1−p)` spread over the rest of the alphabet. Alphabet = `'0123456789.$ ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')`.
  - `consistent`: 5× `obs('BURGER')` gives `readout()==='BURGER'` and `isLocked()`.
  - `not locked early`: 2× `obs('BURGER')` gives `isLocked()===false`.
  - `substitution majority`: first `obs('12.99')`, then 6× `obs('12.99')` and 3× `obs('12.89')` interleaved, gives `'12.99'`.
  - `deletion tolerated`: 8× `obs('BURGER')` and 2× `obs('BUGER')` give `'BURGER'`, `columnCount===6`.
  - `insertion tolerated`: 8× `obs('BURGER')` and 2× `obs('BURGGER')` give `'BURGER'`.
  - `bad first frame`: first `obs('BURRGER')`, then 9× `obs('BURGER')` gives `'BURGER'`.
  - `confident wrong loses`: first `obs('12.99', 0.999)`, then 6× `obs('12.89', 0.7)` gives `'12.89'`.
  - `unlocks`: 5× `obs('12.99')` gives `isLocked()===true`. Then 5× `obs('12.89')` gives `isLocked()===false`, because the evidence is now tied on one column.
  - `empty obs`: `observe([])` twice after `'AB'` ×3 keeps `'AB'` (two skips don't flip it).
- [ ] **Step 2:** `npm test -- fusion`. Expected: FAIL.
- [ ] **Step 3: Implement** `fusion.ts`.
- [ ] **Step 4:** `npm test -- fusion`. Expected: PASS. If a test fails only because of constant values, adjust `DEFAULT_FUSION_CONFIG`, not the test. Note any change in the commit message.
- [ ] **Step 5: Commit** with `feat(ocr): per-character Bayesian line fusion with indel alignment`.

---

### Task 4: Box tracker

**Files:**
- Create: `src/lib/ocr/tracker.ts`, `src/lib/ocr/tracker.test.ts`

**Interfaces:**
- Consumes: `LineProfile`, `FusionConfig` (Task 3), `CharDist` (Task 2).
- Produces:
  ```ts
  export interface Box { x: number; y: number; w: number; h: number }   // frame pixels, axis-aligned
  export interface FrameBox { box: Box; text: string; dists: CharDist[] }
  export interface Track { id: number; box: Box; profile: LineProfile; seen: number; firstFrame: number; confirmed: boolean }
  export interface TrackerConfig { iouMin: 0.3; textSimMin: 0.5; confirmFrames: 3; minSeenFrac: 0.3; moveFrac: 0.05; containFrac: 0.8 }
  export class Tracker {
    constructor(alphabet: string[], frameW: number, frameH: number, cfg?: Partial<TrackerConfig>, fusion?: FusionConfig);
    update(boxes: FrameBox[]): { shift: { dx: number; dy: number }; moved: boolean };
    get tracks(): readonly Track[];
    finalTracks(): Track[];   // confirmed && seen / (frameIndex - firstFrame + 1) >= minSeenFrac
    readonly frameIndex: number;
  }
  ```
- Shift: for each new box, take the max-IoU track. `dx`/`dy` = median centre offset over pairs with IoU ≥ `iouMin`, or `0,0` if there are none. `moved` = `hypot(dx,dy) > moveFrac · max(frameW, frameH)`.
- Matching after shifting: a greedy max-IoU pair is accepted when IoU ≥ `iouMin` and `1 − levenshtein/maxLen ≥ textSimMin`. A matched track's box is replaced by the new box, and `profile.observe(dists)` is called.
- **Split/merge guard:** an unmatched box with ≥ `containFrac` of its area inside an existing track box, or one containing ≥ `containFrac` of a track box, is ignored. No new track is created.
- Unmatched remaining boxes become new tentative tracks.

- [ ] **Step 1: Write failing tests.** Use helper `fb(x,y,w,h,text)` built with Task 3's `obs`.
  - Same 3 boxes for 3 frames gives 3 tracks, all `confirmed`.
  - All boxes shifted by (+6,+4) gives the same 3 track ids, `shift≈{6,4}`, and `moved===false` (frame 640×480).
  - Shift of (+60,0) on 640×480 gives `moved===true`.
  - A box present in 1 of 10 frames isn't in `finalTracks()`.
  - **Review Focus #1:** frames 1–5 have one box `BURGER  12.99` at (10,100,300,20). Frames 6–7 have two boxes, `BURGER` (10,100,120,20) and `12.99` (240,100,70,20). `finalTracks().length===1` and the readout is `'BURGER  12.99'`.
  - `update([])` doesn't throw. `frameIndex` increments.
- [ ] **Step 2:** `npm test -- tracker`. Expected: FAIL.
- [ ] **Step 3: Implement** `tracker.ts`.
- [ ] **Step 4:** `npm test -- tracker`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(ocr): hold-steady box tracker with shift estimate and split guard`.

---

### Task 5: Row assembly and multi-part merge

**Files:**
- Create: `src/lib/ocr/rows.ts`, `src/lib/ocr/rows.test.ts`

**Interfaces:**
- Consumes: `Box` (Task 4), `levenshtein` (Task 1).
- Produces:
  ```ts
  export interface LineResult { box: Box; text: string; confidence: number }
  export interface Row { text: string; confidence: number; y: number }   // confidence = min over its boxes
  export function assembleRows(lines: LineResult[]): Row[];          // top→bottom
  export function rowsToText(rows: Row[]): string;                     // join '\n'
  export function mergeParts(acc: Row[], next: Row[], maxDist?: number): Row[]; // default 0.2
  ```
- Grouping: sort by y-centre. A box joins the current row when `|yc − rowYc| ≤ 0.5 · max(h, rowH)`. Within a row, sort by x and join with **two spaces**.
- Merge: find the largest `L` such that, for all `i < L`, `normDist(acc[acc.length−L+i].text, next[i].text) ≤ maxDist`, where `normDist = levenshtein/maxLen`. For each overlapping pair, keep the higher-confidence row. Append `next.slice(L)`. If `L = 0`, concatenate.

- [ ] **Step 1: Write failing tests:**
  - `BURGER` (x 10) and `12.99` (x 240) at the same y give a row text of `'BURGER  12.99'`.
  - **Review Focus #3:** boxes h=20 with yc 100 and 108 form one row. yc 100 and 125 form two rows.
  - `rowsToText` produces top-to-bottom order.
  - `mergeParts(['A 1','B 2','C 3'], ['B 2','C 3','D 4'])` gives the texts `['A 1','B 2','C 3','D 4']`.
  - Overlap with OCR noise: `'C 3'` vs `'C 3.'` still overlaps. The kept row is the one with the higher confidence.
  - No overlap concatenates all rows.
  - `mergeParts([], next)` returns `next`.
- [ ] **Step 2:** `npm test -- rows`. Expected: FAIL.
- [ ] **Step 3: Implement** `rows.ts`.
- [ ] **Step 4:** `npm test -- rows`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(ocr): row assembly and multi-part overlap merge`.

---

### Task 6: ScanSession (finish logic and hints)

**Files:**
- Create: `src/lib/ocr/session.ts`, `src/lib/ocr/session.test.ts`

**Interfaces:**
- Consumes: `Tracker`, `FrameBox`, `TrackerConfig` (Task 4); `assembleRows`, `Row` (Task 5).
- Produces:
  ```ts
  export interface FrameResult { width: number; height: number; boxes: FrameBox[] }
  export interface SessionStatus { confirmed: number; locked: number; moved: boolean; tooSmall: boolean; done: boolean }
  export class ScanSession {
    constructor(alphabet: string[], opts?: { settleMs?: number; minTextPx?: number; tracker?: Partial<TrackerConfig> }); // 1000, 16
    addFrame(r: FrameResult, nowMs: number): SessionStatus;
    rows(): Row[];      // from tracker.finalTracks() → LineResult{box, readout, confidence}
    tracks(): readonly Track[];  // for the overlay
  }
  ```
- The tracker is created lazily on the first frame, using its width and height.
- `tooSmall` = the median box `h` in this frame is `< minTextPx` and there is at least 1 box.
- `done` = `confirmed > 0`, `locked === confirmed`, and no track became confirmed in the last `settleMs`.

- [ ] **Step 1: Write failing tests:**
  - 5 identical frames of 3 boxes at t=0..400 (100 ms apart): `done===false` at t=400, `done===true` after an identical frame at t=1500.
  - A 4th box first seen at t=1200 (confirmed at t=1400, its 3rd frame) resets settle, so `done===false` at t=1500.
  - **Review Focus #2:** 10 frames with `boxes: []` give `done===false`, `rows()` equal to `[]`, and no throw.
  - Boxes with h=10 give `tooSmall===true`. Boxes with h=24 give `false`.
- [ ] **Step 2:** `npm test -- session`. Expected: FAIL.
- [ ] **Step 3: Implement** `session.ts`.
- [ ] **Step 4:** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** with `feat(ocr): scan session with lock, settle and size hints`.

---

### Task 7: Paddle worker, client and models

**Files:**
- Create: `static/models/det.onnx`, `static/models/rec.onnx`, `static/models/dict.txt`, `static/models/README.md` (source URL, PP-OCR version, licence Apache-2.0, input sizes)
- Create: `scripts/copy-ort.mjs`, which copies `node_modules/onnxruntime-web/dist/*.{wasm,mjs}` into `static/ort/`
- Modify: `package.json`: add the dep `onnxruntime-web@1.20.1`, and change `prepare` to `node scripts/copy-ort.mjs && svelte-kit sync || echo ''`
- Modify: `.gitignore`: add `/static/ort`
- Create: `src/lib/ocr/detPost.ts`, `src/lib/ocr/detPost.test.ts`
- Create: `src/lib/ocr/paddle.worker.ts`, `src/lib/ocr/client.ts`

**Interfaces:**
- Consumes: `reduceCtc`, `CharDist` (Task 2); `FrameBox`, `Box` (Task 4); `FrameResult` (Task 6).
- Produces:
  ```ts
  // detPost.ts
  export function detPostprocess(prob: Float32Array, w: number, h: number,
    opts?: { thresh?: number; boxThresh?: number; unclipRatio?: number; minSize?: number }): Box[]; // 0.3, 0.6, 1.5, 3
  // client.ts
  export interface OcrClient { alphabet: string[]; backend: 'webgpu' | 'wasm'; process(frame: ImageBitmap): Promise<FrameResult>; dispose(): void }
  export function createOcrClient(): Promise<OcrClient>;   // rejects on load/session failure
  ```
- Worker protocol:
  - `{type:'init', base}` → `{type:'ready', backend, alphabet}` | `{type:'error', message}`
  - `{type:'frame', id, bitmap}` (bitmap transferred) → `{type:'result', id, result: FrameResult}` | `{type:'error', id, message}`
- The worker is created with `new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' })`.
- `detPostprocess`:
  - binarize at `thresh`;
  - 4-connected components (iterative flood fill, no OpenCV);
  - drop components whose mean prob is < `boxThresh` or whose bbox side is < `minSize`;
  - unclip the axis-aligned rect by `d = area·unclipRatio/perimeter` on every side;
  - clamp to the image.
  Boxes are in prob-map pixels. The worker scales them back to frame pixels.
- Det preprocessing: resize so the long side is ≤ 960, rounded to multiples of 32. Normalize mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`, in BGR channel order (Paddle trains on cv2 BGR). Layout NCHW.
- Rec preprocessing: crop each box from the frame and resize to height 48, keeping the aspect ratio. Width is capped at 320 for v4, or the model's own documented size. Normalize `(x/255 − 0.5)/0.5`, in BGR. Batch boxes with equal padded width, or run them one at a time. Output `[N,T,C]` softmax goes to `reduceCtc`.
- Alphabet = `dict.txt` lines plus `' '` appended (`use_space_char`). Assert `C === alphabet.length + 1` at load.
- ORT: `import * as ort from 'onnxruntime-web/webgpu'`. Set `ort.env.wasm.wasmPaths = base + '/ort/'` and `ort.env.wasm.numThreads = 1`. Try `executionProviders: ['webgpu']`, and on failure `['wasm']`.

- [ ] **Step 1: Write failing tests** in `detPost.test.ts`:
  - 100×50 map, zeros except a 40×10 block of 0.9 at (10,20): one box containing (10,20,40,10), slightly larger due to unclip, and clamped inside 100×50.
  - Two separated blocks give 2 boxes.
  - A block of 0.4 gives 0 boxes (fails `boxThresh`).
  - A 2×2 block gives 0 boxes (`minSize`).
- [ ] **Step 2:** `npm test -- detPost`. Expected: FAIL.
- [ ] **Step 3: Implement** `detPostprocess`.
- [ ] **Step 4:** `npm test -- detPost`. Expected: PASS.
- [ ] **Step 5: Get models.** Choose PP-OCRv4 or v5 mobile det + English rec ONNX exports and the matching dict. Put them in `static/models/` and fill in the README. Keep the total under ~20 MB.
- [ ] **Step 6: Implement** `scripts/copy-ort.mjs`, `paddle.worker.ts` and `client.ts`. Run `npm i` and `ls static/ort`. Expected: `.wasm` files present.
- [ ] **Step 7: Smoke check.** Temporarily add a `paddle-single` engine to the eval page (finalized in Task 8). On one receipt photo, the raw text looks like the receipt, and the console shows the backend. Then `npm run check`. Expected: 0 errors. `npm run build`. Expected: success, and `build/models/*.onnx` exists.
- [ ] **Step 8: Commit** with `feat(ocr): PaddleOCR onnxruntime-web worker and client`.

---

### Task 8: Eval with Paddle and synthetic video; tune constants

**Files:**
- Create: `src/lib/ocr/eval/synth.ts`, `src/lib/ocr/eval/rng.ts`, `src/lib/ocr/eval/rng.test.ts`
- Create: `src/lib/ocr/eval/replay.ts`
- Modify: `src/routes/dev/eval/+page.svelte`

**Interfaces:**
- Consumes: `createOcrClient` (Task 7), `ScanSession` (Task 6), `rowsToText` (Task 5), `scoreParse` (Task 1).
- Produces:
  - `mulberry32(seed: number): () => number`
  - `synthFrames(img: ImageBitmap, n: number, seed: number): Promise<ImageBitmap[]>`
  - `replayFrames(client: OcrClient, frames: ImageBitmap[]): Promise<{ text: string; status: SessionStatus }>`, which feeds a fresh `ScanSession` with `nowMs = i·250`
  - `interface Recording { version: 1; frames: string[] }` (JPEG data URLs, consumed by Task 9)
- `synthFrames` applies, per frame, on a canvas with seeded randomness:
  - translate ±2% and rotate ±1.5°;
  - box-blur radius 0–2 px on 30% of frames;
  - brightness ×0.8–1.2;
  - a glare ellipse (white radial gradient, alpha 0.3–0.6) on 20% of frames;
  - downscale to 70–100% and back up;
  - JPEG round-trip at quality 0.6–0.9.

- [ ] **Step 1: Write a failing test:** `mulberry32(1)` called twice yields a deterministic, known pair (record the values once and assert them). Also, two generators with the same seed produce equal sequences.
- [ ] **Step 2:** `npm test -- rng`. Expected: FAIL. Then implement. Then PASS.
- [ ] **Step 3: Implement** `synth.ts` and `replay.ts`. Add the eval engines:
  - `paddle-single`: one `process` call, then `ScanSession` with 1 frame, then `rowsToText`. A 1-frame session uses `new ScanSession(alphabet, { tracker: { confirmFrames: 1 } })`.
  - `paddle-fused`: `synthFrames(img, 20, seed=hash(name))`, then `replayFrames`.
  - `recording`: accepts a `Recording` JSON file and replays it with `expected` taken from a same-name `.expected.json`.
- [ ] **Step 4: Run eval** on all receipts with `paddle-single` and `paddle-fused`. Save the JSONs to `test-receipts/`.
- [ ] **Step 5: Tune.** If `paddle-fused` < `paddle-single` on any receipt, inspect the raw text diff and adjust `DEFAULT_FUSION_CONFIG` or `TrackerConfig`. Re-run `npm test` after each change; all tests must stay green. Stop when fused ≥ single on the total matched items **and** both beat `baseline-tesseract.json`. Record the three totals in the commit message.
- [ ] **Step 6: Commit** with `feat(ocr): synthetic-video eval; tuned fusion constants (tess X/N, single Y/N, fused Z/N)`.

---

### Task 9: CameraScanner component

**Files:**
- Create: `src/lib/components/CameraScanner.svelte`

**Interfaces:**
- Consumes: `createOcrClient`, `OcrClient` (Task 7); `ScanSession` (Task 6); `mergeParts`, `rowsToText`, `Row` (Task 5); `Recording` (Task 8).
- Produces: `<CameraScanner client={OcrClient} onfinish={(text: string) => void} oncancel={() => void} onfatal={(msg: string) => void} />`
- Behaviour, from the spec:
  - `<video playsinline muted>` with an overlay `<canvas>` scaled to the video. Track boxes are grey when tentative, amber when confirmed, green when locked.
  - Progress shows `"{locked}/{confirmed} lines locked"`. When `moved`, show `Hold steady`. When `tooSmall`, show `Move closer; scan in parts`. A `Part {n}` label appears when n > 1.
  - Loop: `requestVideoFrameCallback`, or rAF as a fallback, then `createImageBitmap(video)` only when there is no pending `process`.
  - When the session reaches `done`, or the user taps **Done** (always enabled), the part ends. Its rows are merged with `mergeParts(acc, session.rows())`. The UI shows **Scan next part** (new `ScanSession`) and **Finish**, which calls `onfinish(rowsToText(acc))`.
  - Errors: 2 consecutive `process` rejections call `onfatal("Scanning isn't supported on this device")`. A single rejection is retried on the next frame.
  - Cleanup in `onDestroy`, cancel and finish: stop all `MediaStreamTrack`s, stop the loop, and ignore any pending result. The client is owned by the parent; don't dispose it here.
  - Camera errors (`NotAllowedError`, `NotFoundError`, `!isSecureContext`, no `navigator.mediaDevices`) call `oncancel()` after showing the message `Camera unavailable. Upload a photo instead.` for the parent to display.
  - The dev-only (`import.meta.env.DEV`) **Record** toggle pushes each processed frame as a JPEG data URL (long side ≤ 1280, quality 0.8). On stop, it downloads `recording-<timestamp>.json` as a `Recording`.

- [ ] **Step 1: Implement** the component.
- [ ] **Step 2:** `npm run check`. Expected: 0 errors.
- [ ] **Step 3: Manual check on a phone** (`npm run dev -- --host`, over HTTPS via a tunnel or `vite --https`):
  - Boxes appear and turn green, and auto-finish fires.
  - On a long receipt, two parts merge without duplicating the overlap rows.
  - **Review Focus #4:** deny camera permission. The message shows and the upload option remains.
  - **Review Focus #5:** switch to text mode mid-scan. The camera indicator turns off.
  - Record downloads a JSON that the eval page `recording` engine replays.
- [ ] **Step 4: Commit** with `feat(ocr): hold-steady camera scanner with multi-part scans`.

---

### Task 10: Integrate into ReceiptScanner; remove Tesseract

**Precondition:** `test-receipts/baseline-tesseract.json` exists (Task 1 Step 8).

**Files:**
- Modify: `src/lib/components/ReceiptScanner.svelte`
- Delete: `src/lib/ocr/tesseractEngine.ts`, and the tesseract engine entry in `src/routes/dev/eval/+page.svelte`
- Modify: `package.json`: remove `tesseract.js` and `scribe.js-ocr`

**Interfaces:**
- Consumes: `createOcrClient` (Task 7), `ScanSession` (Task 6), `rowsToText` (Task 5), `CameraScanner` (Task 9). Also existing APIs: `billStore.setRawOcrText`, `parseReceiptText`, `billStore.setItems`, `billStore.updateSettings`.
- Behaviour:
  - Scan mode shows **Use camera** (only if `navigator.mediaDevices?.getUserMedia`) and **Upload photo**.
  - Selecting either lazily calls `createOcrClient()` once, with a loading state `Loading scanner…`. A rejection sets `scanError = "Scanning isn't supported on this device"` and `inputMode = 'text'`.
  - Upload path: `createImageBitmap(file)`, then `client.process`, then a single-frame `ScanSession` (`{ tracker: { confirmFrames: 1 } }`), then `rowsToText`.
  - Both paths then run the existing post-OCR block, which is unchanged and moved into `applyOcrText(text: string)`: `setRawOcrText`, parse, `setItems`, tax/tip `updateSettings`, and the "No items found" error.
  - `CameraScanner` `onfatal` follows the same path as a load failure.
  - Dispose the client in `onDestroy`.
  - Delete `preprocessImage`, `findContentBounds` and the processed-preview UI.

- [ ] **Step 1: Implement** the changes. Run `npm uninstall tesseract.js scribe.js-ocr`.
- [ ] **Step 2:** `grep -rn "tesseract\|scribe" src package.json`. Expected: no output. `npm test`. Expected: all PASS. `npm run check`. Expected: 0 errors. `npm run build`. Expected: success.
- [ ] **Step 3: Manual check:**
  - Upload a receipt photo. Items, tax and tip fill in.
  - Camera scan end to end.
  - **Review Focus #5:** in DevTools, block `/models/rec.onnx` and choose **Use camera**. The error message shows and the mode switches to text.
  - Manual text mode still parses.
- [ ] **Step 4: Commit** with `feat(ocr): switch receipt scanning to PaddleOCR; remove tesseract.js`.
