import type { LabEvent } from "./types";

/**
 * Deterministic rigor rules applied on top of model observations. Rules only cite
 * evidence already in the event stream, and never add a flag type an operator has
 * already resolved on that event.
 */
const INCUBATION_S = 20 * 60;
const ADDITION = new Set(["dispense", "transfer"]);
const TIP_CHANGE = new Set(["attach_tip", "eject_tip"]);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Flag = LabEvent["flags"][number];
const withFlag = (e: LabEvent, flag: Flag): LabEvent =>
  e.flags.some((f) => f.type === flag.type) ? e : { ...e, flags: [...e.flags, flag] };

function tipChangedBetween(events: LabEvent[], from: number, to: number) {
  return events
    .slice(from + 1, to + 1)
    .some(
      (e) =>
        TIP_CHANGE.has(e.actionLabel ?? "") ||
        e.tipState === "fresh_tip_attached" ||
        e.tipState === "tip_ejected" ||
        e.flags.some((f) => f.type === "tip_reuse" && f.status === "dismissed"),
    );
}

export function applySupervisor(input: LabEvent[]): LabEvent[] {
  const events = [...input].sort((a, b) => a.start - b.start);
  const out = [...events];
  // Step numbers 1-3 (reagent additions), 4 (mix) and 6 (delivery) mean that only in the CRISPR reference
  // protocol; other clips number their own dataset protocol differently.
  const crispr = events.some((e) => e.clipId.startsWith("DJI"));
  const additions = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.origin === "model" && ADDITION.has(e.actionLabel ?? "") && (!crispr || (e.protocolStep ?? 0) <= 3));

  // Rule 1: two reagent additions with no observed tip change in between.
  for (let k = 1; k < additions.length; k++) {
    const prev = additions[k - 1];
    const cur = additions[k];
    if (prev.e.protocolStep === cur.e.protocolStep && cur.e.protocolStep !== null) continue;
    if (tipChangedBetween(events, prev.i, cur.i)) continue;
    out[cur.i] = withFlag(out[cur.i], {
      type: "tip_reuse",
      source: "supervisor",
      status: "needs_review",
      message: `Additions at ${fmt(prev.e.start)} and ${fmt(cur.e.start)} with no tip change observed in between. Confirm a fresh tip was used.`,
    });
  }

  // Rule 2: reference protocol requires a 20 min incubation between mixing and delivery.
  const mix = events.filter((e) => e.protocolStep === 4 || e.actionLabel === "mix").at(-1);
  const deliveryIndex = events.findIndex((e) => e.protocolStep === 6);
  if (crispr && mix && deliveryIndex >= 0) {
    const gap = events[deliveryIndex].start - mix.end;
    if (gap >= 0 && gap < INCUBATION_S)
      out[deliveryIndex] = withFlag(out[deliveryIndex], {
        type: "missing_step",
        source: "supervisor",
        status: "needs_review",
        message: `Delivery began ${Math.round(gap)} s after mixing; the protocol requires a 20 min room-temperature incubation. Confirm whether it happened off camera.`,
      });
  }

  // Rule 3: additions need operator-confirmed identities for provenance.
  for (const { i } of additions) {
    const e = out[i];
    if (!e.sourceSampleId || !e.destinationSampleId)
      out[i] = withFlag(e, {
        type: "unknown_sample",
        source: "supervisor",
        status: "needs_review",
        message: "Source or destination not confirmed. Say which sample this was.",
      });
  }
  return out;
}

/** Open questions the operator should answer, derived from unresolved flags. */
export function openQuestions(events: LabEvent[]) {
  return events.flatMap((e) =>
    e.flags.filter((f) => f.status === "needs_review").map((f) => ({ event: e, flag: f })),
  );
}
