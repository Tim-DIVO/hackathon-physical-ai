"use client";

import { useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { Mic, MicOff, Send, Sparkles } from "lucide-react";
import type { ClipId, LabEvent, Sample, ProtocolStep } from "@/lib/types";
import { interpretCommand, protocolGuidance } from "@/lib/voice";

export const VIEW_TABS = [
  "Overview",
  "Protocol",
  "Sample lineage",
  "Safety",
  "Training",
  "AI dataset",
  "Export",
] as const;

export interface VoiceAssistantProps {
  clipId: ClipId;
  /** Observations revealed so far; the assistant scopes to playback time itself. */
  events: LabEvent[];
  currentTime: number;
  samples: Sample[];
  protocol: ProtocolStep[];
  onUpdateEvent: (id: string, patch: Partial<LabEvent>) => void;
  /** Adds an operator-authored notebook entry (voice narration, reported facts). */
  onAddEvent: (event: LabEvent) => void;
  onNavigate?: (tab: string) => void;
  onFocusSample?: (sampleId: string | null) => void;
  onSeek?: (seconds: number) => void;
  onGenerateReport: (format: "md" | "json") => void;
  variant?: "dock" | "panel" | "hud";
  /** What is being performed; grounds phrasing and the voice agent for non-CRISPR clips. */
  procedure?: string;
  /** HUD: connect hands-free when true (no tap-to-talk). */
  autoConnect?: boolean;
  /** A yes/no check the supervisor has put to the operator (HUD). Answered by voice, never by clicking. */
  pendingCheck?: { key: string; question: string } | null;
  /** The operator answered the pending check: ok = "that's fine", false = "log it as a deviation". */
  onAnswerCheck?: (ok: boolean, words: string) => void;
  /** HUD: the supervisor's current question or warning (null once answered), for the page to show in view. */
  onAsk?: (ask: { text: string; kind: "question" | "warning" } | null) => void;
}

const LAB_CONTENT =
  /\d|µ|\b(ul|ml|mg|ug|ng|mm|nm|x)\b|%|reagent|tube|tip|plasmid|cell|buffer|medi(a|um)|dmso|pbs|fbs|virus|moi|polybrene|incubat|mix|dilut|lipofect|opti-?mem|dna|rna|cas9|guide|dish|vial|confluen|aliquot|label|spun|centrifug|pellet|wash/i;
const YES =
  /\b(yes|yeah|yep|yup|ya|sure|fine|ok(ay)?|confirm(ed|s)?|affirmative|right|correct|good|intended|on purpose|deliberate(ly)?|that'?s (fine|ok(ay)?|intended|right)|it'?s (fine|ok(ay)?|intended)|go ahead|all good|no problem|same reagent)\b/i;
const NO = /\b(no|nope|nah|log it|my bad|mistake|oops|wrong|didn'?t mean|not intended|i forgot|deviation)\b/i;

/** Classifies a reply to a yes/no check. "No problem" is a yes; anything ambiguous is null. */
export function classifyAnswer(text: string): boolean | null {
  const t = text.toLowerCase();
  // "No, that's fine" / "no problem" mean yes; check those before the bare "no".
  if (/\bno problem\b|\bnot a problem\b|\b(that'?s|it'?s|that is|it is) (fine|ok(ay)?|intended)\b/.test(t)) return true;
  const yes = YES.test(t);
  const no = NO.test(t);
  if (yes === no) return null;
  return yes;
}

type Tag = "Model observation" | "Operator fact" | "Reference protocol" | "Supervisor" | "Action";
interface Message {
  role: "you" | "assistant";
  text: string;
  tag?: Tag;
}
type Recognition = {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const SUGGESTIONS = [
  "That's sample CELL-A. I'm adding 100 microlitres.",
  "Actually, I changed tips before that step.",
  "What step am I on?",
  "What should I do next?",
  "Did you detect any mistakes?",
  "Show the lineage for sample CELL-A.",
  "Generate my experiment report.",
];
const ALERT_PREFIX = "[LabLens alert]";
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function currentEventOf(events: LabEvent[], t: number) {
  const model = events.filter((e) => e.origin === "model");
  return model.find((e) => e.start <= t && e.end >= t) ?? model.filter((e) => e.start <= t).at(-1);
}

/**
 * Raw facts for a proactive alert. Wording is left to the language model so the
 * supervisor speaks naturally instead of reading canned sentences.
 */
function alertFacts(event: LabEvent, flag: LabEvent["flags"][number]) {
  return [
    `At ${fmt(event.start)}-${fmt(event.end)} the camera shows: ${event.action}. ${event.description}`,
    event.visualQuantity ? `Visible: ${event.visualQuantity}.` : "",
    `Concern (${flag.type.replace("_", " ")}): ${flag.message}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function VoiceAssistant(props: VoiceAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "I'm your lab supervisor. Tap the mic and talk to me. I'll speak up if something looks off.",
    },
  ]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("Ready");
  const [listening, setListening] = useState(false);
  const [spokenAlerts, setSpokenAlerts] = useState(true);
  const [coach, setCoach] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  /** What the supervisor last asked or warned about, shown in view until the operator answers out loud. */
  const [ask, setAsk] = useState<{ text: string; kind: "question" | "warning" } | null>(null);
  const awaitingAlertReply = useRef(false);
  useEffect(() => {
    props.onAsk?.(ask);
    if (!ask) return;
    const t = setTimeout(() => setAsk(null), 20000);
    return () => clearTimeout(t);
  }, [ask]);
  const recognition = useRef<Recognition | null>(null);
  const active = useRef(true);
  const playback = useRef<HTMLAudioElement | null>(null);
  const alerted = useRef(new Set<string>());
  const coachedStep = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const add = (m: Message) => setMessages((old) => [...old.slice(-39), m]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  // A new run or replay starts from an empty event list: allow alerts to fire again.
  const hasEvents = props.events.length > 0;
  useEffect(() => {
    if (hasEvents) return;
    alerted.current.clear();
    coachedStep.current = null;
  }, [props.clipId, hasEvents]);

  const state = () => {
    const p = latest.current;
    const visible = p.events.filter((e) => e.start <= p.currentTime + 0.5);
    const current = currentEventOf(p.events, p.currentTime);
    return { p, visible, current, step: current?.protocolStep ?? undefined };
  };

  async function speakTts(text: string) {
    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      if (!active.current) return URL.revokeObjectURL(url);
      playback.current?.pause();
      const audio = new Audio(url);
      playback.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      if (active.current && "speechSynthesis" in window)
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }

  function operatorNote(text: string, patch: Partial<LabEvent> = {}): LabEvent {
    const p = latest.current;
    const t = Math.round(p.currentTime * 10) / 10;
    return {
      id: `op-${Date.now()}`,
      clipId: p.clipId,
      start: t,
      end: t,
      action: "Operator note",
      description: text,
      objects: [],
      sourceSampleId: null,
      destinationSampleId: null,
      volumeUl: null,
      protocolStep: null,
      verification: "confirmed",
      origin: "operator",
      flags: [],
      evidenceFrames: [t],
      ...patch,
    };
  }

  // ---- tools shared by ElevenLabs client tools and typed/browser speech ----
  const tools = {
    get_lab_state: () => {
      const { p, visible, current, step } = state();
      return JSON.stringify({
        recording: p.clipId,
        playback_time: fmt(p.currentTime),
        current_protocol_step: step ? p.protocol.find((s) => s.id === step)?.title : "not yet observed",
        current_observation: current
          ? { action: current.action, time: `${fmt(current.start)}-${fmt(current.end)}`, visible_quantity: current.visualQuantity ?? null }
          : null,
        observations_so_far: visible.map((e, i) => ({
          number: i + 1,
          time: fmt(e.start),
          action: e.action,
          origin: e.origin === "model" ? "seen on camera" : "operator said",
          verification: e.verification,
          source: e.sourceSampleId ?? "unknown",
          destination: e.destinationSampleId ?? "unknown",
          operator_volume_ul: e.volumeUl ?? "unknown",
          concentration: e.concentration ?? "unknown",
        })),
        open_flags: visible.flatMap((e) =>
          e.flags.filter((f) => f.status === "needs_review").map((f) => ({ at: fmt(e.start), type: f.type, message: f.message })),
        ),
        sample_registry: p.samples.map((s) => `${s.id} (${s.name}, synthetic)`),
      });
    },
    update_event: (args: {
      event_number?: number;
      source_sample_id?: string;
      destination_sample_id?: string;
      volume_ul?: number;
      concentration?: string;
      tip_changed?: boolean;
      confirm?: boolean;
    }) => {
      const { p, visible, current } = state();
      const target = args.event_number ? visible[args.event_number - 1] : current;
      const known = (id?: string) => (id ? p.samples.find((s) => s.id.toLowerCase() === id.toLowerCase())?.id : undefined);
      const source = known(args.source_sample_id);
      const destination = known(args.destination_sample_id);
      if (args.source_sample_id && !source) return `${args.source_sample_id} is not in the sample registry.`;
      if (args.destination_sample_id && !destination) return `${args.destination_sample_id} is not in the sample registry.`;
      const done: string[] = [];
      if (source) done.push(`source ${source}`);
      if (destination) done.push(`destination ${destination}`);
      const volume = typeof args.volume_ul === "number" && args.volume_ul > 0 ? args.volume_ul : null;
      if (volume) done.push(`${volume} µL`);
      const concentration = args.concentration?.trim().slice(0, 80) || null;
      if (concentration) done.push(`at ${concentration}`);
      if (args.tip_changed) done.push("tip changed");
      if (args.confirm) done.push("observation confirmed");
      if (!done.length) return "Nothing to record. Tell me a sample, volume, or tip change.";
      if (target) {
        let flags = target.flags;
        if (args.tip_changed) flags = flags.map((f) => (f.type === "tip_reuse" ? { ...f, status: "dismissed" as const } : f));
        if ((source ?? target.sourceSampleId) && (destination ?? target.destinationSampleId))
          flags = flags.map((f) => (f.type === "unknown_sample" ? { ...f, status: "dismissed" as const } : f));
        p.onUpdateEvent(target.id, {
          ...(source ? { sourceSampleId: source } : {}),
          ...(destination ? { destinationSampleId: destination } : {}),
          ...(volume ? { volumeUl: volume } : {}),
          ...(concentration ? { concentration } : {}),
          flags,
          verification: "corrected",
        });
      }
      p.onAddEvent(
        operatorNote(`Operator: ${done.join(", ")}${target ? ` (linked to "${target.action}" at ${fmt(target.start)})` : ""}.`, {
          sourceSampleId: source ?? null,
          destinationSampleId: destination ?? null,
          volumeUl: volume,
          concentration,
        }),
      );
      const summary = `Recorded${target ? ` on "${target.action}"` : ""}: ${done.join(", ")}.`;
      add({ role: "assistant", text: summary, tag: "Operator fact" });
      return summary;
    },
    add_note: ({ text }: { text: string }) => {
      if (!text?.trim()) return "Empty note.";
      latest.current.onAddEvent(operatorNote(text.trim()));
      add({ role: "assistant", text: `Noted at ${fmt(latest.current.currentTime)}: ${text.trim()}`, tag: "Operator fact" });
      return "Note added to the notebook.";
    },
    get_protocol_guidance: ({ which }: { which?: "current" | "next" }) => {
      const { p, step } = state();
      const text = protocolGuidance(p.protocol, step, which === "current" ? "current" : "next");
      add({ role: "assistant", text, tag: "Reference protocol" });
      return text;
    },
    show_view: ({ tab }: { tab: string }) => {
      const match = VIEW_TABS.find((t) => t.toLowerCase() === tab?.toLowerCase());
      if (!match || !latest.current.onNavigate) return `Cannot open ${tab} here.`;
      latest.current.onNavigate(match);
      add({ role: "assistant", text: `Opened ${match}.`, tag: "Action" });
      return `Opened ${match}.`;
    },
    show_lineage: ({ sample_id }: { sample_id?: string }) => {
      const p = latest.current;
      const sample = p.samples.find((s) => s.id.toLowerCase() === sample_id?.toLowerCase());
      p.onFocusSample?.(sample?.id ?? null);
      p.onNavigate?.("Sample lineage");
      const text = `Showing lineage${sample ? ` for ${sample.id}` : ""}.`;
      add({ role: "assistant", text, tag: "Action" });
      return text;
    },
    show_evidence: ({ event_number }: { event_number?: number }) => {
      const { p, visible } = state();
      const target = event_number
        ? visible[event_number - 1]
        : visible.find((e) => e.flags.some((f) => f.status === "needs_review" && f.type !== "unknown_sample"));
      if (!target || !p.onSeek) return "No flagged evidence to show.";
      p.onNavigate?.("Overview");
      p.onSeek(target.start);
      const text = `Showing evidence at ${fmt(target.start)}: ${target.action}.`;
      add({ role: "assistant", text, tag: "Model observation" });
      return text;
    },
    generate_report: ({ format }: { format?: "md" | "json" }) => {
      latest.current.onGenerateReport(format === "json" ? "json" : "md");
      add({ role: "assistant", text: "Experiment report generated and downloaded.", tag: "Action" });
      return "Report generated and downloaded.";
    },
  };

  const conversation = useConversation({
    micMuted,
    clientTools: tools as unknown as Record<string, (p: unknown) => string>,
    onMessage: ({ message, source }) => {
      if (!message || message.startsWith(ALERT_PREFIX)) return;
      add({ role: source === "user" ? "you" : "assistant", text: message });
      if (source === "user") {
        setAsk(null);
        // Resolve checks and write the notebook from the transcript itself, not via agent tool calls.
        if (!answerCheck(message)) recordUtterance(message);
        return;
      }
      if (/\?\s*$/.test(message)) setAsk({ text: message, kind: "question" });
      else if (awaitingAlertReply.current) setAsk({ text: message, kind: "warning" });
      awaitingAlertReply.current = false;
    },
    onConnect: () => setMode("ElevenLabs · live"),
    onDisconnect: () => {
      setListening(false);
      setMode("Ready");
    },
    onError: () => {
      setListening(false);
      setMode("Voice connection failed · browser fallback");
    },
  });
  const connected = conversation.status === "connected";

  /**
   * Everything the operator says lands in the notebook here, in the browser: facts (sample, volume,
   * concentration, tip change) on the matching event, other statements as notes. The voice agent never
   * has to call a tool first, so it can answer straight away.
   */
  function recordUtterance(text: string): string | null {
    const { p, visible, step } = state();
    const result = interpretCommand(text, visible.filter((e) => e.origin === "model"), p.samples, p.protocol, step);
    const conc = text.match(/(\d+(?:\.\d+)?\s*(?:µg\/µl|ug\/ul|ng\/µl|ng\/ul|mg\/ml|µm|um|nm|mm|x))/i)?.[1];
    if (result.patch || conc) {
      const tipChanged = result.patch?.flags?.some((f) => f.type === "tip_reuse" && f.status === "dismissed");
      return tools.update_event({
        source_sample_id: result.patch?.sourceSampleId ?? undefined,
        destination_sample_id: result.patch?.destinationSampleId ?? undefined,
        volume_ul: result.patch?.volumeUl ?? undefined,
        concentration: conc,
        tip_changed: tipChanged,
      });
    }
    const question = /\?\s*$/.test(text) || /^(what|how|why|when|which|where|who|did|do|does|can|could|should|is|are|am)\b/i.test(text.trim());
    // Only statements with lab content become notes; "okay, let's see" is conversation, not a record.
    if (question || text.trim().split(/\s+/).length < 3 || !LAB_CONTENT.test(text)) return null;
    return tools.add_note({ text });
  }

  /** A spoken reply to the open check resolves it at once, before the voice agent has even answered. */
  function answerCheck(text: string): boolean {
    const check = latest.current.pendingCheck;
    if (!check || !latest.current.onAnswerCheck) return false;
    const ok = classifyAnswer(text);
    if (ok === null) return false;
    latest.current.onAnswerCheck(ok, text);
    if (conversation.status === "connected")
      conversation.sendContextualUpdate(
        `[Check answered] The operator answered "${check.question}" with "${text}" (${ok ? "fine as is" : "log it as a deviation"}). It is recorded; do not ask again. Acknowledge in at most four words.`,
      );
    return true;
  }

  /** Typed or browser-recognised input runs the same tools locally. */
  function execute(text: string, audible: boolean) {
    add({ role: "you", text });
    if (answerCheck(text)) {
      if (audible) void speakTts("Got it, noted.");
      return;
    }
    const lower = text.toLowerCase();
    let reply: string;
    const tab = VIEW_TABS.find((t) => lower.includes(`open ${t.toLowerCase()}`) || lower.includes(`show ${t.toLowerCase()}`));
    if (/evidence|show me (the )?(clip|video)/.test(lower)) reply = tools.show_evidence({});
    else if (/lineage|ancestry/.test(lower))
      reply = tools.show_lineage({ sample_id: latest.current.samples.find((s) => lower.includes(s.id.toLowerCase()))?.id });
    else if (tab) reply = tools.show_view({ tab });
    else if (/what.*next|next step/.test(lower)) reply = tools.get_protocol_guidance({ which: "next" });
    else if (/what step|current step|where am i/.test(lower)) reply = tools.get_protocol_guidance({ which: "current" });
    else if (/report|notebook/.test(lower)) reply = tools.generate_report({ format: lower.includes("json") ? "json" : "md" });
    else {
      const { p, visible, step } = state();
      const result = interpretCommand(text, visible.filter((e) => e.origin === "model"), p.samples, p.protocol, step);
      const recorded = /mistake|warning|flag|problem|wrong/.test(lower) ? null : recordUtterance(text);
      reply = recorded ?? result.reply;
      if (!recorded) add({ role: "assistant", text: reply });
    }
    if (audible) void speakTts(reply);
  }

  /** Speaks a proactive message phrased by the LLM from raw facts. */
  async function speakUp(facts: string, kind: "alert" | "coach") {
    const instruction =
      kind === "alert"
        ? "Ask the operator one short yes/no question about this (max 12 words)."
        : "The operator just reached this step. Tell them in max 12 words what to do now.";
    if (connected) {
      if (kind === "alert") awaitingAlertReply.current = true;
      conversation.sendUserMessage(`${ALERT_PREFIX} ${instruction} Facts: ${facts}`);
      return;
    }
    try {
      const response = await fetch("/api/voice/phrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts: `Procedure: ${props.procedure ?? "CRISPR-Cas9 lipofection into HEK293T"}. ${facts}`, kind }),
      });
      const data = await response.json();
      if (!response.ok || !data.text || !active.current) return;
      add({ role: "assistant", text: data.text, tag: kind === "alert" ? "Supervisor" : "Reference protocol" });
      setAsk({ text: data.text, kind: /\?\s*$/.test(data.text) ? "question" : "warning" });
      void speakTts(data.text);
    } catch {
      // Proactive speech is best-effort; the flag stays visible in the HUD.
    }
  }

  // Keep the voice agent's context current so it can answer immediately, without
  // spending an extra LLM + tool round-trip on get_lab_state.
  const lastContext = useRef("");
  useEffect(() => {
    if (!connected) return;
    const { current, step, visible } = state();
    const latestFacts = [...visible].reverse();
    const pick = <T,>(f: (e: LabEvent) => T | null | undefined) => latestFacts.map(f).find((v) => v != null) ?? "unknown";
    const open = visible
      .flatMap((e) => e.flags.filter((f) => f.status === "needs_review").map((f) => `${f.type.replace("_", " ")} at ${fmt(e.start)}`))
      .slice(-4);
    const stepNow = step ? props.protocol.find((s) => s.id === step) : undefined;
    const stepNext = props.protocol.find((s) => s.id === (step ?? 0) + 1);
    const summary = [
      `Procedure: ${props.procedure ?? "CRISPR-Cas9 lipofection into HEK293T"}.`,
      stepNow ? `Protocol now: ${stepNow.description}` : "",
      stepNext ? `Protocol next: ${stepNext.description}` : "",
      `Time ${fmt(props.currentTime)}.`,
      step ? `Protocol step ${step}.` : "",
      current ? `Right now: ${current.action}${current.visualQuantity ? ` (${current.visualQuantity})` : ""}, tip ${current.tipState ?? "unclear"}.` : "",
      `Last sample: ${pick((e) => e.sourceSampleId)} -> ${pick((e) => e.destinationSampleId)}, volume ${pick((e) => e.volumeUl)} uL, concentration ${pick((e) => e.concentration)}.`,
      open.length ? `Open issues: ${open.join("; ")}.` : "No open issues.",
    ]
      .filter(Boolean)
      .join(" ");
    if (summary === lastContext.current) return;
    lastContext.current = summary;
    conversation.sendContextualUpdate(`[Live bench state] ${summary}`);
  }, [props.events, Math.floor(props.currentTime / 3), connected]);

  // Supervisor: speak up when an open concern appears near the playhead. Live
  // annotations arrive a few seconds after the action, so recent events count too.
  useEffect(() => {
    const t = props.currentTime;
    for (const event of props.events) {
      if (event.start > t + 0.5 || t - event.end > 12) continue;
      for (const flag of event.flags) {
        // Never quiz the operator about sample or reagent IDs; those stay silent gaps in the record.
        if (flag.status !== "needs_review" || flag.type === "unknown_sample") continue;
        const key = flag.type === "tip_reuse" ? "tip_reuse" : `${event.id}:${flag.type}`;
        if (alerted.current.has(key) || !spokenAlerts) continue;
        alerted.current.add(key);
        void speakUp(alertFacts(event, flag), "alert");
      }
    }
  }, [props.currentTime, props.events, spokenAlerts, connected]);

  // Coach mode: brief guidance when a new protocol step is observed.
  useEffect(() => {
    if (!coach) return;
    const step = currentEventOf(props.events, props.currentTime)?.protocolStep;
    if (!step || step === coachedStep.current) return;
    coachedStep.current = step;
    void speakUp(protocolGuidance(props.protocol, step, "current"), "coach");
  }, [props.currentTime, props.events, coach, connected]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      recognition.current?.stop();
      playback.current?.pause();
      window.speechSynthesis?.cancel();
      void conversation.endSession();
    };
  }, []);

  function browserListen() {
    const browser = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!SpeechRecognition) return setMode("Speech input unavailable · type instead");
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => execute(e.results[0][0].transcript, true);
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      setMode("Microphone unavailable");
    };
    recognition.current = rec;
    setMode("Browser speech");
    setListening(true);
    rec.start();
  }

  async function toggleMic() {
    if (listening || connected) {
      recognition.current?.stop();
      await conversation.endSession();
      setListening(false);
      setMode("Ready");
      return;
    }
    setMode("Connecting…");
    try {
      const response = await fetch("/api/voice/session");
      const data = await response.json();
      if (!response.ok || !data.signedUrl) throw new Error(data.error);
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      if (!active.current) return;
      await conversation.startSession({ signedUrl: data.signedUrl, connectionType: "websocket" });
      setListening(true);
    } catch {
      if (active.current) browserListen();
    }
  }

  useEffect(() => {
    if (props.variant !== "hud") return;
    if (props.autoConnect && !connected && !listening) void toggleMic();
    if (!props.autoConnect && (connected || listening)) void toggleMic();
  }, [props.autoConnect]);

  const orbState = connected ? (conversation.isSpeaking ? "speaking" : "listening") : listening ? "listening" : "idle";
  const send = (text: string) => (connected ? conversation.sendUserMessage(text) : execute(text, spokenAlerts));
  if (props.variant === "hud") {
    const live = connected || listening;
    const label = orbState === "speaking" ? "Supervisor speaking" : live ? (micMuted ? "Mic off · supervisor can still warn you" : "Listening") : mode === "Ready" ? "Supervisor standby" : mode;
    return (
      <>
        {/* The page's own check card takes this spot while a flag is open, so the two never stack. */}
        {ask && !props.pendingCheck && !props.onAsk && (
          <div className={`hud-ask ${ask.kind}`} role="status" key={ask.text}>
            <small>{ask.kind === "question" ? "Supervisor asks" : "Heads up"}</small>
            <b>{ask.text}</b>
            <span>Answer out loud</span>
          </div>
        )}
        <div className={`hud-voice-pill ${micMuted ? "muted" : orbState}`} role="status" aria-live="polite">
          <i />
          {label}
        </div>
        <button
          type="button"
          className={`hud-mic ${live && !micMuted ? "on" : "off"}`}
          onClick={() => (connected ? setMicMuted((m) => !m) : void toggleMic())}
          aria-label={live && !micMuted ? "Turn microphone off" : "Turn microphone on"}
          aria-pressed={live && !micMuted}
        >
          {live && !micMuted ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
      </>
    );
  }
  return (
    <section className={`voice-panel ${props.variant ?? "dock"}`} aria-label="Lab supervisor">
      <div className="vp-control">
        <button
          type="button"
          className={`vp-orb ${orbState}`}
          onClick={() => void toggleMic()}
          aria-label={listening || connected ? "Stop voice supervisor" : "Start voice supervisor"}
          aria-pressed={listening || connected}
        >
          {listening || connected ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <div className="vp-meta">
          <strong>Lab supervisor</strong>
          <span role="status">
            {orbState === "speaking" ? "Speaking…" : orbState === "listening" ? "Listening…" : mode}
          </span>
          <div className="vp-toggles">
            <label>
              <input type="checkbox" checked={spokenAlerts} onChange={(e) => setSpokenAlerts(e.target.checked)} />
              Spoken alerts
            </label>
            <label>
              <input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} />
              Coach mode
            </label>
          </div>
        </div>
      </div>
      <div className="vp-log" ref={logRef} role="log" aria-live="polite">
        {messages.map((m, i) => (
          <p key={i} className={`vp-msg ${m.role}`}>
            <span className="vp-who">{m.role === "you" ? "You" : "LabLens"}</span>
            {m.tag && <span className={`vp-tag ${m.tag.split(" ")[0].toLowerCase()}`}>{m.tag}</span>}
            <span>{m.text}</span>
          </p>
        ))}
      </div>
      <div className="vp-input">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            send(input.trim());
            setInput("");
          }}
        >
          <input
            aria-label="Supervisor command"
            placeholder="Ask, or say what you just did…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" aria-label="Send">
            <Send size={15} />
          </button>
        </form>
        <div className="vp-suggestions">
          <Sparkles size={12} />
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
export default VoiceAssistant;
