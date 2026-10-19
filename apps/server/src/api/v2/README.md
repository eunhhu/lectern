# API v2 스텁 (`/api/v2`)

`packages/domain`의 라우트 표(`src/api/routes.ts`, `openapi.json`)에 있는 60개 엔드포인트를 모두 올린 P0 스텁이다. 읽기 27개는 고정 픽스처를, 쓰기·업로드 33개는 `501 not_implemented`를 돌려준다. ROADMAP "병렬화와 동결 지점"의 마지막 조건(v2 엔드포인트가 스텁으로 존재)을 채우고, 웹 셸(`apps/web`)이 픽스처 클라이언트 대신 이 API에 붙을 수 있게 하는 것이 목적이다.

## 요청 처리 순서

모든 라우트는 리소스 라우터(`me.ts`, `recordings.ts` …)가 `defineRouter()`로 domain의 `RouteDef`에서 메서드·경로·스키마를 읽어 등록한다. 경로를 이 디렉터리에 다시 적지 않는다.

1. **인증(401)**: v1과 같은 `authenticateRequest()`(`../../auth.ts`)를 쓴다. `lectern_session` 쿠키, `Authorization: Bearer`, `X-Lectern-Token`, `?token=`을 받는다. `RouteDef.public`인 라우트만 건너뛴다(현재 없음).
2. **운영자 확인(403)**: `admin` 태그 라우트는 v1 `isAdminUser()`가 참이어야 한다.
3. **검증(400·428)**: params, query, 헤더, JSON 본문을 domain 스키마로 검증한다. 실패하면 `validation_failed`이고 `details.issues[].path` 앞에 `params`/`query`/`headers`/`body`가 붙는다. JSON 본문은 `Content-Type: application/json`이어야 한다(아니면 `bad_request`). 교차 사이트 HTML 폼이 쿠키 인증 변경 요청에 닿지 못하게 하려는 것이다. `If-Match`가 필수인 라우트에서 헤더가 없으면 428 `precondition_required`다.
4. **처리**: 픽스처 응답은 라우트의 응답 스키마로 `parse()`한 뒤 보낸다. 스키마를 통과하지 못하면 500 `internal`이다(`details.request_id` 포함).

쓰기 엔드포인트도 1~3단계를 거친 뒤 501을 돌려준다. 그래서 클라이언트는 실제 구현 전에도 요청 형식을 이 서버로 검증할 수 있다. 등록되지 않은 `/api/v2/*` 경로와 메서드는 v2 형식의 404다. `/api/v2` 밖의 경로는 그대로 레거시 라우터로 간다. 응답에는 `Cache-Control: no-store`가 붙는다.

`GET /api/v2/openapi.json`은 domain에서 만든 OpenAPI 문서를 인증 없이 돌려준다. ARCHITECTURE §6에 적힌 경로이고, `ROUTES`에는 없는 추가 경로다.

## 픽스처

`fixtures.ts`의 합성 데이터다. 실제 사용자나 녹음에서 가져온 값은 없다. 이메일은 `example.com`이다.

- 사용자 1명(`demo@example.com`)과 워크스페이스 2개(개인, 팀). 이 둘이 아닌 `workspace_id`는 403이다.
- 녹음 3개: 처리 완료된 강의(문서 2개 버전, 질문, 일정, PDF 자산), 처리 중인 강의(진행 중인 작업, 빈 전사), 팀 회의(문서, 할 일).
- id는 서로 이어진다. `/me` → `/workspaces` → 폴더·태그·녹음 → 상세 → 전사·문서·질문·일정·할 일 → 작업 순서로 따라갈 수 있다. 없는 id는 404다.
- `/me`는 고정 사용자를 돌려주되 `system_role`만 호출자의 v1 역할을 따른다. 관리자 메뉴 노출과 `/admin/*`의 403이 어긋나지 않게 하려는 것이다.
- 목록은 커서 페이지네이션(`limit`, 불투명한 `next_cursor`)과 각 라우트의 단순 필터(폴더, 태그, 상태, 종류, 기간)를 픽스처에 그대로 적용한다. 검색은 FTS 대신 부분 문자열 일치이고 `snippet`에 강조 구간을 나눠 준다.

## 엔드포인트 상태

| 메서드·경로 | operationId | 상태 | 비고 |
|---|---|---|---|
| `GET /me` | `getMe` | 픽스처 | `system_role`은 호출자 v1 역할 |
| `PATCH /me` | `updateMe` | 501 | |
| `GET /me/devices` | `listDevices` | 픽스처 | |
| `DELETE /me/devices/{device_id}` | `revokeDevice` | 501 | |
| `GET /me/tokens` | `listAccessTokens` | 픽스처 | |
| `POST /me/tokens` | `createAccessToken` | 501 | |
| `DELETE /me/tokens/{token_id}` | `revokeAccessToken` | 501 | |
| `GET /workspaces` | `listWorkspaces` | 픽스처 | |
| `POST /workspaces` | `createWorkspace` | 501 | |
| `GET /workspaces/{workspace_id}` | `getWorkspace` | 픽스처 | 없는 id는 404 |
| `PATCH /workspaces/{workspace_id}` | `updateWorkspace` | 501 | |
| `GET /workspaces/{workspace_id}/members` | `listWorkspaceMembers` | 픽스처 | 없는 id는 404 |
| `GET /folders` | `listFolders` | 픽스처 | 다른 워크스페이스는 403 |
| `POST /folders` | `createFolder` | 501 | |
| `PATCH /folders/{folder_id}` | `updateFolder` | 501 | |
| `DELETE /folders/{folder_id}` | `deleteFolder` | 501 | |
| `GET /tags` | `listTags` | 픽스처 | 다른 워크스페이스는 403 |
| `POST /tags` | `createTag` | 501 | |
| `PATCH /tags/{tag_id}` | `updateTag` | 501 | |
| `DELETE /tags/{tag_id}` | `deleteTag` | 501 | |
| `POST /uploads` | `createUpload` | 501 | |
| `GET /uploads/{upload_id}` | `getUpload` | 501 | 업로드 세션을 만들 수 없으므로 읽기도 501 |
| `PUT /uploads/{upload_id}/parts/{part}` | `putUploadPart` | 501 | |
| `POST /uploads/{upload_id}/complete` | `completeUpload` | 501 | |
| `DELETE /uploads/{upload_id}` | `abortUpload` | 501 | |
| `GET /recordings` | `listRecordings` | 픽스처 | `folder_id`·`tag_id`·`domain`·`status` 필터, `recorded_at` 최신순 |
| `GET /recordings/{recording_id}` | `getRecording` | 픽스처 | 없는 id는 404 |
| `PATCH /recordings/{recording_id}` | `updateRecording` | 501 | |
| `DELETE /recordings/{recording_id}` | `deleteRecording` | 501 | |
| `GET /recordings/{recording_id}/transcript` | `getTranscript` | 픽스처 | 처리 중인 녹음은 빈 전사 |
| `PATCH /recordings/{recording_id}/speakers/{speaker_id}` | `updateSpeaker` | 501 | |
| `GET /recordings/{recording_id}/documents` | `listRecordingDocuments` | 픽스처 | |
| `GET /recordings/{recording_id}/questions` | `listRecordingQuestions` | 픽스처 | `kind` 필터 |
| `GET /recordings/{recording_id}/events` | `listRecordingEvents` | 픽스처 | 모든 상태 |
| `GET /recordings/{recording_id}/action-items` | `listRecordingActionItems` | 픽스처 | 팀 회의에만 있음 |
| `POST /recordings/{recording_id}/reprocess` | `reprocessRecording` | 501 | |
| `GET /assets/{asset_id}/content` | `getAssetContent` | 501 | 바이너리라 스키마가 없고 블롭 저장소도 아직 없음 |
| `GET /documents/{document_id}` | `getDocument` | 픽스처 | `ETag: "<current_version>"` |
| `GET /documents/{document_id}/versions` | `listDocumentVersions` | 픽스처 | 최신순, 본문 제외 |
| `GET /documents/{document_id}/versions/{version}` | `getDocumentVersion` | 픽스처 | 없는 버전은 404 |
| `POST /documents/{document_id}/versions` | `createDocumentVersion` | 501 | `If-Match` 없으면 먼저 428 |
| `PATCH /action-items/{action_item_id}` | `updateActionItem` | 501 | |
| `GET /jobs/{job_id}` | `getJob` | 픽스처 | 시스템 작업은 404(관리자 API로만) |
| `POST /jobs/{job_id}/cancel` | `cancelJob` | 501 | |
| `GET /search` | `search` | 픽스처 | 부분 문자열 일치, 전사·문서·PDF |
| `POST /ask/threads` | `createAskThread` | **실제**(`LECTERN_ASK=1`), 꺼지면 501 | v1 강의 위의 물어보기(`ask.ts`, ARCHITECTURE §12.4). 픽스처 개인 워크스페이스 id는 호출자의 `wsp_<user id>` 별칭 |
| `GET /ask/threads` | `listAskThreads` | 실제 / 501 | 내 스레드만 |
| `GET /ask/threads/{thread_id}` | `getAskThread` | 실제 / 501 | 지워진 노트 인용은 `available: false` |
| `DELETE /ask/threads/{thread_id}` | `deleteAskThread` | 실제 / 501 | |
| `POST /ask/threads/{thread_id}/turns` | `askQuestion` | 실제 / 501 | SSE(15초 heartbeat). 끊겨도 끝까지 만들어 저장. `Idempotency-Key` 재전송은 저장된 답을 다시 보냄. 교차 사이트 쿠키 요청은 403 |
| `GET /ask/usage` | `getAskUsage` | 실제 / 501 | |
| `GET /calendar/suggestions` | `listCalendarSuggestions` | 픽스처 | `status` 기본값 `suggested` |
| `PATCH /calendar/suggestions/{event_candidate_id}` | `updateCalendarSuggestion` | 501 | |
| `POST /calendar/suggestions/batch` | `batchCalendarSuggestions` | 501 | |
| `GET /integrations` | `listIntegrations` | 픽스처 | |
| `POST /integrations/google` | `startGoogleIntegration` | 501 | |
| `DELETE /integrations/{integration_id}` | `disconnectIntegration` | 501 | |
| `GET /share-links` | `listShareLinks` | 픽스처 | `target_id` 필터 |
| `POST /share-links` | `createShareLink` | 501 | |
| `PATCH /share-links/{share_link_id}` | `updateShareLink` | 501 | |
| `DELETE /share-links/{share_link_id}` | `revokeShareLink` | 501 | |
| `GET /events` | `streamEvents` | 픽스처 | SSE. 아래 참고 |
| `GET /admin/jobs` | `adminListJobs` | 픽스처 | 운영자 전용, `state`·`kind`·`workspace_id` 필터 |
| `GET /admin/jobs/{job_id}` | `adminGetJob` | 픽스처 | 운영자 전용, 단계·모델 호출 포함 |
| `POST /admin/jobs/{job_id}/retry` | `adminRetryJob` | 501 | 운영자 전용 |
| `GET /admin/usage` | `adminListUsage` | 픽스처 | 운영자 전용, `period` 필터 |

### SSE (`GET /events`)

- 메시지 형식은 실제와 같다: `id: <event.id>`, `event: <event.type>`, `data: <ServerEvent JSON>`. 첫 줄은 `retry: 30000`이다.
- `Last-Event-ID`가 있으면 그 뒤의 이벤트만 보낸다. 로그에 없는 id(발급한 적 없거나 보존 기간이 지난 id)는 무엇을 놓쳤는지 알 수 없으므로 전체를 다시 보낸다. 형식이 틀린 id는 400이다.
- 스텁은 픽스처 로그를 보내고 **연결을 닫는다**. 브라우저 `EventSource`는 30초 뒤 마지막 id로 다시 붙고, 새 이벤트가 없으니 빈 응답을 받는다. 실제 구현은 연결을 유지하고 `job_events`를 밀어 준다.

## 실제 구현으로 바꿀 순서

웹 셸 `ApiClient`가 쓰는 순서이자, v2 테이블 마이그레이션(P2)이 채워지는 순서다. 각 단계에서 리소스 라우터의 핸들러만 바꾸고, 검증·인증·응답 스키마 검사는 그대로 둔다. 바꾼 라우트는 계약 테스트의 `READ_STUBS`·501 기대값을 함께 고친다.

1. `me`, `workspaces`: 사용자 → `Me`, 개인 워크스페이스·멤버십(마이그레이션 첫 단계). 정책 함수(`can()`)를 `access.ts` 자리에 넣는다.
2. `folders`, `tags`의 읽기와 쓰기
3. `recordings` 목록·상세, `transcript`, `documents`(읽기, 버전, `If-Match` 저장). 레거시 `lectures`를 v2로 옮긴 데이터가 이 단계부터 보인다.
4. `uploads`(재개 가능한 청크 업로드, `recorded_at`)와 `assets/{id}/content`(Range). 블롭 저장소가 필요하다.
5. `events`(SSE, `job_events` 기반)와 `jobs`
6. `search`(FTS5)
7. `calendar`, `integrations`, `share-links`(P4·P5)
8. `admin/*`. v1 관리자 콘솔이 옮겨 올 때까지 v1 관리자 API가 남는다.
