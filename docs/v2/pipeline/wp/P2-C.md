# P2-C 계약: 오디오 삭제, 문서 내보내기, 추천 질문 라우트

> 등급: `careful` · 게이트: `full` · 의존: `P1-C` · 소유: `packages/domain/`, `apps/server/`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

domain 라우트 표에 세 라우트를 추가하고(D-P2-4) `openapi.json`을 다시 만든다. 서버에는 세 라우트를 **501 스텁**으로만 등록한다. 구현은 P2-01이 한다. 기존 라우트의 OpenAPI는 한 글자도 바뀌지 않는다(추가만, D-0-5).

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` §0.1 D-0-5, §0.4(꺼진 기능은 501), §2 D-P2-4
- 레시피: `RECIPES.md` R2(domain 추가), R3 9~10번(501 스텁, `NOT_YET`)
- 코드:
  - `packages/domain/src/api/routes.ts` — `ROUTES`, `RouteDef`, 헬퍼 `json`, `noContent`, 상수 `WorkspaceQuery`
  - `packages/domain/src/api/resources.ts` — `RecordingParams`, `DocumentParams`, 기존 `named(...)` 사용법
  - `packages/domain/src/api/ask.ts` — `AskScope`(kind: recording/folder/workspace)
  - `packages/domain/src/openapi.ts` — `contentType`만 있고 `schema`가 없는 응답은 `binarySchema`로 나간다(그대로 쓴다)
  - `packages/domain/test/fixtures.ts` — `API_CASES`; `test/api.test.ts`는 응답·요청에 쓰인 모든 named 스키마가 `API_CASES`에 있어야 통과한다
  - `apps/server/src/api/v2/recordings.ts`, `documents.ts`, `ask.ts`(`createAskRouter`), `common.ts`(`notImplemented`)
  - `apps/server/test/api-v2.test.ts` — `NOT_YET`, `BODIES`, `PATH_PARAMS`, `requestFor`

## 3. 사전 점검

```bash
git grep -n "operationId: \"deleteRecording\"" -- packages/domain/src/api/routes.ts
git grep -n "operationId: \"getDocument\"" -- packages/domain/src/api/routes.ts
git grep -n "operationId: \"getAskUsage\"" -- packages/domain/src/api/routes.ts
git grep -n "export const AskScope\|export const AskUsage" -- packages/domain/src/api/ask.ts
git grep -n "export const RecordingParams\|export const DocumentParams" -- packages/domain/src/api/resources.ts
git grep -n "const NOT_YET" -- apps/server/test/api-v2.test.ts
git grep -n "export const notImplemented" -- apps/server/src/api/v2/common.ts
git grep -n "export function createAskRouter" -- apps/server/src/api/v2/ask.ts
```

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `packages/domain/src/api/ask.ts` | 수정 | `ListAskSuggestionsQuery`, `AskSuggestions` 추가 |
| `packages/domain/src/api/resources.ts` | 수정 | `ExportDocumentQuery` 추가 |
| `packages/domain/src/api/routes.ts` | 수정 | 라우트 3개 추가 |
| `packages/domain/test/fixtures.ts` | 수정 | `API_CASES.AskSuggestions` 추가 |
| `packages/domain/openapi.json` | 재생성 | `bun run domain:openapi` |
| `apps/server/src/api/v2/recordings.ts` | 수정 | `deleteRecordingAudio: notImplemented` |
| `apps/server/src/api/v2/documents.ts` | 수정 | `exportDocument: notImplemented` |
| `apps/server/src/api/v2/ask.ts` | 수정 | `listAskSuggestions: notImplemented` (항상 501) |
| `apps/server/src/api/v2/README.md` | 수정 | 상태 표에 세 줄(501, P2-01이 구현) |
| `apps/server/test/api-v2.test.ts` | 수정 | `NOT_YET`에 세 id 추가, 요청 샘플 추가 |
| `packages/domain/test/api.test.ts` | 수정(필요 시) | 라우트 수·목록을 세는 단언이 있으면 맞춘다 |

## 5. 단계

1. `ask.ts`(domain)에 추가한다. `WorkspaceId`는 이 파일에 이미 import돼 있다(없으면 `../primitives.ts`에서).
   ```ts
   export const ListAskSuggestionsQuery = z.object({
     workspace_id: WorkspaceId,
     scope_type: z.enum(["recording", "folder", "workspace"]),
     scope_id: z.string().min(1).max(64).optional().describe("Recording or folder id; omitted for `workspace`."),
   });
   export const AskSuggestions = named(
     "AskSuggestions",
     z.object({ suggestions: z.array(z.string().min(1).max(200)).max(6) }),
     "Suggested questions for a scope. Built by rules, no model call.",
   );
   export type AskSuggestions = z.infer<typeof AskSuggestions>;
   ```
2. `resources.ts`에 `export const ExportDocumentQuery = z.object({ format: z.literal("md") });` 추가(named 하지 않는다. 쿼리는 named가 아니다).
3. `routes.ts`의 `ROUTES`에 추가한다.
   - `recordings` 구역(`reprocessRecording` 뒤):
     ```ts
     { method: "delete", path: "/recordings/{recording_id}/audio", operationId: "deleteRecordingAudio",
       summary: "Delete the audio, keep the notes", tag: "recordings", params: R.RecordingParams,
       responses: { 204: noContent }, errors: [403, 404] },
     ```
   - `documents` 구역(`createDocumentVersion` 뒤):
     ```ts
     { method: "get", path: "/documents/{document_id}/export", operationId: "exportDocument",
       summary: "Download the current version as Markdown", tag: "documents", params: R.DocumentParams,
       query: R.ExportDocumentQuery,
       responses: { 200: { description: "A Markdown attachment.", contentType: "text/markdown" } },
       errors: [400, 403, 404] },
     ```
   - `ask` 구역(`getAskUsage` 뒤):
     ```ts
     { method: "get", path: "/ask/suggestions", operationId: "listAskSuggestions",
       summary: "Suggested questions for a scope", tag: "ask", query: A.ListAskSuggestionsQuery,
       responses: { 200: json(A.AskSuggestions, "Up to 6 questions.") }, errors: [400, 403, 404] },
     ```
4. `test/fixtures.ts`의 `API_CASES`에 `AskSuggestions` 항목을 `AskUsage` 항목처럼 추가한다. valid: `{ suggestions: [] }`, `{ suggestions: ["핵심 요약은?"] }`. invalid: `{ suggestions: [""] }`, `{ suggestions: ["a","b","c","d","e","f","g"] }`.
5. `bun run domain:openapi`를 돌려 `openapi.json`을 갱신한다. 손으로 고치지 않는다.
6. 서버 스텁. `recordings.ts`의 `recordingsRouter` 객체 맨 끝에 `deleteRecordingAudio: notImplemented,`, `documents.ts`의 `documentsRouter`에 `exportDocument: notImplemented,`, `ask.ts`의 `createAskRouter`가 돌려주는 `defineRouter({...})` 끝에 `listAskSuggestions: notImplemented,`. 세 파일 모두 `notImplemented`를 `./common.ts`에서 import한다(`ask.ts`는 이미 import함).
7. `api-v2.test.ts`: `NOT_YET`에 `"deleteRecordingAudio"`, `"exportDocument"`를 넣는다. `listAskSuggestions`는 `/ask` 경로라 "다른 라우트는 501이 아니다" 검사에서 이미 빠지므로 `NOT_YET`에 넣지 않는다. `requestFor`가 쿼리를 만드는 방식을 읽고(`PATH_PARAMS`처럼 표가 있으면) `format`, `scope_type`, `scope_id`에 유효한 값을 넣는다: `format: "md"`, `scope_type: "workspace"`.
8. `README.md`(v2) 상태 표에 세 라우트를 "501 (P2-01)"로 적는다.

## 6. 테스트

파일: `packages/domain/test/api.test.ts`, `packages/domain/test/openapi.test.ts`, `apps/server/test/api-v2.test.ts` (기존 파일에 케이스 추가)

| 테스트 이름 | 준비 | 기대 |
|---|---|---|
| domain: AskSuggestions fixtures | `API_CASES.AskSuggestions` | valid 2개 통과, invalid 2개 거절 |
| domain: 모든 응답 스키마가 API_CASES에 있음 | 기존 테스트 | 통과 (새 스키마가 빠지면 실패) |
| domain: openapi.json이 최신 | 기존 `openapi.test.ts` | `bun run domain:openapi` 뒤 통과 |
| domain: 새 라우트 경로·메서드 | `ROUTES_BY_OPERATION` | `deleteRecordingAudio` = delete `/recordings/{recording_id}/audio`, `exportDocument` = get `/documents/{document_id}/export`, `listAskSuggestions` = get `/ask/suggestions` |
| domain: 기존 라우트 불변 | 작업 전 `openapi.json`과 비교 | `git diff packages/domain/openapi.json`에 삭제 줄(`-`)이 없고 추가만 있다 |
| server: 501 스텁 두 개 | `api-v2.test.ts`의 "answer 501" 루프 | `deleteRecordingAudio`, `exportDocument` 모두 501, `error.code = "not_implemented"`, `details = { operation_id }` |
| server: 추천 질문 스텁 | `ownerAuth`로 `GET /api/v2/ask/suggestions?workspace_id=<유효 id>&scope_type=workspace` | 501 `not_implemented` (이 케이스는 `api-v2.test.ts`에 새 `test`로 추가) |

## 7. 검증 명령

```bash
bun run domain:openapi
bun test packages/domain apps/server/test/api-v2.test.ts apps/server/test/api-v2-access.test.ts
bun run typecheck
```
```bash
bash scripts/pipeline/gate.sh full
```

## 8. 하지 않는 것

- 세 라우트의 실제 동작 구현: P2-01.
- 웹 클라이언트 메서드: P2-06.
- 기존 필드·라우트 수정, `.default()`/`.transform()`/`.strict()` 사용(R2 "하지 말 것").

## 9. 끝났다는 기준

- [ ] 6절의 테스트가 모두 있고 통과한다
- [ ] 7절의 게이트가 통과한다
- [ ] 바뀐 파일이 전부 소유 경로 안이다
- [ ] 실제 외부 호출이 없다
- [ ] `openapi.json`이 `bun run domain:openapi`로 만든 것과 같고 기존 항목 삭제가 없다

## 10. 명세 작성자 메모

- `exportDocument`의 `format` 값은 계약에 `md`만 있다. 그래서 `z.literal("md")`로 했다. 다른 값은 400이다.
- `listAskSuggestions`는 `/ask` 경로라 서버 테스트의 "501이 아닌 라우트" 루프에서 제외된다. 따라서 `NOT_YET`에 넣지 않고 별도 테스트로 501을 확인한다. P2-01은 이 별도 테스트를 지우고 실제 동작 테스트로 바꾼다.
- `api-v2.test.ts`의 `requestFor`가 쿼리 샘플을 만드는 방식은 이 명세 작성 때 끝까지 읽지 않았다. 7단계에서 워커가 확인한다.
