# LabLens

**Every laboratory action becomes scientific provenance and training data for the next generation of biological AI.**

LabLens is a prototype lab copilot for first-person (smart-glasses style) wet-lab video. It watches a recording, writes evidence-linked notebook entries, supervises for rigor and safety, listens to the operator by voice, and exports structured provenance and training data.

## Live session (`/live`)

1. Pick a recording: the two reference CRISPR clips (DJI_09, DJI_10, third-person) or one of 4 **unseen** first-person smart-glasses clips from LSV.
2. **Analyse live** runs fresh windowed inference (GPT-5.5, `/api/analyze/window`). Cost is roughly **$0.40 per 100 s clip**.
3. Notes appear as playback reaches them. If playback outruns analysis, the video pauses and resumes when the next window arrives.
4. **Replay last run** re-plays the cached result at no cost.

Ground truth and dataset labels are never shown in the live UI. Volumes appear only when the operator confirmed them; the model reports only what is visible in frame.

### Supervisor rules (deterministic, `lib/supervisor.ts`)

- Two reagent additions with no observed tip change in between: tip-reuse flag.
- Delivery shortly after mixing: the reference protocol requires a 20 min room-temperature incubation; asks whether it happened off camera.
- Source or destination sample not confirmed: asks the operator which sample it was.

Flags are advisory and can be confirmed or dismissed.

### Voice supervisor

An ElevenLabs conversational agent with 8 client tools: `get_lab_state`, `update_event`, `add_note`, `get_protocol_guidance`, `show_view`, `show_lineage`, `show_evidence`, `generate_report`. Without ElevenLabs, microphone input uses browser speech recognition and browser TTS (labelled in the UI). Alerts are spoken proactively; **coach mode** gives brief guidance when a new protocol step is observed.

## Workspace (`/`)

Tabs: Overview, Protocol, Sample lineage, Safety (including the model-vs-reference and unseen-clip evaluation cards), Training, AI dataset, Export. Exports (Markdown, JSON, CSV) record operator-confirmed versus model-observed provenance. The AI dataset tab includes a **simulated** cell atlas: illustrative only, no sequencing data exists.

## Evaluation (honest results)

- **Reference clips (2):** the model flags tip reuse on DJI_09 (true; overlaps the dataset's reference error at about 17-64 s) and also on DJI_10 (false positive; that clip is correct). That is 1 TP and 1 FP; two clips cannot establish detector performance.
- **50 unseen PMD pipette clips (LSV), zero-shot:** accuracy 0.20, balanced accuracy 0.33 (0.34 on a 24-clip forced-verdict subset), confusion TP 0 / FP 5 / TN 10 / FN 35, 40 of 50 "unclear", 0 of 35 error categories named. Estimated cost about $3.1.
- **Conclusion:** the current prompt-only approach does not reliably detect contamination errors on short unseen clips. Tip-reuse detection on full procedures is promising but unvalidated.

Details, method and limitations: [data/eval/README.md](data/eval/README.md).

## Setup

Requires Node.js 22+.

```sh
npm install
node scripts/download-videos.mjs
```

Create `.env.local` (see `.env.example`):

```
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.5
OPENAI_LIVE_MODEL=        # optional, overrides the model for /live
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...   # produced by the setup script below
```

Create or update the voice agent, then start the app:

```sh
node --env-file=.env.local scripts/setup-elevenlabs-agent.mjs
npm run dev
```

Open http://localhost:3000/live. Optional: `node scripts/precompute.mjs` fills the batch-analysis cache in `data/analysis/` for the workspace; `npm run typecheck`; `npm run build`.

## Cost notes

Every "Analyse live" call costs money (about $0.40 per 100 s clip). The batch analysis and unseen eval were one-off runs (eval about $3.1). Replay and cached workspace analysis are free. Do not expose the analysis API routes publicly without protection.

## Limitations

- Prototype, single user, state kept in the browser; not a validated electronic lab notebook.
- Frame sampling can miss brief events such as tip changes; absence in frames does not prove an omission.
- The sample registry is synthetic; choosing an ID records an operator annotation, not true identity.
- The cell atlas is simulated. The AnnData export example is hypothetical; no measurements or model training are claimed.
- Robotics exports are semantic demonstration annotations, with no poses or control commands.
- DJI_09/DJI_10 are third-person recordings standing in for a smart-glasses workflow.
- Detection does not currently generalise (see Evaluation).

## Provenance and license

Footage and annotations come from [cong-lab/LSV](https://huggingface.co/datasets/cong-lab/lsv), licensed **CC BY-NC 4.0**: noncommercial use with attribution. Downloaded videos, derived frames and recordings must respect those terms; no commercial rights are granted. Reference protocol and error labels are stored separately (`data/reference.json`, `lib/ground-truth.json`); they are not model discoveries. See [ATTRIBUTION.md](ATTRIBUTION.md).

## Stack

Next.js App Router, React, TypeScript, Tailwind, Radix UI, Zod, OpenAI Responses API, ElevenLabs React SDK, ffmpeg (`ffmpeg-static`).
