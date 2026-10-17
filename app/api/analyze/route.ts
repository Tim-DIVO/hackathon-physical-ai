import { NextResponse } from "next/server";
import { analyzeClip } from "@/lib/analysis";
import { clipIdSchema } from "@/lib/validation";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = clipIdSchema.safeParse(body?.clipId);
  if (!id.success)
    return NextResponse.json(
      { error: "clipId must be DJI_09 or DJI_10." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await analyzeClip(id.data, body?.refresh === true),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed." },
      { status: 503 },
    );
  }
}
