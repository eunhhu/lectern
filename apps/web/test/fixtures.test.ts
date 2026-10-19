// Every fixture entity and every fixture API response must parse with the
// packages/domain zod schemas, and the references between them must resolve, so the
// shell is built against the same contract the real /api/v2 will serve.

import { describe, expect, test } from "bun:test";
import * as D from "@lectern/domain";
import type { z } from "zod";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import type { CreateUploadRequest, Folder, SourceRef } from "../src/api/types.ts";
import { buildFixtureData, PERSONAL_WS, TEAM_WS } from "../src/fixtures/index.ts";

const NOW = new Date("2026-10-19T03:00:00.000Z"); // 12:00 KST

function parseAll<T extends z.ZodType>(schema: T, items: readonly unknown[], what: string) {
  for (const [i, item] of items.entries()) {
    const result = schema.safeParse(item);
    if (!result.success) throw new Error(`${what}[${i}] does not match the domain schema: ${result.error.message}`);
  }
}

describe("fixture data set", () => {
  const data = buildFixtureData(NOW);
  const segments = [...data.transcripts.values()].flatMap((t) => t.segments);

  test("every entity parses with its packages/domain schema", () => {
    parseAll(D.Me, [data.me], "me");
    parseAll(D.MyWorkspace, data.workspaces, "workspaces");
    parseAll(D.Folder, data.folders, "folders");
    parseAll(D.Tag, data.tags, "tags");
    parseAll(D.Recording, data.recordings, "recordings");
    parseAll(D.RecordingTag, data.recordingTags, "recordingTags");
    parseAll(D.AssetDto, data.assets, "assets");
    parseAll(D.Speaker, data.speakers, "speakers");
    parseAll(D.TranscriptSegment, segments, "segments");
    parseAll(D.TranscriptGap, [...data.transcripts.values()].flatMap((t) => t.gaps), "gaps");
    parseAll(D.Document, data.documents, "documents");
    parseAll(D.DocumentVersion, data.versions, "versions");
    parseAll(D.Question, data.questions, "questions");
    parseAll(D.EventCandidate, data.events, "events");
    parseAll(D.ActionItem, data.actionItems, "actionItems");
    parseAll(D.Job, data.jobs, "jobs");
  });

  test("covers several domains and statuses, in two workspaces", () => {
    const domains = new Set<string>(data.recordings.map((r) => r.domain));
    for (const d of ["lecture", "meeting", "seminar", "interview", "one_on_one", "call", "other"]) expect(domains).toContain(d);
    const statuses = new Set<string>(data.recordings.map((r) => r.status));
    for (const s of ["ready", "processing", "queued", "partial", "failed", "uploading"]) expect(statuses).toContain(s);
    expect(new Set(data.recordings.map((r) => r.workspace_id))).toEqual(new Set([PERSONAL_WS, TEAM_WS]));
  });

  test("has a transcript with thousands of segments for virtual scrolling", () => {
    const longest = Math.max(...[...data.transcripts.values()].map((t) => t.segments.length));
    expect(longest).toBeGreaterThanOrEqual(3000);
  });

  test("is synthetic Korean text with no real contact data", () => {
    const hangul = segments.filter((s) => /[가-힣]/.test(s.text)).length;
    expect(hangul / segments.length).toBeGreaterThan(0.95);
    expect(data.me.email.endsWith("@example.com")).toBe(true);
  });

  test("transcripts are ordered by idx with monotonic, non-overlapping original-audio times", () => {
    for (const [id, t] of data.transcripts) {
      const rec = data.recordings.find((r) => r.id === id)!;
      t.segments.forEach((s, i) => {
        expect(s.idx).toBe(i);
        expect(s.recording_id).toBe(id);
        if (i > 0) expect(s.start_ms).toBeGreaterThanOrEqual(t.segments[i - 1]!.end_ms);
      });
      for (const gap of t.gaps) {
        const inside = t.segments.filter((s) => s.end_ms > gap.start_ms && s.start_ms < gap.end_ms);
        expect(inside).toEqual([]);
      }
      expect(rec.duration_ms).toBeGreaterThanOrEqual(t.segments.at(-1)!.end_ms);
      const speakerIds = new Set(data.speakers.filter((s) => s.recording_id === id).map((s) => s.id));
      for (const s of t.segments) if (s.speaker_id) expect(speakerIds.has(s.speaker_id)).toBe(true);
    }
  });

  test("every source points at an existing transcript range or PDF page of the same recording", () => {
    const check = (recordingId: string, refs: readonly SourceRef[], where: string) => {
      const segs = data.transcripts.get(recordingId)?.segments ?? [];
      for (const ref of refs) {
        if (ref.kind === "transcript") {
          expect(ref.end_idx, where).toBeLessThan(segs.length);
          expect(ref.start_idx, where).toBeLessThanOrEqual(ref.end_idx);
        } else {
          const pdf = data.assets.find((a) => a.id === ref.asset_id);
          expect(pdf?.recording_id, where).toBe(recordingId);
          expect(pdf?.kind, where).toBe("pdf");
          expect(ref.page, where).toBeLessThanOrEqual(pdf!.page_count!);
        }
      }
    };
    let cited = 0;
    for (const v of data.versions) {
      for (const block of v.body!.sections.flatMap((s) => s.blocks)) {
        check(v.recording_id, block.sources, block.id);
        cited += block.sources.length;
        if (block.type === "list") for (const item of block.items) check(v.recording_id, item.sources, block.id);
      }
    }
    for (const q of data.questions) check(q.recording_id, q.sources, q.id);
    for (const e of data.events) check(e.recording_id, e.evidence.sources, e.id);
    for (const a of data.actionItems) check(a.recording_id, a.evidence.sources, a.id);
    expect(cited).toBeGreaterThan(20);
  });

  test("anchors cite segments that say what the block claims", () => {
    const doc = data.versions.find((v) => v.recording_id === "rec_os07")!;
    const block = doc.body!.sections.flatMap((s) => s.blocks).find((b) => b.type === "term" && b.term.startsWith("호위 효과"))!;
    const ref = block.sources[0]!;
    if (ref.kind !== "transcript") throw new Error("expected a transcript source");
    expect(data.transcripts.get("rec_os07")!.segments[ref.start_idx]!.text).toContain("호위 효과");
  });

  test("folders, tags and documents reference rows that exist in the same workspace", () => {
    const folders = new Map(data.folders.map((f) => [f.id, f]));
    for (const f of data.folders) {
      const seen = new Set<string>();
      let cur: Folder | undefined = f;
      while (cur?.parent_id) {
        expect(seen.has(cur.id)).toBe(false); // acyclic
        seen.add(cur.id);
        const parent = folders.get(cur.parent_id);
        expect(parent?.workspace_id).toBe(f.workspace_id);
        cur = parent;
      }
    }
    for (const r of data.recordings) if (r.folder_id) expect(folders.get(r.folder_id)?.workspace_id).toBe(r.workspace_id);
    for (const rt of data.recordingTags) {
      expect(data.tags.find((t) => t.id === rt.tag_id)?.workspace_id).toBe(rt.workspace_id);
      expect(data.recordings.some((r) => r.id === rt.recording_id)).toBe(true);
    }
    for (const d of data.documents) {
      expect(data.versions.some((v) => v.document_id === d.id && v.version === d.current_version)).toBe(true);
    }
  });

  test("is deterministic for a given clock", () => {
    const again = buildFixtureData(NOW);
    expect(again.recordings).toEqual(data.recordings);
    expect(again.transcripts.get("rec_os07")).toEqual(data.transcripts.get("rec_os07"));
    expect(again.versions).toEqual(data.versions);
  });
});

describe("fixture ApiClient responses", () => {
  const api = createFixtureClient({ now: NOW, latencyMs: 0, processingMs: 50 });

  test("list and detail responses match the /api/v2 response schemas", async () => {
    D.MyWorkspacePage.parse(await api.listWorkspaces());
    D.FolderPage.parse(await api.listFolders(PERSONAL_WS));
    D.TagPage.parse(await api.listTags(PERSONAL_WS));
    const page = D.RecordingPage.parse(await api.listRecordings({ workspace_id: PERSONAL_WS, limit: 5 }));
    expect(page.items).toHaveLength(5);
    expect(page.next_cursor).not.toBeNull();
    const rest = D.RecordingPage.parse(await api.listRecordings({ workspace_id: PERSONAL_WS, cursor: page.next_cursor!, limit: 200 }));
    expect(page.items.length + rest.items.length).toBe(api.data.recordings.filter((r) => r.workspace_id === PERSONAL_WS).length);

    for (const rec of api.data.recordings) {
      const raw = await api.getRecording(rec.id);
      D.RecordingDetail.parse(raw);
      const detail = raw;
      if (detail.documents[0]) {
        D.Transcript.parse(await api.getTranscript(rec.id));
        D.DocumentWithVersion.parse(await api.getDocument(detail.documents[0].id));
      }
      D.QuestionPage.parse(await api.listQuestions(rec.id));
      D.EventCandidatePage.parse(await api.listRecordingEvents(rec.id));
      D.ActionItemPage.parse(await api.listActionItems(rec.id));
    }
    D.EventCandidatePage.parse(await api.listCalendarSuggestions({ workspace_id: PERSONAL_WS }));
    D.SearchHitPage.parse(await api.search({ workspace_id: PERSONAL_WS, q: "타임 퀀텀" }));
  });

  test("errors use domain error codes", async () => {
    await expect(api.getRecording("rec_missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
    // Members cannot delete a teammate's recording in the team workspace.
    await expect(api.deleteRecording("rec_tw42")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    for (const code of ["not_found", "forbidden", "upload_incomplete", "validation_failed", "bad_request"]) {
      expect(D.ErrorCode.safeParse(code).success).toBe(true);
    }
  });

  test("an upload runs through the resumable contract and is processed into a document", async () => {
    const events: D.ServerEvent[] = [];
    const off = api.subscribe(PERSONAL_WS, (e) => events.push(D.ServerEvent.parse(e)));
    const audio = new Blob([new Uint8Array(1500)], { type: "audio/mp4" });
    const pdf = new Blob([new Uint8Array(300)], { type: "application/pdf" });
    const request: CreateUploadRequest = {
      workspace_id: PERSONAL_WS,
      recording: { title: "업로드 테스트", folder_id: "fld_os" },
      files: [
        { kind: "audio", filename: "업로드 테스트.m4a", mime: "audio/mp4", bytes: audio.size },
        { kind: "pdf", filename: "업로드 테스트.pdf", mime: "application/pdf", bytes: pdf.size },
      ],
    };
    D.CreateUploadRequest.parse(request);
    const session = await api.createUpload(request, "idem-1");
    D.UploadSession.parse(session);
    expect(session.files.map((f) => f.first_part)).toEqual([1, 2]);
    await expect(api.completeUpload(session.id, "idem-2")).rejects.toMatchObject({ code: "upload_incomplete" });
    D.UploadPartReceipt.parse(await api.uploadPart(session.id, 1, audio));
    D.UploadPartReceipt.parse(await api.uploadPart(session.id, 2, pdf));
    const done = await api.completeUpload(session.id, "idem-2");
    D.CompleteUploadResponse.parse(done);
    expect(done.recording.status).toBe("queued");
    expect(done.recording.folder_id).toBe("fld_os");

    await new Promise((r) => setTimeout(r, 200));
    off();
    const detail = await api.getRecording(done.recording.id);
    expect(detail.recording.status).toBe("ready");
    D.DocumentWithVersion.parse(await api.getDocument(detail.documents[0]!.id));
    const types = events.map((e) => e.type);
    expect(types).toContain("recording.created");
    expect(types).toContain("job.progress");
    expect(types).toContain("document.updated");
  });
});
