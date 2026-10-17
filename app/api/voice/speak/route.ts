import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!process.env.ELEVENLABS_API_KEY)
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not configured." },
      { status: 503 },
    );
  const body = await request.json().catch(() => null);
  if (
    typeof body?.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 3000
  )
    return NextResponse.json(
      { error: "text must contain 1–3000 characters." },
      { status: 400 },
    );
  try {
    const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: body.text,
          model_id: "eleven_flash_v2_5",
        }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        {
          error: `ElevenLabs speech failed (${upstream.status}). Check your key, voice access, and quota.`,
        },
        { status: 502 },
      );
    return new Response(upstream.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "ElevenLabs speech request could not complete." },
      { status: 502 },
    );
  }
}
