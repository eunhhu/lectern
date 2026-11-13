# 빌드 계약 (CONTRACTS)

> P1 후반 ~ P7의 **설계 결정**이다. 근거는 [ROADMAP](../ROADMAP.md), [ARCHITECTURE](../ARCHITECTURE.md), [AI_HARNESS](../AI_HARNESS.md), [NATIVE](../NATIVE.md), ADR-0001~0009다.
> 작업 명세(`wp/*.md`)나 [CATALOG](CATALOG.md)와 어긋나면 **이 문서가 이긴다.**
> 워커는 이 문서를 고치지 않는다. 계약이 코드와 맞지 않으면 `BLOCKED`로 보고한다([WORKER.md](WORKER.md)).

결정에는 `D-P1-3`처럼 번호가 있다. 작업 명세는 이 번호로 가리킨다.

## 0. 공통

### 0.1 바뀌지 않는 전제

| 번호 | 결정 |
|---|---|
| D-0-1 | AI 공급자는 **Gemini 하나**다. Claude·전용 STT 어댑터, `ANTHROPIC_API_KEY` 같은 시크릿, 그 단가 항목을 만들지 않는다. 로드맵의 D1·D3·D13 비교 실험은 하지 않는다. |
| D-0-2 | 테스트와 게이트는 **실제 외부 호출을 하지 않는다.** Gemini, Google, Apple(APNs·로그인), Resend는 `fetch`(또는 HTTP/2 소켓) 경계의 가짜로 답한다. 실제 호출 검증은 사용자가 한다([STATUS.md](STATUS.md) "실측 필요"). |
| D-0-3 | 새 기능은 전부 **기능 플래그 뒤, 기본 꺼짐**이다. 플래그가 꺼지면 기존 동작과 응답이 그대로여야 한다(`v1-contract.test.ts`, preflight 통과). |
| D-0-4 | DB 변경은 **추가만** 한다(새 테이블, nullable 또는 기본값 있는 새 컬럼). 삭제·이름 변경 금지. v1 테이블(`lectures`, `users`, `sessions` 등 `apps/server/src/db.ts` 소관)은 건드리지 않는다. |
| D-0-5 | `packages/domain`은 **추가만** 한다. 기존 필드·라우트·enum 값의 의미를 바꾸지 않는다. 바꾼 뒤 `bun run domain:openapi`로 `openapi.json`을 다시 만든다. |
| D-0-6 | id는 불투명 문자열(`[A-Za-z0-9_-]{1,64}`)이고 새 행은 `uuidv7()`(`@lectern/db`)를 쓴다. 시각 컬럼은 정수 epoch ms, JSON 컬럼은 `*_json` 텍스트다. |
| D-0-7 | 토큰(공유 링크, PAT, 초대, ICS, 네이티브 세션)은 **원문을 저장하지 않는다.** sha256 해시만 저장하고, 원문은 만들 때 한 번만 응답한다. 비교는 해시 일치로 한다. |
| D-0-8 | 외부 자격 증명(OAuth refresh token)은 `apps/server/src/secrets.ts`의 봉인 API로 암호화해 `*_enc` 컬럼에 둔다. 로그에 남기지 않는다. |
| D-0-9 | 새 외부 처리자(Google Calendar, Google·Apple 로그인, APNs)가 생기는 작업 패키지는 **같은 커밋에서** `apps/server/static/legal/privacy.html`을 고친다. |
| D-0-10 | 사용자에게 보이는 문구는 한국어, 코드 주석은 영어, 모델 id는 버전 고정(`-latest` 금지)이다. |
| D-0-11 | 통합 브랜치(`pipeline.json`의 `integration_branch`)만 원격에 push한다. **`main`에는 사용자가 말하기 전에는 push하지 않는다**(`main` = 운영 배포). |

### 0.2 기능 플래그와 환경 변수 (모두 `packages/config`에 추가, 기본 꺼짐)

| 이름 | 값 | 기본 | 추가하는 WP | 켜면 |
|---|---|---|---|---|
| `LECTERN_PIPELINE` | `v1` \| `v2` | `v1` | P1-C | 새 업로드를 `process` 작업(전사 → 노트)으로 처리 |
| `LECTERN_PDF` | `0` \| `1` | `0` | P3-C | PDF 업로드·추출·뷰어·페이지 인용 |
| `LECTERN_CALENDAR` | `0` \| `1` | `0` | P4-C | ICS 구독, Google Calendar 연동, 리마인더 |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | 시크릿 | 없음 | P4-C | Google OAuth (캘린더, 로그인 공용) |
| `LECTERN_GOOGLE_LOGIN` | `0` \| `1` | `0` | P5-C | Google 로그인 버튼과 라우트 |
| `LECTERN_APPLE_LOGIN` | `0` \| `1` | `0` | P5-C | Sign in with Apple |
| `APPLE_SIGNIN_CLIENT_ID`, `APPLE_SIGNIN_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY_FILE` | 시크릿·경로 | 없음 | P5-C | Apple 로그인의 client secret(JWT ES256) 생성 |
| `LECTERN_TEAMS` | `0` \| `1` | `0` | P5-C | 팀 워크스페이스 초대·역할·팀 업로드 |
| `LECTERN_APNS` | `0` \| `1` | `0` | P6-C | APNs 발송 |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY_FILE`, `APNS_TOPIC_IOS`, `APNS_ENV`(`sandbox`\|`production`) | 시크릿·값 | 없음 | P6-C | APNs 토큰 인증 |
| `APPLE_APP_IDS` | 쉼표 목록 `TEAMID.bundle.id` | 없음 | P6-C | `apple-app-site-association` 서빙 |
| `LECTERN_V1_SUNSET` | `YYYY-MM-DD` | 없음 | P6-C | v1 응답에 `Deprecation`·`Sunset` 헤더 |
| `LECTERN_V1_BLOCK` | `0` \| `1` | `0` | P6-C | Sunset 날짜가 지났으면 v1 엔드포인트가 410 |

- 플래그를 추가하는 WP는 `docs/env.md`(`bun run config:docs`), `deploy/systemd/lectern.env.example`, `docs/v2/pipeline/flags-on.env`(게이트의 "전부 켬" 점검)을 함께 고친다. 시크릿은 `flags-on.env`에 넣지 않는다.
- 기존 플래그(`LECTERN_WEB_SHELL`, `LECTERN_ASK`, `LECTERN_TRANSCRIPT_ENGINE`, `LECTERN_DISTILL_ENGINE`, `LECTERN_WORKER_MODE`)의 의미는 바꾸지 않는다. 예외는 D-P2-6 하나다.

### 0.3 마이그레이션 이름

계약 WP가 Drizzle로 만든다. 번호는 Drizzle이 붙이고 이름은 고정한다: `p1_pipeline`, `p3_pdf`, `p4_calendar`, `p5_accounts`, `p6_devices`. 계약 WP는 `pipeline.json` 순서대로 하나씩만 돈다(모두 `packages/db/`를 소유하므로 겹치지 않는다).

### 0.4 오류 코드

API v2 오류는 기존 형식(`{ error: { code, message, details } }`)과 기존 코드 집합을 쓴다. 새 코드가 꼭 필요하면 계약 WP가 domain에 추가한다. 꺼진 기능의 라우트는 `501 not_implemented`다(물어보기와 같은 방식).

---

## 1. P1 — 노트 파이프라인 (전사 발행, 구조화, 추출, 검증)

### 1.1 흐름

```
upload complete
  └─ LECTERN_PIPELINE=v1 → 기존 distill 작업 (그대로)
  └─ LECTERN_PIPELINE=v2 → job.kind = "process"
       1 전사 파이프라인 (기존 runTranscriptPipeline: ingest → … → speakers)
       2 publishTranscript  (서버, 멱등)      → transcript_segment / speaker / transcript_gap, recording.updated 이벤트
       3 index (전사 조각)                    → 물어보기·검색
       4 runNotesPipeline (하네스)            → classify → structure → extract → verify
       5 publishNotes (서버, 한 트랜잭션)      → document_version, event_candidate, action_item, lectures.markdown 브리지
       6 index (문서 조각)
       7 recording.status = ready | partial | failed
```

| 번호 | 결정 |
|---|---|
| D-P1-1 | `process` 작업은 `apps/server/src/process-job.ts`가 처리한다. `apps/server/src/transcript-job.ts`와 같은 방식(하네스 `JobRun`, 같은 jobId로 재개, 강의·오디오 삭제 시 취소)이다. 키 선택(사용자 키 / 서버 키)은 v1 distill과 같은 규칙을 쓴다. |
| D-P1-2 | 전사가 발행된 뒤 노트 단계가 실패하면 녹음은 `partial`이고 전사·검색은 쓸 수 있다. 전사가 전부 실패하면 `failed`다. 예산 초과는 그때까지의 결과를 발행하고 `partial`이다. "영원히 처리 중"이 없어야 한다(테스트). |
| D-P1-3 | 구조화 문서는 새 `document` 행이다(id `uuidv7()`, `template_id` = 템플릿 id, `body_json` = `DocumentBody`, `rendered_md` = 렌더러 출력). **브리지**: 같은 `rendered_md`를 `lectures.markdown`에도 쓴다. `packages/db/src/legacy.ts`의 `projectLecture`는 강의 Markdown이 그 녹음 구조화 문서의 현재 `rendered_md`와 **같으면** legacy 문서로 투영하지 않는다. **다르면**(v1 클라이언트가 고친 것) 지금처럼 `legacy-markdown` 문서 버전을 만들고, 구조화 문서에 `user_edited = 1`을 표시한다. 두 버전 모두 남는다. |
| D-P1-4 | 다시 만들기(`reprocessRecording` `mode: "document"`)는 저장된 전사로 4~7만 다시 돈다(`job.kind = "regenerate"`). 재전사하지 않는다. 항상 새 문서 버전을 만들고 이전 버전은 이력에 남는다. |
| D-P1-5 | 일정·할 일 재발행 규칙: 같은 녹음에서 다시 발행할 때 `suggested` 상태의 `event_candidate`와 `open` 상태이면서 사용자가 고치지 않은 `action_item`만 교체한다. `accepted`·`dismissed`·`synced` 일정과 `done`·`dismissed` 할 일은 그대로 두고, 새 결과 중 그것들과 같은 항목(정규화한 제목 + 같은 날짜)은 버린다. |
| D-P1-6 | 모델 라우팅은 `packages/harness/routing.json`에 둔다. 환경 변수로 받지 않는다. 내용은 §1.4. 모델 id는 `resolveGeminiModel` 허용 목록에 있어야 한다. |
| D-P1-7 | 질문 추출(`questions`)은 모든 템플릿에서 끈다(ADR-0009). |
| D-P1-8 | 작업 취소: `job.cancel_requested_at`(새 컬럼)을 세운다. 대기 중이면 바로 `canceled`, 실행 중이면 핸들러가 단계 시작·재시도·하트비트 때 보고 `AbortSignal`로 멈춘다. |
| D-P1-9 | 여러 오디오 파트(1부/2부)는 `process` 작업이 ffmpeg로 **하나로 이어 붙인 뒤** 전사 파이프라인에 넣는다. 원본 시각 = 이어 붙인 타임라인이다(웹 플레이어의 `createAudioClock`과 같은 기준). `LECTERN_PIPELINE=v1`에서는 지금처럼 오디오 1개만 받는다. |

### 1.2 DB (`p1_pipeline`)

| 대상 | 변경 |
|---|---|
| `job` | 컬럼 추가 `cancel_requested_at integer`(nullable) |

### 1.3 하네스 모듈 (`packages/harness`)

모두 새 파일이다. 서버 테이블을 모른다(순수 함수와 단계 정의).

| 파일 | 내보내는 것 |
|---|---|
| `routing.json`, `src/routing.ts` | `loadRouting(): Routing`, `Routing = Record<"classify" \| "structure" \| "extract" \| "repair" \| "ocr", { provider: "gemini"; model: string; maxOutputTokens: number }>` |
| `src/notes/compact.ts` | `formatCompactTranscript(transcript): { text: string; ids: number[] }`, `parseSourceToken(token): { start: number; end: number } \| null`, `expandSourceTokens(tokens, knownIds): { refs: SourceRef[]; dropped: string[] }` |
| `src/gemini-llm.ts` | `class GeminiLlmProvider implements LlmProvider` (`generateContent`, `responseMimeType: "application/json"`, zod → `responseSchema`, `thinkingLevel: "low"`, 키는 `x-goog-api-key` 헤더) |
| `src/eval/scripted-llm.ts` | `class ScriptedLlmProvider implements LlmProvider` (테스트·평가용. 요청마다 등록된 함수가 값을 돌려준다. 호출 기록을 남긴다) |
| `templates/<id>/template.json`, `prompt.structure.md`, `prompt.extract.md` | 템플릿 5종(§1.5) |
| `src/templates.ts` | `loadTemplate(id): LoadedTemplate`, `templateForDomain(domain): TemplateId`, `LoadedTemplate = { def: TemplateDefinition; structurePrompt: string; extractPrompt: string; hash: string }` (`hash` = 세 파일 내용의 sha256, 메모 키에 넣는다) |
| `src/notes/schemas.ts` | `ClassifyOutput`, `VerifiedEvent`, `VerifiedActionItem`, `VerifyReport`, `NotesResult` zod 스키마(§1.6) |
| `src/notes/classify.ts` | `classifyStage(llm, routing)` |
| `src/notes/structure.ts` | `structureStage(llm, routing)` (긴 전사는 map → reduce) |
| `src/notes/extract.ts` | `extractStage(llm, routing)` |
| `src/notes/korean-date.ts` | `resolveKoreanDate(raw, base): ResolvedDate \| null` (§1.7) |
| `src/notes/verify.ts` | `verifyStage(llm, routing)` (§1.8) |
| `src/notes/render.ts` | `renderDocumentMarkdown(body, ctx): string` (결정적, 스냅샷 테스트) |
| `src/notes/pipeline.ts` | `runNotesPipeline(run, input, options): Promise<NotesResult>` |

- 단계 이름은 domain `StageName`에 이미 있는 `classify`, `structure`, `extract`, `verify`를 쓴다. 새 이름을 만들지 않는다.
- 프롬프트 순서는 고정이다: 시스템 → 전사(압축 형식) → (P3) PDF 관련 페이지 → 단계별 지시. `structure`와 `extract`가 같은 접두부를 쓴다.
- 압축 전사 한 줄: `#<idx> [MM:SS] S1: 본문` (1시간 이상은 `[H:MM:SS]`). `idx`는 `Transcript.segments[].idx` 그대로다. 모델은 시간을 쓰지 않고 `#<idx>`만 쓴다.
- 입력 예산: 압축 전사가 60,000자(약 3만 토큰)를 넘으면 `structure`는 20,000자 창으로 나눠 창마다 부분 요약(출처 토큰 포함)을 만들고(map), 부분 요약들로 최종 구조를 만든다(reduce).

### 1.4 `routing.json`

```json
{
  "classify":  { "provider": "gemini", "model": "gemini-3.5-flash-lite", "maxOutputTokens": 1024 },
  "structure": { "provider": "gemini", "model": "gemini-3.8-flash",      "maxOutputTokens": 16384 },
  "extract":   { "provider": "gemini", "model": "gemini-3.8-flash",      "maxOutputTokens": 8192 },
  "repair":    { "provider": "gemini", "model": "gemini-3.8-flash",      "maxOutputTokens": 8192 },
  "ocr":       { "provider": "gemini", "model": "gemini-3.8-flash",      "maxOutputTokens": 8192 }
}
```

### 1.5 템플릿 5종

`extract`는 표에 없는 항목이 전부 `false`다. `question_kinds`는 전부 `[]`다. 섹션 키·제목·순서는 표 그대로다.

| id | domains | 섹션 (key: 제목, fill, block_types, required) | extract |
|---|---|---|---|
| `lecture` | lecture | `summary`: 핵심 요약, structure, paragraph·list, 필수 / `exam_points`: 시험·과제 포인트, structure, callout·list / `topics`: 주제별 상세, structure, paragraph·list·term·formula·callout, 필수 / `quotes`: 주요 발언, structure, quote / `glossary`: 용어, glossary, list / `events`: 일정, events, list | events, glossary |
| `meeting` | meeting, one_on_one, call | `summary`: 요약, structure, paragraph·list, 필수 / `decisions`: 결정 사항, decisions, list / `action_items`: 할 일, action_items, list / `topics`: 논의 주제별 요점, structure, paragraph·list·quote, 필수 / `open_issues`: 미결 쟁점, structure, list·paragraph / `next_events`: 다음 일정, events, list | events, action_items, decisions |
| `seminar` | seminar | `summary`: 발표 요지, structure, paragraph·list, 필수 / `claims`: 핵심 주장·근거, structure, paragraph·list·quote, 필수 / `qa`: 질의응답, structure, list·paragraph / `references`: 참고 자료, structure, list / `glossary`: 용어, glossary, list | glossary |
| `interview` | interview | `context`: 인물·맥락, structure, paragraph, 필수 / `answers`: 질문별 답변 요지, structure, paragraph·list, 필수 / `quotes`: 인용, structure, quote / `follow_ups`: 후속 질문, structure, list | (없음. extract 단계를 건너뛴다) |
| `general` | other | `summary`: 요약, structure, paragraph·list, 필수 / `topics`: 주제별 요점, structure, paragraph·list, 필수 / `action_items`: 할 일, action_items, list / `events`: 일정, events, list | events, action_items |

- `templateForDomain`: 위 `domains` 열대로. 분류 신뢰도가 0.5 미만이면 `general`이다.
- `packages/domain/src/templates.ts`의 자리 표시 템플릿 두 개는 그대로 둔다(동결). 하네스는 자기 디렉터리의 템플릿만 쓴다.

### 1.6 단계 출력

```ts
ClassifyOutput = { domain: RecordingDomain; language: LanguageTag; title: string /* 1..60자 */;
  participants: string[]; folder_suggestion: { folder_id: string | null; new_name: string | null };
  tags: string[] /* 0..5 */; confidence: number /* 0..1 */ }

VerifiedEvent = { title: string; kind: EventKind; start_at: number /* epoch ms */; end_at: number | null;
  all_day: boolean; tz: string; raw_expression: string; resolution: DateResolution; confidence: number;
  evidence: Evidence /* domain primitives */; flags: string[] }

VerifiedActionItem = { text: string; owner_name: string | null; due_at: number | null; due_raw: string | null;
  evidence: Evidence; flags: string[] }

VerifyReport = { repaired: boolean; dropped_blocks: number;
  items: { kind: "block" | "event" | "action_item" | "decision" | "glossary"; ref: string;
           outcome: "ok" | "fixed" | "dropped"; reasons: string[] }[] }

NotesResult = { classification: ClassifyOutput; template: { id: string; version: number };
  body: DocumentBody; markdown: string; events: VerifiedEvent[]; action_items: VerifiedActionItem[];
  report: VerifyReport; partial: boolean }
```

- `flags` 값: `needs_review`(파서가 해석 못 함), `date_mismatch`(파서와 모델이 다름, 파서 값 사용), `recorded_at_estimated`(`recorded_at_source = "upload"`), `low_confidence`(인용 불일치), `weekday_mismatch`.
- `decisions`와 `glossary`는 테이블이 없다. `verify`가 문서 섹션의 `list` 블록으로 넣는다. `events`·`action_items` 섹션도 같은 방식으로 문서에 넣고, 동시에 행으로 발행한다.
- 휴식·꼬리·전사 누락 구간(`Transcript.gaps`)은 `verify`가 `GapBlock`으로 넣는다. 위치는 시간 순으로 맞는 `topics`(없으면 첫 structure 섹션) 블록 사이다.

### 1.7 한국어 날짜 파서

```ts
resolveKoreanDate(raw: string, base: { recordedAtMs: number; tz: string }): ResolvedDate | null
ResolvedDate = { date: "YYYY-MM-DD"; time: "HH:MM" | null; end_time: "HH:MM" | null; all_day: boolean; rule: string }
```

- 주는 **월요일 시작**이다("이번 주 일요일"은 그 주의 마지막 날).
- 요일만 있으면("금요일까지") 기준일 **다음에 오는** 그 요일이다(기준일이 그 요일이면 7일 뒤).
- "N월 N일"은 기준 연도다. 그 날짜가 기준일보다 31일 넘게 과거면 다음 해다.
- 날짜와 요일이 함께 있고 서로 다르면 날짜를 믿고 `weekday_mismatch`를 단다.
- 못 읽으면 `null`이다. 추측하지 않는다.

기준 `2026-10-19 14:00 Asia/Seoul`(월요일)일 때의 기대값(테스트에 그대로 쓴다):

| 입력 | date | time | rule |
|---|---|---|---|
| 오늘 | 2026-10-19 | — | `today` |
| 내일 | 2026-10-20 | — | `tomorrow` |
| 모레 | 2026-10-21 | — | `day_after_tomorrow` |
| 글피 | 2026-10-22 | — | `three_days_later` |
| 이번 주 금요일 | 2026-10-23 | — | `this_week_weekday` |
| 이번 주 일요일 | 2026-10-25 | — | `this_week_weekday` |
| 다음 주 월요일 | 2026-10-26 | — | `next_week_weekday` |
| 다음 주 화요일 수업 전까지 | 2026-10-27 | — | `next_week_weekday` |
| 금요일까지 | 2026-10-23 | — | `weekday` |
| 월요일까지 | 2026-10-26 | — | `weekday` |
| 3일 뒤 | 2026-10-22 | — | `days_later` |
| 2주 뒤 | 2026-11-02 | — | `weeks_later` |
| 일주일 후 | 2026-10-26 | — | `weeks_later` |
| 이번 달 말 | 2026-10-31 | — | `end_of_month` |
| 다음 달 5일 | 2026-11-05 | — | `next_month_day` |
| 11월 3일 | 2026-11-03 | — | `month_day` |
| 1월 5일 | 2027-01-05 | — | `month_day` |
| 10월 15일 | 2026-10-15 | — | `month_day` |
| 12월 24일 수요일 | 2026-12-24 | — | `month_day` (+ `weekday_mismatch`: 실제는 목요일) |
| 오후 3시 | 2026-10-19 | 15:00 | `time_only` |
| 내일 오전 9시 반 | 2026-10-20 | 09:30 | `tomorrow` |
| 다음 주 수요일 오후 2시 | 2026-10-28 | 14:00 | `next_week_weekday` |
| 학기 말쯤 | `null` | | |

시각이 없으면 `all_day: true`다.

### 1.8 verify 순서

AI_HARNESS §3.9 그대로다: ① 스키마 → ② 참조(범위 토큰 펼치기, 없는 id 삭제, 출처가 0개가 된 블록은 수리 대상) → ③ 인용 일치 → ④ 날짜 해석(파서 우선) → ⑤ 개연성 → ⑥ 수리 1회 → ⑦ 보고서.

- 인용 일치: 공백·구두점을 지우고 소문자로 만든 뒤 `LCS 길이 / 인용 길이 ≥ 0.8`이면 일치다. 비교 대상은 근거 세그먼트와 그 앞뒤 1개를 이은 글이다. 불일치한 일정·할 일은 `low_confidence`를 달고 신뢰도를 0.3 이하로 낮춘다(버리지 않는다).
- 개연성으로 **버리는** 것: 종료가 시작보다 빠름, 기준일보다 1년 넘게 미래, 같은 녹음 안의 중복(정규화한 제목이 같고 날짜가 같음). 기준일보다 과거인 마감은 버리지 않고 `needs_review`다.
- 수리: ①·② 실패분의 오류 목록과 해당 조각만 `routing.repair`로 한 번 보낸다. 그래도 실패하면 그 항목·블록을 버리고 `report`에 남긴다. 필수 섹션이 비면 `partial: true`다.

### 1.9 서버 모듈

| 파일 | 하는 일 |
|---|---|
| `apps/server/src/transcript-publish.ts` | `publishTranscript({ recordingId, workspaceId, transcript })`: 한 트랜잭션으로 그 녹음의 `speaker`·`transcript_segment`·`transcript_gap`을 교체. 같은 `label`의 `display_name`(사용자가 붙인 이름)은 보존. 멱등 |
| `apps/server/src/notes-publish.ts` | `publishNotes({ recordingId, workspaceId, result })`: 문서 버전, 일정·할 일(D-P1-5), 녹음 제목·도메인·`template_id`, 브리지(D-P1-3)를 한 트랜잭션으로. 사용자가 제목을 고친 녹음의 제목은 바꾸지 않는다 |
| `apps/server/src/process-job.ts` | `process`·`regenerate` 핸들러(D-P1-1, D-P1-4) |
| `apps/server/src/api/v2/jobs.ts` | `cancelJob` 구현(D-P1-8) |
| `apps/server/src/api/v2/admin.ts` | `adminRetryJob` 구현: 실패한 `process`·`regenerate` 작업을 같은 jobId로 다시 큐에 넣는다(끝난 단계는 메모로 건너뛴다) |

`LECTERN_TRANSCRIPT_ENGINE=on`(`LECTERN_PIPELINE=v1`일 때만 의미가 있다)은 shadow 결과를 `publishTranscript`로 발행한다.

---

## 2. P2 — 웹 전환 마무리

| 번호 | 결정 |
|---|---|
| D-P2-1 | 회원가입·이메일 인증·비밀번호 재설정 화면은 기존 v1 인증 엔드포인트(`/api/auth/register`, `/api/auth/send-code`, `/api/auth/reset-password`, `/api/auth/password`)를 그대로 쓴다. domain에 넣지 않는다(로그인과 같은 취급). |
| D-P2-2 | 문서 편집: legacy 문서는 Markdown 텍스트 편집기, 구조화 문서는 블록의 글자만 고친다(블록 추가·삭제·순서 변경 없음). 저장은 `createDocumentVersion` + `If-Match`. 412면 "다른 곳에서 바뀌었습니다" 대화상자에서 다시 불러오기 / 내 글 복사를 고른다. |
| D-P2-3 | 공유 링크는 기존 domain 라우트(`createShareLink`·`updateShareLink`·`revokeShareLink`)를 구현한다. 공개 페이지는 서버가 그리는 HTML(`/s/:token`)을 유지하되 `apps/server/src/share-page.ts`가 `DocumentBody`(없으면 `rendered_md`)에서 그린다. 비밀번호가 있는 링크는 폼 POST로 확인하고 그 링크 전용 HttpOnly 쿠키를 준다. 기존 v1 공유 토큰 URL은 계속 열린다. 비밀번호 확인은 IP·링크 단위로 분당 10회로 제한한다. |
| D-P2-4 | domain에 추가하는 라우트: `DELETE /recordings/{recording_id}/audio`(`deleteRecordingAudio`, 204, 노트는 남기고 오디오 asset·파일만 삭제), `GET /documents/{document_id}/export?format=md`(`exportDocument`, `text/markdown` 첨부), `GET /ask/suggestions?workspace_id&scope_type&scope_id`(`listAskSuggestions`, `{ suggestions: string[] }`, 모델을 부르지 않고 규칙으로 만든다). |
| D-P2-5 | `/api/auth/login`·`/api/auth/me` 응답 본문의 토큰은 **그대로 둔다**(네이티브 클라이언트가 쓴다). 웹은 지금처럼 버린다. |
| D-P2-6 | `/` 전환은 두 단계다. ① P2-09: `LECTERN_WEB_SHELL`의 기본값을 `1`로 바꾼다(`/` → `/app` 리다이렉트는 이미 있다. `?legacy=1`은 한 릴리스 동안 유지). 조건은 새 앱의 server e2e가 v1 화면 기능 표를 전부 덮는 것이다. ② P2-10: `ui.ts`의 사용자 앱 화면 삭제. **사용자 승인 후**에만 한다(`needs_user`). 관리자 콘솔 HTML은 P5-13까지 남긴다. |
| D-P2-7 | Pretendard는 `apps/web`이 직접 호스팅한다(`@font-face`, woff2는 미병합 브랜치 `claude/xenodochial-hamilton-b49ae7`의 파일을 가져온다). CDN을 쓰지 않는다. |
| D-P2-8 | 팀 워크스페이스 업로드는 `LECTERN_TEAMS=1`일 때만 받는다(P5-06). 여러 오디오 파트는 `LECTERN_PIPELINE=v2`일 때만 받는다(D-P1-9). 조건에 안 맞으면 지금처럼 400과 한국어 문구다. |

---

## 3. P3 — PDF · 검색 · 물어보기 확장

| 번호 | 결정 |
|---|---|
| D-P3-1 | PDF 텍스트 추출과 웹 뷰어 모두 `pdfjs-dist`를 쓴다(서버는 legacy 빌드, 네이티브 의존성 없음). 버전은 정확히 고정하고 나온 지 2주 넘은 것만 쓴다(`bun install --minimum-release-age=1209600`). poppler 같은 시스템 도구에 의존하지 않는다. |
| D-P3-2 | PDF는 `asset.kind = "pdf"`로 녹음에 붙는다(`LECTERN_PDF=1`일 때 `createUpload`가 받는다. 50 MiB, 500쪽 상한). 페이지 글자는 `pdf_page` 테이블에 둔다. |
| D-P3-3 | 스캔본 판정: 한 쪽의 글자 수가 20자 미만이면 `has_text_layer = 0`이다. 그런 쪽이 전체의 절반 이상이면 asset `meta_json.scanned = true`다. **조용히 OCR하지 않는다.** `ocrAsset`의 `dry_run`이 추정 비용(쪽당 258토큰 입력 + 출력 추정)을 돌려주고, 사용자가 확인한 요청만 Gemini PDF 입력으로 OCR한다. |
| D-P3-4 | `align`은 모델을 쓰지 않는다. 전사를 2분 창으로 나누고 창과 쪽의 글자 2-gram BM25 점수로 창마다 상위 3쪽을 고른다. 결과는 `align` 단계 산출물(JSON)이고 `getRecordingAlignment`가 읽는다. `structure`는 창별 상위 쪽을 합친 집합(최대 12쪽, 쪽당 2,000자)을 문맥으로 받고, `verify`는 `pdf_pages`가 그 집합 안인지 본다. |
| D-P3-5 | PDF 쪽은 검색 색인의 조각이 된다(`packages/ask`의 청킹에 쪽 입력). 물어보기 인용과 `GET /search` 적중에 PDF 쪽 종류가 생긴다. `GET /search`는 부분 문자열 검색을 버리고 `packages/ask`의 하이브리드 색인을 쓴다. `LECTERN_ASK=0`(색인 없음)이면 지금의 부분 문자열 검색으로 떨어진다. |
| D-P3-6 | 물어보기 도구 루프는 폴더·워크스페이스 범위에서만, 최대 2회다(코드는 `packages/ask/src/runner.ts`에 있다). 여기서는 가짜 Gemini 함수 호출 경로(사고 서명 재전송 포함)의 테스트를 채우고, `list_items`는 P4-06이 잇는다. |
| D-P3-7 | 웹 PDF 뷰어는 pdf.js를 직접 호스팅한다(워커 파일을 `/app/assets/`로 번들). CSP는 `script-src 'self'`를 유지하고 `isEvalSupported: false`로 연다. 필요하면 `worker-src 'self'`만 추가한다. |

### DB (`p3_pdf`)

```
pdf_page(
  asset_id text NOT NULL, page_no integer NOT NULL,          -- 1부터
  workspace_id text NOT NULL, recording_id text NOT NULL,
  text text NOT NULL, char_count integer NOT NULL,
  has_text_layer integer NOT NULL,                             -- 0 | 1
  ocr_source text,                                             -- NULL | 'device' | 'model'
  PRIMARY KEY(asset_id, page_no))
INDEX idx_pdf_page_recording(recording_id)
```

### domain 라우트

| 메서드·경로 | operationId | 응답 |
|---|---|---|
| `GET /assets/{asset_id}/pages` | `listAssetPages` | `{ page_count, scanned, pages: [{ page_no, has_text_layer, char_count }] }` |
| `POST /assets/{asset_id}/ocr` | `ocrAsset` | 요청 `{ dry_run: boolean }` → `{ pages_to_ocr, estimated_cost_microusd, job_id: string \| null }` |
| `GET /recordings/{recording_id}/alignment` | `getRecordingAlignment` | `{ windows: [{ start_ms, end_ms, pages: [{ asset_id, page_no, score }] }] }` |

검색 적중과 물어보기 인용의 PDF 쪽 종류는 기존 계약에 이미 있으면 그대로 쓰고, 없으면 P3-C가 추가한다.

---

## 4. P4 — 캘린더 · 리마인더

| 번호 | 결정 |
|---|---|
| D-P4-1 | 일정 등록 기본값은 **제안만**이다(D9). 자동 등록은 `WorkspaceSettings.calendar_auto_add`가 켜져 있을 때, 파서가 해석했고(`resolution.method = "parser"`) 플래그가 없고 신뢰도가 `min_confidence` 이상인 일정만 `accepted`로 만들고 동기화 작업을 넣는다. |
| D-P4-2 | ICS 구독: 사용자·워크스페이스마다 토큰 하나(D-0-7). 공개 URL은 `GET /cal/{token}.ics`(인증 없음, `text/calendar`, RFC 5545)이고 `accepted`·`synced` 일정을 담는다. `UID`는 `<event_candidate.id>@lectern`이다. 토큰을 다시 만들면 옛 URL은 404다. |
| D-P4-3 | Google Calendar: OAuth 인가 코드 + PKCE, `access_type=offline`, 범위는 `https://www.googleapis.com/auth/calendar.app.created` 하나다. 연결하면 전용 캘린더 "Lectern"을 만들고 `integration.calendar_id`에 둔다. refresh token은 봉인해서 `token_enc`에 둔다(D-0-8). |
| D-P4-4 | 중복 방지: 일정마다 `extendedProperties.private.lectern_event_id = event_candidate.id`를 넣는다. 넣기 전에 그 값으로 조회해서 있으면 갱신한다. 로컬 대응표는 `calendar_event_link`다. 같은 녹음을 다시 처리하거나 동기화를 다시 돌려도 일정이 늘지 않아야 한다(테스트). |
| D-P4-5 | 동기화는 `job.kind = "calendar_sync"`(subject = integration id)다. `accepted`인데 링크가 없으면 만들고, 고쳐졌으면 갱신하고, `dismissed`가 됐거나 녹음이 지워졌으면 지운다. 성공하면 `event_candidate.status = "synced"`. |
| D-P4-6 | 토큰 오류(`invalid_grant`, 401 반복)면 `integration.status = "needs_reauth"`로 바꾸고 재시도를 멈춘다. 웹이 "다시 연결"을 안내한다. 연결 해제는 Google에 토큰 폐기를 요청하고, 링크 행을 지우고, `synced` 일정을 `accepted`로 되돌린다(Google 쪽 일정은 지우지 않는다. 화면에 그렇게 안내한다). |
| D-P4-7 | 이메일 리마인더: `WorkspaceSettings.reminders = { email: boolean, lead_minutes: number[] }`(기본 꺼짐, 켜면 `[1440]`). `accepted`·`synced` 일정과 마감 있는 `open` 할 일에 대해 `reminder` 행을 만들고, `job.kind = "reminder"`가 5분마다 보낼 것을 찾아 Resend로 보낸다. 같은 (사용자, 대상, 시각)은 한 번만 보낸다. |
| D-P4-9 | 테스트용 가짜 Google은 `apps/server/test/fakes/google.ts` 하나다(`fetch` 경계). P4-02가 만들고 P4-03, P4-04, P5-04가 같은 것을 쓴다. Apple 로그인의 가짜는 P5-05가 `apps/server/test/fakes/apple.ts`로 만든다. |
| D-P4-8 | 물어보기 `list_items` 도구는 범위 안의 `event_candidate`(`accepted`·`synced`·`suggested`)와 `action_item`(`open`)을 기간으로 걸러 돌려준다. |

### DB (`p4_calendar`)

```
calendar_feed(id PK, user_id NOT NULL, workspace_id NOT NULL, token_hash NOT NULL UNIQUE,
              created_at NOT NULL, revoked_at)
calendar_event_link(event_candidate_id PK, integration_id NOT NULL, external_event_id NOT NULL,
              external_etag, state NOT NULL,           -- 'synced' | 'error'
              last_synced_at NOT NULL, error_code)
reminder(id PK, workspace_id NOT NULL, user_id NOT NULL,
              target_type NOT NULL,                    -- 'event' | 'action_item'
              target_id NOT NULL, send_at NOT NULL,
              state NOT NULL,                          -- 'scheduled' | 'sent' | 'canceled' | 'failed'
              sent_at, created_at NOT NULL,
              UNIQUE(user_id, target_type, target_id, send_at))
oauth_state(state_hash PK, user_id, workspace_id,
              purpose NOT NULL,                        -- 'google_calendar' | 'google_login' | 'apple_login'
              code_verifier, redirect_after, created_at NOT NULL, expires_at NOT NULL)
```

### 라우트

| 메서드·경로 | operationId | 비고 |
|---|---|---|
| `POST /integrations/google` | `startGoogleIntegration` (있음) | `oauth_state` 행을 만들고 인가 URL을 돌려준다 |
| `GET /api/v2/integrations/google/callback` | (domain 밖, Hono 라우트) | `code`·`state` 확인 → 토큰 교환 → `302 /app/settings#integrations` |
| `DELETE /integrations/{integration_id}` | `disconnectIntegration` (있음) | D-P4-6 |
| `GET /calendar/feed` | `getCalendarFeed` | `{ url: string \| null, created_at }` (url은 만들 때만 원문, 이후는 `null`과 `exists: true`) |
| `POST /calendar/feed` | `createCalendarFeed` | 만들거나 다시 만든다 → `{ url }` |
| `DELETE /calendar/feed` | `deleteCalendarFeed` | 204 |
| `GET /cal/{token}.ics` | (domain 밖, 공개) | D-P4-2 |

---

## 5. P5 — 계정 · 멀티테넌시

| 번호 | 결정 |
|---|---|
| D-P5-1 | 사용자 행은 v1 `users`가 계속 원본이다. 새 로그인 수단은 `oauth_identity`로 사용자에 연결한다. 같은 **인증된** 이메일의 기존 사용자가 있으면 그 사용자에 연결하고, 없으면 새 사용자를 만든다. 이메일이 인증되지 않은 ID 토큰은 거절한다. |
| D-P5-2 | 웹 세션은 지금의 `lectern_session` 쿠키 그대로다. `auth_session_meta`에 기기 이름·User-Agent·마지막 사용 시각만 더한다(`listDevices`가 읽는다). |
| D-P5-3 | PAT: `lct_pat_<무작위 32바이트 base64url>`. 저장은 해시와 앞 8자(D-0-7). 범위(`AccessTokenScope`)와 만료를 확인한다. `Authorization: Bearer`와 `X-Lectern-Token` 둘 다 받는다. v1 단일 API 토큰은 계속 동작한다. |
| D-P5-4 | 네이티브 토큰: `POST /auth/native/token`이 access(1시간)·refresh(60일) 쌍을 준다. refresh는 쓸 때마다 새 쌍으로 바꾼다(rotation). 이미 쓴 refresh가 다시 오면 그 `family_id` 전체를 폐기한다. |
| D-P5-5 | Google 로그인은 OIDC 인가 코드 + PKCE다(`openid email profile`). ID 토큰은 Google JWKS로 서명·`aud`·`iss`·`exp`를 검증한다. Apple 로그인은 웹 흐름(`response_mode=form_post`)이고 client secret은 ES256 JWT다. 두 콜백 모두 `oauth_state`로 CSRF를 막고, 성공하면 세션 쿠키를 주고 `next`로 보낸다. |
| D-P5-6 | 초대: 이메일과 역할로 만든다. 토큰은 메일 링크(`/app/invite?token=…`)로만 전달한다(D-0-7), 7일 만료. 받는 사람이 로그인한 뒤 수락하면 `membership`이 생긴다. owner는 한 명 이상 남아야 한다(마지막 owner의 역할 변경·제거는 409). |
| D-P5-7 | 쿼터: `workspace_quota`(관리자가 수동으로 넣는다, D10). 행이 없으면 제한 없음이다. 월 오디오 시간과 월 AI 비용을 넘으면 `createUpload`가 402 대신 `409 quota_exceeded`(새 오류 코드)와 한국어 문구를 준다. 집계는 `usage_ledger`다. |
| D-P5-8 | 내보내기: `job.kind = "export"`가 워크스페이스의 녹음 메타데이터(JSON), 문서(Markdown·JSON), 전사(JSON), 오디오 원본(선택)을 zip으로 만든다. 7일 뒤 파일을 지운다. 내려받기는 요청한 사용자만 한다. |
| D-P5-9 | 계정 삭제: 비밀번호(또는 OAuth 재인증) 확인 → 7일 유예(`account_deletion`) → `job.kind = "account_deletion"`이 개인 워크스페이스의 녹음·파일·아카이브·색인·토큰·세션·연동을 지우고 사용자 행을 지운다. 유예 중에는 취소할 수 있다. 팀 워크스페이스의 유일한 owner면 먼저 넘기라고 409를 준다. |
| D-P5-10 | 관리자 콘솔은 `apps/web`의 `/app/admin/*`로 옮긴다. 데이터는 기존 v1 관리자 API(`/api/admin/*`)와 v2 `admin` 라우트를 그대로 쓴다(새 계약 없음). 옛 HTML 콘솔은 P5-13에서 새 화면이 기능 표를 다 덮은 뒤에 지운다. |

### DB (`p5_accounts`)

```
oauth_identity(id PK, user_id NOT NULL, provider NOT NULL,   -- 'google' | 'apple'
               subject NOT NULL, email, created_at NOT NULL, UNIQUE(provider, subject))
auth_session_meta(session_id PK, user_id NOT NULL, client_kind NOT NULL, device_name, user_agent,
               created_at NOT NULL, last_seen_at NOT NULL)
access_token(id PK, user_id NOT NULL, name NOT NULL, scopes_json NOT NULL, token_hash NOT NULL UNIQUE,
               token_prefix NOT NULL, expires_at, last_used_at, created_at NOT NULL, revoked_at)
native_session(id PK, user_id NOT NULL, family_id NOT NULL, device_name, platform,
               access_hash NOT NULL UNIQUE, access_expires_at NOT NULL,
               refresh_hash NOT NULL UNIQUE, refresh_expires_at NOT NULL,
               refresh_used_at, created_at NOT NULL, last_used_at, revoked_at)
workspace_invite(id PK, workspace_id NOT NULL, email NOT NULL, role NOT NULL, token_hash NOT NULL UNIQUE,
               invited_by NOT NULL, created_at NOT NULL, expires_at NOT NULL,
               accepted_at, accepted_by, revoked_at)
workspace_quota(workspace_id PK, audio_ms_month, ai_microusd_month, storage_bytes,
               updated_by NOT NULL, updated_at NOT NULL)
data_export(id PK, user_id NOT NULL, workspace_id NOT NULL, include_audio integer NOT NULL,
               state NOT NULL,                           -- 'queued' | 'running' | 'ready' | 'failed' | 'expired'
               blob_key, bytes, requested_at NOT NULL, ready_at, expires_at, error)
account_deletion(user_id PK, requested_at NOT NULL, execute_after NOT NULL,
               state NOT NULL)                           -- 'scheduled' | 'canceled' | 'done'
```

### 라우트 (P5-C가 domain에 추가. "있음"은 지금 501인 기존 라우트)

| 메서드·경로 | operationId | 비고 |
|---|---|---|
| `POST /me/tokens`, `DELETE /me/tokens/{token_id}` | `createAccessToken`, `revokeAccessToken` (있음) | D-P5-3 |
| `POST /auth/native/token` | `issueNativeToken` | `{ grant_type: "password" \| "refresh_token", … }` → `{ access_token, refresh_token, expires_in, user }`. 인증 없이 열린다 |
| `POST /auth/native/revoke` | `revokeNativeToken` | 204 |
| `GET /api/v2/auth/{google\|apple}/start`, `…/callback` | (domain 밖, Hono 라우트) | D-P5-5 |
| `GET /me/identities`, `DELETE /me/identities/{identity_id}` | `listIdentities`, `unlinkIdentity` | 마지막 로그인 수단은 못 뗀다(409) |
| `GET /workspaces/{workspace_id}/invites`, `POST …/invites`, `DELETE …/invites/{invite_id}` | `listInvites`, `createInvite`, `revokeInvite` | owner·admin |
| `POST /invites/accept` | `acceptInvite` | `{ token }` |
| `PATCH /workspaces/{workspace_id}/members/{user_id}`, `DELETE …` | `updateMember`, `removeMember` | D-P5-6 |
| `GET /workspaces/{workspace_id}/usage` | `getWorkspaceUsage` | `{ period, audio_ms, ai_cost_microusd, storage_bytes, quota }` |
| `PUT /admin/workspaces/{workspace_id}/quota` | `adminSetQuota` | 운영자 전용 |
| `POST /me/exports`, `GET /me/exports`, `GET /me/exports/{export_id}/content` | `createExport`, `listExports`, `getExportContent` | D-P5-8 |
| `POST /me/deletion`, `DELETE /me/deletion`, `GET /me/deletion` | `requestAccountDeletion`, `cancelAccountDeletion`, `getAccountDeletion` | D-P5-9 |

`JobKind`에 `export`, `account_deletion`을 추가한다(웹은 같은 릴리스에서 같이 빌드되므로 안전하다).

---

## 6. P6 — 네이티브

### 6.1 서버 쪽

| 번호 | 결정 |
|---|---|
| D-P6-1 | 푸시 기기는 로그인 세션과 별개다(`/me/devices`는 세션 목록이라 그대로 둔다). `push_device` 테이블과 `/me/push-devices` 라우트를 쓴다. 로그아웃·계정 삭제 때 지운다. |
| D-P6-2 | APNs는 `node:http2`로 `api.push.apple.com`(또는 sandbox)에 붙고 `.p8` 키로 ES256 JWT를 만든다(50분마다 갱신). 테스트는 로컬 HTTP/2 서버를 가짜로 쓴다. 보내는 때는 **처리 단계가 바뀔 때**와 **끝났을 때**뿐이다(진행률마다 보내지 않는다). `410 Unregistered`면 그 토큰을 지운다. |
| D-P6-3 | 녹음 마커: `recording_marker`(원본 오디오 ms + 라벨). `structure` 프롬프트에 "사용자가 중요하다고 표시한 구간"으로 해당 세그먼트 id를 넣는다. |
| D-P6-4 | `GET /.well-known/apple-app-site-association`은 `APPLE_APP_IDS`가 있을 때만 JSON을 준다(없으면 404). 경로는 `/app/*`와 `/s/*`다. |
| D-P6-5 | v1 폐기: 모든 v1 응답 경로에서 `v1_usage`에 (날짜, 경로, 클라이언트) 건수를 쌓는다. `LECTERN_V1_SUNSET`이 있으면 `Deprecation: true`와 `Sunset` 헤더를 붙인다. 차단(`LECTERN_V1_BLOCK=1` + 날짜 지남 → 410)은 사용자가 사용량을 보고 켠다. |
| D-P6-6 | 업로드 API는 지금의 파트 방식 그대로 쓴다. IETF Resumable Uploads 호환은 하지 않는다(네이티브는 `LecternKit`의 업로드 큐가 파트 단위로 재개한다). |
| D-P6-12 | Live Activity의 `content-state`는 서버(P6-02)와 앱(P6-A11)이 같은 모양을 쓴다: `{ "stage": string, "stage_label": string, "progress": number \| null, "recording_id": string, "document_ready": boolean }`. `stage`는 domain `StageName`, `stage_label`은 한국어 표시다. |

DB (`p6_devices`)

```
push_device(id PK, user_id NOT NULL, platform NOT NULL,       -- 'ios' | 'macos'
            name, apns_token NOT NULL UNIQUE, push_to_start_token, app_version,
            created_at NOT NULL, last_seen_at NOT NULL)
live_activity(id PK, recording_id NOT NULL, device_id NOT NULL, push_token NOT NULL,
            state NOT NULL,                                     -- 'active' | 'ended'
            created_at NOT NULL, ended_at, UNIQUE(recording_id, device_id))
recording_marker(id PK, workspace_id NOT NULL, recording_id NOT NULL, at_ms NOT NULL, label,
            created_by NOT NULL, created_at NOT NULL)
v1_usage(day text NOT NULL, route text NOT NULL, client text NOT NULL, count integer NOT NULL,
            PRIMARY KEY(day, route, client))
```

라우트

| 메서드·경로 | operationId |
|---|---|
| `PUT /me/push-devices/{device_id}` (등록·갱신), `DELETE /me/push-devices/{device_id}` | `upsertPushDevice`, `deletePushDevice` |
| `PUT /recordings/{recording_id}/live-activity` `{ device_id, push_token }`, `DELETE …` | `setLiveActivity`, `endLiveActivity` |
| `GET /recordings/{recording_id}/markers`, `POST …`, `DELETE …/{marker_id}` | `listMarkers`, `createMarker`, `deleteMarker` |
| `GET /admin/v1-usage` | `adminListV1Usage` |

### 6.2 Apple 앱 (`apps/apple`)

구조는 NATIVE §3 그대로다. 최소 OS는 iOS 26 / macOS 26이다.

```
apps/apple/
  project.yml                         XcodeGen (생성된 .xcodeproj는 커밋하지 않는다)
  Packages/LecternKit/                API 클라이언트, Keychain 인증, 업로드 큐, 모델
  Packages/RecorderKit/               AVAudioEngine 녹음, 레벨, 마커, (macOS) 시스템 오디오 탭
  Packages/LecternUI/                 SwiftUI 토큰, 문서 블록 렌더러, 전사 동기화 플레이어
  Packages/LecternIntents/            App Intents, App Entities
  iOS/  (App, Widgets: Live Activity·Controls, ShareExtension)
  macOS/ (App: MenuBarExtra + 메인 창)
```

| 번호 | 결정 |
|---|---|
| D-P6-7 | API 클라이언트는 `packages/domain/openapi.json`에서 `swift-openapi-generator`로 만든다(SwiftPM 플러그인, 생성 코드는 커밋하지 않는다). 인증은 D-P5-4의 네이티브 토큰이고 Keychain(접근 그룹 공유)에 둔다. P5-03이 병합되기 전에는 v1 API 토큰으로 동작하게 `AuthProvider` 프로토콜 뒤에 둔다. |
| D-P6-8 | 번들 id: iOS `com.qucord.lectern.ios`, macOS `com.qucord.lectern.macos`(기존과 같아야 마이크 권한이 이어진다). App Group `group.com.qucord.lectern`. 서명 팀 id는 저장소에 넣지 않고 `apps/apple/Local.xcconfig`(gitignore)로 받는다. |
| D-P6-9 | 게이트는 **시뮬레이터 빌드와 SwiftPM 단위 테스트**다. 실제 기기에서만 확인되는 것(백그라운드 3시간 녹음, Dynamic Island, APNs, 시스템 오디오 권한, 공증)은 `apps/apple/MANUAL_CHECKS.md` 점검표로 남기고 STATUS의 "실측 필요"에 올린다. 통과했다고 쓰지 않는다. |
| D-P6-10 | N5(온디바이스 자막·OCR·제안)는 만들지 않는다. 평가 게이트와 기기 확인이 필요하다. STATUS의 "사용자 필요"다. |
| D-P6-11 | 기존 `apps/macos`와 `apps/ios`는 새 앱이 대체할 때까지 지우지 않는다. N0(Keychain 이전)만 `apps/macos`에 한다. |

### 6.3 Android · Windows

v2 파트 업로드로 옮긴다(`createUpload` → `putUploadPart` → `completeUpload`, 같은 `Idempotency-Key`로 재개). 인증은 지금의 v1 API 토큰을 유지한다(`X-Lectern-Token`). v1 업로드 경로를 쓰는 코드는 지우지 않고 설정으로 남긴다.

---

## 7. P7 — 하드닝

| 번호 | 결정 |
|---|---|
| D-P7-1 | 부하 시험은 `scripts/load/`의 Bun 스크립트다. 샌드박스 서버(임시 `LECTERN_DATA_DIR`)를 띄우고 합성 오디오(ffmpeg `sine`/`anoisesrc`)로 동시 업로드 N건, 3시간 길이 파일, 디스크 여유 부족 응답을 본다. AI는 가짜다. Pi에서의 실행은 사용자 몫이다. |
| D-P7-2 | 성능 예산은 CI 테스트로 고정한다: 웹 초기 JS(gzip) 상한, 전사 3,000구간 스크롤의 프레임 드롭, `GET /search` p95(로컬 합성 1,000건). 수치는 첫 측정값의 1.2배로 정하고 문서에 적는다. |
| D-P7-3 | 백업 복원 리허설과 공급자 장애 리허설은 스크립트 + 런북이다. 스크립트는 사본에서만 돈다. |
| D-P7-4 | 인계 점검표: 처음 온 사람이 `AGENTS.md`와 런북만으로 로컬 실행·테스트·배포·롤백을 할 수 있는지 항목별로 확인한 기록을 `docs/runbooks/handover-checklist.md`에 남긴다. |

---

## 8. 보충 — 명세를 쓰며 정한 것

위의 결정이 말하지 않았거나 실제 코드와 부딪혀서, 작업 명세(`wp/<ID>.md`)를 쓰는 동안 정한 것이다. 번호는 `S-n`이다. 이 절은 **CATALOG와 §0~§7의 해당 문장보다 앞선다**(그 문장을 좁히거나 고친 것이다). 각 줄은 요약이고, 세부(함수 이름, 조건, 문구)는 "명세" 칸의 명세가 정한다.

### P1 ~ P3

| 번호 | 결정 | 명세 |
|---|---|---|
| S-1 | 전사 발행(`on`)을 넣으면서 `apps/server/test/transcript-job.test.ts`의 `on` 모드 기대값 한 줄을 바꾼다. 명세가 파일과 줄을 적어 지시한 기존 테스트 변경은 WORKER 금지 5의 예외다(S-31). | P1-10 |
| S-2 | `apps/server/src/ask/legacy.ts`의 `lectureSources`·`isIndexable`은 구조화 문서(`body_json`)와 발행된 전사를 색인 대상으로 넓힌다. | P1-10, P1-12 |
| S-3 | D-P1-3에 더해: `recording.status = partial`은 다음 투영에서 `ready`로 덮이지 않는다. `verifyLegacy`는 구조화 문서가 있는 녹음을 정규화해 비교한다. 오디오 자산이 여럿이면 `projectAudio`가 `duration_ms`를 첫 자산의 길이로 덮어쓰지 않는다. | P1-11, P1-14 |
| S-4 | `publishNotes`에 선택 필드 `keepTitle`을 둔다(다시 만들기에서 사용자가 정한 제목을 지킨다). | P1-11, P1-13 |
| S-5 | 사용자가 고친 할 일은 `updated_at != created_at`으로 판정한다. 다시 만들 때 고치지 않은 열린 항목만 지운다. | P1-11 |
| S-6 | `process` 작업은 서버 키만 쓴다. 서버 키나 ffmpeg가 없으면 `distill`로 되돌아간다. 취소와 원본 삭제는 작업을 `ok: false`로 끝낸다. 어떤 종료도 녹음을 `processing`에 남기지 않는다. | P1-12 |
| S-7 | `deleteLectureById`는 덧붙인 오디오 파트의 파일도 지운다. | P1-14 |
| S-8 | 평가 지표의 정의(P1-15)와 e2e 가짜 Gemini의 JSON 모양(P1-16)은 명세 작성자의 선택이다. 실제 평가 세트와 실제 응답이 생기면 그것에 맞춘다. | P1-15, P1-16 |
| S-9 | 웹 셸이 꺼져 있고(`LECTERN_WEB_SHELL=0`) 옛 화면이 삭제된 뒤에는 `/`와 `/admin`이 503을 준다. | P2-10, P5-14 |
| S-10 | PDF 정렬 결과는 하네스 산출물과 별도로 `DATA_DIR/pdf-align/<recording_id>.json`에 한 벌 더 쓰고 `getRecordingAlignment`가 그것을 읽는다(산출물 blob은 작업이 끝나면 지워질 수 있다). | P3-04 |

### P4 ~ P5

| 번호 | 결정 | 명세 |
|---|---|---|
| S-11 | 리마인더 메일의 수신자는 녹음을 만든 사람(`recording.created_by`)이다. | P4-05 |
| S-12 | 메일 발송 모듈 `apps/server/src/mail.ts`는 P4-05가 만들고 P5-06(초대 메일)이 쓴다. 그래서 P5-06은 P4-05에 의존한다. | P4-05, P5-06 |
| S-13 | 자동 수락은 이미 지난 일정을 건너뛴다. | P4-04 |
| S-14 | `updateWorkspace`의 `settings`는 얕게 병합한다. 값이 `null`인 키는 지운다. | P4-04 |
| S-15 | PAT: 저장하는 접두는 앞 12자다(`lct_pat_`가 8자라 앞 8자는 모두 같다). 워크스페이스 범위는 `scopes_json` 안에 둔다(열을 더하지 않는다). PAT와 네이티브 토큰은 v1 API에서 받지 않는다. | P5-02, P5-03 |
| S-16 | Apple 로그인 콜백(`form_post`)은 교차 사이트 `POST`라 `SameSite=Lax` 쿠키가 실리지 않는다. 한 번만 쓰는 `state`로만 보호하고, 응답은 303이다. | P5-05 |
| S-17 | 네이티브 토큰을 회전하면 옛 refresh는 "쓴 것"으로 표시되고 옛 access는 그 순간 만료된다. 이미 쓴 refresh가 다시 오면 그 묶음(family) 전체를 폐기한다. 푸시 기기의 `{device_id}`는 클라이언트가 만든다. | P5-03, P6-01 |
| S-18 | 사용량의 기간은 Asia/Seoul 기준의 달이다. | P5-07 |
| S-19 | 내보내기 zip은 압축하지 않고 ZIP64를 쓰지 않는다(4 GiB 한도). `include_audio`면 PDF도 넣는다. | P5-08 |
| S-20 | 계정 삭제: 팀 워크스페이스의 비공개 녹음은 지우고, 공개(`workspace`) 녹음은 남기되 `created_by`를 그 워크스페이스의 owner로 바꾼다. | P5-09 |

### P6

| 번호 | 결정 | 명세 |
|---|---|---|
| S-21 | Android·Windows의 v2 업로드: §6.3의 "같은 `Idempotency-Key`로 재개"는 세션이 살아 있는 동안이다. 세션이 만료·취소됐거나 본문이 달라져 409 `idempotency_conflict`가 오면 키에 세대 번호(`<키>-g<n>`)를 붙여 새 세션을 만든다. v1의 `course`는 같은 이름의 최상위 폴더로 옮긴다(없으면 만든다). `recorded_at`은 보내지 않는다. Windows의 키는 파일 이름의 SHA-256 앞 32자다(헤더에 ASCII만 쓴다). 테스트의 가짜 서버는 기존 방식(`ServerSocket`)이고 MockWebServer를 넣지 않는다. | P6-D1, P6-W1 |
| S-22 | v1 차단(`LECTERN_V1_BLOCK`)의 대상은 `/api/lectures*`, `/api/ingest/`, `/api/events`, `/api/clients/`다. `/api/auth/`, `/api/admin/`, `/api/cd/`, `/api/health`는 막지 않는다(새 웹 앱·관리자 콘솔·배포가 쓴다). 집계에는 모두 들어간다. 클라이언트 분류는 기존 `X-Client` 헤더를 먼저 보고, 없으면 User-Agent를 본다. | P6-03 |
| S-23 | push-to-start 페이로드의 `attributes-type`은 `ProcessingActivityAttributes`다. 서버(P6-02)와 앱(P6-A11)의 타입 이름이 같아야 한다. 앱의 디코딩 테스트는 서버의 픽스처(`apps/server/test/fixtures/apns/*.json`)를 그대로 읽는다. | P6-02, P6-A11 |
| S-24 | P6-A0(옛 `apps/macos`)의 `apple` 게이트는 `cd apps/macos && swift build && swift test`다. 그 밖의 Apple 작업은 `bash apps/apple/scripts/gate.sh`이고, 이 스크립트는 `scripts/pre-gate-*.sh` 훅을 먼저 돌린다. | P6-A0, P6-A1 |

### P7과 파이프라인

| 번호 | 결정 | 명세 |
|---|---|---|
| S-25 | 서버에는 디스크가 부족할 때 업로드를 거절하는 규칙이 없다. `scripts/load/disk-full.ts`는 그 상태에서 서버가 살아 있는지와 잃은 녹음이 없는지를 **관찰**해 기록한다. 거절 규칙이 필요하면 새 작업으로 만든다. | P7-01 |
| S-26 | 로드맵의 "공급자 장애 시 전환 리허설"은, 공급자가 Gemini 하나이므로, "장애 때 작업이 끝나고(`failed` 또는 `partial`) 장애가 끝난 뒤 다시 시도하면 된다"는 것을 테스트로 고정하는 것으로 읽는다. | P7-02 |
| S-27 | D-P7-2의 예산 가운데 기계마다 달라지는 것(스크롤 프레임 시간, 검색 p95)은 CI에서 잰 값으로 보정된 뒤에만 실패 조건이 된다(`timing_calibrated_on`, `calibrated_on`이 `"ci"`). 그 전에는 측정값을 보고만 한다. 기계와 무관한 것(초기 JS 크기, 그려진 항목 수)은 항상 강제한다. | P7-03 |
| S-28 | D-P7-4의 "명령 확인"은 세 부류로 나눈다: 로컬에서 실행할 수 있는 것은 실행한다 / 운영 호스트 명령은 유닛·경로·환경 변수 이름을 저장소와 대조만 한다 / 비용이 들거나 바깥에 영향을 주는 것은 실행하지 않는다. 실행하지 않은 수를 점검표에 적는다. | P7-05 |
| S-29 | P7-05는 `pipeline.json`에서 `"last": true`다. 다른 작업이 모두 `merged`·`blocked`이거나 막힌 작업 뒤에 서 있을 때만 시작한다. | P7-05 |
| S-30 | `scripts/` 아래의 테스트(`*.test.ts`)도 `bun test`가 돌리고, 루트 `tsconfig.json`이 `scripts/**/*.ts`를 타입 검사한다. | P3-10, P7-01, P7-02, P7-03 |
| S-31 | WORKER 금지 5(기존 테스트를 지우거나 약하게 만들지 않는다)의 예외는 하나다: 명세가 **파일과 테스트 이름을 적어** 지시한 변경·삭제·`skip`. 오케스트레이터는 그 명세를 보고 확인한다. | WORKER, ORCHESTRATOR |
| S-32 | `windows` 게이트는 로컬에서 돌지 않는다. 오케스트레이터는 명세 7절의 정적 확인으로 합친다. CI는 `main` push와 `main`으로 가는 PR에서만 돌므로, 그런 PR이 열려 있을 때만 `windows-native` 결과를 볼 수 있다(빨가면 되돌리고 `block`). PR이 없으면 "확인 못 함"으로 STATUS에 남긴다. 오케스트레이터는 PR을 스스로 만들지 않는다. P6-CI의 첫 실행과 P7-03의 CI 보정도 같다. | P6-W1, P6-CI, P7-03, ORCHESTRATOR |
