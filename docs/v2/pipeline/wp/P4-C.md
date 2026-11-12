# P4-C 계약: LECTERN_CALENDAR, 테이블, 라우트, 방침

> 등급: `careful` · 게이트: `full` · 의존: `P3-C` · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `docs/runbooks/`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

캘린더 기능의 바닥을 깐다. 플래그 `LECTERN_CALENDAR`(기본 꺼짐)와 Google OAuth 시크릿 이름, 마이그레이션 `p4_calendar`(테이블 4개), `WorkspaceSettings.reminders`, ICS feed 라우트 3개(서버는 501 스텁), 개인정보처리방침 문구, secret-rotation 런북 항목을 넣는다. 동작은 바뀌지 않는다(플래그를 읽는 코드가 아직 없다). 사용자가 보는 변화는 `/privacy` 문구뿐이다.

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` §0.1(D-0-3~D-0-5, D-0-8, D-0-9), §0.2, §0.3, §4 전체(D-P4-1~D-P4-9, DB `p4_calendar`, 라우트 표)
- 레시피: `RECIPES.md` R1, R2, R4, R14
- 코드: `packages/config/src/index.ts` — `ENV`, `Config`, `loadConfig`, `readSecret`
- 코드: `packages/db/src/schema.ts` — `integration`, `eventCandidate`(표 모양 본보기)
- 코드: `packages/domain/src/entities.ts` — `WorkspaceSettings`; `api/resources.ts` — `StartGoogleIntegrationResponse`; `api/routes.ts` — `ROUTES`, `json`, `noContent`
- 코드: `apps/server/src/api/v2/calendar.ts` — `calendarRouter`; `apps/server/test/api-v2.test.ts` — `NOT_YET`
- 코드: `apps/server/static/legal/privacy.html`, `apps/server/test/legal.test.ts`
- 문서: `docs/runbooks/secret-rotation.md` 1절 표, `docs/runbooks/google-oauth-verification.md` 3.5절
- 앞선 계약 WP: `P1-C`가 `0004_p1_pipeline`, `P3-C`가 `0005_p3_pdf`를 만든다. 이 WP는 `0006_p4_calendar`를 만든다.

## 3. 사전 점검

```bash
git grep -n "LECTERN_ASK:" -- packages/config/src/index.ts
git grep -n "export function readSecret" -- packages/config/src/index.ts
git grep -n "export const integration " -- packages/db/src/schema.ts
git grep -n "export const WorkspaceSettings" -- packages/domain/src/entities.ts
git grep -n "operationId: \"startGoogleIntegration\"" -- packages/domain/src/api/routes.ts
git grep -n "const NOT_YET" -- apps/server/test/api-v2.test.ts
git grep -n "id=\"processors\"" -- apps/server/static/legal/privacy.html
ls packages/db/migrations | grep -E "0004_p1_pipeline|0005_p3_pdf"
```
마지막 줄에 두 파일이 안 나오면 멈춘다(`P1-C`, `P3-C`가 먼저 병합돼야 한다).

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `packages/config/src/index.ts` | 수정 | 플래그 1, 시크릿 2, `Config.calendar`, `readSecret` 이름 추가 |
| `packages/config/test/config.test.ts` | 수정 | 기본값·변환·시크릿 가림 |
| `docs/env.md` | 재생성 | `bun run config:docs` |
| `deploy/systemd/lectern.env.example` | 수정 | 설명과 기본값 |
| `docs/v2/pipeline/flags-on.env` | 수정 | `LECTERN_CALENDAR=1` |
| `packages/db/src/schema.ts` | 수정 | 테이블 4개 |
| `packages/db/migrations/0006_p4_calendar.sql`, `meta/0006_snapshot.json`, `meta/_journal.json` | 생성 | drizzle이 만든다 |
| `packages/db/test/migrate.test.ts` | 수정 | 적용 목록, 테이블 목록 |
| `packages/domain/src/entities.ts` | 수정 | `WorkspaceSettings.reminders` |
| `packages/domain/src/api/resources.ts`, `routes.ts` | 수정 | feed DTO와 라우트 3개 |
| `packages/domain/test/fixtures.ts`, `api.test.ts` | 수정 | 새 스키마 케이스 |
| `packages/domain/openapi.json` | 재생성 | `bun run domain:openapi` |
| `apps/server/src/api/v2/calendar.ts` | 수정 | feed 핸들러 3개를 `notImplemented`로 |
| `apps/server/src/api/v2/README.md` | 수정 | 상태 표에 feed 3행 |
| `apps/server/test/api-v2.test.ts` | 수정 | `NOT_YET`에 3개 추가 |
| `apps/server/test/v2-migration-rehearsal.test.ts` | 수정 | 기대 마이그레이션 목록 끝에 새 태그 |
| `apps/server/static/legal/privacy.html` | 수정 | 6단계 문구 |
| `apps/server/test/legal.test.ts` | 수정 | 새 문구 검사 |
| `docs/runbooks/secret-rotation.md`, `google-oauth-verification.md` | 수정 | 7단계 |

## 5. 단계

1. `packages/config/src/index.ts`. `ENV`의 `LECTERN_ASK_MONTHLY_LIMIT_MICROUSD` 뒤에 넣는다.
   ```ts
   LECTERN_CALENDAR: { schema: bool(false), description: "1: turn on ICS subscription (/cal/<token>.ics), Google Calendar sync and e-mail reminders. 0: the calendar routes answer 501" },
   GOOGLE_OAUTH_CLIENT_ID: { schema: optionalString, description: "Google OAuth client id (calendar, later sign-in)", secret: true },
   GOOGLE_OAUTH_CLIENT_SECRET: { schema: optionalString, description: "Google OAuth client secret", secret: true },
   ```
   `Config`에 `/** ICS feed, Google Calendar sync, reminders (P4). */ calendar: boolean;`을 더하고 `loadConfig`에 `calendar: p.LECTERN_CALENDAR,`를 잇는다. `readSecret`의 `name` 유니온에 `"GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET"`을 더한다. 시크릿은 `Config`에 넣지 않는다(R4).
2. `packages/config/test/config.test.ts`. 6절 표대로 테스트를 더한다. 첫 테스트의 `loadConfig({})` 검사 옆에 `expect(c.calendar).toBe(false)`를 넣는다.
3. `bun run config:docs`를 돌린다. `docs/env.md`는 손으로 고치지 않는다.
4. `deploy/systemd/lectern.env.example`에서 `LECTERN_ASK_MONTHLY_LIMIT_MICROUSD=2000000` 줄 뒤에 빈 줄 하나와 아래를 넣는다. 시크릿은 값 없이 주석이다.
   ```
   # 캘린더 (docs/v2/ARCHITECTURE.md §11). 1: ICS 구독 URL, Google Calendar 동기화, 이메일 리마인더.
   # Google 연동은 아래 두 값이 있어야 켜진다(없으면 연결 요청이 501). 값은 비밀번호 관리자에서 가져온다.
   LECTERN_CALENDAR=0
   # GOOGLE_OAUTH_CLIENT_ID=
   # GOOGLE_OAUTH_CLIENT_SECRET=
   ```
5. `docs/v2/pipeline/flags-on.env` 끝에 `LECTERN_CALENDAR=1` 한 줄을 더한다. 시크릿은 넣지 않는다.
6. `packages/db/src/schema.ts` 끝(`usageLedger` 뒤 아무 곳)에 테이블 4개를 더한다. DDL은 `CONTRACTS.md` §4 그대로다. 열 이름은 snake_case, 시각은 epoch ms.
   ```ts
   export const calendarFeed = sqliteTable("calendar_feed", {
     id: text("id").primaryKey(), userId: text("user_id").notNull(), workspaceId: text("workspace_id").notNull(),
     tokenHash: text("token_hash").notNull().unique(), createdAt: integer("created_at").notNull(), revokedAt: integer("revoked_at"),
   }, (t) => [index("idx_calendar_feed_user").on(t.userId, t.workspaceId)]);
   export const calendarEventLink = sqliteTable("calendar_event_link", {
     eventCandidateId: text("event_candidate_id").primaryKey(), integrationId: text("integration_id").notNull(),
     externalEventId: text("external_event_id").notNull(), externalEtag: text("external_etag"),
     state: text("state", { enum: ["synced", "error"] }).notNull(), lastSyncedAt: integer("last_synced_at").notNull(), errorCode: text("error_code"),
   }, (t) => [index("idx_calendar_link_integration").on(t.integrationId)]);
   export const reminder = sqliteTable("reminder", {
     id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), userId: text("user_id").notNull(),
     targetType: text("target_type", { enum: ["event", "action_item"] }).notNull(), targetId: text("target_id").notNull(),
     sendAt: integer("send_at").notNull(), state: text("state", { enum: ["scheduled", "sent", "canceled", "failed"] }).notNull(),
     sentAt: integer("sent_at"), createdAt: integer("created_at").notNull(),
   }, (t) => [uniqueIndex("idx_reminder_unique").on(t.userId, t.targetType, t.targetId, t.sendAt), index("idx_reminder_due").on(t.state, t.sendAt)]);
   export const oauthState = sqliteTable("oauth_state", {
     stateHash: text("state_hash").primaryKey(), userId: text("user_id"), workspaceId: text("workspace_id"),
     purpose: text("purpose", { enum: ["google_calendar", "google_login", "apple_login"] }).notNull(),
     codeVerifier: text("code_verifier"), redirectAfter: text("redirect_after"), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
   });
   ```
   `index`, `uniqueIndex`는 이미 파일 위에서 import돼 있다. `calendar_feed`는 `user_id + workspace_id`당 활성(`revoked_at IS NULL`) 행이 하나라는 규칙을 P4-01이 코드로 지킨다.
7. `bun run --cwd packages/db generate --name p4_calendar`. 생성된 SQL에 `CREATE TABLE` 4개와 `CREATE INDEX`/`CREATE UNIQUE INDEX`만 있고 `DROP`·`RENAME`이 없는지 읽는다. 파일 이름이 `0006_p4_calendar`가 아니면 세 파일과 journal `tag`를 함께 고친다.
8. `packages/db/test/migrate.test.ts`. `res.applied` 목록 끝에 `"0006_p4_calendar"`를 더하고(앞 WP가 더한 `0004_p1_pipeline`, `0005_p3_pdf` 뒤), `tables` 검사 목록에 네 테이블 이름을 더한다. `apps/server/test/v2-migration-rehearsal.test.ts`에서 기대 목록에도 같은 태그를 더한다(`git grep -n "0005_p3_pdf" -- apps/server/test packages/db/test`로 고칠 곳을 찾는다).
9. `packages/domain/src/entities.ts`. `WorkspaceSettings`의 `default_language` 뒤에 추가(`.default()` 금지, R2).
   ```ts
   reminders: z.object({ email: z.boolean(), lead_minutes: z.array(z.number().int().min(5).max(43200)).min(1).max(5) })
     .optional().describe("E-mail reminders (ARCHITECTURE §11). Off when absent; when `email` is on and `lead_minutes` is empty the server uses [1440]."),
   ```
   `lead_minutes`는 `min(1)`이라 켤 때 항상 값이 있다. 서버 기본값 `[1440]`은 P4-05가 정한다.
10. `packages/domain/src/api/resources.ts`의 integrations 절 뒤에 추가한다.
    ```ts
    export const CalendarFeedQuery = z.object({ workspace_id: WorkspaceId });                      // not named
    export const CalendarFeedInfo = named("CalendarFeedInfo", z.object({ exists: z.boolean(), url: z.url().nullable(), created_at: Timestamp.nullable() }),
      "The caller's ICS subscription for a workspace. `url` is only sent right after it is created; later reads give `url: null`.");
    export const CreateCalendarFeedRequest = named("CreateCalendarFeedRequest", z.object({ workspace_id: WorkspaceId }));
    export const CalendarFeedCreated = named("CalendarFeedCreated", z.object({ url: z.url(), created_at: Timestamp }),
      "The subscription URL with its token. Shown once; creating again replaces the old URL.");
    ```
    `getCalendarFeed`의 `url`은 항상 `null`이다(원문을 저장하지 않는다, D-0-7). 타입 export(`z.infer`)도 같은 파일의 다른 항목처럼 더한다.
11. `packages/domain/src/api/routes.ts`의 calendar 절 끝(`batchCalendarSuggestions` 뒤)에 `RouteDef` 3개를 더한다. `tag: "calendar"`.
    - `GET /calendar/feed` · `getCalendarFeed` · `query: R.CalendarFeedQuery` · `200: json(R.CalendarFeedInfo, ...)` · `errors: [400, 403]`
    - `POST /calendar/feed` · `createCalendarFeed` · `body: { schema: R.CreateCalendarFeedRequest }` · `200: json(R.CalendarFeedCreated, ...)` · `errors: [400, 403, 501]`
    - `DELETE /calendar/feed` · `deleteCalendarFeed` · `query: R.CalendarFeedQuery` · `204: noContent` · `errors: [400, 403]`
12. `packages/domain/test/fixtures.ts`의 `API_CASES`에 `CalendarFeedInfo`, `CreateCalendarFeedRequest`, `CalendarFeedCreated`의 `valid`/`invalid` 케이스를 넣고, `WorkspaceSettings` 케이스에 `reminders` 유효·무효 값을 넣는다. 그다음 `bun run domain:openapi`.
13. `apps/server/src/api/v2/calendar.ts`의 `calendarRouter`에 `getCalendarFeed: notImplemented, createCalendarFeed: notImplemented, deleteCalendarFeed: notImplemented,`를 더한다(`notImplemented`는 `./common.ts`에서 import). `api/v2/README.md` 표에 3행(`501`, `P4-01`)을 더한다. `api-v2.test.ts`의 `NOT_YET`에 세 operationId를 더한다. `PATH_PARAMS`는 바꿀 것이 없다(경로 파라미터 없음).
14. `apps/server/static/legal/privacy.html`. 아래 문장을 **그대로** 넣는다. 위치는 앞의 문장 뒤다.
    - (a) 1.2 목록(`<li>녹음을 받아쓴 전사 ...`로 시작하는 줄 아래)에 새 `<li>`:
      `<li>캘린더 구독 정보: 이용자가 만든 캘린더 구독 주소(ICS)의 해시값(주소 원문은 저장하지 않습니다)과 만든 시각, 이메일 알림 설정과 알림 발송 기록(대상, 예정 시각, 발송 여부)</li>`
    - (b) 1.4 끝의 `<p>Google이 발급한 접근 토큰은 ...</p>` 뒤에 새 `<p>`:
      `<p>캘린더 구독 주소(ICS)는 이용자만 아는 비밀 주소입니다. 이 주소를 아는 사람은 확정한 일정의 제목과 시간을 볼 수 있으므로 다른 사람에게 알려 주지 마세요. 설정에서 주소를 다시 만들거나 없애면 이전 주소는 바로 열리지 않습니다. 비공개 녹음에서 찾은 일정은 그 녹음을 올린 이용자의 구독 주소에만 들어갑니다.</p>`
    - (c) 2번 목록의 첫 `<li>` 끝 `(연결한 경우) Google 캘린더 일정 등록`을 `(연결한 경우) Google 캘린더 일정 등록, (켠 경우) 일정·할 일 이메일 알림`으로 고친다.
    - (d) 3장 표에서 `Google 연동 토큰` 행 뒤에 두 행:
      `<tr><td>캘린더 구독 주소 정보</td><td>이용자가 주소를 없애거나 다시 만들 때까지, 또는 계정을 삭제할 때까지</td></tr>`
      `<tr><td>이메일 알림 기록</td><td>발송 후 90일, 또는 계정을 삭제할 때까지</td></tr>`
    - (e) 4장 Resend 행의 둘째 칸 `이메일 발송(가입·비밀번호 재설정 인증번호, 서비스 안내, 이용자가 켠 알림)`을 `이메일 발송(가입·비밀번호 재설정 인증번호, 서비스 안내, 이용자가 켠 일정·할 일 알림)`으로, 셋째 칸 `받는 사람 이메일 주소, 메일 내용(인증번호 등)`을 `받는 사람 이메일 주소, 메일 내용(인증번호, 알림 대상의 제목과 시각 등)`으로 고친다.
    - (f) 4장 Google LLC 둘째 행 넷째 칸은 이미 연결 해제 시 동작을 적었으므로 그대로 둔다. 인라인 스크립트·새 슬롯은 쓰지 않는다.
    "발송 후 90일"은 P4-05가 지키는 보관 규칙이다(P4-05 5단계).
15. `apps/server/test/legal.test.ts`에 테스트 하나를 더한다(6절).
16. `docs/runbooks/secret-rotation.md`. 1절 표의 `(P4·P5) Google OAuth ...` 행을 두 행으로 바꾼다: `Google OAuth 클라이언트 ID·시크릿 \`GOOGLE_OAUTH_CLIENT_ID\`, \`GOOGLE_OAUTH_CLIENT_SECRET\` | \`/etc/lectern/lectern.env\` | Google 캘린더 연결·(P5) Google 로그인 | 유출 의심, 연 1회`, 그리고 `Google 연동 토큰(refresh token) | DB integration.token_enc (호스트 봉인 키로 암호화) | 캘린더 동기화 | 호스트 봉인 키 교체 시 전부 무효`. 7절(호스트 봉인 키) 안에 경고 한 줄을 더한다: 봉인 키를 지우면 `integration.token_enc`를 못 열어 모든 Google 연동이 `needs_reauth`가 되고 사용자가 다시 연결해야 한다. 새 8절 "Google OAuth 클라이언트 시크릿"을 기존 8절 앞에 만든다(기존 8절은 9절로 번호를 올린다). 내용: ① Cloud 콘솔 → Google Auth Platform → Clients → 해당 클라이언트 → Add secret ② `sudoedit /etc/lectern/lectern.env`로 `GOOGLE_OAUTH_CLIENT_SECRET=` 교체 후 `sudo systemctl restart lectern`(외부 워커가 있으면 `lectern-worker`도) ③ 검증: 설정 → 연동 → Google 캘린더 연결이 동의 화면까지 가고 돌아오는지 ④ 콘솔에서 옛 secret을 비활성화·삭제. 사용자의 기존 refresh token은 클라이언트 secret을 바꿔도 유효하다고 적는다.
17. `docs/runbooks/google-oauth-verification.md` 3.5절 첫 항목의 `(예: ...)`를 확정 경로로 바꾼다: 리디렉션 URI는 `https://lectern.qucord.com/api/v2/integrations/google/callback`(로컬: `http://localhost:18775/api/v2/integrations/google/callback`).

## 6. 테스트

| 테스트 이름 | 준비 | 기대 |
|---|---|---|
| `packages/config/test/config.test.ts` "calendar flag defaults off" | `loadConfig({})` | `calendar === false` |
| 같은 파일 "calendar flag and Google secrets" | `loadConfig({ LECTERN_CALENDAR: "1", GOOGLE_OAUTH_CLIENT_ID: "id-x", GOOGLE_OAUTH_CLIENT_SECRET: "sec-y" })` | `calendar === true`; `JSON.stringify(c.raw)`에 `sec-y`·`id-x` 없음, `raw.GOOGLE_OAUTH_CLIENT_SECRET === "***"` |
| 같은 파일 "readSecret reads Google secrets live" | `process.env.GOOGLE_OAUTH_CLIENT_ID = "abc"` | `readSecret("GOOGLE_OAUTH_CLIENT_ID") === "abc"`; 지운 뒤 `undefined` |
| `packages/db/test/migrate.test.ts` fresh db | 새 DB에 `runMigrations` | `applied` 끝이 `"0006_p4_calendar"`; 네 테이블 존재; `PRAGMA table_info(reminder)`에 `send_at`,`state` |
| 같은 파일 "reminder is unique per user/target/time" | `reminder`에 같은 `(user_id,target_type,target_id,send_at)` 두 번 INSERT | 두 번째가 `UNIQUE` 오류 |
| 같은 파일 "calendar_feed token_hash unique" | 같은 `token_hash` 두 번 | 두 번째가 오류 |
| `packages/domain/test/api.test.ts`, `openapi.test.ts` | 기존 테스트 | `getCalendarFeed`·`createCalendarFeed`·`deleteCalendarFeed`가 `ROUTES`에 있고 `openapi.json`이 최신 |
| domain fixtures "WorkspaceSettings reminders" | `{ reminders: { email: true, lead_minutes: [1440] } }` 유효, `{ reminders: { email: true, lead_minutes: [] } }`·`{ reminders: { email: true, lead_minutes: [0] } }` 무효 | 파싱 결과 일치 |
| `apps/server/test/api-v2.test.ts` "answer 501" | 기존 테스트 | feed 3개가 401 아님·501 `not_implemented`, `details.operation_id` 일치 |
| `apps/server/test/legal.test.ts` "privacy page covers calendar and reminders" | `template("privacy")` | `캘린더 구독 주소(ICS)는 이용자만 아는 비밀 주소입니다`, `일정·할 일 알림`, `이메일 알림 기록`이 모두 포함된다 |
| 기존 `docs/env.md is up to date` | 기존 테스트 | 통과 |

## 7. 검증 명령

```bash
bun test packages/config packages/db packages/domain apps/server/test/legal.test.ts apps/server/test/api-v2.test.ts apps/server/test/v2-migration-rehearsal.test.ts
```
```bash
bash scripts/pipeline/gate.sh full
```

## 8. 하지 않는 것

- ICS 토큰 발급·`/cal/{token}.ics`: `P4-01`.
- OAuth 시작·콜백·연결 해제, 가짜 Google: `P4-02`.
- `calendar_sync` 작업: `P4-03`. 자동 등록: `P4-04`. 리마인더 작업과 메일: `P4-05`. `list_items`: `P4-06`. 웹: `P4-07`.
- `startGoogleIntegration`·`disconnectIntegration`을 구현하지 않는다(여전히 501).
- 기존 컬럼·enum 값을 바꾸지 않는다. `JobKind`에는 이미 `calendar_sync`, `reminder`가 있다.

## 9. 끝났다는 기준

- [ ] 6절의 테스트가 모두 있고 통과한다
- [ ] 7절의 게이트가 통과한다(플래그 끔/켬 preflight 둘 다)
- [ ] 바뀐 파일이 전부 소유 경로 안이다
- [ ] 실제 외부 호출이 없다
- [ ] 생성된 SQL에 `DROP`/`RENAME`이 없다
- [ ] `docs/env.md`가 `bun run config:docs`로 만든 것이다
- [ ] 방침 문장 (a)~(e)가 그대로 들어갔다

## 10. 명세 작성자 메모

- CONTRACTS §4의 feed 라우트에는 `workspace_id`가 없지만 토큰이 "사용자·워크스페이스마다"라서 쿼리/본문에 `workspace_id`를 더했다. 계약의 응답 `{ url, created_at }`는 `getCalendarFeed`에서 `exists`를 더해 `CalendarFeedInfo`로 정했다(계약 문구 "url은 null과 exists: true"를 따름).
- 마이그레이션 번호 `0004`/`0005`는 `P1-C`, `P3-C` 명세에서 가져온 가정이다. 실제 번호가 다르면 이 명세의 번호를 맞춘다.
- `calendar_feed`, `reminder`, `calendar_event_link`에 인덱스를 더했다(계약 DDL에는 없는 추가 인덱스, 추가만 하므로 D-0-4 위반 아님).
- `LECTERN_CALENDAR=1`이어도 `GOOGLE_OAUTH_*`가 없으면 Google 연결은 501이다(P4-02). 계약에는 시크릿 부재 동작이 `P4-02` 수용 기준에만 있다.
- 방침 "발송 후 90일" 보관 기간은 계약에 없다. 이 명세가 정했고 `P4-05`가 지킨다.
- 개인정보처리방침은 이미 Google 캘린더 연동·Resend 알림을 일부 서술하고 있어(계약 D-0-9 이전 작성분) 추가 문구만 넣는다.
