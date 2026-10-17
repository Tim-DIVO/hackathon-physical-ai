import { ScanEye, TriangleAlert } from "lucide-react";
import type { LabEvent } from "@/lib/types";
import {
  FLAG_PILL_TEXT,
  formatTime,
  isReviewFlag,
  prettyLabel,
} from "@/lib/lab-utils";

const MAX_CHIPS = 4;

export function DetectionOverlay({ event }: { event: LabEvent | undefined }) {
  if (!event) return null;
  const review = event.flags.filter(isReviewFlag);
  const isModel = event.origin === "model";
  const title = event.actionLabel && event.actionLabel !== "other"
    ? prettyLabel(event.actionLabel)
    : event.action;
  const chips = event.objects.slice(0, MAX_CHIPS);
  return (
    <div className="det-overlay" aria-live="polite">
      <div className="det-head">
        <ScanEye size={11} />
        {isModel ? "Model observation" : "Operator observation"}
        {isModel && <span className="det-conf">pending review</span>}
      </div>
      <strong className="det-title">{title}</strong>
      {chips.length > 0 && (
        <div className="det-chips">
          {chips.map((o) => (
            <span key={o}>{o}</span>
          ))}
          {event.objects.length > MAX_CHIPS && (
            <span>+{event.objects.length - MAX_CHIPS}</span>
          )}
        </div>
      )}
      {event.visualQuantity && (
        <div className="det-qty">Visible in frame: {event.visualQuantity}</div>
      )}
      {review.map((f, i) => (
        <div className="det-flag" key={i}>
          <TriangleAlert size={12} />
          <span>
            {FLAG_PILL_TEXT[f.type]} · needs review
            <small>
              Evidence {formatTime(event.start)}–{formatTime(event.end)}
            </small>
          </span>
        </div>
      ))}
    </div>
  );
}
