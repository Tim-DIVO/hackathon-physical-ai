import type { LabEvent, Sample, ProtocolStep } from "./types";
export type VoiceIntent = {
  reply: string;
  eventId?: string;
  patch?: Partial<LabEvent>;
  view?: "lineage" | "report";
};
export function interpretCommand(
  text: string,
  events: LabEvent[],
  samples: Sample[],
  protocol: ProtocolStep[],
  currentStep?: number,
): VoiceIntent {
  const command = text.toLowerCase();
  const normalized = command.replace(/[^a-z0-9]+/g, " ").trim();
  const explicit = command.match(/event\s+(\d+)/);
  const event = explicit ? events[Number(explicit[1]) - 1] : events.at(-1);
  const patch: Partial<LabEvent> = {};
  const changes: string[] = [];
  if (event) {
    if (/tip/.test(command) && /chang|fresh|new|replac/.test(command)) {
      patch.flags = event.flags.map((f) =>
        f.type === "tip_reuse" ? { ...f, status: "dismissed" as const } : f,
      );
      changes.push("tip-change correction recorded");
    }
    const volume = command.match(
      /(\d+(?:\.\d+)?)\s*(?:\u00b5l|\u03bcl|ul|microlit(?:er|re)s?)/,
    );
    if (volume) {
      patch.volumeUl = Number(volume[1]);
      changes.push(`${volume[1]} microliters recorded`);
    }
    const sample = samples.find((s) =>
      [s.id, s.name].some((value) => {
        const alias = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        return ` ${normalized} `.includes(` ${alias} `);
      }),
    );
    if (sample && /sample|source|destination|from|into|cell/.test(command)) {
      const field = /destination|into|\bto\s+(?:sample|cell)/.test(command)
        ? "destinationSampleId"
        : "sourceSampleId";
      patch[field] = sample.id;
      const source = patch.sourceSampleId ?? event.sourceSampleId;
      const destination =
        patch.destinationSampleId ?? event.destinationSampleId;
      if (source && destination)
        patch.flags = (patch.flags ?? event.flags).map((f) =>
          f.type === "unknown_sample"
            ? { ...f, status: "dismissed" as const }
            : f,
        );
      changes.push(
        `${sample.name} assigned as ${field === "sourceSampleId" ? "source" : "destination"}`,
      );
    }
    if (changes.length)
      return {
        eventId: event.id,
        patch: { ...patch, verification: "corrected" },
        reply: `Operator correction: ${changes.join("; ")}.`,
      };
  }
  if (/lineage|ancestry|sample history/.test(command))
    return { reply: "Opening sample lineage.", view: "lineage" };
  if (/report|notebook|export/.test(command))
    return {
      reply:
        "Generating the notebook from current events and correction history.",
      view: "report",
    };
  if (/mistake|warning|problem|flag/.test(command)) {
    const flags = events.flatMap((e) =>
      e.flags.filter((f) => f.status === "needs_review").map((f) => f.message),
    );
    return {
      reply: flags.length
        ? flags.join(" ")
        : "There are no unresolved warnings in the visible events.",
    };
  }
  if (/next|current|protocol|step/.test(command)) {
    const next = /next/.test(command);
    if (currentStep === undefined && !next)
      return {
        reply:
          "No current protocol step is confirmed. Ask for the next step to hear the first reference step.",
      };
    const index =
      currentStep === undefined
        ? -1
        : protocol.findIndex((p) => p.id === currentStep);
    const step = protocol[index + (next ? 1 : 0)];
    return {
      reply: step
        ? `Reference step ${step.id}: ${step.title}. ${step.description}`
        : "No further protocol step is available.",
    };
  }
  return {
    reply: event
      ? "Try: set volume to 20 microliters; source sample CELL-A; I changed the tip; next step; show mistakes; generate report; show lineage. Add event 2 to target a specific event."
      : "Analyze a clip before correcting an event.",
  };
}

const bestPractices: Record<number, string> = {
  1: "Use a fresh sterile tip and touch only the inside of the tube wall.",
  2: "Eject the previous tip before touching a new reagent to avoid carry-over.",
  3: "Change tips again, and dispense below the liquid surface without blowing bubbles.",
  4: "Mix gently by pipetting up and down; avoid foaming the lipid complexes.",
  5: "Incubate at room temperature for 20 minutes; note start and end times.",
  6: "Add the mixture dropwise across the dish so it spreads evenly over the cells.",
  7: "Rock forward-backward and side-to-side; do not swirl, which piles cells in the centre.",
};

/** Training-mode guidance for the current or next reference step. */
export function protocolGuidance(
  protocol: ProtocolStep[],
  currentStep: number | undefined,
  which: "current" | "next",
): string {
  const index =
    currentStep === undefined
      ? -1
      : protocol.findIndex((p) => p.id === currentStep);
  if (which === "current" && index < 0)
    return "No protocol step has been observed yet. The first reference step is: " +
      `${protocol[0].title}. ${protocol[0].description}`;
  const step = protocol[which === "next" ? index + 1 : index];
  if (!step) return "That was the final reference step. You can generate the report.";
  return `Reference step ${step.id}: ${step.description} Best practice: ${bestPractices[step.id] ?? "Follow the protocol."}`;
}
