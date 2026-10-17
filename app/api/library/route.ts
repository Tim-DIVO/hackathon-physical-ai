import { NextResponse } from "next/server";
import { listClips } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const clips = await listClips();
  // Reference labels stay on the server; the live UI must not see ground truth.
  return NextResponse.json(
    clips.map(({ id, title, duration, videoUrl, viewpoint, protocol, unseen }) => ({
      id,
      title,
      duration,
      videoUrl,
      viewpoint,
      protocol,
      unseen,
    })),
  );
}
