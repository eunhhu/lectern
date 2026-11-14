# API v2 (`/api/v2`)

`packages/domain`의 라우트 표(`src/api/routes.ts`, `openapi.json`)에 있는 엔드포인트를 모두 올린다. P2부터는 픽스처가 아니라 `packages/db`의 v2 테이블을 읽고 쓴다. 뒤 단계 기능 2개(P5)는 아직 `501 not_implemented`다.

## 요청 처리 순서

모든 라우트는 리소스 라우터(`me.ts`, `recordings.ts` …)가 `defineRouter()`로 domain의 `RouteDef`에서 메서드·경로·스키마를 읽어 등록한다. 경로를 이 디렉터리에 다시 적지 않는다.

1. **인증(401)**: v1과 같은 `authenticateRequest()`(`../../auth.ts`)를 쓴다. `lectern_session` 쿠키, `Authorization: Bearer`, `X-Lectern-Token`, `?token=`을 받는다.
2. **운영자 확인(403)**: `admin` 태그 라우트는 v1 `isAdminUser()`가 참이어야 한다.
3. **검증(400·428)**: params, query, 헤더, JSON 본문을 domain 스키마로 검증한다. 실패하면 `validation_failed`이고 `details.issues[].path` 앞에 `params`/`query`/`headers`/`body`가 붙는다. JSON 본문은 `Content-Type: application/json`이어야 한다(교차 사이트 HTML 폼 차단). `If-Match`가 필수인 라우트에서 헤더가 없으면 428이다.
4. **처리**: 응답은 라우트의 응답 스키마로 `parse()`한 뒤 보낸다. 통과하지 못하면 500 `internal`이다.

모든 요청 앞에서 `syncPendingLectures()`가 db.ts를 거치지 않은 강의 쓰기(압축 등)를 v2 행에 반영한다. 응답에는 `Cache-Control: no-store`가 붙는다. 등록되지 않은 `/api/v2/*`는 v2 형식의 404다. `GET /api/v2/openapi.json`은 인증 없이 열린다.

## 데이터: v1 강의와 v2 행

녹음 처리는 아직 v1 파이프라인(강의 하나 = Gemini 호출 하나)이다. 그래서 강의 하나가 v2 행 여러 개로 존재하고(ARCHITECTURE §5.3), 두 쪽을 같은 상태로 유지한다.

- **lectures → v2**: `packages/db` `legacy.ts`의 `projectLecture()`가 맞춘다. db.ts의 강의 쓰기 함수가 끝날 때마다 부르고, `lectures` 트리거가 db.ts 밖의 쓰기를 `lecture_sync_pending`에 표시한다.
  - 녹음 제목, 상태, 길이, 실패 이유
  - 과목 이름 → 폴더 (같은 이름 폴더를 찾고, 없으면 루트에 만든다)
  - Markdown → `legacy-markdown` 문서의 새 버전
  - 오디오 → asset
  - 공유 토큰·공개 여부 → share link
- **v2 → lectures**: v2 쓰기가 같은 IMMEDIATE 트랜잭션에서 강의에도 쓴다(`store.ts` `mirrorRecording`, db.ts `mirrorRecordingToLecture`). 그래서 그 뒤 투영은 바꿀 것이 없다.
  - 녹음 제목
  - 폴더 → 과목. v1 과목은 폴더의 이름이고, 폴더가 없으면 `미분류`다
  - legacy 문서 저장 → `updateLectureMarkdown`. 아카이브 파일과 물어보기 색인도 따라간다
  - 녹음 삭제 → `deleteLectureById`
- **업로드**: 새 녹음은 강의도 함께 만든다(`ingest.ts`, v1 ingest도 같은 함수). `recorded_at`은 클라이언트 값, 없으면 미디어의 `creation_time`, 그것도 없으면 업로드 시각이다.
- **오디오 digest**: v1 `audio_sha256`은 클라이언트의 멱등 키일 수 있어서 쓰지 않는다. 이전된 오디오의 `sha256`은 상세를 처음 열 때나 5분마다 도는 백그라운드 작업이 파일에서 계산한다(`store.ts` `ensureAssetDigest`). 파일이 없는 asset은 응답에서 빠진다.

## 권한

`access.ts`의 `can()`가 정책의 전부다. 표 테스트는 `test/api-v2-access.test.ts`에 있다.

- 비멤버는 아무것도 못 한다.
- 멤버는 워크스페이스, 폴더, 태그, 멤버 목록을 읽는다.
- owner·admin·member는 녹음을 만들고 폴더와 태그를 고친다. viewer는 읽기만 한다.
- `private` 녹음은 역할과 상관없이 만든 사람만 본다.
- 녹음을 고치거나 지우는 사람은 만든 사람, 그리고 `workspace` 공개일 때의 owner·admin이다.
- 보이지 않는 녹음은 403이 아니라 404다(존재를 알리지 않는다).
- 시스템 운영자(`users.role`)라고 남의 워크스페이스를 볼 수 있지는 않다.

## 엔드포인트 상태

| 메서드·경로 | operationId | 상태 | 비고 |
|---|---|---|---|
| `GET /me` | `getMe` | 실제 | `personal_workspace_id` = `wsp_<user id>`, `timezone`은 `users.timezone` |
| `PATCH /me` | `updateMe` | 실제 | 표시 이름, 시간대 |
| `GET /me/devices` | `listDevices` | 실제 | v1 로그인 세션. 기기 이름·UA는 P5(`auth_session`)까지 null |
| `DELETE /me/devices/{device_id}` | `revokeDevice` | 실제 | 그 세션 로그아웃 |
| `GET /me/tokens` | `listAccessTokens` | 실제 | v1 API 토큰 하나(앞 8자만) |
| `POST /me/tokens` | `createAccessToken` | 501 | PAT는 P5 |
| `DELETE /me/tokens/{token_id}` | `revokeAccessToken` | 501 | P5. v1 `rotate-token`이 대신한다 |
| `GET /workspaces` | `listWorkspaces` | 실제 | 개인 워크스페이스가 먼저 |
| `POST /workspaces` | `createWorkspace` | 실제 | 팀 워크스페이스(초대는 P5) |
| `GET /workspaces/{workspace_id}` | `getWorkspace` | 실제 | 비멤버는 403 |
| `PATCH /workspaces/{workspace_id}` | `updateWorkspace` | 실제 | owner·admin |
| `GET /workspaces/{workspace_id}/members` | `listWorkspaceMembers` | 실제 | |
| `GET /folders` | `listFolders` | 실제 | 평면 목록, `sort_key` 순 |
| `POST /folders` | `createFolder` | 실제 | 같은 부모 아래 같은 이름(공백·대소문자 무시)이면 409 |
| `PATCH /folders/{folder_id}` | `updateFolder` | 실제 | 자기·하위로 이동하면 409. 이름을 바꾸면 v1 과목도 바뀐다 |
| `DELETE /folders/{folder_id}` | `deleteFolder` | 실제 | 녹음과 하위 폴더는 부모로 |
| `GET /views` 외 3개 | `listSavedViews` 등 | 실제 | 저장한 사람만 본다 |
| `GET /tags` | `listTags` | 실제 | |
| `POST /tags` | `createTag` | 실제 | 같은 이름이면 409 |
| `PATCH /tags/{tag_id}` | `updateTag` | 실제 | |
| `DELETE /tags/{tag_id}` | `deleteTag` | 실제 | 녹음에서도 떼어진다 |
| `POST /uploads` | `createUpload` | 실제 | 개인 워크스페이스만. 새 녹음은 오디오 1개. 파트 8 MiB. `Idempotency-Key` |
| `GET /uploads/{upload_id}` | `getUpload` | 실제 | 받은 파트 목록(재개) |
| `PUT /uploads/{upload_id}/parts/{part}` | `putUploadPart` | 실제 | 디스크로 스트리밍. 크기가 틀리면 400/413. 다시 보내면 덮어쓴다 |
| `POST /uploads/{upload_id}/complete` | `completeUpload` | 실제 | 파트를 합치고 SHA-256 확인, 녹음+강의 생성, 처리 작업 등록. 같은 오디오면 `deduplicated` |
| `DELETE /uploads/{upload_id}` | `abortUpload` | 실제 | |
| `GET /recordings` | `listRecordings` | 실제 | 폴더(하위 포함)·미분류·태그(모두)·종류·상태·제목·기간 필터, 정렬 4가지 |
| `POST /recordings/batch` | `batchRecordings` | 실제 | move·add_tags·remove_tags·delete, 항목별 결과 |
| `GET /recordings/{recording_id}` | `getRecording` | 실제 | `progress`, `failure` 포함 |
| `PATCH /recordings/{recording_id}` | `updateRecording` | 실제 | `tag_ids`는 AI 태그까지 교체. `recorded_at`을 주면 `client` |
| `DELETE /recordings/{recording_id}` | `deleteRecording` | 실제 | 강의·파일·아카이브·색인까지 |
| `GET /recordings/{recording_id}/transcript` | `getTranscript` | 실제 | 이전된 강의는 빈 전사 |
| `PATCH /recordings/{recording_id}/speakers/{speaker_id}` | `updateSpeaker` | 실제 | |
| `GET /recordings/{recording_id}/documents` | `listRecordingDocuments` | 실제 | |
| `GET /recordings/{recording_id}/questions` | `listRecordingQuestions` | 실제 | 폐기 예정, 비어 있음 |
| `GET /recordings/{recording_id}/events` | `listRecordingEvents` | 실제 | P4 전까지 비어 있음 |
| `GET /recordings/{recording_id}/action-items` | `listRecordingActionItems` | 실제 | |
| `POST /recordings/{recording_id}/reprocess` | `reprocessRecording` | 실제 | `full`은 오디오부터 다시(`LECTERN_PIPELINE=v2`면 `process`, 아니면 v1 재분석). `document`는 저장된 전사로 노트만 다시 만든다(`regenerate`, 새 문서 버전; 전사가 없으면 409). `dry_run`은 추정 비용 |
| `DELETE /recordings/{recording_id}/audio` | `deleteRecordingAudio` | 실제 | 오디오만 지운다(전사·문서·노트·검색 색인은 남음). v1 강의는 `deleteLectureAudioOnly` 뒤 투영, `file:` 오디오 asset은 uploads 안의 파일과 행을 지움. 이미 없으면 204 |
| `GET /assets/{asset_id}/content` | `getAssetContent` | 실제 | Range, 확장자 기준 MIME, `?token=` 가능 |
| `GET /assets/{asset_id}/pages` | `listAssetPages` | 실제 | `LECTERN_PDF=1`일 때만(아니면 501). `process`의 `pdf_ingest`가 채운 쪽마다 글자 층 유무와 글자 수, `scanned` |
| `POST /assets/{asset_id}/ocr` | `ocrAsset` | 실제 | `LECTERN_PDF=1`일 때만(아니면 501). `dry_run: true`는 글자 없는 쪽 수와 추정 비용만(모델·큐를 건드리지 않음). `false`는 `pdf_ocr` 작업을 넣고 202(API에서는 `kind: "process"`). 쪽을 아직 못 읽었으면 409, 서버 키가 없으면 503, 녹음을 바꿀 권한이 없으면 403 |
| `GET /recordings/{recording_id}/alignment` | `getRecordingAlignment` | 실제 | `LECTERN_PDF=1`일 때만(아니면 501). 마지막 `process`의 `align`(모델 없음)이 만든 2분 창마다 상위 3쪽과 점수. 아직 없으면 `windows: []` |
| `GET /documents/{document_id}` | `getDocument` | 실제 | `ETag: "<current_version>"` |
| `GET /documents/{document_id}/versions` | `listDocumentVersions` | 실제 | 최신순, 본문 제외 |
| `GET /documents/{document_id}/versions/{version}` | `getDocumentVersion` | 실제 | |
| `POST /documents/{document_id}/versions` | `createDocumentVersion` | 실제 | `If-Match` 낙관적 잠금, 오래되면 412. legacy 문서는 `markdown`, 구조화 문서는 `body`(바뀐 블록에 `edited`) |
| `GET /documents/{document_id}/export` | `exportDocument` | 실제 | `format=md`만. 현재 버전의 `rendered_md`를 `text/markdown` 첨부(`filename*=UTF-8''<제목>.md`)로 |
| `GET /action-items` | `listActionItems` | 실제 | 마감 빠른 순 |
| `PATCH /action-items/{action_item_id}` | `updateActionItem` | 실제 | |
| `GET /jobs/{job_id}` | `getJob` | 실제 | v1 `distill`은 `process`. 시스템 작업은 404 |
| `POST /jobs/{job_id}/cancel` | `cancelJob` | 실제 | `process`·`regenerate`·`distill`만. 대기 중이면 바로 `canceled`, 실행 중이면 다음 단계 전에 멈춘다(응답은 아직 `running`). 남의 작업은 404, 끝난 작업은 409 |
| `GET /search` | `search` | 실제 | 물어보기 색인이 있으면(`LECTERN_ASK=1`) `packages/ask`의 하이브리드 검색(BM25 + 벡터): 전사·문서·PDF 쪽 적중, 제목 일치가 맨 앞, 최대 50개. legacy 문서 적중의 `block_id`는 문단 `md-<n>`. `LECTERN_ASK=0`이면 제목·문서·전사의 부분 문자열 |
| `/ask/*` 6개 | `createAskThread` 등 | 실제(`LECTERN_ASK=1`), 꺼지면 501 | 개인 워크스페이스의 색인 위. 범위는 v2 녹음·폴더 |
| `GET /ask/suggestions` | `listAskSuggestions` | 실제 | 규칙으로 만든 질문 최대 6개(모델 호출 없음, `LECTERN_ASK`와 무관). 녹음 범위는 도메인 질문 + 문서 섹션 제목 |
| `GET /calendar/suggestions` | `listCalendarSuggestions` | 실제 | `statuses`, 기간 |
| `PATCH /calendar/suggestions/{event_candidate_id}` | `updateCalendarSuggestion` | 실제 | 바꾼 뒤 워크스페이스의 Google 연동마다 `calendar_sync`를 넣는다(`LECTERN_CALENDAR=1`). `synced` 일정도 고치거나 무시할 수 있다(Google 쪽이 따라간다). `synced`에 `accepted`를 보내면 그대로 `synced` |
| `POST /calendar/suggestions/batch` | `batchCalendarSuggestions` | 실제 | 같은 규칙. `synced`를 수락하면 바뀌는 것이 없다 |
| `GET /calendar/feed` | `getCalendarFeed` | 실제(`LECTERN_CALENDAR=1`), 꺼지면 501 | 워크스페이스 멤버 누구나. ICS 구독이 있는지만(`url`은 늘 `null`. 토큰은 해시만 저장) |
| `POST /calendar/feed` | `createCalendarFeed` | 실제(`LECTERN_CALENDAR=1`), 꺼지면 501 | 만들거나 다시 만든다. 응답의 `url`(`/cal/<토큰>.ics`)은 이때 한 번만. 옛 주소는 같은 트랜잭션에서 막힌다. 주소 자체는 `http.ts`의 공개 라우트다(인증 없음, `accepted`·`synced` 일정만, 비공개 녹음의 일정은 만든 사람의 주소에만, 꺼짐·잘못된 이름·모르는·회수된 토큰은 모두 같은 404, 요청 로그에는 `/cal/***`) |
| `DELETE /calendar/feed` | `deleteCalendarFeed` | 실제(`LECTERN_CALENDAR=1`), 꺼지면 501 | 204. 주소가 바로 404가 된다 |
| `GET /integrations` | `listIntegrations` | 실제 | 호출한 사용자의 연동만. 토큰은 내보내지 않는다 |
| `POST /integrations/google` | `startGoogleIntegration` | 실제(`LECTERN_CALENDAR=1`이고 `GOOGLE_OAUTH_CLIENT_ID`·`_SECRET`이 있을 때), 아니면 501 | 워크스페이스 멤버. PKCE(S256)와 1회용 state(해시만 저장, 10분)를 만들고 Google 인가 URL(`calendar.app.created` 하나, `access_type=offline`)을 준다. `return_to`는 서버 경로(기본 `/app/settings#integrations`) |
| `GET /integrations/google/callback` | (domain 밖, `google-callback.ts`) | 실제 | Google이 돌려보내는 브라우저 이동. 로그인 안 했으면 `302 /app/login`. state가 없거나·만료·다른 사용자·이미 씀·`error`·플래그 꺼짐이면 토큰 요청 없이 `302 /app/settings?google=error#integrations`. 성공하면 전용 캘린더 "Lectern"을 만들고(다시 연결이면 있던 캘린더를 쓴다) refresh token을 봉인해 `integration`에 두고 `?google=connected`로 보낸다. 요청 로그에서 `code`·`state`는 가린다 |
| `DELETE /integrations/{integration_id}` | `disconnectIntegration` | 실제(플래그와 무관) | 자기 연동만(남의 것은 404). Google에 토큰 폐기 요청(실패해도 계속) → 링크 삭제, `synced` 일정은 `accepted`로, 연동 행 삭제. Google 쪽 일정은 지우지 않는다. 204 |
| `GET /share-links` | `listShareLinks` | 실제 | v2에서 만든 링크와 공개된 v1 강의의 링크. 회수된(비공개) 링크는 빠진다 |
| `POST/PATCH/DELETE /share-links…` | `createShareLink` 등 3개 | 실제 | 녹음 `recording:update`와 공유 권한(관리자, 또는 `can_share`이고 viewer가 아님). 토큰은 만들 때 한 번만 보여 주고 SHA-256만 저장. v1 링크를 회수하면 강의도 비공개로. 공개 페이지는 `share-page.ts`의 `/s/:token`(범위 밖 전사·오디오는 마크업에 없음, 비밀번호는 폼 + 링크 전용 쿠키, 링크·IP별 분당 10회) |
| `GET /events` | `streamEvents` | 실제 | SSE. 아래 참고 |
| `GET /admin/jobs` | `adminListJobs` | 실제 | 운영자 전용 |
| `GET /admin/jobs/{job_id}` | `adminGetJob` | 실제 | 단계·모델 호출 포함 |
| `POST /admin/jobs/{job_id}/retry` | `adminRetryJob` | 실제 | 실패한 `process`·`regenerate`를 같은 작업 id로 다시 큐에 넣는다. 끝난 단계는 메모로 건너뛰고 실패한 단계부터 이어 한다 |
| `GET /admin/usage` | `adminListUsage` | 실제 | `usage_ledger`(쿼터 집계는 P5) |

### SSE (`GET /events`)

- 모든 프로세스(API, 외부 워커)가 강의 변경을 `job_event`에 쓴다(`../../events.ts`). 이 라우트는 그 표를 1초마다 꼬리 읽기 한다. 행의 v1 페이로드는 보낼 때 domain `ServerEvent`로 바꾸고, 녹음은 그 순간의 상태를 싣는다.
  - `created`는 `recording.created`가 된다.
  - `progress`는 `job.progress`와 `recording.updated`가 된다.
  - `completed`는 `recording.updated`와 `document.updated`가 된다.
  - `updated`와 `error`는 `recording.updated`가 된다.
  - `deleted`는 `recording.deleted`가 된다.
- 메시지 id는 `<행 id>`이고, 한 행이 여러 이벤트가 되면 `<행 id>-<n>`이다.
- `Last-Event-ID` 없이 붙으면 지금부터 보낸다. 있으면 그 뒤를 먼저 다시 보낸다. 로그(하루 보존)보다 오래된 id면 무엇을 놓쳤는지 모르므로 로그 전체를 보낸다.
- 연결은 열린 채로 유지된다. 15초마다 `: ping`을 보내고, 첫 줄은 `retry: 5000`이다.

## 이전 리허설

`bun apps/server/scripts/rehearse-v2-migration.ts <백업 사본>`는 사본의 사본에서 이전을 돌리고 다음을 JSON으로 출력한다. 내용은 출력하지 않는다(건수, 체크섬, id만). 하나라도 틀리면 종료 코드가 1이다.

- 건수: 사용자↔워크스페이스, 강의↔녹음, Markdown↔문서, 오디오↔asset, 과목↔폴더, 공개↔링크
- 강의별 필드 체크섬
- v1 표가 그대로인지
- 다시 돌려도 아무것도 만들지 않는지
- domain 스키마를 통과하지 못하는 행

배포 사전 점검(`../../preflight.ts`)도 운영 DB 사본에서 같은 검사를 한다. 처음 P2를 배포할 때는 부팅이 이전을 실행하고, 결과가 틀리면 배포가 멈춘다.
