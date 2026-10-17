"use client";
import { useState } from "react";
import type { LabEvent, Sample } from "@/lib/types";
import { formatTime, hasReviewFlag } from "@/lib/lab-utils";

type NodeId = string;
const UNLINKED = "UNLINKED";
const EP = "EP_TUBE";
const W = 800;
const H = 400;
const NODE_W = 132;
const NODE_H = 48;
const TRANSFER_LABELS = new Set(["dispense", "aspirate", "transfer"]);

interface GNode {
  id: NodeId;
  x: number;
  y: number;
  title: string;
  sub: string;
  kind: "sample" | "vessel" | "unlinked";
}
interface GEdge {
  event: LabEvent;
  from: NodeId;
  to: NodeId;
  linked: boolean;
  flagged: boolean;
}

const REGISTRY_POS: Record<string, [number, number]> = {
  "CELL-A": [110, 70],
  "REAGENT-01": [110, 190],
  "PLASMID-01": [110, 310],
  "DISH-01": [690, 190],
};

function buildNodes(samples: Sample[]): GNode[] {
  const registry = samples.map<GNode>((s, i) => {
    const [x, y] = REGISTRY_POS[s.id] ?? [110, 70 + i * 120];
    return { id: s.id, x, y, title: s.id, sub: s.name, kind: "sample" };
  });
  return [
    ...registry,
    {
      id: EP,
      x: 400,
      y: 150,
      title: "EP tube (mixture)",
      sub: "model-observed vessel",
      kind: "vessel",
    },
    {
      id: UNLINKED,
      x: 400,
      y: 345,
      title: "Unlinked",
      sub: "awaiting identity",
      kind: "unlinked",
    },
  ];
}

/** Model hint only: protocol steps 1-4 happen in the EP tube, 6-7 at the dish. */
function hintNode(e: LabEvent): NodeId | null {
  if (e.protocolStep !== null && e.protocolStep >= 1 && e.protocolStep <= 4)
    return EP;
  if (e.protocolStep === 6 || e.protocolStep === 7) return "DISH-01";
  return null;
}

function buildEdges(events: LabEvent[], nodeIds: Set<NodeId>): GEdge[] {
  return events.flatMap<GEdge>((e) => {
    const src =
      e.sourceSampleId && nodeIds.has(e.sourceSampleId)
        ? e.sourceSampleId
        : null;
    const dst =
      e.destinationSampleId && nodeIds.has(e.destinationSampleId)
        ? e.destinationSampleId
        : null;
    const isTransfer =
      (e.actionLabel && TRANSFER_LABELS.has(e.actionLabel)) || (src && dst);
    if (!isTransfer && !src && !dst) return [];
    const flagged = hasReviewFlag(e);
    if (src && dst)
      return [{ event: e, from: src, to: dst, linked: true, flagged }];
    const from = src ?? UNLINKED;
    const to = dst ?? hintNode(e);
    if (!to || from === to) return [];
    return [{ event: e, from, to, linked: false, flagged }];
  });
}

function clip(c: GNode, tx: number, ty: number, pad = 4): [number, number] {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const hw = NODE_W / 2 + pad;
  const hh = NODE_H / 2 + pad;
  const s = Math.min(
    dx ? hw / Math.abs(dx) : Infinity,
    dy ? hh / Math.abs(dy) : Infinity,
  );
  return [c.x + dx * s, c.y + dy * s];
}

function edgeGeometry(a: GNode, b: GNode, k: number, n: number) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const off = (k - (n - 1) / 2) * 34;
  const cx = mx + (-(b.y - a.y) / len) * off;
  const cy = my + ((b.x - a.x) / len) * off;
  const [x1, y1] = clip(a, cx, cy);
  const [x2, y2] = clip(b, cx, cy, 8);
  return {
    d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`,
    lx: 0.25 * x1 + 0.5 * cx + 0.25 * x2,
    ly: 0.25 * y1 + 0.5 * cy + 0.25 * y2,
  };
}

interface Props {
  events: LabEvent[];
  samples: Sample[];
  onOpenEvent: (e: LabEvent) => void;
}

export function TransferGraph({ events, samples, onOpenEvent }: Props) {
  const [active, setActive] = useState<NodeId | null>(null);
  const nodes = buildNodes(samples);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = buildEdges(events, new Set(nodes.map((n) => n.id)));
  const pairCount = new Map<string, number>();
  const pairIndex = edges.map((e) => {
    const key = `${e.from}>${e.to}`;
    const k = pairCount.get(key) ?? 0;
    pairCount.set(key, k + 1);
    return k;
  });
  const touches = (e: GEdge, id: NodeId | null) =>
    !id || e.from === id || e.to === id;
  const handling = active ? edges.filter((e) => touches(e, active)) : [];
  const activeNode = active ? byId.get(active) : undefined;
  const linkedCount = edges.filter((e) => e.linked).length;

  return (
    <div className="tg-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="tg-svg"
        role="img"
        aria-label="Sample transfer graph"
      >
        <defs>
          {(["ok", "warn", "dash"] as const).map((k) => (
            <marker
              key={k}
              id={`tg-arrow-${k}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className={`tg-arrow tg-arrow-${k}`} />
            </marker>
          ))}
        </defs>
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const g = edgeGeometry(
            a,
            b,
            pairIndex[i],
            pairCount.get(`${e.from}>${e.to}`) ?? 1,
          );
          const kind = e.flagged ? "warn" : e.linked ? "ok" : "dash";
          const dim = active !== null && !touches(e, active);
          const showLabel = e.linked || (active !== null && !dim);
          const vol =
            e.event.volumeUl === null ? "" : ` · ${e.event.volumeUl} µL`;
          return (
            <g
              key={e.event.id}
              className={`tg-edge tg-${kind} ${dim ? "tg-dim" : ""}`}
              onClick={() => onOpenEvent(e.event)}
            >
              <path d={g.d} className="tg-hit" />
              <path
                d={g.d}
                className={`tg-line ${e.linked ? "" : "tg-dashed"}`}
                markerEnd={`url(#tg-arrow-${kind})`}
              />
              {showLabel && (
                <text
                  x={g.lx}
                  y={g.ly - 5}
                  textAnchor="middle"
                  className="tg-label"
                >
                  {formatTime(e.event.start)}
                  {vol}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const isActive = active === n.id;
          const toggle = () => setActive(isActive ? null : n.id);
          return (
            <g
              key={n.id}
              tabIndex={0}
              role="button"
              aria-pressed={isActive}
              aria-label={`${n.title}, ${n.sub}`}
              className={`tg-node tg-node-${n.kind} ${isActive ? "tg-node-active" : ""}`}
              transform={`translate(${n.x - NODE_W / 2},${n.y - NODE_H / 2})`}
              onClick={toggle}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  toggle();
                }
              }}
            >
              <rect width={NODE_W} height={NODE_H} rx={10} />
              <text x={NODE_W / 2} y={21} textAnchor="middle" className="tg-title">
                {n.title}
              </text>
              <text x={NODE_W / 2} y={37} textAnchor="middle" className="tg-sub">
                {n.sub.length > 22 ? `${n.sub.slice(0, 21)}…` : n.sub}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="tg-legend">
        <span>
          <i className="lg-line" /> Operator-linked ({linkedCount})
        </span>
        <span>
          <i className="lg-line lg-dash" /> Model-observed, awaiting identity (
          {edges.length - linkedCount})
        </span>
        <span>
          <i className="lg-line lg-amber" /> Needs review
        </span>
      </div>
      {activeNode && (
        <div className="tg-detail">
          <strong>{activeNode.title}</strong>
          <span className="fine-print">
            {" "}
            · {handling.length} handling event{handling.length === 1 ? "" : "s"}
          </span>
          {handling.length === 0 && (
            <p className="fine-print">No transfers recorded for this node yet.</p>
          )}
          {handling.map((e) => (
            <button
              key={e.event.id}
              className="tg-event"
              onClick={() => onOpenEvent(e.event)}
            >
              <span className="mono">{formatTime(e.event.start)}</span>
              <span>{e.event.action}</span>
              <span className="tag">
                {e.linked ? "operator-linked" : "awaiting identity"}
              </span>
              {e.flagged && <span className="tag tag-amber">needs review</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
