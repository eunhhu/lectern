# P5-C 계약: 계정 플래그, 테이블, 라우트, 방침

> 등급: `careful` · 게이트: `full` · 의존: `P4-C` · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `docs/runbooks/`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

계정 기능의 바닥을 깐다. 플래그 3개(`LECTERN_GOOGLE_LOGIN`, `LECTERN_APPLE_LOGIN`, `LECTERN_TEAMS`)와 Apple 로그인 시크릿 이름, 마이그레이션 `p5_accounts`(테이블 8개), 새 라우트 18개(서버는 501 스텁), `JobKind` 두 값, 방침 문구, 런북 항목을 넣는다. 동작은 바뀌지 않는다. 사용자가 보는 변화는 `/privacy` 문구뿐이다.

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` §0.1, §0.2, §0.3, §5 전체(D-P5-1~D-P5-10, DB `p5_accounts`, 라우트 표)
- 레시피: `RECIPES.md` R1, R2, R3, R4, R14
- 본보기: `docs/v2/pipeline/wp/P4-C.md` (같은 종류의 작업이다. 순서와 검사 방법을 그대로 따른다)
- 코드: `packages/config/src/index.ts` — `ENV`, `Config`, `loadConfig`, `readSecret`
- 코드: `packages/db/src/schema.ts`; `packages/domain/src/enums.ts`(`JobKind`, `MembershipRole`), `api/resources.ts`(`AccessTokenDto`, `Me`), `api/routes.ts`(`ROUTES`, `RouteDef.public`), `api/common.ts`(`ErrorCode`에 `quota_exceeded`가 이미 있다)
- 코드: `apps/server/src/api/v2/me.ts`, `workspaces.ts`, `admin.ts`, `index.ts`(`RESOURCE_ROUTERS`); `apps/server/test/api-v2.test.ts`(`NOT_YET`, `PATH_PARAMS`)
- 코드: `apps/server/static/legal/privacy.html`, `apps/server/test/legal.test.ts`; `docs/runbooks/secret-rotation.md`

## 3. 사전 점검

```bash
git grep -n "LECTERN_CALENDAR:" -- packages/config/src/index.ts
git grep -n "export const oauthState" -- packages/db/src/schema.ts
ls packages/db/migrations | grep -E "0006_p4_calendar"
git grep -n "\"quota_exceeded\"" -- packages/domain/src/api/common.ts
git grep -n "export const RESOURCE_ROUTERS\|const RESOURCE_ROUTERS" -- apps/server/src/api/v2/index.ts
git grep -n "Google 로그인" -- apps/server/static/legal/privacy.html
```
세 번째 줄에 파일이 안 나오면 멈춘다(`P4-C`가 먼저다).

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `packages/config/src/index.ts`, `test/config.test.ts` | 수정 | 플래그 3, 시크릿 3, 경로 1 |
| `docs/env.md` | 재생성 | `bun run config:docs` |
| `deploy/systemd/lectern.env.example`, `docs/v2/pipeline/flags-on.env` | 수정 | 설명과 기본값 / 켬 값 |
| `packages/db/src/schema.ts`, `migrations/0007_p5_accounts.sql`(+meta), `test/migrate.test.ts` | 수정·생성 | 테이블 8개 |
| `packages/domain/src/enums.ts`, `api/resources.ts`, `api/routes.ts`, `test/fixtures.ts`, `openapi.json` | 수정·재생성 | enum, DTO, 라우트 18개 |
| `apps/server/src/api/v2/me.ts`, `workspaces.ts`, `admin.ts`, `auth-native.ts`(새로), `index.ts`, `README.md` | 수정 | 501 스텁 등록 |
| `apps/server/test/api-v2.test.ts`, `v2-migration-rehearsal.test.ts`, `legal.test.ts` | 수정 | `NOT_YET`, `PATH_PARAMS`, 태그, 문구 |
| `apps/server/static/legal/privacy.html` | 수정 | 9단계 |
| `docs/runbooks/secret-rotation.md` | 수정 | Apple 로그인 키 항목 |

## 5. 단계

1. `packages/config/src/index.ts`. `LECTERN_CALENDAR` 묶음 뒤에 넣는다.
   ```ts
   LECTERN_GOOGLE_LOGIN: { schema: bool(false), description: "1: Google sign-in (button and /api/v2/auth/google/*). Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET" },
   LECTERN_APPLE_LOGIN: { schema: bool(false), description: "1: Sign in with Apple (button and /api/v2/auth/apple/*). Needs the APPLE_SIGNIN_* values" },
   LECTERN_TEAMS: { schema: bool(false), description: "1: team workspaces: invites, role changes and uploads into a team workspace. 0: those routes answer 501" },
   APPLE_SIGNIN_CLIENT_ID: { schema: optionalString, description: "Apple Services ID used as the OAuth client id", secret: true },
   APPLE_SIGNIN_TEAM_ID: { schema: optionalString, description: "Apple developer team id", secret: true },
   APPLE_SIGNIN_KEY_ID: { schema: optionalString, description: "Key id of the Sign in with Apple private key", secret: true },
   APPLE_SIGNIN_PRIVATE_KEY_FILE: { schema: optionalString, description: "Path of the Sign in with Apple .p8 private key file (the path, never the key)" },
   ```
   `Config`에 `googleLogin: boolean; appleLogin: boolean; teams: boolean; appleSignin: { privateKeyFile: string | null };`를 더하고 `loadConfig`에 잇는다. `readSecret`의 이름 유니온에 `APPLE_SIGNIN_CLIENT_ID`, `APPLE_SIGNIN_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`를 더한다.
2. `bun run config:docs`. `lectern.env.example`에는 캘린더 묶음 뒤에 아래를 넣는다.
   ```
   # 계정 (docs/v2/ARCHITECTURE.md §10). 전부 기본 꺼짐.
   # Google 로그인은 GOOGLE_OAUTH_CLIENT_ID/SECRET이 있어야 하고, Apple 로그인은 아래 네 값이 있어야 한다.
   LECTERN_GOOGLE_LOGIN=0
   LECTERN_APPLE_LOGIN=0
   LECTERN_TEAMS=0
   # APPLE_SIGNIN_CLIENT_ID=
   # APPLE_SIGNIN_TEAM_ID=
   # APPLE_SIGNIN_KEY_ID=
   # APPLE_SIGNIN_PRIVATE_KEY_FILE=/etc/lectern/apple-signin.p8
   ```
   `flags-on.env` 끝에 `LECTERN_GOOGLE_LOGIN=1`, `LECTERN_APPLE_LOGIN=1`, `LECTERN_TEAMS=1` 세 줄을 더한다(시크릿 없음. 시크릿이 없으면 로그인 라우트는 501·404로 답하므로 preflight는 통과해야 한다).
3. `packages/db/src/schema.ts`에 테이블 8개를 더한다. 열은 `CONTRACTS.md` §5 DDL 그대로다(이름 snake_case, 시각 epoch ms, `include_audio`는 `integer({ mode: "boolean" })`). 변수 이름: `oauthIdentity`, `authSessionMeta`, `accessToken`, `nativeSession`, `workspaceInvite`, `workspaceQuota`, `dataExport`, `accountDeletion`. 더하는 인덱스: `oauth_identity(user_id)`, `access_token(user_id)`, `native_session(user_id)`, `native_session(family_id)`, `workspace_invite(workspace_id)`, `data_export(user_id)`, `account_deletion(state, execute_after)`.
4. `bun run --cwd packages/db generate --name p5_accounts`. 생성 SQL에 `CREATE TABLE` 8개와 인덱스만 있고 `DROP`·`RENAME`·`ALTER`가 없는지 읽는다. 파일 이름이 `0007_p5_accounts`가 아니면 맞춘다(P4-C 7단계와 같은 방법). 두 테스트 파일의 기대 태그 목록 끝에 `"0007_p5_accounts"`를 더한다.
5. `packages/domain/src/enums.ts`: `JobKind`에 `"export"`, `"account_deletion"`을 끝에 더한다. 새 enum:
   ```ts
   export const IdentityProvider = named("IdentityProvider", z.enum(["google", "apple"]));
   export const DataExportState = named("DataExportState", z.enum(["queued", "running", "ready", "failed", "expired"]));
   ```
6. `packages/domain/src/api/resources.ts`에 DTO를 더한다(모두 `named`, 타입 export 포함).
   ```ts
   export const NativeTokenRequest = named("NativeTokenRequest", z.discriminatedUnion("grant_type", [
     z.object({ grant_type: z.literal("password"), email: z.string().min(1).max(320), password: z.string().min(1).max(1024),
                device_name: z.string().min(1).max(100).optional(), platform: z.enum(["ios", "macos", "android", "windows"]).optional() }),
     z.object({ grant_type: z.literal("refresh_token"), refresh_token: z.string().min(16).max(256) }),
   ]));
   export const NativeTokenResponse = named("NativeTokenResponse", z.object({
     token_type: z.literal("Bearer"), access_token: z.string(), refresh_token: z.string(), expires_in: z.number().int().positive(), user: Me }));
   export const RevokeNativeTokenRequest = named("RevokeNativeTokenRequest", z.object({ refresh_token: z.string().min(16).max(256) }));
   export const IdentityDto = named("Identity", z.object({ id: Id, provider: IdentityProvider, email: z.string().nullable(), created_at: Timestamp }));
   export const IdentityPage = pageOf("IdentityPage", IdentityDto);
   export const IdentityParams = z.object({ identity_id: Id });
   export const InviteDto = named("WorkspaceInvite", z.object({ id: Id, workspace_id: WorkspaceId, email: z.string(), role: MembershipRole, invited_by: UserId,
     created_at: Timestamp, expires_at: Timestamp, accepted_at: Timestamp.nullable(), revoked_at: Timestamp.nullable() }));
   export const InvitePage = pageOf("WorkspaceInvitePage", InviteDto);
   export const CreateInviteRequest = named("CreateInviteRequest", z.object({ email: z.email().max(320), role: z.enum(["admin", "member", "viewer"]) }));
   export const InviteParams = z.object({ workspace_id: WorkspaceId, invite_id: Id });
   export const AcceptInviteRequest = named("AcceptInviteRequest", z.object({ token: z.string().min(16).max(256) }));
   export const AcceptInviteResponse = named("AcceptInviteResponse", z.object({ workspace: Workspace, role: MembershipRole }));
   export const MemberParams = z.object({ workspace_id: WorkspaceId, user_id: UserId });
   export const UpdateMemberRequest = named("UpdateMemberRequest", z.object({ role: MembershipRole }));
   export const WorkspaceQuota = named("WorkspaceQuota", z.object({ audio_ms_month: z.number().int().nonnegative().nullable(),
     ai_microusd_month: z.number().int().nonnegative().nullable(), storage_bytes: z.number().int().nonnegative().nullable() }));
   export const WorkspaceUsage = named("WorkspaceUsage", z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), audio_ms: z.number().int().nonnegative(),
     ai_cost_microusd: z.number().int().nonnegative(), storage_bytes: z.number().int().nonnegative(), quota: WorkspaceQuota.nullable() }));
   export const DataExportDto = named("DataExport", z.object({ id: Id, workspace_id: WorkspaceId, include_audio: z.boolean(), state: DataExportState,
     bytes: z.number().int().nonnegative().nullable(), requested_at: Timestamp, ready_at: Timestamp.nullable(), expires_at: Timestamp.nullable(), error: z.string().nullable() }));
   export const DataExportPage = pageOf("DataExportPage", DataExportDto);
   export const CreateExportRequest = named("CreateExportRequest", z.object({ workspace_id: WorkspaceId, include_audio: z.boolean() }));
   export const ExportParams = z.object({ export_id: Id });
   export const RequestAccountDeletionRequest = named("RequestAccountDeletionRequest", z.object({ password: z.string().min(1).max(1024).optional() }));
   export const AccountDeletionInfo = named("AccountDeletionInfo", z.object({ state: z.enum(["none", "scheduled"]),
     requested_at: Timestamp.nullable(), execute_after: Timestamp.nullable() }));
   ```
   `Id`, `UserId`, `WorkspaceId`, `Timestamp`는 `primitives.ts`의 실제 이름으로 맞춘다(`git grep -n "export const .*Id = idSchema" -- packages/domain/src/primitives.ts`). 범용 id 스키마가 없으면 `idSchema("IdentityId", "sign-in identity")`처럼 종류별로 만든다.
7. `packages/domain/src/api/routes.ts`에 `RouteDef` 18개를 더한다. 경로·operationId는 `CONTRACTS.md` §5 라우트 표 그대로다.

   | operationId | 메서드·경로 | tag | 요청 | 응답 | errors | 기타 |
   |---|---|---|---|---|---|---|
   | `issueNativeToken` | `POST /auth/native/token` | `auth` | body `NativeTokenRequest` | 200 `NativeTokenResponse` | 400, 429 | `public: true` |
   | `revokeNativeToken` | `POST /auth/native/revoke` | `auth` | body `RevokeNativeTokenRequest` | 204 | 400 | `public: true` |
   | `listIdentities` | `GET /me/identities` | `me` | — | 200 `IdentityPage` | — | |
   | `unlinkIdentity` | `DELETE /me/identities/{identity_id}` | `me` | params | 204 | 404, 409 | |
   | `listInvites` | `GET /workspaces/{workspace_id}/invites` | `workspaces` | params | 200 `InvitePage` | 403, 404 | |
   | `createInvite` | `POST /workspaces/{workspace_id}/invites` | `workspaces` | body `CreateInviteRequest` | 201 `InviteDto` | 400, 403, 404, 409 | |
   | `revokeInvite` | `DELETE /workspaces/{workspace_id}/invites/{invite_id}` | `workspaces` | params | 204 | 403, 404 | |
   | `acceptInvite` | `POST /invites/accept` | `workspaces` | body `AcceptInviteRequest` | 200 `AcceptInviteResponse` | 400, 403, 404, 409, 429 | |
   | `updateMember` | `PATCH /workspaces/{workspace_id}/members/{user_id}` | `workspaces` | body `UpdateMemberRequest` | 200 `WorkspaceMember` | 400, 403, 404, 409 | |
   | `removeMember` | `DELETE /workspaces/{workspace_id}/members/{user_id}` | `workspaces` | params | 204 | 403, 404, 409 | |
   | `getWorkspaceUsage` | `GET /workspaces/{workspace_id}/usage` | `workspaces` | params | 200 `WorkspaceUsage` | 403, 404 | |
   | `adminSetQuota` | `PUT /admin/workspaces/{workspace_id}/quota` | `admin` | body `WorkspaceQuota` | 200 `WorkspaceQuota` | 400, 403, 404 | |
   | `createExport` | `POST /me/exports` | `me` | body `CreateExportRequest` | 202 `DataExportDto` | 400, 403, 409 | |
   | `listExports` | `GET /me/exports` | `me` | — | 200 `DataExportPage` | — | |
   | `getExportContent` | `GET /me/exports/{export_id}/content` | `me` | params | 200 `application/zip` 바이트 | 404, 409 | 바이트 응답은 `getAssetContent`의 정의 방식을 본뜬다 |
   | `requestAccountDeletion` | `POST /me/deletion` | `me` | body `RequestAccountDeletionRequest` | 200 `AccountDeletionInfo` | 400, 403, 409 | |
   | `cancelAccountDeletion` | `DELETE /me/deletion` | `me` | — | 200 `AccountDeletionInfo` | — | |
   | `getAccountDeletion` | `GET /me/deletion` | `me` | — | 200 `AccountDeletionInfo` | — | |

   `tag: "auth"`가 태그 목록에 없으면 다른 태그가 정의된 곳에 더한다. `test/fixtures.ts`에 새 DTO의 유효·무효 케이스를 더하고 `bun run domain:openapi`.
8. 서버 스텁: 모두 `notImplemented`.
   - `me.ts`: `listIdentities`, `unlinkIdentity`, `createExport`, `listExports`, `getExportContent`, `requestAccountDeletion`, `cancelAccountDeletion`, `getAccountDeletion`
   - `workspaces.ts`: `listInvites`, `createInvite`, `revokeInvite`, `acceptInvite`, `updateMember`, `removeMember`, `getWorkspaceUsage`
   - `admin.ts`: `adminSetQuota`
   - 새 파일 `auth-native.ts`: `export const authNativeRouter = defineRouter({ issueNativeToken: notImplemented, revokeNativeToken: notImplemented });`를 `RESOURCE_ROUTERS`에 더한다.
   - `api-v2.test.ts`: `NOT_YET`에 18개, `PATH_PARAMS`에 `identity_id`, `invite_id`, `user_id`, `export_id`(이미 있는 것은 빼고). 공개 라우트 두 개는 인증 없이도 501이어야 한다. `README.md` 상태 표에 18행.
9. `privacy.html`. 아래 문장을 그대로 넣는다.
   - (a) 1.2 목록 끝에: `<li>로그인·기기 정보: Google 또는 Apple로 로그인한 경우 그 서비스가 알려 주는 이용자 식별자와 이메일 주소, 로그인한 기기의 이름과 브라우저 정보(User-Agent), 마지막 사용 시각, 이용자가 만든 액세스 토큰의 해시값(토큰 원문은 저장하지 않습니다)</li>`
   - (b) 3장 표 끝에 두 행: `<tr><td>데이터 내보내기 파일</td><td>만든 뒤 7일</td></tr>`, `<tr><td>삭제를 요청한 계정</td><td>요청 후 7일(이 기간에는 취소할 수 있습니다). 그 뒤 계정과 개인 워크스페이스의 녹음·문서·파일을 지웁니다</td></tr>`
   - (c) 4장 표의 Resend 행 앞에 한 행: `<tr><td>Apple Inc. (미국)<br><a href="https://www.apple.com/legal/privacy/kr/">개인정보처리방침</a></td><td>Apple로 로그인(선택한 이용자만)</td><td>Apple이 알려 주는 이용자 식별자와 이메일 주소(이메일을 숨기면 Apple의 전달용 주소)</td><td>연결 해제 또는 계정 삭제까지</td></tr>`
   - (d) Resend 행 둘째 칸의 `서비스 안내,` 뒤에 `워크스페이스 초대,`를 넣는다.
   `legal.test.ts`에 "privacy page covers sign-in providers and account data" 테스트를 더한다: `Apple로 로그인(선택한 이용자만)`, `데이터 내보내기 파일`, `삭제를 요청한 계정`, `워크스페이스 초대`가 모두 있다.
10. `docs/runbooks/secret-rotation.md` 1절 표에 행 `Sign in with Apple 키 \`APPLE_SIGNIN_*\`, 키 파일 | \`/etc/lectern/lectern.env\`, \`/etc/lectern/apple-signin.p8\`(0600) | Apple 로그인 | 유출 의심, Apple 키 만료 시`를 더하고, 끝에 절 "Sign in with Apple 키"를 만든다: ① Apple Developer → Certificates, Identifiers & Profiles → Keys에서 새 키 발급(.p8은 한 번만 내려받을 수 있다) ② 서버에 0600으로 두고 `APPLE_SIGNIN_KEY_ID`를 바꾼 뒤 재시작 ③ Apple 로그인으로 들어가지는지 확인 ④ 옛 키를 Apple에서 폐기.

## 6. 테스트

| 테스트 이름 | 준비 | 기대 |
|---|---|---|
| config "account flags default off" | `loadConfig({})` | `googleLogin`, `appleLogin`, `teams` 모두 `false`, `appleSignin.privateKeyFile === null` |
| config "apple secrets are masked" | 네 값을 준다 | `raw`에 세 시크릿이 `***`, 파일 경로는 그대로 |
| migrate "fresh db" | 새 DB | `applied` 끝이 `0007_p5_accounts`, 테이블 8개 존재 |
| migrate "unique constraints" | `oauth_identity(provider, subject)`, `access_token.token_hash`, `native_session.refresh_hash`, `workspace_invite.token_hash` 중복 INSERT | 각각 오류 |
| domain "NativeTokenRequest" | password 형, refresh 형 유효. `grant_type: "x"` 무효 | 일치 |
| domain "CreateInviteRequest rejects owner" | `role: "owner"` | 무효 |
| domain routes/openapi | 기존 테스트 | 18개가 `ROUTES`에 있고 `openapi.json` 최신 |
| api-v2 "answer 501" | 기존 테스트 | 18개가 501. `issueNativeToken`은 쿠키 없이도 501 |
| legal | 9단계 | 통과 |

## 7. 검증 명령

```bash
bun test packages/config packages/db packages/domain apps/server/test/legal.test.ts apps/server/test/api-v2.test.ts apps/server/test/v2-migration-rehearsal.test.ts
```
```bash
bash scripts/pipeline/gate.sh full
```

## 8. 하지 않는 것

- 어떤 라우트도 구현하지 않는다(`P5-01`~`P5-09`).
- `auth.ts`를 고치지 않는다. v1 테이블(`users`, `sessions`)을 고치지 않는다.
- OAuth 로그인 콜백(`/api/v2/auth/{google|apple}/…`)은 domain 밖이다. 여기서 만들지 않는다(`P5-04`, `P5-05`).

## 9. 끝났다는 기준

- [ ] 6절의 테스트가 통과한다
- [ ] 게이트가 통과한다(플래그 끔·켬 preflight 둘 다)
- [ ] 생성된 SQL에 `DROP`/`RENAME`/`ALTER`가 없다
- [ ] 방침 문장 (a)~(d)가 그대로 들어갔다

## 10. 명세 작성자 메모

- 계약의 라우트 표에는 요청·응답 모양이 일부만 있다. 6단계의 DTO는 이 명세가 정했다. 이후 P5 명세들이 이 이름을 쓴다.
- `createAccessToken`, `revokeAccessToken`은 이미 domain에 있다(여기서 더하지 않는다).
- 방침의 절 번호(1.2, 3장, 4장)는 P4-C 명세가 쓴 번호와 같다. 실제 HTML의 구조가 다르면 같은 뜻의 자리에 넣고 `DEVIATIONS`에 적는다.
- `adminSetQuota`의 `{workspace_id}` 경로는 운영자 전용이라 `requireWorkspace`를 쓰지 않는다(P5-07).
