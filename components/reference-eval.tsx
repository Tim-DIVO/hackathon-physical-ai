import { BadgeCheck, ShieldAlert } from "lucide-react";
import truth from "@/lib/ground-truth.json";
import type { ClipId, LabEvent } from "@/lib/types";
import {
  formatTime,
  isReviewFlag,
  mergeRanges,
  overlapSeconds,
  type Range,
} from "@/lib/lab-utils";

interface TruthStep {
  id: number;
  start: number | null;
  end: number | null;
  demonstrated: boolean;
}
interface ClipTruth {
  hasError: boolean;
  error: string | null;
  operation: string;
  steps: TruthStep[];
}
const TRUTH = truth as Record<string, ClipTruth>;
/** Steps named in the dataset error text ("reagent 1/2/3" = protocol steps 1-3). Manual reading of the label. */
const ERROR_STEPS: Record<string, number[]> = { DJI_09: [1, 2, 3] };

type Verdict = "match" | "miss" | "false_positive";
interface ModelFlag {
  type: "tip_reuse" | "missing_step";
  range: Range;
  verdict: Verdict;
  note: string;
}

function stepRange(steps: TruthStep[], ids: number[]): Range | null {
  const sel = steps.filter(
    (s) => ids.includes(s.id) && s.start !== null && s.end !== null,
  );
  if (!sel.length) return null;
  return {
    start: Math.min(...sel.map((s) => s.start as number)),
    end: Math.max(...sel.map((s) => s.end as number)),
  };
}

function evaluate(
  clip: ClipTruth,
  errorRange: Range | null,
  events: LabEvent[],
): ModelFlag[] {
  const withFlag = (type: string) =>
    events.filter((e) =>
      e.flags.some(
        (f) => f.type === type && (isReviewFlag(f) || f.status === "confirmed"),
      ),
    );
  const tipFlags = mergeRanges(
    withFlag("tip_reuse").map((e) => ({ start: e.start, end: e.end })),
  ).map<ModelFlag>((range) => {
    if (!clip.hasError)
      return {
        type: "tip_reuse",
        range,
        verdict: "false_positive",
        note: "Dataset reference lists no error for this clip.",
      };
    if (errorRange && overlapSeconds(range, errorRange) > 0)
      return {
        type: "tip_reuse",
        range,
        verdict: "match",
        note: `Overlaps reference error span ${formatTime(errorRange.start)}–${formatTime(errorRange.end)}.`,
      };
    return {
      type: "tip_reuse",
      range,
      verdict: "miss",
      note: "Outside the reference error span.",
    };
  });
  const missing = withFlag("missing_step").map<ModelFlag>((e) => {
    const f = e.flags.find((x) => x.type === "missing_step");
    const stepId = Number(/Step (\d+)/.exec(f?.message ?? "")?.[1] ?? NaN);
    const ref = clip.steps.find((s) => s.id === stepId);
    return {
      type: "missing_step",
      range: { start: e.start, end: e.end },
      verdict: "false_positive",
      note: ref?.demonstrated
        ? `Reference shows step ${stepId} demonstrated at ${formatTime(ref.start ?? 0)}–${formatTime(ref.end ?? 0)}; it was not omitted.`
        : ref
          ? `Reference marks step ${stepId} as outside the recording (e.g. incubation), not as an annotated error.`
          : "Reference does not list a skipped step here.",
    };
  });
  return [...tipFlags, ...missing].sort((a, b) => a.range.start - b.range.start);
}

const VERDICT_TEXT: Record<Verdict, string> = {
  match: "Agrees with reference",
  miss: "Does not overlap reference",
  false_positive: "False positive vs reference",
};

function Lane({
  label,
  ranges,
  duration,
  cls,
}: {
  label: string;
  ranges: Range[];
  duration: number;
  cls: string;
}) {
  return (
    <div className="ev-lane">
      <span>{label}</span>
      <div className="ev-lane-track">
        {ranges.map((r, i) => (
          <i
            key={i}
            className={cls}
            style={{
              left: `${(r.start / duration) * 100}%`,
              width: `${Math.max(((r.end - r.start) / duration) * 100, 0.8)}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface Props {
  clipId: ClipId;
  events: LabEvent[];
  duration: number;
  onSeek: (t: number) => void;
}

export function ReferenceEval({ clipId, events, duration, onSeek }: Props) {
  const clip = TRUTH[clipId];
  if (!clip) return null;
  const errorSteps = ERROR_STEPS[clipId] ?? [];
  const errorRange = stepRange(clip.steps, errorSteps);
  const flags = evaluate(clip, errorRange, events);
  const matches = flags.filter((f) => f.verdict === "match").length;
  const fps = flags.filter((f) => f.verdict === "false_positive").length;
  return (
    <div className="ev-card">
      <h3 className="subheading">Model vs dataset reference</h3>
      <div className="ev-grid">
        <div className="ev-col ev-truth">
          <span className="ev-badge">
            <BadgeCheck size={12} /> Dataset ground truth — never shown to the
            model
          </span>
          <strong className={clip.hasError ? "ev-err" : "ev-ok"}>
            {clip.hasError ? clip.error : "No error annotated for this clip"}
          </strong>
          <p className="fine-print">
            {clip.operation} · step timings from the LSV annotation
          </p>
          <ul className="ev-steps">
            {clip.steps.map((s) => (
              <li
                key={s.id}
                className={errorSteps.includes(s.id) ? "ev-step-err" : ""}
              >
                <span>Step {s.id}</span>
                <span className="mono">
                  {s.demonstrated && s.start !== null
                    ? `${formatTime(s.start)}–${formatTime(s.end ?? 0)}`
                    : "not in recording"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="ev-col">
          <span className="ev-badge ev-badge-model">
            <ShieldAlert size={12} /> Model flags
          </span>
          {flags.length === 0 && (
            <p className="fine-print">
              The model raised no tip-reuse or missing-step flags on this clip.
            </p>
          )}
          {flags.map((f, i) => (
            <button
              key={i}
              className={`ev-flag ev-${f.verdict}`}
              onClick={() => onSeek(f.range.start)}
            >
              <span className="ev-flag-head">
                <strong>
                  {f.type === "tip_reuse" ? "Tip reuse" : "Missing step"}
                </strong>
                <span className="mono">
                  {formatTime(f.range.start)}–{formatTime(f.range.end)}
                </span>
              </span>
              <span className="ev-verdict">{VERDICT_TEXT[f.verdict]}</span>
              <small>{f.note}</small>
            </button>
          ))}
          <p className="fine-print">
            {flags.length
              ? `${matches} of ${flags.length} flag${flags.length === 1 ? "" : "s"} agree with the reference; ${fps} false positive${fps === 1 ? "" : "s"}. `
              : ""}
            Video alone cannot confirm a procedural error.
          </p>
        </div>
      </div>
      <div className="ev-lanes">
        {errorRange && (
          <Lane
            label="Reference error"
            ranges={[errorRange]}
            duration={duration}
            cls="ev-bar-ref"
          />
        )}
        <Lane
          label="Model flags"
          ranges={flags.map((f) => f.range)}
          duration={duration}
          cls="ev-bar-model"
        />
      </div>
    </div>
  );
}
