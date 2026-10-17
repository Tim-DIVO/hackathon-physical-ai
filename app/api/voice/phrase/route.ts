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
  "Speak directly to them in one or two short spoken sentences, first and second person (\"I see you're…\", \"Which tube is that?\").",
  "Never mention models, cameras, systems, observations, flags or 'the reference protocol'. Sound like a person standing next to them.",
  "When something is uncertain, ask rather than accuse. When it matters biologically, say why in a few words (e.g. carry-over between dilutions skews every downstream concentration).",
  "Never invent volumes, concentrations or sample IDs.",
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
            content: `${kind === "alert" ? "Speak up about this now." : "They just reached this step; give one practical tip."}\n${facts}`,
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
