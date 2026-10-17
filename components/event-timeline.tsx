import type { LabEvent } from "@/lib/types";
import { formatTime, hasReviewFlag } from "@/lib/lab-utils";

interface Props {
  events: LabEvent[];
  duration: number;
  current: number;
  selectedId: string | null;
  onSeek: (event: LabEvent) => void;
  onScrub: (seconds: number) => void;
}

const pct = (n: number, d: number) => `${Math.min(100, Math.max(0, (n / d) * 100))}%`;

export function EventTimeline({
  events,
  duration,
  current,
  selectedId,
  onSeek,
  onScrub,
}: Props) {
  const flagged = events.filter(hasReviewFlag).length;
  return (
    <div className="timeline evt-timeline">
      <div
        className="evt-track"
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const box = e.currentTarget.getBoundingClientRect();
          onScrub(((e.clientX - box.left) / box.width) * duration);
        }}
      >
        {events.map((e) => {
          const warn = hasReviewFlag(e);
          const left = (e.start / duration) * 100;
          const width = Math.max(((e.end - e.start) / duration) * 100, 0.9);
          return (
            <button
              key={e.id}
              type="button"
              className={`evt-seg ${warn ? "evt-warn" : ""} ${e.origin === "operator" ? "evt-op" : ""} ${selectedId === e.id ? "evt-sel" : ""} ${e.start <= current && e.end >= current ? "evt-now" : ""}`}
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
              title={`${formatTime(e.start)}–${formatTime(e.end)} · ${e.action}${warn ? " · needs review" : ""}`}
              aria-label={`Seek to ${formatTime(e.start)}: ${e.action}${warn ? " (needs review)" : ""}`}
              onClick={() => onSeek(e)}
            />
          );
        })}
        <span className="evt-playhead" style={{ left: pct(current, duration) }} />
      </div>
      <div className="evt-axis">
        <span>00:00</span>
        <span className="evt-legend">
          <i className="lg-seg" /> Model events
          <i className="lg-seg lg-warn" /> Needs review ({flagged})
          <i className="lg-seg lg-op" /> Operator
        </span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
