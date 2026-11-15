# AGENTS.md — Lectern 작업 규칙

사람과 AI 에이전트가 이 저장소에서 일할 때 지키는 규칙이다. `CLAUDE.md`는 이 파일을 가리킨다. 규칙이 바뀌면 이 파일을 고친다.

## 가장 중요한 규칙

1. **`main`에 직접 푸시하지 않는다. `main`은 곧 운영이다.** `main`에 들어간 커밋은 CI 통과 즉시 `lectern.qucord.com`(Raspberry Pi)에 배포된다. 모든 변경은 브랜치 → PR → CI 통과 → 머지로 들어간다. 절차와 롤백은 [docs/runbooks/deploy-and-rollback.md](docs/runbooks/deploy-and-rollback.md).
2. 시크릿(API 키, 토큰, 비밀번호)과 개인 정보(실제 이메일 주소, 녹음 내용)를 커밋하지 않는다. 이 저장소는 공개 저장소이고, 이력에 한 번 들어간 값은 유출된 것으로 본다([docs/runbooks/secret-rotation.md](docs/runbooks/secret-rotation.md)).
3. 다른 작업 흐름이 소유한 파일을 고치지 않는다. 경계 파일(`packages/domain`)은 한 흐름만 소유한다([docs/v2/ROADMAP.md](docs/v2/ROADMAP.md#병렬화와-동결-지점)).
4. 운영 경로(`/home/eunhhu/...`)를 코드에 하드코딩하지 않는다. 설정은 `packages/config`의 환경 변수로 받는다.

## 저장소 지도

```
apps/
  server/            Bun HTTP 서버 (운영 진입점: apps/server/src/index.ts, systemd가 직접 실행)
    src/index.ts     레거시 라우터: 인증, 업로드, SSE, 관리자 API, CD 웹훅, /api/health, v1 API(/api/lectures 등)
    src/http.ts      Hono 진입점: request id, 오류 응답, /privacy·/terms, /app 웹 셸. 새 라우트는 여기에 모듈별로 붙인다
    src/api/v2/      /api/v2 리소스별 라우터 (v2 테이블 위의 실제 API, 정책은 access.ts. 상태 표는 README.md)
    src/auth.ts      세션 쿠키·API 토큰 인증 (v1 라우터와 v2가 같이 쓴다). 네이티브 토큰 쌍은 native-auth.ts, PAT는 access-tokens.ts
    src/oauth/ google/ apple/   Google·Apple 로그인(OIDC, Sign in with Apple)과 Google 캘린더 OAuth 토큰
    src/db.ts        bun:sqlite 스키마·쿼리, 오너 부트스트랩
    src/ui.ts        옛 웹 앱·관리자 콘솔 HTML. apps/web이 대신하고, 지우는 작업(P2-10, P5-14)은 사용자 승인 대기
    src/queue.ts     SQLite 영속 작업 큐 (lease, 재개)
    src/job-handlers.ts, events.ts, maintenance.ts, coordination.ts   워커가 쓰는 작업 처리·조정 모듈
    src/process-job.ts, transcript-job.ts, regenerate-job.ts, pdf-ocr-job.ts   v2 처리(전사 → 노트 → 게시), 다시 만들기, PDF OCR 작업
    src/ask/         검색 색인 작업과 물어보기 서비스 (packages/ask 위)
    src/calendar/    ICS 구독, Google 캘린더 동기화, 일정 자동 수락 (리마인더는 reminders.ts·mail.ts)
    src/export/      데이터 내보내기 zip (계정 삭제는 account-deletion.ts)
    src/apns/        APNs 발송기: 처리 Live Activity와 완료 알림 (기기·마커 API는 push-devices.ts·markers.ts)
    src/log.ts       JSON 한 줄 로거 (console.log 대신 logger를 쓴다)
    src/ops.ts       유지보수, 백업, CD 배포 실행기 / src/preflight.ts 배포 사전 점검
    src/storage.ts   업로드 저장, 압축, 휴지통, 보존 정책
    static/legal/    개인정보처리방침·이용약관 (정적 HTML)
    test/            bun test (preload.ts가 샌드박스를 만든다)
  worker/            작업 러너 프로세스 (LECTERN_WORKER_MODE=external일 때 lectern-worker.service로 실행)
  web/               새 웹 앱 /app (React 19 + React Aria + TanStack). 빌드·e2e·픽스처는 apps/web/README.md
  apple/             새 iOS·macOS 앱 (XcodeGen project.yml, Packages/의 LecternKit·RecorderKit·LecternUI·LecternIntents). README.md, MANUAL_CHECKS.md
  android/           Android 앱 (Jetpack Compose. 업로드는 v2 파트 업로드, 목록·상세는 아직 v1 API)
  macos/ windows/ ios/   옛 macOS 메뉴바 앱, Windows 트레이 앱, iOS 단축어 (v1 API)
packages/
  config/            환경 변수 zod 스키마 = 설정의 단일 진실 공급원
  db/                Drizzle 스키마와 SQL 마이그레이션 (packages/db/migrations), v1 강의 → v2 행 이전·동기화 (src/legacy.ts)
  domain/            v2 API 계약(zod 스키마)과 openapi.json (bun run domain:openapi). 경계 파일이다
  harness/           AI 단계 실행기, Gemini 어댑터(전사·LLM·OCR·물어보기), 비용 원장, 평가 CLI (bun run harness)
  media/             오디오 정규화, 말소리 지도, 청크 분할, 여러 파트 잇기 (ffmpeg)
  pdf/               PDF 쪽 글자 추출
  core/              v1 AI 경로 (Gemini 호출, Markdown 렌더링, 오디오 전처리)
  ask/               검색 색인, 하이브리드 검색, 물어보기(RAG) (ADR-0009)
  design-tokens/     디자인 토큰 tokens.json → CSS 변수·Swift (bun run tokens:build)
scripts/
  pipeline/          구현 파이프라인 CLI (bun run pipeline)와 게이트 (gate.sh quick|unit|full)
  load/              부하 시험 (README.md, 런북 load-test.md)
  rehearse/          복원 리허설 (README.md, 런북 backup-restore.md §7)
  bench/             검색 성능 측정 (README.md)
deploy/systemd/      운영 유닛 템플릿(lectern.service, lectern-worker.service)과 EnvironmentFile 예시
docs/
  v2/                v2 설계 문서 (README → ROADMAP → ARCHITECTURE → AI_HARNESS → NATIVE)
  v2/pipeline/       구현 파이프라인: 계약, 작업 목록, WP 명세, 상태표(STATUS.md), 기능 대조표, 접근성 점검표
  adr/               아키텍처 결정 기록 (0000-template.md로 시작)
  runbooks/          배포·롤백, 백업·복원, 시크릿 교체, 장애 대응, 호스트 구성, 부하 시험, 외부 신청(Google·Apple), 인계 점검표
  env.md             환경 변수 레퍼런스 (자동 생성: bun run config:docs)
```

## 개발과 테스트

```bash
bun install
```
```bash
bun run typecheck
```
```bash
bun test
```

- **테스트는 자동으로 샌드박스에서 돈다.** `bunfig.toml`의 `[test] preload`가 [apps/server/test/preload.ts](apps/server/test/preload.ts)를 먼저 실행해 `LECTERN_DATA_DIR`, `LECTERN_LECTURES_DIR`, `HOME`을 임시 디렉터리로 바꾸고 `GEMINI_API_KEY`, `RESEND_API_KEY`, `LECTERN_DEPLOY_TOKEN` 같은 시크릿을 지운다. 그래서 테스트가 운영 DB, 오너 아카이브, `~/local.env`의 키, 실제 메일 발송을 건드리지 않는다.
  - 새 테스트도 이 샌드박스에 기대면 된다. 테스트 안에서 실제 공급자(Gemini, Resend)를 호출하지 않는다. 녹화한 응답(fixture)을 쓴다.
  - 운영 코드에 `test_`나 `bun-test` 같은 테스트 전용 분기를 새로 넣지 않는다.
- 파일 하나만 돌리기: `bun test apps/server/test/ops.test.ts`
- CI(`.github/workflows/ci-cd.yml`)는 Bun `1.4.3`으로 `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`를 돌린다(`core-and-server`). 같은 워크플로에 웹(`web`), Apple(`apple`), Android·Windows·옛 macOS 작업이 있다. 운영도 같은 Bun 버전이다.
- 웹 앱: `bun run web:build`(운영 빌드 `apps/web/dist`), `bun run web:e2e`(운영·픽스처 빌드 후 Playwright + axe. 처음에는 `apps/web`에서 `bunx playwright install chromium`). 자세한 것은 [apps/web/README.md](apps/web/README.md).
- 게이트(파이프라인이 합치기 전에 돌리는 것. 실제 공급자를 부르지 않는다):
  ```bash
  bash scripts/pipeline/gate.sh quick
  ```
  `quick` = 설치(`--frozen-lockfile`) + 타입 검사, `unit` = `quick` + `bun test`, `full` = `unit` + 웹 e2e + 배포 사전 점검 두 번(플래그 끔, [flags-on.env](docs/v2/pipeline/flags-on.env)로 켬).
- 로컬 서버: 데이터·오너 아카이브·`HOME`을 임시 디렉터리로 주고 시크릿을 비운 채 띄운다.
  ```bash
  SANDBOX=$(mktemp -d) && mkdir -p "$SANDBOX"/data "$SANDBOX"/lectures "$SANDBOX"/home && echo "$SANDBOX"
  ```
  ```bash
  LECTERN_DATA_DIR="$SANDBOX/data" LECTERN_LECTURES_DIR="$SANDBOX/lectures" HOME="$SANDBOX/home" GEMINI_API_KEY= RESEND_API_KEY= LECTERN_WORKER_MODE=external LECTERN_BASE_URL=http://localhost:18775 LECTERN_OWNER_EMAIL=dev@example.com LECTERN_OWNER_PASSWORD=<임의 값> bun run dev
  ```
  - **`LECTERN_DATA_DIR`를 주지 않으면 데이터는 `<repo>/data`에 쌓인다**(`.gitignore` 대상). 운영 데이터를 로컬로 가져오지 않는다.
  - `LECTERN_BASE_URL`을 `http://`로 주면 세션 쿠키의 `Secure`가 빠져 Safari·Firefox에서도 로컬 로그인이 된다.
  - 빈 DB에서는 오너 계정이 무작위 비밀번호로 만들어진다. 위처럼 첫 실행에 `LECTERN_OWNER_EMAIL`·`LECTERN_OWNER_PASSWORD`를 주면 바로 로그인된다.
  - `LECTERN_WORKER_MODE=external`이면 이 프로세스가 작업을 돌리지 않아 올린 녹음은 처리 대기로 남는다. AI 처리를 로컬에서 돌리면 실제 비용이 든다(`GEMINI_API_KEY` 또는 `~/local.env`). 가짜 AI로 처리까지 보려면 웹 e2e 서버(`apps/web/e2e/server/start.ts`)나 [부하 스크립트](scripts/load/README.md)를 쓴다.
  - 새 웹 앱(`/app`)은 `bun run web:build` 뒤 `LECTERN_WEB_SHELL=1`을 더하면 서버가 서빙한다. 기능 플래그 목록은 [docs/env.md](docs/env.md).
- Apple 앱: `bash apps/apple/scripts/gate.sh`(Xcode와 `xcodegen`이 있는 Mac에서만. 패키지 테스트와 서명 없는 빌드). 자세한 것은 [apps/apple/README.md](apps/apple/README.md), 기기 점검은 [MANUAL_CHECKS.md](apps/apple/MANUAL_CHECKS.md).
- Android 앱: `cd apps/android && ./gradlew testDebugUnitTest assembleDebug`(JDK 17과 Android SDK가 필요하다. [apps/android/README.md](apps/android/README.md)).
- 부하 시험·복원 리허설·검색 측정 스크립트: [scripts/load](scripts/load/README.md), [scripts/rehearse](scripts/rehearse/README.md), [scripts/bench](scripts/bench/README.md). 모두 샌드박스 서버나 사본으로 돌고 실제 AI를 부르지 않는다.
- 환경 변수를 추가하거나 바꾸면 같은 PR에서 세 곳을 고친다: `packages/config/src/index.ts`, `bun run config:docs`(→ `docs/env.md`), [deploy/systemd/lectern.env.example](deploy/systemd/lectern.env.example).
- DB 스키마를 바꾸면 `packages/db`에서 마이그레이션을 만든다(`bun run --cwd packages/db generate`). 운영 DB에는 부팅 때 자동 적용되고, 적용 직전 `pre-migrate-*.sqlite` 백업이 남으며, CD 사전 점검이 운영 DB 사본에 먼저 적용해 본다. 깨는 변경(컬럼 삭제·이름 변경)은 옛 코드로 롤백할 수 없게 만드므로 두 단계(추가 → 이행 → 나중에 제거)로 나눈다.

## 문서

- 설계: [docs/v2/README.md](docs/v2/README.md)부터 읽는다. 결정 표는 [ROADMAP.md](docs/v2/ROADMAP.md#결정-필요-사항).
- 결정 기록: [docs/adr/](docs/adr/). 큰 결정은 [템플릿](docs/adr/0000-template.md)으로 새 ADR을 쓰고 [docs/v2/README.md](docs/v2/README.md)의 ADR 표에 링크한다. 채택된 ADR은 고치지 않고 새 ADR로 대체한다.
- 운영: [docs/runbooks/](docs/runbooks/). 운영 절차를 바꾸는 PR은 해당 런북도 함께 고친다. 처음 온 사람은 [인계 점검표](docs/runbooks/handover-checklist.md)를 위에서부터 따라 한다.
- 구현 파이프라인: [docs/v2/pipeline/README.md](docs/v2/pipeline/README.md). 무엇이 됐고 무엇이 남았는지는 [상태표](docs/v2/pipeline/STATUS.md)다(WP 단위의 원본은 `bun run pipeline status`).
- 문서는 한국어로 쓴다. 코드 식별자, 테이블·컬럼 이름, 단계 이름은 영어로 쓴다. 코드 주석은 주변 코드처럼 영어로 쓴다.

## 코딩 규칙

### 웹 보안 (CSP, 이스케이프, 인증)

서버는 HTML 응답에 엄격한 CSP를 붙인다(`apps/server/src/index.ts`의 `HTML_CONTENT_SECURITY_POLICY`). 핵심은 `script-src 'self'`이고 `style-src`에서도 `'unsafe-inline'`을 없애는 중이다.

- **인라인 스크립트와 인라인 이벤트 핸들러를 쓰지 않는다.** `<script>…</script>` 본문, `onclick=`·`onload=` 같은 `on*` 속성, `javascript:` URL, `eval`·`new Function`·문자열 `setTimeout`이 모두 금지다.
  - 페이지 스크립트는 `/assets/*.js`로 서빙한다(`ui.ts`의 `PAGE_SCRIPTS`). 새 스크립트를 추가하면 `preflight.ts`가 자동으로 그 경로도 점검한다.
  - 클릭 처리는 `data-action="..."` 속성과 문서 단위 이벤트 위임으로 한다.
- 새 코드에서는 인라인 `<style>` 블록과 `style="…"` 속성도 쓰지 않는다. 스타일은 `/assets`의 CSS 파일이나 클래스로 준다.
- 다른 오리진의 스크립트·폰트·이미지·`fetch` 대상을 추가하지 않는다. 꼭 필요하면 같은 PR에서 CSP를 넓히고 이유를 남긴다.
- **사용자 데이터는 출력할 때 항상 이스케이프한다.**
  - 서버에서 만드는 HTML: `@lectern/core`의 `escapeHtml()`을 쓴다. 이 함수는 `'`를 이스케이프하지 않으므로 **속성값은 항상 큰따옴표로 감싼다.**
  - 브라우저 코드: `textContent`나 DOM API로 넣는다. `innerHTML`에 사용자 값을 넣어야 하면 클라이언트 이스케이프 함수(앱 `escapeClientHtml`, 관리자 콘솔 `esc`. 두 따옴표를 모두 이스케이프한다)를 거친다.
  - 레코드 값은 `onclick` 인자가 아니라 `data-*` 속성으로 넘긴다.
  - 이 규칙들은 `apps/server/test/ui.test.ts`가 검사한다(인라인 스크립트·`on*` 속성 없음, 이스케이프 함수, `localStorage` 토큰 없음). 규칙을 우회하지 말고, 테스트가 실패하면 코드를 고친다. Markdown 렌더러(`renderMarkdownToHtml`)를 바꿀 때는 `packages/core/test`에 악성 입력 테스트를 추가한다.
- **웹 인증은 쿠키 전용이다.**
  - 브라우저 UI는 HttpOnly `lectern_session` 쿠키(`Secure`, `SameSite=Lax`)로만 인증한다. 토큰을 `localStorage`에 두거나 `X-Lectern-Token` 헤더·`?token=` 쿼리를 브라우저 코드에서 보내지 않는다.
  - 헤더 토큰(`X-Lectern-Token`)과 `?token=`은 네이티브 클라이언트와 단축어용이다.
  - 쿠키로 인증하는 변경 요청에 CSRF 방어를 넣는다면 `Origin`/`Sec-Fetch-Site` 기반으로 한다. 커스텀 헤더를 요구하면 웹 UI가 깨진다.
- 로그는 `apps/server/src/log.ts`의 `logger`로 남긴다(JSON 한 줄, `request_id`·`job_id` 같은 필드를 붙인다). 토큰, 키, 쿠키, 요청 본문은 남기지 않는다. URL 쿼리의 자격 증명은 `redactUrlForLog()`로 가린다.
- 업로드는 MIME·확장자 화이트리스트를 지키고, 오디오는 확장자 기준 MIME과 `nosniff`로 서빙한다.

### 일반

- TypeScript strict. `bun run typecheck`가 통과해야 한다.
- 기존 코드의 이름 짓기, 주석 밀도, 관용구를 따른다.
- 사용자에게 보이는 문구는 한국어로 쓴다.
- AI 모델 ID는 버전을 고정한다(`gemini-3.8-flash`처럼). `-latest` 별칭을 쓰지 않는다. 모델·프롬프트·라우팅 변경은 평가를 거친다([ADR-0006](docs/adr/0006-harness-provider-abstraction-eval-routing.md)).
- 커밋 메시지는 `type(scope): 요약` 형식이다(`feat`, `fix`, `docs`, `ci`, `sec` 등). 본문에는 무엇을 왜 바꿨는지 쓴다.

## 운영 데이터와 개인정보

- 녹음, 전사, 문서는 사용자의 개인정보다. 테스트 픽스처와 평가 세트에는 동의받고 익명화한 데이터만 쓰고, 평가용 원본은 저장소 밖에 둔다.
- 데이터를 수집·처리하는 방식이나 외부 처리자(AI 공급자, 메일, 호스팅)가 바뀌면 [개인정보처리방침](apps/server/static/legal/privacy.html)을 같은 PR에서 고친다.
