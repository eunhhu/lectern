import { describe, expect, test } from "bun:test";
import {
  chunkRecording,
  chunksMissingEmbedding,
  deleteRecordingIndex,
  FakeEmbedder,
  hasEvidence,
  indexGeneration,
  lexicalSearch,
  pruneCommonTerms,
  putEmbeddings,
  QueryEmbeddingCache,
  quantizeInt8,
  queryTerms,
  recordingChunks,
  retrieve,
  runIndexStage,
  SqliteVectorIndex,
  syncRecordingChunks,
} from "../src/index.ts";
import { type AccessScope, resolveAccessScope } from "../src/scope.ts";
import { cryptoSources, FOLDERS, ME, meetingSources, REC, RECORDINGS, scopeOf, seededDb, tempDb, WS, WS_OTHER } from "./fixtures.ts";

function access(scope: Parameters<typeof scopeOf>[0] = { kind: "workspace" }, workspaceId = WS): AccessScope {
  const r = resolveAccessScope({ workspaceId, caller: { userId: ME, role: "owner" }, scope: scopeOf(scope), recordings: RECORDINGS, folders: FOLDERS });
  if ("code" in r) throw new Error(r.message);
  return r;
}

const ftsCount = (db: ReturnType<typeof tempDb>) =>
  (db.query(`SELECT COUNT(*) AS n FROM search_chunk_fts WHERE search_chunk_fts MATCH '"시험"'`).get() as { n: number }).n;

describe("index sync", () => {
  test("is idempotent and keeps unchanged chunks", () => {
    const db = tempDb();
    const src = cryptoSources();
    const chunks = chunkRecording(src);
    const args = { workspaceId: WS, recordingId: REC.crypto, kinds: ["transcript", "document"] as const, chunks };
    expect(syncRecordingChunks(db, { ...args, kinds: [...args.kinds] })).toEqual({ inserted: chunks.length, deleted: 0, kept: 0 });
    const gen = indexGeneration(db, WS);
    expect(syncRecordingChunks(db, { ...args, kinds: [...args.kinds] })).toEqual({ inserted: 0, deleted: 0, kept: chunks.length });
    expect(indexGeneration(db, WS)).toBe(gen); // nothing changed, caches stay warm
  });

  test("a transcript-only sync leaves the document chunks alone", () => {
    const db = tempDb();
    const src = cryptoSources();
    syncRecordingChunks(db, { workspaceId: WS, recordingId: REC.crypto, kinds: ["transcript", "document"], chunks: chunkRecording(src) });
    const onlyTranscript = chunkRecording({ ...src, document: undefined });
    const res = syncRecordingChunks(db, { workspaceId: WS, recordingId: REC.crypto, kinds: ["transcript"], chunks: onlyTranscript });
    expect(res.deleted).toBe(0);
    expect(recordingChunks(db, WS, REC.crypto).filter((c) => c.kind === "document").length).toBe(3);
  });

  test("refuses chunks of another recording or kind", () => {
    const db = tempDb();
    const chunks = chunkRecording(cryptoSources());
    expect(() => syncRecordingChunks(db, { workspaceId: WS, recordingId: REC.meeting, kinds: ["transcript", "document"], chunks })).toThrow();
    expect(() => syncRecordingChunks(db, { workspaceId: WS, recordingId: REC.crypto, kinds: ["transcript"], chunks })).toThrow();
  });

  test("deleting a recording removes its FTS rows and orphaned embeddings", async () => {
    const db = tempDb();
    const embedder = new FakeEmbedder(64);
    await runIndexStage({ db, embedder }, cryptoSources());
    expect(ftsCount(db)).toBeGreaterThan(0);
    expect((db.query(`SELECT COUNT(*) AS n FROM search_embedding`).get() as { n: number }).n).toBeGreaterThan(0);
    deleteRecordingIndex(db, WS, REC.crypto);
    expect(ftsCount(db)).toBe(0);
    expect((db.query(`SELECT COUNT(*) AS n FROM search_chunk`).get() as { n: number }).n).toBe(0);
    expect((db.query(`SELECT COUNT(*) AS n FROM search_embedding`).get() as { n: number }).n).toBe(0);
  });
});

describe("lexical search", () => {
  const db = seededDb();

  test("finds two-syllable Korean terms with particles in the question", () => {
    const hits = lexicalSearch(db, access(), queryTerms("시험 범위가 어디까지야?"));
    expect(hits[0]!.chunk.recordingId).toBe(REC.crypto);
    expect(hits[0]!.chunk.text).toContain("시험 범위는");
  });

  test("ignores spacing differences between question and transcript", () => {
    const hits = lexicalSearch(db, access(), queryTerms("운영모드"));
    expect(hits.some((h) => h.chunk.text.includes("운영 모드"))).toBe(true);
  });

  test("never returns chunks outside the workspace or the allowlist", () => {
    for (const q of ["ECB 운영 모드 시험 범위", "출시 일정", "비밀 메모 연봉"]) {
      const hits = lexicalSearch(db, access(), queryTerms(q));
      expect(hits.every((h) => h.chunk.workspaceId === WS)).toBe(true);
      expect(hits.some((h) => h.chunk.recordingId === REC.otherWorkspace)).toBe(false);
      expect(hits.some((h) => h.chunk.recordingId === REC.privateTeammate)).toBe(false);
    }
  });

  test("a recording scope only searches that recording", () => {
    const hits = lexicalSearch(db, access({ kind: "recording", recording_id: REC.meeting }), queryTerms("시험 출시"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.chunk.recordingId === REC.meeting)).toBe(true);
  });

  test("an empty allowlist returns nothing", () => {
    expect(lexicalSearch(db, { ...access(), recordingIds: [] }, queryTerms("시험"))).toEqual([]);
  });

  test("a one-character question falls back to a bounded LIKE scan", () => {
    const hits = lexicalSearch(db, access(), queryTerms("XOR"), {});
    expect(hits.length).toBeGreaterThan(0);
    const one = lexicalSearch(db, access(), [], { fallbackText: "벡" });
    expect(one.some((h) => h.chunk.text.includes("벡터"))).toBe(true);
  });
});

describe("common terms", () => {
  test("a term in most chunks is dropped while a rarer one remains", () => {
    const db = tempDb();
    const segments = Array.from({ length: 12 }, (_, i) => ({
      idx: i,
      start_ms: i * 120_000,
      end_ms: i * 120_000 + 1_000,
      text: i === 5 ? "공통 주제와 희귀한 단어" : `공통 주제 ${i}`,
    }));
    const chunks = chunkRecording({ workspaceId: WS, recordingId: REC.crypto, transcript: { segments } });
    syncRecordingChunks(db, { workspaceId: WS, recordingId: REC.crypto, kinds: ["transcript"], chunks });
    expect(pruneCommonTerms(db, queryTerms("공통 희귀")).terms.map((t) => t.text)).toEqual(["희귀"]);
    expect(pruneCommonTerms(db, queryTerms("공통 주제"))).toMatchObject({ allCommon: true });
    expect(lexicalSearch(db, access({ kind: "recording", recording_id: REC.crypto }), queryTerms("공통")).length).toBe(12);
  });
});

describe("vector index", () => {
  test("int8 quantization keeps cosine order", () => {
    const a = quantizeInt8(new Float32Array([3, 4, 0, 0]));
    expect(a.codes[0]! / a.scale).toBeCloseTo(0.6, 2);
    expect(a.codes[1]! / a.scale).toBeCloseTo(0.8, 2);
  });

  test("exact scan and binary prefilter agree on the best hit", async () => {
    const db = seededDb();
    const embedder = new FakeEmbedder(64);
    for (const src of [cryptoSources(), meetingSources()]) await runIndexStage({ db, embedder }, src);
    const [q] = (await embedder.embed(["CBC 초기화 벡터 IV"], "query")).vectors;
    const exact = new SqliteVectorIndex(db, embedder.model, embedder.dim).search(access(), q!, 5);
    const binary = new SqliteVectorIndex(db, embedder.model, embedder.dim, {
      maxCachedWorkspaces: 2,
      fullScanMax: 0,
      rescoreCandidates: 10,
    }).search(access(), q!, 5);
    expect(exact.length).toBeGreaterThan(0);
    expect(binary[0]!.seq).toBe(exact[0]!.seq);
    expect(exact.every((h) => h.recordingId !== REC.otherWorkspace)).toBe(true);
  });

  test("the cache reloads when the workspace generation changes", async () => {
    const db = tempDb();
    const embedder = new FakeEmbedder(64);
    const index = new SqliteVectorIndex(db, embedder.model, embedder.dim);
    await runIndexStage({ db, embedder }, cryptoSources());
    const [q] = (await embedder.embed(["출시 일정 확정"], "query")).vectors;
    const before = index.search(access(), q!, 3);
    expect(before.every((h) => h.recordingId === REC.crypto)).toBe(true);
    await runIndexStage({ db, embedder }, meetingSources());
    expect(index.search(access(), q!, 1)[0]!.recordingId).toBe(REC.meeting);
  });
});

describe("index stage", () => {
  test("embeds each text once and meters every call", async () => {
    const db = tempDb();
    const embedder = new FakeEmbedder(64);
    const metered: string[] = [];
    const meter = async <T,>(meta: { provider: string; model: string }, call: () => Promise<T>) => {
      metered.push(`${meta.provider}/${meta.model}`);
      return call();
    };
    const first = await runIndexStage({ db, embedder, meter }, cryptoSources());
    expect(first.embedded).toBe(first.chunks);
    expect(first.embedding_tokens).toBeGreaterThan(0);
    expect(metered).toEqual(["fake/fake-hash-embedding"]);
    const second = await runIndexStage({ db, embedder, meter }, cryptoSources());
    expect(second).toMatchObject({ inserted: 0, embedded: 0, embedding_tokens: 0 });
    expect(metered.length).toBe(1);
    expect(chunksMissingEmbedding(db, { workspaceId: WS, model: embedder.model, dim: embedder.dim })).toEqual([]);
  });

  test("without an embedder it still indexes for BM25", async () => {
    const db = tempDb();
    const res = await runIndexStage({ db }, cryptoSources());
    expect(res.embedding_skipped).toBe(true);
    expect(lexicalSearch(db, access(), queryTerms("ECB")).length).toBeGreaterThan(0);
  });

  test("embeddings are per workspace even for identical text", async () => {
    const db = tempDb();
    const embedder = new FakeEmbedder(64);
    await runIndexStage({ db, embedder }, cryptoSources());
    const res = await runIndexStage({ db, embedder }, { ...cryptoSources(), workspaceId: WS_OTHER, recordingId: "rec_copy" });
    expect(res.embedded).toBe(res.chunks);
    const vec = new Float32Array(64).fill(0.1);
    expect(putEmbeddings(db, { workspaceId: WS, model: embedder.model, dim: 64, items: [] })).toBe(0);
    expect(() => putEmbeddings(db, { workspaceId: WS, model: embedder.model, dim: 32, items: [{ contentSha256: "x", vector: vec }] })).toThrow();
  });
});

describe("hybrid retrieval", () => {
  test("fuses BM25 and vector ranks and caps passages per recording", async () => {
    const db = seededDb();
    const embedder = new FakeEmbedder(64);
    for (const src of [cryptoSources(), meetingSources()]) await runIndexStage({ db, embedder }, src);
    const deps = { db, embedder, vectorIndex: new SqliteVectorIndex(db, embedder.model, embedder.dim), queryCache: new QueryEmbeddingCache() };
    const res = await retrieve(deps, access(), "ECB가 왜 위험한가요?");
    expect(res.usedVectors).toBe(true);
    expect(res.chunks[0]!.chunk.recordingId).toBe(REC.crypto);
    expect(res.chunks[0]!.lexicalRank).not.toBeNull();
    const perRecording = new Map<string, number>();
    for (const c of res.chunks) perRecording.set(c.chunk.recordingId, (perRecording.get(c.chunk.recordingId) ?? 0) + 1);
    expect(Math.max(...perRecording.values())).toBeLessThanOrEqual(3);
    expect(hasEvidence(res)).toBe(true);
    // The same question again reuses the query embedding.
    const calls = embedder.calls;
    const again = await retrieve(deps, access(), "ECB가 왜 위험한가요?");
    expect(embedder.calls).toBe(calls);
    expect(again.embeddingTokens).toBe(0);
  });

  test("a question the notes cannot answer has no evidence", async () => {
    const db = seededDb();
    const res = await retrieve({ db }, access(), "양자역학의 불확정성 원리는?");
    expect(hasEvidence(res)).toBe(false);
  });

  test("works without vectors (BM25 only)", async () => {
    const db = seededDb();
    const res = await retrieve({ db }, access(), "출시일 확정");
    expect(res.usedVectors).toBe(false);
    expect(res.chunks[0]!.chunk.recordingId).toBe(REC.meeting);
  });
});
