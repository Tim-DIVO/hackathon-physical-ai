import { z } from "zod";
export const actionLabels = [
  "pick_up",
  "attach_tip",
  "aspirate",
  "dispense",
  "eject_tip",
  "mix",
  "transfer",
  "open_container",
  "close_container",
  "handle_dish",
  "other",
] as const;
export const tipStates = [
  "fresh_tip_attached",
  "tip_ejected",
  "same_tip_continued",
  "no_tip",
  "unclear",
] as const;
export const clipIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const eventSchema = z.object({
  id: z.string(),
  clipId: clipIdSchema,
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  action: z.string(),
  description: z.string(),
  objects: z.array(z.string()),
  sourceSampleId: z.string().nullable(),
  destinationSampleId: z.string().nullable(),
  volumeUl: z.number().nonnegative().nullable(),
  concentration: z.string().max(80).nullable().optional(),
  protocolStep: z.number().int().min(1).max(7).nullable(),
  confidence: z.number().min(0).max(1).optional(),
  visualQuantity: z.string().nullable().optional(),
  verification: z.enum(["pending", "confirmed", "corrected"]),
  origin: z.enum(["model", "operator"]),
  flags: z.array(
    z.object({
      type: z.enum(["tip_reuse", "missing_step", "unknown_sample"]),
      message: z.string(),
      status: z.enum(["needs_review", "confirmed", "dismissed"]),
      source: z.enum(["model", "supervisor"]).optional(),
    }),
  ),
  evidenceFrames: z.array(z.number().nonnegative()),
  actionLabel: z.enum(actionLabels).optional(),
  tipState: z.enum(tipStates).optional(),
});
export const analysisSchema = z.object({
  clipId: clipIdSchema,
  events: z.array(eventSchema),
  model: z.string(),
  generatedAt: z.string(),
  frameTimes: z.array(z.number().nonnegative()),
  source: z.literal("model"),
  analysisMethod: z.string().optional(),
  limitations: z.string().optional(),
  videoSha256: z.string().optional(),
  promptVersion: z.string().optional(),
  tipAudit: z
    .object({
      tipEvents: z.array(
        z.object({ t: z.number(), kind: z.string(), evidence: z.string() }),
      ),
      additions: z.array(z.object({ start: z.number(), end: z.number() })),
      verdict: z.enum(["tip_changed_between_additions", "tip_reused", "unclear"]),
      rationale: z.string(),
      windowEnd: z.number(),
      fps: z.number(),
    })
    .optional(),
});
