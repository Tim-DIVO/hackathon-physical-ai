// Creates the LabLens ElevenLabs conversational agent and its client tools.
// Usage: node --env-file=.env.local scripts/setup-elevenlabs-agent.mjs
// Prints ELEVENLABS_AGENT_ID=... to add to .env.local. Client tools run in the browser
// (components/voice-assistant.tsx) and change real application state.
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const api = async (path, body) => {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
};

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const num = (description) => ({ type: "number", description });
const tools = [
  {
    name: "get_lab_state",
    description:
      "Returns the live experiment state: recording, playback time, current protocol step, model observations so far, open review flags, missing metadata and the sample registry. Call before answering any question about the experiment.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_event",
    description:
      "Record operator-provided facts on a notebook observation: source/destination sample, volume, or that the tip was changed. Targets the current observation unless event_number is given.",
    parameters: {
      type: "object",
      properties: {
        event_number: num("1-based observation number from get_lab_state; omit for the current observation"),
        source_sample_id: str("Registry ID of the source, e.g. REAGENT-01"),
        destination_sample_id: str("Registry ID of the destination, e.g. DISH-01"),
        volume_ul: num("Volume in microlitres stated by the operator"),
        tip_changed: { type: "boolean", description: "true if the operator says they changed the tip" },
        confirm: { type: "boolean", description: "true if the operator confirms the observation is correct" },
      },
      required: [],
    },
  },
  {
    name: "add_note",
    description:
      "Adds the operator's own statement as a timestamped operator note in the live notebook (e.g. narration of what they are doing, or an observation that is not a correction). Pass their words.",
    parameters: {
      type: "object",
      properties: { text: str("The operator's words to record as a note") },
      required: ["text"],
    },
  },
  {
    name: "get_protocol_guidance",
    description:
      "Returns the current or next reference protocol step with best practices for training mode.",
    parameters: {
      type: "object",
      properties: { which: str("current or next", { enum: ["current", "next"] }) },
      required: ["which"],
    },
  },
  {
    name: "show_view",
    description: "Navigates the LabLens interface to a tab.",
    parameters: {
      type: "object",
      properties: {
        tab: str("Tab to open", {
          enum: ["Overview", "Protocol", "Sample lineage", "Safety", "Training", "AI dataset", "Export"],
        }),
      },
      required: ["tab"],
    },
  },
  {
    name: "show_lineage",
    description: "Opens the sample lineage graph, optionally focused on one sample.",
    parameters: {
      type: "object",
      properties: { sample_id: str("Registry ID such as CELL-A") },
      required: [],
    },
  },
  {
    name: "show_evidence",
    description:
      "Seeks the video to the evidence for a flagged observation (or a given observation number) so the operator can review it.",
    parameters: {
      type: "object",
      properties: { event_number: num("1-based observation number; omit for the first open flag") },
      required: [],
    },
  },
  {
    name: "generate_report",
    description: "Generates and downloads the experiment notebook report.",
    parameters: {
      type: "object",
      properties: { format: str("md or json", { enum: ["md", "json"] }) },
      required: [],
    },
  },
];

const prompt = `You are LabLens, a calm, precise voice copilot inside a smart-glasses wet-lab documentation app. The operator is performing (or reviewing a recording of) a CRISPR-Cas9 delivery into HEK293T cells: add reagents 1-3 to an EP tube, mix, incubate, add dropwise to a 10 cm dish, rock the dish.

Rules:
- Keep every reply to one or two short sentences. Speak like a senior lab colleague.
- Use tools for anything that reads or changes the experiment. Call get_lab_state before answering questions about steps, mistakes, samples or progress.
- When the operator states a fact (sample identity, volume, tip change, confirmation), call update_event, then confirm briefly what was recorded.
- Always distinguish: "the model observed" (vision observations, uncertain), "you confirmed" (operator facts), and "the reference protocol says".
- Never invent volumes, concentrations or sample IDs. If something needed is missing, ask for it.
- Flags are advisory and "need review", never definitive errors.
- When the operator narrates what they are doing or reports something that is not a correction, call add_note with their words.
- You are also the lab supervisor for rigor and safety: if they describe something risky (reusing a tip between reagents, skipping incubation, unlabelled tubes), say so directly.
- Requests such as "show lineage", "generate my report", "open the safety tab", "show me the evidence" must call the matching tool.
- Messages starting with "[LabLens alert]" come from the app, not the operator: relay the warning in one sentence and suggest how to resolve it.`;

const toolIds = [];
for (const t of tools) {
  const created = await api("/v1/convai/tools", {
    tool_config: {
      type: "client",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      expects_response: true,
      response_timeout_secs: 10,
    },
  });
  toolIds.push(created.id);
  console.error(`tool ${t.name}: ${created.id}`);
}

const agent = await api("/v1/convai/agents/create", {
  name: "LabLens copilot",
  conversation_config: {
    agent: {
      first_message: "LabLens is listening. Ask what step you're on, or tell me what you just did.",
      language: "en",
      prompt: { prompt, llm: process.env.ELEVENLABS_LLM || "gpt-4.1-mini", tool_ids: toolIds, temperature: 0.3 },
    },
    tts: { voice_id: voiceId, model_id: "eleven_flash_v2" },
    conversation: { max_duration_seconds: 600 },
  },
});
console.log(`ELEVENLABS_AGENT_ID=${agent.agent_id}`);
