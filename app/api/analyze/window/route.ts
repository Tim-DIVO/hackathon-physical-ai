import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { analyzeWindow } from "@/lib/live-analysis";
import { resolveClip } from "@/lib/library";
import { clipIdSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_WINDOW_S = 20;
const runsDir = path.join(process.cwd(), "data", "live-runs");
const bodySchema = z.object({
  clipId: clipIdSchema,
  runId: z.string().regex(/^[a-z0-9-]{6,40}$/),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  context: z.string().max(4000).default(""),
  tipStateIn: z.string().max(200).default("unknown"),
});

/** Analyses one time window of a recording live; each window is appended to the run log. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid window request." }, { status: 400 });
  const { clipId, runId, start, end, context, tipStateIn } = parsed.data;
  if (end <= start || end - start > MAX_WINDOW_S)
    return NextResponse.json({ error: `Window must be 0–${MAX_WINDOW_S}s.` }, { status: 400 });
  const resolved = await resolveClip(clipId);
  if (!resolved) return NextResponse.json({ error: "Unknown clip." }, { status: 404 });
  if (start >= resolved.clip.duration)
    return NextResponse.json({ error: "Window starts after the recording ends." }, { status: 400 });
  try {
    const result = await analyzeWindow({
      clipId,
      videoPath: resolved.file,
      start,
      end: Math.min(end, resolved.clip.duration),
      context,
      tipStateIn,
    });
    // The run log only enables free replays; a failed write must not discard the analysis.
    await appendRun(clipId, runId, { start, end, ...result }).catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Window analysis failed." },
      { status: 503 },
    );
  }
}

/** Returns the most recent live run for replay without spending tokens. */
export async function GET(request: Request) {
  const id = clipIdSchema.safeParse(new URL(request.url).searchParams.get("clipId"));
  if (!id.success) return NextResponse.json({ error: "Invalid clipId." }, { status: 400 });
  try {
    return NextResponse.json(JSON.parse(await readFile(path.join(runsDir, `${id.data}.json`), "utf8")));
  } catch {
    return NextResponse.json({ error: "No previous live run." }, { status: 404 });
  }
}

// Serialise read-modify-write of run logs; windows arrive concurrently.
let writes: Promise<unknown> = Promise.resolve();
function appendRun(clipId: string, runId: string, window: Record<string, unknown>) {
  const next = writes.then(() => appendRunUnsafe(clipId, runId, window));
  writes = next.catch(() => undefined);
  return next;
}

async function appendRunUnsafe(clipId: string, runId: string, window: Record<string, unknown>) {
  await mkdir(runsDir, { recursive: true });
  const file = path.join(runsDir, `${clipId}.json`);
  let run = { runId, startedAt: new Date().toISOString(), windows: [] as Record<string, unknown>[] };
  try {
    const existing = JSON.parse(await readFile(file, "utf8"));
    if (existing.runId === runId) run = existing;
  } catch {}
  run.windows = [...run.windows.filter((w) => w.start !== window.start), window].sort(
    (a, b) => Number(a.start) - Number(b.start),
  );
  await writeFile(file, JSON.stringify(run, null, 2));
}
