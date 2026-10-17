"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Play, RotateCcw, Square, X } from "lucide-react";
import type { LabEvent } from "@/lib/types";
import { protocolSteps, sampleRegistry } from "@/lib/reference";
import { applySupervisor } from "@/lib/supervisor";
import { VoiceAssistant } from "@/components/voice-assistant";
import { downloadNotebook } from "@/lib/export";

interface Clip {
  id: string;
  title: string;
  duration: number;
  videoUrl: string;
  viewpoint: string;
  protocol?: string;
  unseen: boolean;
}
type Mode = "idle" | "live" | "replay";

/** Footage is analysed in short windows as soon as they have played, never ahead of the playhead. */
const WINDOW_S = 4;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function contextOf(events: LabEvent[]) {
  const model = events.filter((e) => e.origin === "model");
  const step = [...model].reverse().find((e) => e.protocolStep)?.protocolStep;
  const additions = model.filter((e) => e.actionLabel === "dispense" && (e.protocolStep ?? 0) <= 3).length;
  const recent = model
    .slice(-6)
    .map((e) => `${fmt(e.start)} ${e.action} (step ${e.protocolStep ?? "?"}, tip: ${e.tipState ?? "unclear"})`)
    .join("; ");
  return `Protocol step reached so far: ${step ?? "none yet"}. Dispenses into the EP tube so far: ${additions}. Recent: ${recent}`;
}

export default function LivePage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipId, setClipId] = useState("DJI_09");
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [inFlight, setInFlight] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [hasReplay, setHasReplay] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const run = useRef({ token: 0, id: "", nextStart: 0, tipState: "unknown at start" });
  const eventsRef = useRef<LabEvent[]>([]);
  eventsRef.current = events;
  const clip = clips.find((c) => c.id === clipId);
  const crispr = clipId.startsWith("DJI");

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then(setClips)
      .catch(() => setError("Could not load the recording library."));
  }, []);

  useEffect(() => {
    run.current.token++;
    setEvents([]);
    setInFlight([]);
    setMode("idle");
    setError("");
    fetch(`/api/analyze/window?clipId=${clipId}`)
      .then((r) => setHasReplay(r.ok))
      .catch(() => setHasReplay(false));
  }, [clipId]);

  const all = useMemo(() => applySupervisor(events), [events]);
  const visible = useMemo(() => all.filter((e) => e.start <= current + 0.25), [all, current]);

  async function analyseWindow(start: number, end: number) {
    const token = run.current.token;
    setInFlight((f) => [...f, start]);
    try {
      let data: { events?: LabEvent[]; tipStateAtEnd?: string; error?: string } = {};
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch("/api/analyze/window", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clipId,
            runId: run.current.id,
            start,
            end,
            context: contextOf(eventsRef.current),
            tipStateIn: run.current.tipState,
          }),
        });
        data = await response.json().catch(() => ({}));
        if (response.ok) break;
        if (attempt === 2) throw new Error(data.error ?? "Window analysis failed");
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
      if (token !== run.current.token) return;
      run.current.tipState = `${data.tipStateAtEnd} (as of ${fmt(end)})`;
      setEvents((old) => [...old, ...(data.events ?? [])].sort((a, b) => a.start - b.start));
    } catch (e) {
      if (token === run.current.token) setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      if (token === run.current.token) setInFlight((f) => f.filter((s) => s !== start));
    }
  }

  // Dispatch each window the moment the playhead has finished playing it.
  useEffect(() => {
    if (mode !== "live" || !clip) return;
    const r = run.current;
    while (current >= r.nextStart + WINDOW_S && r.nextStart < clip.duration) {
      const start = r.nextStart;
      r.nextStart += WINDOW_S;
      void analyseWindow(start, Math.min(start + WINDOW_S, clip.duration));
    }
  }, [current, mode, clip]);

  function onEnded() {
    const r = run.current;
    if (mode === "live" && clip && r.nextStart < clip.duration - 0.3) {
      const start = r.nextStart;
      r.nextStart = clip.duration;
      void analyseWindow(start, clip.duration);
    }
  }

  function onSeeked(t: number) {
    setCurrent(t);
    // Seeking moves the live analysis cursor; footage that is skipped is not analysed.
    if (mode === "live") run.current.nextStart = Math.floor(t / WINDOW_S) * WINDOW_S;
  }

  function startLive() {
    if (!clip || !video.current) return;
    run.current = { token: run.current.token + 1, id: `run-${Date.now().toString(36)}`, nextStart: 0, tipState: "unknown at start" };
    setEvents([]);
    setInFlight([]);
    setError("");
    setMode("live");
    video.current.currentTime = 0;
    video.current.play().catch(() => undefined);
  }

  function stop() {
    run.current.token++;
    video.current?.pause();
    setInFlight([]);
    setMode("idle");
    setHasReplay(true);
  }

  async function replay() {
    const token = ++run.current.token;
    const response = await fetch(`/api/analyze/window?clipId=${clipId}`);
    if (!response.ok || token !== run.current.token) return;
    const data = (await response.json()) as { windows: { events: LabEvent[] }[] };
    setEvents([...new Map(data.windows.flatMap((w) => w.events).map((e) => [e.id, e])).values()].sort((a, b) => a.start - b.start));
    setMode("replay");
    if (video.current) {
      video.current.currentTime = 0;
      video.current.play().catch(() => undefined);
    }
  }

  function randomClip() {
    const pool = clips.filter((c) => c.id !== clipId);
    if (!pool.length) return;
    setClipId(pool[Math.floor(Math.random() * pool.length)].id);
    setAutoStart(true);
  }
  // Start once the randomly chosen clip's video element has mounted.
  useEffect(() => {
    if (!autoStart || !clip) return;
    const t = setTimeout(() => {
      setAutoStart(false);
      startLive();
    }, 500);
    return () => clearTimeout(t);
  }, [autoStart, clip]);

  function update(id: string, patch: Partial<LabEvent>) {
    setEvents((old) => {
      const derived = applySupervisor(old).find((e) => e.id === id);
      return old.map((e) => (e.id === id ? { ...(derived ?? e), ...patch } : e));
    });
  }
  const setFlag = (event: LabEvent, index: number, status: "confirmed" | "dismissed") =>
    update(event.id, { flags: event.flags.map((f, i) => (i === index ? { ...f, status } : f)), verification: "corrected" });

  // Live annotations land a few seconds after the action; show the latest recent one.
  const now = [...visible].reverse().find((e) => e.origin === "model" && current - e.end < 10);
  const latestStep = [...visible].reverse().find((e) => e.protocolStep)?.protocolStep ?? null;
  const alert = [...visible]
    .reverse()
    .flatMap((e) => e.flags.filter((f) => f.status === "needs_review" && f.type !== "unknown_sample").map((f, i) => ({ e, f, i: e.flags.indexOf(f) })))
    .find(({ e }) => current - e.end < 12);
  const stepFacts = useMemo(() => {
    const stepStart = latestStep ? (visible.find((e) => e.protocolStep === latestStep)?.start ?? 0) : 0;
    const inStep = visible.filter((e) => e.start >= stepStart);
    const last = <T,>(pick: (e: LabEvent) => T | null | undefined) =>
      [...inStep].reverse().map(pick).find((v) => v !== null && v !== undefined) ?? null;
    const source = last((e) => e.sourceSampleId);
    const destination = last((e) => e.destinationSampleId);
    const volume = last((e) => e.volumeUl);
    const concentration = last((e) => e.concentration);
    const pipette = last((e) => (e.origin === "model" ? e.visualQuantity : null));
    const tip = last((e) => (e.origin === "model" && e.tipState && e.tipState !== "unclear" ? e.tipState : null));
    const transfer = !clipId.startsWith("DJI") || !latestStep || [1, 2, 3, 6].includes(latestStep);
    const rows: { label: string; value: string | null; missing: string }[] = transfer
      ? [
          { label: "Sample", value: source || destination ? `${source ?? "?"} → ${destination ?? "?"}` : null, missing: "Unidentified · say which tube" },
          { label: "Volume", value: volume ? `${volume} µL${pipette ? ` · ${pipette}` : ""}` : null, missing: pipette ? `Not stated · ${pipette}` : "Not stated" },
          { label: "Concentration", value: concentration, missing: "Not recorded" },
          { label: "Tip", value: tip ? tip.replaceAll("_", " ") : null, missing: "Not seen" },
        ]
      : [];
    return { rows };
  }, [visible, latestStep, clipId]);
  const samplesSeen = sampleRegistry.map((s) => ({
    ...s,
    links: visible.filter((e) => e.sourceSampleId === s.id || e.destinationSampleId === s.id),
  }));
  const status =
    mode === "live"
      ? inFlight.length
        ? `Analysing ${inFlight.map((s) => `${fmt(s)}–${fmt(s + WINDOW_S)}`).join(", ")}`
        : "Watching"
      : mode === "replay"
        ? "Replay · no new inference"
        : "Standby";

  return (
    <div className="hud">
      {clip && (
        <video
          ref={video}
          key={clip.videoUrl}
          className="hud-video"
          src={clip.videoUrl}
          muted
          playsInline
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onSeeked={(e) => onSeeked(e.currentTarget.currentTime)}
          onEnded={onEnded}
          onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => undefined) : e.currentTarget.pause())}
        />
      )}
      <div className="hud-vignette" aria-hidden />
      <div className="hud-corners" aria-hidden>
        <i /> <i /> <i /> <i />
      </div>

      <header className="hud-top">
        <div className="hud-id">
          <span className={`hud-rec ${mode}`} />
          <b>LabLens</b>
          <span>{status}</span>
          <span className="hud-time">
            {fmt(current)} / {clip ? fmt(clip.duration) : "--"}
          </span>
        </div>
        <div className="hud-controls">
          <select value={clipId} onChange={(e) => setClipId(e.target.value)} aria-label="Recording">
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.viewpoint}
                {c.unseen ? " · unseen" : ""}
              </option>
            ))}
          </select>
          <button onClick={randomClip} title="Load a random recording and start">
            <Dices size={14} /> Random clip
          </button>
          {mode === "live" ? (
            <button onClick={stop}>
              <Square size={13} /> Stop
            </button>
          ) : (
            <button className="hud-go" onClick={startLive} disabled={!clip}>
              <Play size={14} /> Start live session
            </button>
          )}
          {hasReplay && mode !== "live" && (
            <button onClick={() => void replay()}>
              <RotateCcw size={13} /> Replay
            </button>
          )}
          <button onClick={() => downloadNotebook(all, sampleRegistry, protocolSteps, "md")} disabled={!events.length}>
            Export
          </button>
          <Link href="/" className="hud-exit" aria-label="Exit to workspace">
            <X size={15} />
          </Link>
        </div>
      </header>

      {/* Protocol guidance + what is needed for this step, in the field of view. Gaps are highlighted. */}
      <div className="hud-protocol">
        {crispr && (
        <div className="hud-protocol-steps">
          {protocolSteps.map((st) => {
            const deviation = all.some(
              (e) => e.protocolStep === st.id && e.flags.some((f) => f.type !== "unknown_sample" && f.status !== "dismissed"),
            );
            const cls = st.id === latestStep ? "now" : latestStep && st.id < latestStep ? "past" : "";
            return (
              <span key={st.id} className={`${cls} ${deviation ? "deviation" : ""}`} title={st.description}>
                {deviation ? "!" : st.id}
              </span>
            );
          })}
        </div>
        )}
        <strong>
          {!crispr
            ? clip?.protocol ?? "Bench procedure"
            : latestStep
              ? `Step ${latestStep} · ${protocolSteps[latestStep - 1].title}`
              : "Step 1 · Add reagent 1"}
        </strong>
        {now && <span className="hud-now">Now: {now.action}</span>}
        {stepFacts.rows.length > 0 && (
          <dl className="hud-facts-grid">
            {stepFacts.rows.map((r) => (
              <div key={r.label} className={r.value ? (r.value.startsWith("same tip") ? "warn" : "ok") : "missing"}>
                <dt>{r.label}</dt>
                <dd>{r.value ?? r.missing}</dd>
              </div>
            ))}
          </dl>
        )}
        {crispr && latestStep && latestStep < 7 && <small>Next: {protocolSteps[latestStep].description}</small>}
      </div>

      {/* Annotations float in view and fade; the full record is in the workspace notebook. */}
      <div className="hud-annotations" aria-live="polite">
        {visible
          .filter((e) => current - e.start < 9)
          .slice(-3)
          .map((e) => (
            <div key={e.id} className={`hud-tag ${e.origin}`}>
              <time>{fmt(e.start)}</time>
              <b>{e.origin === "model" ? e.action : e.description}</b>
              {e.visualQuantity && <em>{e.visualQuantity}</em>}
              {(e.sourceSampleId || e.volumeUl) && (
                <em>
                  {e.sourceSampleId ?? "?"} → {e.destinationSampleId ?? "?"}
                  {e.volumeUl ? ` · ${e.volumeUl} µL` : ""}
                </em>
              )}
            </div>
          ))}
      </div>

      {alert && (
        <div className="hud-alert" role="alert" key={`${alert.e.id}-${alert.f.type}`}>
          <b>{alert.f.type === "tip_reuse" ? "Possible tip reuse" : "Protocol check"}</b>
          <span>{alert.f.message}</span>
          <div>
            <button onClick={() => setFlag(alert.e, alert.i, "dismissed")}>It&apos;s fine</button>
            <button onClick={() => setFlag(alert.e, alert.i, "confirmed")}>Log deviation</button>
          </div>
        </div>
      )}
      {error && <div className="hud-error">{error}</div>}


      <VoiceAssistant
        key={clipId}
        variant="hud"
        autoConnect={mode === "live"}
        procedure={clip?.protocol}
        clipId={clipId}
        events={visible}
        currentTime={current}
        samples={sampleRegistry}
        protocol={protocolSteps}
        onUpdateEvent={update}
        onAddEvent={(e) => setEvents((old) => [...old, e].sort((a, b) => a.start - b.start))}
        onSeek={(s) => video.current && (video.current.currentTime = s)}
        onGenerateReport={(format) => downloadNotebook(all, sampleRegistry, protocolSteps, format)}
      />
      <div className="hud-track">
        {clip &&
          all.map((e) => (
            <i
              key={e.id}
              className={`${e.origin} ${e.flags.some((f) => f.status === "needs_review" && f.type !== "unknown_sample") ? "flagged" : ""}`}
              style={{ left: `${(e.start / clip.duration) * 100}%`, width: `${Math.max(0.5, ((e.end - e.start) / clip.duration) * 100)}%` }}
            />
          ))}
        {clip && <b style={{ left: `${(current / clip.duration) * 100}%` }} />}
      </div>
    </div>
  );
}
