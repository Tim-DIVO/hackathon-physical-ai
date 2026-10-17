import { readFile } from "node:fs/promises";
// Reference labels are used only here, after inference, never in the model prompt.
const rows = JSON.parse(
  (await readFile("data/reference.json", "utf8")).replace(/^\uFEFF/, ""),
);
for (const row of rows) {
  let prediction;
  try {
    prediction = JSON.parse(
      await readFile(`data/analysis/${row.clip_id}.json`, "utf8"),
    );
  } catch {
    console.log(`${row.clip_id}: unavailable — no real cached model inference`);
    continue;
  }
  const reference = JSON.parse(row.protocol_json);
  const demonstrated = reference.steps.filter((s) => s.demonstrated);
  const covered = demonstrated.filter((s) =>
    prediction.events.some(
      (e) =>
        e.protocolStep === Number(s.step_id) &&
        Math.max(e.start, s.t_start) <= Math.min(e.end, s.t_end),
    ),
  );
  const predictedTipReuse = prediction.events.some((e) =>
    e.flags.some((f) => f.type === "tip_reuse"),
  );
  console.log(
    JSON.stringify(
      {
        clipId: row.clip_id,
        model: prediction.model,
        generatedAt: prediction.generatedAt,
        referenceDemonstratedSteps: demonstrated.length,
        temporallyOverlappingStepMatches: prediction.events.some(
          (e) => e.protocolStep !== null,
        )
          ? covered.length
          : null,
        analysisMethod: prediction.analysisMethod,
        blindEvaluation: false,
        datasetError: row.error || null,
        predictedTipReuse,
        referenceTipReuse: row.error.includes("without changing"),
        note: "Reference-aware comparison, not blind evaluation. Null step matches mean no protocol alignment was asserted. Coarse comparison only. Pending model flags require human review; step matching is not a validated benchmark score.",
      },
      null,
      2,
    ),
  );
}
