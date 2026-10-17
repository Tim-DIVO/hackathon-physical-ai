import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
async function request(path, options) {
  const response = await fetch(base + path, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(
      path + " returned " + response.status + ": " + raw.slice(0, 200),
    );
  }
  return { status: response.status, body };
}
if (!process.argv.includes("--pure")) {
  const config = await request("/api/config");
  assert.equal(config.status, 200);
  assert(Object.values(config.body).every((v) => typeof v === "boolean"));
  assert(!JSON.stringify(config.body).includes("sk-"));
  for (const clipId of ["DJI_09", "DJI_10"]) {
    const r = await request("/api/analysis?clipId=" + clipId);
    assert.equal(r.status, 200);
    assert.equal(r.body.clipId, clipId);
    assert.equal(r.body.source, "model");
    assert(r.body.events.length > 0);
    assert(
      r.body.events.every(
        (e) =>
          e.clipId === clipId && Number.isFinite(e.start) && e.start <= e.end,
      ),
    );
    console.log(clipId + ": " + r.body.events.length + " cached events");
  }
  assert.equal((await request("/api/analysis?clipId=../secret")).status, 400);
  for (const body of ["{}", '{"clipId":"invalid"}', "not json"])
    assert.equal(
      (
        await request("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
      ).status,
      400,
    );
  if (!config.body.elevenlabsAgent)
    assert.equal((await request("/api/voice/session")).status, 503);
  const invalidSpeak = await request("/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"text":""}',
  });
  assert.equal(invalidSpeak.status, config.body.elevenlabs ? 400 : 503);
}
function load(path) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports: module.exports, module, Date, Set },
  );
  return module.exports;
}
const voice = load("lib/voice.ts"),
  exports = load("lib/export.ts");
const event = {
  id: "e1",
  clipId: "DJI_09",
  start: 0,
  end: 2,
  action: "transfer",
  description: "Observed",
  objects: ["pipette"],
  sourceSampleId: null,
  destinationSampleId: null,
  volumeUl: null,
  protocolStep: 1,
  confidence: 0.6,
  verification: "pending",
  origin: "model",
  flags: [
    { type: "tip_reuse", message: "Review tip", status: "needs_review" },
    {
      type: "unknown_sample",
      message: "Identify samples",
      status: "needs_review",
    },
  ],
  evidenceFrames: [0, 1],
};
const samples = [
  {
    id: "CELL-A",
    name: "Cell suspension A",
    kind: "cell suspension",
    synthetic: true,
  },
];
assert.equal(
  voice.interpretCommand(
    "Actually, I changed tips before that step",
    [event],
    samples,
    [],
  ).patch.flags[0].status,
  "dismissed",
);
const correction = voice.interpretCommand(
  "That's sample CELL-A. I'm adding 100 microlitres.",
  [event],
  samples,
  [],
);
assert.equal(correction.patch.sourceSampleId, "CELL-A");
assert.equal(correction.patch.volumeUl, 100);
assert.equal(correction.patch.flags, undefined);
assert.equal(
  voice.interpretCommand("source sample cell a", [event], samples, []).patch
    .sourceSampleId,
  "CELL-A",
);
assert.equal(
  voice.interpretCommand("event 9 volume 2 ul", [event], samples, []).patch,
  undefined,
);
assert.equal(
  voice
    .interpretCommand("current step", [event], samples, [
      { id: 1, title: "Prepare", description: "Reference" },
    ])
    .reply.includes("No current"),
  true,
);
assert.equal(
  voice
    .interpretCommand("next step", [event], samples, [
      { id: 1, title: "Prepare", description: "Reference" },
    ])
    .reply.includes("Reference step 1"),
  true,
);
const audit = [
  {
    eventId: "e1",
    timestamp: "2026-10-17T12:00:00Z",
    before: { volumeUl: null },
    after: { volumeUl: 100 },
  },
];
assert.equal(
  exports.buildNotebook([event], samples, [], audit).provenance
    .correctionAudit[0].before.volumeUl,
  null,
);
assert(
  exports
    .notebookMarkdown([event], samples, [], audit)
    .includes("2026-10-17T12:00:00Z"),
);
assert.equal(exports.roboticsData([event], audit).trajectories[0].pose, null);
assert.equal(
  exports.roboticsData([event], audit).trajectories[0].objects[0],
  "pipette",
);
assert(exports.roboticsCsv([event], audit).includes("correction_audit"));
const bio = exports.biologicalData([event], samples, audit);
assert.equal(bio.samples[0].cell_barcode, null);
assert.equal(bio.anndataJoin.status, "hypothetical");
assert.equal(bio.anndataJoin.example_obs[0].obs_index, null);
console.log(
  process.argv.includes("--pure")
    ? "Pure voice/export checks passed. HTTP checks skipped."
    : "Smoke checks passed: HTTP configuration, both cached analyses, invalid requests, voice configuration fallback, deterministic corrections, provenance/audit, unknown export measurements and hypothetical biological joins. No model or speech generation requested.",
);
