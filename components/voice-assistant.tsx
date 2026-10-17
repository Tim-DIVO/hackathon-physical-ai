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
  /** HUD: connect hands-free when true (no tap-to-talk). */
  autoConnect?: boolean;
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

/** Short spoken text for a flag; keeps TTS usage low. */
function alertText(event: LabEvent, flag: LabEvent["flags"][number]) {
  if (flag.type === "tip_reuse")
    return `Heads up: possible pipette tip reuse at ${fmt(event.start)}. Did you change tips?`;
  if (flag.type === "missing_step")
    return flag.source === "supervisor"
      ? "Wait: the protocol needs a 20 minute incubation before adding to the dish. Did that happen?"
      : `Possible missing protocol step before ${fmt(event.start)}. Please confirm.`;
  return "I can't read the tube labels. Tell me which samples you're using.";
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
          origin: e.origin === "model" ? "model observation" : "operator note",
          verification: e.verification,
          source: e.sourceSampleId ?? "unknown",
          destination: e.destinationSampleId ?? "unknown",
          operator_volume_ul: e.volumeUl ?? "unknown",
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
          flags,
          verification: "corrected",
        });
      }
      p.onAddEvent(
        operatorNote(`Operator: ${done.join(", ")}${target ? ` (linked to "${target.action}" at ${fmt(target.start)})` : ""}.`, {
          sourceSampleId: source ?? null,
          destinationSampleId: destination ?? null,
          volumeUl: volume,
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
    clientTools: tools as unknown as Record<string, (p: unknown) => string>,
    onMessage: ({ message, source }) => {
      if (!message || message.startsWith(ALERT_PREFIX)) return;
      add({ role: source === "user" ? "you" : "assistant", text: message });
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

  /** Typed or browser-recognised input runs the same tools locally. */
  function execute(text: string, audible: boolean) {
    add({ role: "you", text });
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
      if (result.patch) {
        const s = result.patch.sourceSampleId ?? undefined;
        const d = result.patch.destinationSampleId ?? undefined;
        const tipChanged = result.patch.flags?.some((f) => f.type === "tip_reuse" && f.status === "dismissed");
        reply = tools.update_event({
          source_sample_id: s,
          destination_sample_id: d,
          volume_ul: result.patch.volumeUl ?? undefined,
          tip_changed: tipChanged,
        });
      } else if (/mistake|warning|flag|problem|wrong/.test(lower)) {
        reply = result.reply;
        add({ role: "assistant", text: reply, tag: "Model observation" });
      } else if (!/\?\s*$/.test(text) && !/^(what|how|why|when|which|did|do|can|is|are)\b/.test(lower)) {
        reply = tools.add_note({ text });
      } else {
        reply = result.reply;
        add({ role: "assistant", text: reply });
      }
    }
    if (audible) void speakTts(reply);
  }

  // Supervisor: speak up when playback reaches an open flag.
  useEffect(() => {
    const t = props.currentTime;
    for (const event of props.events) {
      if (event.start > t || event.end + 1 < t) continue;
      for (const flag of event.flags) {
        if (flag.status !== "needs_review") continue;
        const key = flag.type === "unknown_sample" ? "unknown_sample" : flag.type === "tip_reuse" ? "tip_reuse" : `${event.id}:${flag.type}`;
        if (alerted.current.has(key)) continue;
        alerted.current.add(key);
        const text = alertText(event, flag);
        add({ role: "assistant", text: `${text} — ${flag.message}`, tag: "Supervisor" });
        if (!spokenAlerts) continue;
        if (connected) conversation.sendUserMessage(`${ALERT_PREFIX} ${text}`);
        else void speakTts(text);
      }
    }
  }, [props.currentTime, props.events, spokenAlerts, connected]);

  // Coach mode: brief guidance when a new protocol step is observed.
  useEffect(() => {
    if (!coach) return;
    const step = currentEventOf(props.events, props.currentTime)?.protocolStep;
    if (!step || step === coachedStep.current) return;
    coachedStep.current = step;
    const text = protocolGuidance(props.protocol, step, "current");
    add({ role: "assistant", text, tag: "Reference protocol" });
    if (connected) conversation.sendContextualUpdate(`Operator is now on: ${text}`);
    else void speakTts(text);
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
  if (props.variant === "hud")
    return (
      <div className={`hud-voice-pill ${orbState}`} role="status" aria-live="polite">
        <i />
        {orbState === "speaking" ? "Supervisor speaking" : connected || listening ? "Supervisor listening" : mode === "Ready" ? "Supervisor standby" : mode}
      </div>
    );
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
