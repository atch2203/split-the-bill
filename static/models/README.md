# PaddleOCR models

Served at `${base}/models/` and loaded by `src/lib/ocr/paddle.worker.ts`.

| File | Model | Source (pinned revision) | Size (bytes) | SHA-256 |
| --- | --- | --- | --- | --- |
| `det.onnx` | PP-OCRv5_mobile_det (text detection, DB) | https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx | 4826518 | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` |
| `rec.onnx` | en_PP-OCRv5_mobile_rec (English recognition, CTC) | https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b/inference.onnx | 7848423 | `b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f` |
| `dict.txt` | `PostProcess.character_dict` of en_PP-OCRv5_mobile_rec, one char per line (436 lines) | https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b/inference.yml | 1416 | `e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6` |

- Version: PP-OCRv5 (mobile), official ONNX exports published by PaddlePaddle on Hugging Face.
- Licence: Apache-2.0 (both repositories).
- `dict.txt` was extracted from the YAML list in `inference.yml` (no other changes).
  The runtime alphabet is these lines plus `' '` (`use_space_char`), 437 chars;
  the rec model outputs 438 classes (CTC blank at index 0).

## Inputs and outputs

Both models take a single float32 input `x` (NCHW, 3 channels, BGR order) and
return a single output `fetch_name_0`.

- **det**: input `[1, 3, H, W]`, H and W multiples of 32 (we resize the long
  side to at most 960). Normalized `(v/255 - mean) / std` with mean
  `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]` applied by BGR channel
  index. Output `[1, 1, H, W]` text probability map. Post-process: DB with
  thresh 0.3, box_thresh 0.6, unclip_ratio 1.5 (from `inference.yml`).
- **rec**: input `[N, 3, 48, W]`, documented `image_shape [3, 48, 320]` with
  dynamic width up to 3200. Normalized `(v/255 - 0.5) / 0.5`. We resize each
  crop to height 48 keeping the aspect ratio and zero-pad to at least 320.
  Output `[N, T, 438]` softmax (T = W / 8), decoded by CTC.

Verify locally with `npm run smoke:ocr` (runs det + rec in Node on rendered text).
