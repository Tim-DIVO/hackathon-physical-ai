import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_AGENT_ID)
    return NextResponse.json(
      {
        error:
          "Configure ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to start a voice conversation.",
      },
      { status: 503 },
    );
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID)}`,
      {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        {
          error: `ElevenLabs session failed (${upstream.status}). Check your agent configuration.`,
        },
        { status: 502 },
      );
    const data = await upstream.json();
    if (typeof data.signed_url !== "string")
      throw new Error("Missing signed URL");
    return NextResponse.json(
      { signedUrl: data.signed_url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "ElevenLabs voice session could not start." },
      { status: 502 },
    );
  }
}
