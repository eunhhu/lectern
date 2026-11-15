# Lectern 작업 레시피 (R1~R17)

이 저장소의 기존 관례를 그대로 따라 기능을 더하기 위한 단계별 안내서다. 모든 경로와 심볼은 코드를 직접 읽고 확인했다. 줄 번호는 적지 않는다(밀린다). 확인하지 못한 것은 "확인 필요"로 표시했다.

공통 규칙 (AGENTS.md):
- `main`에 직접 푸시하지 않는다. 브랜치 → PR → CI.
- 시크릿과 실제 개인 정보를 커밋하지 않는다. 운영 경로(`/home/eunhhu/...`)를 새 코드에 쓰지 않는다.
- 문서와 사용자에게 보이는 문구는 한국어, 식별자와 코드 주석은 영어.
- 테스트에서 실제 Gemini/Resend를 호출하지 않는다. 운영 코드에 테스트 전용 분기를 넣지 않는다.
- 끝나면 `bun run typecheck`와 `bun test`가 통과해야 한다. 큰 작업은 `bash scripts/pipeline/gate.sh full`.

---

## R1. DB 테이블·컬럼 추가
**언제**: v2 테이블이나 컬럼을 새로 만들 때.
**읽을 파일**:
- `packages/db/src/schema.ts` — `tag`, `folder` (workspace 소속 테이블의 본보기), `job`
- `packages/db/drizzle.config.ts` — dialect sqlite, schema `./src/schema.ts`, out `./migrations`
- `packages/db/src/index.ts` — `runMigrations`, `pendingMigrations`, `MIGRATIONS_DIR`
- `packages/db/test/migrate.test.ts` — "a fresh database gets every v2 table" 테스트
- `packages/db/migrations/meta/_journal.json`

**순서**:
1. `schema.ts`에 `sqliteTable(...)`을 추가한다. 시간은 정수 밀리초(`integer("created_at").notNull()`), id는 `text("id").primaryKey()`. 워크스페이스 소속이면 `workspaceId: text("workspace_id").notNull()`. 인덱스는 세 번째 인자 콜백에서 `index("idx_<table>_<what>").on(...)`.
2. 기존 테이블에 컬럼을 더할 때는 nullable이거나 `.default(...)`가 있어야 한다(additive).
3. `bun run --cwd packages/db generate --name <snake_name>` 을 실행한다. 새 파일은 `packages/db/migrations/0004_<snake_name>.sql`, `migrations/meta/0004_snapshot.json`, `_journal.json`의 새 entry(`tag: "0004_<snake_name>"`)로 생긴다. `--name`을 안 주면 drizzle이 무작위 이름을 붙인다(확인 필요: `--name` 플래그 동작은 직접 실행해 보지 않음. 이름이 마음에 안 들면 세 파일의 이름과 journal `tag`를 함께 고친다).
4. 생성된 SQL을 읽고 `DROP`/`ALTER ... RENAME`이 없는지 확인한다.
5. `packages/db/test/migrate.test.ts`의 `expect(res.applied).toEqual([...])` 목록 끝에 새 태그를 넣고, 새 테이블 이름을 `tables` 검사 목록에 넣는다.
6. 서버에서 쓸 테이블이면 `packages/domain`의 entity도 만든다(R2).

**뼈대**:
```ts
// packages/db/src/schema.ts
export const note = sqliteTable(
  "note",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_note_workspace").on(t.workspaceId)]
);
```
**검증**:
```bash
bun test packages/db
bun run typecheck
```
**하지 말 것**:
- 컬럼 삭제·이름 변경·타입 변경. 옛 코드로 롤백이 불가능해진다. 추가 → 이행 → 나중에 제거의 두 단계로 나눈다.
- 생성된 `.sql`, snapshot, `_journal.json`을 손으로 고치거나 일부만 커밋하기. `_journal.json`의 `when`은 앞 entry보다 커야 한다(`pendingMigrations`가 `when`을 마지막 적용 시각과 비교한다).
- v1 테이블(`users`, `sessions`, `lectures`...)을 `schema.ts`에 선언하기. v1은 `apps/server/src/db.ts`의 부트스트랩이 만든다. v1 변경은 `drizzle-kit generate --custom`으로 손으로 쓴 마이그레이션이다.
- 부팅 때 `runMigrations`가 자동 적용하고 직전에 `pre-migrate-*.sqlite` 백업을 남긴다. 직접 적용 코드를 만들지 않는다.

---

## R2. domain 스키마·라우트 추가
**언제**: API 엔드포인트, DTO, 엔티티, enum 값을 추가할 때. `packages/domain`은 P0 이후 동결이며 additive만 허용된다.
**읽을 파일**:
- `packages/domain/README.md` — Freeze rule, Conventions
- `packages/domain/src/entities.ts` — `Tag`, `ENTITY_SCHEMAS`, `WORKSPACE_SCOPE_EXCEPTIONS`
- `packages/domain/src/api/resources.ts` — `TagParams`, `TagPage`, `CreateTagRequest`, `UpdateTagRequest`
- `packages/domain/src/api/routes.ts` — `RouteDef`, `ROUTES`, 헬퍼 `json`, `noContent`
- `packages/domain/src/registry.ts` — `named`
- `packages/domain/src/primitives.ts` — `idSchema`로 만든 `TagId` 등
- `packages/domain/src/api/common.ts` — `pageOf`, `PageQuery`, `WorkspaceScopedPageQuery`, `ErrorCode`

**순서**:
1. 새 id가 필요하면 `primitives.ts`에 `export const NoteId = idSchema("NoteId", "note");` + `export type NoteId = z.infer<typeof NoteId>;`.
2. 엔티티는 `entities.ts`에 `named("Note", z.object({...}))`로 쓰고 `ENTITY_SCHEMAS`에 `note: Note`를 넣는다. 시간은 `Timestamp`(ISO, `Z`), 모든 엔티티에 `workspace_id`.
3. 요청/응답은 `api/resources.ts`에 `named("CreateNoteRequest", z.object(...))`, 목록은 `pageOf("NotePage", Note)`, 경로 파라미터는 `z.object({ note_id: NoteId })`(이건 `named` 하지 않는다).
4. `api/routes.ts`의 `ROUTES` 배열에 `RouteDef`를 추가한다.
5. 새 named 스키마마다 `packages/domain/test/fixtures.ts`에 케이스를 넣는다: 요청·응답 DTO는 `API_CASES`(`{ schema, valid: [...], invalid: [...] }`, 키는 named id와 같아야 한다), 엔티티는 `ENTITY_FIXTURES`와 `ENTITY_INVALID`.
6. 엔티티를 더했다면 `packages/domain/test/entities.test.ts`의 `EXPECTED_ENTITIES`에 이름을 넣는다. 새 리소스 패밀리면 `api.test.ts`의 "every resource family" 목록에 경로 prefix를 넣는다.
7. `bun run domain:openapi`로 `packages/domain/openapi.json`을 다시 만들고 같은 커밋에 넣는다.

**뼈대**:
```ts
// api/routes.ts — inside ROUTES
{
  method: "post",
  path: "/notes",
  operationId: "createNote",
  summary: "Create a note",
  tag: "notes",
  body: { schema: R.CreateNoteRequest },
  responses: { 201: json(Note, "The new note.") },
  errors: [400, 403, 409],
},
```
`RouteDef` 필드: `method`, `path`(`{param}` 문법), `operationId`, `summary`, `tag`, 선택 `params`/`query`/`headers`/`body`/`errors`/`public`, 필수 `responses`(상태 코드 → `RouteResponse`).
**검증**:
```bash
bun run domain:openapi
bun test packages/domain
bun run typecheck
```
**하지 말 것**:
- `.default()`, `.transform()`, `.strict()` 사용 금지(README Rules).
- 필드·엔드포인트·enum 값 삭제/이름 변경, 필수 요청 필드 추가, 타입 변경. 필요하면 `docs/adr/`에 ADR이 먼저다.
- `openapi.json`을 손으로 고치기. 오래되면 `openapi.test.ts`가 실패한다.
- 응답 스키마를 `named` 하지 않고 쓰기(`openapi.ts`가 컴포넌트 이름이 필요하다).
- `packages/domain`에서 다른 워크스페이스 패키지나 Bun/Node API를 import하기(`package.test.ts`가 막는다). 의존성은 zod뿐.
- 다른 작업 흐름이 소유한 중에 이 패키지를 고치기(AGENTS.md 규칙 3).

---

## R3. API v2 라우터 구현
**언제**: `/api/v2` 엔드포인트의 서버 구현을 쓸 때(RouteDef는 R2에서 이미 있어야 한다).
**읽을 파일**:
- `apps/server/src/api/v2/tags.ts` — 작은 완성 예(`tagsRouter`)
- `apps/server/src/api/v2/integrations.ts`, `share-links.ts` — `notImplemented` 예
- `apps/server/src/api/v2/common.ts` — `defineRouter`, `ok`, `okPage`, `apiError`, `notFound`, `forbidden`, `notImplemented`, `page`, `pageBounds`, `pageFrom`
- `apps/server/src/api/v2/access.ts` — `can`, `requireWorkspace`, `loadRecording`, `callerIn`, `roleIn`, `Action`
- `apps/server/src/api/v2/rows.ts` — `tagDto`, `TagRow`, `iso` (DB 행 → 응답 DTO)
- `apps/server/src/api/v2/store.ts` — `transact`, `nameKey`, `uuidv7`, 공용 조회
- `apps/server/src/api/v2/index.ts` — `RESOURCE_ROUTERS`, `createApiV2App`
- `apps/server/src/api/v2/README.md` — 엔드포인트 상태 표
- 테스트: `apps/server/test/api-v2-data.test.ts`, `api-v2-access.test.ts`, `api-v2.test.ts`

**순서**:
1. `apps/server/src/api/v2/<resource>.ts`를 만들고 `export const <resource>Router = defineRouter({ <operationId>: (req) => ... })`. 키는 RouteDef의 `operationId`여야 한다(없으면 `defineRouter`가 throw).
2. `rows.ts`에 `NoteRow`(DB 컬럼 그대로, snake_case)와 `noteDto(row)`를 추가한다(`created_at: iso(row.created_at)`).
3. 핸들러는 이미 인증(401)과 검증(400)을 통과한 `req`를 받는다. `req.params`, `req.query`, `req.body`는 파싱된 값이다(타입은 `as`로 단언). `req.user!`는 로그인한 사용자.
4. 워크스페이스 권한: `const caller = requireWorkspace(req, workspace_id, "tag:write"); if (caller instanceof Response) return caller;` 새 행동이 필요하면 `access.ts`의 `Action` 유니온과 `can()`의 switch에 추가하고 `api-v2-access.test.ts`의 표를 갱신한다. 비멤버는 403, 존재를 숨겨야 하는 객체는 `notFound`(404).
5. DB는 `import { db } from "../../db.ts"`로 `db.query(sql).get/all/run`. 여러 쓰기는 `transact(() => {...})`. 새 id는 `uuidv7()`.
6. 응답은 `ok(req, dto)` / `ok(req, dto, { status: 201 })` / `okPage(req, items)`(응답 스키마로 `parse`된다) / 삭제는 `req.c.body(null, 204)`.
7. 오류는 `return apiError(req.c, 409, "conflict", "한국어 메시지")` (코드는 domain `ErrorCode`). 던지지 말고 반환한다.
8. `index.ts`의 import와 `RESOURCE_ROUTERS` 배열에 라우터를 추가한다.
9. 아직 못 만드는 라우트는 `notImplemented`를 값으로 둔다(501 `not_implemented`).
10. `api/v2/README.md` 표를 고친다. `api-v2.test.ts`의 `NOT_YET` 집합(501 목록)은 501 라우트를 구현하면 해당 operationId를 지운다.
11. 테스트를 쓴다(아래 뼈대).

**뼈대**:
```ts
// apps/server/src/api/v2/notes.ts
import { db } from "../../db.ts";
import { requireWorkspace } from "./access.ts";
import { apiError, defineRouter, ok, okPage } from "./common.ts";
import { noteDto, type NoteRow } from "./rows.ts";
import { transact, uuidv7 } from "./store.ts";

export const notesRouter = defineRouter({
  listNotes: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const rows = db.query(`SELECT * FROM note WHERE workspace_id = ? ORDER BY title, id`).all(workspace_id) as NoteRow[];
    return okPage(req, rows.map(noteDto));
  },
  createNote: (req) => {
    const body = req.body as { workspace_id: string; title: string };
    const caller = requireWorkspace(req, body.workspace_id, "tag:write");
    if (caller instanceof Response) return caller;
    const title = body.title.trim();
    if (!title) return apiError(req.c, 400, "bad_request", "제목을 입력하세요.");
    const id = uuidv7();
    const now = Date.now();
    transact(() =>
      db.query(`INSERT INTO note (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, body.workspace_id, title, now, now)
    );
    return ok(req, noteDto(db.query(`SELECT * FROM note WHERE id = ?`).get(id) as NoteRow), { status: 201 });
  },
});
```
테스트 뼈대(`apps/server/test/api-v2-notes.test.ts`):
```ts
import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { createUser, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

async function api(method: string, path: string, user: UserRecord, body?: unknown) {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  );
  const isJson = (res.headers.get("content-type") || "").startsWith("application/json");
  return { status: res.status, body: isJson ? await res.json() : null };
}

let alice: UserRecord;
let ws: string;
beforeAll(() => {
  alice = createUser({ email: `${generateId("alice")}@example.com`, displayName: "alice", password: "correct_password_1" });
  ws = personalWorkspaceId(alice.id);
});
test("create then list", async () => {
  expect((await api("POST", "/notes", alice, { workspace_id: ws, title: "t" })).status).toBe(201);
  expect((await api("GET", `/notes?workspace_id=${ws}`, alice)).body.items.length).toBe(1);
});
```
**검증**:
```bash
bun test apps/server/test/api-v2-notes.test.ts
bun test apps/server/test/api-v2.test.ts apps/server/test/api-v2-access.test.ts
bun run typecheck
```
**하지 말 것**:
- 라우트의 method/path를 서버 코드에 다시 적기(RouteDef에서 온다).
- 핸들러 안에서 `authenticateRequest`를 다시 호출하거나 직접 권한 `if` 쓰기. `requireWorkspace`/`loadRecording`/`can()`을 쓴다.
- 응답 객체를 `c.json(...)`으로 직접 보내기(스키마 검증을 건너뛴다). `ok`를 쓴다.
- 보이지 않는 녹음에 403 주기(404여야 한다).
- 사용자 값을 SQL 문자열에 이어 붙이기. `?` 바인딩만.
- `http.ts`에 라우트 붙이기. 새 v2 라우터는 `api/v2/index.ts`의 `RESOURCE_ROUTERS`에만 등록한다.

---

## R4. 환경 변수·기능 플래그 추가
**언제**: 새 설정값, 기능 플래그, 시크릿을 추가할 때.
**읽을 파일**:
- `packages/config/src/index.ts` — `ENV` 객체, `bool`, `int`, `optionalString`, `Config` 인터페이스, `loadConfig`, `readSecret`, `describeEnv`, `config()`, `resetConfigForTests`
- 불리언 예 `LECTERN_ASK`, enum 예 `LECTERN_TRANSCRIPT_ENGINE`(`z.enum(["off","shadow","on"]).default("off")`), 정수 예 `LECTERN_ASK_MONTHLY_LIMIT_MICROUSD`, 시크릿 예 `GEMINI_API_KEY`
- `packages/config/scripts/write-env-docs.ts`, `docs/env.md`
- `deploy/systemd/lectern.env.example`
- `packages/config/test/config.test.ts`
- `docs/v2/pipeline/flags-on.env`

**순서**:
1. `ENV`에 항목을 추가한다: `LECTERN_X: { schema: bool(false), description: "..." }`. 시크릿이면 `secret: true`와 `schema: optionalString`.
2. 시크릿은 `Config`에 넣지 않는다(고정되지 않게). `readSecret`의 `name` 유니온에 이름을 추가하고, 쓰는 곳에서 `readSecret("NAME")`을 매번 호출한다.
3. 비시크릿은 `Config` 인터페이스에 필드를 추가하고 `loadConfig`의 반환 객체에 `p.LECTERN_X`를 연결한다. 코드에서는 `config().x`.
4. `bun run config:docs` → `docs/env.md`가 다시 만들어진다.
5. `deploy/systemd/lectern.env.example`에 주석 설명과 기본값 줄을 추가한다(시크릿은 값 없이 주석).
6. `packages/config/test/config.test.ts`에 기본값 검사(`loadConfig({})`)와 값 변환 검사를 추가한다. 시크릿이면 "without echoing secrets" 테스트처럼 `raw`에 값이 안 나오는지 확인한다.
7. 기능 플래그면 `docs/v2/pipeline/flags-on.env`에 `NAME=value`를 추가한다(게이트의 "flags on" preflight용).

**뼈대**:
```ts
// packages/config/src/index.ts, inside ENV
LECTERN_NOTES: {
  schema: bool(false),
  description: "1: turn on /api/v2/notes. 0: the routes answer 501",
},
// Config: notes: boolean;   loadConfig(): notes: p.LECTERN_NOTES,
```
**검증**:
```bash
bun run config:docs
bun test packages/config
bun run typecheck
```
**하지 말 것**:
- `process.env.X`를 앱 코드에서 직접 읽기(예외: 이미 그렇게 쓰는 기존 코드). `config()`/`readSecret`을 쓴다.
- `docs/env.md`를 손으로 고치기(`docs/env.md is up to date` 테스트가 실패한다).
- 시크릿을 `Config`나 로그, `raw`에 넣기.
- 테스트에서 `process.env`를 바꾸고 `resetConfigForTests()`를 안 부르기. 끝나면 `delete process.env.X` 후 reset.
- 기본값이 켜짐인 새 플래그 만들기. 새 기능은 꺼짐이 기본이다.

---

## R5. 작업 종류(job kind) 추가
**언제**: 백그라운드로 도는 새 종류의 작업(큐 잡)이 필요할 때.
**읽을 파일**:
- `apps/server/src/queue.ts` — `enqueueJob`, `registerJobHandler`, `JobOutcome`(`ok`, `error`, `result`, `followUp`), `LeasedJob`, `JobWorker`, `reclaimExpiredLeases`, `isLectureBusy`, `waitForJob`
- `apps/server/src/job-handlers.ts` — `registerJobHandler("compact", ...)`, `registerTranscriptJobHandler`
- `apps/server/src/transcript-job.ts` — 하네스 기반 잡의 본보기(`runTranscriptJob`, `enqueueTranscriptAfterDistill`, `TRANSCRIBE_JOB_KIND`, `defaultTranscriptHarness`)
- `apps/worker/src/index.ts` — 외부 워커(`job-handlers.ts`를 import해서 핸들러가 등록된다)
- 테스트: `apps/server/test/transcript-job.test.ts`, `apps/server/test/worker.test.ts`, 픽스처 `apps/server/test/fixtures/transcript-worker.ts`

**순서**:
1. `apps/server/src/<name>-job.ts`를 만든다. 상수 `export const X_JOB_KIND = "x"`, 실행 함수 `runXJob(job: LeasedJob, deps = {}): Promise<JobOutcome>`. `queue.ts`나 이 파일은 `index.ts`를 import하면 안 된다(워커가 import한다).
2. 핸들러는 `{ ok: true, result: {...} }` 또는 `{ ok: false, error: "한국어 메시지" }`를 반환한다. 결과에는 개수·참조만 넣고 사용자 텍스트는 넣지 않는다. 같은 대상에 후속 잡을 걸려면 `followUp: () => ...`(잡 행이 끝난 뒤 실행된다).
3. `job-handlers.ts`에서 등록한다: `registerJobHandler(KIND, run, { concurrency, onLost })`. `concurrency`는 종류별·프로세스별 동시 수(무거운 작업은 1). `onLost`는 lease가 `max_attempts`번 끊긴 뒤 정리용.
4. 생산자: `enqueueJob({ kind, ownerId, subjectId, payload?, secret?, budgetMicrousd? })` → `{ jobId, deduplicated, position }`. 같은 `kind:subjectId`의 미완료 잡이 있으면 `deduplicated: true`로 기존 잡 id가 온다(idempotency_key 유니크 인덱스).
5. 재시도 의미: `job.attempts`는 "중단" 횟수만 센다(워커 크래시, SIGKILL). 일시적 오류 재시도는 핸들러/하네스 안에서 한다.
6. 하네스를 쓰면 `Harness`를 `{ db, blobDir: HARNESS_BLOB_DIR, logger }`로 만들고 `harness.job({ jobId: job.id, scope: workspaceId, workspaceId, signal, onEvent })`를 받아 단계를 실행한다(R6). 같은 잡 id로 다시 돌면 끝난 단계는 재사용된다(재개).
7. 외부 비용이 드는 잡은 `budgetMicrousd`를 주고, 켜기 전 조건(플래그, 키, ffmpeg)을 `enqueue...` 함수에서 확인하고 `null`을 반환한다.
8. 테스트: 함수 직접 호출형은 `transcript-job.test.ts`의 `directJob(...)`(running 상태 잡 행을 직접 INSERT)을 본뜬다. 크래시·재개 테스트는 `fixtures/transcript-worker.ts`처럼 실제 워커를 `Bun.spawn`하고(`LECTERN_WORKER_MODE=external`, `LECTERN_JOB_LEASE_TTL_MS=1500`, `LECTERN_JOB_POLL_MS=100`), 가짜 공급자가 N번째 호출에서 `process.kill(process.pid, "SIGKILL")` 하게 한 뒤, 두 번째 워커를 띄워 같은 잡 id가 `attempts == 1`로 끝나고 `resumed_stages`가 기대값이고 공급자 호출이 "청크 수 + 1"인지 확인한다. 임베디드 워커가 잡을 가로채지 않도록 `beforeAll`에서 `process.env.LECTERN_WORKER_MODE = "external"; resetConfigForTests(); await embeddedWorker()?.drain(10_000)`를 하고 `afterAll`에서 되돌린다.

**뼈대**:
```ts
// apps/server/src/x-job.ts
import { logger } from "./log.ts";
import { enqueueJob, type JobOutcome, type LeasedJob } from "./queue.ts";

export const X_JOB_KIND = "x";

export function enqueueX(ownerId: string, subjectId: string): string {
  return enqueueJob({ kind: X_JOB_KIND, ownerId, subjectId }).jobId;
}

export async function runXJob(job: LeasedJob): Promise<JobOutcome> {
  try {
    // ... do the work for job.subjectId
    return { ok: true, result: { done: true } };
  } catch (err: any) {
    logger.warn("x job failed", { job_id: job.id, error: err?.message || String(err) });
    return { ok: false, error: err?.message || String(err) };
  }
}
// job-handlers.ts: registerJobHandler(X_JOB_KIND, runXJob, { concurrency: 1 });
```
**검증**:
```bash
bun test apps/server/test/x-job.test.ts apps/server/test/worker.test.ts
bun run typecheck
```
**하지 말 것**:
- 핸들러 등록을 `index.ts`에 하기(워커 프로세스가 못 본다). `job-handlers.ts`에 한다.
- 잡 `payload`나 `result`, 로그에 시크릿·전사 본문 넣기. 시크릿은 `enqueueJob({ secret })`(AES-GCM 봉인)로만.
- 핸들러에서 같은 대상의 다른 종류 잡이 돌고 있는지 확인하지 않고 파일을 바꾸기(`isLectureBusy(id, kind)` 참고).
- 테스트에서 실제 Gemini 호출. 가짜 공급자(R6, R12)를 주입한다.

---

## R6. 하네스 단계 추가
**언제**: 하네스 파이프라인에 새 stage(모델 호출 또는 오디오 처리)를 넣을 때.
**읽을 파일**:
- `packages/harness/src/stage.ts` — `defineStage`, `StageDefinition`, `StageKeyParts`, `StageContext`, `RetryPolicy`, `stageKey`
- `packages/harness/src/runner.ts` — `Harness`, `JobRun`, `StageResult`, `StageEvent`
- `packages/harness/src/transcript/stages.ts` — `ingestStage`, `transcribeStage(provider)`, `mergeStage`, `classifyMediaError`
- `packages/harness/src/transcript/pipeline.ts` — `runTranscriptPipeline`(단계를 이어 붙이는 곳)
- `packages/harness/src/errors.ts` — `HarnessError`, `classifyError`, `classifyHttpStatus`
- `packages/harness/src/providers.ts` — `TranscriptionProvider`, `ProviderCallResult`, `Usage`
- 테스트: `packages/harness/test/helpers.ts`(`testEnv`), `runner.test.ts`, `transcribe.test.ts`, `eval/scripted.ts`의 `ScriptedTranscriptionProvider`

**순서**:
1. 출력 zod 스키마를 정한다(필요하면 `transcript/schemas.ts`).
2. `defineStage({ name, version, output, key, run, memo?, retry?, classify? })`로 정의한다. `name`은 `^[a-z][a-z0-9_]{0,63}$`, `version`은 양의 정수(같은 입력에 출력이 달라지면 올린다). 도메인 `StageName` enum에 이름이 필요하면 R2로 추가한다.
3. `key(input)`는 메모 키 재료를 돌려준다: `inputs`(입력 sha256들), `prompt`(프롬프트 해시), `provider`, `model`, `params`, `config`. 시크릿은 넣지 않는다.
4. `run(input, ctx)`에서 모델 호출은 반드시 `await ctx.meter({ provider: p.id, model: p.model }, () => provider.call(...))`로 감싼다(비용 장부 `ai_call`에 기록). 추가 산출물은 `await ctx.putArtifact(kind, data)` / `ctx.putArtifactFile(kind, path)`로 저장하고 다음 단계에 sha256로 넘긴다. 취소 신호는 `ctx.signal`, 수리 재시도 정보는 `ctx.repair`.
5. 사용 불가 응답은 `throw new HarnessError("output_validation", msg, { code, billed })`. 종류: `transient`(백오프 재시도), `input`(즉시 실패, 사용자 탓), `output_validation`(수리 1회), `config`(관리자 문제), `budget`, `canceled`. 요금이 청구된 응답이면 `billed`에 `ProviderCallResult`를 실어 장부에 남긴다.
6. 실행: **`JobRun.run<I, O>(stage: StageDefinition<I, O>, input: I, options: { chunkIndex?: number } = {}): Promise<StageResult<O>>`**. 반환값은 `{ value, stageRunId, cacheHit, resumed, output }`. 청크별 단계는 `{ chunkIndex }`를 준다.
7. 단계를 파이프라인에 넣으려면 `transcript/pipeline.ts`의 `runTranscriptPipeline`에 `await run.run(newStage, input)` 호출을 추가하거나, 별도 파이프라인 함수를 만든다. `packages/harness/src/index.ts`가 새 파일을 `export *` 하는지 확인한다.
8. 테스트(`packages/harness/test/<name>.test.ts`): `testEnv()`(마이그레이션된 임시 SQLite + blob 디렉터리)로 `env.harness()`(sleep이 즉시 반환)를 만들고 `env.job("job-1")`로 잡 행을 만든 뒤 `harness.job({ jobId, scope: "ws" }).run(stage, input)`. `afterEach`에서 `env.close()`. 공급자는 `ScriptedTranscriptionProvider`나 직접 만든 가짜 객체. 확인 항목: 같은 키 두 번째 실행은 `cacheHit`/`resumed`, 버전 올리면 재실행, `rows(env.db, "SELECT ... FROM stage_run")`, 장부 `ai_call`.

**뼈대**:
```ts
import { z } from "zod";
import { HarnessError } from "../errors.ts";
import { sha256Hex } from "../hash.ts";
import { defineStage } from "../stage.ts";

export const summarizeStage = (provider: SummaryProvider) =>
  defineStage({
    name: "summarize",
    version: 1,
    output: z.object({ summary: z.string() }),
    memo: "shared",
    retry: { maxAttempts: 3, repairs: 1 },
    key: (input: { text: string }) => ({
      inputs: [sha256Hex(input.text)],
      prompt: provider.fingerprint.prompt,
      provider: provider.id,
      model: provider.model,
    }),
    async run(input, ctx) {
      const answer = await ctx.meter({ provider: provider.id, model: provider.model }, () =>
        provider.summarize(input.text, { signal: ctx.signal, repair: ctx.repair })
      );
      if (!answer.summary) throw new HarnessError("output_validation", "empty summary", { code: "empty", billed: answer });
      return { summary: answer.summary };
    },
  });
```
**검증**:
```bash
bun test packages/harness
bun run typecheck
```
**하지 말 것**:
- `ctx.meter` 없이 모델 호출하기(비용이 장부에 안 남고 예산이 안 걸린다).
- 같은 입력에 출력이 달라지게 바꾸고 `version`을 안 올리기(옛 결과가 재사용된다).
- 키에 API 키·현재 시각·무작위 값 넣기.
- 스크래치 파일 경로를 다음 단계에 넘기기. blob(`putArtifactFile`)의 sha256로 넘긴다(재개 시 스크래치가 없다).
- 단계 안에서 `HarnessError` 대신 문자열을 throw하기. 분류가 `transient`로 떨어져 불필요한 재시도가 난다.
- 테스트에서 실제 `fetch`/ffmpeg 의존이 필요하면 ffmpeg 없는 환경에서 실패하지 않게 `isFfmpegAvailable()`로 건너뛴다(`@lectern/media`).

---

## R7. Gemini 호출 어댑터 추가
**언제**: Gemini REST를 부르는 새 어댑터(요약, 추출 등)를 만들 때.
**읽을 파일**:
- `packages/harness/src/gemini-http.ts` — `GEMINI_API_BASE`, `GeminiAdapterOptions`(`apiKey: () => string | undefined`, `fetch?`, `baseUrl?`, `timeoutMs?`), `geminiKeyOrThrow`, `geminiHttpError`, `withDeadline`
- `packages/harness/src/gemini.ts` — `classifyGeminiError`, `normalizeGeminiUsage`, `GEMINI_PROVIDER_ID`
- `packages/harness/src/gemini-transcribe.ts` — `GeminiTranscriptionProvider`, `GEMINI_TRANSCRIBE_SCHEMA`, `requestBody`, `TRANSCRIBE_MODEL`
- `packages/harness/src/gemini-ask.ts` — `toGeminiSchema`(zod JSON Schema → Gemini 부분집합), `askRequestBody`, `GeminiAskModel`, `GeminiEmbedder`, `ASK_ANSWER_MODEL`
- `packages/core/src/gemini.ts` — `resolveGeminiModel`, `DEFAULT_GEMINI_MODEL`
- `packages/harness/pricing.json`, `packages/harness/src/ledger.ts` — `DEFAULT_PRICING`, `priceFor`, `costMicrousd`
- 테스트: `packages/harness/test/transcribe.test.ts`(`fakeFetch`), `gemini-ask.test.ts`

**순서**:
1. `GeminiAdapterOptions`를 확장한 옵션과 클래스를 만든다. 모델 id는 버전 고정(`gemini-3.8-flash`). `-latest` 금지. 요청 모델은 `resolveGeminiModel(opts.model ?? PINNED)`로 허용 목록을 거친다.
2. 요청: `POST ${baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, 헤더 `{ "Content-Type": "application/json", "x-goog-api-key": key }`(키는 URL 금지), `signal: withDeadline(opts.signal, timeoutMs)`, `fetch`는 `this.opts.fetch ?? fetch`.
3. 본문: `contents: [{ role: "user", parts: [...] }]`, `generationConfig: { responseMimeType: "application/json", responseSchema, thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens }`. 온도는 기본값 그대로 둔다(낮추면 반복 루프 위험, 주석 참조).
4. `responseSchema`: 전사처럼 손으로 쓴 상수(`type: "OBJECT"`, 대문자 타입, `propertyOrdering`, `required`)를 `Object.freeze`로 두거나, zod 스키마라면 `toGeminiSchema(z.toJSONSchema(schema))`로 변환한다. 이 스키마의 해시(`sha256Hex(canonicalJson(schema))`)를 `fingerprint.params`에 넣어 메모 키에 반영한다.
5. 응답 처리 순서: `!res.ok` → `throw await geminiHttpError(res)`; `promptFeedback.blockReason`, `finishReason === "MAX_TOKENS"`/그 외 → `HarnessError("output_validation", ..., { code, billed })`; `thought: true` 파트는 제외하고 텍스트를 합쳐 비면 `empty_response`; `JSON.parse` 실패 `malformed_json`; zod `safeParse` 실패 `schema`.
6. 사용량은 `normalizeGeminiUsage(data.usageMetadata, audioSeconds?)`로 `Usage`를 만들어 `{ usage, model: data.modelVersion, requestId: data.responseId, latencyMs }`(`ProviderCallResult`)와 함께 반환한다.
7. 새 모델이면 `packages/harness/pricing.json`의 `models`에 `{ provider, model, from, input, cached_input, output }`(USD/1M 토큰)을 추가하고 `as_of`를 갱신한다. 목록에 없으면 비용을 못 구한다.
8. 프롬프트 파일은 `packages/harness/prompts/*.md`에 두고 내용 해시를 `fingerprint.prompt`에 넣는다.
9. 테스트: `fakeFetch(responses, seen)`을 만들어 `fetch` 옵션으로 주입한다. 아래 뼈대. 실제 네트워크 호출은 절대 하지 않는다.

**뼈대**:
```ts
// test: a fake at the fetch boundary
function fakeFetch(responses: Array<() => Response>, seen: Array<{ url: string; headers: Record<string, string>; body: any }>): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
    return responses[i++]!();
  }) as typeof fetch;
}
const ok = () =>
  Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ summary: "..." }) }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    modelVersion: "gemini-3.8-flash-001",
    responseId: "resp-1",
  });
const provider = new MyGeminiProvider({ apiKey: () => "test-key", fetch: fakeFetch([ok], []) });
// expect(seen[0].headers["x-goog-api-key"]).toBe("test-key"); expect(seen[0].url).not.toContain("test-key");
```
**검증**:
```bash
bun test packages/harness
bun run typecheck
```
**하지 말 것**:
- API 키를 URL 쿼리, 로그, 오류 메시지에 넣기. 키는 `apiKey()` 호출 시점에 읽는다.
- 허용 목록 밖 모델/`-latest` 별칭 쓰기. 모델·프롬프트·라우팅 변경은 평가를 거친다(ADR-0006).
- 청구된 응답이 쓸 수 없을 때 `billed` 없이 throw하기.
- 새 외부 처리자나 새 종류의 데이터 전송이면 개인정보처리방침 수정 누락(R14).

---

## R8. 웹 화면·라우트·API 클라이언트 메서드 추가
**언제**: `apps/web`에 새 화면이나 새 API 호출을 넣을 때.
**읽을 파일**:
- `apps/web/src/app/router.tsx` — `createRoute`, `authedRoute`, `libraryRoute`(validateSearch), `routeTree`
- `apps/web/src/routes/settings/SettingsPage.tsx` + `settings.module.css` (작은 화면 예), `routes/calendar/`
- `apps/web/src/ui/controls.tsx` — `Button`, `Badge`, `EmptyState`, `ErrorBox`(React Aria Components 래퍼), `ui/Icon.tsx`, `ui/toast.tsx`
- `apps/web/src/app/labels.ts` — 도메인 enum → 한국어 라벨(`STATUS`, `STAGE_LABEL`)
- `apps/web/src/api/client.ts` — `ApiClient` 인터페이스, `ApiClientError`
- `apps/web/src/api/http/client.ts` — `call(operationId, { params, query, body })`, `createHttpClient`
- `apps/web/src/api/fixture/client.ts` — `createFixtureClient`(메모리 데이터)
- `apps/web/src/api/queries.ts` — `queryKeys`, `useTags`, `useTagActions`, `useOrganise`, `applyEvent`, `useWorkspaceEvents`
- `apps/web/src/api/types.ts` — domain 타입 재수출
- `apps/web/test/styles.test.ts`, `apps/web/README.md`

**순서**:
1. 타입: `api/types.ts`에서 필요한 domain 타입을 재수출한다.
2. `ApiClient`(`api/client.ts`)에 메서드를 추가한다. 이름은 operationId 그대로, 인자는 domain 요청 타입.
3. `api/http/client.ts`의 반환 객체에 한 줄 추가한다: `listNotes: (ws) => call("listNotes", { query: { workspace_id: ws, limit: 200 } })`, `updateNote: (id, body) => call("updateNote", { params: { note_id: id }, body })`. `call`이 `ROUTES_BY_OPERATION[operationId]`로 메서드·경로를 정하고 응답을 route의 응답 스키마로 검증한다.
4. `api/fixture/client.ts`에 같은 메서드의 메모리 구현을 추가한다(`wait(() => ...)`, `page(...)` 헬퍼 사용). 필요하면 `src/fixtures/*`에 데이터.
5. `api/queries.ts`: `queryKeys.notes = (ws: string) => ["notes", ws] as const`, 조회 훅 `useNotes(ws)`(`useQuery` + `allPages(() => api.listNotes(ws))`), 변경 훅은 `useMutation`에 `onSettled`로 `qc.invalidateQueries({ queryKey: queryKeys.notes(ws) })`.
6. 서버 이벤트로 갱신하려면 `applyEvent`의 `switch (event.type)`에 `case`를 추가해 `invalidateQueries` 또는 `setQueryData`(R10).
7. 화면: `src/routes/<name>/<Name>Page.tsx` + `<name>.module.css`. 제목은 `usePageTitle("...")`(`app/RootLayout.tsx`), 레이아웃 클래스는 `app/layout.module.css`의 `page`, `pageTitle`. 로딩/오류/빈 상태는 `ErrorBox`, `EmptyState`.
8. `router.tsx`에 `const noteRoute = createRoute({ getParentRoute: () => authedRoute, path: "/notes", component: NotesPage });`를 만들고 `authedRoute.addChildren([...])`에 넣는다. 검색 파라미터는 `validateSearch`로 `str()` 헬퍼를 써서 검증한다.
9. 사용자에게 보이는 문구는 한국어. enum 라벨은 `app/labels.ts`에 둔다. 아이콘 이름은 `ui/Icon.tsx`의 `IconName`에 있는 것만.
10. 내비게이션에 넣으려면 `app/RootLayout.tsx`(및 필요시 `app/commands.ts`)를 본다(확인 필요: 사이드바 항목 추가 위치는 읽지 않았다).

**뼈대**:
```css
/* notes.module.css — tokens only */
.row {
  display: flex;
  gap: var(--space-12);
  padding: var(--space-12) var(--space-16);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}
```
```tsx
import { Button, EmptyState, ErrorBox } from "../../ui/controls.tsx";
import layout from "../../app/layout.module.css";
import s from "./notes.module.css";

export function NotesPage() {
  usePageTitle("노트");
  const ws = useActiveWorkspaceId(); // see app/workspace.tsx for the real hook name (확인 필요)
  const notes = useNotes(ws);
  return <div className={layout.page}><h1 className={layout.pageTitle}>노트</h1>{/* ... */}</div>;
}
```
**검증**:
```bash
bun test apps/web/test
bun run typecheck
bun run web:build
```
**하지 말 것**:
- CSS에 색 리터럴(`#fff`, `rgb(`, `hsl(`, `oklch(`, `color(`) 쓰기, 토큰에 없는 `var(--x)` 쓰기. `apps/web/test/styles.test.ts`가 막는다. `.tsx`에서도 색 문자열, `setAttribute("style")`, `dangerouslySetInnerHTML` 금지.
- 컴포넌트에서 `fetch`를 직접 부르기. 항상 `ApiClient`(`useApi()`)를 거친다.
- 토큰을 `localStorage`에 두거나 `X-Lectern-Token`/`?token=`을 브라우저 코드에서 보내기(쿠키 인증 전용).
- 순수 `<button>`/`<input>`을 새로 만들기. `ui/controls.tsx` 또는 `react-aria-components`를 쓴다.
- fixture 클라이언트를 안 고치기(`web:dev`, 단위 테스트, fixture e2e가 깨진다).

---

## R9. 웹 테스트 추가
**언제**: 웹 로직(단위) 또는 화면 흐름(e2e)을 검증할 때.
**읽을 파일**:
- 단위: `apps/web/test/http-client.test.ts`(`fakeFetch`로 HTTP 클라이언트), `organise.test.ts`, `lib.test.ts`, `styles.test.ts`
- e2e 공용: `apps/web/e2e/fixtures.ts`(`test`, `expect`, `axe`, `tabTo`), `apps/web/playwright.config.ts`
- fixture 프로젝트 예: `apps/web/e2e/a11y.e2e.ts`, `organise.e2e.ts`, `ask.e2e.ts`, `keyboard.e2e.ts`
- server 프로젝트: `apps/web/e2e/server/flow.e2e.ts`, `start.ts`, `accounts.ts`, `wav.ts`

**순서**:
1. 단위 테스트는 `apps/web/test/<name>.test.ts`(`bun:test`). HTTP 클라이언트는 `createHttpClient({ fetch: fake })`, 데이터는 `createFixtureClient()`와 `PERSONAL_WS`.
2. e2e fixture 프로젝트: `apps/web/e2e/<name>.e2e.ts` (이름은 `*.e2e.ts`여야 `bun test`가 안 줍는다). `import { expect, test } from "./fixtures.ts"`를 쓰면 모든 테스트에 CSP 위반/잡히지 않은 오류 감시(`problems` 자동 fixture)가 붙는다. 접근성은 `async ({ page, axe }) => { await axe(page, "라벨"); }`(WCAG 2.2 AA).
3. 서버 프로젝트(`e2e/server/*.e2e.ts`)는 실제 서버(`start.ts`: 임시 DB, 가짜 Gemini, 외부 요청 거부, `LECTERN_ASK=1`)에 로그인해서 돈다. 계정은 `accounts.ts`의 `E2E_OWNER_EMAIL`/`E2E_OWNER_PASSWORD`. 스크린샷은 `page.screenshot({ path: join(SHOTS, "NN-name.png") })`(`E2E_SCREENSHOT_DIR` 또는 `test-results/screens`).
4. 새 화면은 `a11y.e2e.ts`의 `SCREENS` 배열에 `{ path, label, ready }`를 추가하면 라이트/다크 axe 검사가 공짜로 붙는다.
5. 이 서버 프로젝트는 워커가 안 돈다(`LECTERN_WORKER_MODE=external`). 가짜 Gemini가 처리하는 엔드포인트는 `start.ts`의 `globalThis.fetch` 가짜에 한정된다(R12).

**뼈대**:
```ts
import { expect, test } from "./fixtures.ts";

test("notes page has no axe violations", async ({ page, axe }) => {
  await page.goto("/app/notes");
  await expect(page.getByRole("heading", { name: "노트" })).toBeVisible();
  await axe(page, "노트");
});
```
**검증**:
```bash
bun test apps/web/test/styles.test.ts          # one unit file
bun run web:e2e                                  # builds dist + dist-fixture, runs both projects
# one e2e file (확인 필요: 직접 실행해 보지 않음):
cd apps/web && bun scripts/build.ts && bun scripts/build.ts --api fixture --out dist-fixture && bun x playwright test e2e/a11y.e2e.ts --project=fixture
```
**하지 말 것**:
- e2e 파일 이름을 `*.test.ts`로 짓기.
- `test`를 `@playwright/test`에서 직접 import하기(CSP/오류 감시와 `axe`가 빠진다). `./fixtures.ts`(서버 폴더에서는 `../fixtures.ts`)를 쓴다.
- 서버 프로젝트 테스트를 병렬로 돌리기(DB 공유. 설정이 `fullyParallel: false`).
- e2e에서 실제 외부 서비스에 접속하기.

---

## R10. SSE 이벤트 추가
**언제**: 서버가 웹 클라이언트에 새 종류의 실시간 이벤트를 보낼 때.
**읽을 파일**:
- `packages/domain/src/api/events.ts` — `ServerEvent` 판별 유니온, 각 `...Event`, `envelope`
- `apps/server/src/events.ts` — `emitLectureEvent`, `LectureEventPayload`, `onLectureEvent`, `tailForeignLectureEvents`
- `apps/server/src/api/v2/events.ts` — `translate(row, workspaceId, caller)`, `eventsRouter`
- `apps/web/src/api/queries.ts` — `applyEvent`, `useWorkspaceEvents`
- `apps/web/src/api/http/client.ts`의 `subscribe`, `http/sse.ts`

**순서**:
1. domain(R2): `api/events.ts`에 `named("NoteChangedEvent", z.object({ ...envelope, type: z.literal("note.changed"), payload: z.object({...}) }))`를 만들고 `ServerEvent`의 `z.discriminatedUnion` 배열에 추가한다. 가짜 케이스를 `test/fixtures.ts`의 `API_CASES`에 추가하고 `bun run domain:openapi`.
2. 서버가 쓰는 쪽: `emitLectureEvent(ownerId, { type, id, ... })`가 `job_event` 테이블에 `(owner_id, subject_id, type, payload, origin, created_at)` 행을 INSERT하고 같은 프로세스 리스너에 전달한다. 외부 워커가 쓴 행은 API가 `job_event`를 폴링해서 SSE로 보낸다. `LectureEventPayload.type` 유니온에 새 값을 추가한다(확인 필요: 현재 유니온은 v1 강의 이벤트 전용이며 `translate`가 `payload.id`를 강의 id로 해석한다. 강의 이외 대상의 이벤트는 별도 설계가 필요할 수 있다).
3. `api/v2/events.ts`의 `translate`에서 새 payload type을 domain 이벤트로 변환한다. 접근 권한을 `can(caller, "recording:read", recording)`로 확인하고, 워크스페이스가 다르면 `[]`를 반환한다. 한 행이 여러 이벤트가 될 수 있고 id는 `<row>` 또는 `<row>-<n>`.
4. 웹: `applyEvent`에 `case "note.changed": void qc.invalidateQueries({ queryKey: queryKeys.notes(ws) }); break;`. `default`는 모르는 타입을 무시한다.
5. 테스트: `api-v2-data.test.ts`의 `readEvents(res, until)`처럼 `/events` 응답 스트림을 읽고 `ServerEvent.parse`로 검증한다. 웹은 `apps/web/test/http-client.test.ts`의 SSE 테스트 패턴.

**뼈대**:
```ts
// apps/web/src/api/queries.ts — inside applyEvent's switch
case "note.changed":
  void qc.invalidateQueries({ queryKey: queryKeys.notes(ws) });
  break;
```
**검증**:
```bash
bun run domain:openapi && bun test packages/domain
bun test apps/server/test/api-v2-data.test.ts apps/web/test
bun run typecheck
```
**하지 말 것**:
- 이벤트 payload에 전사 본문·토큰 등 민감 값 넣기(ID와 개수 위주).
- 권한 확인 없이 다른 사용자의 비공개 녹음 이벤트를 보내기.
- 기존 이벤트 type 이름·payload 모양 바꾸기(additive만).
- `job_event` 직접 INSERT 대신 `emitLectureEvent`를 우회하기.

---

## R11. 배포 사전 점검(preflight) 항목 추가
**언제**: CD 배포 전에 새 릴리스에서 반드시 성공해야 하는 점검을 넣을 때.
**읽을 파일**:
- `apps/server/src/preflight.ts` — `checks: Array<[path, expectedStatus]>`, `failures` 배열
- `apps/server/src/ops.ts` — `runPreflight(repoDir)`
- `scripts/pipeline/gate.sh` — `preflight()` 함수
- `docs/v2/pipeline/flags-on.env`

**순서**:
1. 경로 상태 점검이면 `preflight.ts`의 `checks` 배열에 `["/api/v2/...", 401]` 같은 튜플을 추가한다(인증 없이 부르므로 보호된 라우트는 401이 기대값).
2. 데이터 검증이면 `failures.push("설명")`를 하는 블록을 `for (const [path, expected] ...)` 앞에 추가한다(`verifyLegacy`, `checkV2Rows` 블록이 본보기). 모든 실패는 문자열로 `failures`에 쌓이고, 하나라도 있으면 exit 1이다.
3. 새 `/assets/*.js` 스크립트는 `PAGE_SCRIPTS`에서 자동으로 점검된다.
4. 새 플래그가 켜졌을 때만 의미 있는 점검이면 `docs/v2/pipeline/flags-on.env`에 플래그를 넣고 코드에서 `config()`로 분기한다.
5. 로컬 실행: `bash scripts/pipeline/gate.sh full` (install, typecheck, `bun test`, `bun run web:e2e`, 이어서 플래그 끔/켬 preflight 두 번). preflight만 직접 돌릴 때 필요한 환경은 `runPreflight`와 `gate.sh`가 같다:

**뼈대**:
```bash
box="$(mktemp -d)"; mkdir -p "$box/data" "$box/lectures" "$box/home"
env LECTERN_PREFLIGHT=1 LECTERN_DATA_DIR="$box/data" LECTERN_LECTURES_DIR="$box/lectures" HOME="$box/home" \
  LECTERN_RESEND_CREDENTIALS_FILE="$box/none.json" LECTERN_LOG_REQUESTS=0 \
  GEMINI_API_KEY= RESEND_API_KEY= LECTERN_DEPLOY_TOKEN= \
  "$(bun -e 'process.stdout.write(process.execPath)')" run apps/server/src/preflight.ts
rm -rf "$box" apps/web/dist.next
```
`LECTERN_PREFLIGHT=1`이 없으면 `preflight.ts`는 exit 2로 끝난다. CD에서는 운영 DB의 `VACUUM INTO` 사본이 `data/lectern.sqlite`로 들어가 마이그레이션을 실데이터로 리허설한다.
**검증**:
```bash
bash scripts/pipeline/gate.sh full
```
**하지 말 것**:
- 운영 DB·실제 키·네트워크에 의존하는 점검 넣기(샌드박스에서 모든 시크릿은 비어 있다).
- 점검 실패를 `console.error`만 하고 `failures`에 안 넣기.
- 느린 점검 추가(CD 단계 타임아웃 120초, `runPreflight`의 `runStep`).

---

## R12. 서버 테스트와 외부 호출 가짜
**언제**: `apps/server`나 워커 코드의 테스트를 쓸 때.
**읽을 파일**:
- `apps/server/test/preload.ts` + 루트 `bunfig.toml`(`[test] preload`)
- `apps/server/test/api-v2-data.test.ts` — `api()`, `v1()`, `makeUser()`, `seedLecture()`, `readEvents()`
- `apps/server/test/server.test.ts` — v1 라우터를 `handleRequest(new Request(...))`로 부르는 예
- `apps/web/e2e/server/start.ts` — `globalThis.fetch` 가짜(Gemini)
- `apps/server/test/transcript-job.test.ts` — `pendingLecture`, `directJob`, `withServerKey`
- `packages/harness/test/transcribe.test.ts` — `fakeFetch`

**순서**:
1. 첫 줄은 `import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads`. 그래야 `db.ts`가 로드되기 전에 `LECTERN_DATA_DIR`, `LECTERN_LECTURES_DIR`, `HOME`이 임시 디렉터리로 바뀌고 `GEMINI_API_KEY`, `RESEND_API_KEY`, `LECTERN_DEPLOY_TOKEN`, `LECTERN_OWNER_*`, `LECTERN_BASE_URL`이 지워진다.
2. 앱 부팅: 서버 전체는 `import { handleRequest } from "../src/index.ts"`를 부른다(Hono v2 + 레거시 v1 라우터). 요청은 `await handleRequest(new Request("http://localhost/api/..."))`. v2만 `createApiV2App()` (`src/api/v2/index.ts`).
3. 사용자: `createUser({ email, displayName, password })` (`src/db.ts`) → 반환값의 `api_token`을 `X-Lectern-Token` 헤더로. 세션 쿠키가 필요하면 `createSession(user.id)` → `Cookie: lectern_session=<token>`. 오너: `ensureBootstrapOwner()`. 워크스페이스 id: `personalWorkspaceId(user.id)` (`@lectern/db`). 이메일은 `${generateId("name")}@example.com`처럼 유일하게.
4. 강의/녹음: `createPendingLecture({ id, ownerId, title, course, audioPath, audioMime, audioSize, modelRequested, sourceClient })` → `completeLectureRecord(id, { title, courseName, markdown, excerpt, modelUsed, durationSec })`. 오디오는 `join(DATA_DIR, "uploads", ...)`에 파일을 쓴다. `sourceClient: "bun-test"`는 아카이브에 쓰지 않게 한다(`api-v2-data` 쪽은 `macos-native-menubar`). `generateId("lec")`는 UUID.
5. 외부 HTTP 가짜: Gemini는 하네스 어댑터의 `fetch` 옵션 주입(R7)이나 가짜 공급자 객체(`ScriptedTranscriptionProvider`, `TranscriptJobDeps.provider`, `registerTranscriptJobHandler({ provider, harness })`). 서버 프로세스 전체를 가짜로 감싸야 하면 `e2e/server/start.ts`처럼 `globalThis.fetch`를 교체해 `https://generativelanguage.googleapis.com/`는 결정론적 응답, 나머지 호스트는 `throw`(localhost만 통과). Resend: 테스트 환경에서는 키가 지워져 있어 `sendResendVerificationEmail`은 키 없음으로 throw하고 보내지 않는다. 가입 흐름은 `createEmailVerificationCode(email, "signup", 10)`로 코드를 직접 만들어 `verificationCode`에 넣는다(`server.test.ts`의 Resend 테스트).
6. 환경 변수를 바꾸는 테스트는 `resetConfigForTests()`를 부르고 `afterAll`에서 `delete process.env.X` 후 다시 reset.

**검증**:
```bash
bun test apps/server/test/<file>.test.ts
bun test
```
**하지 말 것**:
- preload 없이 `db.ts`를 먼저 import하기(운영 DB를 건드릴 수 있다).
- 운영 코드에 `if (process.env.NODE_ENV === "test")` 같은 분기 넣기.
- 테스트에서 `~/local.env`나 실제 키 읽기, 실제 메일 발송.
- 고정 이메일 재사용(다른 테스트 파일과 같은 프로세스 DB를 공유할 수 있다).

---

## R13. v1 계약 유지
**언제**: v2 쓰기 경로, 강의/녹음 관련 로직을 바꿀 때. 출시된 네이티브 클라이언트(macOS, Android, Windows, iOS)는 v1 API를 쓴다.
**읽을 파일**:
- `apps/server/test/v1-contract.test.ts` — `SUMMARY` 등 필드·타입 고정 표, `expectShape`
- `packages/db/src/legacy.ts` — `projectLecture`, `drainLectureSync`, `installLectureSyncTriggers`, `insertLegacyVersion`, `verifyLegacy`, `backfillLegacy`
- `apps/server/src/db.ts` — `mirrorRecordingToLecture`, `syncPendingLectures`, `setLectureVisibility`
- `apps/server/src/api/v2/store.ts` — `mirrorRecording`, `announceLectures`, `announceDeleted`, `courseForFolder`
- `apps/server/src/api/v2/README.md` — "데이터: v1 강의와 v2 행"

**순서**:
1. 강의(lectures) 한 건이 v2 행 여러 개(recording, 폴더, legacy 문서 버전, asset, share_link)로 투영된다. 방향별 규칙:
   - v1 → v2: `db.ts`의 강의 쓰기 함수 끝에서 `projectLecture`가 호출된다. `db.ts` 밖에서 `lectures`를 직접 쓰면 트리거가 `lecture_sync_pending`에 표시하고 v2 요청 앞에서 `syncPendingLectures()`가 반영한다.
   - v2 → v1: v2 쓰기는 같은 `transact(() => ...)` 안에서 `mirrorRecording(recording, { title?, folderId? })`(내부에서 `mirrorRecordingToLecture`)를 불러 `lectures`의 제목/과목을 같이 바꾼다. 트랜잭션 뒤에 `announceLectures([lectureId])`(삭제는 `announceDeleted(ownerId, ids)`)로 v1 SSE와 v2 이벤트를 낸다.
2. v2 쪽 녹음 속성(제목, 폴더, 문서 저장, 삭제, 공개 여부)을 바꾸는 새 코드는 위 미러를 빼먹지 않는다. 문서 저장은 `updateLectureMarkdown`, 삭제는 `deleteLectureById`를 거친다.
3. v1 JSON의 키 집합·타입을 바꾸지 않는다. 필드를 더하려 해도 `v1-contract.test.ts`의 `expectShape`가 키 집합을 고정하므로 클라이언트 디코더를 확인한 뒤에만 테스트 표를 고친다.
4. 변경 후 `verifyLegacy`(lectures와 v2 행 일치 검사)가 통과해야 한다. preflight가 같은 검사를 한다(R11).
5. 테스트: 새 v2 쓰기가 v1 응답(`GET /api/lectures`, `GET /api/lectures/{id}`)에 반영되는지 `api-v2-data.test.ts`의 `v1(...)` 헬퍼로 확인한다.

**뼈대**:
```ts
// inside a v2 router handler that renames a recording
transact(() => {
  db.query(`UPDATE recording SET title = ?, updated_at = ? WHERE id = ?`).run(title, Date.now(), recording.id);
  mirrorRecording(recording, { title });
});
announceLectures(recording.lecture_id ? [recording.lecture_id] : []);
```
**검증**:
```bash
bun test apps/server/test/v1-contract.test.ts apps/server/test/api-v2-data.test.ts packages/db
```
**하지 말 것**:
- v2 쓰기만 하고 `lectures`를 안 바꾸기(v1 클라이언트가 옛 제목을 본다).
- v1 응답에서 키 삭제/이름 변경/타입 변경.
- 트랜잭션 밖에서 두 쪽을 따로 쓰기(동시 투영이 불일치를 볼 수 있다).
- `share_token`/`audio_sha256` 의미 바꾸기(`audio_sha256`는 클라이언트 멱등 키일 수 있다).

---

## R14. 개인정보처리방침 수정
**언제**: 수집 항목, 이용 목적, 보관 기간, 외부 처리자(AI 공급자, 메일, 호스팅)가 바뀔 때(AGENTS.md: 같은 PR에서 고친다).
**읽을 파일**:
- `apps/server/static/legal/privacy.html` — 섹션 `items`(1. 수집 항목, 1.1~1.5 표), `purposes`(2), `retention`(3 표), `processors`(4. 처리 위탁과 국외 이전 표), `google`(5), `rights`(6), `security`(8), `contact`(9)
- `apps/server/src/legal.ts` — 슬롯 `{{CONTACT_EMAIL}}`, `{{OPERATOR_NAME}}`, `{{EFFECTIVE_DATE}}`, `LEGAL_FALLBACKS`, `renderLegalTemplate`
- `apps/server/test/legal.test.ts`

**순서**:
1. 새 외부 처리자: `<h2 id="processors">` 아래 표(`받는 자(국가) | 맡기는 일 | 이전 항목 | 보관 기간`)에 `<tr><td>..</td><td>..</td><td>..</td><td>..</td></tr>` 행을 추가한다.
2. 새 수집 항목: 1.1~1.3의 표에 행 추가. 새 목적은 2번 목록, 새 보관 기간은 3번 표.
3. 값을 고정하지 않을 곳(문의 이메일, 책임자, 시행일)은 슬롯만 쓴다. 새 슬롯을 만들려면 `legal.ts`의 `LEGAL_FALLBACKS`와 `renderLegalTemplate`의 `filled`, `LegalValues`, `packages/config`(R4)를 함께 고친다.
4. 시행일은 환경 변수 `LECTERN_LEGAL_EFFECTIVE_DATE`로 운영자가 정한다. 문서에 날짜를 박지 않는다.
5. 텍스트는 한국어, 속성값은 큰따옴표, 인라인 스크립트 금지.

**뼈대**:
```html
<tr>
  <td>Example Inc. (미국)<br><a href="https://example.com/privacy">개인정보처리방침</a></td>
  <td>맡기는 일 한 줄</td>
  <td>보내는 정보 항목</td>
  <td>보관 기간</td>
</tr>
```
**검증**:
```bash
bun test apps/server/test/legal.test.ts
```
**하지 말 것**:
- 실제 이메일·실명·날짜를 정적 HTML에 쓰기(공개 저장소).
- `{{...}}` 슬롯을 `legal.ts`에 없는 이름으로 쓰기(첫 테스트가 실패).
- 처리자를 코드에 먼저 추가하고 방침을 나중으로 미루기.

---

## R15. 메일 발송
**언제**: 이메일을 보내는 기능을 만들거나 바꿀 때.
**읽을 파일**:
- `apps/server/src/index.ts` — `resolveResendApiKey`, `sendResendVerificationEmail`(이 파일 안의 비공개 함수), 호출부(`/api/auth/send-code`, 비밀번호 재설정)
- `packages/config/src/index.ts` — `RESEND_API_KEY`(시크릿), `RESEND_FROM_EMAIL`, `LECTERN_RESEND_CREDENTIALS_FILE`, `config().resend`
- `apps/server/test/preload.ts`, `apps/server/test/server.test.ts`("Resend 6-digit email verification code ...")

**현재 방식**: `fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer <key>", "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [toEmail], subject, html }) })`. 키는 `readSecret("RESEND_API_KEY")`, 없으면 자격 파일(`config().resend.credentialsFile`)에서 읽는다. 키가 없으면 `throw new Error("이메일 발송 API 키(RESEND_API_KEY)가 설정되지 않았습니다.")`. 가입 인증은 `await`로 보내 실패를 응답에 반영하고, 비밀번호 재설정은 계정 존재 여부를 숨기려고 `await` 없이 `.catch(logger.error)`로 보낸다.

**순서**:
1. 새 메일 종류는 `sendResendVerificationEmail`과 같은 형태의 함수를 쓴다. 재사용하려면 별도 모듈(예: `apps/server/src/mail.ts`)로 꺼내 `fetch`와 키 조회를 주입 가능하게 만들고 `index.ts`가 그걸 쓰게 한다(확인 필요: 현재 메일 전송 전용 모듈은 없다).
2. 수신자 이메일 주소를 로그·감사 로그 상세에 넣을 때는 최소한으로(현재 `recordAuditLog`의 `actorEmail`만).
3. 제목과 본문은 한국어. 본문에 사용자 값이 들어가면 `escapeHtml`(`@lectern/core`).
4. 메일로 이용자 데이터를 보내거나 새 종류의 메일(알림 등)이 생기면 방침 R14의 Resend 행을 확인한다.
5. 테스트는 키가 지워진 샌드박스에서 돈다(`preload.ts`가 `RESEND_API_KEY`를 지우고 자격 파일을 존재하지 않는 경로로 돌린다). 실제 발송 경로를 검증해야 하면 `globalThis.fetch`를 가짜로 바꿔 `https://api.resend.com/emails` 요청 본문만 캡처하고 `afterEach`에서 원복한다.

**뼈대**:
```ts
const realFetch = globalThis.fetch;
const sent: any[] = [];
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url) === "https://api.resend.com/emails") {
    sent.push(JSON.parse(init.body));
    return Response.json({ id: "email_test" });
  }
  throw new Error(`unexpected outbound request: ${String(url)}`);
}) as typeof fetch;
process.env.RESEND_API_KEY = "test-key-never-sent"; // then resetConfigForTests() not needed: readSecret reads live
// afterEach: globalThis.fetch = realFetch; delete process.env.RESEND_API_KEY;
```
**검증**:
```bash
bun test apps/server/test/server.test.ts
```
**하지 말 것**:
- 테스트에서 실제 Resend 호출·실제 주소로 발송.
- 메일 본문·인증번호·API 키를 로그에 남기기.
- 가입 여부가 응답으로 드러나게 하기(재설정 응답은 계정 유무와 무관하게 같아야 한다).
- 새 코드에 `/home/eunhhu/...` 경로 쓰기. (`index.ts`의 `RESEND_CREDENTIALS_FILE` 기본값에 기존 하드코딩이 남아 있다. 새로 베끼지 않는다.)

---

## R16. 시크릿 봉인·토큰 해시
**언제**: 잡이나 DB에 임시 시크릿을 넘기거나, 새 토큰/비밀번호를 저장할 때.
**읽을 파일**:
- `apps/server/src/secrets.ts` — `sealSecret(plain)`, `openSecret(sealed)`
- `apps/server/src/queue.ts` — `enqueueJob({ secret })`, `LeasedJob.secret()`
- `apps/server/src/db.ts` — `hashPassword`, `verifyPassword`, `generateApiToken`, `createSession`, `getUserBySessionOrApiToken`, `createEmailVerificationCode`, `verifyEmailVerificationCode`
- `apps/server/src/auth.ts` — `extractAuthToken`, `authenticateRequest`, `resolveActiveUser`, `isAdminUser`
- `packages/db/src/legacy.ts` — `projectShareLink`(`sha256Hex`)

**사실 정리**:
- 봉인: AES-256-GCM, 키는 `DATA_DIR/secret.key`(0600, 처음 쓸 때 생성). 형식 `v1:<base64(iv|tag|body)>`. 열 수 없으면 `openSecret`이 `null`. 잡에 한정된 임시 시크릿용이며 잡이 끝나면 지운다. DB 백업에 키 파일은 포함되지 않는다.
- 비밀번호: `hashPassword`는 `scryptSync(password, salt, 64)`로 `"<salt hex>:<key hex>"`. 검증은 `verifyPassword`(`timingSafeEqual`).
- 현재 v1 토큰은 해시하지 않는다: `users.api_token`(`lct_...`), `sessions.token`(`ses_...`), `lectures.share_token`은 평문 컬럼이다(`generateApiToken`, `createSession`). v2 `share_link.token_hash`는 `sha256Hex(share_token)`이고 `auth_session`은 `token_hash`를 저장하도록 설계됐다(domain README #21).
- 이메일 인증번호는 `email_verifications.code`에 평문으로 저장되며 잘못 5번 맞추면 무효(`MAX_VERIFICATION_CODE_ATTEMPTS`).

**순서**:
1. 잡에 외부 키를 넘길 때: 생산자 `enqueueJob({ ..., secret: userKey })`, 핸들러 `job.secret()`. `payload`에는 넣지 않는다.
2. 새 비밀번호류 값: `hashPassword`/`verifyPassword`를 그대로 쓴다. 새 해시 알고리즘을 만들지 않는다.
3. 새 토큰을 DB에 저장할 때는 `sha256Hex(token)`(`@lectern/db`가 export하는 해시 함수; 확인 필요: 정확한 export 경로는 `packages/db/src/legacy.ts`의 import를 확인)만 저장하고, 원문은 만든 직후 한 번만 보여준다. 조회는 해시로.
4. 서버 설정의 시크릿은 R4의 `readSecret`.

**뼈대**:
```ts
import { sealSecret, openSecret } from "./secrets.ts";
const sealed = sealSecret("secret value");
const plain = openSecret(sealed); // string | null
```
**검증**:
```bash
bun test apps/server/test/server.test.ts apps/server/test/transcript-job.test.ts
```
**하지 말 것**:
- 시크릿을 `job.payload`, `job.result`, 로그, 에러 메시지에 넣기.
- `Math.random`으로 토큰 만들기. `randomBytes`(node:crypto)를 쓴다.
- 비밀번호/토큰 비교에 `===`. `timingSafeEqual`을 쓴다(`safeTokenCompare`는 `index.ts`에 있다).
- `secret.key`를 커밋하거나 백업에 넣기.

---

## R17. 로그·오류 규칙
**언제**: 로그를 남기거나 오류 응답을 만들 때.
**읽을 파일**:
- `apps/server/src/log.ts` — `logger.debug/info/warn/error(msg, fields?)`, `LogFields`
- `apps/server/src/ops.ts` — `redactUrlForLog(url)`
- `apps/server/src/http.ts` — `X-Request-Id`(`REQUEST_ID_RE`, `c.set("requestId")`), `app.onError`
- `apps/server/src/api/v2/index.ts` — `v2.onError`
- `apps/server/src/index.ts` — 요청 로그(`logger.info("request", {...request_id})`)

**규칙**:
1. `console.log` 대신 `logger`. 출력은 JSON 한 줄(`LECTERN_LOG_FORMAT=pretty`면 읽기 좋은 줄). 메시지는 짧은 영어, 가변 값은 필드로: `logger.warn("transcript stage failed", { job_id, lecture_id, stage, error_code })`.
2. 오류 객체는 `err` 키로 넘기면 `{ name, message, stack }`로 직렬화된다: `logger.error("could not do X", { err })`.
3. 요청 컨텍스트에는 `request_id`(요청 헤더 `x-request-id`가 `^[A-Za-z0-9._-]{8,64}$`이면 재사용, 아니면 UUID. 응답 헤더 `X-Request-Id`), 작업 컨텍스트에는 `job_id`, 대상에는 `lecture_id`/`recording_id`.
4. URL을 로그에 남길 때는 `redactUrlForLog(url)`(`token`, `share`, `key` 쿼리 값을 `redacted`로 바꾼다).
5. v2 오류 응답은 `{ error: { code, message, details? } }`(`apiError`). 처리되지 않은 예외는 500 `internal`에 `request_id`를 details로 붙인다. 메시지는 사용자에게 보여도 되는 한국어. v1 오류는 `{ error: "..." }`.
6. **절대 로그에 남기지 않는 것**: API 키·토큰·세션 쿠키·`Authorization`/`X-Lectern-Token` 헤더, 요청 본문, 비밀번호, 인증번호, 녹음 전사·문서 본문, 사용자 업로드 파일 내용, 사용자가 제공한 Gemini 키. 이메일 주소는 필요한 만큼만.

**뼈대**:
```ts
import { logger } from "./log.ts";
logger.info("note created", { request_id: requestId, note_id: id });
logger.error("could not sweep upload parts", { err });
```
**검증**:
```bash
bun test apps/server/test/ops.test.ts apps/server/test/http.test.ts
```
**하지 말 것**:
- 요청 객체·헤더·본문을 통째로 로그에 넣기.
- `?token=`이 붙은 URL을 그대로 로그에 쓰기.
- 모델 응답 본문이나 전사 텍스트를 잡 `result`/로그에 넣기(`runTranscriptJob`은 개수와 참조만 남긴다).

---

## 파일 지도

| 경로 | 내용 |
|---|---|
| `AGENTS.md` | 작업 규칙(필독) |
| `apps/server/src/index.ts` | 운영 진입점, v1 레거시 라우터(인증, 업로드, SSE, 관리자, CD 웹훅, 메일 발송 함수) |
| `apps/server/src/http.ts` | Hono 진입점: request id, 오류 응답, `/privacy`·`/terms`, `/app` 셸 |
| `apps/server/src/api/v2/` | `/api/v2` 리소스별 라우터. `common.ts`(defineRouter), `access.ts`(can), `rows.ts`(DTO), `store.ts`(공용 DB), `index.ts`(등록), `README.md`(상태 표) |
| `apps/server/src/db.ts` | bun:sqlite v1 스키마·쿼리, 사용자·세션·강의, v2 미러 |
| `apps/server/src/auth.ts` | 쿠키/토큰 인증 |
| `apps/server/src/queue.ts` | SQLite 영속 작업 큐(lease, dedupe, `JobWorker`) |
| `apps/server/src/job-handlers.ts` | 잡 핸들러 등록(distill, compact, transcribe) |
| `apps/server/src/transcript-job.ts` | 하네스 기반 transcribe 잡 |
| `apps/server/src/events.ts` | `job_event` 기록, 프로세스 간 이벤트 |
| `apps/server/src/secrets.ts` | 봉인 시크릿(AES-GCM) |
| `apps/server/src/log.ts`, `ops.ts`, `preflight.ts` | 로거, 운영·CD·`redactUrlForLog`, 배포 사전 점검 |
| `apps/server/src/legal.ts`, `static/legal/` | 정책 페이지 슬롯 렌더링, privacy/terms HTML |
| `apps/server/test/` | bun test. `preload.ts`가 샌드박스, `fixtures/`에 워커 픽스처 |
| `apps/worker/src/index.ts` | 외부 워커 프로세스(`LECTERN_WORKER_MODE=external`) |
| `apps/web/src/app/` | 라우터, 레이아웃, 라벨, 명령 팔레트 |
| `apps/web/src/api/` | `client.ts`(ApiClient), `http/`(실제), `fixture/`(메모리), `queries.ts`(TanStack Query, SSE 반영) |
| `apps/web/src/routes/` | 화면: inbox, library, recording, ask, calendar, settings, login |
| `apps/web/src/ui/`, `lib/`, `fixtures/`, `styles/` | React Aria 래퍼·아이콘, 순수 함수, 픽스처 데이터, 전역 스타일 |
| `apps/web/test/`, `apps/web/e2e/` | 단위 테스트, Playwright(fixture·server 프로젝트) |
| `packages/config` | 환경 변수 zod 스키마, `readSecret`, `describeEnv` |
| `packages/db` | Drizzle 스키마, `migrations/`, `runMigrations`, `legacy.ts`(v1→v2 투영), `ids.ts` |
| `packages/domain` | v2 계약(zod): entities, enums, `api/routes.ts`, `openapi.json`. 동결 |
| `packages/harness` | 단계 러너, 장부, Gemini 어댑터, 전사 파이프라인, `pricing.json`, `prompts/` |
| `packages/core` | 현행 AI 경로(Gemini, Markdown 렌더, 오디오 전처리), `escapeHtml`, `resolveGeminiModel` |
| `packages/ask` | 검색 색인, 하이브리드 검색, 물어보기(RAG) |
| `packages/media` | ffmpeg 기반 오디오 처리(`isFfmpegAvailable`, 청크, 정규화) |
| `packages/design-tokens`, `packages/ui` | 디자인 토큰(`dist/tokens.css`) 등(확인 필요: `packages/ui` 내용은 읽지 않았다) |
| `deploy/systemd/` | 운영 유닛 템플릿, `lectern.env.example` |
| `docs/env.md`, `docs/adr/`, `docs/runbooks/`, `docs/v2/` | 환경 변수 참조(자동 생성), 결정 기록, 운영 절차, v2 설계 |
| `scripts/pipeline/gate.sh` | `quick`/`unit`/`full` 게이트 |
