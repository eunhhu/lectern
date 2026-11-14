// Search latency benchmark (P3-10, CONTRACTS D-P3-5). Indexes synthetic recordings into a
// throwaway SQLite file under the OS temp dir, then times searchIndex — the retrieval behind
// GET /search — over random 2–3 word queries. The embedder is the deterministic fake
// (FakeEmbedder, 768 dims): no network, no real data, never LECTERN_DATA_DIR.
//
//   bun scripts/bench/search.ts [--recordings 1000] [--queries 200] [--max-p95-ms 200] [--seed 1]
//
// stdout: one JSON line {recordings, chunks, queries, p50_ms, p95_ms, max_ms}.
// Exit 1 when --max-p95-ms is given and p95 is above it. Progress goes to stderr.

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type AccessScope,
  FakeEmbedder,
  QueryEmbeddingCache,
  runIndexStage,
  searchIndex,
  SqliteVectorIndex,
} from "../../packages/ask/src/index.ts";
import { runMigrations } from "../../packages/db/src/index.ts";
import { mulberry32, percentile, synthQuery, synthRecording } from "./synth.ts";

const WORKSPACE = "ws_bench";
const WARMUP = 20;
const DIM = 768;
const RECORDED_AT = "2026-01-05T01:00:00.000Z";

function intArg(value: string | undefined, name: string, fallback: number | undefined, min: number): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    process.stderr.write(`--${name} must be an integer >= ${min}\n`);
    process.exit(2);
  }
  return n;
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    recordings: { type: "string" },
    queries: { type: "string" },
    "max-p95-ms": { type: "string" },
    seed: { type: "string" },
  },
  strict: true,
});
const recordings = intArg(values.recordings, "recordings", 1000, 1)!;
const queries = intArg(values.queries, "queries", 200, 1)!;
const maxP95 = intArg(values["max-p95-ms"], "max-p95-ms", undefined, 0);
const seed = intArg(values.seed, "seed", 1, 0)!;

const dir = mkdtempSync(join(tmpdir(), "lectern-bench-"));
let exitCode = 0;
try {
  const db = new Database(join(dir, "bench.sqlite"), { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;`);
  runMigrations(db, { backupDir: join(dir, "backups") });

  const embedder = new FakeEmbedder(DIM);
  const rand = mulberry32(seed);
  const titles = new Map<string, { title: string; recordedAt: string }>();
  let chunks = 0;
  for (let i = 0; i < recordings; i++) {
    const rec = synthRecording(i, rand);
    titles.set(rec.id, { title: rec.title, recordedAt: RECORDED_AT });
    const out = await runIndexStage(
      { db, embedder },
      {
        workspaceId: WORKSPACE,
        recordingId: rec.id,
        transcript: { segments: rec.segments.map((s) => ({ idx: s.idx, start_ms: s.start_ms, end_ms: s.end_ms, speaker_id: s.speaker, text: s.text })) },
      },
    );
    chunks += out.chunks;
    if ((i + 1) % 100 === 0 || i + 1 === recordings) process.stderr.write(`indexed ${i + 1}/${recordings} recordings, ${chunks} chunks\n`);
  }

  const access: AccessScope = {
    workspaceId: WORKSPACE,
    scope: { kind: "workspace" },
    recordingIds: [...titles.keys()].sort(),
    recordings: titles,
  };
  // The same dependencies GET /search gets from the ask service.
  const deps = { db, embedder, vectorIndex: new SqliteVectorIndex(db, embedder.model, DIM), queryCache: new QueryEmbeddingCache() };

  const timings: number[] = [];
  for (let i = 0; i < WARMUP + queries; i++) {
    const q = synthQuery(rand);
    const t0 = performance.now();
    await searchIndex(deps, access, q);
    const ms = performance.now() - t0;
    if (i >= WARMUP) timings.push(ms);
  }
  db.close();

  timings.sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  const p95 = percentile(timings, 95);
  const result = { recordings, chunks, queries, p50_ms: round(percentile(timings, 50)), p95_ms: round(p95), max_ms: round(timings[timings.length - 1]!) };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  // Compared unrounded, so a sub-0.01 ms p95 still fails a 0 ms limit.
  if (maxP95 !== undefined && p95 > maxP95) {
    process.stderr.write(`p95 ${result.p95_ms}ms exceeds ${maxP95}ms\n`);
    exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
