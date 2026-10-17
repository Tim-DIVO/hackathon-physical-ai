"use client";

import { useEffect, useRef } from "react";
import type { LabEvent } from "@/lib/types";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** A few cards keep the view clear; the full record is in the export and the workspace. */
const MAX_CARDS = 4;
const PIPETTING = new Set(["aspirate", "dispense", "transfer", "mix"]);

export interface NotebookLine {
  id: string;
  time: number;
  text: string;
  kind: "seen" | "said" | "check";
}

/** Operator statements written as notes, not as dialogue ("Operator: …", "You: …" removed). */
function asNote(text: string) {
  return text
    .replace(/^Operator:\s*/i, "")
    .replace(/\s*\(linked to "[^"]*" at [\d:]+\)/, "")
    .replace(/\s*You: “[^”]*” → /, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** One note per observation or operator statement, in plain lab-notebook shorthand. */
export function notebookLines(events: LabEvent[]): NotebookLine[] {
  return events.map((e) => {
    if (e.origin !== "model")
      return { id: e.id, time: e.start, text: asNote(e.description), kind: e.action === "Check" ? "check" : "said" };
    const bits = [e.action];
    if (e.visualQuantity) bits.push(e.visualQuantity);
    if (e.volumeUl) bits.push(`${e.volumeUl} µL`);
    if (e.concentration) bits.push(e.concentration);
    // Tip state only matters while liquid is moving; "same tip" on an incubator door is noise.
    if (e.actionLabel && PIPETTING.has(e.actionLabel)) {
      if (e.tipState === "same_tip_continued") bits.push("same tip");
      if (e.tipState === "fresh_tip_attached") bits.push("fresh tip");
    }
    if (e.actionLabel === "attach_tip") bits.push("fresh tip");
    if (e.actionLabel === "eject_tip" || e.tipState === "tip_ejected") bits.push("tip off");
    return { id: e.id, time: e.start, text: bits.join(" · "), kind: "seen" };
  });
}

/**
 * Lab notes as glass cards down the right of the view. New cards pop in below the last one; once the
 * column is full it scrolls itself to the newest. Read-only: nothing here is clickable or scrollable by hand.
 */
export function LabNotebook({ lines }: { lines: NotebookLine[] }) {
  const column = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = column.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  return (
    <aside className="notes" aria-label="Lab notes" aria-live="polite">
      <ol ref={column}>
        {lines.slice(-MAX_CARDS).map((l) => (
          <li key={l.id} className={`note ${l.kind}`}>
            <time>{fmt(l.time)}</time>
            <p>{l.text}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
