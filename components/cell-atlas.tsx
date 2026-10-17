"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabEvent, Sample } from "@/lib/types";
import {
  FLAG_CARRYOVER,
  FLAG_STEP,
  atlasBounds,
  deriveAtlas,
  representativeRows,
  type DerivedCell,
} from "@/lib/cell-atlas";

type ColorBy = "cluster" | "perturbation" | "status" | "flags" | "training";

const MODES: { id: ColorBy; label: string }[] = [
  { id: "cluster", label: "Cluster" },
  { id: "perturbation", label: "Perturbation" },
  { id: "status", label: "Provenance status" },
  { id: "flags", label: "Handling flags" },
  { id: "training", label: "Training eligible" },
];

interface Category {
  key: string;
  color: string;
}

const PALETTES: Record<ColorBy, Category[]> = {
  cluster: [
    { key: "Cycling G1", color: "#4f9e86" },
    { key: "Cycling S/G2M", color: "#9cc47f" },
    { key: "Edited (KO signature)", color: "#2f5f78" },
    { key: "Stress response", color: "#9aa5b1" },
  ],
  perturbation: [
    { key: "sgTARGET (simulated)", color: "#21775e" },
    { key: "non-targeting", color: "#8d9bb0" },
  ],
  status: [
    { key: "verified", color: "#21775e" },
    { key: "needs_review", color: "#d99a2b" },
    { key: "unlinked", color: "#b7c0b9" },
  ],
  flags: [
    { key: "no flags", color: "#b9cbc1" },
    { key: FLAG_CARRYOVER, color: "#d98a1f" },
    { key: FLAG_STEP, color: "#5f7fa6" },
    { key: "both flags", color: "#a8481a" },
  ],
  training: [
    { key: "eligible", color: "#21775e" },
    { key: "excluded", color: "#d6a24a" },
  ],
};

function categoryOf(c: DerivedCell, mode: ColorBy): string {
  switch (mode) {
    case "cluster":
      return c.cluster;
    case "perturbation":
      return c.perturbation;
    case "status":
      return c.provenance_status;
    case "training":
      return c.training_eligible ? "eligible" : "excluded";
    case "flags": {
      const carry = c.handling_flags.includes(FLAG_CARRYOVER);
      const step = c.handling_flags.includes(FLAG_STEP);
      return carry && step ? "both flags" : carry ? FLAG_CARRYOVER : step ? FLAG_STEP : "no flags";
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const MOVE_MS = 800;
const COLOR_MS = 400;
const POINT_R = 2.6;
const HOVER_PX = 10;
const FRESH_MS = 7000;
const PLOT_H = 420;
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const BOUNDS = atlasBounds();

interface Anim {
  cur: Float32Array;
  from: Float32Array;
  to: Float32Array;
  t0: number;
  dur: number;
  raf: number;
}

interface Hover {
  idx: number;
  x: number;
  y: number;
}

/** Packed [x,y,x,y...] and [r,g,b,...] targets for the current cells and color mode. */
function buildTargets(cells: DerivedCell[], mode: ColorBy) {
  const pos = new Float32Array(cells.length * 2);
  const col = new Float32Array(cells.length * 3);
  const rgb = new Map(PALETTES[mode].map((p) => [p.key, hexToRgb(p.color)]));
  cells.forEach((c, i) => {
    pos[i * 2] = c.tx;
    pos[i * 2 + 1] = c.ty;
    col.set(rgb.get(categoryOf(c, mode)) ?? [150, 160, 170], i * 3);
  });
  return { pos, col };
}

export function CellAtlas({
  events,
  samples,
  compact = false,
}: {
  events: LabEvent[];
  samples: Sample[];
  /** HUD mode: plot, legend and change log only. */
  compact?: boolean;
}) {
  const { cells, summary } = useMemo(() => deriveAtlas(events, samples), [events, samples]);
  const [mode, setMode] = useState<ColorBy>("cluster");
  const [hover, setHover] = useState<Hover | null>(null);
  const [width, setWidth] = useState(720);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posAnim = useRef<Anim | null>(null);
  const colAnim = useRef<Anim | null>(null);
  const hoverIdx = useRef(-1);
  const sizeRef = useRef({ w: 720, dpr: 1 });
  const seenText = useRef<Set<string> | null>(null);

  const targets = useMemo(() => buildTargets(cells, mode), [cells, mode]);
  const rows = useMemo(() => representativeRows(cells, 8), [cells]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pos = posAnim.current?.cur;
    const col = colAnim.current?.cur;
    if (!canvas || !pos || !col) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, PLOT_H);
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    const spanY = BOUNDS.maxY - BOUNDS.minY;
    const s = Math.min(w / spanX, PLOT_H / spanY);
    const ox = (w - spanX * s) / 2;
    const oy = (PLOT_H - spanY * s) / 2;
    const n = pos.length / 2;
    for (let i = 0; i < n; i++) {
      const px = ox + (pos[i * 2] - BOUNDS.minX) * s;
      const py = oy + (BOUNDS.maxY - pos[i * 2 + 1]) * s;
      ctx.fillStyle = `rgba(${col[i * 3] | 0},${col[i * 3 + 1] | 0},${col[i * 3 + 2] | 0},0.82)`;
      ctx.beginPath();
      ctx.arc(px, py, POINT_R, 0, Math.PI * 2);
      ctx.fill();
    }
    const h = hoverIdx.current;
    if (h >= 0 && h < n) {
      ctx.strokeStyle = "#253b34";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ox + (pos[h * 2] - BOUNDS.minX) * s, oy + (BOUNDS.maxY - pos[h * 2 + 1]) * s, POINT_R + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, []);

  // animate current -> target (positions and colors)
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const retarget = (ref: typeof posAnim, to: Float32Array, ms: number) => {
      const a = ref.current;
      if (!a || a.cur.length !== to.length) {
        ref.current = { cur: to.slice(), from: to.slice(), to, t0: 0, dur: 0, raf: 0 };
        return;
      }
      a.from = a.cur.slice();
      a.to = to;
      a.t0 = performance.now();
      a.dur = reduce ? 0 : ms;
    };
    const moved = posAnim.current?.cur.some((v, i) => Math.abs(v - targets.pos[i]) > 1e-4);
    retarget(posAnim, targets.pos, MOVE_MS);
    retarget(colAnim, targets.col, moved ? MOVE_MS : COLOR_MS);
    const pos = posAnim.current!;
    const col = colAnim.current!;
    let raf = 0;
    const step = (now: number) => {
      let active = false;
      for (const a of [pos, col]) {
        const p = a.dur === 0 ? 1 : Math.min(1, (now - a.t0) / a.dur);
        const e = ease(p);
        for (let i = 0; i < a.cur.length; i++) a.cur[i] = a.from[i] + (a.to[i] - a.from[i]) * e;
        if (p < 1) active = true;
      }
      draw();
      if (active) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targets, draw]);

  // responsive, dpr-aware canvas
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = Math.max(280, Math.floor(el.clientWidth));
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w, dpr };
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(PLOT_H * dpr);
      }
      setWidth(w);
      draw();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // "what changed": highlight explanations that were not present before
  useEffect(() => {
    const texts = new Set(summary.explanations.map((e) => e.text));
    const prev = seenText.current;
    seenText.current = texts;
    if (!prev) return;
    const added = new Set([...texts].filter((t) => !prev.has(t)));
    if (added.size === 0) return;
    setFresh(added);
    const t = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(t);
  }, [summary.explanations]);

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = posAnim.current?.cur;
    if (!pos) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = sizeRef.current.w;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    const spanY = BOUNDS.maxY - BOUNDS.minY;
    const s = Math.min(w / spanX, PLOT_H / spanY);
    const ox = (w - spanX * s) / 2;
    const oy = (PLOT_H - spanY * s) / 2;
    let best = -1;
    let bestD = HOVER_PX * HOVER_PX;
    for (let i = 0; i < pos.length / 2; i++) {
      const dx = ox + (pos[i * 2] - BOUNDS.minX) * s - mx;
      const dy = oy + (BOUNDS.maxY - pos[i * 2 + 1]) * s - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    hoverIdx.current = best;
    setHover(best >= 0 ? { idx: best, x: mx, y: my } : null);
    draw();
  };
  const onLeave = () => {
    hoverIdx.current = -1;
    setHover(null);
    draw();
  };

  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cells) counts.set(categoryOf(c, mode), (counts.get(categoryOf(c, mode)) ?? 0) + 1);
    return PALETTES[mode].map((p) => ({ ...p, count: counts.get(p.key) ?? 0 }));
  }, [cells, mode]);

  const hc = hover ? cells[hover.idx] : null;
  const { byStatus } = summary;

  return (
    <section className={`ca${compact ? " ca-compact" : ""}`} aria-label="Cell atlas preview (simulated)">
      <header className="ca-banner" role="note">
        <span className="ca-banner-tag">SIMULATED</span>
        <p>
          <strong>Simulated preview &middot; synthetic cells &middot; no sequencing data exists for this recording.</strong>{" "}
          Illustrates how LabLens execution metadata would join AnnData.obs.
        </p>
      </header>

      <div className="ca-head">
        <div>
          <h3 className="ca-title">Cell atlas preview</h3>
          <p className="ca-sub">
            {summary.total.toLocaleString("en-US")} synthetic HEK293T cells &middot; DISH-01 (sgTARGET, simulated) + DISH-CTRL (non-targeting)
          </p>
        </div>
        <div className="ca-seg" role="radiogroup" aria-label="Color by">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={mode === m.id ? "on" : ""}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ca-stats">
        <span><b>{byStatus.verified}</b> verified</span>
        <span className="warn"><b>{byStatus.needs_review}</b> needs review</span>
        <span><b>{byStatus.unlinked}</b> unlinked</span>
        <span className="warn"><b>{summary.flagged}</b> flagged</span>
        <span className="good"><b>{summary.trainingEligible}</b> training-eligible</span>
      </div>

      <div className="ca-main">
        <div className="ca-plot" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: PLOT_H }}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
            role="img"
            aria-label="Simulated UMAP of synthetic cells"
          />
          <span className="ca-axis ca-axis-x">UMAP 1 (simulated)</span>
          <span className="ca-axis ca-axis-y">UMAP 2 (simulated)</span>
          <span className="ca-watermark">SIMULATED</span>
          {hc && hover && (
            <div
              className="ca-tip"
              style={{ left: Math.min(hover.x + 14, width - 250), top: Math.max(hover.y - 8, 4) }}
            >
              <div className="ca-tip-id">{hc.cell_id}</div>
              <dl>
                <dt>sample_id</dt><dd>{hc.sample_id}</dd>
                <dt>cluster</dt><dd>{hc.cluster}</dd>
                <dt>perturbation</dt><dd>{hc.perturbation}</dd>
                <dt>provenance</dt><dd>{hc.provenance_status}{hc.provenance_note && ` (${hc.provenance_note})`}</dd>
                <dt>handling_flags</dt><dd>{hc.handling_flags.join(", ") || "—"}</dd>
                <dt>training_eligible</dt><dd>{String(hc.training_eligible)}</dd>
                <dt>evidence_refs</dt><dd>{hc.evidence_refs.join(", ") || "—"}</dd>
              </dl>
            </div>
          )}
        </div>

        <aside className="ca-side">
          <ul className="ca-legend" aria-label="Legend">
            {legend.map((l) => (
              <li key={l.key}>
                <i style={{ background: l.color }} />
                <span>{l.key}</span>
                <b>{l.count}</b>
              </li>
            ))}
          </ul>
          <div className="ca-changes" aria-live="polite">
            <h4>What changed</h4>
            <ul>
              {summary.explanations.map((x) => (
                <li key={x.text} className={`${x.tone}${fresh.has(x.text) ? " fresh" : ""}`}>
                  {fresh.has(x.text) && <em>new</em>}
                  <p>{x.text}</p>
                  <small>{x.meaning}</small>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {!compact && (
      <div className="ca-obs">
        <h4>AnnData.obs preview <span>(synthetic rows)</span></h4>
        <div className="ca-table-wrap">
          <table>
            <thead>
              <tr>
                <th>cell_id</th><th>sample_id</th><th>perturbation</th><th>cluster</th>
                <th>provenance_status</th><th>handling_flags</th><th>training_eligible</th><th>evidence_refs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cell_id}>
                  <td className="mono">{r.cell_id}</td>
                  <td>{r.sample_id}</td>
                  <td>{r.perturbation}</td>
                  <td>{r.cluster}</td>
                  <td key={r.provenance_status} className={`ca-flash st-${r.provenance_status}`}>{r.provenance_status}</td>
                  <td key={r.handling_flags.join()} className="ca-flash">{r.handling_flags.join(", ") || "—"}</td>
                  <td key={String(r.training_eligible)} className="ca-flash">{String(r.training_eligible)}</td>
                  <td key={r.evidence_refs.join()} className="ca-flash mono">{r.evidence_refs.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre className="ca-code" aria-label="AnnData join snippet">
{`# lablens_meta: LabLens export keyed by sample_id (simulated preview)
adata.obs = adata.obs.join(lablens_meta, on="sample_id")
adata = adata[adata.obs["training_eligible"]]   # ${summary.trainingEligible} of ${summary.total} synthetic cells kept`}
        </pre>
        <p className="ca-note">
          Real joins are per sample; per-cell tags here are an illustration of heterogeneous exposure, not a measurement.
        </p>
      </div>
      )}
    </section>
  );
}
