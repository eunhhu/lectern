// Values the notes stages pass to each other and to the server (CONTRACTS §1.6).

import {
  Confidence,
  DateResolution,
  DocumentBody,
  EventKind,
  Evidence,
  LanguageTag,
  RecordingDomain,
  TimeZone,
} from "@lectern/domain";
import { z } from "zod";

/** Flags the verifier puts on events and action items (strings; not part of the schemas). */
export const NOTE_FLAGS = [
  "needs_review",
  "date_mismatch",
  "recorded_at_estimated",
  "low_confidence",
  "weekday_mismatch",
] as const;
export type NoteFlag = (typeof NOTE_FLAGS)[number];

export const ClassifyOutput = z.object({
  domain: RecordingDomain,
  language: LanguageTag,
  title: z.string().trim().min(1).max(60),
  participants: z.array(z.string().min(1)),
  folder_suggestion: z.object({ folder_id: z.string().nullable(), new_name: z.string().min(1).nullable() }),
  tags: z.array(z.string().min(1)).max(5),
  confidence: Confidence,
});
export type ClassifyOutput = z.infer<typeof ClassifyOutput>;

export const VerifiedEvent = z.object({
  title: z.string().min(1),
  kind: EventKind,
  start_at: z.int(),
  end_at: z.int().nullable(),
  all_day: z.boolean(),
  tz: TimeZone,
  raw_expression: z.string().min(1),
  resolution: DateResolution,
  confidence: Confidence,
  evidence: Evidence,
  flags: z.array(z.string()),
});
export type VerifiedEvent = z.infer<typeof VerifiedEvent>;

export const VerifiedActionItem = z.object({
  text: z.string().min(1),
  owner_name: z.string().min(1).nullable(),
  due_at: z.int().nullable(),
  due_raw: z.string().min(1).nullable(),
  evidence: Evidence,
  flags: z.array(z.string()),
});
export type VerifiedActionItem = z.infer<typeof VerifiedActionItem>;

export const VerifyReport = z.object({
  repaired: z.boolean(),
  dropped_blocks: z.int().nonnegative(),
  items: z.array(
    z.object({
      kind: z.enum(["block", "event", "action_item", "decision", "glossary"]),
      ref: z.string(),
      outcome: z.enum(["ok", "fixed", "dropped"]),
      reasons: z.array(z.string()),
    })
  ),
});
export type VerifyReport = z.infer<typeof VerifyReport>;

export const NotesResult = z.object({
  classification: ClassifyOutput,
  template: z.object({ id: z.string(), version: z.int().min(1) }),
  body: DocumentBody,
  markdown: z.string(),
  events: z.array(VerifiedEvent),
  action_items: z.array(VerifiedActionItem),
  report: VerifyReport,
  partial: z.boolean(),
});
export type NotesResult = z.infer<typeof NotesResult>;
