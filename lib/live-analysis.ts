import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { protocolSteps } from "./reference";
import { actionLabels, tipStates } from "./validation";
import type { LabEvent } from "./types";

const execute = promisify(execFile);
export const WINDOW_FPS = 2;
const FRAME_WIDTH_PX = 640;

export interface WindowRequest {
  clipId: string;
  videoPath: string; // absolute path to the source recording
  start: number;
  end: number;
  /** Compact summary of what earlier windows observed, for continuity. */
  context: string;
  tipStateIn: string;
}

const windowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events", "tipStateAtEnd"],
  properties: {
    tipStateAtEnd: {
      type: "string",
      description: "Tip on the active pipette at the end of the window",
    },
    events: {
      type: "array",
      items: {
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
          "pipette",
          "volumeReadingUl",
          "flags",
          "evidenceFrames",
        ],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          action: { type: "string", description: "Short label, 2-5 words, e.g. 'Dispense into EP tube'" },
          actionLabel: { type: "string", enum: [...actionLabels] },
          description: { type: "string" },
          objects: { type: "array", items: { type: "string" } },
          protocolStep: { type: ["integer", "null"] },
          tipState: { type: "string", enum: [...tipStates] },
          pipette: {
            type: ["string", "null"],
            description:
              "Visible pipette type/size if identifiable (e.g. 'P200, yellow tip', 'P1000, blue tip'), else null",
          },
          volumeReadingUl: {
            type: ["number", "null"],
            description:
              "Volume in µL ONLY if the pipette's volume dial is legible in a frame; otherwise null. Never guess.",
          },
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
      },
    },
  },
} as const;

type WindowEvent = {
  start: number;
  end: number;
  action: string;
  actionLabel: LabEvent["actionLabel"];
  description: string;
  objects: string[];
  protocolStep: number | null;
  tipState: LabEvent["tipState"];
  pipette: string | null;
  volumeReadingUl: number | null;
  flags: { type: LabEvent["flags"][number]["type"]; message: string }[];
  evidenceFrames: number[];
};

async function extractWindow(req: WindowRequest, folder: string) {
  const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!ffmpeg) throw new Error("ffmpeg is unavailable.");
  await execute(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(req.start),
      "-t",
      String(req.end - req.start),
      "-i",
      req.videoPath,
      "-vf",
      `fps=${WINDOW_FPS}:round=down,scale=${FRAME_WIDTH_PX}:-2`,
      "-q:v",
      "4",
      path.join(folder, "%04d.jpg"),
    ],
    { timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  const files = (await readdir(folder)).filter((f) => f.endsWith(".jpg")).sort();
  const times = files.map(
    (_, i) => Math.round((req.start + i / WINDOW_FPS) * 10) / 10,
  );
  return { files, times };
}

function prompt(req: WindowRequest, frames: number) {
  return [
    `You are the live perception module of a smart-glasses wet-lab copilot. These ${frames} frames cover t=${req.start}s to t=${req.end}s of a lab recording (${WINDOW_FPS} fps).`,
    `Reference protocol (context only, NOT evidence): ${JSON.stringify(protocolSteps.map((s) => `${s.id}. ${s.description}`))}`,
    `Earlier windows observed: ${req.context || "nothing yet (this is the start)"}. Tip state entering this window: ${req.tipStateIn}.`,
    "Return the visible manipulations in this window as events with absolute timestamps (merge with nothing outside the window). Report tipState continuity carefully: a tip change requires a visible ejection or mounting of a new tip.",
    "Add a tip_reuse flag only if a pipette with the same tip moves between different reagent sources/tubes without a visible change. Add unknown_sample where container identity matters but is unreadable. Phrase flags as possible issues needing review.",
    "Quantities: report the pipette type/size only if visible; report volumeReadingUl only if the volume dial digits are actually legible, otherwise null. Never infer volumes from the protocol.",
    "Return an empty events list if nothing lab-relevant happens.",
  ].join("\n");
}

const nearest = (value: number, options: number[]) =>
  options.reduce((best, t) => (Math.abs(t - value) < Math.abs(best - value) ? t : best));

export async function analyzeWindow(req: WindowRequest) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const folder = await mkdtemp(path.join(os.tmpdir(), "lablens-live-"));
  try {
    const { files, times } = await extractWindow(req, folder);
    if (!files.length) return { events: [] as LabEvent[], tipStateAtEnd: req.tipStateIn, frames: 0 };
    const content: unknown[] = [{ type: "input_text", text: prompt(req, files.length) }];
    for (let i = 0; i < files.length; i++) {
      content.push({ type: "input_text", text: `t=${times[i]}s` });
      content.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${(await readFile(path.join(folder, files[i]))).toString("base64")}`,
        detail: "high",
      });
    }
    const model = process.env.OPENAI_LIVE_MODEL || process.env.OPENAI_MODEL || "gpt-5.5";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content }],
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "lab_window", strict: true, schema: windowSchema } },
        max_output_tokens: 8000,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(`OpenAI window analysis failed (${response.status}): ${body?.error?.message ?? ""}`);
    const text = body.output
      ?.flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
      .filter((c: { type: string }) => c.type === "output_text")
      .map((c: { text: string }) => c.text)
      .join("");
    const parsed = JSON.parse(text) as { events: WindowEvent[]; tipStateAtEnd: string };
    const events: LabEvent[] = parsed.events.map((e, i) => {
      const start = Math.max(req.start, Math.min(e.start, req.end));
      const end = Math.max(start, Math.min(e.end, req.end));
      const evidence = [...new Set(e.evidenceFrames.map((t) => nearest(t, times)))].sort((a, b) => a - b);
      const visualQuantity = [
        e.pipette,
        e.volumeReadingUl !== null ? `dial reads ${e.volumeReadingUl} µL` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: `${req.clipId}-live-${Math.round(req.start * 10)}-${i}`,
        clipId: req.clipId,
        start,
        end,
        action: e.action,
        actionLabel: e.actionLabel,
        tipState: e.tipState,
        description: e.description,
        objects: e.objects,
        sourceSampleId: null,
        destinationSampleId: null,
        volumeUl: null,
        visualQuantity: visualQuantity || null,
        protocolStep: e.protocolStep && e.protocolStep >= 1 && e.protocolStep <= 7 ? e.protocolStep : null,
        verification: "pending",
        origin: "model",
        flags: e.flags.map((f) => ({ ...f, status: "needs_review" as const })),
        evidenceFrames: evidence.length ? evidence : [times[0]],
      };
    });
    return {
      events,
      tipStateAtEnd: parsed.tipStateAtEnd,
      frames: files.length,
      model,
      usage: body.usage ?? null,
    };
  } finally {
    const resolved = path.resolve(folder);
    if (resolved.startsWith(path.resolve(os.tmpdir())) && path.basename(resolved).startsWith("lablens-live-"))
      await rm(resolved, { recursive: true, force: true });
  }
}
