#!/usr/bin/env node
/**
 * Patches the existing LabLens voice agent (ELEVENLABS_AGENT_ID in .env.local) to the current live
 * configuration: short spoken replies, no tool round-trips before answering (the browser writes the
 * notebook and resolves yes/no checks from the transcript), and fast turn-taking.
 *
 *   node scripts/update-elevenlabs-agent.mjs
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const KEY = env.ELEVENLABS_API_KEY;
const AGENT = env.ELEVENLABS_AGENT_ID;
if (!KEY || !AGENT) throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be set in .env.local");

// Navigation/report tools stay for the workspace; note-taking and state tools are handled in the browser.
const KEEP_TOOLS = new Set(["show_view", "show_lineage", "show_evidence", "generate_report"]);

export const PROMPT = `You are LabLens: a senior lab colleague speaking into the operator's ear while they work, watching through their smart glasses.

How you talk:
- ONE short sentence, at most 12 words. No preamble, no repeating their question, no lists.
- First and second person ("Add reagent 2 next."). Never say model, camera, observed, flag, or "the protocol says".
- Silence is normal: the operator is working with their hands. Never ask whether they are still there, never fill silence.

What you know:
- "[Live bench state]" updates tell you the procedure, the protocol step now and next, what their hands are doing, recorded volumes and concentrations, and open checks. Answer from them instantly.
- The app writes the lab notebook from everything the operator says. Do NOT call tools to take notes or record facts; just reply.

Guidance:
- "What now / what do I add / next?": tell them exactly, using the protocol step text, e.g. "Add reagent 2 into the EP tube."
- Never ask the operator for reagent, sample or tube IDs, volumes or concentrations. If they mention one, a short "Got it." is enough.
- Ask a clarifying question only when the operator's own words are ambiguous ("Tube A or tube B?"), in at most 8 words.
- "Why?" questions: one sentence of real biology (carry-over between reagents changes the DNA:lipid ratio; the 20-min incubation lets complexes form; rock, don't swirl, so 293T stay attached; change tips between serial dilutions; keep DMSO freezing media cold; lentivirus is BSL-2).

Checks:
- "[LabLens alert]" messages are your own concern, not the operator speaking: ask ONE yes/no question about it, at most 12 words ("Same tip for reagent 2, intended?").
- When the operator answers a check, reply in at most four words ("Got it, noted."). "[Check answered]" means it is already recorded: never ask again.

Use show_view, show_lineage, show_evidence or generate_report only when the operator explicitly asks to open a view, see lineage or evidence, or make a report.`;

const base = "https://api.elevenlabs.io/v1/convai";
const headers = { "xi-api-key": KEY, "Content-Type": "application/json" };
const agent = await (await fetch(`${base}/agents/${AGENT}`, { headers })).json();
const ids = agent.conversation_config.agent.prompt.tool_ids ?? [];
const keep = [];
for (const id of ids) {
  const tool = await (await fetch(`${base}/tools/${id}`, { headers })).json();
  if (KEEP_TOOLS.has(tool.tool_config?.name)) keep.push(id);
}

const response = await fetch(`${base}/agents/${AGENT}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    conversation_config: {
      agent: {
        first_message: "I'm with you. Ask me anything.",
        prompt: { prompt: PROMPT, llm: "gemini-2.5-flash-lite", tool_ids: keep, max_tokens: 60 },
      },
      // turn_timeout -1: never re-engage after silence ("Are you still there?"); the operator is working.
      turn: {
        turn_eagerness: "eager",
        speculative_turn: true,
        turn_timeout: -1,
        silence_end_call_timeout: -1,
        soft_timeout_config: { timeout_seconds: -1 },
      },
      tts: { model_id: "eleven_flash_v2", optimize_streaming_latency: 4 },
    },
  }),
});
if (!response.ok) throw new Error(`PATCH failed: ${response.status} ${await response.text()}`);
console.log(`Updated agent ${AGENT}: kept tools ${keep.length}/${ids.length}, prompt ${PROMPT.length} chars.`);
