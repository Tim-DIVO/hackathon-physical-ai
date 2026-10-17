import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { clips, protocolSteps } from "./reference";
import { analysisSchema, actionLabels, tipStates } from "./validation";
import type { AnalysisResult, ClipId, LabEvent } from "./types";

const execute = promisify(execFile);
const cacheRoot = path.join(process.cwd(), "data", "analysis");
const running = new Map<ClipId, Promise<AnalysisResult>>();

/** One frame per second keeps brief tip ejections visible while staying within one request. */
const FRAME_INTERVAL_S = 1;
const FRAME_WIDTH_PX = 640;
const PROMPT_VERSION = "lablens-vision-v3";

export async function getCachedAnalysis(
  id: ClipId,
): Promise<AnalysisResult | null> {
  try {
    const parsed = analysisSchema.parse(
      JSON.parse(await readFile(path.join(cacheRoot, `${id}.json`), "utf8")),
    );
    return parsed.clipId === id ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Cached analysis is invalid. Remove it and analyze again.");
  }
}

export async function analyzeClip(
  id: ClipId,
  refresh = false,
): Promise<AnalysisResult> {
  const cached = await getCachedAnalysis(id);
  if (cached && !refresh) return cached;
  const existing = running.get(id);
  if (existing) return existing;
  const task = runInference(id).finally(() => running.delete(id));
  running.set(id, task);
  return task;
}

// Strict JSON schema for OpenAI structured outputs. Sample identities and volumes are
// deliberately absent: the model cannot assign them, only operators can.
const modelEventSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "start",
    "end",
    "action",
    "actionLabel",
    "description",
    "objects",
    "protocolStep",
    "tipState",
    "flags",
    "evidenceFrames",
  ],
  properties: {
    start: { type: "number" },
    end: { type: "number" },
    action: { type: "string", description: "Short human-readable label" },
    actionLabel: { type: "string", enum: [...actionLabels] },
    description: {
      type: "string",
      description: "What is visibly happening, one or two sentences",
    },
    objects: { type: "array", items: { type: "string" } },
    protocolStep: {
      type: ["integer", "null"],
      description: "Best-matching reference step id 1-7, or null if unclear",
    },
    tipState: { type: "string", enum: [...tipStates] },
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "message"],
        properties: {
          type: {
            type: "string",
            enum: ["tip_reuse", "missing_step", "unknown_sample"],
          },
          message: { type: "string" },
        },
      },
    },
    evidenceFrames: { type: "array", items: { type: "number" } },
  },
} as const;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events", "summary"],
  properties: {
    summary: { type: "string" },
    events: { type: "array", items: modelEventSchema },
  },
} as const;

type ModelEvent = {
  start: number;
  end: number;
  action: string;
  actionLabel: LabEvent["actionLabel"];
  description: string;
  objects: string[];
  protocolStep: number | null;
  tipState: LabEvent["tipState"];
  flags: { type: LabEvent["flags"][number]["type"]; message: string }[];
  evidenceFrames: number[];
};

function buildPrompt(duration: number, frameCount: number) {
  return [
    `You are the perception module of a wet-lab documentation copilot. You receive ${frameCount} chronological frames sampled every ${FRAME_INTERVAL_S}s from a ${duration.toFixed(1)}s third-person recording inside a tissue-culture hood.`,
    `Reference protocol (expected context only, NOT evidence that a step happened): ${JSON.stringify(protocolSteps)}.`,
    "Segment the recording into consecutive events (typically 8-20) describing visible manipulations: picking up the pipette, attaching or ejecting tips, aspirating, dispensing into a tube, mixing, opening/closing tubes, handling or rocking the culture dish.",
    "For each event, report tipState: fresh_tip_attached if you see a new tip being mounted from a tip box, tip_ejected if a tip is discarded, same_tip_continued if the pipette keeps the same tip from an earlier event, no_tip, or unclear.",
    "Pay close attention to whether the pipette tip is changed between additions of different reagents. If the operator moves from one reagent source to another with no visible tip ejection and new tip attachment in between, add a tip_reuse flag describing the evidence and the exact timestamps. Phrase flags as possible issues needing review.",
    "If a reference step appears to be skipped before a later step is observed, add a missing_step flag (note that incubation may legitimately happen off camera). If tube or reagent identity is not readable, add an unknown_sample flag where it matters for provenance.",
    "Never state volumes, concentrations or sample identifiers; they are not readable from video.",
    "evidenceFrames must be timestamps of supplied frames within [start, end]. protocolStep is the best-matching reference step or null.",
  ].join("\n");
}

async function extractFrames(id: ClipId, folder: string, duration: number) {
  const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!ffmpeg)
    throw new Error(
      "ffmpeg is unavailable. Install ffmpeg-static or set FFMPEG_PATH.",
    );
  await execute(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path.join(process.cwd(), "public", "videos", `${id}.mp4`),
      "-vf",
      `fps=1/${FRAME_INTERVAL_S}:round=down,scale=${FRAME_WIDTH_PX}:-2`,
      "-q:v",
      "4",
      path.join(folder, "%04d.jpg"),
    ],
    { timeout: 180000, maxBuffer: 1024 * 1024 },
  );
  const files = (await readdir(folder)).filter((f) => f.endsWith(".jpg")).sort();
  if (!files.length)
    throw new Error(
      "No video frames extracted. Run npm run download:videos first.",
    );
  const frameTimes = files.map((_, i) =>
    Math.min(i * FRAME_INTERVAL_S, Math.floor(duration)),
  );
  return { files, frameTimes };
}

async function requestModel(
  content: unknown[],
  model: string,
  format: { name: string; schema: object } = {
    name: "lab_events",
    schema: responseSchema,
  },
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      reasoning: { effort: "medium" },
      text: {
        format: {
          type: "json_schema",
          name: format.name,
          strict: true,
          schema: format.schema,
        },
      },
      max_output_tokens: 30000,
    }),
    signal: AbortSignal.timeout(280000),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(
      `OpenAI analysis failed (${response.status}): ${details?.error?.message || response.statusText}`,
    );
  }
  const body = await response.json();
  const output = body.output
    ?.flatMap(
      (item: { content?: { type: string; text?: string }[] }) =>
        item.content || [],
    )
    .filter((item: { type: string }) => item.type === "output_text")
    .map((item: { text: string }) => item.text)
    .join("");
  if (!output)
    throw new Error("OpenAI returned no analysis text. Retry this recording.");
  return JSON.parse(output) as { events: ModelEvent[]; summary: string };
}

const nearest = (value: number, options: number[]) =>
  options.reduce((best, t) =>
    Math.abs(t - value) < Math.abs(best - value) ? t : best,
  );

/** Normalises model output into LabEvents; the server, not the model, owns provenance fields. */
function toLabEvents(
  id: ClipId,
  raw: ModelEvent[],
  frameTimes: number[],
  duration: number,
): LabEvent[] {
  return raw
    .map((e) => {
      const start = Math.max(0, Math.min(e.start, duration));
      const end = Math.max(start, Math.min(e.end, duration));
      const evidence = [
        ...new Set(e.evidenceFrames.map((t) => nearest(t, frameTimes))),
      ]
        .filter((t) => t >= Math.floor(start) && t <= Math.ceil(end))
        .sort((a, b) => a - b);
      const fallback = frameTimes.filter((t) => t >= start && t <= end);
      return {
        start,
        end,
        action: e.action,
        actionLabel: e.actionLabel,
        tipState: e.tipState,
        description: e.description,
        objects: e.objects,
        protocolStep:
          e.protocolStep && e.protocolStep >= 1 && e.protocolStep <= 7
            ? e.protocolStep
            : null,
        flags: e.flags.map((f) => ({ ...f, status: "needs_review" as const })),
        evidenceFrames: evidence.length
          ? evidence
          : [nearest((start + end) / 2, fallback.length ? fallback : frameTimes)],
      };
    })
    .sort((a, b) => a.start - b.start)
    .map((e, i) => ({
      ...e,
      id: `${id}-model-${i + 1}`,
      clipId: id,
      sourceSampleId: null,
      destinationSampleId: null,
      volumeUl: null,
      verification: "pending" as const,
      origin: "model" as const,
    }));
}

// Second pass: a dense, narrowly scoped audit of tip changes. Tip ejection takes under a
// second, so the 1 fps segmentation pass alone cannot establish tip reuse reliably.
const TIP_AUDIT_FPS = 2;
const tipAuditSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tipEvents", "additions", "verdict", "rationale"],
  properties: {
    tipEvents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t", "kind", "evidence"],
        properties: {
          t: { type: "number" },
          kind: { type: "string", enum: ["tip_ejected", "fresh_tip_attached"] },
          evidence: { type: "string" },
        },
      },
    },
    additions: {
      type: "array",
      description: "Separate reagent additions into the EP tube, in order",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end"],
        properties: { start: { type: "number" }, end: { type: "number" } },
      },
    },
    verdict: {
      type: "string",
      enum: ["tip_changed_between_additions", "tip_reused", "unclear"],
    },
    rationale: { type: "string" },
  },
} as const;

type TipAudit = {
  tipEvents: { t: number; kind: string; evidence: string }[];
  additions: { start: number; end: number }[];
  verdict: "tip_changed_between_additions" | "tip_reused" | "unclear";
  rationale: string;
};

async function runTipAudit(
  id: ClipId,
  folder: string,
  windowEnd: number,
  model: string,
): Promise<TipAudit> {
  const ffmpeg = (process.env.FFMPEG_PATH || ffmpegStatic) as string;
  const dense = path.join(folder, "dense");
  await mkdir(dense, { recursive: true });
  await execute(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-t",
      String(windowEnd),
      "-i",
      path.join(process.cwd(), "public", "videos", `${id}.mp4`),
      "-vf",
      `fps=${TIP_AUDIT_FPS}:round=down,scale=${FRAME_WIDTH_PX}:-2`,
      "-q:v",
      "4",
      path.join(dense, "%04d.jpg"),
    ],
    { timeout: 180000, maxBuffer: 1024 * 1024 },
  );
  const files = (await readdir(dense)).filter((f) => f.endsWith(".jpg")).sort();
  const content: unknown[] = [
    {
      type: "input_text",
      text: [
        `Tip-change audit. Frames every ${1 / TIP_AUDIT_FPS}s from the first ${windowEnd}s of a tissue-culture hood recording in which an operator adds three reagents into one EP tube with a micropipette.`,
        "Find every moment a pipette tip is ejected (into waste / out of frame with the tip gone afterwards) or a fresh tip is mounted (pipette pressed into a tip box, or a pipette that had no tip now has one, or the operator swaps to a pipette with a new tip). Compare tip presence and appearance across consecutive frames; hands leaving the frame and returning with a different tip state counts as evidence.",
        "Identify the separate reagent additions into the tube. Verdict tip_reused only if two different additions are visibly done with the same tip and no change in between; tip_changed_between_additions if a change is visible between each pair of additions; otherwise unclear.",
      ].join("\n"),
    },
  ];
  for (let i = 0; i < files.length; i++) {
    content.push({ type: "input_text", text: `t=${i / TIP_AUDIT_FPS}s` });
    content.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${(await readFile(path.join(dense, files[i]))).toString("base64")}`,
      detail: "high",
    });
  }
  return (await requestModel(content, model, {
    name: "tip_audit",
    schema: tipAuditSchema,
  })) as unknown as TipAudit;
}

/** Reconciles segmentation-pass tip_reuse flags with the dense audit's verdict. */
function applyTipAudit(events: LabEvent[], audit: TipAudit): LabEvent[] {
  const changes = audit.tipEvents.map((e) => `${e.kind} at ${e.t}s`).join(", ");
  return events.map((e) => {
    const withoutTip = e.flags.filter((f) => f.type !== "tip_reuse");
    if (audit.verdict === "tip_changed_between_additions")
      return { ...e, flags: withoutTip };
    const inAdditions = audit.additions.some(
      (a) => e.start <= a.end && e.end >= a.start,
    );
    if (audit.verdict !== "tip_reused" || !inAdditions) return e;
    if (e.flags.some((f) => f.type === "tip_reuse")) return e;
    const first = audit.additions[0];
    if (first && e.start <= first.end) return e;
    return {
      ...e,
      flags: [
        ...e.flags,
        {
          type: "tip_reuse" as const,
          message: `Possible tip reuse: dense tip audit found no tip change between reagent additions. ${audit.rationale}${changes ? ` Observed: ${changes}.` : ""}`,
          status: "needs_review" as const,
        },
      ],
    };
  });
}

async function runInference(id: ClipId): Promise<AnalysisResult> {
  if (!process.env.OPENAI_API_KEY)
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to .env.local and restart the server to analyze this recording.",
    );
  const clip = clips.find((c) => c.id === id)!;
  const folder = await mkdtemp(path.join(os.tmpdir(), "lablens-"));
  try {
    const { files, frameTimes } = await extractFrames(
      id,
      folder,
      clip.duration,
    );
    const content: unknown[] = [
      { type: "input_text", text: buildPrompt(clip.duration, files.length) },
    ];
    for (let i = 0; i < files.length; i++) {
      content.push({ type: "input_text", text: `t=${frameTimes[i]}s` });
      content.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${(await readFile(path.join(folder, files[i]))).toString("base64")}`,
        detail: "high",
      });
    }
    const model = process.env.OPENAI_MODEL || "gpt-5.5";
    const parsed = await requestModel(content, model);
    const segmented = toLabEvents(id, parsed.events, frameTimes, clip.duration);
    // Audit up to the start of dish handling, found by the segmentation pass (not reference timings).
    const dishStart = segmented.find(
      (e) => e.actionLabel === "handle_dish" || (e.protocolStep ?? 0) >= 6,
    )?.start;
    const auditEnd = Math.min(clip.duration, (dishStart ?? clip.duration) + 2);
    const tipAudit = await runTipAudit(id, folder, auditEnd, model);
    const result = analysisSchema.parse({
      clipId: id,
      events: applyTipAudit(segmented, tipAudit),
      tipAudit: { ...tipAudit, windowEnd: auditEnd, fps: TIP_AUDIT_FPS },
      model,
      generatedAt: new Date().toISOString(),
      frameTimes,
      source: "model",
      analysisMethod: `OpenAI Responses API · ${files.length} frames @ ${FRAME_INTERVAL_S} fps segmentation + ${TIP_AUDIT_FPS} fps tip audit · structured output`,
      limitations: `Model summary: ${parsed.summary} Frames are sampled every ${FRAME_INTERVAL_S}s, so brief actions can be missed. Dataset error labels were not provided to the model.`,
      promptVersion: PROMPT_VERSION,
      videoSha256: createHash("sha256")
        .update(
          await readFile(
            path.join(process.cwd(), "public", "videos", `${id}.mp4`),
          ),
        )
        .digest("hex"),
    });
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(
      path.join(cacheRoot, `${id}.json`),
      JSON.stringify(result, null, 2),
    );
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        "Video or ffmpeg missing. Run npm run download:videos and install dependencies.",
      );
    throw error;
  } finally {
    const resolved = path.resolve(folder);
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (
      resolved.startsWith(tempRoot) &&
      path.basename(resolved).startsWith("lablens-")
    )
      await rm(resolved, { recursive: true, force: true });
  }
}
