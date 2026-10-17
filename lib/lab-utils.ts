import type { LabEvent } from "./types";

export const formatTime = (n: number): string =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;

/** Flags that need a human decision and are not just "identity not linked yet". */
export const isReviewFlag = (f: LabEvent["flags"][number]): boolean =>
  f.status === "needs_review" && f.type !== "unknown_sample";

export const hasReviewFlag = (e: LabEvent): boolean => e.flags.some(isReviewFlag);

export const FLAG_PILL_TEXT: Record<LabEvent["flags"][number]["type"], string> = {
  tip_reuse: "Possible tip reuse",
  missing_step: "Possible skipped step",
  unknown_sample: "Sample not linked",
};

export const prettyLabel = (s: string): string =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export interface Range {
  start: number;
  end: number;
}

export function overlapSeconds(a: Range, b: Range): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Merge ranges that touch or are within gap seconds of each other. */
export function mergeRanges(ranges: Range[], gap = 2): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return sorted.reduce<Range[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.start - last.end <= gap)
      return [...acc.slice(0, -1), { start: last.start, end: Math.max(last.end, r.end) }];
    return [...acc, { ...r }];
  }, []);
}
