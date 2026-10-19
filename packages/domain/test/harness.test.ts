import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ExtractResult,
  extractResultSchema,
  LECTURE_TEMPLATE,
  MEETING_TEMPLATE,
  TemplateDefinition,
  TemplateOutput,
  templateOutputSchema,
  TEMPLATES,
  TranscribeResult,
  TranscribeSegment,
} from "../src/index.ts";
import { extractResult, lectureOutput, meetingOutput, transcribeResult } from "./fixtures.ts";
import { expectInvalid, expectRequiredKeysEnforced, expectValid } from "./helpers.ts";

describe("transcribe output", () => {
  test("valid", () => {
    expectValid(TranscribeResult, transcribeResult, "TranscribeResult");
    expectValid(TranscribeResult, { segments: [] }, "empty chunk");
    expectRequiredKeysEnforced(TranscribeSegment, transcribeResult.segments[0], "TranscribeSegment");
  });

  test("invalid", () => {
    const seg = transcribeResult.segments[0]!;
    expectInvalid(TranscribeSegment, { ...seg, end_ms: seg.start_ms - 1 }, "end before start");
    expectInvalid(TranscribeSegment, { ...seg, start_ms: -1 }, "negative time");
    expectInvalid(TranscribeSegment, { ...seg, speaker: "Alice" }, "free-form speaker");
    expectInvalid(TranscribeSegment, { ...seg, confidence: 2 }, "confidence > 1");
    expectInvalid(TranscribeResult, transcribeResult.segments, "bare array root");
  });
});

describe("templates", () => {
  test("the two placeholder templates parse", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(["lecture", "meeting"]);
    expectValid(TemplateDefinition, LECTURE_TEMPLATE, "lecture");
    expectValid(TemplateDefinition, MEETING_TEMPLATE, "meeting");
  });

  test("definition rules", () => {
    const dup = { ...LECTURE_TEMPLATE, sections: [...LECTURE_TEMPLATE.sections, LECTURE_TEMPLATE.sections[0]] };
    expectInvalid(TemplateDefinition, dup, "duplicate section key");
    expectInvalid(
      TemplateDefinition,
      { ...LECTURE_TEMPLATE, extract: { ...LECTURE_TEMPLATE.extract, questions: false } },
      "questions section without questions extract",
    );
    expectInvalid(TemplateDefinition, { ...LECTURE_TEMPLATE, question_kinds: [] }, "questions without kinds");
    expectInvalid(TemplateDefinition, { ...LECTURE_TEMPLATE, id: "Lecture" }, "non-slug id");
    expectInvalid(TemplateDefinition, { ...LECTURE_TEMPLATE, version: 0 }, "version 0");
    const { glossary: _g, ...partialExtract } = LECTURE_TEMPLATE.extract;
    expectInvalid(TemplateDefinition, { ...LECTURE_TEMPLATE, extract: partialExtract }, "extract toggles must be complete");
  });
});

describe("structure output (template document blocks)", () => {
  const lecture = templateOutputSchema(LECTURE_TEMPLATE);
  const meeting = templateOutputSchema(MEETING_TEMPLATE);

  test("valid", () => {
    expectValid(TemplateOutput, lectureOutput, "generic lecture");
    expectValid(TemplateOutput, meetingOutput, "generic meeting");
    expectValid(lecture, lectureOutput, "lecture");
    expectValid(meeting, meetingOutput, "meeting");
  });

  test("source tokens", () => {
    const block = lectureOutput.sections[0]!.blocks[0]!;
    for (const bad of ["12", "#", "#12-", "#12-13", "S1", "#a"]) {
      expectInvalid(TemplateOutput, { sections: [{ key: "summary", blocks: [{ ...block, sources: [bad] }] }] }, bad);
    }
    expectInvalid(TemplateOutput, { sections: [{ key: "summary", blocks: [{ ...block, pdf_pages: [0] }] }] }, "page 0");
  });

  test("template rules", () => {
    const summary = lectureOutput.sections[0]!;
    const topics = lectureOutput.sections[1]!;
    expectInvalid(lecture, { sections: [topics] }, "missing required summary");
    expectInvalid(lecture, { sections: [summary, topics, summary] }, "duplicate section");
    expectInvalid(lecture, { sections: [summary, topics, { key: "questions", blocks: [] }] }, "extract-filled section");
    expectInvalid(lecture, { sections: [summary, topics, { key: "action_items", blocks: [] }] }, "unknown section");
    const quote = lectureOutput.sections[2]!.blocks[0]!;
    expectInvalid(lecture, { sections: [{ key: "summary", blocks: [quote] }, topics] }, "quote not allowed in summary");
    expectInvalid(TemplateOutput, { sections: [{ key: "summary", blocks: [{ type: "gap" }] }] }, "gap is code-only");
  });

  test("converts to JSON Schema for provider structured output", () => {
    for (const schema of [lecture, meeting, TranscribeResult, ExtractResult]) {
      expect(() => z.toJSONSchema(schema, { target: "draft-2020-12" })).not.toThrow();
    }
  });
});

describe("extract output", () => {
  test("valid", () => {
    expectValid(ExtractResult, extractResult, "ExtractResult");
    expectValid(ExtractResult, { events: [], action_items: [], questions: [], decisions: [], glossary: [] }, "empty");
  });

  test("invalid", () => {
    const event = extractResult.events[0]!;
    expectInvalid(ExtractResult, { ...extractResult, events: [{ ...event, evidence: [] }] }, "event without evidence");
    expectInvalid(ExtractResult, { ...extractResult, events: [{ ...event, raw_expression: "" }] }, "empty raw_expression");
    expectInvalid(
      ExtractResult,
      { ...extractResult, events: [{ ...event, model_resolution: { ...event.model_resolution, date: "2026-10-27T00:00:00Z" } }] },
      "model date must be a local date",
    );
    expectInvalid(
      ExtractResult,
      { ...extractResult, events: [{ ...event, model_resolution: { ...event.model_resolution, time: "9am" } }] },
      "model time must be HH:MM",
    );
    expectInvalid(ExtractResult, { ...extractResult, decisions: undefined }, "missing field");
    expectInvalid(ExtractResult, { ...extractResult, questions: [{ ...extractResult.questions[0], kind: "quiz" }] }, "question kind");
  });

  test("per-template schemas keep only enabled fields and kinds", () => {
    const lectureJson = z.toJSONSchema(extractResultSchema(LECTURE_TEMPLATE)) as { properties: Record<string, unknown> };
    expect(Object.keys(lectureJson.properties).sort()).toEqual(["events", "glossary", "questions"]);
    const meetingSchema = extractResultSchema(MEETING_TEMPLATE);
    const meetingJson = z.toJSONSchema(meetingSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(meetingJson.properties).sort()).toEqual(["action_items", "decisions", "events", "questions"]);

    const { glossary: _g, ...meetingResult } = extractResult;
    const issue = { ...extractResult.questions[0]!, kind: "issue" };
    expectValid(meetingSchema, { ...meetingResult, questions: [issue] }, "meeting extract");
    expectInvalid(meetingSchema, meetingResult, "recall question in a meeting");
  });
});
