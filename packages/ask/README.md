# @lectern/ask

Search index, hybrid retrieval and "ask" (물어보기) over a workspace's notes. Design, numbers and decisions: [ADR-0009](../../docs/adr/0009-ask-rag.md), [ARCHITECTURE §12](../../docs/v2/ARCHITECTURE.md#12-검색물어보기), [AI_HARNESS §3.12, §12](../../docs/v2/AI_HARNESS.md#312-index--검색-색인).

Depends on `@lectern/domain`, `zod` and `bun:sqlite` only (`test/package.test.ts` enforces it). Providers, prices and the cost ledger are injected, so nothing here calls a model by itself. Tables come from `packages/db` migrations 0001 and 0002.

## Pieces

| File | What |
|---|---|
| `chunk.ts` | Transcript windows (with segment spans), document blocks, legacy Markdown, PDF pages; content-derived ids |
| `text.ts` | Korean bigram index tokens, query terms (particle stripping, stopwords), token estimate |
| `store.ts` | Diff sync of `search_chunk` + FTS rows, embeddings by content hash, index generation |
| `lexical.ts` | BM25 over the FTS index (ranking budget), in-code BM25 for scopes of ≤ 20 recordings |
| `vector.ts` | `Embedder`, `VectorIndex`, in-process int8 / binary-prefilter search, `FakeEmbedder` |
| `hybrid.ts` | RRF fusion, per-recording cap, evidence gate |
| `scope.ts` | Default-deny access scope (workspace, folder subtree, private recordings, roles) |
| `context.ts` | Full-note vs retrieval passages, prompt layout, history |
| `citations.ts` | Streaming marker filter, deterministic citation verification and narrowing |
| `threads.ts` | `ask_thread` / `ask_turn`, quota, answer cache |
| `runner.ts` | `prepareAskTurn` (HTTP errors before the stream) and `runAskTurn` (streams `AskStreamEvent`s) |
| `index-stage.ts` | The harness `index` stage: key parts and a metered run |

## Wiring

Done on branch `claude/ask-wiring` (with the API v2 stubs and the harness merged in):

- **Providers**: `GeminiAskModel` and `GeminiEmbedder` in `packages/harness/src/gemini-ask.ts`; prices in `packages/harness/pricing.json`.
- **Server**: `apps/server/src/ask/` builds the service from `LECTERN_ASK` (`service.ts`), runs the `index` stage as an `index` job (`index-job.ts`: `defineStage({ ..., memo: "job", run: (i, ctx) => runIndexStage({ db, embedder, meter: (m, c) => ctx.meter(m, c) }, i) })`), reconciles the index and fails stale turns with maintenance, and maps v1 lectures to notes until P2 (`legacy.ts`, ARCHITECTURE §12.4). `apps/server/src/api/v2/ask.ts` serves the routes: `prepareAskTurn` errors become JSON, then `runAskTurn` streams SSE and keeps running if the client leaves.
- **Deletes**: `db.ts` calls `deleteRecordingIndex` + `deleteRecordingThreads` in `deleteLectureById`, and `deleteWorkspaceAskData` in `deleteUserAndData`.

Still to do in P2: resolve scopes from the v2 `recording`/`folder`/`membership` rows instead of v1 lectures, index v2 transcripts and documents after `publish`, and drop the stub workspace alias.
