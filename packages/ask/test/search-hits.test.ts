// PDF pages in the search index and the search module (P3-06, D-P3-5): page chunks, an
// idempotent reindex, hybrid search over every kind, the kind filter, scope (private and
// other-workspace PDFs never come back) and highlighted snippets.

import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { AskScope } from "@lectern/domain";
import { makeSnippet, queryTerms, runIndexStage, searchIndex } from "../src/index.ts";
import { type AccessScope, resolveAccessScope } from "../src/scope.ts";
import { FOLDERS, ME, pdfSources, REC, RECORDINGS, scopeOf, seededDb, WS } from "./fixtures.ts";

async function pdfIndexedDb(): Promise<Database> {
  const db = seededDb();
  for (const src of pdfSources()) await runIndexStage({ db }, src);
  return db;
}

function scopeFor(scope: AskScope): AccessScope {
  const r = resolveAccessScope({
    workspaceId: WS,
    caller: { userId: ME, role: "owner" },
    scope,
    recordings: RECORDINGS,
    folders: FOLDERS,
    roles: ["owner", "admin", "member", "viewer"],
  });
  if ("code" in r) throw new Error(r.message);
  return r;
}

const workspace = scopeFor(scopeOf({ kind: "workspace" }));
const joined = (runs: Array<{ text: string }>) => runs.map((r) => r.text).join("");

describe("PDF pages in the index", () => {
  test("pdf page is indexed as a chunk", async () => {
    const db = await pdfIndexedDb();
    const row = db
      .query(`SELECT kind, asset_id, page, locator, recording_id FROM search_chunk WHERE asset_id = 'ast_slides' AND page = 2`)
      .get() as Record<string, unknown> | null;
    expect(row).toEqual({ kind: "pdf_page", asset_id: "ast_slides", page: 2, locator: "p:ast_slides:2", recording_id: REC.crypto });
    // The PDF-only input kept the crypto lecture's transcript and document chunks.
    const kinds = db.query(`SELECT DISTINCT kind FROM search_chunk WHERE recording_id = ? ORDER BY kind`).all(REC.crypto) as Array<{ kind: string }>;
    expect(kinds.map((k) => k.kind)).toEqual(["document", "pdf_page", "transcript"]);
  });

  test("reindex is idempotent", async () => {
    const db = await pdfIndexedDb();
    const [slides] = pdfSources();
    const again = await runIndexStage({ db }, slides!);
    expect(again.inserted).toBe(0);
    expect(again.deleted).toBe(0);
    expect(again.kept).toBe(again.chunks);
    expect(again.chunks).toBe(2);
  });
});

describe("searchIndex", () => {
  test("search finds the pdf page", async () => {
    const db = await pdfIndexedDb();
    const { hits } = await searchIndex({ db }, workspace, "서브키 스케줄");
    expect(hits[0]!.chunk).toMatchObject({ kind: "pdf_page", assetId: "ast_slides", page: 2 });
  });

  test("search kinds", async () => {
    const db = await pdfIndexedDb();
    const { hits } = await searchIndex({ db }, workspace, "서브키 스케줄", { kinds: ["transcript"] });
    expect(hits.some((h) => h.chunk.kind === "pdf_page")).toBe(false);
    const pdfOnly = await searchIndex({ db }, workspace, "ECB", { kinds: ["pdf_page"] });
    expect(pdfOnly.hits.length).toBeGreaterThan(0);
    expect(pdfOnly.hits.every((h) => h.chunk.kind === "pdf_page")).toBe(true);
  });

  test("mixed kinds", async () => {
    const db = await pdfIndexedDb();
    const { hits } = await searchIndex({ db }, workspace, "ECB");
    const kinds = new Set(hits.map((h) => h.chunk.kind));
    expect(kinds.has("transcript") || kinds.has("document")).toBe(true);
    expect(hits.some((h) => h.chunk.kind === "pdf_page" && h.chunk.page === 1)).toBe(true);
  });

  test("private teammate pdf is hidden", async () => {
    const db = await pdfIndexedDb();
    expect((await searchIndex({ db }, workspace, "연봉 협상")).hits).toEqual([]);
  });

  test("other workspace pdf is hidden", async () => {
    const db = await pdfIndexedDb();
    expect((await searchIndex({ db }, workspace, "타사 로드맵")).hits).toEqual([]);
  });

  test("recording scope limits", async () => {
    const db = await pdfIndexedDb();
    const meeting = scopeFor(scopeOf({ kind: "recording", recording_id: REC.meeting }));
    expect((await searchIndex({ db }, meeting, "서브키 스케줄")).hits).toEqual([]);
  });

  test("hits carry snippets", async () => {
    const db = await pdfIndexedDb();
    const [top] = (await searchIndex({ db }, workspace, "서브키 스케줄")).hits;
    expect(top!.snippet.filter((r) => r.highlight).map((r) => r.text)).toEqual(["서브키", "스케줄"]);
    expect(top!.rrf).toBeGreaterThan(0);
  });

  test("no match returns nothing", async () => {
    const db = await pdfIndexedDb();
    expect((await searchIndex({ db }, workspace, "zzzqqq")).hits).toEqual([]);
  });
});

describe("makeSnippet", () => {
  test("snippet highlights", () => {
    const text = "운영 모드 비교표 ECB CBC";
    const runs = makeSnippet(text, queryTerms("ECB"));
    expect(joined(runs)).toBe(text);
    const marked = runs.filter((r) => r.highlight);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.text.toLowerCase()).toBe("ecb");
  });

  test("snippet empty and long", () => {
    expect(makeSnippet("", queryTerms("ECB"))).toEqual([]);
    const text = `${"가나다라마바사".repeat(35)}타임퀀텀${"아자차카타파하".repeat(35)}`;
    const runs = makeSnippet(text, queryTerms("타임퀀텀"));
    const out = joined(runs);
    expect(out.length).toBeLessThanOrEqual(2 * 80 + "타임퀀텀".length + 2);
    expect(out.startsWith("…") && out.endsWith("…")).toBe(true);
    expect(text).toContain(out.slice(1, -1));
    expect(runs.find((r) => r.highlight)).toEqual({ text: "타임퀀텀", highlight: true });
  });

  test("without a term the snippet is the start", () => {
    const text = "가".repeat(300);
    const runs = makeSnippet(text, queryTerms("없는말"));
    expect(runs).toEqual([
      { text: "가".repeat(160), highlight: false },
      { text: "…", highlight: false },
    ]);
  });

  test("every occurrence in the window is marked", () => {
    const runs = makeSnippet("CBC와 ECB, 그리고 다시 ECB", queryTerms("ecb cbc"));
    expect(runs.filter((r) => r.highlight).map((r) => r.text)).toEqual(["CBC", "ECB", "ECB"]);
    expect(joined(runs)).toBe("CBC와 ECB, 그리고 다시 ECB");
  });
});
