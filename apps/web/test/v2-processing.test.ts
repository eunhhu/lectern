import { describe, expect, test } from "bun:test";
import type { Document, StageName } from "../src/api/types.ts";
import { partialNote, progressLabel, stageLabel } from "../src/app/labels.ts";
import { primaryDocument } from "../src/lib/documents.ts";

// What the web shows for recordings the v2 pipeline (`process`) handles: stage names in
// Korean, the server's reason on a `partial` recording, and the structured document first.

describe("stage labels", () => {
  test("every process stage has a Korean label", () => {
    const stages: StageName[] = [
      "ingest",
      "normalize",
      "speech_map",
      "chunk",
      "transcribe",
      "merge",
      "speakers",
      "classify",
      "structure",
      "extract",
      "verify",
      "publish",
      "index",
    ];
    for (const stage of stages) expect(stageLabel(stage), stage).not.toBe("처리 중");
    expect(stageLabel("index")).toBe("검색 색인 중");
  });

  test("unknown stage falls back", () => {
    expect(stageLabel(undefined)).toBe("처리 중");
  });

  test("progressLabel prefers the server message", () => {
    expect(progressLabel("processing", { stage: "transcribe", progress: 0.4, message: "받아쓰는 중...", queuePosition: null })).toBe(
      "받아쓰는 중... · 40%"
    );
  });

  test("progressLabel falls back to the stage name", () => {
    expect(progressLabel("processing", { stage: "transcribe", progress: 0.4, message: null, queuePosition: null })).toBe("전사 중 · 40%");
  });
});

describe("partialNote", () => {
  test("partialNote uses the server reason", () => {
    expect(partialNote({ code: "notes_failed", message: "노트를 만들지 못했습니다. 전사는 사용할 수 있습니다." })).toBe(
      "일부만 완료되었습니다. 노트를 만들지 못했습니다. 전사는 사용할 수 있습니다."
    );
  });

  test("partialNote without a reason", () => {
    const generic = "일부 구간을 전사하지 못했습니다. 빠진 구간은 전사와 문서에 표시됩니다.";
    expect(partialNote(null)).toBe(generic);
    expect(partialNote({ code: "notes_partial", message: "  " })).toBe(generic);
  });
});

describe("primaryDocument", () => {
  const doc = (id: string, template: string, updatedAt: string): Document =>
    ({
      id,
      workspace_id: "wsp_1",
      recording_id: "rec_1",
      template_id: template,
      template_version: 1,
      current_version: 1,
      user_edited: false,
      created_at: "2026-10-19T05:00:00.000Z",
      updated_at: updatedAt,
    }) as Document;
  const idOf = (d: Document | undefined): string | undefined => d?.id;

  test("structured document comes first", () => {
    const legacy = doc("doc-legacy", "legacy-markdown", "2026-10-20T00:00:00.000Z");
    const lecture = doc("doc-lecture", "lecture", "2026-10-19T00:00:00.000Z");
    expect(idOf(primaryDocument([legacy, lecture]))).toBe("doc-lecture");
  });

  test("newest structured wins", () => {
    const older = doc("doc-a", "lecture", "2026-10-19T00:00:00.000Z");
    const newer = doc("doc-b", "meeting", "2026-10-21T00:00:00.000Z");
    expect(idOf(primaryDocument([older, newer]))).toBe("doc-b");
    // Same time: the smaller id.
    const twin = doc("doc-0", "lecture", "2026-10-21T00:00:00.000Z");
    expect(idOf(primaryDocument([older, newer, twin]))).toBe("doc-0");
  });

  test("only legacy", () => {
    const legacy = doc("doc-legacy", "legacy-markdown", "2026-10-20T00:00:00.000Z");
    expect(idOf(primaryDocument([legacy]))).toBe("doc-legacy");
  });

  test("empty", () => {
    const docs: Document[] = [];
    expect(primaryDocument(docs)).toBeUndefined();
    const two = [doc("doc-legacy", "legacy-markdown", "2026-10-20T00:00:00.000Z"), doc("doc-lecture", "lecture", "2026-10-19T00:00:00.000Z")];
    const before = two.map((d) => d.id);
    primaryDocument(two);
    expect(two.map((d) => d.id)).toEqual(before);
  });
});
