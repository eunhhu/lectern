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

## Wiring (not done yet)

- **Harness**: wrap `runIndexStage` with `defineStage({ name: INDEX_STAGE.name, version: INDEX_STAGE.version, output: IndexStageOutput, key: (i) => indexStageKey(i, embedder), run: (i, ctx) => runIndexStage({ db, embedder, meter: ctx.meter }, i) })` and run it after `publish`.
- **API**: on `POST /ask/threads/{id}/turns`, resolve the scope with `resolveAccessScope` from the v2 `recording`/`folder`/`membership` rows, call `prepareAskTurn` (map `AskRequestError` to the JSON error), then open the SSE response and call `runAskTurn` with an `emit` that writes `event: <type>` / `data: <json>`. Do not abort the run when the client disconnects.
- **Deletes**: call `deleteRecordingIndex` and `deleteRecordingThreads` when a recording is deleted; `failStaleTurns` at boot.
- **Providers**: a Gemini `AskModel` (streaming, function calls) and a `gemini-embedding-2` `Embedder` (768 dims, query/document prefixes) next to the harness providers; `onModelCall` → `recordAiCall`.
