/** Recording identifier: the two reference clips or an id from data/library.json. */
export type ClipId = string;
export interface LabEvent {
  id: string;
  clipId: ClipId;
  start: number;
  end: number;
  action: string;
  description: string;
  objects: string[];
  sourceSampleId: string | null;
  destinationSampleId: string | null;
  volumeUl: number | null;
  protocolStep: number | null;
  /** Deprecated: self-reported model confidence is uncalibrated and is not displayed. */
  confidence?: number;
  /** Quantity visible in frames (pipette type, legible dial reading); never inferred. */
  visualQuantity?: string | null;
  verification: "pending" | "confirmed" | "corrected";
  origin: "model" | "operator";
  flags: {
    type: "tip_reuse" | "missing_step" | "unknown_sample";
    message: string;
    status: "needs_review" | "confirmed" | "dismissed";
    /** "supervisor" flags come from deterministic rules in lib/supervisor.ts. */
    source?: "model" | "supervisor";
  }[];
  evidenceFrames: number[];
  actionLabel?: ActionLabel;
  tipState?: TipState;
}
export type ActionLabel =
  | "pick_up"
  | "attach_tip"
  | "aspirate"
  | "dispense"
  | "eject_tip"
  | "mix"
  | "transfer"
  | "open_container"
  | "close_container"
  | "handle_dish"
  | "other";
export type TipState =
  | "fresh_tip_attached"
  | "tip_ejected"
  | "same_tip_continued"
  | "no_tip"
  | "unclear";
export interface Sample {
  id: string;
  name: string;
  kind: string;
  synthetic: boolean;
}
export interface AnalysisResult {
  clipId: ClipId;
  events: LabEvent[];
  model: string;
  generatedAt: string;
  frameTimes: number[];
  source: "model";
  analysisMethod?: string;
  limitations?: string;
  videoSha256?: string;
  promptVersion?: string;
  tipAudit?: {
    tipEvents: { t: number; kind: string; evidence: string }[];
    additions: { start: number; end: number }[];
    verdict: "tip_changed_between_additions" | "tip_reused" | "unclear";
    rationale: string;
    windowEnd: number;
    fps: number;
  };
}
export interface ProtocolStep {
  id: number;
  title: string;
  description: string;
}
