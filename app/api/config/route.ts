import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    elevenlabsAgent: !!(
      process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID
    ),
  });
}
