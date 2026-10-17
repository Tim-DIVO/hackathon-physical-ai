import type { LabEvent, Sample, ProtocolStep } from "./types";
export interface CorrectionAudit {
  eventId: string;
  timestamp: string;
  before: Partial<LabEvent>;
  after: Partial<LabEvent>;
}
function provenance(events: LabEvent[], audit: CorrectionAudit[] = []) {
  return {
    application: "LabLens",
    exportedAt: new Date().toISOString(),
    clipIds: [...new Set(events.map((e) => e.clipId))],
    note: "Video-derived observations require human verification. Null values are unknown; no measurements are inferred.",
    correctionAudit: audit,
    correctedEventIds: events
      .filter((e) => e.verification === "corrected")
      .map((e) => e.id),
  };
}
export function buildNotebook(
  events: LabEvent[],
  samples: Sample[],
  protocol: ProtocolStep[],
  audit: CorrectionAudit[] = [],
) {
  return {
    schema: "lablens.notebook.v1",
    provenance: provenance(events, audit),
    samples,
    protocol,
    events,
  };
}
export function notebookMarkdown(
  events: LabEvent[],
  samples: Sample[],
  protocol: ProtocolStep[],
  audit: CorrectionAudit[] = [],
) {
  return `# LabLens laboratory notebook\n\n${provenance(events).note}\n\n## Samples\n${samples.map((s) => `- ${s.id}: ${s.name} (${s.kind}; synthetic: ${s.synthetic})`).join("\n")}\n\n## Protocol\n${protocol.map((p) => `${p.id}. ${p.title}: ${p.description}`).join("\n")}\n\n## Observations\n${events.map((e) => `### ${e.start.toFixed(1)}-${e.end.toFixed(1)} s: ${e.action}\n${e.description}\n\nSource: ${e.sourceSampleId ?? "unknown"}; destination: ${e.destinationSampleId ?? "unknown"}; volume: ${e.volumeUl === null ? "unknown" : e.volumeUl + " uL"}. Verification: ${e.verification}. Origin: ${e.origin}. Visible in frame: ${e.visualQuantity ?? "not recorded"}. Operator-confirmed volume: ${e.volumeUl === null ? "none" : e.volumeUl + " uL"}. Clip: ${e.clipId}. Evidence frames: ${e.evidenceFrames.join(", ")}.\n${e.flags.map((f) => `- ${f.type}: ${f.message} [${f.status}]`).join("\n")}`).join("\n\n")}\n\n## Provenance and correction audit\n\n\`\`\`json\n${JSON.stringify(provenance(events, audit), null, 2)}\n\`\`\`\n`;
}
export function roboticsData(
  events: LabEvent[],
  audit: CorrectionAudit[] = [],
) {
  return {
    schema: "lablens.robotics.v1",
    provenance: provenance(events, audit),
    coordinateSystem: null,
    warning:
      "Semantic action timeline only. No measured robot pose, joint angles, forces or executable robot commands are available.",
    trajectories: events.map((e) => ({
      eventId: e.id,
      startSeconds: e.start,
      endSeconds: e.end,
      action: e.action,
      objects: e.objects,
      sourceSampleId: e.sourceSampleId,
      destinationSampleId: e.destinationSampleId,
      volumeUl: e.volumeUl,
      protocolStep: e.protocolStep,
      evidenceFrames: e.evidenceFrames,
      origin: e.origin,
      visualQuantity: e.visualQuantity ?? null,
      pose: null,
      joints: null,
      verification: e.verification,
      clipId: e.clipId,
    })),
  };
}
export function roboticsCsv(events: LabEvent[], audit: CorrectionAudit[] = []) {
  const cell = (v: unknown) =>
    v === null
      ? ""
      : `"${String(typeof v === "object" ? JSON.stringify(v) : v).replaceAll('"', '""')}"`;
  return [
    "event_id,clip_id,start_seconds,end_seconds,action,objects,source_sample,destination_sample,volume_ul,protocol_step,evidence_frames,origin,visual_quantity,verification,pose,joints,correction_audit,measurement_note",
    ...events.map((e) =>
      [
        e.id,
        e.clipId,
        e.start,
        e.end,
        e.action,
        e.objects,
        e.sourceSampleId,
        e.destinationSampleId,
        e.volumeUl,
        e.protocolStep,
        e.evidenceFrames,
        e.origin,
        e.visualQuantity ?? null,
        e.verification,
        null,
        null,
        audit.filter((a) => a.eventId === e.id),
        "Semantic only; blank values unknown; pose and joints unmeasured",
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}
export function biologicalData(
  events: LabEvent[],
  samples: Sample[],
  audit: CorrectionAudit[] = [],
) {
  return {
    schema: "lablens.biological-execution.v1",
    provenance: provenance(events, audit),
    samples: samples.map((s) => {
      const handling = events.filter(
        (e) => e.sourceSampleId === s.id || e.destinationSampleId === s.id,
      );
      return {
        sample_id: s.id,
        name: s.name,
        kind: s.kind,
        cell_line: null,
        synthetic: s.synthetic,
        metadata_status: s.synthetic
          ? "synthetic demonstration label"
          : "operator label; cell line unmeasured",
        treatment_id: null,
        treatment_time: null,
        handling_events: handling,
        protocol_deviations: handling.flatMap((e) =>
          e.flags.map((f) => ({ event_id: e.id, ...f })),
        ),
        sample_lineage: handling
          .filter((e) => e.destinationSampleId === s.id && e.sourceSampleId)
          .map((e) => ({ parent_sample_id: e.sourceSampleId, event_id: e.id })),
        sequencing_library_id: null,
        cell_barcode: null,
        evidence_refs: handling.map((e) => ({
          clip_id: e.clipId,
          event_id: e.id,
          frame_times: e.evidenceFrames,
        })),
      };
    }),
    anndataJoin: {
      status: "hypothetical",
      description:
        "Illustrative schema only. No AnnData file has been loaded or joined. No gene expression, cell count or biological outcome is inferred.",
      suggestedJoinKey: "sample_id",
      anndataPath: null,
      example_obs: samples
        .slice(0, 2)
        .map((s) => ({
          hypothetical: true,
          obs_index: null,
          sample_id: s.id,
          cell_barcode: null,
          sequencing_library_id: null,
          execution_event_ids: events
            .filter(
              (e) =>
                e.sourceSampleId === s.id || e.destinationSampleId === s.id,
            )
            .map((e) => e.id),
        })),
    },
  };
}
function save(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadNotebook(
  events: LabEvent[],
  samples: Sample[],
  protocol: ProtocolStep[],
  format: "md" | "json" = "md",
  audit: CorrectionAudit[] = [],
) {
  save(
    `lablens-notebook.${format}`,
    format === "md"
      ? notebookMarkdown(events, samples, protocol, audit)
      : JSON.stringify(
          buildNotebook(events, samples, protocol, audit),
          null,
          2,
        ),
    format === "md" ? "text/markdown" : "application/json",
  );
}
export function downloadRobotics(
  events: LabEvent[],
  format: "csv" | "json" = "json",
  audit: CorrectionAudit[] = [],
) {
  save(
    `lablens-robotics.${format}`,
    format === "csv"
      ? roboticsCsv(events, audit)
      : JSON.stringify(roboticsData(events, audit), null, 2),
    format === "csv" ? "text/csv" : "application/json",
  );
}
export function downloadBiological(
  events: LabEvent[],
  samples: Sample[],
  audit: CorrectionAudit[] = [],
) {
  save(
    "lablens-biological.json",
    JSON.stringify(biologicalData(events, samples, audit), null, 2),
    "application/json",
  );
}
