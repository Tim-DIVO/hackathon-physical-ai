// Cell atlas preview: SIMULATED single-cell data. Nothing here comes from sequencing.
// Pure and deterministic: same (events, samples) in, same atlas out.
import type { LabEvent, Sample } from "./types";

export const DISH_TREATED = "DISH-01";
export const DISH_CTRL = "DISH-CTRL";
export const FLAG_CARRYOVER = "reagent carry-over risk";
export const FLAG_STEP = "protocol step unverified";
export const PERTURB_SG = "sgTARGET (simulated)";
export const PERTURB_NT = "non-targeting";

export type AtlasCluster =
  | "Cycling G1"
  | "Cycling S/G2M"
  | "Edited (KO signature)"
  | "Stress response";
export type ProvenanceStatus = "verified" | "needs_review" | "unlinked";

export interface BaseCell {
  cell_id: string;
  sample_id: string;
  sample_name: string;
  cell_line: "HEK293T";
  perturbation: string;
  cluster: AtlasCluster;
  synthetic: true;
  x: number;
  y: number;
  /** stable per-cell uniforms in [0,1) used for deterministic subsetting/jitter */
  u: number;
  v: number;
}

export interface DerivedCell extends BaseCell {
  provenance_status: ProvenanceStatus;
  provenance_note: string;
  handling_flags: string[];
  training_eligible: boolean;
  evidence_refs: string[];
  /** target display coordinates (base position, or drifted toward the mixed region) */
  tx: number;
  ty: number;
}

export interface AtlasExplanation {
  id: string;
  tone: "warn" | "ok" | "info";
  text: string;
  meaning: string;
}

export interface AtlasSummary {
  total: number;
  byStatus: Record<ProvenanceStatus, number>;
  flagged: number;
  trainingEligible: number;
  byFlag: Record<string, number>;
  explanations: AtlasExplanation[];
}

export interface AtlasResult {
  cells: DerivedCell[];
  summary: AtlasSummary;
}

export type ObsRow = Pick<
  DerivedCell,
  | "cell_id"
  | "sample_id"
  | "cell_line"
  | "perturbation"
  | "cluster"
  | "provenance_status"
  | "handling_flags"
  | "training_eligible"
  | "evidence_refs"
>;

// ---------- seeded PRNG ----------
const SEED = 20261017;
const TREATED_CELLS = 1000;
const CTRL_CELLS = 200;
const CARRYOVER_FRACTION = 0.25;
const DRIFT_NEEDS_REVIEW: readonly [number, number] = [0.35, 0.4];
const DRIFT_CONFIRMED: readonly [number, number] = [0.42, 0.5];
const MAX_EVIDENCE_REFS = 4;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

interface ClusterSpec {
  name: AtlasCluster;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export const CLUSTERS: readonly ClusterSpec[] = [
  { name: "Cycling G1", cx: -4.2, cy: 1.5, sx: 0.85, sy: 0.8 },
  { name: "Cycling S/G2M", cx: -1.0, cy: 4.8, sx: 0.8, sy: 0.7 },
  { name: "Edited (KO signature)", cx: 4.5, cy: -0.5, sx: 0.9, sy: 1.0 },
  { name: "Stress response", cx: 0.5, cy: -4.2, sx: 0.8, sy: 0.7 },
];
export const CLUSTER_NAMES: readonly AtlasCluster[] = CLUSTERS.map((c) => c.name);

// cumulative cluster weights
const TREATED_WEIGHTS = [0.3, 0.52, 0.88, 1];
const CTRL_WEIGHTS = [0.48, 0.86, 0.86, 1];

function pickCluster(r: number, weights: number[]): ClusterSpec {
  const i = weights.findIndex((w) => r < w);
  return CLUSTERS[i === -1 ? CLUSTERS.length - 1 : i];
}

let baseCache: readonly BaseCell[] | null = null;

export function generateBaseCells(): readonly BaseCell[] {
  if (baseCache) return baseCache;
  const rng = mulberry32(SEED);
  const out: BaseCell[] = [];
  const make = (
    sample: string,
    name: string,
    perturbation: string,
    weights: number[],
    n: number,
    suffix: number,
  ) => {
    for (let i = 0; i < n; i++) {
      const c = pickCluster(rng(), weights);
      const bases = Array.from({ length: 16 }, () => "ACGT"[Math.floor(rng() * 4)]).join("");
      out.push({
        cell_id: `SYN-${bases}-${suffix}`,
        sample_id: sample,
        sample_name: name,
        cell_line: "HEK293T",
        perturbation,
        cluster: c.name,
        synthetic: true,
        x: c.cx + gauss(rng) * c.sx,
        y: c.cy + gauss(rng) * c.sy,
        u: rng(),
        v: rng(),
      });
    }
  };
  make(DISH_TREATED, "10 cm dish, CRISPR-treated", PERTURB_SG, TREATED_WEIGHTS, TREATED_CELLS, 1);
  make(DISH_CTRL, "Non-targeting control dish", PERTURB_NT, CTRL_WEIGHTS, CTRL_CELLS, 2);
  baseCache = out;
  return out;
}

function centroid(cells: readonly BaseCell[], sample: string, cluster?: AtlasCluster) {
  const sel = cells.filter((c) => c.sample_id === sample && (!cluster || c.cluster === cluster));
  const n = Math.max(sel.length, 1);
  return {
    x: sel.reduce((s, c) => s + c.x, 0) / n,
    y: sel.reduce((s, c) => s + c.y, 0) / n,
  };
}

/** Midpoint between the Edited cluster and the non-targeting control centroid. */
export function mixedRegion(): { x: number; y: number } {
  const base = generateBaseCells();
  const edited = centroid(base, DISH_TREATED, "Edited (KO signature)");
  const nt = centroid(base, DISH_CTRL);
  return { x: (edited.x + nt.x) / 2, y: (edited.y + nt.y) / 2 };
}

export function atlasBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  const base = generateBaseCells();
  const pad = 0.8;
  return {
    minX: Math.min(...base.map((c) => c.x)) - pad,
    maxX: Math.max(...base.map((c) => c.x)) + pad,
    minY: Math.min(...base.map((c) => c.y)) - pad,
    maxY: Math.max(...base.map((c) => c.y)) + pad,
  };
}

// ---------- event helpers ----------
const pad2 = (n: number) => String(n).padStart(2, "0");
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
const fmtRange = (e: LabEvent) => `${fmtTime(e.start)}–${fmtTime(e.end)}`;
const evidenceRef = (e: LabEvent) => `${e.clipId}@${Math.round(e.start)}-${Math.round(e.end)}s`;
const uniq = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

function flaggedEvents(events: LabEvent[], type: LabEvent["flags"][number]["type"]) {
  return events.flatMap((event) =>
    event.flags.filter((f) => f.type === type).map((flag) => ({ event, flag })),
  );
}

interface Rules {
  linked: boolean;
  linkEvents: LabEvent[];
  tipLevel: "none" | "needs_review" | "confirmed";
  tipActive: LabEvent[];
  tipDismissed: LabEvent[];
  stepOpen: LabEvent[];
  unknownOpen: LabEvent[];
}

function readRules(events: LabEvent[]): Rules {
  const linkEvents = events.filter((e) => e.destinationSampleId === DISH_TREATED);
  const tips = flaggedEvents(events, "tip_reuse");
  const active = tips.filter((t) => t.flag.status !== "dismissed");
  const tipLevel = active.some((t) => t.flag.status === "confirmed")
    ? "confirmed"
    : active.length > 0
      ? "needs_review"
      : "none";
  const open = (type: "missing_step" | "unknown_sample") =>
    flaggedEvents(events, type)
      .filter((t) => t.flag.status === "needs_review")
      .map((t) => t.event);
  return {
    linked: linkEvents.length > 0,
    linkEvents,
    tipLevel,
    tipActive: uniq(active.map((t) => t.event)),
    tipDismissed: tipLevel === "none" ? uniq(tips.map((t) => t.event)) : [],
    stepOpen: open("missing_step"),
    unknownOpen: open("unknown_sample"),
  };
}

function driftFor(cell: BaseCell, level: Rules["tipLevel"]): number {
  const [lo, hi] = level === "confirmed" ? DRIFT_CONFIRMED : DRIFT_NEEDS_REVIEW;
  return lo + (hi - lo) * cell.v;
}

// ---------- main derivation ----------
export function deriveAtlas(events: LabEvent[], samples: Sample[]): AtlasResult {
  const rules = readRules(events);
  const mix = mixedRegion();
  const names = new Map(samples.map((s) => [s.id, s.name]));
  const hasOpenFlag =
    rules.tipActive.length > 0 || rules.stepOpen.length > 0 || rules.unknownOpen.length > 0;
  const status: ProvenanceStatus = !rules.linked
    ? "unlinked"
    : hasOpenFlag
      ? "needs_review"
      : "verified";
  const refs = (es: LabEvent[]) => es.map(evidenceRef);

  const cells: DerivedCell[] = generateBaseCells().map((cell) => {
    const sample_name = names.get(cell.sample_id) ?? cell.sample_name;
    if (cell.sample_id === DISH_CTRL) {
      return {
        ...cell, sample_name,
        provenance_status: "verified",
        provenance_note: "synthetic control",
        handling_flags: [],
        training_eligible: true,
        evidence_refs: [],
        tx: cell.x,
        ty: cell.y,
      };
    }
    const carry = rules.tipLevel !== "none" && cell.u < CARRYOVER_FRACTION;
    const handling_flags = [
      ...(carry ? [FLAG_CARRYOVER] : []),
      ...(rules.stepOpen.length > 0 ? [FLAG_STEP] : []),
    ];
    const t = carry ? driftFor(cell, rules.tipLevel) : 0;
    return {
      ...cell, sample_name,
      provenance_status: status,
      provenance_note: "",
      handling_flags,
      training_eligible: status === "verified" && handling_flags.length === 0,
      evidence_refs: uniq([
        ...refs(rules.linkEvents),
        ...(carry ? refs(rules.tipActive) : []),
        ...(rules.stepOpen.length > 0 ? refs(rules.stepOpen) : []),
      ]).slice(0, MAX_EVIDENCE_REFS),
      tx: cell.x + (mix.x - cell.x) * t,
      ty: cell.y + (mix.y - cell.y) * t,
    };
  });

  return { cells, summary: summarize(cells, rules) };
}

function summarize(cells: DerivedCell[], rules: Rules): AtlasSummary {
  const byStatus: Record<ProvenanceStatus, number> = { verified: 0, needs_review: 0, unlinked: 0 };
  const byFlag: Record<string, number> = {};
  let flagged = 0;
  let trainingEligible = 0;
  for (const c of cells) {
    byStatus[c.provenance_status]++;
    if (c.handling_flags.length > 0) flagged++;
    if (c.training_eligible) trainingEligible++;
    for (const f of c.handling_flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
  }
  return {
    total: cells.length,
    byStatus,
    flagged,
    trainingEligible,
    byFlag,
    explanations: explain(rules, byFlag),
  };
}

const ranges = (es: LabEvent[]) => es.map(fmtRange).join(", ");

function explain(rules: Rules, byFlag: Record<string, number>): AtlasExplanation[] {
  const out: AtlasExplanation[] = [];
  const n = (flag: string) => byFlag[flag] ?? 0;
  if (rules.linked) {
    out.push({
      id: "linked", tone: "ok",
      text: `Transfer into ${DISH_TREATED} recorded at ${ranges(rules.linkEvents)} → ${TREATED_CELLS} ${DISH_TREATED} cells now trace to a logged delivery event.`,
      meaning: "The dish is tied to a documented delivery step, so its cells can inherit execution metadata.",
    });
  } else {
    out.push({
      id: "unlinked", tone: "info",
      text: `No event delivers into ${DISH_TREATED} yet → ${TREATED_CELLS} cells are unlinked and held out of the training set.`,
      meaning: "Without a link from the dish to a delivery step, nothing says what was actually done to these cells.",
    });
  }
  if (rules.tipLevel !== "none") {
    const confirmed = rules.tipLevel === "confirmed";
    out.push({
      id: `tip:${rules.tipLevel}`, tone: "warn",
      text: `Tip-reuse flag at ${ranges(rules.tipActive)} (${confirmed ? "confirmed" : "needs review"}) → ${n(FLAG_CARRYOVER)} ${DISH_TREATED} cells tagged '${FLAG_CARRYOVER}' and excluded from training set.`,
      meaning: confirmed
        ? "Carry-over is confirmed, so some cells likely saw a mixed guide/plasmid dose; they shift further toward a mixed-perturbation state."
        : "If one tip touched more than one reagent, some cells may have had uneven exposure; they shift partway toward a mixed-perturbation state.",
    });
  } else if (rules.tipDismissed.length > 0) {
    out.push({
      id: "tip:dismissed", tone: "ok",
      text: `Tip-reuse flag at ${ranges(rules.tipDismissed)} dismissed (tips changed) → carry-over tags removed; cells return to their base positions.`,
      meaning: "With fresh tips between reagents there is no recorded route for cross-exposure, so cells are treated as uniformly perturbed.",
    });
  }
  if (rules.stepOpen.length > 0) {
    out.push({
      id: "step", tone: "warn",
      text: `Missing-step flag at ${ranges(rules.stepOpen)} (needs review) → ${n(FLAG_STEP)} ${DISH_TREATED} cells tagged '${FLAG_STEP}' (no position change).`,
      meaning: "A skipped step could shift editing efficiency for the whole dish, so cells keep their position but are not trusted for training yet.",
    });
  }
  if (rules.unknownOpen.length > 0) {
    out.push({
      id: "unknown", tone: "warn",
      text: `Unknown-sample flag at ${ranges(rules.unknownOpen)} (needs review) → ${DISH_TREATED} provenance held at 'needs review'.`,
      meaning: "If the material used cannot be identified, the perturbation label on these cells is not yet certain.",
    });
  }
  return out;
}

// ---------- obs rows for export / preview ----------
function toObsRow(c: DerivedCell): ObsRow {
  return {
    cell_id: c.cell_id,
    sample_id: c.sample_id,
    cell_line: c.cell_line,
    perturbation: c.perturbation,
    cluster: c.cluster,
    provenance_status: c.provenance_status,
    handling_flags: c.handling_flags,
    training_eligible: c.training_eligible,
    evidence_refs: c.evidence_refs,
  };
}

/** Deterministic, varied sample of cells: flagged ones first, then one per sample/cluster. */
export function representativeRows(cells: DerivedCell[], limit: number): ObsRow[] {
  const seen = new Set<string>();
  const picked: DerivedCell[] = [];
  const flaggedFirst = [...cells].sort(
    (a, b) => Number(b.handling_flags.length > 0) - Number(a.handling_flags.length > 0),
  );
  for (const c of flaggedFirst) {
    const key = `${c.sample_id}|${c.cluster}|${c.handling_flags.join("+")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
  }
  return picked.slice(0, Math.max(0, limit)).map(toObsRow);
}

export function atlasObsRows(events: LabEvent[], samples: Sample[], limit = 8): ObsRow[] {
  return representativeRows(deriveAtlas(events, samples).cells, limit);
}
