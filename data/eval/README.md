# Unseen-clip evaluation (LSV PMD split)

Zero-shot check of the LabLens vision pipeline (OpenAI `gpt-5.5`, Responses API, reasoning effort `low`, strict JSON-schema output) on clips it was never tuned on. The two demo clips (DJI_09, DJI_10) are not part of this set.

## Data and attribution

Clips come from the PMD split of **LabOS LSV** (`cong-lab/lsv` on Hugging Face), licensed **CC BY-NC 4.0** (non-commercial research use). Attribution: cong-lab / LSV, https://huggingface.co/datasets/cong-lab/lsv. Clips are not redistributed in git (`data/eval/clips/` and `public/videos/lsv/*.mp4` are gitignored); `scripts/download-videos.mjs` and `scripts/select-eval-clips.mjs` re-fetch them.

## Label schema

`pmd/pmd.parquet` (246 short pipette-use clips, 15 `correct`, 231 `incorrect`) has `label` (correct/incorrect) and `mistake_type`. We map `mistake_type` to the dataset's error options:

| mistake_type | category |
|---|---|
| reuse_tip, reuse_same_media, reuse_same_tip | ERROR_REUSE (`reuse`) |
| surface_contamination | ERROR_SURFACE (`surface`) |
| early_release | ERROR_RELEASE (`release`) |
| wrong_tip_for_pipette | ERROR_INSTALL (`install`) |

Binary label: `correct` vs `error` (any non-correct), matching the benchmark's Error Detection collapse. The manifest is saved in `pmd-manifest.json` (fetched through the HF datasets-server because the parquet file does not open in the installed pyarrow).

## Selection

`scripts/select-eval-clips.mjs` (deterministic): all 15 correct clips (there are no more) plus 35 error clips spread evenly through the sorted list of each type: reuse_tip 5, reuse_same_media 3, surface_contamination 9, early_release 9, wrong_tip_for_pipette 9. reuse_same_tip (4 clips, flagged `needs_review`) was skipped. Result: 50 clips, 15 correct / 35 error, 2.8 to 24.7 s each, 829 MB of full-resolution originals. The sample is stratified by error type, not random, and is 30% correct versus 6% in the full split.

## Method

`scripts/eval-unseen.mjs`: ffmpeg frames at 2 fps (reduced so a clip never exceeds 24 frames), 640 px wide, `detail: high`, each frame preceded by its timestamp. The prompt is neutral: no label, file name, or tip/pipette-size metadata. It asks for the action list and, for each of the four categories, `present` / `absent` / `unclear` with evidence timestamps. Raw responses are cached in `raw/` (abstain variant) and `raw-forced/`.

Two variants:

1. **abstain** (all 50 clips): prompt says to be conservative. Predicted `error` if any category is `present`, `unclear` if none present but some unclear, else `correct`.
2. **forced** (24-clip subset: 8 correct, 16 error, 4 per category, 2+2 for the reuse types): prompt asks for "more likely than not" calls and a mandatory correct/error `verdict`.

Output: `unseen-results.json` (`unseen-results-forced.json` for variant 2) with per-clip `{clip_id, label, prediction, correct, evidence}` and aggregate metrics.

## Results

Positive class = error. Unclear predictions count as "no error flagged" in the confusion counts.

| | abstain (n=50) | forced (n=24) |
|---|---|---|
| Accuracy (unclear = no error) | 0.20 | 0.25 |
| Accuracy (unclear = wrong) | 0.02 | 0.25 |
| Balanced accuracy | 0.333 | 0.344 |
| Error precision / recall | 0.00 / 0.00 (TP 0, FN 35) | 0.25 / 0.06 (TP 1, FN 15) |
| Correct precision / recall | 0.22 / 0.67 | 0.25 / 0.62 |
| Confusion (TP/FP/TN/FN) | 0 / 5 / 10 / 35 | 1 / 3 / 5 / 15 |
| Unclear predictions | 40 | 0 |

Abstain variant, by outcome: correct clips -> error 5, unclear 9, correct 1; error clips -> unclear 31, correct 4, error 0. Category match rate on error clips: 0/35 (abstain), 0/16 (forced).

**Bottom line: no evidence of generalization on this task.** The model almost never flags an error on these clips and is no better than chance on the binary decision (balanced accuracy about 0.33 to 0.34, below the 0.5 of a constant guess).

## Cost

Measured from API `usage` (abstain: 280,630 input / 24,247 output tokens, 3,574 reasoning; forced: 134,064 / 10,708, 1,466 reasoning). Cost is **estimated with an assumed price of $5/M input and $30/M output** (not read from the API): abstain about $2.13, forced about $0.99, total about $3.12, plus under $0.10 for early probe calls. Under the $4 budget.

## Limitations

- Small sample (50 / 24 clips), stratified rather than random; per-category n is 3 to 9, so intervals are wide.
- Frames are sampled (2 fps, 24 max, 640 px). Tip size, fit, and brief contact events may be lost; the dataset README itself notes 640 px mirrors can hide fine detail.
- PMD clips are short excerpts with little surrounding context. Reuse and surface errors are defined relative to what happened before the clip, which a single window may not show. This makes "unclear" a defensible answer, but it is still a miss against the label.
- Labels are the dataset's; 6 clips have `needs_review` notes (4 of them excluded by our selection).
- The prompt was not tuned. Only one prompt per variant and one run (no repeat sampling), so run-to-run variance is unmeasured. A higher reasoning effort, full-resolution frames, or contextual clips were not tried within the budget.
- The model is not the one trained for this benchmark; results say nothing about LabLens' accuracy on the two demo clips, which have different context (long CRISPR-protocol videos).
