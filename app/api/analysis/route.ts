import { NextResponse } from "next/server";
import { getCachedAnalysis } from "@/lib/analysis";
import { clipIdSchema } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = clipIdSchema.safeParse(
    new URL(request.url).searchParams.get("clipId"),
  );
  if (!id.success)
    return NextResponse.json(
      { error: "clipId must be DJI_09 or DJI_10." },
      { status: 400 },
    );
  try {
    const analysis = await getCachedAnalysis(id.data);
    return analysis
      ? NextResponse.json(analysis)
      : NextResponse.json(
          {
            error:
              "No model analysis cached for this recording. Run Analyze recording.",
          },
          { status: 404 },
        );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cache unavailable." },
      { status: 500 },
    );
  }
}
