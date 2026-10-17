"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Database,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  Leaf,
  MoreHorizontal,
  Plus,
  ScanEye,
  Search,
  ShieldCheck,
  Sparkles,
  Video,
  X,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CellAtlas } from "@/components/cell-atlas";
import { VoiceAssistant } from "@/components/voice-assistant";
import {
  downloadNotebook,
  downloadRobotics,
  downloadBiological,
  biologicalData,
  type CorrectionAudit,
} from "@/lib/export";
import type { LabEvent, Sample, ClipId } from "@/lib/types";
import { clips, protocolSteps } from "@/lib/reference";
import { DetectionOverlay } from "@/components/detection-overlay";
import { EventTimeline } from "@/components/event-timeline";
import { TransferGraph } from "@/components/transfer-graph";
import { ReferenceEval } from "@/components/reference-eval";
import { UnseenEval } from "@/components/unseen-eval";
const tabs = [
  "Overview",
  "Protocol",
  "Sample lineage",
  "Safety",
  "Training",
  "AI dataset",
  "Export",
];
const samples: Sample[] = [
  {
    id: "CELL-A",
    name: "Cell suspension A",
    kind: "cell suspension",
    synthetic: true,
  },
  {
    id: "REAGENT-01",
    name: "Transfection reagent",
    kind: "reagent",
    synthetic: true,
  },
  {
    id: "PLASMID-01",
    name: "Plasmid preparation",
    kind: "plasmid",
    synthetic: true,
  },
  {
    id: "DISH-01",
    name: "Culture dish",
    kind: "culture vessel",
    synthetic: true,
  },
];
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
export default function Home() {
  const [tab, setTab] = useState("Overview"),
    [clipId, setClipId] = useState<ClipId>("DJI_09"),
    [events, setEvents] = useState<LabEvent[]>([]),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [config, setConfig] = useState<Record<string, unknown>>({}),
    [selected, setSelected] = useState<string | null>(null),
    [current, setCurrent] = useState(0),
    [audit, setAudit] = useState<string[]>([]),
    [showAdd, setShowAdd] = useState(false),
    [note, setNote] = useState(""),
    [corrections, setCorrections] = useState<CorrectionAudit[]>([]),
    [modelInfo, setModelInfo] = useState(""),
    [showAll, setShowAll] = useState(false),
    [loadedClip, setLoadedClip] = useState<string>("");
  const video = useRef<HTMLVideoElement>(null);
  const hydratedClip = useRef<string>("");
  const requestGeneration = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const clip = clips.find((c) => c.id === clipId) || clips[0];
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const generation = ++requestGeneration.current;
    hydratedClip.current = "";
    setReady(false);
    setSelected(null);
    setShowAdd(false);
    setNote("");
    pendingSeek.current = null;
    setLoading(false);
    setMessage("");
    setCurrent(0);
    setModelInfo("");
    let stored: LabEvent[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(`lablens:${clipId}`) || "[]");
      setEvents(stored);
      setAudit(
        JSON.parse(localStorage.getItem(`lablens:audit:${clipId}`) || "[]"),
      );
      setCorrections(
        JSON.parse(
          localStorage.getItem(`lablens:corrections:${clipId}`) || "[]",
        ),
      );
    } catch {
      setEvents([]);
      setAudit([]);
      setCorrections([]);
    }
    hydratedClip.current = clipId;
    setLoadedClip(clipId);
    setReady(true);
    fetch(`/api/analysis?clipId=${clipId}`)
      .then((r) => r.json())
      .then((data) => {
        const result = data.result || data.analysis || data;
        if (
          result.events &&
          hydratedClip.current === clipId &&
          generation === requestGeneration.current
        ) {
          setModelInfo(
            `${result.model} | ${result.analysisMethod || "Saved visual analysis"}`,
          );
          if (!stored.length)
            setEvents((old) => {
              const ids = new Set(old.map((e) => e.id));
              return [
                ...old,
                ...result.events.filter((e: LabEvent) => !ids.has(e.id)),
              ].sort((a, b) => a.start - b.start);
            });
        }
      })
      .catch(() => {});
  }, [clipId]);
  useEffect(() => {
    if (ready && loadedClip === clipId && hydratedClip.current === clipId) {
      localStorage.setItem(`lablens:${clipId}`, JSON.stringify(events));
      localStorage.setItem(`lablens:audit:${clipId}`, JSON.stringify(audit));
      localStorage.setItem(
        `lablens:corrections:${clipId}`,
        JSON.stringify(corrections),
      );
    }
  }, [events, audit, corrections, ready, clipId, loadedClip]);
  function log(text: string) {
    setAudit((a) => [`${new Date().toISOString()} · ${text}`, ...a]);
  }
  function update(id: string, patch: Partial<LabEvent>) {
    const before = events.find((e) => e.id === id);
    if (before && patch.protocolStep) {
      const linkedStep = patch.protocolStep;
      const missing = protocolSteps.filter(
        (s) =>
          s.id < linkedStep &&
          s.id !== 5 &&
          !events.some(
            (e) =>
              e.id !== id && e.protocolStep === s.id && e.start <= before.start,
          ),
      );
      patch = {
        ...patch,
        flags: [
          ...before.flags.filter((f) => f.type !== "missing_step"),
          ...missing.map((s) => ({
            type: "missing_step" as const,
            status: "needs_review" as const,
            message: `Notebook coverage review: Step ${s.id} has no linked observation before step ${linkedStep}; may be outside recording. Please review.`,
          })),
        ],
      };
    }
    if (before)
      setCorrections((a) => [
        ...a,
        {
          eventId: id,
          timestamp: new Date().toISOString(),
          before: Object.fromEntries(
            Object.keys(patch).map((k) => [k, before[k as keyof LabEvent]]),
          ),
          after: patch,
        },
      ]);
    setEvents((e) => e.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    log(`Operator updated ${id}: ${Object.keys(patch).join(", ")}`);
  }
  function seek(n: number) {
    pendingSeek.current = n;
    if (video.current) {
      video.current.currentTime = n;
      setCurrent(n);
    }
  }
  async function analyze() {
    const requestedClip = clipId;
    const generation = requestGeneration.current;
    setLoading(true);
    setMessage("Sampling video frames and reviewing visible actions…");
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId }),
      });
      const data = await r.json();
      if (
        hydratedClip.current !== requestedClip ||
        generation !== requestGeneration.current
      )
        return;
      if (!r.ok)
        throw new Error(
          data.error ||
            data.message ||
            "Analysis unavailable. Configure OPENAI_API_KEY on the server.",
        );
      const result = data.result || data;
      setModelInfo(
        `${result.model} | ${result.analysisMethod || "Visual analysis"}`,
      );
      setEvents((old) => [
        ...old.filter((e) => e.origin === "operator"),
        ...(result.events || []).map(
          (e: LabEvent) =>
            old.find((o) => o.id === e.id && o.verification !== "pending") || e,
        ),
      ]);
      log(`Visual analysis completed with ${result.model || "vision model"}`);
      setMessage(
        `Analysis complete. ${(result.events || []).length} observations ready for review.`,
      );
    } catch (e) {
      if (
        hydratedClip.current === requestedClip &&
        generation === requestGeneration.current
      )
        setMessage(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      if (
        hydratedClip.current === requestedClip &&
        generation === requestGeneration.current
      )
        setLoading(false);
    }
  }
  function add() {
    if (!note.trim()) return;
    const e: LabEvent = {
      id: crypto.randomUUID(),
      clipId,
      start: current,
      end: current + 1,
      action: "Operator observation",
      description: note,
      objects: [],
      sourceSampleId: null,
      destinationSampleId: null,
      volumeUl: null,
      protocolStep: null,
      verification: "confirmed",
      origin: "operator",
      flags: [],
      evidenceFrames: [current],
    };
    setEvents((v) => [...v, e].sort((a, b) => a.start - b.start));
    log(`Operator added observation at ${time(current)}`);
    setNote("");
    setShowAdd(false);
  }
  const activeEvent = events.find(
    (e) => e.start <= current && e.end >= current,
  );
  const confirmed = events.filter((e) => e.verification !== "pending").length;
  const flags = events.flatMap((e) =>
    e.flags.map((f, i) => ({ event: e, flag: f, index: i })),
  );
  const selectedEvent = events.find((e) => e.id === selected);
  const transfers = events.filter(
    (e) =>
      (e.sourceSampleId && e.destinationSampleId) ||
      (e.actionLabel && ["dispense", "aspirate", "transfer"].includes(e.actionLabel)),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <ScanEye size={23} />
          </span>
          LabLens<span className="brand-period">.</span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <button className="side-link active" onClick={() => setTab("Overview")}>
          <FlaskConical size={18} />
          Experiments<span className="count">1</span>
        </button>
        <button className="side-link" onClick={() => setTab("Sample lineage")}>
          <GitBranch size={18} />
          Sample registry
        </button>
        <button className="side-link" onClick={() => setTab("Protocol")}>
          <BookOpen size={18} />
          Protocols
        </button>
        <button className="side-link" onClick={() => setTab("AI dataset")}>
          <Database size={18} />
          Datasets
        </button>
        <div className="side-divider" />
        <div className="nav-label">RECENT EXPERIMENT</div>
        <button className="experiment-link" onClick={() => setTab("Overview")}>
          <span className="tiny-dot" />
          Cell transfection
        </button>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <Leaf size={20} />
            <strong>
              Made for the moments
              <br />
              between discoveries.
            </strong>
            <p>Your experiment, thoughtfully recorded.</p>
          </div>
          <div className="profile">
            <span className="avatar">DR</span>
            <div>
              <strong>Researcher</strong>
              <small>LabLens workspace</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            Experiments
            <ChevronRight size={13} />
            <span>Cell transfection</span>
          </div>
          <Link className="live-link" href="/live">
            <Radio size={14} />
            Live session
          </Link>
          <span className="saved">
            <span className="tiny-dot" />
            Saved on this device
          </span>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <FlaskConical size={14} /> EXPERIMENT 001
              </div>
              <h1>A clearer record of discovery.</h1>
              <p>
                Cell transfection <span className="middot">·</span> A living
                notebook, connected to every moment.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setTab("Export");
              }}
            >
              <ArrowDownToLine size={15} />
              Export notebook
            </Button>
          </div>
          <div className="experiment-meta">
            <span className="status-pill">
              <span className="tiny-dot" />
              In review
            </span>
            <span>
              <Clock3 size={14} />
              Recorded lab footage
            </span>
            <span>
              <ShieldCheck size={14} />
              {confirmed} verified observations
            </span>
            <span className="synthetic-label">Demo sample registry</span>
          </div>
          <nav className="tabs" aria-label="Experiment sections">
            {tabs.map((t) => (
              <button
                key={t}
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {tab === "Overview" ? (
            <>
              <div className="overview-grid">
                <section className="panel video-panel">
                  <div className="panel-heading">
                    <div>
                      <Video size={17} />
                      <h2>Experiment recording</h2>
                    </div>
                    <select
                      aria-label="Recording"
                      disabled={loading}
                      value={clipId}
                      onChange={(e) => setClipId(e.target.value as ClipId)}
                    >
                      {clips.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="video-wrap">
                    <video
                      key={clip.videoUrl}
                      ref={video}
                      src={clip.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={() => {
                        if (video.current && pendingSeek.current !== null) {
                          video.current.currentTime = pendingSeek.current;
                          pendingSeek.current = null;
                        }
                      }}
                      onTimeUpdate={(e) =>
                        setCurrent(e.currentTarget.currentTime)
                      }
                    />
                    <DetectionOverlay event={activeEvent} />
                    <span className="footage-label">
                      <span className="record-dot" />
                      THIRD-PERSON REFERENCE FOOTAGE
                    </span>
                  </div>
                  <div className="recording-footer">
                    <div>
                      <span className="camera-icon">
                        <ScanEye size={18} />
                      </span>
                      <div>
                        <strong>{clipId}.mp4</strong>
                        <small>
                          Public laboratory video · glasses-feed stand-in
                        </small>
                      </div>
                    </div>
                    <span className="mono">{time(current)}</span>
                  </div>
                  <EventTimeline
                    events={events}
                    duration={clip.duration}
                    current={current}
                    selectedId={selected}
                    onSeek={(e) => {
                      seek(e.start);
                      setSelected(e.id);
                    }}
                    onScrub={seek}
                  />
                </section>
                <section className="panel notebook">
                  <div className="panel-heading">
                    <div>
                      <BookOpen size={17} />
                      <h2>Live notebook</h2>
                      <span className="small-count">{events.length}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Add observation"
                      onClick={() => setShowAdd(true)}
                    >
                      <Plus size={17} />
                    </Button>
                  </div>
                  <div className="notebook-scroll">
                    {events.length === 0 ? (
                      <div className="empty-notebook">
                        <span className="empty-icon">
                          <Sparkles size={25} />
                        </span>
                        <h3>Every detail has a story.</h3>
                        <p>
                          Turn visible lab actions into a notebook you can
                          review, correct, and trace.
                        </p>
                        <Button onClick={analyze} disabled={loading}>
                          <ScanEye size={16} />
                          {loading
                            ? "Analyzing footage…"
                            : "Run visual analysis"}
                        </Button>
                        <span className="empty-caption">
                          Loads saved analysis or runs the configured vision
                          model
                        </span>
                        <button
                          className="text-link"
                          onClick={() => setShowAdd(true)}
                        >
                          or add an operator observation{" "}
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    ) : (
                      events.map((e) => (
                        <button
                          className={`event-card ${selected === e.id ? "event-selected" : ""}`}
                          key={e.id}
                          onClick={() => {
                            setSelected(e.id);
                            seek(e.start);
                          }}
                        >
                          <span className="event-time">
                            {time(e.start)}
                            <span
                              className={
                                e.verification === "pending"
                                  ? "pending-dot"
                                  : "verified-dot"
                              }
                            />
                          </span>
                          <div>
                            <div className="event-title">
                              {e.action}
                            </div>
                            <p>{e.description}</p>
                            {e.visualQuantity && (
                              <p className="visible-quantity">
                                <strong>Visible in frame:</strong>{" "}
                                {e.visualQuantity}
                              </p>
                            )}
                            {e.volumeUl != null && (
                              <p className="visible-quantity">
                                <strong>Operator-confirmed volume:</strong>{" "}
                                {e.volumeUl} µL
                              </p>
                            )}
                            <div className="event-tags">
                              <span>
                                {e.origin === "operator"
                                  ? "Operator note"
                                  : "Model observation · pending review"}
                              </span>
                              <span>{e.verification}</span>
                              {!e.sourceSampleId && !e.destinationSampleId && (
                                <span className="unknown-tag">
                                  Sample unknown
                                </span>
                              )}
                              {e.flags.map((f, i) => (
                                <span className="flag-tag" key={i}>
                                  {f.type.replaceAll("_", " ")} /{" "}
                                  {f.status.replaceAll("_", " ")}
                                </span>
                              ))}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                    {events.length > 0 &&
                      !showAll &&
                      !events.some((e) => e.start <= current) && (
                        <div className="playback-empty">
                          <Clock3 size={22} />
                          <h3>Your notebook follows the recording.</h3>
                          <p>
                            Press play to reveal observations as they happen, or
                            show all observations below.
                          </p>
                        </div>
                      )}
                  </div>
                  <div className="notebook-footer">
                    <button
                      className="text-link"
                      onClick={() => setShowAll(!showAll)}
                    >
                      {showAll ? "Follow playback" : "Show all observations"}
                    </button>
                    <span className="tiny-dot" />
                    Evidence first. Researcher verified.
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAdd(true)}
                    >
                      <Plus size={14} />
                      Add note
                    </Button>
                  </div>
                </section>
              </div>
              <div className="insight-strip">
                <div className="insight-symbol">
                  <GitBranch size={21} />
                </div>
                <div>
                  <strong>From observation to understanding.</strong>
                  <p>
                    Link sample identities and confirm details to build your
                    experiment’s provenance.
                  </p>
                </div>
                <button onClick={() => setTab("Sample lineage")}>
                  Explore sample lineage
                  <ArrowRight size={15} />
                </button>
              </div>
              {modelInfo && (
                <div className="analysis-provenance">
                  <ScanEye size={14} />
                  {modelInfo}
                </div>
              )}
              {message && (
                <div className="notice" role="status">
                  <Activity size={17} />
                  <span>{message}</span>
                  <button
                    aria-label="Dismiss message"
                    onClick={() => setMessage("")}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {events.length > 0 && (
                <Button variant="outline" onClick={analyze} disabled={loading}>
                  <ScanEye size={15} />
                  {loading ? "Analyzing…" : "Run visual analysis again"}
                </Button>
              )}
            </>
          ) : null}
          {tab === "Protocol" && (
            <section className="panel section-panel">
              <div className="section-intro">
                <BookOpen />
                <div>
                  <h2>Protocol, grounded in evidence.</h2>
                  <p>
                    Reference workflow for transfection. Assign observations to
                    steps to track coverage; unobserved does not mean omitted.
                  </p>
                </div>
              </div>
              {protocolSteps.map((s) => (
                <div className="protocol-row" key={s.id}>
                  <span className="step-number">
                    {String(s.id).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.description}</p>
                  </div>
                  <span className="tag">
                    {events.filter((e) => e.protocolStep === s.id).length}{" "}
                    linked observations
                  </span>
                </div>
              ))}
              <div className="notice">
                Dataset reference labels are evaluation context, never model
                discoveries. Verify against your laboratory SOP.
              </div>
            </section>
          )}
          {tab === "Sample lineage" && (
            <section className="panel section-panel">
              <div className="section-intro">
                <GitBranch />
                <div>
                  <h2>Follow the sample.</h2>
                  <p>
                    Connections are created only when a researcher links an
                    observed transfer. All registry identities below are
                    synthetic demo metadata.
                  </p>
                </div>
              </div>
              <div className="sample-registry">
                {samples.map((s) => (
                  <div key={s.id}>
                    <FlaskConical size={22} />
                    <strong>{s.id}</strong>
                    <p>{s.name}</p>
                    <span className="tag">Synthetic identity</span>
                  </div>
                ))}
              </div>
              <h3 className="subheading">Interactive transfer graph</h3>
              <TransferGraph
                events={events}
                samples={samples}
                onOpenEvent={(e) => {
                  setSelected(e.id);
                  seek(e.start);
                }}
              />
              <h3 className="subheading">Recorded transfers</h3>
              {transfers.length ? (
                transfers.map((e) => {
                  const linked = Boolean(e.sourceSampleId && e.destinationSampleId);
                  return (
                    <button
                      key={e.id}
                      className={`lineage-row ${linked ? "" : "lineage-pending"}`}
                      onClick={() => {
                        setSelected(e.id);
                        seek(e.start);
                      }}
                    >
                      <strong>{e.sourceSampleId ?? "Source unknown"}</strong>
                      <span>
                        <small>
                          {time(e.start)} · {e.volumeUl === null ? "volume unconfirmed" : `${e.volumeUl} μL`}
                        </small>
                        <ArrowRight />
                      </span>
                      <strong>{e.destinationSampleId ?? "Destination unknown"}</strong>
                      <span className="tag">
                        {linked ? e.verification : "awaiting identity"}
                      </span>
                    </button>
                  );
                })
              ) : (
                <Empty
                  icon={<GitBranch />}
                  title="A lineage begins with a link."
                  text="Run visual analysis, then assign source and destination samples to observed transfers."
                />
              )}
            </section>
          )}
          {tab === "Safety" && (
            <section className="panel section-panel">
              <div className="section-intro">
                <ShieldCheck />
                <div>
                  <h2>A second look, when it matters.</h2>
                  <p>
                    Potential issues require researcher review. Video alone
                    cannot establish sterility or confirm a procedural error.
                  </p>
                </div>
              </div>
              <ReferenceEval
                clipId={clipId}
                events={events}
                duration={clip.duration}
                onSeek={(t) => {
                  seek(t);
                  setTab("Overview");
                }}
              />
              <UnseenEval />
              <h3 className="subheading">Flags awaiting review</h3>
              {flags.length ? (
                flags.map(({ event, flag, index }) => (
                  <div className="safety-row" key={`${event.id}-${index}`}>
                    <div>
                      <strong>{flag.type.replaceAll("_", " ")}</strong>
                      <p>{flag.message}</p>
                      <button
                        className="text-link"
                        onClick={() => {
                          seek(event.start);
                          setSelected(event.id);
                        }}
                      >
                        Review evidence at {time(event.start)}
                      </button>
                    </div>
                    <select
                      aria-label="Flag status"
                      value={flag.status}
                      onChange={(e) =>
                        update(event.id, {
                          flags: event.flags.map((f, i) =>
                            i === index
                              ? {
                                  ...f,
                                  status: e.target.value as typeof f.status,
                                }
                              : f,
                          ),
                        })
                      }
                    >
                      <option value="needs_review">Needs review</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </div>
                ))
              ) : (
                <Empty
                  icon={<ShieldCheck />}
                  title="No safety flags recorded."
                  text="Run visual analysis or add observations to begin review. This is not an assessment that the procedure is safe."
                />
              )}
            </section>
          )}
          {tab === "Training" && (
            <section className="panel section-panel">
              <div className="section-intro">
                <CheckCheck />
                <div>
                  <h2>Learn from the record.</h2>
                  <p>
                    Protocol coverage reflects linked observations. Confirmed
                    actions become reviewable training examples.
                  </p>
                </div>
              </div>
              <div className="training-stats">
                <div>
                  <strong>{events.length}</strong>
                  <span>Recorded observations</span>
                </div>
                <div>
                  <strong>{confirmed}</strong>
                  <span>Researcher verified</span>
                </div>
                <div>
                  <strong>
                    {
                      new Set(
                        events
                          .filter((e) => e.protocolStep !== null)
                          .map((e) => e.protocolStep),
                      ).size
                    }
                    /{protocolSteps.length}
                  </strong>
                  <span>Steps with evidence</span>
                </div>
              </div>
              {protocolSteps.map((s) => (
                <div className="training-row" key={s.id}>
                  <span
                    className={
                      events.some((e) => e.protocolStep === s.id)
                        ? "check-circle"
                        : "unchecked-circle"
                    }
                  >
                    <Check size={14} />
                  </span>
                  <strong>{s.title}</strong>
                  <span>
                    {events.some((e) => e.protocolStep === s.id)
                      ? "Evidence linked"
                      : "Awaiting observation"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const e: LabEvent = {
                        id: crypto.randomUUID(),
                        clipId,
                        start: current,
                        end: current + 1,
                        action: s.title,
                        description:
                          "Operator manually marked this protocol step as observed. Confirm against the footage and laboratory record.",
                        objects: [],
                        sourceSampleId: null,
                        destinationSampleId: null,
                        volumeUl: null,
                        protocolStep: s.id,
                                          verification: "confirmed",
                        origin: "operator",
                        flags: [],
                        evidenceFrames: [current],
                      };
                      setEvents((v) => [...v, e]);
                      log(
                        `Operator verified protocol step ${s.id} at ${time(current)}`,
                      );
                    }}
                  >
                    Verify step
                  </Button>
                </div>
              ))}
            </section>
          )}
          {tab === "AI dataset" && (
            <section className="panel section-panel">
              <div className="section-intro">
                <Database />
                <div>
                  <h2>Better records. Better learning.</h2>
                  <p>
                    Review event labels, temporal boundaries, and provenance
                    before using this record for model training.
                  </p>
                </div>
              </div>
              <section className="atlas-section">
                <h3 className="subheading">
                  Downstream: single-cell metadata preview
                </h3>
                <CellAtlas events={events} samples={samples} />
              </section>
              <div className="notice">
                Footage is a third-person reference dataset, not a live glasses
                recording. Sample registry labels are synthetic. No biological
                measurements are inferred.
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action label</th>
                      <th>Source</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} onClick={() => setSelected(e.id)}>
                        <td className="mono">
                          {time(e.start)}–{time(e.end)}
                        </td>
                        <td>{e.action}</td>
                        <td>{e.origin}</td>
                        <td>{e.verification}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!events.length && (
                <Empty
                  icon={<Database />}
                  title="Your reviewed dataset starts here."
                  text="Analyze the recording or add an operator observation to create your first labeled example."
                />
              )}
              <h3 className="subheading">
                Biological mapping / simulated AnnData observation table
              </h3>
              <p className="fine-print">
                Hypothetical join on sample_id only. No expression data,
                barcode, cell count, or biological outcome is measured.
              </p>
              <pre className="schema-preview">
                {JSON.stringify(
                  biologicalData(events, samples, corrections).anndataJoin,
                  null,
                  2,
                )}
              </pre>
              <h3 className="subheading">Event schema preview</h3>
              <pre className="schema-preview">
                {JSON.stringify(
                  events[0] || {
                    id: null,
                    clipId,
                    start: null,
                    end: null,
                    action: null,
                    sourceSampleId: null,
                    destinationSampleId: null,
                    volumeUl: null,
                    verification: "pending",
                    origin: "model",
                    evidenceFrames: [],
                  },
                  null,
                  2,
                )}
              </pre>
              <h3 className="subheading">Provenance audit</h3>
              <div className="audit-log">
                {audit.length ? (
                  audit.map((a, i) => <p key={i}>{a}</p>)
                ) : (
                  <p>No record changes yet.</p>
                )}
              </div>
            </section>
          )}
          {tab === "Export" && (
            <section className="panel section-panel">
              <div className="section-intro">
                <ArrowDownToLine />
                <div>
                  <h2>Let your research travel.</h2>
                  <p>
                    Export the same reviewed event record across notebook,
                    robotics, and biological research formats.
                  </p>
                </div>
              </div>
              <div className="export-options">
                <div>
                  <BookOpen />
                  <h3>Experiment notebook</h3>
                  <p>
                    Timestamped observations, sample links, protocol context,
                    and verification status.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadNotebook(
                        events,
                        samples,
                        protocolSteps,
                        "md",
                        corrections,
                      )
                    }
                  >
                    Markdown
                    <ArrowDownToLine size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      downloadNotebook(
                        events,
                        samples,
                        protocolSteps,
                        "json",
                        corrections,
                      )
                    }
                  >
                    JSON
                  </Button>
                </div>
                <div>
                  <Activity />
                  <h3>Robotics action dataset</h3>
                  <p>
                    Temporal action segments and object interactions, ready for
                    downstream review.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => downloadRobotics(events, "csv", corrections)}
                  >
                    CSV
                    <ArrowDownToLine size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      downloadRobotics(events, "json", corrections)
                    }
                  >
                    JSON
                  </Button>
                </div>
                <div>
                  <Database />
                  <h3>Biological metadata</h3>
                  <p>
                    Sample-linked event metadata with an explicitly simulated
                    AnnData-compatible table.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadBiological(events, samples, corrections)
                    }
                  >
                    Download metadata
                    <ArrowDownToLine size={14} />
                  </Button>
                </div>
              </div>
              <div className="notice">
                {events.length} observations · {confirmed} verified · Exports
                include synthetic sample and simulation labels.
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>
              <ScanEye size={14} />A little less documenting. A little more
              discovery.
            </span>
            <span>Human judgment, always in the loop.</span>
          </footer>
        </div>
        <VoiceAssistant
          key={clipId}
          clipId={clipId}
          events={events}
          currentTime={current}
          samples={samples}
          protocol={protocolSteps}
          onUpdateEvent={update}
          onAddEvent={(e) => {
            setEvents((v) => [...v, e].sort((a, b) => a.start - b.start));
            log(`Operator note at ${e.start.toFixed(1)} s: ${e.description}`);
          }}
          onNavigate={setTab}
          onSeek={seek}
          onGenerateReport={(format) => {
            downloadNotebook(events, samples, protocolSteps, format, corrections);
            setTab("Export");
          }}
        />
      </main>
      {showAdd && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-title"
          >
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setShowAdd(false)}
            >
              <X />
            </button>
            <span className="empty-icon">
              <BookOpen />
            </span>
            <h2 id="add-title">Add an observation</h2>
            <p>
              Operator note at {time(current)}. This will be saved with human
              provenance.
            </p>
            <label htmlFor="observation">What did you observe?</label>
            <textarea
              id="observation"
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the visible action or add experimental context…"
            />
            <Button onClick={add} disabled={!note.trim()}>
              <Plus size={15} />
              Save observation
            </Button>
          </section>
        </div>
      )}
      {selectedEvent && (
        <div className="modal-backdrop">
          <section
            className="modal event-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-title"
          >
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <div className="eyebrow">
              OBSERVATION · {time(selectedEvent.start)}
            </div>
            <h2 id="event-title">Review the record</h2>
            <label>
              Action
              <input
                value={selectedEvent.action}
                onChange={(e) =>
                  update(selectedEvent.id, {
                    action: e.target.value,
                    verification: "corrected",
                  })
                }
              />
            </label>
            <label>
              Description
              <textarea
                value={selectedEvent.description}
                onChange={(e) =>
                  update(selectedEvent.id, {
                    description: e.target.value,
                    verification: "corrected",
                  })
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Source sample
                <select
                  value={selectedEvent.sourceSampleId || ""}
                  onChange={(e) =>
                    update(selectedEvent.id, {
                      sourceSampleId: e.target.value || null,
                      verification: "corrected",
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {samples.map((s) => (
                    <option key={s.id}>{s.id}</option>
                  ))}
                </select>
              </label>
              <label>
                Destination sample
                <select
                  value={selectedEvent.destinationSampleId || ""}
                  onChange={(e) =>
                    update(selectedEvent.id, {
                      destinationSampleId: e.target.value || null,
                      verification: "corrected",
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {samples.map((s) => (
                    <option key={s.id}>{s.id}</option>
                  ))}
                </select>
              </label>
              <label>
                Operator-confirmed volume (μL)
                <input
                  type="number"
                  min="0"
                  value={selectedEvent.volumeUl ?? ""}
                  onChange={(e) =>
                    update(selectedEvent.id, {
                      volumeUl:
                        e.target.value === "" ? null : Number(e.target.value),
                      verification: "corrected",
                    })
                  }
                />
              </label>
              <label>
                Protocol step
                <select
                  value={selectedEvent.protocolStep ?? ""}
                  onChange={(e) =>
                    update(selectedEvent.id, {
                      protocolStep: e.target.value
                        ? Number(e.target.value)
                        : null,
                      verification: "corrected",
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {protocolSteps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}. {s.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedEvent.visualQuantity && (
              <p className="visible-quantity">
                <strong>Visible in frame:</strong> {selectedEvent.visualQuantity}
              </p>
            )}
            <div className="evidence-links">
              <span>Evidence</span>
              {(selectedEvent.evidenceFrames.length
                ? selectedEvent.evidenceFrames
                : [selectedEvent.start]
              ).map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    seek(t);
                    setSelected(null);
                    setTab("Overview");
                  }}
                >
                  <Video size={13} />
                  {time(t)}
                </button>
              ))}
            </div>
            <p className="fine-print">
              {selectedEvent.origin === "model"
                ? "Model observation · pending review"
                : "Operator observation"}{" "}
              · Evidence frames:{" "}
              {(selectedEvent.evidenceFrames.length
                ? selectedEvent.evidenceFrames
                : [selectedEvent.start]
              )
                .map((t) => time(t))
                .join(", ")}{" "}
              · Sample identities are synthetic operator annotations.
            </p>
            <Button
              onClick={() => {
                update(selectedEvent.id, { verification: "confirmed" });
                setSelected(null);
              }}
            >
              <Check size={15} />
              Confirm observation
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
