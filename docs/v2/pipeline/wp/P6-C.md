# P6-C 계약: APNs 설정, 테이블, 라우트, 방침

> 등급: `careful` · 게이트: `full` · 의존: `P5-C` · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `docs/runbooks/`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

네이티브 앱이 쓸 서버 기능의 바닥을 깐다. APNs 설정과 플래그, 유니버설 링크용 `APPLE_APP_IDS`, v1 폐기용 변수 두 개, 마이그레이션 `p6_devices`(테이블 4개), 새 라우트 8개(서버는 501 스텁), 방침의 APNs 항목, 런북 항목을 넣는다. 동작은 바뀌지 않는다.

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` §0.1, §0.2, §0.3, §6.1 전체(D-P6-1~D-P6-6, D-P6-12, DB `p6_devices`, 라우트 표)
- 레시피: `RECIPES.md` R1, R2, R3, R4, R14
- 본보기: `docs/v2/pipeline/wp/P4-C.md`, `P5-C.md` (같은 종류의 작업. 순서와 검사 방법을 그대로 따른다)
- 코드: `packages/config/src/index.ts`, `packages/db/src/schema.ts`, `packages/domain/src/api/resources.ts`·`routes.ts`
- 코드: `apps/server/src/api/v2/me.ts`, `recordings.ts`, `admin.ts`; `apps/server/test/api-v2.test.ts`
- 코드: `apps/server/static/legal/privacy.html`, `apps/server/test/legal.test.ts`; `docs/runbooks/secret-rotation.md`
- 문서: `docs/v2/NATIVE.md` §6

## 3. 사전 점검

```bash
git grep -n "LECTERN_TEAMS:" -- packages/config/src/index.ts
ls packages/db/migrations | grep -E "0007_p5_accounts"
git grep -n "export const accountDeletion" -- packages/db/src/schema.ts
git grep -n "Apple로 로그인(선택한 이용자만)" -- apps/server/static/legal/privacy.html
```
둘째 줄에 파일이 안 나오면 멈춘다(`P5-C`가 먼저다).

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `packages/config/src/index.ts`, `test/config.test.ts` | 수정 | 변수 9개 |
| `docs/env.md`, `deploy/systemd/lectern.env.example`, `docs/v2/pipeline/flags-on.env` | 재생성·수정 | |
| `packages/db/src/schema.ts`, `migrations/0008_p6_devices.sql`(+meta), `test/migrate.test.ts` | 수정·생성 | 테이블 4개 |
| `packages/domain/src/api/resources.ts`, `routes.ts`, `test/fixtures.ts`, `openapi.json` | 수정·재생성 | DTO, 라우트 8개 |
| `apps/server/src/api/v2/me.ts`, `recordings.ts`, `admin.ts`, `README.md` | 수정 | 501 스텁 |
| `apps/server/test/api-v2.test.ts`, `v2-migration-rehearsal.test.ts`, `legal.test.ts` | 수정 | |
| `apps/server/static/legal/privacy.html` | 수정 | 8단계 |
| `docs/runbooks/secret-rotation.md` | 수정 | APNs 키 항목 |

## 5. 단계

1. `packages/config/src/index.ts`. 계정 묶음 뒤에 넣는다.
   ```ts
   LECTERN_APNS: { schema: bool(false), description: "1: send Apple push notifications (Live Activity updates, document-ready alerts). Needs the APNS_* values" },
   APNS_TEAM_ID: { schema: optionalString, description: "Apple developer team id for APNs token auth", secret: true },
   APNS_KEY_ID: { schema: optionalString, description: "Key id of the APNs .p8 key", secret: true },
   APNS_PRIVATE_KEY_FILE: { schema: optionalString, description: "Path of the APNs .p8 private key file (the path, never the key)" },
   APNS_TOPIC_IOS: { schema: optionalString, description: "Bundle id of the iOS app, used as the APNs topic" },
   APNS_ENV: { schema: z.enum(["sandbox", "production"]).default("sandbox"), description: "APNs host: sandbox (api.sandbox.push.apple.com) or production (api.push.apple.com)" },
   APPLE_APP_IDS: { schema: optionalString, description: "Comma-separated TEAMID.bundle.id list served in /.well-known/apple-app-site-association. Empty: the route answers 404" },
   LECTERN_V1_SUNSET: { schema: optionalString, description: "YYYY-MM-DD. When set, v1 API responses carry Deprecation and Sunset headers" },
   LECTERN_V1_BLOCK: { schema: bool(false), description: "1: after the LECTERN_V1_SUNSET date, the retired v1 endpoints answer 410" },
   ```
   `Config`에 더한다.
   ```ts
   apns: { enabled: boolean; privateKeyFile: string | null; topicIos: string | null; env: "sandbox" | "production" };
   appleAppIds: string[];                         // trimmed, empty entries dropped
   v1: { sunset: string | null; block: boolean }; // sunset is null unless it matches /^\d{4}-\d{2}-\d{2}$/ and is a real date
   ```
   `readSecret` 이름 유니온에 `APNS_TEAM_ID`, `APNS_KEY_ID`. `APPLE_APP_IDS` 항목은 `/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/`에 맞는 것만 남긴다. 형식이 틀린 `LECTERN_V1_SUNSET`은 설정 오류로 시작을 막지 말고 `null`로 둔다(기존 변수의 틀린 값 처리 방식과 다르면 기존 방식을 따른다).
2. `bun run config:docs`. `lectern.env.example`에 묶음을 더한다.
   ```
   # 네이티브 앱 (docs/v2/NATIVE.md §6). 전부 기본 꺼짐.
   # APNs: 키 파일(.p8)은 0600으로 따로 두고 경로만 적는다.
   LECTERN_APNS=0
   # APNS_TEAM_ID=
   # APNS_KEY_ID=
   # APNS_PRIVATE_KEY_FILE=/etc/lectern/apns.p8
   # APNS_TOPIC_IOS=com.qucord.lectern.ios
   APNS_ENV=sandbox
   # 유니버설 링크: TEAMID.번들ID 목록. 비우면 /.well-known/apple-app-site-association이 404다.
   # APPLE_APP_IDS=
   # v1 API 폐기: 날짜를 넣으면 v1 응답에 Deprecation/Sunset 헤더가 붙는다.
   # 차단(410)은 관리자 콘솔의 v1 사용량이 0인 것을 확인한 뒤에만 켠다.
   # LECTERN_V1_SUNSET=
   LECTERN_V1_BLOCK=0
   ```
   `flags-on.env` 끝에 `LECTERN_APNS=1` 한 줄을 더한다(키가 없으면 발송기는 연결하지 않으므로 preflight는 통과해야 한다). `LECTERN_V1_BLOCK`과 `LECTERN_V1_SUNSET`은 `flags-on.env`에 넣지 않는다(v1 계약 점검을 깨뜨린다).
3. `packages/db/src/schema.ts`에 테이블 4개를 더한다(`CONTRACTS.md` §6.1 DDL 그대로): `pushDevice`, `liveActivity`, `recordingMarker`, `v1Usage`. 더하는 인덱스: `push_device(user_id)`, `live_activity(recording_id)`, `recording_marker(recording_id, at_ms)`. `v1_usage`의 기본 키는 `(day, route, client)` 복합 키다.
4. `bun run --cwd packages/db generate --name p6_devices` → `0008_p6_devices`. 생성 SQL을 읽는다(`CREATE`만). 두 테스트의 기대 목록에 태그를 더한다.
5. `packages/domain/src/api/resources.ts`
   ```ts
   export const PushPlatform = named("PushPlatform", z.enum(["ios", "macos"]));
   export const UpsertPushDeviceRequest = named("UpsertPushDeviceRequest", z.object({ platform: PushPlatform,
     apns_token: z.string().regex(/^[0-9a-fA-F]{32,400}$/), push_to_start_token: z.string().regex(/^[0-9a-fA-F]{32,400}$/).nullable().optional(),
     name: z.string().min(1).max(100).optional(), app_version: z.string().min(1).max(40).optional() }));
   export const PushDeviceDto = named("PushDevice", z.object({ id: Id, platform: PushPlatform, name: z.string().nullable(), app_version: z.string().nullable(),
     created_at: Timestamp, last_seen_at: Timestamp }), "A device registered for push. Tokens are never returned.");
   export const PushDeviceParams = z.object({ device_id: Id });
   export const SetLiveActivityRequest = named("SetLiveActivityRequest", z.object({ device_id: Id, push_token: z.string().regex(/^[0-9a-fA-F]{32,400}$/) }));
   export const EndLiveActivityQuery = z.object({ device_id: Id });
   export const MarkerDto = named("RecordingMarker", z.object({ id: Id, recording_id: RecordingId, at_ms: z.number().int().nonnegative(), label: z.string().nullable(),
     created_by: UserId, created_at: Timestamp }));
   export const MarkerPage = pageOf("RecordingMarkerPage", MarkerDto);
   export const CreateMarkerRequest = named("CreateMarkerRequest", z.object({ at_ms: z.number().int().nonnegative().max(86_400_000), label: z.string().min(1).max(80).optional() }));
   export const MarkerParams = z.object({ recording_id: RecordingId, marker_id: Id });
   export const V1UsageQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
   export const V1UsageRow = named("V1UsageRow", z.object({ day: z.string(), route: z.string(), client: z.string(), count: z.number().int().nonnegative() }));
   export const V1UsagePage = pageOf("V1UsagePage", V1UsageRow);
   ```
   id 스키마 이름은 `primitives.ts`의 실제 이름에 맞춘다(P5-C 6단계와 같은 방법).
6. `routes.ts`에 8개를 더한다.

   | operationId | 메서드·경로 | tag | 요청 | 응답 | errors |
   |---|---|---|---|---|---|
   | `upsertPushDevice` | `PUT /me/push-devices/{device_id}` | `me` | body `UpsertPushDeviceRequest` | 200 `PushDeviceDto` | 400, 409 |
   | `deletePushDevice` | `DELETE /me/push-devices/{device_id}` | `me` | params | 204 | 404 |
   | `setLiveActivity` | `PUT /recordings/{recording_id}/live-activity` | `recordings` | body `SetLiveActivityRequest` | 204 | 400, 404 |
   | `endLiveActivity` | `DELETE /recordings/{recording_id}/live-activity` | `recordings` | query `EndLiveActivityQuery` | 204 | 404 |
   | `listMarkers` | `GET /recordings/{recording_id}/markers` | `recordings` | params | 200 `MarkerPage` | 404 |
   | `createMarker` | `POST /recordings/{recording_id}/markers` | `recordings` | body `CreateMarkerRequest` | 201 `MarkerDto` | 400, 403, 404, 409 |
   | `deleteMarker` | `DELETE /recordings/{recording_id}/markers/{marker_id}` | `recordings` | params | 204 | 403, 404 |
   | `adminListV1Usage` | `GET /admin/v1-usage` | `admin` | query `V1UsageQuery` | 200 `V1UsagePage` | 400, 403 |

   `{device_id}`는 **클라이언트가 만든 id**다(앱이 처음 실행될 때 만든 UUID. `PUT`이 등록과 갱신을 겸한다). `test/fixtures.ts`에 케이스를 더하고 `bun run domain:openapi`.
7. 서버 스텁(`notImplemented`): `me.ts`에 `upsertPushDevice`, `deletePushDevice` / `recordings.ts`에 `setLiveActivity`, `endLiveActivity`, `listMarkers`, `createMarker`, `deleteMarker` / `admin.ts`에 `adminListV1Usage`. `api-v2.test.ts`의 `NOT_YET`에 8개, `PATH_PARAMS`에 `marker_id`(와 필요하면 `device_id`). `README.md` 표 8행.
8. `privacy.html`
   - (a) 1.2 목록 끝에: `<li>앱 알림 정보(Apple 기기용 앱에서 알림을 켠 경우): 기기 이름, 푸시 알림 토큰, 앱 버전, 녹음 중에 누른 "중요" 표시의 시각</li>`
   - (b) 4장 표의 Apple 행(로그인) 뒤에 한 행: `<tr><td>Apple Inc. (미국)</td><td>푸시 알림과 실시간 현황(Live Activity) 전달(Apple 기기용 앱에서 알림을 켠 이용자만)</td><td>기기 푸시 토큰, 알림 내용(녹음 제목, 처리 단계)</td><td>전달 후 Apple의 보관 정책에 따름. 기기 토큰은 로그아웃하거나 계정을 삭제하면 지웁니다</td></tr>`
   - (c) 3장 표 끝에: `<tr><td>앱 알림 정보</td><td>앱에서 로그아웃하거나 기기를 지울 때까지, 또는 계정을 삭제할 때까지</td></tr>`
   `legal.test.ts`에 "privacy page covers push notifications": `푸시 알림과 실시간 현황(Live Activity) 전달`, `앱 알림 정보`가 있다.
9. `docs/runbooks/secret-rotation.md` 1절 표에 `APNs 키 \`APNS_*\`, 키 파일 | \`/etc/lectern/lectern.env\`, \`/etc/lectern/apns.p8\`(0600) | 푸시 알림, Live Activity | 유출 의심 시(APNs 키는 만료되지 않는다)`를 더하고, 절 "APNs 키"를 만든다: ① Apple Developer → Keys에서 APNs 키를 새로 발급(.p8은 한 번만 내려받는다) ② 서버에 0600으로 두고 `APNS_KEY_ID`를 바꾼 뒤 재시작 ③ 앱에서 알림이 오는지 확인 ④ 옛 키를 Apple에서 폐기. 팀당 APNs 키는 두 개까지라는 점을 적는다.

## 6. 테스트

| 테스트 이름 | 준비 | 기대 |
|---|---|---|
| config "native flags default off" | `loadConfig({})` | `apns.enabled === false`, `apns.env === "sandbox"`, `appleAppIds` 빈 배열, `v1.sunset === null`, `v1.block === false` |
| config "APPLE_APP_IDS parsing" | `"ABCDE12345.com.qucord.lectern.ios, bad, ABCDE12345.com.qucord.lectern.macos"` | 유효한 두 개만 |
| config "LECTERN_V1_SUNSET must be a date" | `"2027-03-01"` / `"soon"` / `"2027-02-31"` | 그 값 / `null` / `null` |
| config "APNs secrets are masked" | 값을 준다 | `raw`에서 팀 id·키 id가 `***` |
| migrate "fresh db" | 새 DB | 끝이 `0008_p6_devices`, 테이블 4개 |
| migrate "constraints" | 같은 `apns_token` 두 번, 같은 `(recording_id, device_id)` 두 번, 같은 `(day, route, client)` 두 번 | 각각 오류 |
| domain "push token must be hex" | `apns_token: "zz"` | 무효 |
| domain routes/openapi | 기존 테스트 | 8개가 있고 최신 |
| api-v2 "answer 501" | 기존 테스트 | 8개가 501 |
| legal | 8단계 | 통과 |

## 7. 검증 명령

```bash
bun test packages/config packages/db packages/domain apps/server/test/legal.test.ts apps/server/test/api-v2.test.ts apps/server/test/v2-migration-rehearsal.test.ts
```
```bash
bash scripts/pipeline/gate.sh full
```

## 8. 하지 않는 것

- 라우트 구현(`P6-01`), APNs 발송(`P6-02`), `apple-app-site-association`과 v1 헤더·집계(`P6-03`).
- 온디바이스 결과 업로드 필드(NATIVE §6. D-P6-10으로 만들지 않는다).
- IETF 재개 가능 업로드(D-P6-6으로 하지 않는다).

## 9. 끝났다는 기준

- [ ] 6절의 테스트가 통과한다
- [ ] 게이트가 통과한다(플래그 끔·켬 preflight 둘 다)
- [ ] 생성된 SQL에 `DROP`/`RENAME`/`ALTER`가 없다
- [ ] 방침 문장 (a)~(c)가 그대로 들어갔다

## 10. 명세 작성자 메모

- 계약의 라우트 표에는 요청·응답 모양이 일부만 있다. 5단계의 DTO는 이 명세가 정했다.
- macOS 앱의 APNs 토픽 변수(`APNS_TOPIC_MACOS`)는 계약에 없어 넣지 않았다. macOS 푸시가 필요해지면 계약을 늘린다(STATUS에 적는다).
- `endLiveActivity`가 `DELETE`에 쿼리(`device_id`)를 받는 것은 `DELETE` 본문을 피하려는 선택이다.
