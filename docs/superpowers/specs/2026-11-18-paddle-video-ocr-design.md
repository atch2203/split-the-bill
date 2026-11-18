# Receipt Scanning Overhaul: PaddleOCR + Video Bayesian Fusion

Date: 2026-11-18
Status: Approved 2026-11-18

## Intent

Receipt scanning today uses tesseract.js on a single photo. Its accuracy is poor, and
the OCR errors break the regex item filtering in `src/lib/utils/receiptParser.ts`
(missed items, wrong prices). The goal is OCR text accurate enough that the parser
reliably pulls out items, prices, tax, and tip.

Two changes:

1. Replace Tesseract with PaddleOCR (PP-OCR detection + recognition models) running
   in the browser.
2. Add a live camera mode. The user holds the phone steady over the receipt. Each
   line's text is refined over many frames with per-character Bayesian filtering,
   so a single blurry or glare-hit frame cannot corrupt the result.

## Goals

- Clearly better OCR accuracy than today, mainly on prices and item names.
- A hold-steady video scan that fuses evidence per character across frames and
  handles the recognizer inserting or dropping characters between frames.
- Live feedback while scanning: which lines are locked (confident) and overall
  progress, for example "8/11 lines locked".
- The output plugs into the existing flow: `billStore.setRawOcrText`,
  `parseReceiptText`, `billStore.setItems`, and the tax/tip auto-fill.

## Non-goals

- Continuous pan or scroll scanning, and image stitching. The user chose
  hold-steady. Long receipts are handled by multi-part scans (below), not panning.
- Rewriting the parser's regex patterns. Tune them only after looking at real
  Paddle output, in a later change.
- Languages other than English/Latin receipts.

## Anti-goals (failure even if it technically works)

- Needing a server. The site is static on GitHub Pages (`adapter-static`,
  `.github/workflows/deploy.yml`), so all OCR runs client-side.
- Freezing the UI. Inference runs off the main thread.
- Making every visitor download the models. Load them only when the scanner opens.
- Overconfident locks. A line must not lock on a wrong character because one frame
  was very sure of itself.

## Constraints

- SvelteKit 2 / Svelte 5 runes, TypeScript, Vite 7, static build, npm.
- Mobile browsers are the main target: rear camera through `getUserMedia`, with
  `facingMode: 'environment'`. Camera access needs HTTPS (GitHub Pages provides it;
  `vite dev` on localhost is fine).
- Fusion needs the recognizer's **per-timestep CTC softmax output**, not just the
  decoded string. Any library that only returns text cannot be used for recognition.

## Approaches considered (what gets fused across frames)

1. **Whole-line voting.** A confidence-weighted vote over each line's full string.
   Simplest, but it can't produce a string no single frame read correctly.
2. **Per-character filtering. (Chosen.)** Align each frame's per-character
   probability distributions to the line's running estimate and accumulate evidence
   per character position. It fixes errors no single frame got right, which matters
   most for prices. It costs alignment code and access to raw model output.
3. **Fusing parsed items.** Run the parser on each frame and fuse the items. This
   allows a subtotal check, but the fusion then inherits the parser's regex
   brittleness, which is the problem being fixed.

The user chose option 2 and noted that characters can be misaligned between frames
(insertions and deletions).

## Design

### Pipeline overview

```
camera (getUserMedia) ──► frame grab (canvas, throttled) ──► OCR worker
                                                              │ det: text boxes
                                                              │ rec: per-box CTC softmax
                                                              ▼
                         main thread ◄── per-box results {box, charDists}
                              │
                              ├─ line tracker: match boxes to existing tracks
                              ├─ per-track fusion: align + Bayesian update
                              ├─ overlay: boxes coloured by lock state, progress
                              └─ on finish: assemble rows → text → parseReceiptText
```

Photo upload stays as a fallback. It runs the same pipeline on one image (one
"frame"), with no fusion benefit, and replaces Tesseract on that path too. Manual
text entry mode is kept unchanged.

### OCR engine

- PP-OCR mobile detection + recognition models (v4 or v5, whichever has ONNX
  exports and an English/Latin dictionary that work on receipts) on
  `onnxruntime-web`. Use the WebGPU execution provider when available, otherwise
  WASM.
- Runtime targets (Claude's call): recent iOS Safari and Android Chrome. Use WebGPU
  where it's available. Otherwise fall back to **single-threaded** WASM. Don't add
  a COOP/COEP isolation shim (such as coi-serviceworker) for multithreaded WASM:
  GitHub Pages can't set those headers, and `require-corp` risks breaking PeerJS
  and other cross-origin loads. A slow device simply fuses fewer frames per
  second; there's no minimum fps. Pick model size and input resolution so that
  WASM single-threaded processes a frame in roughly ≤1 s on a mid-range phone.
- Run in a dedicated Web Worker. The main thread posts `ImageBitmap` frames
  (transferable) and gets back per-box results.
- Detection: DB postprocessing (threshold, contours, box unclip), then crop and
  rectify each box to the recognizer's input height.
- Recognition: for each box, return the raw `[T × C]` softmax matrix, or the
  reduced per-character distributions below, plus the box geometry.
- Models and dictionary are served from `static/` (fetched lazily, with paths
  respecting the `BASE_PATH` base) and cached by the browser. Worker start and
  model load happen when the scanner opens, with a visible loading state.
- **If Paddle fails** (model download fails, session creation fails, out of memory,
  repeated worker crashes): there is no second OCR engine. Show a clear error
  ("Scanning isn't supported on this device") and switch to manual text entry mode.
  The user ruled out EasyOCR as a fallback, and Tesseract is not kept either.
- Remove `tesseract.js` and the unused `scribe.js-ocr` from `package.json`. Do this
  only after the Tesseract baseline has been captured (see Testing).
  Remove `preprocessImage`/`findContentBounds` binarization. PP-OCR expects
  natural colour images.

### From CTC output to per-character distributions

For each box, reduce the `[T × C]` matrix (C includes the CTC blank) to a sequence
of character distributions:

1. Greedy path: argmax per timestep.
2. Collapse runs of the same non-blank label. Each run becomes one emitted
   character. Drop blank runs.
3. That character's distribution is the mean of the softmax vectors over the run,
   with blank removed and the rest renormalized.

The result is `CharDist[]`, where each `CharDist` is a probability vector over the
alphabet. To keep it small, store the top-k (k≈5) entries plus a leftover "other"
mass.

### Line tracking (hold-steady)

- A **track** is one detected text box that persists across frames. Paddle often
  splits one receipt row into several boxes (for example the name on the left and
  the price on the right). Tracking is per box. Rows are assembled at the end.
- Per frame, estimate the global shift as the median offset of the best-overlapping
  box pairs, to absorb small hand shake. Then match boxes to tracks by IoU after
  shifting, with a check that the decoded text is similar (normalized edit
  distance). Unmatched boxes start new tentative tracks.
- A track becomes **confirmed** after appearing in ≥ N frames (N≈3). Tracks seen
  in only a small fraction of recent frames (spurious detections) are dropped at
  the end.
- If the global shift goes over a threshold (the user moved the phone), show a
  "hold steady" hint. Don't try to stitch.

### Per-character Bayesian fusion with insertions and deletions

Each track keeps a **profile**: an ordered list of columns. Each column holds:

- `logp[c]` for every alphabet symbol `c`, plus `logp[ε]` for "this column is not
  really a character" (gap). These are accumulated log-evidence values. The
  posterior is softmax(`logp`).
- `n`: the number of frames that voted on this column.

The first observation creates one column per character, from its distribution,
with a small ε mass.

For each new observation `o = [d_1 … d_m]` (CharDists) of the track:

1. **Align** `o` to the profile columns with Needleman–Wunsch (global alignment):
   - Match score between column `k` and `d_j`:
     `log Σ_c P_k(c) · d_j(c)`, the log probability that both name the same
     character under the current posterior `P_k`. This scores soft agreement, so
     a `5`/`S` confusion is a cheap mismatch, not a hard one.
   - Gap in observation (the frame **deleted** a character that is in the
     profile): penalty `g_del`, cheaper when `P_k(ε)` is already high.
   - Gap in profile (the frame **inserted** a character): penalty `g_ins`.
   - Use a band (|i−j| ≤ ~max(3, 20% of length)). Lines are short, so plain O(nm)
     is also fine.
2. **Update**, using the alignment:
   - Matched column `k` ↔ `d_j`: `logp_k[c] += α · log(ε_floor + d_j(c))` for every
     `c`. Add evidence against ε: `logp_k[ε] += α · log(p_miss)`.
   - Column `k` skipped by the frame (deletion): `logp_k[ε] += α · log(1 − p_miss)`
     and leave the character entries unchanged. Repeated skips push the column
     towards "spurious, drop it".
   - Inserted `d_j` (no column): insert a new column at that position. Initialize
     its character evidence from `d_j`, and set its ε evidence as if it had been
     skipped by all `n_prev` earlier frames. A character that shows up in one
     frame out of ten stays mostly ε.
3. **Tempering.** `α < 1` (start around 0.5) and the probability floor `ε_floor`
   keep the accumulation from treating frames as independent when they aren't.
   Consecutive frames are highly correlated and softmax outputs are overconfident.
   Optionally skip frames that are near-duplicates of the previous one (very small
   pixel difference in the box) to reduce correlated double-counting.
4. **Read-out.** The MAP string is the concatenation of `argmax_c P_k(c)` over
   columns where `P_k(ε) < 0.5`.
5. **Lock.** A track locks when it is confirmed, has ≥ `minFrames` observations,
   and every non-ε column has max posterior ≥ `τ` (start τ≈0.95). Columns that are
   digits or `.` in a price-like suffix may use a stricter τ. A locked track keeps
   updating (no freezing), but the UI shows it as locked. If confidence drops
   below τ, it unlocks.

Prior art: this is progressive multiple-sequence alignment with soft-symbol
profiles, close to NIST ROVER for combining speech recognizer outputs.

All tuning constants (`α`, `ε_floor`, `p_miss`, `g_del`, `g_ins`, `τ`,
`minFrames`, N) live in one exported config object.

### Row assembly and handing off to the parser

When the scan finishes:

1. Take the confirmed tracks and their MAP strings.
2. Group the boxes into rows by vertical overlap (y-centre within half a box
   height), and order each row left to right.
3. Join boxes in a row with two spaces (`parseLine` pattern 3 relies on `\s{2,}`
   between name and price), and join rows with `\n`, top to bottom.
4. Pass the text to the existing flow, unchanged:
   `billStore.setRawOcrText(text)` → `parseReceiptText(text)` → `setItems` +
   tax/tip `updateSettings`.

### Scan UX

- The "Scan" mode in `ReceiptScanner.svelte` offers **Use camera** (default when
  `getUserMedia` exists) and **Upload photo**.
- Camera view: live video with an overlay canvas. Boxes are grey when tentative,
  amber when confirmed and fusing, and green when locked. Progress text reads
  "8/11 lines locked". A hint appears when the camera moves too much.
- **Done** button is enabled at any time and uses the current MAP strings. Auto-
  finish once every confirmed track is locked and no new tracks have appeared for
  about 1 s.
- Stop the camera tracks and terminate or idle the worker on finish, cancel, or
  component destroy.
- Frame throttling: process the next frame only once the worker is free (no
  queue build-up). Optionally cap the processing resolution so receipt text is
  ~32–48 px tall in the rec input.

### Long receipts: multi-part scans (user's choice)

Text on a long receipt framed whole is too small to read. Instead, the user does
several hold-steady scans in a row, for example the top half, then the bottom half.

- After a part finishes, the camera view offers **Scan next part** or **Finish**.
- Each part runs its own tracking and fusion and produces its own ordered list of
  rows (MAP strings).
- To merge part k+1 onto the result so far: find the longest suffix of the
  accumulated rows that matches a prefix of the new part's rows. Two rows match
  when their normalized edit distance is ≤ ~0.2. Keep the row with the higher
  confidence for each overlapping pair, then append the rest.
- If no overlap is found, append everything. Overlap removal is a best effort. A
  duplicated item is an easy manual fix in the item list, but a dropped item is
  not, so the threshold should err towards keeping rows.
- When the receipt's text is detected as too small (median box height below the
  rec target), show a hint: "Move closer; scan in parts".

### Code layout (proposal)

- `src/lib/ocr/worker.ts`: onnxruntime session setup, det + rec, CTC reduction.
- `src/lib/ocr/client.ts`: typed wrapper for the worker (init, processFrame,
  dispose).
- `src/lib/ocr/tracker.ts`: box → track matching, global shift.
- `src/lib/ocr/fusion.ts`: profile, alignment, update, read-out, lock. Pure and
  has no dependencies.
- `src/lib/ocr/rows.ts`: row assembly into parser text, and multi-part overlap merge.
- `src/lib/components/CameraScanner.svelte`: video, overlay, progress, Done.
- `ReceiptScanner.svelte`: Tesseract code removed, modes wired to the above.

### Testing

The repo has no test runner. Add `vitest` as a dev dependency and unit-test the
pure modules:

- `fusion.ts`: synthetic CharDist sequences covering substitution noise,
  insertions, deletions, a confident wrong frame against many weak correct ones,
  and lock/unlock behaviour.
- `rows.ts` and the CTC reduction.
- `tracker.ts` matching with a global shift.

**Evaluation corpus (the user has receipt photos, but no videos):**

- The photos go in `test-receipts/`. This folder is gitignored, because receipts
  can include partial card numbers and locations. Each photo gets a hand-written
  `<name>.expected.json` listing the items (name, qty, price) plus tax, tip,
  subtotal, and total.
- A dev-only eval page or script runs the photos through (a) single-frame Paddle
  and (b) **synthetic video**: 15–30 frames made from each photo with small random
  shifts and rotation, motion blur, brightness and glare changes, JPEG noise, and
  mild down-scaling. Fusion is tuned on (b).
- Metric: the share of expected items whose parsed price matches exactly and whose
  name matches fuzzily, plus exact tax and total. Capture a Tesseract baseline on
  the same photos *before* removing Tesseract. Pass bar: Paddle+fusion beats the
  baseline on the corpus. The headline number is reported, and no fixed % is
  required.
- A dev-only **Record** toggle in the camera view saves the frames it processed
  (downsampled JPEGs) as a downloadable zip. Real videos can then be added to the
  corpus later and replayed through the same eval.

## Calls made by Claude (not explicitly decided by the user)

- Keep photo upload (single frame, Paddle) and manual text mode.
- Leave the parser regexes as they are for this change.
- Host the models in `static/` instead of a third-party CDN.
- Add vitest for the pure fusion and tracking logic.
- WebGPU, else single-thread WASM. No cross-origin-isolation shim.
- Multi-part overlap merge errs towards keeping duplicates rather than dropping rows.
- On Paddle failure, fall back to manual text entry. No second OCR engine.
- Synthetic video from photos for tuning, plus a dev Record toggle. Corpus gitignored.
- Track per Paddle box and assemble rows at the end.
- Don't freeze locked lines; they can unlock if the evidence turns.

## Left to the builder

- Exact PP-OCR version, model files, and dictionary, chosen for size, accuracy, and
  ONNX availability.
- Whether to use an existing browser PaddleOCR package for detection
  postprocessing, or write it. Recognition must expose raw softmax either way.
- Initial values of the tuning constants, set from real-frame experiments.
- Visual styling of the camera view, matching the existing Tailwind look.
