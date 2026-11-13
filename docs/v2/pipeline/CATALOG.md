# 작업 패키지 카탈로그 (CATALOG)

P1 후반 ~ P7을 작업 패키지(WP)로 나눈 목록이다. 순서·의존·소유 파일·게이트의 기계용 원본은 [`pipeline.json`](pipeline.json)이고, 이 문서는 WP마다 **무엇을 만들고 무엇으로 끝났다고 보는지**를 정한다. 단계별 상세 절차는 `wp/<ID>.md`다. 셋이 어긋나면 [CONTRACTS](CONTRACTS.md) > 이 문서 > `wp/<ID>.md` 순으로 믿는다.

읽는 법
- **소유**: 이 WP가 고칠 수 있는 경로다. 밖의 파일은 고치지 않는다([WORKER.md](WORKER.md)).
- **등급**: `basic`은 작은 모델로 충분하다. `careful`은 미묘하게 틀리기 쉬우니 쓸 수 있는 가장 좋은 모델로 돌린다.
- **게이트**: `unit`·`full`은 `scripts/pipeline/gate.sh`의 단계, `apple`·`android`는 [PIPELINE.md](PIPELINE.md#게이트)의 플랫폼 게이트다.
- 모든 WP에 공통인 수용 기준(게이트 통과, 소유 밖 변경 없음, 실제 외부 호출 없음, 기존 테스트를 지우거나 약하게 만들지 않음)은 적지 않는다.

---

## P0 — 기준선 고치기

### P0-01 preflight가 `/` 리다이렉트를 알게 한다
- 의존: 없음 · 소유: `apps/server/` · basic · full
- 배경: `LECTERN_WEB_SHELL=1`이면 `/`가 `/app`으로 302를 보낸다(커밋 `45a9d3b`). `apps/server/src/preflight.ts`의 점검 표는 아직 `["/", 200]`이라 웹 셸을 켠 호스트에서는 배포 사전 점검이 실패한다. 게이트의 "전부 켬" 점검도 같은 이유로 실패한다.
- 만들 것: 점검 표에서 `/`의 기대 상태를 웹 셸이 켜졌으면 302, 꺼졌으면 200으로. 켜졌을 때 `Location`이 `/app`으로 시작하는지, `/?legacy=1`이 200인지, `/app`이 200인지도 본다.
- 수용: `bash scripts/pipeline/gate.sh full`이 끝까지 통과(플래그 끔·켬 두 번의 preflight 포함), `apps/server/test`의 preflight·web-shell 테스트에 두 경우 추가.

---

## P1 — AI 하네스 v2 (노트 파이프라인)

계약: [CONTRACTS §1](CONTRACTS.md#1-p1--노트-파이프라인-전사-발행-구조화-추출-검증). 하네스 WP는 서버 테이블을 모른다. 서버 WP가 발행한다.

### P1-C 계약: `LECTERN_PIPELINE` 플래그와 `job.cancel_requested_at`
- 의존: 없음 · 소유: `packages/config/`, `packages/db/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/` · careful · full
- 만들 것: `LECTERN_PIPELINE`(`v1`\|`v2`, 기본 `v1`)을 config에 추가하고 `config().pipeline`으로 노출. 마이그레이션 `p1_pipeline`(D-0-3, §1.2). `flags-on.env`에 `LECTERN_PIPELINE=v2` 추가.
- 수용: config 테스트(기본값, 잘못된 값 거절), 마이그레이션 테스트(새 컬럼, 기존 행 유지), `docs/env.md` 재생성, 게이트의 preflight가 플래그 켬·끔 모두 통과. 이 WP는 동작을 바꾸지 않는다(플래그를 읽는 코드가 아직 없다).

### P1-01 라우팅, 압축 전사 형식, LLM 공급자
- 의존: P1-C · 소유: `packages/harness/` · careful · unit
- 만들 것: `routing.json`·`src/routing.ts`(§1.4, 모델 id가 허용 목록 밖이면 로드 실패), `src/notes/compact.ts`(§1.3 형식, 토큰 파싱·범위 펼치기), `src/gemini-llm.ts`(`GeminiLlmProvider`), `src/eval/scripted-llm.ts`(`ScriptedLlmProvider`), `src/index.ts` 내보내기. 단가표에 `gemini-3.5-flash-lite`·`gemini-3.8-flash` 텍스트 단가가 없으면 추가.
- 수용: 압축 형식 스냅샷(1시간 넘는 시각, 화자 없음), `#40-#44` 펼치기와 없는 id 탈락, 가짜 `fetch`로 Gemini 요청 본문 검증(헤더 키, `responseSchema`, 모델 id), 빈 응답·`MAX_TOKENS`·차단·JSON 오류가 `HarnessError`의 맞는 분류(`output_validation` + `billed`)로 바뀜, 429·5xx는 `transient`.

### P1-02 템플릿 5종과 로더
- 의존: P1-01 · 소유: `packages/harness/` · basic · unit
- 만들 것: `templates/{lecture,meeting,seminar,interview,general}/`의 `template.json`(§1.5 표 그대로), `prompt.structure.md`, `prompt.extract.md`와 `src/templates.ts`.
- 프롬프트 규칙: 들은 내용만, 지어내지 않기, 모든 블록·항목에 출처 토큰 필수, 시간은 쓰지 말고 `#id`만, 출력 언어는 녹음 언어. `raw_expression`에는 날짜 표현을 원문 그대로 옮긴다.
- 수용: 5개 모두 `TemplateDefinition.parse` 통과, `templateOutputSchema`·`extractResultSchema`가 만들어짐, `questions`가 전부 꺼짐, `templateForDomain` 표 테스트(7개 도메인), 파일 하나를 바꾸면 `hash`가 바뀜.

### P1-03 단계 출력 스키마와 `classify`
- 의존: P1-02 · 소유: `packages/harness/` · basic · unit
- 만들 것: `src/notes/schemas.ts`(§1.6), `src/notes/classify.ts`. 입력은 전사 앞 3분 + 균등 표본 4구간(합쳐 6,000자 이내), 파일명, 사용자 힌트(도메인·폴더), 기존 폴더·태그 이름 목록.
- 규칙: 사용자가 도메인을 정했으면 그 값을 쓴다. 폴더 제안은 기존 폴더 id이거나 새 이름 하나다. 메모 키에 전사 해시·프롬프트 해시·모델을 넣는다.
- 수용: `ScriptedLlmProvider`로 정상 경로, 사용자 도메인 우선, 없는 폴더 id를 모델이 돌려주면 `new_name`으로 바꾸거나 버림, 같은 입력 두 번이면 두 번째는 메모 적중(모델 호출 0회).

### P1-04 `structure` 단계
- 의존: P1-03 · 소유: `packages/harness/` · careful · unit
- 만들 것: `src/notes/structure.ts`. 출력 스키마는 `templateOutputSchema(def)`. 프롬프트 순서는 §1.3. 60,000자 초과면 map → reduce.
- 수용: 정상 경로, 스키마 위반 응답은 수리 1회 뒤 성공, map-reduce 경로에서 창 수만큼 호출하고 출처 토큰이 최종 출력에 남음, 템플릿 파일을 바꾸면 메모가 빗나감, 예산 초과는 `budget`으로 끝남.

### P1-05 한국어 날짜 파서
- 의존: P1-C · 소유: `packages/harness/` · basic · unit
- 만들 것: `src/notes/korean-date.ts`(§1.7). 순수 함수. 시간대 계산은 `Intl.DateTimeFormat`으로 한다(외부 라이브러리 금지).
- 수용: §1.7 표의 23개 경우를 표 테스트로 그대로, 기준일을 금요일·월말·연말로 바꾼 경우 각 3개 이상, `Asia/Seoul`이 아닌 시간대(`America/New_York`) 2개, 못 읽는 입력 5개가 `null`.

### P1-06 `extract` 단계
- 의존: P1-04 · 소유: `packages/harness/` · basic · unit
- 만들 것: `src/notes/extract.ts`. 스키마는 `extractResultSchema(def)`. 켜진 항목이 없으면(`interview`) 호출 없이 빈 결과.
- 수용: 정상 경로, 꺼진 항목이 응답에 있으면 스키마가 거절, `interview`는 모델 호출 0회, `structure`와 같은 시스템·전사 접두부를 쓰는지(요청 본문 비교).

### P1-07 `verify`와 문서 본문 조립
- 의존: P1-05, P1-06 · 소유: `packages/harness/` · careful · unit
- 만들 것: `src/notes/verify.ts`(§1.8 순서). `TemplateOutput` + 추출 결과 + 전사 → `DocumentBody`(블록 id 부여, 출처 토큰 → `SourceRef`, 추출로 채우는 섹션, `GapBlock`), `VerifiedEvent[]`, `VerifiedActionItem[]`, `VerifyReport`.
- 수용: 없는 세그먼트 id 삭제, 출처가 0개가 된 블록은 수리 1회 뒤 탈락하고 보고서에 남음, 인용 불일치 → `low_confidence`, 파서·모델 불일치 → 파서 값 + `date_mismatch`, 파서 실패 → 모델 값 + `needs_review`, `recorded_at_source = upload` → `recorded_at_estimated`, 중복 일정 제거, 필수 섹션이 비면 `partial`, 20분 휴식이 있는 전사에서 `GapBlock` 위치, 결과가 `DocumentBody.parse` 통과.

### P1-08 Markdown 렌더러
- 의존: P1-07 · 소유: `packages/harness/` · basic · unit
- 만들 것: `src/notes/render.ts`. `DocumentBody` → Markdown. 섹션은 `## 제목`, 블록 heading은 `###`, 출처는 블록 끝에 `[MM:SS]`(첫 출처의 시작 시각), 수식은 `$…$` 원문, callout은 인용 블록 + 굵은 꼬리표, gap은 `[쉬는 시간: 50:12~1:02:40]` 형식(v1 렌더러와 같은 표기).
- 수용: 템플릿 5종마다 스냅샷 1개, 같은 입력은 항상 같은 출력, 사용자 글자의 Markdown 특수 문자를 이스케이프, 모르는 블록 `type`은 건너뜀.

### P1-09 `runNotesPipeline`과 장애 주입
- 의존: P1-08 · 소유: `packages/harness/` · careful · unit
- 만들 것: `src/notes/pipeline.ts`: classify → structure → extract → verify → render를 한 작업으로. `onStage` 콜백, 취소 `signal`, 부분 결과(`partial`).
- 수용: 정상 경로, 같은 작업으로 다시 부르면 끝난 단계는 메모 적중, 단계마다 공급자 5xx·타임아웃을 주입해도 재시도 뒤 성공하거나 분류된 오류로 끝남, 중간에 프로세스를 죽인 뒤 재개(`test/transcript-crash.test.ts` 방식), 예산 초과 시 `partial`, `ai_call` 원장에 단계별 호출이 남음.

### P1-10 전사 발행 (서버)
- 의존: P1-C · 소유: `apps/server/` · careful · full
- 만들 것: `src/transcript-publish.ts`(§1.9). `LECTERN_TRANSCRIPT_ENGINE=on`이면 `transcript-job.ts`가 끝난 뒤 발행하고 전사 색인 작업을 넣고 `recording.updated` 이벤트를 쓴다.
- 수용: 발행 뒤 `getTranscript`가 세그먼트·화자·gap을 돌려줌, 두 번 발행해도 행 수가 같음, 사용자가 바꾼 화자 이름 보존, 실패한 청크가 있으면 `missing_transcript` gap, `shadow`·`off`에서는 행이 생기지 않음, v1 계약 테스트 통과.

### P1-11 노트 발행과 브리지 (서버)
- 의존: P1-09, P1-10 · 소유: `apps/server/`, `packages/db/src/legacy.ts`, `packages/db/test/` · careful · full
- 만들 것: `src/notes-publish.ts`(§1.9, D-P1-3, D-P1-5). `projectLecture`의 브리지 규칙(D-P1-3).
- 수용: 한 트랜잭션(중간 실패 시 아무것도 안 남음), 문서·일정·할 일 행이 domain 스키마 통과, `lectures.markdown`이 `rendered_md`와 같고 legacy 문서가 **생기지 않음**, v1로 Markdown을 고치면 legacy 문서 버전이 생기고 구조화 문서가 `user_edited`, 재발행에서 `accepted` 일정 보존·중복 없음, 이전 리허설(`rehearse-v2-migration.ts`)과 preflight의 이전 게이트가 그대로 통과.

### P1-12 `process` 작업 (서버)
- 의존: P1-11 · 소유: `apps/server/`, `apps/worker/` · careful · full
- 만들 것: `src/process-job.ts`(§1.1 흐름, D-P1-1, D-P1-2), 업로드 완료 시 `LECTERN_PIPELINE=v2`면 `process`를, 아니면 지금처럼 distill을 큐에 넣는다. 진행 이벤트(`job.progress`)에 실제 단계 이름을 싣는다. 자동 압축은 `followUp`으로.
- 수용: 가짜 전사·LLM 공급자로 업로드 → `ready`, 노트 단계 실패 → `partial`(전사는 남음), 전사 전부 실패 → `failed`(한국어 원인), 워커 SIGKILL → 회수 → 재개(`transcript-job.test.ts` 방식), 녹음 삭제 중 취소, `LECTERN_PIPELINE=v1`에서 기존 동작 그대로.

### P1-13 다시 만들기, 작업 취소, 관리자 재시도
- 의존: P1-12 · 소유: `apps/server/` · basic · full
- 만들 것: `reprocessRecording`의 `mode: "document"` → `regenerate` 작업(D-P1-4, `dry_run`은 텍스트 단계 추정 비용), `cancelJob`(D-P1-8), `adminRetryJob`(§1.9).
- 수용: 다시 만들기는 전사 단계를 돌리지 않고 문서 버전이 1 늘어남, 대기 중 취소 → 즉시 `canceled`, 실행 중 취소 → 다음 단계 전에 멈추고 `canceled`, 남의 작업은 404, 재시도는 실패한 단계부터(앞 단계 메모 적중).

### P1-14 여러 오디오 파트
- 의존: P1-12 · 소유: `apps/server/`, `packages/media/` · basic · full
- 만들 것: `LECTERN_PIPELINE=v2`일 때 `createUpload`가 오디오 여러 개를 받고(D-P2-8), `process`가 파트를 `part_index` 순으로 이어 붙인다(D-P1-9, `packages/media`에 `concatAudio`).
- 수용: 2파트 업로드 → asset 2개 → 전사 시각이 이어 붙인 타임라인, `v1`에서는 지금의 400 문구 그대로, ffmpeg가 없으면 테스트를 건너뜀(기존 방식).

### P1-15 평가: 문서·추출 지표
- 의존: P1-09 · 소유: `packages/harness/` · basic · unit
- 만들 것: `bun run harness eval`에 노트 지표 추가: 스키마 유효율, 근거 연결률, 일정 날짜 정확도, 과추출률, 1시간당 비용. 내장 합성 세트 + `ScriptedLlmProvider`로 비용 없이 돈다. 실제 세트 형식(`eval/README.md`)에 일정·할 일 주석 CSV를 추가.
- 수용: 합성 세트에서 지표가 결정적으로 나옴, `--baseline` 비교, 실제 공급자는 `--yes` 없이는 예상 비용만 출력하고 멈춤.

### P1-16 웹: v2 처리 상태와 server e2e
- 의존: P1-13 · 소유: `apps/web/` · careful · full
- 만들 것: 진행 단계 이름의 한국어 표시(`app/labels.ts`), `partial` 안내, 구조화 문서가 legacy보다 먼저 보이는 규칙(D-P1-3), "다시 만들기"는 P2-06이 한다. server e2e(`e2e/server/start.ts`)의 가짜 Gemini가 전사·`generateContent` JSON 요청에 답하게 하고 `LECTERN_PIPELINE=v2`로 업로드 → 전사 → 문서 → 출처 이동을 확인.
- 수용: 새 e2e 통과, 기존 e2e 55개 통과, axe 0건.

---

## P2 — 웹 전환 마무리

계약: [CONTRACTS §2](CONTRACTS.md#2-p2--웹-전환-마무리).

### P2-C 계약: 오디오 삭제, 문서 내보내기, 추천 질문 라우트
- 의존: P1-C · 소유: `packages/domain/`, `apps/server/` · careful · full
- 만들 것: D-P2-4의 세 라우트를 domain에 추가(`openapi.json` 재생성), 서버에는 501 스텁으로 등록.
- 수용: domain 테스트·OpenAPI 테스트 통과, 세 라우트가 501을 v2 오류 형식으로 돌려줌, 기존 라우트의 OpenAPI가 바뀌지 않음(추가만).

### P2-01 서버: 오디오 삭제, 문서 내보내기, 추천 질문
- 의존: P2-C · 소유: `apps/server/` · basic · full
- 만들 것: 세 라우트 구현. 오디오 삭제는 v1 "오디오만 지우기"와 같은 함수를 쓰고 asset 행과 파일을 지운다. 추천 질문은 녹음 종류별 고정 질문 + 그 범위의 문서 섹션 제목에서 만든 질문(모델 호출 없음, 최대 6개).
- 수용: 권한 표(만든 사람·owner·admin만 삭제), 삭제 뒤 `getRecording`의 asset이 비고 노트는 남음, 내보내기는 `Content-Disposition`과 UTF-8 파일명, 볼 수 없는 문서는 404.

### P2-02 서버: 공유 링크와 공개 페이지
- 의존: P2-C · 소유: `apps/server/` · careful · full
- 만들 것: `createShareLink`·`updateShareLink`·`revokeShareLink`(D-P2-3, D-0-7), `src/share-page.ts`(공개 HTML, CSP 규칙 준수, `escapeHtml`), 비밀번호 폼과 횟수 제한, v1 공유 토큰 호환.
- 수용: 만료·회수·비밀번호 틀림·횟수 초과 각각의 응답, 범위(`ShareScope`)에 없는 것(전사·오디오)은 공개 페이지에 나오지 않음, 악성 제목·본문이 이스케이프됨(`ui.test.ts` 방식), v1 `PATCH /api/lectures/{id}/visibility`로 만든 링크가 계속 열림, 토큰 원문이 DB에 없음.

### P2-03 웹: 회원가입, 이메일 인증, 비밀번호 재설정
- 의존: 없음 · 소유: `apps/web/` · basic · full
- 만들 것: `/app/signup`, `/app/reset` 화면(D-P2-1). 로그인 화면의 "기존 화면으로" 안내를 이 화면 링크로 바꾼다.
- 수용: 키보드만으로 가입 → 코드 입력 → 로그인, 서버 오류 문구를 `role="alert"`로, 비밀번호 칸 자동 완성 속성(`new-password`), axe 0건, fixture·server e2e 각 1개.

### P2-04 웹: 문서 편집
- 의존: 없음 · 소유: `apps/web/` · careful · full
- 만들 것: 녹음 상세의 "편집"(D-P2-2). legacy는 `<textarea>` 편집기 + 미리보기, 구조화 문서는 블록 글자 편집. 저장 안 한 글이 있으면 떠날 때 확인.
- 수용: 저장 뒤 버전이 늘고 "직접 수정" 표시, 412 대화상자, Esc·⌘S, 한글 조합 중 단축키 무시, axe 0건, e2e.

### P2-05 웹: 공유 UI
- 의존: P2-02 · 소유: `apps/web/` · basic · full
- 만들 것: 녹음 상세의 "공유" 대화상자(만들기, 만료·비밀번호, 링크 복사, 회수), 설정의 내 공유 링크 목록.
- 수용: 링크는 만든 직후에만 원문이 보임을 안내, 회수 확인, axe 0건, server e2e(만들기 → 공개 페이지 열림 → 회수 → 404).

### P2-06 웹: 재처리, 오디오 삭제, Markdown 내려받기, 추천 질문
- 의존: P2-01, P1-13 · 소유: `apps/web/` · basic · full
- 만들 것: 녹음 메뉴에 "다시 처리…"(`dry_run` 비용을 보여 준 뒤 확인), "문서만 다시 만들기", "오디오만 삭제…", "Markdown 내려받기". 추천 질문을 `listAskSuggestions`로 바꾸고 501이면 지금의 화면 규칙으로 떨어진다.
- 수용: 비용 확인 없이는 재처리 요청이 나가지 않음, 삭제 확인, e2e, axe 0건.

### P2-07 웹: Pretendard 직접 호스팅
- 의존: 없음 · 소유: `apps/web/` · basic · full
- 만들 것: D-P2-7. woff2를 `apps/web/public` 또는 빌드 자산으로 넣고 `@font-face`, 토큰의 글꼴 스택 맨 앞에 둔다. 라이선스 파일(OFL)을 함께 둔다.
- 수용: 외부 오리진 요청 0건(e2e의 CSP 검사), `font-display: swap`, 빌드 산출물에 글꼴이 해시된 이름으로 들어감.

### P2-08 v1 화면 기능 대조표와 e2e
- 의존: P2-03, P2-04, P2-05, P2-06 · 소유: `apps/web/`, `docs/v2/pipeline/PARITY.md` · careful · full
- 만들 것: `apps/server/src/ui.ts`의 사용자 앱 화면이 하는 일을 전부 나열한 표(`PARITY.md`: v1 기능, 새 앱의 위치, 덮는 e2e 테스트 이름). 빠진 e2e를 추가한다. 새 앱에 없는 기능은 표에 "없음"으로 적고 `BLOCKED`가 아니라 보고의 `NEEDS`에 올린다.
- 수용: 표의 모든 행에 e2e 이름이 있거나 "없음" 사유가 있음, server e2e 통과.

### P2-09 `LECTERN_WEB_SHELL` 기본값을 켬으로
- 의존: P2-08, P2-07 · 소유: `packages/config/`, `docs/env.md`, `deploy/systemd/`, `apps/server/`, `docs/runbooks/`, `AGENTS.md` · careful · full
- 만들 것: D-P2-6 ①. 기본값 `1`, `?legacy=1` 유지, preflight 점검에 `/` → `/app` 리다이렉트와 `/app` 200 추가, 런북(deploy-and-rollback)에 되돌리는 법(`LECTERN_WEB_SHELL=0`).
- 수용: 조건 — `PARITY.md`에 "없음" 행이 남아 있으면 이 WP는 `BLOCKED`. 플래그 끔에서 옛 화면 그대로, 켬에서 리다이렉트, preflight 통과.

### P2-10 `ui.ts` 사용자 앱 화면 삭제
- 의존: P2-09 · 소유: `apps/server/` · careful · full · **사용자 승인 필요**
- 만들 것: D-P2-6 ②. 사용자 앱 HTML·스크립트·그 테스트를 지운다. 공유 페이지(P2-02), 관리자 콘솔, 법적 페이지는 남긴다.
- 수용: `/`는 `/app`으로, `?legacy=1`은 더 이상 없음, 관리자 콘솔과 v1 API는 그대로, v1 계약 테스트 통과.

---

## P3 — PDF · 검색 · 물어보기 확장

계약: [CONTRACTS §3](CONTRACTS.md#3-p3--pdf--검색--물어보기-확장).

### P3-C 계약: `LECTERN_PDF`, `pdf_page`, 라우트, `pdfjs-dist`
- 의존: P2-C · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `packages/pdf/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `apps/web/package.json`, `bun.lock`, `tsconfig.json` · careful · full
- 만들 것: 플래그, 마이그레이션 `p3_pdf`, §3의 세 라우트(서버 501 스텁), 새 워크스페이스 `packages/pdf`(뼈대와 `pdfjs-dist` 정확한 버전 의존성, 테스트용 `pdf-lib` devDependency), `apps/web`에도 같은 버전의 `pdfjs-dist`. 검색 적중·물어보기 인용에 PDF 쪽 종류가 없으면 추가.
- 수용: `bun install --frozen-lockfile` 통과, 의존성 버전이 정확히 고정됨(`^` 없음), domain·OpenAPI 테스트, preflight 통과.

### P3-01 서버: PDF 업로드
- 의존: P3-C · 소유: `apps/server/` · basic · full
- 만들 것: `LECTERN_PDF=1`이면 `createUpload`가 PDF 파트를 받는다(D-P3-2 상한, `%PDF-` 매직 바이트 확인, `application/pdf`). 완료 시 `asset.kind = "pdf"`, `page_count`. `getAssetContent`가 PDF를 `nosniff`·`Content-Disposition: inline`으로 준다.
- 수용: 오디오+PDF 한 녹음, PDF만 있는 업로드는 400, 상한 초과 413, 매직 바이트가 틀리면 400, 플래그 끔에서는 지금의 거절 그대로.

### P3-02 `packages/pdf`: 쪽 글자 추출
- 의존: P3-C · 소유: `packages/pdf/` · careful · unit
- 만들 것: `extractPdfPages(path): Promise<{ pageCount; pages: { pageNo; text; charCount; hasTextLayer }[]; scanned: boolean }>`(D-P3-3). 쪽 글자는 줄 순서를 지키고 공백을 정리한다. 암호 걸린 PDF·손상 파일은 분류된 오류.
- 수용: `pdf-lib`로 만든 한국어·영어 3쪽 PDF에서 쪽별 글자, 글자 없는 쪽 → `hasTextLayer: false`, 절반 이상이면 `scanned`, 손상 파일 오류, 500쪽 상한.

### P3-03 `pdf_ingest` 단계와 쪽 저장
- 의존: P3-01, P3-02, P1-12 · 소유: `packages/harness/`, `apps/server/` · basic · full
- 만들 것: 하네스 `pdf_ingest` 단계(PDF asset마다, 메모 키는 파일 sha256), `process` 작업이 PDF가 있으면 돌리고 `pdf_page` 행으로 저장, `listAssetPages` 구현, 녹음 삭제 시 `pdf_page` 삭제.
- 수용: 업로드 → `listAssetPages`, 같은 PDF 재업로드는 메모 적중, 스캔본은 `scanned: true`이고 OCR이 돌지 않음, PDF 처리 실패가 녹음 전체를 실패시키지 않음(`partial`).

### P3-04 `align` 단계와 구조화 문맥
- 의존: P3-03 · 소유: `packages/harness/`, `apps/server/` · careful · full
- 만들 것: `align` 단계(D-P3-4, 2-gram BM25는 `packages/ask`의 토크나이저와 같은 규칙을 하네스 안에 구현하거나 가져온다), `structure`·`extract` 문맥에 관련 쪽 추가, `verify`의 `pdf_pages` 검사와 `SourceRef` 변환, `getRecordingAlignment`.
- 수용: 합성 전사·PDF에서 창마다 맞는 쪽이 1위, 문맥이 12쪽·쪽당 2,000자를 넘지 않음, 집합 밖 쪽 번호는 `verify`가 지움, PDF가 없는 녹음은 이 단계를 건너뜀.

### P3-05 OCR 승인 흐름
- 의존: P3-03 · 소유: `packages/harness/`, `apps/server/` · careful · full
- 만들 것: `ocrAsset`(D-P3-3): `dry_run`은 비용만, 아니면 `process` 큐에 OCR 작업을 넣는다. Gemini PDF 입력 어댑터(`routing.ocr`, 가짜 `fetch` 테스트)와 결과를 `pdf_page`에 `ocr_source = "model"`로 저장, 색인 갱신.
- 수용: `dry_run`은 모델을 부르지 않음, 승인 없이 OCR이 돌지 않음(테스트), 글자 층이 있는 쪽은 다시 OCR하지 않음, 비용이 `ai_call`에 남음.

### P3-06 PDF 쪽 색인, 쪽 인용, 하이브리드 `/search`
- 의존: P3-03 · 소유: `packages/ask/`, `apps/server/` · careful · full
- 만들 것: D-P3-5. 색인 단계 입력에 PDF 쪽, 인용 검증의 쪽 종류, `GET /search`를 하이브리드 색인으로(색인이 없으면 부분 문자열로 떨어짐).
- 수용: PDF에만 있는 말을 물으면 쪽 인용, 범위 밖 PDF는 나오지 않음(범위 표 테스트에 PDF 행 추가), 검색 결과에 전사·문서·PDF 종류, `LECTERN_ASK=0`에서 기존 검색 테스트 통과.

### P3-07 물어보기 도구 루프 테스트
- 의존: P3-06 · 소유: `packages/ask/`, `packages/harness/`, `apps/server/` · careful · full
- 만들 것: D-P3-6. 가짜 Gemini 함수 호출 응답(사고 서명 포함)을 주는 테스트 공급자, 폴더·워크스페이스 범위의 `search_notes`·`read_more` 경로 테스트, 라운드 상한.
- 수용: 도구 라운드 뒤 답과 인용, 노트 범위에서는 도구가 제공되지 않음, 3번째 도구 호출은 무시되고 답으로 끝남, 사고 서명 파트가 다음 요청에 그대로 실림, 질문 1회 상한 초과 시 `budget_exceeded`.

### P3-08 웹: PDF 뷰어
- 의존: P3-C, P3-03 · 소유: `apps/web/` · careful · full
- 만들 것: 녹음 상세 자료 패널의 pdf.js 뷰어(D-P3-7): 쪽 이동, 확대, 글자 선택, 문서·물어보기의 쪽 출처를 누르면 그 쪽으로. 스캔본이면 OCR 비용 확인 대화상자(P3-05가 있으면).
- 수용: CSP 위반 0건, 키보드로 쪽 이동, 큰 PDF에서 보이는 쪽만 그림, axe 0건, fixture e2e(합성 PDF).

### P3-09 웹: 전역 검색
- 의존: P3-06 · 소유: `apps/web/` · basic · full
- 만들 것: `/app/search` 화면과 ⌘K의 내용 검색을 하이브리드 `GET /search`로. 결과는 종류(전사·문서·PDF)별 묶음, 누르면 그 위치로.
- 수용: 한글 조합 중 요청을 보내지 않음, 결과 0건 안내, e2e, axe 0건.

### P3-10 검색 성능 측정
- 의존: P3-06 · 소유: `scripts/bench/`, `packages/ask/` · basic · unit
- 만들 것: `scripts/bench/search.ts`: 합성 녹음 1,000건(조각 약 5만 개)을 임시 DB에 넣고 `GET /search` 경로의 p50·p95를 잰다. 임베딩은 결정적 가짜다.
- 수용: 스크립트가 수치를 출력하고 `--max-p95-ms`를 넘으면 종료 코드 1. 로컬 수치를 `docs/v2/pipeline/STATUS.md`의 "실측 필요"(Pi 기준 200ms)에 연결할 수 있게 README에 실행법.

---

## P4 — 캘린더 · 리마인더

계약: [CONTRACTS §4](CONTRACTS.md#4-p4--캘린더--리마인더).

### P4-C 계약: `LECTERN_CALENDAR`, 테이블, 라우트, 방침
- 의존: P3-C · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `docs/runbooks/` · careful · full
- 만들 것: 플래그와 Google OAuth 시크릿, 마이그레이션 `p4_calendar`, feed 라우트 3개(501 스텁), `WorkspaceSettings.reminders`, 개인정보처리방침(Google Calendar, 리마인더 메일), secret-rotation 런북에 Google OAuth 항목.
- 수용: config·domain·마이그레이션 테스트, `legal.test.ts` 통과, preflight 통과.

### P4-01 ICS 구독
- 의존: P4-C · 소유: `apps/server/` · basic · full
- 만들 것: feed 라우트 구현과 `GET /cal/{token}.ics`(D-P4-2). RFC 5545: `VCALENDAR`/`VEVENT`, `DTSTAMP`, 하루 종일은 `VALUE=DATE`, 시각은 UTC, 줄 접기 75옥텟, 글자 이스케이프(`,`, `;`, `\`, 줄 바꿈).
- 수용: 고정 입력의 ICS 스냅샷, 토큰 재발급 뒤 옛 URL 404, 회수 뒤 404, 다른 사용자의 일정이 섞이지 않음, 비공개 녹음의 일정은 만든 사람 feed에만.

### P4-02 Google OAuth와 연동 수명 주기
- 의존: P4-C · 소유: `apps/server/` · careful · full
- 만들 것: `src/google/oauth.ts`(인가 URL, 코드 교환, refresh, 폐기), `startGoogleIntegration`, 콜백 라우트, `disconnectIntegration`(D-P4-3, D-P4-6), 전용 캘린더 생성, 테스트용 가짜 Google(`test/fakes/google.ts`, `fetch` 경계).
- 수용: `state` 불일치·만료는 400, 콜백 성공 시 `integration` 행과 봉인된 토큰(평문이 DB·로그에 없음), `invalid_grant` → `needs_reauth`, 연결 해제 뒤 링크 행 0개·`synced` → `accepted`, 시크릿이 없으면 501.

### P4-03 `calendar_sync` 작업
- 의존: P4-02 · 소유: `apps/server/`, `apps/worker/` · careful · full
- 만들 것: `src/google/calendar.ts`(insert·patch·delete·`privateExtendedProperty` 조회), `calendar_sync` 핸들러(D-P4-4, D-P4-5). 일정 수락·수정·무시와 녹음 삭제가 작업을 큐에 넣는다.
- 수용: 수락 → Google에 1건, 같은 작업 재실행 → 여전히 1건, 링크 행이 없어도 확장 속성으로 찾아 갱신, 수정 → patch, 무시·삭제 → delete, 429·5xx 재시도, `needs_reauth`에서는 호출하지 않음.

### P4-04 자동 등록과 재처리 멱등성
- 의존: P4-03, P1-12 · 소유: `apps/server/` · basic · full
- 만들 것: D-P4-1. `publishNotes`가 끝난 뒤 자동 등록 조건에 맞는 일정을 `accepted`로 만들고 동기화를 넣는다. `updateWorkspace`로 설정을 받는다.
- 수용: 설정이 꺼지면 전부 `suggested`, 켜면 조건에 맞는 것만, 같은 녹음을 다시 처리해도 Google 일정 수가 늘지 않음(ROADMAP P4 종료 기준 테스트).

### P4-05 이메일 리마인더
- 의존: P4-C · 소유: `apps/server/`, `apps/worker/` · basic · full
- 만들 것: D-P4-7. `reminder` 행 만들기(일정 수락, 할 일 마감 변경 시 다시 계산), `reminder` 작업, 메일 본문(제목, 시각, 출처 녹음 링크, 끄는 법).
- 수용: 가짜 Resend로 1통, 같은 대상·시각은 한 번만, 일정이 취소·무시되면 `canceled`, 설정이 꺼지면 만들지 않음, 지난 시각의 리마인더는 보내지 않음.

### P4-06 물어보기 `list_items`
- 의존: P4-C, P3-07 · 소유: `packages/ask/`, `apps/server/` · basic · full
- 만들 것: D-P4-8. 서버가 `listItems` 의존성을 주입한다.
- 수용: "이번 주 마감" 류의 도구 호출이 범위·기간으로 걸러진 항목을 돌려줌, 남의 비공개 녹음의 항목은 나오지 않음.

### P4-07 웹: 캘린더 연결, ICS, 리마인더 설정
- 의존: P4-01, P4-02, P4-05 · 소유: `apps/web/` · basic · full
- 만들 것: 설정 "연동"의 Google 연결·해제·다시 연결 안내, ICS URL 만들기·복사·다시 만들기, 리마인더 설정, 일정 화면의 연결 카드와 동기화 상태 표시.
- 수용: 501이면 "준비 중", `needs_reauth` 안내, 해제 확인 문구(Google 쪽 일정은 남는다), axe 0건, fixture e2e.

---

## P5 — 계정 · 멀티테넌시

계약: [CONTRACTS §5](CONTRACTS.md#5-p5--계정--멀티테넌시).

### P5-C 계약: 플래그, 테이블, 라우트, 방침
- 의존: P4-C · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `docs/runbooks/` · careful · full
- 만들 것: §0.2의 P5 플래그·시크릿, 마이그레이션 `p5_accounts`, §5 라우트(501 스텁), `JobKind`에 `export`·`account_deletion`, 오류 코드 `quota_exceeded`, 방침(Google·Apple 로그인), 런북 항목.
- 수용: config·domain·OpenAPI·마이그레이션 테스트, preflight 통과.

### P5-01 세션 메타와 기기 목록
- 의존: P5-C · 소유: `apps/server/` · basic · full
- 만들 것: D-P5-2. 로그인 때 `auth_session_meta` 행, 요청 때 `last_seen_at`(5분에 한 번만 씀), `listDevices`가 기기 이름·UA·마지막 사용을 돌려줌, 로그아웃·세션 삭제 시 행 삭제.
- 수용: 기기 이름은 UA에서 만든 한국어 표기("Mac의 Chrome"), 기존 세션(메타 없음)은 null로 보임.

### P5-02 개인 액세스 토큰(PAT)
- 의존: P5-C · 소유: `apps/server/` · careful · full
- 만들 것: D-P5-3. `createAccessToken`·`revokeAccessToken`·`listAccessTokens`, `auth.ts`의 PAT 인증.
- 수용: 원문은 생성 응답에만, 만료·회수된 토큰 401, `recordings:read` 토큰으로 쓰기 403, v1 API 토큰 계속 동작, 원문이 DB·로그에 없음.

### P5-03 네이티브 토큰 쌍
- 의존: P5-C · 소유: `apps/server/` · careful · full
- 만들 것: D-P5-4. `issueNativeToken`(password, refresh_token), `revokeNativeToken`, `auth.ts`의 access 토큰 인증, 로그인 시도 횟수 제한은 기존 로그인과 같은 규칙.
- 수용: refresh 회전, 쓴 refresh 재사용 → 가족 전체 폐기, 만료된 access 401, 비밀번호 변경 시 그 사용자의 네이티브 세션 전부 폐기.

### P5-04 Google 로그인
- 의존: P5-C, P4-02 · 소유: `apps/server/` · careful · full
- 만들 것: D-P5-1, D-P5-5. start·callback 라우트, ID 토큰 검증(JWKS 캐시), 계정 연결, `listIdentities`·`unlinkIdentity`.
- 수용: 가짜 Google로 새 사용자·기존 사용자 연결·`email_verified=false` 거절·`aud` 불일치 거절·`state` 재사용 거절, `next`는 같은 오리진 경로만, 플래그 끔이면 404.

### P5-05 Sign in with Apple
- 의존: P5-04 · 소유: `apps/server/` · careful · full
- 만들 것: D-P5-5. client secret JWT(ES256), `form_post` 콜백(교차 사이트 POST이므로 `SameSite=Lax` 세션 쿠키와 `state`로 확인), Apple JWKS 검증, 비공개 릴레이 이메일 처리.
- 수용: 가짜 Apple로 로그인·연결, 키 파일이 없으면 501, `nonce` 불일치 거절.

### P5-06 초대, 역할, 팀 업로드
- 의존: P5-C, P4-05(초대 메일이 `mail.ts`를 쓴다) · 소유: `apps/server/` · careful · full
- 만들 것: D-P5-6, D-P2-8. 초대 라우트와 메일, `acceptInvite`, `updateMember`·`removeMember`, `LECTERN_TEAMS=1`에서 팀 워크스페이스 업로드, 권한 표 테스트(`api-v2-access.test.ts`)를 역할 × 행동 × 리소스 전체로 확장.
- 수용: 만료·회수된 초대 거절, 다른 이메일로 로그인한 사람의 수락 거절, 마지막 owner 보호(409), viewer는 업로드 불가, 팀 녹음의 `private`·`workspace` 가시성 표.

### P5-07 쿼터와 사용량
- 의존: P5-C · 소유: `apps/server/` · basic · full
- 만들 것: D-P5-7. `usage_ledger` 집계(업로드 완료, 작업 비용, 저장 용량), `getWorkspaceUsage`, `adminSetQuota`, 업로드·물어보기 집행.
- 수용: 쿼터 없음 = 제한 없음, 초과 시 `409 quota_exceeded`, 달이 바뀌면 새 기간, 운영자만 쿼터 변경.

### P5-08 데이터 내보내기
- 의존: P5-C · 소유: `apps/server/`, `apps/worker/` · basic · full
- 만들 것: D-P5-8. `export` 작업(zip 스트리밍, 임시 파일은 `DATA_DIR` 아래 0600), 라우트 3개, 만료 정리(유지보수).
- 수용: zip 안의 목록과 JSON 스키마, 오디오 포함 여부, 남의 내보내기 404, 7일 뒤 파일 삭제와 `expired`.

### P5-09 계정 삭제
- 의존: P5-08 · 소유: `apps/server/`, `apps/worker/` · careful · full
- 만들 것: D-P5-9. 요청·취소·조회 라우트, `account_deletion` 작업, 삭제 범위 전부.
- 수용: 유예 중 로그인 가능하고 취소됨, 실행 뒤 그 사용자의 행이 어느 테이블에도 없음(테이블 전수 검사 테스트), 파일·아카이브·색인 삭제, 유일한 owner면 409, v1 계약 테스트 통과.

### P5-10 웹: 계정 화면과 로그인 버튼
- 의존: P5-01, P5-02, P5-04, P5-05, P5-08, P5-09 · 소유: `apps/web/` · basic · full
- 만들 것: 설정 "계정": 기기, 토큰(만들기·회수), 연결된 로그인, 내보내기, 계정 삭제(유예 안내와 취소). 로그인·가입 화면의 Google·Apple 버튼(플래그가 꺼지면 숨김).
- 수용: 토큰 원문은 한 번만 보이고 복사 버튼, 삭제는 문구 입력 확인, 501이면 "준비 중", axe 0건, e2e.

### P5-11 웹: 멤버, 초대, 사용량
- 의존: P5-06, P5-07 · 소유: `apps/web/` · basic · full
- 만들 것: 설정 "워크스페이스": 멤버 역할 변경·제거, 초대 만들기·회수, `/app/invite` 수락 화면, 사용량과 쿼터 막대.
- 수용: 역할에 따라 버튼이 꺼짐, 마지막 owner 안내, axe 0건, e2e.

### P5-12 웹: 관리자 콘솔 1부
- 의존: P5-C · 소유: `apps/web/` · basic · full
- 만들 것: D-P5-10. `/app/admin`: 개요, 사용자, 작업(단계 타임라인·비용, 재시도), 사용량·쿼터. 운영자가 아니면 404 화면.
- 수용: v1 관리자 API 응답을 그대로 그림, 표는 키보드로 정렬·이동, axe 0건, server e2e.

### P5-13 웹: 관리자 콘솔 2부
- 의존: P5-12 · 소유: `apps/web/`, `docs/v2/pipeline/PARITY-ADMIN.md` · basic · full
- 만들 것: 저장소(압축·정리·보존), 운영(유지보수 실행, 백업, 배포 기록), 설정, 감사 로그, v1 사용량(P6-03이 있으면). 옛 콘솔 기능 대조표.
- 수용: 대조표의 모든 행에 새 화면 위치와 e2e 이름, axe 0건.

### P5-14 옛 관리자 콘솔 HTML 삭제
- 의존: P5-13, P2-10 · 소유: `apps/server/` · careful · full · **사용자 승인 필요**
- 만들 것: `ui.ts`의 관리자 콘솔 HTML과 스크립트 삭제, `/admin` → `/app/admin` 리다이렉트.
- 수용: v1 관리자 API는 그대로, preflight 통과.

### P5-15 보안 테스트 묶음
- 의존: P5-02, P5-03, P5-04, P5-06, P2-02 · 소유: `apps/server/test/`, `docs/v2/pipeline/SECURITY-REVIEW.md` · careful · full
- 만들 것: 테스트: 세션 고정(로그인 시 새 세션 id), 쿠키 속성, 쿠키 인증 변경 요청의 `Origin`/`Sec-Fetch-Site` 검사, 로그인·공유 비밀번호·초대 수락·네이티브 토큰의 횟수 제한, 업로드 MIME·확장자·경로 조작, 열린 리다이렉트(`next`), 토큰 해시 저장, IDOR(남의 워크스페이스 id로 모든 v2 라우트 호출 → 403/404). 발견한 문제는 고치지 말고 `SECURITY-REVIEW.md`에 심각도와 함께 적는다.
- 수용: 테스트가 전부 통과하거나, 실패하는 것은 `test.failing`이 아니라 보고서에 적고 `BLOCKED`. 사람(또는 상위 모델)의 리뷰는 STATUS의 "사용자 필요"다.

---

## P6 — 네이티브

계약: [CONTRACTS §6](CONTRACTS.md#6-p6--네이티브), [NATIVE.md](../NATIVE.md).

### P6-C 계약: APNs 설정, 테이블, 라우트, 방침
- 의존: P5-C · 소유: `packages/config/`, `packages/db/`, `packages/domain/`, `docs/env.md`, `deploy/systemd/`, `docs/v2/pipeline/flags-on.env`, `apps/server/`, `docs/runbooks/` · careful · full
- 만들 것: §0.2의 P6 변수, 마이그레이션 `p6_devices`, §6.1 라우트(501 스텁), 방침(Apple APNs), secret-rotation 런북의 APNs 키 항목.
- 수용: config·domain·마이그레이션 테스트, preflight 통과.

### P6-01 서버: 푸시 기기, Live Activity 토큰, 마커
- 의존: P6-C · 소유: `apps/server/`, `packages/harness/` · basic · full
- 만들 것: D-P6-1, D-P6-3. 라우트 구현, 로그아웃·계정 삭제 시 정리, `structure` 프롬프트의 마커 힌트.
- 수용: 같은 `apns_token` 재등록은 갱신, 남의 녹음에 마커 불가, 마커가 있으면 `structure` 요청 본문에 해당 `#id`가 실림.

### P6-02 서버: APNs 발송기
- 의존: P6-01, P1-12 · 소유: `apps/server/`, `apps/worker/` · careful · full
- 만들 것: D-P6-2. `src/apns/jwt.ts`, `src/apns/client.ts`(`node:http2`), `src/apns/notify.ts`(단계 변경 → Live Activity 업데이트, 완료 → 알림 + Live Activity 종료), 가짜 APNs(로컬 HTTP/2 서버).
- 수용: JWT 헤더·클레임과 50분 재사용, 단계가 바뀔 때만 발송, `410` → 토큰 삭제, `429`·5xx 재시도, 플래그 끔이면 연결하지 않음, 페이로드 스냅샷(`liveactivity`·`alert`).

### P6-03 서버: `apple-app-site-association`, v1 사용량과 Sunset
- 의존: P6-C · 소유: `apps/server/` · basic · full
- 만들 것: D-P6-4, D-P6-5. `adminListV1Usage`.
- 수용: 변수 없으면 404, 있으면 `application/json`과 맞는 경로, v1 요청마다 건수 증가(같은 날·경로·클라이언트는 한 행), 헤더, 차단은 날짜 지남 + 플래그일 때만 410, v2는 영향 없음.

### P6-A0 macOS: 토큰을 Keychain으로
- 의존: 없음 · 소유: `apps/macos/` · basic · apple
- 만들 것: NATIVE N0. `UserDefaults`의 `lectern_auth_token`을 Keychain(`kSecClassGenericPassword`)으로 옮기고, 첫 실행 때 옛 값을 옮긴 뒤 지운다.
- 수용: `swift build` 통과, `UserDefaults`에 토큰을 쓰는 코드가 없음(`git grep`), 이전 로직의 단위 테스트(저장소 추상화).

### P6-A1 `apps/apple` 뼈대와 게이트
- 의존: 없음 · 소유: `apps/apple/`, `.gitignore` · careful · apple
- 만들 것: §6.2 구조, `project.yml`(iOS 앱, macOS 앱, 위젯 확장, 공유 확장 타깃. 빈 화면), 네 Swift 패키지 뼈대와 테스트 타깃, `apps/apple/scripts/gate.sh`(xcodegen → 시뮬레이터 빌드 → macOS 빌드 → 패키지별 `swift test`), `Local.xcconfig.example`, `MANUAL_CHECKS.md`, README.
- 수용: `bash apps/apple/scripts/gate.sh` 통과, `.xcodeproj`와 `Local.xcconfig`가 gitignore, 서명 팀 id가 저장소에 없음.

### P6-A2 LecternKit: API 클라이언트와 인증
- 의존: P6-A1 · 소유: `apps/apple/` · careful · apple
- 만들 것: D-P6-7. OpenAPI 생성 설정, `AuthProvider`(v1 토큰 / 네이티브 토큰), Keychain 저장소, 401 시 refresh 1회 뒤 재시도, 도메인 모델의 얇은 Swift 래퍼(녹음 목록·상세·문서·전사).
- 수용: `URLProtocol` 가짜로 목록·상세 디코딩(픽스처 JSON은 `packages/domain` 테스트 픽스처에서 가져온다), refresh 회전, 모르는 블록 `type`은 무시.

### P6-A3 LecternKit: 재개 가능한 업로드 큐
- 의존: P6-A2 · 소유: `apps/apple/` · careful · apple
- 만들 것: 백그라운드 `URLSession` 업로드 큐. 파트 계획 → 파트 PUT → complete, 대기열은 App Group 컨테이너의 파일, 앱 재시작 뒤 `getUpload`로 받은 파트를 건너뛴다. `recorded_at`을 보낸다.
- 수용: 가짜 서버로 3파트 업로드, 2번째 파트에서 끊긴 뒤 재개(1번 파트 재전송 없음), 같은 `Idempotency-Key`, 큐 직렬화 왕복.

### P6-A4 RecorderKit
- 의존: P6-A1 · 소유: `apps/apple/` · careful · apple
- 만들 것: `AVAudioEngine` 녹음(AAC m4a), 입력 레벨, 무음 경고, 일시정지·재개, 마커(원본 ms), 인터럽션·경로 변경 처리, 녹음 상태 기계.
- 수용: 상태 기계 단위 테스트(시작·일시정지·재개·인터럽션·정지), 마커 시각이 일시정지를 뺀 원본 ms, 파일 쓰기는 프로토콜 뒤에 두고 가짜로 테스트.

### P6-A5 LecternUI
- 의존: P6-A2 · 소유: `apps/apple/`, `packages/design-tokens/` · basic · apple
- 만들 것: `packages/design-tokens`에서 `Tokens.swift`를 생성하는 빌드 스크립트, 문서 블록 렌더러(paragraph·list·quote·term·formula·callout·gap), 출처 칩, 전사 목록과 현재 구간 강조, 오디오 플레이어 뷰모델.
- 수용: 블록마다 SwiftUI 미리보기, 뷰모델 단위 테스트(현재 구간 이진 탐색), Dynamic Type, VoiceOver 레이블.

### P6-A6 iOS 앱 셸
- 의존: P6-A3, P6-A5 · 소유: `apps/apple/` · basic · apple
- 만들 것: 로그인, 라이브러리(폴더·목록), 녹음 상세(문서·전사·플레이어), 설정(로그아웃, 계정 삭제 링크).
- 수용: 시뮬레이터 빌드, 픽스처 모드(`LECTERN_FIXTURE=1`)로 화면 진입 UI 테스트 1개, VoiceOver 레이블.

### P6-A7 iOS 녹음 표면
- 의존: P6-A4, P6-A6 · 소유: `apps/apple/` · careful · apple
- 만들 것: NATIVE N2: `AudioRecordingIntent`, 녹음 Live Activity·Dynamic Island(경과 시간, 일시정지, 마커), `ControlWidget`, 백그라운드 오디오 모드, 정지 뒤 업로드 큐로.
- 수용: 시뮬레이터 빌드, 인텐트·활동 상태의 단위 테스트, 기기 확인 항목을 `MANUAL_CHECKS.md`에(잠금 화면 3시간 녹음 등, D-P6-9).

### P6-A8 iOS 공유 확장
- 의존: P6-A6 · 소유: `apps/apple/` · basic · apple
- 만들 것: 오디오·PDF를 받아 App Group 대기열에 넣는 공유 확장. 오디오+PDF 짝짓기 규칙은 웹 `lib/pairing.ts`와 같은 규칙을 Swift로 옮긴다. 미디어 메타데이터에서 `recorded_at`.
- 수용: 짝짓기 표 테스트(웹 테스트의 18개 경우와 같은 기대값), 시뮬레이터 빌드.

### P6-A9 macOS 앱
- 의존: P6-A4, P6-A5 · 소유: `apps/apple/` · careful · apple
- 만들 것: NATIVE N3의 앞부분: `MenuBarExtra` HUD, 메인 창(`NavigationSplitView`), 마이크 녹음, 전역 단축키, `SMAppService` 로그인 시 실행, 알림. 번들 id는 D-P6-8.
- 수용: macOS 빌드, 뷰모델 단위 테스트, 기기 확인 항목을 `MANUAL_CHECKS.md`에.

### P6-A10 macOS 시스템 오디오와 회의 감지
- 의존: P6-A9 · 소유: `apps/apple/` · careful · apple
- 만들 것: Core Audio 프로세스 탭(`CATapDescription`)으로 시스템 오디오 + 마이크 2채널 녹음, 회의 앱 실행 감지(`NSWorkspace`)와 "녹음할까요?" 알림. 캘린더 읽기는 넣지 않는다.
- 수용: macOS 빌드, 채널 믹서의 단위 테스트(가짜 버퍼), 권한 문구(Info.plist), 기기 확인 항목.

### P6-A11 시스템 표면
- 의존: P6-A7, P6-02, P6-03 · 소유: `apps/apple/` · careful · apple
- 만들 것: NATIVE N4: 푸시 등록(`upsertPushDevice`), 처리 진행 Live Activity(원격 업데이트, push-to-start), 문서 준비 알림, App Intents·Spotlight(`IndexedEntity`), 위젯(최근 문서, 처리 중), 유니버설 링크와 Handoff, EventKit 일정 추가(쓰기 전용).
- 수용: 빌드, 페이로드 디코딩 단위 테스트(P6-02의 스냅샷과 같은 JSON), 기기 확인 항목.

### P6-A12 배포: Sparkle과 공증 스크립트
- 의존: P6-A9 · 소유: `apps/apple/`, `docs/runbooks/` · careful · apple · **사용자 필요(Apple Developer ID)**
- 만들 것: Sparkle 2 통합(EdDSA 공개 키는 설정으로), 공증·스테이플 스크립트, 런북(apple-developer-notarization) 갱신.
- 수용: 서명 없이 빌드는 통과, 스크립트는 자격 증명이 없으면 안내와 함께 종료.

### P6-CI CI: Apple 빌드 작업
- 의존: P6-A1 · 소유: `.github/` · careful · quick
- 만들 것: `ci-cd.yml`에 `apple` 작업(macOS 러너, `apps/apple/scripts/gate.sh`). `deploy-server`의 `needs`에는 넣지 않는다.
- 수용: 워크플로 문법 검사(`actionlint`가 있으면), 기존 작업 변경 없음. 실제 실행은 PR에서 확인(STATUS "실측 필요").

### P6-D1 Android: v2 파트 업로드
- 의존: P1-12 · 소유: `apps/android/` · careful · android
- 만들 것: §6.3. `LecternApi`에 v2 업로드, `UploadWorker`가 파트 단위로 재개, v1 경로는 설정으로 남김.
- 수용: `./gradlew testDebugUnitTest assembleDebug`, 로컬 가짜 서버(기존 테스트처럼 `ServerSocket`. 새 의존성을 넣지 않는다)로 3파트 업로드와 재개 테스트. 세션이 만료·취소됐으면 키에 세대 번호를 붙여 새 세션을 만든다(CONTRACTS S-21).

### P6-W1 Windows: v2 파트 업로드
- 의존: P1-12 · 소유: `apps/windows/` · careful · windows · **사용자 필요(Windows 빌드 환경)**
- 만들 것: §6.3. `Program.cs`의 업로드를 v2 파트 방식으로.
- 수용: Windows CI 작업에서 빌드. 로컬(macOS)에서는 빌드할 수 없다.

---

## P7 — 하드닝 · 인계

계약: [CONTRACTS §7](CONTRACTS.md#7-p7--하드닝).

### P7-01 부하 시험 스크립트
- 의존: P1-12, P1-16(가짜 AI로 처리까지 도는 e2e 서버를 쓴다) · 소유: `scripts/load/`, `docs/runbooks/` · basic · unit
- 만들 것: D-P7-1. `scripts/load/uploads.ts`(동시 N건), `long-recording.ts`(3시간), `disk-full.ts`. 결과는 JSON 요약(처리 시간, 실패, 최대 메모리). 런북에 Pi에서 돌리는 법.
- 수용: 로컬에서 N=3, 10분 길이로 끝까지 돌고 요약이 나옴, 실제 데이터 디렉터리를 쓰려 하면 거절. `disk-full.ts`는 관찰만 한다(서버에 디스크 부족 거절 규칙이 없다. CONTRACTS S-25).

### P7-02 복원·장애 리허설
- 의존: P1-12, P1-16(가짜 Gemini 응답 모양을 가져온다) · 소유: `scripts/rehearse/`, `docs/runbooks/`, `apps/server/test/` · basic · full
- 만들 것: D-P7-3. 백업 → 사본 복원 → 건수·체크섬 비교 스크립트, 공급자 장애(연속 5xx, 타임아웃, 429) 주입 테스트가 "영원히 처리 중" 없이 끝나는지.
- 수용: 스크립트가 사본에서만 돎(원본 경로를 주면 거절), 테스트 통과, backup-restore·incident-response 런북 갱신. "전환"은 다른 공급자로 바꾸는 것이 아니라 "장애 때 작업이 끝나고 다시 시도할 수 있다"로 읽는다(CONTRACTS S-26).

### P7-03 성능 예산
- 의존: P3-10, P2-09 · 소유: `apps/web/`, `scripts/bench/`, `.github/` · careful · full
- 만들 것: D-P7-2. 웹 초기 JS gzip 크기 검사, 전사 스크롤 e2e 측정, 검색 p95 검사를 CI `web` 작업에.
- 수용: 수치와 근거(첫 측정값 × 1.2)를 `apps/web/README.md`에, 예산 초과 시 실패. 기계마다 다른 시간 수치(프레임, 검색 p95)는 CI에서 보정된 뒤에만 실패 조건이 된다(CONTRACTS S-27).

### P7-04 접근성 점검
- 의존: P5-13, P2-03(가입 화면), P2-05(공유 UI) · 소유: `apps/web/`, `docs/v2/pipeline/A11Y-AUDIT.md` · basic · full
- 만들 것: 키보드만으로 가입 → 업로드 → 문서 → 공유 → 설정 → 관리자까지 가는 e2e, VoiceOver 수동 점검표(화면별 확인 항목).
- 수용: e2e 통과, 점검표의 수동 항목은 STATUS "실측 필요"에.

### P7-05 인계 문서 맞추기
- 의존: P7-01, P7-02 · 소유: `AGENTS.md`, `docs/`, `README.md` · basic · quick · **마지막**(`pipeline.json`의 `last`. 다른 작업이 모두 합쳐졌거나 막힌 뒤에만 시작한다)
- 만들 것: D-P7-4. `AGENTS.md` 저장소 지도, `docs/v2/README.md`, ROADMAP의 단계 상태, `docs/runbooks/handover-checklist.md`, `docs/v2/pipeline/STATUS.md` 최종본.
- 수용: 문서의 명령을 실행해 확인한 기록(운영 호스트 명령은 저장소와 대조만, 비용·외부 영향이 있는 명령은 실행하지 않고 그 수를 적는다. CONTRACTS S-28), 깨진 링크 0개.
