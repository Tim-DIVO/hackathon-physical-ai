import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  facts: z.string().min(1).max(2000),
  kind: z.enum(["alert", "coach"]),
});

const SYSTEM = [
  "You are a senior wet-lab scientist supervising a colleague through smart glasses. The procedure is given in the facts; reason about its specific biology.",
  "Speak directly to them in ONE short spoken sentence of at most 12 words, first and second person.",
  "For a concern, ask a yes/no question they can answer in a word (\"Same tip for reagent 2, intended?\"). For a step, say exactly what to do or add, using the protocol's own words.",
  "Never mention models, cameras, systems, observations, flags or 'the reference protocol'. Sound like a person standing next to them.",
  "Never ask for reagent, sample or tube IDs, volumes or concentrations, and never invent them.",
].join(" ");

/** Turns raw supervisor facts into a natural spoken sentence (fallback when no live voice agent). */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (!process.env.OPENAI_API_KEY)
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  const { facts, kind } = parsed.data;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_PHRASE_MODEL || "gpt-5.4-mini",
        reasoning: { effort: "low" },
        max_output_tokens: 600,
        input: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `${kind === "alert" ? "Ask them about this now." : "They just reached this step; tell them what to do."}\n${facts}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? String(response.status));
    const text = (body.output ?? [])
      .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
      .filter((c: { type: string }) => c.type === "output_text")
      .map((c: { text: string }) => c.text)
      .join("")
      .trim();
    if (!text) throw new Error("Empty phrasing");
    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Phrasing failed." },
      { status: 502 },
    );
  }
}
