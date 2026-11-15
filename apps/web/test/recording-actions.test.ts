// Recording actions in both clients (D-P2-4): reprocess (dry run and queued), audio
// deletion, the Markdown export with its file name, the suggested-questions query, the
// rule that picks server suggestions over the screen's own, and the fixture's behaviour.

import { describe, expect, test } from "bun:test";
import { ApiClientError } from "../src/api/client.ts";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { createHttpClient, fileNameFrom } from "../src/api/http/client.ts";
import type { WorkspaceId } from "../src/api/types.ts";
import { PERSONAL_WS } from "../src/fixtures/index.ts";
import { pickSuggestions } from "../src/lib/ask-suggestions.ts";
import { formatCost } from "../src/routes/recording/ReprocessDialog.tsx";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function fakeFetch(respond: (req: Seen) => Response) {
  const seen: Seen[] = [];
  const fn = (async (input: string, init: RequestInit = {}) => {
    const req = { url: input, method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : null };
    seen.push(req);
    return respond(req);
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ESTIMATE = { estimated_microusd: 1_200, audio_ms: 12_000, within_quota: true };
const STAMP = "2026-10-19T03:00:00.000Z";
const JOB = {
  id: "job_1",
  workspace_id: "wsp_1",
  recording_id: "rec_1",
  kind: "process",
  state: "queued",
  priority: 0,
  run_after: STAMP,
  attempts: 0,
  lease_owner: null,
  lease_until: null,
  budget_microusd: 400_000,
  spent_microusd: 0,
  idempotency_key: null,
  error_code: null,
  created_at: STAMP,
  updated_at: STAMP,
};

describe("HTTP client: recording actions", () => {
  test("a dry run posts mode and dry_run and parses the 200 estimate", async () => {
    const { fn, seen } = fakeFetch(() => json(200, { estimate: ESTIMATE, job: null }));
    const client = createHttpClient({ fetch: fn });
    const res = await client.reprocessRecording("rec_1", { mode: "full", dry_run: true });
    expect(res).toEqual({ estimate: ESTIMATE, job: null } as never);
    expect(seen[0]!.url).toBe("/api/v2/recordings/rec_1/reprocess");
    expect(seen[0]!.method).toBe("POST");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ mode: "full", dry_run: true });
  });

  test("a real reprocess parses the 202 job", async () => {
    const { fn } = fakeFetch(() => json(202, { estimate: ESTIMATE, job: JOB }));
    const client = createHttpClient({ fetch: fn });
    const res = await client.reprocessRecording("rec_1", { mode: "document" });
    expect(String(res.job?.id)).toBe("job_1");
  });

  test("audio deletion sends DELETE and resolves on 204", async () => {
    const { fn, seen } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch: fn });
    expect(await client.deleteRecordingAudio("rec_1")).toBeUndefined();
    expect(seen[0]!.url).toBe("/api/v2/recordings/rec_1/audio");
    expect(seen[0]!.method).toBe("DELETE");
  });

  test("export returns the Markdown and the UTF-8 file name", async () => {
    const { fn, seen } = fakeFetch(
      () =>
        new Response("# 제목\n", {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "attachment; filename*=UTF-8''%EB%85%B8%ED%8A%B8.md" },
        }),
    );
    const client = createHttpClient({ fetch: fn });
    const { filename, blob } = await client.exportDocument("doc_1");
    expect(filename).toBe("노트.md");
    expect(await blob.text()).toBe("# 제목\n");
    expect(seen[0]!.url).toBe("/api/v2/documents/doc_1/export?format=md");
    expect(seen[0]!.method).toBe("GET");
  });

  test("export errors become ApiClientError", async () => {
    const { fn } = fakeFetch(() => json(404, { error: { code: "not_found", message: "문서를 찾을 수 없습니다.", request_id: "req_1" } }));
    const client = createHttpClient({ fetch: fn });
    const err = await client.exportDocument("doc_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(404);
  });

  test("file names: filename* first, then filename, then note.md", () => {
    expect(fileNameFrom(`attachment; filename="note.md"; filename*=UTF-8''%EA%B0%95%EC%9D%98.md`)).toBe("강의.md");
    expect(fileNameFrom(`attachment; filename="plain.md"`)).toBe("plain.md");
    expect(fileNameFrom(null)).toBe("note.md");
    expect(fileNameFrom("attachment; filename*=UTF-8''%E0%A4%A.md")).toBe("note.md");
  });

  test("suggested questions ask for one scope", async () => {
    const { fn, seen } = fakeFetch(() => json(200, { suggestions: ["무엇을 배웠나요?"] }));
    const client = createHttpClient({ fetch: fn });
    const res = await client.listAskSuggestions({ workspace_id: "wsp_1" as WorkspaceId, scope_type: "recording", scope_id: "rec_1" });
    expect(res.suggestions).toEqual(["무엇을 배웠나요?"]);
    expect(seen[0]!.url).toBe("/api/v2/ask/suggestions?workspace_id=wsp_1&scope_type=recording&scope_id=rec_1");
  });
});

describe("suggestion and cost helpers", () => {
  test("pickSuggestions prefers a non-empty server list, at most six", () => {
    expect(pickSuggestions(["a", "b"], ["x"])).toEqual(["a", "b"]);
    expect(pickSuggestions([], ["x"])).toEqual(["x"]);
    expect(pickSuggestions(undefined, ["x"])).toEqual(["x"]);
    expect(pickSuggestions(["1", "2", "3", "4", "5", "6", "7"], ["x"])).toHaveLength(6);
  });

  test("formatCost", () => {
    expect(formatCost(0)).toBe("무료");
    expect(formatCost(1_200)).toBe("$0.01 미만");
    expect(formatCost(10_000)).toBe("$0.01");
    expect(formatCost(1_234_567)).toBe("$1.23");
  });
});

describe("fixture client: recording actions", () => {
  const fresh = () => createFixtureClient({ now: new Date(STAMP), latencyMs: 0 });

  test("reprocess: dry run, the transcript rule and a queued job", async () => {
    const client = fresh();
    const recordings = (await client.listRecordings({ workspace_id: PERSONAL_WS, limit: 200 })).items;
    const withTranscript = recordings.find((r) => r.id === "rec_os07")!;
    const dry = await client.reprocessRecording(withTranscript.id, { mode: "full", dry_run: true });
    expect(dry.job).toBeNull();
    expect(dry.estimate.within_quota).toBe(true);
    expect(dry.estimate.audio_ms).toBe(withTranscript.duration_ms ?? 0);
    expect((await client.reprocessRecording(withTranscript.id, { mode: "document", dry_run: true })).estimate.audio_ms).toBe(0);

    const ids = await Promise.all(recordings.map(async (r) => ((await client.getTranscript(r.id).catch(() => null)) ? null : String(r.id))));
    const noTranscript = ids.find((id) => id !== null)!;
    const conflict = await client.reprocessRecording(noTranscript, { mode: "document", dry_run: true }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ApiClientError);
    expect((conflict as ApiClientError).status).toBe(409);

    const real = await client.reprocessRecording(withTranscript.id, { mode: "full" });
    expect(real.job).not.toBeNull();
    expect((await client.getRecording(withTranscript.id)).recording.status).toBe("queued");
  });

  test("audio deletion keeps the documents; export names the file after the recording", async () => {
    const client = fresh();
    const before = await client.getRecording("rec_os07");
    expect(before.assets.some((a) => a.kind.startsWith("audio"))).toBe(true);
    await client.deleteRecordingAudio("rec_os07");
    const after = await client.getRecording("rec_os07");
    expect(after.assets.some((a) => a.kind.startsWith("audio"))).toBe(false);
    expect(after.documents.length).toBe(before.documents.length);

    const { filename, blob } = await client.exportDocument(after.documents[0]!.id);
    expect(filename).toBe(`${after.recording.title}.md`);
    expect((await blob.text()).startsWith("# ")).toBe(true);
    await expect(client.listAskSuggestions({ workspace_id: PERSONAL_WS, scope_type: "workspace" })).rejects.toBeInstanceOf(ApiClientError);
  });
});
