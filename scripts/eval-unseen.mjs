// Zero-shot evaluation of LabLens' vision pipeline on UNSEEN LSV PMD clips.
// The prompt never contains the clip's label or metadata (tip sizes, file names).
// Usage: node scripts/eval-unseen.mjs [--limit N] [--ids a,b] [--concurrency 4]
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const ffmpeg = process.env.FFMPEG_PATH || require("ffmpeg-static");
const run = promisify(execFile);

// ---- config ----
const MODEL = process.env.OPENAI_EVAL_MODEL || "gpt-5.5";
const FPS = Number(process.env.EVAL_FPS || 2);
const MAX_FRAMES = Number(process.env.EVAL_MAX_FRAMES || 24);
const FRAME_WIDTH = Number(process.env.EVAL_FRAME_WIDTH || 640);
const DETAIL = process.env.EVAL_DETAIL || "high";
const PRICE_IN_PER_M = Number(process.env.EVAL_PRICE_IN || 5); // ASSUMPTION: USD per 1M input tokens
const PRICE_OUT_PER_M = Number(process.env.EVAL_PRICE_OUT || 30); // ASSUMPTION: USD per 1M output tokens
const args = process.argv.slice(2);
const argVal = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const CONCURRENCY = Number(argVal("--concurrency") || 4);
const LIMIT = argVal("--limit") ? Number(argVal("--limit")) : Infinity;
const IDS = argVal("--ids")?.split(",");
// "forced" variant: additionally requires a best-guess correct/error verdict (the dataset's own forced-choice task).
const VARIANT = argVal("--variant") || "abstain";
const FORCED = VARIANT === "forced";
const TAG = FORCED ? "-forced" : "";

// Dataset label schema (cong-lab/lsv pmd): mistake_type -> error category.
const CATEGORY_OF = {
  reuse_tip: "reuse",
  reuse_same_media: "reuse",
  reuse_same_tip: "reuse",
  surface_contamination: "surface",
  early_release: "release",
  wrong_tip_for_pipette: "install",
  none: "none",
};
const CATEGORIES = {
  reuse: "ERROR_REUSE: the same tip is reused on a different medium/sample/reagent (cross-contamination), or reused after it should have been discarded",
  surface: "ERROR_SURFACE: the tip touches a non-sterile surface (bench, hand, tube exterior, glove) and is then used",
  release: "ERROR_RELEASE: the tip is dropped, ejected, or released unexpectedly or too early",
  install: "ERROR_INSTALL: the pipette tip is the wrong size for the pipette or is incorrectly fitted/seated",
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

const categorySchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "evidence_timestamps", "evidence"],
  properties: {
    status: { type: "string", enum: ["present", "absent", "unclear"] },
    evidence_timestamps: { type: "array", items: { type: "number" } },
    evidence: { type: "string" },
  },
};
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["actions", "categories", "overall_summary", ...(FORCED ? ["verdict"] : [])],
  properties: {
    ...(FORCED ? { verdict: { type: "string", enum: ["correct", "error"] } } : {}),
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "description"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          description: { type: "string" },
        },
      },
    },
    categories: {
      type: "object",
      additionalProperties: false,
      required: CATEGORY_KEYS,
      properties: Object.fromEntries(CATEGORY_KEYS.map((k) => [k, categorySchema])),
    },
    overall_summary: { type: "string" },
  },
};

const PROMPT = `You are reviewing a short laboratory video clip (sampled frames, each preceded by its timestamp in seconds) of a person using a pipette. The clip may show fully correct technique, or it may contain a technique error. Judge only from what is visible; do not assume an error exists and do not assume the clip is clean.

1. List the pipetting actions you see in order (tip attach, aspirate, dispense, eject, moving between containers, etc.) with start/end times.
2. For EACH error category below, decide whether it is visibly "present", "absent", or "unclear" (use "unclear" when the frames do not let you tell). For "present" give the timestamps of the frames that show it and say what is visible.

Error categories:
${CATEGORY_KEYS.map((k) => `- ${k} -> ${CATEGORIES[k]}`).join("\n")}

${FORCED
  ? `Clips are short excerpts, so context may be limited. Mark a category "present" if the frames make it more likely than not, and finally give a best-guess "verdict": "error" if any technique error is more likely than not, otherwise "correct". You must pick one.`
  : `Be conservative: only mark "present" when the evidence is visible in the frames.`} Keep descriptions short.`;

// ---- helpers ----
function loadEnv() {
  if (process.env.OPENAI_API_KEY) return;
  const file = path.resolve(".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function extractFrames(file, dir, durationS) {
  const fps = Math.min(FPS, MAX_FRAMES / Math.max(durationS, 0.5));
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", file,
    "-vf", `fps=${fps},scale=${FRAME_WIDTH}:-2`, "-frames:v", String(MAX_FRAMES),
    "-q:v", "4", path.join(dir, "f%03d.jpg"),
  ]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  return files.map((f, i) => ({ file: path.join(dir, f), t: Math.round(((i + 0.5) / fps) * 10) / 10 }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function callOpenAI(content) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input: [{ role: "user", content }],
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "pipette_review", strict: true, schema } },
        max_output_tokens: 6000,
      }),
      signal: AbortSignal.timeout(180000),
    }).catch(() => ({ ok: false, status: 0 }));
    if (res.ok) return res.json();
    if (res.status && res.status !== 429 && res.status < 500) {
      const b = await res.json().catch(() => ({}));
      throw new Error(`OpenAI ${res.status}: ${b?.error?.message ?? ""}`);
    }
    await sleep(3000 * 2 ** attempt);
  }
  throw new Error("OpenAI request failed after retries");
}

async function evaluateClip(row) {
  const cache = path.join(`data/eval/raw${TAG}`, `${row.video_id}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lablens-eval-"));
  try {
    const frames = await extractFrames(path.join("data/eval/clips", `${row.video_id}.mp4`), dir, row.duration_s);
    const content = [{ type: "input_text", text: PROMPT }];
    for (const f of frames) {
      content.push({ type: "input_text", text: `t=${f.t}s` });
      content.push({
        type: "input_image", detail: DETAIL,
        image_url: `data:image/jpeg;base64,${fs.readFileSync(f.file).toString("base64")}`,
      });
    }
    const body = await callOpenAI(content);
    const text = body.output?.flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
    const record = {
      clip_id: row.video_id, model: body.model ?? MODEL, frames: frames.length,
      frame_times: frames.map((f) => f.t), frame_width: FRAME_WIDTH, detail: DETAIL,
      usage: body.usage ?? null, output: JSON.parse(text),
    };
    fs.writeFileSync(cache, JSON.stringify(record, null, 1));
    return record;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function predict(output) {
  const st = (k) => output.categories[k].status;
  const present = CATEGORY_KEYS.filter((k) => st(k) === "present");
  const unclear = CATEGORY_KEYS.filter((k) => st(k) === "unclear");
  const prediction = FORCED ? output.verdict : present.length ? "error" : unclear.length ? "unclear" : "correct";
  return { prediction, present, unclear };
}

const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);

function summarize(results, usageTotals) {
  const decided = results.filter((r) => r.prediction !== "unclear");
  const cm = { tp: 0, fp: 0, tn: 0, fn: 0 }; // positive = error
  for (const r of results) {
    const err = r.label === "error";
    const predErr = r.prediction === "error"; // unclear counts as "no error flagged"
    if (err && predErr) cm.tp++;
    else if (!err && predErr) cm.fp++;
    else if (!err) cm.tn++;
    else cm.fn++;
  }
  const perClass = {
    error: { precision: ratio(cm.tp, cm.tp + cm.fp), recall: ratio(cm.tp, cm.tp + cm.fn), support: cm.tp + cm.fn },
    correct: { precision: ratio(cm.tn, cm.tn + cm.fn), recall: ratio(cm.tn, cm.tn + cm.fp), support: cm.tn + cm.fp },
  };
  const errorRows = results.filter((r) => r.label === "error");
  const perCategory = Object.fromEntries(
    [...new Set(errorRows.map((r) => r.true_category))].map((c) => {
      const rows = errorRows.filter((r) => r.true_category === c);
      return [c, {
        clips: rows.length,
        flagged_error_at_all: rows.filter((r) => r.prediction === "error").length,
        correct_category_flagged: rows.filter((r) => r.present_categories.includes(c)).length,
      }];
    }),
  );
  const cost = (usageTotals.input_tokens * PRICE_IN_PER_M + usageTotals.output_tokens * PRICE_OUT_PER_M) / 1e6;
  const recallError = cm.tp / Math.max(cm.tp + cm.fn, 1);
  const recallCorrect = cm.tn / Math.max(cm.tn + cm.fp, 1);
  return {
    n_clips: results.length,
    n_error: cm.tp + cm.fn,
    n_correct: cm.tn + cm.fp,
    accuracy_unclear_as_no_error: ratio(cm.tp + cm.tn, results.length),
    accuracy_strict_unclear_is_wrong: ratio(results.filter((r) => r.correct).length, results.length),
    accuracy_excluding_unclear: ratio(decided.filter((r) => r.correct).length, decided.length),
    balanced_accuracy: Math.round(((recallError + recallCorrect) / 2) * 1000) / 1000,
    per_class: perClass,
    confusion_counts: { ...cm, note: "positive class = error; unclear predictions counted as 'no error flagged'" },
    n_unclear: results.length - decided.length,
    per_true_category: perCategory,
    category_match_rate_on_errors: ratio(
      errorRows.filter((r) => r.present_categories.includes(r.true_category)).length,
      errorRows.length,
    ),
    usage: {
      ...usageTotals,
      estimated_cost_usd: Math.round(cost * 1000) / 1000,
      pricing_assumption: `USD ${PRICE_IN_PER_M}/M input, ${PRICE_OUT_PER_M}/M output tokens (assumed; not read from the API)`,
    },
    config: { model: MODEL, fps: FPS, max_frames: MAX_FRAMES, frame_width: FRAME_WIDTH, detail: DETAIL, reasoning_effort: "low", variant: VARIANT },
  };
}

// ---- main ----
loadEnv();
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing (.env.local)");
fs.mkdirSync(`data/eval/raw${TAG}`, { recursive: true });
let rows = JSON.parse(fs.readFileSync("data/eval/selection.json", "utf8"));
if (IDS) rows = rows.filter((r) => IDS.includes(r.video_id));
rows = rows.slice(0, LIMIT);

const records = new Map();
let next = 0;
async function worker() {
  while (next < rows.length) {
    const row = rows[next++];
    try {
      const rec = await evaluateClip(row);
      records.set(row.video_id, rec);
      console.log(`done ${row.video_id} frames=${rec.frames} in=${rec.usage?.input_tokens} out=${rec.usage?.output_tokens}`);
    } catch (e) {
      console.error(`FAILED ${row.video_id}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const results = [];
const usageTotals = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
for (const row of rows) {
  const rec = records.get(row.video_id);
  if (!rec) continue;
  const { prediction, present, unclear } = predict(rec.output);
  const label = row.label === "correct" ? "correct" : "error";
  usageTotals.input_tokens += rec.usage?.input_tokens ?? 0;
  usageTotals.output_tokens += rec.usage?.output_tokens ?? 0;
  usageTotals.reasoning_tokens += rec.usage?.output_tokens_details?.reasoning_tokens ?? 0;
  results.push({
    clip_id: row.video_id,
    label,
    mistake_type: row.mistake_type,
    true_category: CATEGORY_OF[row.mistake_type],
    prediction,
    correct: prediction === label,
    present_categories: present,
    unclear_categories: unclear,
    evidence: Object.fromEntries(
      CATEGORY_KEYS.filter((k) => rec.output.categories[k].status !== "absent").map((k) => [k, rec.output.categories[k]]),
    ),
    summary: rec.output.overall_summary,
    frames: rec.frames,
  });
}
const metrics = summarize(results, usageTotals);
fs.writeFileSync(`data/eval/unseen-results${TAG}.json`, JSON.stringify({ metrics, results }, null, 1));
console.log(JSON.stringify(metrics, null, 1));
