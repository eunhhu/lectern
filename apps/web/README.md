# apps/web — Lectern 웹 앱 (P2 셸)

v2 웹 앱이다([ARCHITECTURE §7](../../docs/v2/ARCHITECTURE.md#7-웹-앱-appsweb), [ROADMAP P2](../../docs/v2/ROADMAP.md#p2--데이터-모델-v2--웹-셸)). 데이터 계층은 `@lectern/domain`의 `/api/v2` DTO로 타입을 정한 `ApiClient` 인터페이스 하나로 모여 있고, 구현이 둘이다.

- **HTTP**(`src/api/http`, 운영 빌드): 실제 `/api/v2`에 같은 오리진으로 붙는다. 로그인은 기존 쿠키 인증(`/api/auth/*`, HttpOnly `lectern_session`)이다.
- **픽스처**(`src/api/fixture`, `web:dev`·단위 테스트·픽스처 e2e): 브라우저 메모리의 합성 데이터.

어느 쪽을 쓸지는 빌드 때 정한다(`scripts/build.ts --api http|fixture`). 아래 "API v2 연결"에 엔드포인트마다의 상태가 있다.

스택(결정 D2): React 19, TypeScript strict, React Aria Components, TanStack Router·Query·Virtual, CSS Modules와 `@lectern/design-tokens` CSS 변수, Bun 번들러. 의존성은 정확한 버전으로 고정했고 모두 나온 지 2주 넘은 버전이다(lockfile은 `bun install --minimum-release-age=1209600`으로 만들었다).

## 실행

```bash
bun run web:dev
```

- `http://127.0.0.1:4173/app/`에서 열린다(포트는 `bun run web:dev -- --port 5000`처럼 바꾼다). `src/`가 바뀌면 다시 빌드하고, 새로 고침하면 반영된다. 라이브 리로드 스크립트는 CSP 때문에 넣지 않았다.
- `web:dev`는 픽스처 빌드다. 미리보기 서버(`scripts/serve.ts`)는 API 서버를 띄우지 않는다. DB, 업로드 디렉터리, `HOME`의 파일을 읽지 않으며 데이터는 브라우저 메모리의 픽스처뿐이다. 새로 고침하면 처음 상태로 돌아간다. 로그인한 상태로 열리고, 로그아웃하면 예시 사용자의 이메일(`preview@example.com`)과 아무 비밀번호로 다시 들어간다.
- 실제 API로 보려면 로컬 서버를 `LECTERN_WEB_SHELL=1`로 띄우고(AGENTS.md "개발과 테스트"의 로컬 서버) `bun run web:build` 뒤 `/app`을 연다. 물어보기는 `LECTERN_ASK=1`과 Gemini 키가 있어야 답한다(실제 비용).
- HTML 응답에는 운영보다 **엄격한** CSP(`script-src 'self'; style-src 'self'`, 외부 오리진 없음)를 붙인다. 여기서 동작하면 운영 정책에서도 동작한다.

| 명령 | 하는 일 |
|---|---|
| `bun run web:build` | `apps/web/dist`에 운영 빌드(HTTP 클라이언트, 해시된 `/app/assets/*`와 `index.html`) |
| `bun run web:dev` | 픽스처 개발 빌드 + 감시 + 미리보기 서버 |
| `bun run web:e2e` | 운영 빌드(`dist`)와 픽스처 빌드(`dist-fixture`) 후 Playwright + axe, 두 프로젝트(아래 "테스트") |
| `bun test apps/web` | 순수 로직·픽스처 단위 테스트(루트 `bun test`에도 포함) |

처음 e2e를 돌리기 전에 브라우저를 받는다: `bunx playwright install chromium` (`apps/web`에서).

## 운영 서버에서 보기

`apps/server/src/http.ts`가 `LECTERN_WEB_SHELL=1`일 때만 `/app`, `/app/*`를 서빙한다(기본 꺼짐, `docs/env.md`).

- 확장자가 있는 경로는 `dist`의 파일이거나 404다. 없는 스크립트가 `index.html`로 돌아오지 않는다. 그 밖의 경로는 클라이언트 라우트라 `index.html`을 준다(SPA).
- `/app/assets/*`(해시된 파일)는 1년 캐시, `index.html`은 매번 재검증한다. `..`·점 파일·심볼릭 링크로 `dist` 밖을 읽을 수 없다.
- 배포 사전 점검이 릴리스마다 `apps/web/dist.next`에 운영 빌드를 만들고 새 서버가 부팅할 때 `dist`로 바꿔 넣는다(`apps/server/src/web-build.ts`, `buildWeb({ outDir })`는 HTTP 클라이언트 빌드다).
- 로그인하지 않은 사람은 `/app/login?next=…`로 간다. 로그인·로그아웃·세션 확인은 기존 `/api/auth/login`·`/api/auth/logout`·`/api/auth/me`이고, 응답 본문의 세션 토큰은 버린다. 회원가입과 비밀번호 찾기는 기존 화면(`/`)으로 안내한다.
- 기존 `/` 사용자 화면(`ui.ts`의 `renderAppHtml`)과 배포 사전 점검(`preflight.ts`)은 바뀌지 않았다. `ui.ts`에서는 관리자 콘솔 CSS(`renderAdminPageHtml`)만 키웠다(아래 "지시와 다르게 한 부분").

## 구조

```
scripts/   build.ts (Bun.build, --api) · html.ts (index.html) · serve.ts (미리보기, --dist) · dev.ts
src/
  zod-csp.ts main.tsx가 가장 먼저 불러온다: zod jitless (아래 "CSP 메모")
  api/       client.ts (ApiClient 인터페이스, ApiClientError) · index.ts (빌드 때 구현 선택) · errors.ts (준비 중·오류 문구)
             http/client.ts (실제 /api/v2) · http/sse.ts (fetch로 읽는 SSE)
             fixture/client.ts · fixture/ask.ts (픽스처 구현과 물어보기 픽스처)
             queries.ts (TanStack Query 훅, 이벤트 → 캐시) · types.ts (domain 타입 z.infer, asId)
  fixtures/  합성 데이터 생성기: scripts.ts (대본) · transcript-gen.ts · documents.ts · index.ts
  lib/       순수 로직: pairing.ts · segments.ts · hangul.ts · format.ts · josa.ts · keyboard.ts · media-clock.ts · calendar.ts
             legacy-markdown.ts (v1 노트 Markdown → 트리) · ask-suggestions.ts
  app/       셸: 라우터, 사이드바와 사용자 메뉴, 워크스페이스, ⌘K 팔레트, 단축키, 업로드 대화상자
  routes/    login · inbox · library · recording · ask (물어보기) · calendar · settings · placeholders (404, 연결 오류)
  ui/        React Aria 위에 토큰으로 칠한 공용 컨트롤, 아이콘, 아바타, 제자리 이름 바꾸기, 토스트
test/      bun test (*.test.ts)
e2e/       Playwright (*.e2e.ts: bun test가 집어 가지 않도록 .spec이 아니다)
  server/  실제 서버 프로젝트: start.ts (샌드박스 서버 + 가짜 Gemini) · accounts.ts · flow.e2e.ts
```

## API v2 연결

`src/api/http/client.ts`가 `ApiClient`를 실제 `/api/v2`로 구현한다.

- **경로와 검증은 domain 라우트 표에서 온다.** 메서드마다 operationId로 `ROUTES_BY_OPERATION`의 `RouteDef`를 찾아 경로를 만들고, 응답을 그 라우트의 응답 스키마로 `safeParse`한다. 계약과 다른 응답은 화면에 반쯤 그리지 않고 `invalid_response` 오류가 된다.
- **오류**: v2의 `{ error: { code, message, details } }`와 v1 인증 라우트의 `{ error: "…" }`를 모두 `ApiClientError(status, code, message, requestId, details)`로 바꾼다. 응답이 없으면 `network`. 501 `not_implemented`는 화면이 "준비 중"으로 보인다(`api/errors.ts`): 쓰기는 정보 토스트, 업로드는 "기존 화면에서 올려 주세요", 물어보기는 준비 중 상자, 오디오는 "오디오 준비 중".
- **쓰기**: JSON 본문은 `Content-Type: application/json`, 모든 쓰기에 `Idempotency-Key`(업로드는 호출하는 쪽이 정한 키). 문서 저장(`createDocumentVersion`)은 시작한 버전을 `If-Match: "<version>"`으로 보낸다(UI는 아직 없다).
- **인증**: 쿠키만 쓴다. 토큰을 읽거나 저장하거나 보내지 않는다(`X-Lectern-Token`·`?token=` 없음). 어느 요청이든 401이면 세션을 비우고 `/login?next=…`로 보낸다.
- **이벤트**: `GET /events`를 `fetch`로 읽는다. 끊기거나 서버가 닫으면 서버의 `retry:`(1~60초로 제한)만큼 기다렸다가 마지막 id를 `Last-Event-ID`로 보내 이어 받고, 이미 받은 id는 다시 넘기지 않는다. 401은 로그인으로, 403·404·501은 조용히 멈춘다. EventSource를 쓰지 않는 이유: 새 연결에 `Last-Event-ID`를 실을 수 없고 실패한 응답의 상태를 알 수 없다.
- **물어보기**: `POST /ask/threads`(범위마다 대화 하나) → `POST /ask/threads/{id}/turns`의 SSE를 `fetch`로 읽는다. 멈추면 `AbortSignal`로 끊고, 서버가 끝까지 만들어 저장한 답은 "끝까지 만든 답 보기"로 대화에서 다시 읽는다.
- **오디오**: `/assets/{id}/content`를 `<audio>`에 주면 브라우저가 Range 요청으로 받는다.

엔드포인트 상태(P2 백엔드 병합 뒤, 서버는 `apps/server/src/api/v2/README.md`):

| 화면이 쓰는 API | 서버 | 화면 |
|---|---|---|
| `/api/auth/login`·`logout`·`me` (v1) | 실제 | 로그인, 로그아웃, 세션 확인 |
| `GET /me`, `/workspaces`, `/workspaces/{id}/members`, `/me/devices` | 실제(v1 사용자, 개인 워크스페이스 `wsp_<user id>`, 로그인 세션) | 로그인한 계정 그대로 |
| `GET /folders`, `/tags`, `/recordings`(+ `progress`·`audio_bytes`), `/recordings/{id}`(+ `progress`·`failure`)·`/transcript`·`/events`·`/action-items`, `/documents/{id}`, `/action-items`, `/calendar/suggestions`(`statuses`), `/search` | 실제(v1 강의의 투영) | 실제 녹음. 이전 강의는 legacy-markdown 문서와 빈 전사 |
| 쓰기: `PATCH /me`, 폴더·태그 CRUD, `PATCH`·`DELETE /recordings/{id}`, `POST /recordings/batch`, 할 일·일정 제안, `DELETE /me/devices/{id}` | 실제 | 동작 |
| 업로드 `POST /uploads` → `PUT /parts/{n}` → `complete` | 실제(개인 워크스페이스, 새 녹음은 오디오 1개) | 동작. 제한에 걸리면 서버 문구를 녹음마다 보인다 |
| `GET /assets/{id}/content` | 실제(Range) | 재생, 전사 동기화 |
| `GET /events` | 실제(연결 유지, `Last-Event-ID`로 재생, 없으면 지금부터) | 진행률·상태 갱신 |
| `/ask/*` | 실제(`LECTERN_ASK=1`), 꺼지면 501 | 동작. 501이면 준비 중 |
| `POST /documents/{id}/versions` | 실제(`If-Match`, legacy는 `markdown`) | 클라이언트만 있다. 편집 화면은 아직 없다 |
| 계정: `/me/tokens`, `/me/identities`, `/me/exports`(+ `/{id}/content`), `/me/deletion` | 실제(P5) | 설정의 계정 구역(P5-10). 501이면 그 구역은 준비 중 |
| `GET /auth/google/start`, `/auth/apple/start` | 실제(꺼지면 404, Apple 키가 없으면 501) | "Google로 계속하기"·"Apple로 계속하기". 켜졌는지는 start를 `redirect: "manual"`로 찔러 본다(리다이렉트면 켜짐, 세션 동안 기억). 이 확인도 서버에 `oauth_state` 행을 하나 만든다(10분 뒤 사라짐) |
| 팀: `PATCH`·`DELETE /workspaces/{id}/members/{user}`, `/workspaces/{id}/invites`(목록·만들기·취소), `POST /invites/accept`, `GET /workspaces/{id}/usage` | 실제(P5. 멤버·초대는 `LECTERN_TEAMS=1`, 꺼지면 501) | 설정의 멤버·초대·사용량, `/invite` 수락 화면(P5-11) |
| 작업 취소, 공유 링크 쓰기, 관리자 재시도 | 501 | 화면이 쓰지 않는다(쓰면 준비 중) |

## 화면

- **로그인**(`/login`): 이메일·비밀번호(자동 완성 `username`·`current-password`), 틀리면 서버 문구를 `role="alert"`로, 비밀번호 칸은 비운다. 폼 아래에 서버가 켠 것만 "Google로 계속하기"·"Apple로 계속하기"(가입 화면도 같다). Google·Apple 로그인이 실패해 돌아오면 `?error=`를 문구로 보인다. 로그인 뒤 `next`의 앱 안 경로로 돌아간다(다른 오리진·`//`·`/login`은 홈으로). 세션 확인 자체가 실패하면(서버 다운) 연결 오류 화면과 "다시 시도".
- **앱 틀**: 사이드바(홈, 라이브러리, 물어보기, 일정, 설정), 워크스페이스 전환(개인 / 제품팀), 본문 바로가기, 좁은 화면의 서랍 메뉴, 토스트, live region.
- **사용자 메뉴**: 사이드바 맨 아래 아바타(이니셜, id로 정한 색)·이름·"워크스페이스 · 역할". 누르면 프로필과 계정(설정 #account), 설정, 단축키, 테마 전환, 로그아웃(`POST /api/auth/logout` 뒤 로그인 화면, 쿼리 캐시를 모두 비운다).
- **홈(수신함)**: 서로 독립된 두 열이라 한쪽 카드가 길어도 옆에 구멍이 생기지 않는다. 왼쪽은 처리 중인 녹음(이벤트로 갱신되는 단계·진행률), 확인 필요(실패·일부 완료), 물어보기(질문 칸과 최근 대화 3개), 오른쪽은 확인할 일정 제안(추가·무시)과 다가오는 일정·할 일. 아래에 최근 문서 6개와 "라이브러리 전체 보기".
- **라이브러리**: 왼쪽에 보기(전체·스마트 보기)·폴더·태그, 오른쪽에 목록. 행에는 제목과 메타 한 줄(종류 · 날짜 · 길이 · 폴더 경로)만 두고, 태그는 색 점 2개와 "+N", 상태는 완료가 아닐 때만 보인다. 체크박스와 행 메뉴는 마우스를 올리거나 포커스·선택 중일 때 나타난다.
  - **전체 선택**: 목록 머리의 "모두 선택" 체크박스(일부만 고르면 부분 선택 표시), ⌘A, Esc로 해제. 개수는 live region으로 읽어 준다. 무언가 고르면 같은 막대가 일괄 작업(폴더로 이동·태그·삭제)으로 바뀐다.
  - **폴더 편집**: "+"로 새 폴더(이름 칸이 바로 열림), 행의 … 메뉴·오른쪽 클릭·Shift+F10·메뉴 키로 이름 바꾸기·새 하위 폴더·다른 폴더로 옮기기…·삭제…. F2는 제자리 이름 바꾸기(Enter 저장, Esc 취소, 한글 조합 중 Enter는 무시), Delete·⌘Backspace는 삭제 확인. 폴더를 다른 폴더로 끌어다 놓으면 하위로 들어가고(자기 자신·하위로는 못 감) 토스트에서 실행 취소. 삭제 확인은 안에 있던 녹음과 하위 폴더가 어디로 가는지 말해 준다(상위 폴더로).
  - **태그 편집**: 새 태그, 제자리 이름 바꾸기, 색 7가지(빨강·주황·노랑·초록·파랑·남색·회색, 메뉴의 단일 선택), 삭제 확인(녹음에서 떨어진다는 안내). 태그 대화상자(일괄 막대, 행 메뉴, 녹음 상세 "태그 편집")에서 붙이기·떼기와 "새 태그" 만들기를 한 번에 한다.
  - 행을 폴더로 끌어다 놓으면 옮겨지고, 같은 일을 "폴더로 이동…"(일괄 막대, 행 메뉴, 녹음 상세)으로 키보드만으로 할 수 있다. 되돌릴 수 있는 작업은 토스트의 "실행 취소", 삭제는 개수를 입력해야 켜지는 확인. 팀 워크스페이스에서 남이 올린 녹음을 지우면 403이 나고 "N개 완료, M개 실패" 후 실패한 것만 선택으로 남는다.
- **녹음 상세**: 정리된 문서가 본문이고, 옆 패널 하나에 전사(기본으로 열림), 자료(PDF·일정/할 일), 물어보기 중 하나를 연다. 머리글의 "전사"·"자료"·"물어보기" 토글로 열고, 열린 것을 다시 누르거나 패널의 ×로 닫으면 문서를 넓게 읽는다. 어느 패널을 열어 뒀는지는 이 브라우저에 기억한다. 1280px 아래에서는 문서·전사·자료·물어보기 탭, 하단 고정 플레이어.
  - **읽기 좋은 본문**: 문서와 전사 모두 한 줄 70ch(한글 약 38~40자, "65~75자"를 라틴 문자 폭으로 읽음), 17px/1.7(전사는 16px/1.7), 넉넉한 문단 간격, `word-break: keep-all`.
  - **전사 문단**: 같은 화자의 연속 구간을 한 문단으로 묶는다(간격·4초 넘는 침묵·8구간·360자·75초에서 끊음, `lib/transcript-paragraphs.ts`). 화자 이름은 화자가 바뀔 때만 문단 머리에, 시각은 문단마다 흐리게. 시각이 문단의 버튼이고(Enter로 그 시점 재생) 본문은 선택·복사할 수 있는 글이다. 문장을 누르면 그 구간으로 간다(글자를 끌어 선택한 경우는 제외). 재생 중인 문장은 옅은 배경, 그 문단은 왼쪽에 옅은 선.
  - **읽기 모드 / 원문**: 읽기 모드(기본)는 쉼표나 말줄임표가 붙은 간투사(음, 어, 아, 자 …)를 숨긴다. 의미가 있는 이음말(그래서, 그러니까, 근데)과 대답(네)은 남긴다. 화면 표시만 바꾸고 데이터·idx·시각은 그대로라 출처와 이동이 두 모드에서 같다(`lib/fillers.ts`).
  - 전사는 TanStack Virtual로 가상 스크롤한다(픽스처 강의 3,082구간). `requestAnimationFrame`마다 `clock.currentTime`을 읽어 정렬된 구간을 이진 탐색하고 `aria-current="true"`를 단다. 휠·터치·스크롤바·목록 안 키 이동은 "사용자가 읽는 중"으로 보고 따라가기를 멈추며 "현재 위치로"를 띄운다. 우리가 하는 스크롤은 이 신호가 아니므로 스스로 꺼지지 않는다.
  - 구간 클릭·Enter로 그 시점으로 이동, ↑/↓·Home/End·PageUp/PageDown으로 구간 사이 이동(목록 전체가 탭 정지 하나).
  - 출처 표시: 본문 흐름을 깨지 않게 문서 전체에 걸쳐 각주처럼 번호를 매긴 작은 위첨자(1, 2 …)다. 누르면 전사 패널이 열리고 재생 위치 이동 + 해당 구간 1.5초 강조 + 그리로 스크롤, 마우스를 올리거나 포커스하면 시각·화자·인용 미리보기(`PreviewTrigger`). PDF 표시(p.4)는 자료 패널을 열어 그 쪽을 가리킨다. 출처가 없는 블록은 작은 "출처 확인 필요".
  - 플레이어: 재생, 10초 이동, 진행 막대(`aria-valuetext` "12분 30초 / 3시간 10분 1초"), 속도. 본문에서 Space 재생/일시정지, ←/→ 5초, Shift 30초, [/] 속도. 실제 API에서는 `createAudioClock`이 녹음의 오디오 파트를 원본 오디오 시각 하나로 이어 재생하고(파트마다 원본 `audio`, 없으면 `audio_compact`·`audio_normalized`), 전사 동기화가 그 시계를 따른다. 오디오를 불러오지 못하면 재생 버튼을 끄고 "오디오 준비 중"을 보이며, 출처 이동은 그대로 된다. 픽스처에는 소리가 없어 "소리 없는 미리보기" 시계(`SimulatedClock`)로 돈다.
  - **이전 노트(legacy-markdown)**: v1에서 넘어온 강의는 구조화된 본문 없이 Markdown만 있다. `lib/legacy-markdown.ts`가 v1 렌더러가 그리던 범위(제목, 중첩 목록, 인용, 코드, 표, 구분선, 굵게·기울임, http(s) 링크, 쉬는 시간·녹음 절단 표시)를 트리로 읽고 React 요소로만 그린다(HTML 문자열을 넣지 않는다). `[MM:SS]`·`[H:MM:SS]` 표시는 그 시점으로 플레이어와 전사를 옮기는 버튼이다. 전사가 없는 노트는 전사 패널이 그렇다고 말한다.
  - 처리 중·대기·올리는 중·실패·일부 완료 상태 화면.
- **업로드 대화상자**: 오디오와 PDF를 한꺼번에 끌어다 놓거나 "파일 선택"으로 고르면 `lib/pairing.ts`가 짝을 짓고 이유("이름이 비슷함 · 번호가 같음")를 보여 준다. PDF마다 연결할 녹음을 바꿀 수 있고, "1부/2부"는 한 녹음의 오디오 파트가 되며, 지원하지 않는 파일은 이유와 함께 빠진다. 녹음마다 재개 가능한 업로드 세션(파트 계획 → 파트 PUT → complete)을 돌리고, 픽스처가 약 5초 동안 처리 단계를 흉내 낸 뒤 합성 전사와 문서를 만든다.
- **물어보기 (domain 계약 `packages/domain/src/api/ask.ts`, ADR-0009)**: 노트에서 답을 찾고 근거를 번호로 붙인다. 대화(스레드)는 범위가 고정이라 범위를 바꾸고 물으면 새 대화가 된다. 폴더 범위는 하위 폴더를 포함한다(`include_subfolders: true`).
  - **답과 출처**: 답의 `[c3]` 표지를 출처 번호로 바꾼다. 번호는 답에서 처음 나온 순서(1, 2 …)이고 서버의 조각 번호를 그대로 보이지 않는다. 출처는 세 종류다: 전사 구간(그 구간 강조), 문서 블록(블록의 전사 출처, 없으면 `[MM:SS]` 시각으로 이동; v1 브리지는 모두 이것), PDF 쪽(자료 패널). `support: weak`는 주황 표시와 "근거 약함", `available: false`(지워졌거나 볼 수 없음)는 링크 없이 번호만. `outcome: unsupported`는 답을 접고 "출처를 확인하지 못한 답" 경고 뒤에 "답 보기", `no_answer`는 근거 없음.
  - **이 노트에 물어보기**: 녹음 상세의 옆 패널. 범위 이 노트 / 이 폴더 / 전체, 추천 질문 칩(녹음 종류별 질문과 그 녹음에서 뽑힌 질문), 스트리밍 답(깜빡이는 커서, `aria-busy`, 끝나면 live region으로 "답변을 마쳤습니다. 출처 N개."). 답의 `[n]`은 문서와 같은 작은 번호 표시이고 미리보기에 녹음·시각·화자·인용이 나온다. 이 녹음의 출처를 누르면 전사 패널이 그 구간에서 열리고 강조되며, 전사 머리의 "물어보기로"로 대화에 돌아온다(대화는 녹음 화면에 남아 있다). 다른 녹음의 출처는 그 녹음을 그 시각으로 연다.
  - **물어보기 화면**(`/ask`): 왼쪽에 대화 기록(범위·시각, 고르면 다시 열림, "새 대화"), 범위 선택기 전체 / 폴더(하위 폴더 포함) / 노트, 여러 노트를 인용한 답과 그 아래 번호 붙은 출처 카드(녹음 제목·시각·화자·인용, 누르면 그 녹음의 그 시각), "답 복사"(본문과 출처 목록).
  - **진행**: `retrieval`이 오면 "노트 N개에서 찾음", 도구 라운드(`tool`) 동안 "노트를 더 찾는 중…", 표지는 `citation` 이벤트가 오기 전까지 그리지 않는다. `turn.completed`가 스트리밍한 글과 출처를 통째로 바꾼다.
  - **끝나는 모양**: 완료, 근거 없음("관련 내용을 찾지 못했습니다" + 좁은 범위였으면 "전체 노트에서 다시 묻기"), 실패(서버 `error` 이벤트: 한도 초과 등, "다시 시도"는 새 질문), 연결 끊김("다시 시도"와 "저장된 답 불러오기"), 멈춤("끝까지 만든 답 보기": 서버가 끝까지 만들어 저장한다), 준비 중(501).
  - **입력**: Enter 보내기, Shift+Enter 줄 바꿈, 한글 조합 중 Enter는 보내지 않는다. 답이 나오는 동안 보내기 버튼이 "답 멈추기"가 된다.
  - **추천 질문**은 계약에 엔드포인트가 없어 화면이 만든다(`lib/ask-suggestions.ts`: 녹음 종류, 뽑힌 질문, 최근 녹음).
  - **대화 기록**: 내 스레드만(`GET /ask/threads`), 범위 이름은 폴더·녹음 목록으로 화면이 붙인다. 아직 답을 만드는 중인 턴이 있으면 2초마다 다시 읽는다.
- **⌘K / Ctrl+K 팔레트**: 이동, 명령(올리기, 테마, 단축키, 워크스페이스 전환), 녹음, 폴더, 전사·문서 내용 검색, 물어보기(녹음 화면에서는 "이 노트에 물어보기", 폴더를 보고 있으면 "이 폴더에 물어보기", 언제나 "전체 노트에 물어보기"; 입력이 질문처럼 보이면 맨 위), "라이브러리에서 찾기". 공백·대소문자 무시, 초성("ㅇㅇㅊㅈ" → 운영체제), 영문 별칭(theme, dark).
- **단축키**: `G` 다음 `H/L/A/C/S` 이동, `U` 올리기, `?` 단축키 표(폴더·태그 묶음 포함). 입력 필드 안, 한글 IME 조합 중(`isComposing`, `keyCode 229`), 대화상자가 열렸을 때는 동작하지 않고, 설정이나 단축키 표에서 끌 수 있다(WCAG 2.1.4).
- **일정**: 월/주 탭. 월 보기는 React Aria `Calendar`(화살표로 날짜, PageUp/PageDown으로 달 이동)이고 칸마다 확정 일정(실선), 확인할 제안(점선), 할 일(파란 막대)을 두 줄까지 보여 준다. 오른쪽 레일에 고른 날의 일정(시각, 출처 녹음 링크, `aria-live`), 제안 받은 일정(추가·무시), 남은 할 일(체크하면 완료, 출처로 이동), 캘린더 연결 카드. 날짜는 Asia/Seoul 기준(`lib/calendar.ts`), 주는 일요일부터.
- **설정**: 목차와 섹션. 프로필(이름, 읽기 전용 이메일, 시간대 → `PATCH /me`), 그 아래 계정 구역(P5-10): 기기(이름·마지막 사용, "이 기기", 다른 기기 "로그아웃시키기"), 액세스 토큰(만든 직후 대화상자에서만 원문을 보여 주고 닫으면 잊는다. 예전 API 토큰은 회수 버튼 없이 보인다), 연결된 로그인(Google·Apple 연결과 해제, `?identity=linked|taken` 토스트), 데이터 내보내기(지금 워크스페이스를 zip으로, 만드는 동안 10초마다 다시 읽음), 계정 삭제(`삭제합니다`를 입력해야 켜지는 요청, 7일 안 취소. 서버의 403·409 문구는 대화상자 안에). 이어서 워크스페이스(이름·종류·내 역할·요금제), 멤버(P5-11: 역할 바꾸기·내보내기·나가기. 관리자는 소유자·관리자 줄을 못 건드리고 그 둘을 지정하지 못한다. 소유자가 한 명뿐이면 그 줄의 역할과 나가기가 꺼진다), 초대(소유자·관리자에게만. 이메일과 역할, 대기 중인 초대 취소), 사용량(이번 달 녹음 시간·AI 비용·저장 공간, 한도가 있으면 막대와 "한도에 가까워졌습니다."·"한도를 모두 사용했습니다."), 공유 링크, 연동(Google 캘린더, ICS), 알림, 이 브라우저(테마, 한 글자 단축키 끄기). `/settings#account`처럼 해시로 바로 간다. 픽스처는 `?fixture-session=none`(로그아웃 상태로 시작), `?fixture-oauth=off`, `?fixture-deletion=sole-owner`, `?fixture-role=owner|admin|member|viewer`(팀에서 내 역할)를 읽는다(e2e). 팀 워크스페이스에는 한도가 있고 개인에는 없다.
- **초대 수락**(`/invite?token=…`, P5-11): 로그인하지 않았으면 로그인 화면을 거쳐 돌아온다. 링크를 열기만 해서는 아무것도 수락하지 않고 "초대 수락"을 눌러야 한다(메일·메신저의 링크 미리보기). 수락하면 주소에서 토큰을 지우고 그 워크스페이스로 바꿔 홈으로 간다. 404·409·403·429는 서버 문구를 본문에, 403(다른 이메일)에는 "다른 계정으로 로그인"(로그아웃 뒤 같은 초대 주소로 돌아오는 로그인). 픽스처의 토큰 `wrong-account`·`expired`·`used`는 그 오류를, 다른 값은 "디자인 스터디"에 한 번 참여한다.

## 픽스처

모두 이 저장소를 위해 쓴 합성 데이터다. 실제 녹음·강의·회의·사람이 아니다.

- 워크스페이스 2개(개인, 제품팀), 폴더 10개, 태그 9개, 녹음 17개: 강의(운영체제·자료구조·미시경제학), 세미나, 면담, 통화, 메모, 회의, 사용자 인터뷰. 상태는 완료·처리 중·대기·일부 완료·실패·올리는 중이 모두 있다.
- 질문 25개(domain `Question`: 회상 20개, 회의 쟁점 3개·토론 2개; 복습 화면은 뺐고, 물어보기의 추천 질문과 답의 재료로 쓴다), 일정 12개(제안 4·확정 5·캘린더에 들어감 3, 하루 종일 일정 포함, 여러 주에 걸침), 할 일 11개(마감 있음·없음, 완료 포함). 모두 대본의 앵커 구간을 출처로 가진다.
- 멤버(제품팀 5명), 로그인한 기기 3개.
- v1에서 넘어온 강의 1개(`rec_legacy_sec07`, 정보보호 폴더): `legacy-markdown` 문서와 빈 전사.
- 물어보기 대화 기록 5개(개인 3, 제품팀 2). 실시간 답과 같은 픽스처가 만들었으므로 출처가 실제 구간을 가리킨다.
- **물어보기 픽스처**(`api/fixture/ask.ts`)는 domain 계약 그대로 이벤트를 낸다(`turn.started` → `retrieval` → `citation`/`answer.delta` → `turn.completed`, 표지 `[c1]`, 전사 인용, `support`는 끝날 때). 서버처럼 멈춘 턴도 끝까지 저장한다. 내용을 지어내지 않는다. 답의 문장은 모두 노트(문서 블록, 질문의 답, 일정, 할 일)에서 오고, 그 블록이 이미 가리키는 전사 구간을 출처로 단다. 의도(요약 / 마감·일정 / 할 일 / 결정)를 먼저 보고, 뽑힌 질문과 비슷하면 그 답을, 아니면 글자 2-gram 겹침으로 고르며, 기준(0.5) 아래면 `no_answer`다. 스트리밍은 검색 단계 후 몇 글자씩 보내고(`[c1]`은 쪼개지 않음), `AbortSignal`로 멈추며, `navigator.onLine === false`면 네트워크 오류를 낸다(e2e는 `context.setOffline`).
- 전사는 대본(`fixtures/scripts.ts`)을 시드 고정 난수로 조합해 브라우저에서 만든다. 저장소에 큰 JSON을 넣지 않는다. 시각은 원본 오디오 기준 ms이고 쉬는 시간·전사 실패 구간(`gaps`)도 있다.
- 문서 블록의 출처는 domain 계약대로 전사 구간 idx 범위(`SourceRef`)이며 화면이 구간의 원본 오디오 ms로 바꾼다. 대본의 "앵커" 문장을 가리키므로 칩을 누르면 블록이 말하는 내용이 실제로 나오는 구간으로 간다.
- 시각은 `now` 기준 상대값이라 언제 열어도 "최근 7일"이 의미가 있다. 테스트는 고정된 `now`를 쓴다.
- `test/fixtures.test.ts`가 모든 엔티티와 모든 `ApiClient` 응답을 `@lectern/domain` zod 스키마로 검증하고, 스키마가 못 잡는 참조(출처 범위, 폴더 부모·순환, 태그, 화자, 구간 정렬·겹침)도 확인한다.

## 테스트

- `bun test apps/web`: 짝짓기(18개 경우), 구간 탐색(긴 전사 선형 비교 포함), 초성 검색, 한국어 표기·조사, IME 판별, 시뮬레이션 시계, `index.html`에 인라인 스크립트·스타일·외부 오리진 없음, 스타일에 색 리터럴 없음과 모든 `var()`가 토큰인지(DESIGN §2.1 "손으로 쓴 색 금지"를 stylelint 대신 테스트로), 픽스처 검증, 폴더·태그·프로필·기기·할 일 쓰기(`test/organise.test.ts`: 빈 이름·형제 중복·순환은 domain 오류 코드, 폴더 삭제는 녹음과 하위 폴더를 상위로), 날짜 묶기(Asia/Seoul), 아바타 이니셜, 전사 문단 묶기와 읽기 모드(`test/transcript.test.ts`), 물어보기(`test/ask.test.ts`: domain 스키마로 모든 이벤트·턴·스레드 검증, 이벤트 순서와 델타 합 = 답, 모든 `[cN]`에 앞서 온 `citation`이 있고 출처가 실제로 그 말을 한 구간인지, 범위 밖을 인용하지 않는지(하위 폴더 포함/제외), `no_answer`, 추천 질문마다 출처 있는 답, 멈춘 턴도 저장, 검증 오류 코드), HTTP 클라이언트(`test/http-client.test.ts`: 가짜 fetch로 라우트 표 URL, v2·v1 오류 본문, 쓰기의 `Idempotency-Key`, `If-Match`, 401 알림, 스키마와 다른 응답, 쪼개진 SSE, 모르는 이벤트 무시, `error` 이벤트, `Last-Event-ID` 재연결과 중복 제거, 501에서 멈춤, v1 로그인 응답의 토큰을 버림), 실제 오디오 시계(`test/audio-clock.test.ts`: 파트 이어 붙이기, 경계를 넘는 이동, 다음 파트로 넘어감, 오류 상태), v1 Markdown(`test/legacy-markdown.test.ts`, 악성 입력 포함).
- `bun run web:e2e`(Playwright + `@axe-core/playwright`) 두 프로젝트:
  - **fixture**: 픽스처 빌드(`dist-fixture`)를 운영보다 엄격한 CSP의 미리보기 서버로. 아래 항목 전부.
  - **server**: 운영 빌드(`dist`)를 실제 서버로(`e2e/server/start.ts`). 버리는 DB에 오너 계정과 v1 강의 2개(합성, WAV 오디오)를 넣고 `LECTERN_ASK=1`, `LECTERN_WORKER_MODE=external`로 띄운다. 이전 강의는 전사가 없으므로 한 강의에만 v2 표(`speaker`, `transcript_segment`)에 전사를 시드한다(전사 파이프라인이 쓸 자리). Gemini 호출은 fetch 경계의 가짜가 답하고(결정적 임베딩, 가장 맞는 조각을 `[cN]`으로 인용하는 모델) 다른 외부 요청은 모두 거절한다. apps/server는 고치지 않고 환경 변수만 준다. 확인: 세션 없이 들어오면 로그인 → 틀린 비밀번호 → 원래 가려던 화면, `lectern_session`이 HttpOnly이고 저장소에 토큰 없음, `/me`가 로그인한 계정인지, 라이브러리가 `/api/v2/recordings`와 같은지, 이전 노트(Markdown 문서, `[MM:SS]`로 플레이어 이동, 전사 없음 안내), 전사가 있는 녹음에서 브라우저의 실제 `<audio>`가 `/assets/{id}/content`를 Range 요청으로 받아 재생 위치와 전사의 현재 구간이 움직이는지, 물어보기(실제 SSE, 출처, 기록, 근거 없음, 출처 → 그 녹음의 그 시각), 프로필 저장, 폴더 만들기와 녹음 옮기기, 업로드(파트 → 완료 → 대기 중), 로그아웃 뒤 다시 로그인으로, 자산·물어보기가 501일 때의 준비 중. 화면은 axe 0건이고 스크린숏을 `test-results/screens`에 남긴다(`E2E_SCREENSHOT_DIR`로 바꿈).
  - axe WCAG 2.0/2.1/2.2 A·AA 태그로 홈, 라이브러리(전체·폴더·스마트 보기), 녹음 상세(완료·일부 완료·처리 중·실패, 원문 전사·자료 패널), 일정, 설정을 라이트·다크에서, 팔레트·단축키 표·업로드 대화상자·삭제 확인·회의 상세까지 위반 0건.
  - 키보드만으로 업로드(파일 선택 → 자동 짝짓기 확인 → 올리기) → 처리 완료 → 홈에서 열기 → 문서 → 출처 칩으로 전사 강조까지.
  - 단축키가 입력·IME 조합·끔 상태에서 꺼지는지, 끌어다 놓기와 키보드 대안 이동, 가상 스크롤 전사의 키보드 이동과 따라가기 해제.
  - 폴더(새로 만들기 → 제자리 이름, F2, 메뉴로 하위로 옮기기, Delete로 삭제와 녹음 상위 이동, 폴더 끌어다 놓기), 태그(만들기·이름·색·붙이기·삭제, 대화상자에서 새 태그), 전체 선택(부분 선택·⌘A·해제), 일정(확정 일정, 제안 추가, 키보드 날짜 이동), 사용자 메뉴와 프로필 저장. 이 화면들의 열린 메뉴·이름 칸·확인 대화상자 상태도 axe 0건.
  - 물어보기: 노트 패널(추천 질문 → 스트리밍 답 → 출처로 전사 강조 → "물어보기로"), 근거 없음 → "전체 노트에서 다시 묻기", 물어보기 화면(여러 노트 답, 출처 링크, 기록, 복사), 오프라인 오류 → 다시 시도, 멈춤, ⌘K(전체 노트와 이 노트). 물어보기 빈 화면·대화·답·근거 없음·오류 상태도 axe 0건.
  - 로그인 화면(라이트·다크, 오류), 로그아웃 → 로그인 → 홈, 세션 없이 딥 링크 → 로그인 → 그 화면, 이전 노트(표·제목·`[1:02:40]`로 플레이어 이동)도 fixture 프로젝트에 있다.
  - 지금 e2e 55개(fixture 49, server 6) 통과. 단위 테스트는 `bun test apps/web` 98개.
  - 모든 테스트는 CSP 위반이나 잡히지 않은 오류가 하나라도 나면 실패한다.
- CI: `.github/workflows/ci-cd.yml`의 `web` job(Bun 1.4.3, `--frozen-lockfile`). `deploy-server`의 `needs`는 그대로다.

## CSP 메모

- **zod는 `new Function`을 쓰지 못하게 한다.** zod 4는 객체 스키마를 만들 때 `new Function("")`이 되는지 시험하고(`util.allowsEval`), 되면 파서를 그렇게 컴파일한다. `script-src 'self'` 아래에서는 이 시험이 잡혀도 CSP 위반으로 보고된다. `main.tsx`가 가장 먼저 `src/zod-csp.ts`를 불러 `z.config({ jitless: true })`를 한 뒤에 `@lectern/domain`이 평가된다. 이 순서가 깨지면 e2e의 CSP 검사가 잡는다.

- `index.html`은 같은 오리진 파일만 참조한다. 인라인 `<script>`·`<style>`·`style=""`가 없다. React의 `style` prop과 `element.style.setProperty`는 CSSOM이라 허용된다.
- React Aria의 `usePress`는 `touch-action` 규칙을 인라인 `<style id="react-aria-pressable-style">`로 넣으려 한다. 같은 id를 가진 요소가 있으면 건너뛰므로 앱 스타일시트 `<link>`에 그 id를 주고 같은 규칙을 `global.css`에 넣었다(`scripts/html.ts`). React Aria가 id를 바꾸면 e2e의 CSP 검사가 잡는다.
- React Aria의 `usePreventScroll`은 **iOS Safari에서 모달이 열릴 때만** `overscroll-behavior` 인라인 `<style>`을 넣는다. 끌 방법이 없어 `style-src 'self'` 아래에서는 막힌다(배경 스크롤 방지가 약해질 뿐 기능은 그대로). 지금 운영 CSP는 `'unsafe-inline'`을 허용하므로 영향이 없다.

## 지시와 다르게 한 부분과 이유

- **`packages/ui`를 만들지 않았다.** 공용 컨트롤은 `src/ui`에 있다. 지금 소비자가 이 앱 하나뿐이라 패키지 경계와 CSS Modules 교차 번들링 비용만 생긴다. 관리자 콘솔을 React로 옮길 때(P5) 분리한다.
- **Pretendard는 직접 호스팅한다.** `apps/web/src/styles/fonts/pretendard/`(OFL 라이선스 포함)의 woff2를 빌드(`scripts/build.ts`의 `emitFonts`)가 해시 이름으로 `dist/assets`에 넣고, 그 파일을 가리키는 `@font-face` 스타일시트(`pretendard-<해시>.css`)를 `index.html`에 건다. CDN을 쓰지 않는다. Bun의 CSS 번들러는 CSS `url()`의 글꼴을 `data:`로 넣어 버려서(약 4MB) `global.css`에서 `@import`하지 않는다.
- **진행 막대는 React Aria `Slider`가 아니라 기본 `<input type="range">`다.** DESIGN §3.10이 요구하는 `aria-valuetext`("12분 30초 / 1시간 23분 45초")를 React Aria Slider에서는 지정할 수 없다.
- **출처 칩의 접근 가능한 이름은 "출처 12:30, 김 교수"다.** DESIGN §3.13은 "출처: 12분 30초, 화자 1"을 예로 들지만, 그러면 보이는 글자("12:30")가 이름에 들어가지 않아 음성 입력 사용자가 칩을 부를 수 없다(WCAG 2.5.3 이름 안의 레이블). 화자 이름은 그대로 붙인다.
- **출처는 ms가 아니라 domain 계약의 전사 idx 범위로 저장된다.** domain이 동결됐고 `SourceRef`가 idx 범위라서 그대로 따랐다. 화면에서는 구간의 원본 오디오 ms로 바꿔 쓰므로 결과는 지시와 같다.
- **글자와 컨트롤을 키웠다(DESIGN.md v1.1).** 본문 13→15px, 컨트롤·행 높이·아이콘·사이드바 폭을 한 단계씩 올렸고 `packages/design-tokens/tokens.json` → `bun run tokens:build`로 다시 만들었다. 바뀐 값은 DESIGN.md 부록 C. 대비 테스트는 그대로 통과한다.
- **관리자 콘솔은 `html { zoom: 1.15 }`로 키웠다.** 관리자 콘솔은 토큰을 쓰지 않는 손으로 쓴 CSS라 토큰만으로는 커지지 않는다. 허락받은 범위대로 `apps/server/src/ui.ts`의 관리자 콘솔 CSS만 고쳤다. `zoom` 아래에서 `vh`/`vw`는 커지지 않아 화면 밖으로 넘치므로 셋을 `%`로 바꿨다(`.app` 높이, 좁은 화면 서랍 폭, 팔레트 높이). 사용자 앱 화면(`/`)은 건드리지 않았다.
- **복습을 뺐다.** Lectern은 강의 전용이 아니라 범용 STT 노트 앱이라 회상 카드·정답 평가 같은 학습 시스템이 맞지 않는다는 제품 판단이다(지난 피드백 반영 때 만든 복습 화면 `7de7b7d`을 이번에 제거). 사이드바·라우트(`/review`)·`G R` 단축키·홈 카드·녹음 상세의 "질문" 탭을 지웠다. 질문 데이터는 domain 계약에 남아 있으므로 픽스처에서 지우지 않았다.
- **Google 캘린더 연결은 자리 표시다.** 다른 기기 로그아웃은 `DELETE /me/devices/{id}`로 픽스처에서 실제로 지워진다(실제 서버는 아직 501).
- **일정 월 보기는 React Aria `Calendar` 위에 그렸다.** 날짜 키보드 이동과 스크린 리더 이름을 직접 만들지 않으려고 `@internationalized/date@3.12.4`(React Aria가 이미 쓰는 패키지, 격리 링커라 직접 의존성으로 선언)를 추가했다. 칸 안 일정은 `CalendarCell`의 자식이라 칸 하나가 탭 정지 하나이고, 일정 목록은 레일의 "고른 날" 카드가 읽어 준다.
- **홈의 다가오는 일정과 일정 화면은 `GET /action-items`와 `statuses=accepted,synced` 한 번씩으로 읽는다**(전에는 녹음마다 불렀다).
- **녹음 목록은 가상 스크롤하지 않는다.** 목록이 작다. 긴 전사는 가상 스크롤한다.
- **수식은 LaTeX 원문을 코드로 보여 준다.** 렌더러(KaTeX 등)는 의존성·CSP 검토가 필요해 뒤로 미뤘다.
- **PDF는 자리 표시다.** 칩이 가리키는 쪽 번호를 보여 준다. pdf.js 뷰어는 P3.
- **음량 조절이 없다.** 시스템 음량을 쓴다.
- **⌘K의 물어보기는 팔레트 안에서 답하지 않고 답할 자리로 보낸다.** "이 노트에 물어보기"는 녹음의 물어보기 패널을 열어 바로 묻고, 폴더·전체는 물어보기 화면에서 바로 묻는다. 팔레트는 닫히는 오버레이라 긴 답·출처·대화 기록을 둘 곳이 아니고, 이렇게 하면 답이 기록에 남는다.
- **물어보기 타입은 domain 것이다**(`AskThread`, `AskTurn`, `AskCitation`, `AskStreamEvent`). 앱 전용 `Ask*`는 지웠고 화면을 계약에 맞췄다(출처의 화자·인용 대신 `snippet`, `turn_count`, 범위 이름은 화면이 붙임).
- **이벤트 스트림은 EventSource가 아니라 `fetch`로 읽는다.** 위 "API v2 연결" 참고. 브라우저가 붙이는 `Last-Event-ID` 대신 클라이언트가 직접 보낸다.
- **zod를 jitless로 쓴다**(`src/zod-csp.ts`). 아래 "CSP 메모".
- **읽기 모드의 간투사 판단은 규칙 기반이다.** 쉼표·말줄임표가 붙은 음/어/아/에/흠/엄/자/저기/그만 숨긴다. 데이터를 바꾸지 않으므로 틀려도 원문으로 바로 확인할 수 있다. 서버가 간투사 구간을 표시해 주면(요청 #21) 그걸 쓴다.
- **미리보기 서버가 `apps/server/src/web-shell.ts`를 가져다 쓴다.** 운영과 같은 `/app` 처리를 거치게 하려는 것이다(이 모듈은 `REPO_ROOT`만 읽고 DB나 설정을 건드리지 않는다).

## domain 요청

**상태(이 브랜치)**: #1은 `09a5ab7`에서 고쳐졌고 `Out<S>`를 지웠다. #16–20은 domain 물어보기 계약(`a4c48ea`, ADR-0009 §11)으로 대체됐고 화면을 그 계약에 맞췄다(추천 질문 엔드포인트는 없어서 화면이 만든다). #2–15·#21은 P2 domain 추가(`f3484a7`)로 계약이 생겼고, 화면은 그중 일괄 작업(`POST /recordings/batch`), 워크스페이스 할 일(`GET /action-items`), 일정 `statuses`, 처음 열 때의 진행률(`progress`)과 실패 원인(`failure`), 목록의 오디오 용량(`audio_bytes`)을 쓴다. 쓰지 않는 것은 "`/`를 새 앱으로 바꾸기 전에 남은 일" 8번.

`packages/domain`은 동결되어 다른 흐름이 소유하므로 고치지 않았다. 필요한 것을 여기 적는다. 1번만 버그이고 나머지는 하위 호환 추가이거나(2–10, 14–21) 계약이 비워 둔 의미를 정해 달라는 것이다(11–13).

1. **id 타입이 소비자에게 `unknown`이 된다(버그, 타입만).** `idSchema()`가 제네릭 `brand<B>()`로 만든 스키마가 TS 7에서 `ZodType<unknown, unknown>`으로 추론된다. 그래서 `z.infer`/`z.input` 결과에서 모든 id가 `unknown`이고, `FolderId.nullable()` 같은 nullable id는 `null`까지 사라진다(`unknown | null` = `unknown`). domain 안에서도 같다(`z.infer<typeof Recording>["id"]`가 `unknown`). 리터럴 brand(`TemplateId`, `EventId`)와 enum은 정상이다. 서버가 v2 라우트에서 이 타입을 쓰면 같은 문제를 만난다.
   - 제안: id마다 리터럴로 선언하거나(`z.string().regex(ID_PATTERN).brand<"RecordingId">()`), `idSchema`의 반환 타입을 명시한다. 런타임과 OpenAPI는 그대로라 하위 호환이다.
   - 이 앱은 `src/api/types.ts`의 `Out<S>`(zod 래퍼 구조로 추론하고 무너진 id 자리를 `string`으로)로 우회한다. 고쳐지면 `z.infer`로 바꾸면 된다.
2. **스마트 보기(저장한 필터) 리소스.** 예: `saved_view { id, workspace_id, name, query, sort_key }`와 CRUD. 지금은 클라이언트 상수(`routes/library/folders.ts`).
3. **`ListRecordingsQuery` 확장**: `q`(제목), 폴더 없음(`unfiled=true`), 하위 폴더 포함, 태그 여러 개, `recorded_after`/`recorded_before`, `sort`. 지금은 전부 받아서 클라이언트가 거른다.
4. **녹음 일괄 작업 엔드포인트**(domain README #27): `POST /recordings/batch` `{ ids, action: move | tag | delete, … }`와 항목별 결과. 지금은 녹음마다 PATCH/DELETE를 보낸다.
5. **처리 진행률을 REST로**: `RecordingDetail.active_job`(또는 `Job`)에 현재 `stage`와 `progress`가 없어 `job.progress` SSE 재생에만 기댄다. 처음 열었을 때 진행률을 보이려면 필요하다.
6. **실패 원인**: 실패한 녹음의 마지막 작업과 오류 코드가 `RecordingDetail`에 없다(`active_job`은 대기·실행 중일 때만). `last_job` 또는 `failure { code, message }`.
7. **블록 단위 "직접 수정"**(DESIGN §3.12): `DocumentBlock`에 사용자가 고친 블록 표시(`edited` 또는 `origin`)가 없다. 지금은 문서 단위 `document.user_edited`만 보인다.
8. **`RecordingListItem` 요약 필드**: 오디오 용량 합계(일괄 삭제 확인의 "오디오 1.4 GB", DESIGN §4.5), PDF 수, "출처 확인 필요" 블록 수. 지금 삭제 확인은 길이 합계를 보인다.
9. **`UpdateRecordingRequest.tag_ids`의 의미**: "사용자 태그를 바꾼다"인데 AI가 붙인 태그를 사용자가 떼는 방법이 정해지지 않았다. 픽스처는 목록에 없는 AI 태그도 뗀다.
10. (선택) **전사 구간의 언어**(`lang`): 영어 구간에 `lang="en"`을 달려면 필요하다(WCAG 3.1.2).

폴더·태그 편집, 프로필, 기기, 멤버, 할 일 완료는 계약에 엔드포인트가 있어 그대로 썼다(`ApiClient`에 `createFolder`·`updateFolder`·`deleteFolder`·`createTag`·`updateTag`·`deleteTag`·`updateMe`·`listDevices`·`revokeDevice`·`listMembers`·`updateActionItem` 추가, 픽스처 구현). 계약이 정하지 않은 의미와 빠진 읽기 API는 다음과 같다.

11. **폴더 삭제 시 하위 폴더**: `deleteFolder`는 "recordings move to the parent"만 말한다. 픽스처는 하위 폴더도 상위로 올린다(삭제 확인 대화상자가 그렇게 안내한다). 하위 폴더째 지우는 쪽이라면 확인 문구와 픽스처를 바꿔야 한다.
12. **폴더·태그 이름 중복과 순환의 규칙**: 409가 있지만 무엇이 충돌인지 적혀 있지 않다. 픽스처는 같은 부모 아래 같은 폴더 이름, 워크스페이스 안 같은 태그 이름(대소문자·앞뒤 공백 무시), 자기 자신·하위 폴더로의 이동을 409 `conflict`로 본다.
13. **태그 색 이름 목록**: `Tag.color`는 "디자인 토큰 색 이름"이라는 정규식만 있다. 앱은 `red`·`orange`·`yellow`·`green`·`blue`·`indigo`·`gray` 7가지를 쓴다(`routes/library/organise.ts`). 허용 목록을 enum으로 정하면 서버와 앱이 어긋나지 않는다.
14. **워크스페이스 단위 할 일 목록**: 할 일은 `GET /recordings/{id}/action-items`뿐이다. 일정 화면과 홈의 다가오는 일정은 녹음마다 불러 모은다. `GET /action-items?workspace_id&status&due_before` 같은 목록이 필요하다.
15. **확정 일정과 날짜 범위**: `GET /calendar/suggestions`는 `status` 하나만 받고(기본 `suggested`) 날짜 범위가 없다. 일정 화면은 accepted·synced를 함께, 보이는 달만 원한다. `status`를 여러 개 받거나 `start_after`/`start_before`를 추가해 달라.

물어보기(RAG)의 실제 백엔드는 다른 흐름이 설계한다. 이 UI가 기대하는 계약은 다음과 같다(앱 쪽 모양은 `api/types.ts`의 `Ask*`, 동작은 `api/fixture/ask.ts`와 `test/ask.test.ts`).

16. **`POST /ask` (SSE 응답)**: 요청 `{ workspace_id, thread_id?, question(1–2000자), scope }`. 이벤트 순서는 `retrieval { searched, citations[] }` → `delta { text }`* → `done { thread, question, answer }`, 실패 시 `error { code, message }`(domain 오류 코드). 답 본문은 `[n]`으로 인용하고 모든 `[n]`에 citation이 있어야 한다(지금 UI는 짝 없는 `[n]`을 그리지 않는다). 답 상태는 `complete | no_evidence`; 근거가 없으면 지어내지 말고 `no_evidence`로 그 사실만 말한다. 클라이언트가 연결을 끊으면(멈춤) 저장하지 않거나 `stopped`로 저장할지 정해 달라. 재시도를 위해 `Idempotency-Key`.
17. **인용(citation) 모양**: `{ n, recording_id, recording_title, start_idx, end_idx, start_ms, end_ms, speaker, quote }`. 위치는 domain `SourceRef`의 전사 idx 범위(원본 오디오 ms도 함께)라 문서 출처와 같은 방식으로 이동·강조한다. PDF 쪽(`pdf_page`) 인용도 줄지 정해 달라(UI는 전사 인용만 그린다).
18. **범위(scope)**: `workspace | folder(folder_id, 하위 폴더 포함) | recording(recording_id)`. 처리가 끝난(ready·partial) 녹음만 대상. 팀 워크스페이스에서 볼 수 있는 녹음만 검색되는지(권한), 뷰어도 물어볼 수 있는지.
19. **대화 기록**: `GET /ask/threads?workspace_id`(최근 순, 커서), `GET /ask/threads/{id}`(`thread` + `messages`), 나중에 `DELETE`. thread에 `title`, `scope`, `scope_label`, `message_count`, `updated_at`. 대화는 사용자별인지 워크스페이스 공유인지.
20. **추천 질문**: `GET /ask/suggestions?workspace_id&scope` → 문자열 몇 개. 녹음 하나일 때는 그 녹음에서 뽑힌 질문(`Question`)과 녹음 종류별 질문을 섞는다.
21. (선택) **간투사 표시**: 전사 구간에 간투사 범위(또는 읽기용 텍스트)가 있으면 읽기 모드가 규칙 대신 그걸 쓴다.

## 계약과 어긋나거나 정해지지 않은 것

P2 백엔드를 병합한 뒤 실제 서버로 다시 확인했다.

해결됨: `/me`가 로그인한 계정이다. 물어보기 인용의 녹음 id가 v2 녹음 id와 같아 출처가 그 녹음을 연다. 자산 바이트를 Range로 준다. 이전 강의의 전사는 빈 `segments`다(가정대로).

웹에서 맞춘 것(서버가 바뀌면 지울 수 있다):
1. **v1 브리지 인용**: `snippet`에 `[00:17]`이 그대로 있고, `section_title`이 섹션이 아니라 노트 제목이다. 화면이 둘 다 걸러서 보인다.
2. **`label`이 조각 번호다**(답이 `[c2]` 하나만 인용할 수 있다). 화면이 처음 나온 순서로 번호를 다시 붙인다.
3. **`citation` 이벤트가 그 표지가 든 `answer.delta` 뒤에 온다.** 화면은 짝이 올 때까지 표지를 그리지 않는다. 계약 설명에 순서를 적어 두면 좋다.
4. **이전 노트의 검색 적중**은 Markdown 원문 조각(`# …`, `[MM:SS]`)이다. 팔레트가 표시를 빼고 같은 줄의 `[MM:SS]`로 연다.
5. **검색의 제목 적중**(`kind: recording`)은 팔레트가 녹음 목록으로 이미 보이므로 건너뛴다.

백엔드에서 정할 것(목록만):
6. 추천 질문 엔드포인트가 없다(화면이 만든다).
7. `/api/auth/login`·`/api/auth/me` 본문에 세션 토큰과 `apiToken`이 담긴다(화면은 버리지만 브라우저 응답에서는 빼는 편이 안전하다).
8. 업로드는 개인 워크스페이스, 새 녹음당 오디오 1개뿐이다. 계약(`CreateUploadRequest`)은 여러 파트를 허용하므로 화면의 "1부/2부" 묶음은 서버가 400으로 거절한다(문구는 녹음마다 보인다).
9. 처리 중인 v1 작업의 `progress.stage`는 늘 `legacy_distill`이고 진행률(`progress`)이 대개 없다. 화면은 `message`(v1 단계 문구)를 보인다.
10. 세션 확인이 두 번이다(게이트 `/api/auth/me`, 화면 데이터 `/api/v2/me`). v2 `/me`가 실제가 됐으니 게이트를 `/api/v2/me` 하나로 줄여도 된다(지시대로 기존 인증 엔드포인트를 남겼다).

## `/`를 새 앱으로 바꾸기 전에 남은 일

1. **회원가입·비밀번호 찾기·이메일 인증**: 아직 `/`(ui.ts)에만 있다. 로그인 화면은 기존 화면으로 안내한다.
2. **이전 노트 편집**: 서버는 `POST /documents/{id}/versions`의 `markdown`을 받지만 편집 화면이 없다. v1 화면의 노트 고치기를 대신할 것이 있어야 한다.
3. **공유 링크**(`/s/…`)와 공개 페이지, **관리자 콘솔**: 아직 v1. 공유 링크 쓰기는 501.
4. **v1에만 있는 기능 점검**: 강의 재처리·오디오만 지우기·Markdown 내려받기·API 토큰 재발급 같은 v1 화면 기능을 새 앱의 어디로 옮길지(재처리는 `POST /recordings/{id}/reprocess`, 토큰은 501).
5. **업로드 제한**: 팀 워크스페이스 업로드와 여러 오디오 파트(위 8번). 바꾸기 전에 업로드 대화상자가 미리 안내하도록 맞출지 정한다.
6. **실제 전사**: 지금 처리는 v1 파이프라인이라 새 녹음도 전사 구간이 없다. P1 전사 파이프라인이 v2 표에 쓰기 시작하면 전사 패널이 채워진다(웹은 이미 그 모양을 읽는다).
7. **물어보기 켜기**(운영 `LECTERN_ASK=0`), **CD**: `/`를 바꾸는 배포에서 `LECTERN_WEB_SHELL=1`과 함께.
8. P2 domain 추가 중 아직 쓰지 않는 것: 저장한 보기(`/views`, 지금은 클라이언트 상수), 서버 목록 필터(라이브러리는 폴더 개수 때문에 전부 받아 거른다), 블록 `edited` 표시, 구간 `lang`, `TagColorName`.
9. pdf.js 뷰어(P3).

참고: 이 변경으로 `bun.lock`에 React, React Aria, TanStack, Playwright가 들어가므로 다음 운영 배포에서 Pi가 `bun install --frozen-lockfile`을 돌린다(`ops.ts`의 `DEPENDENCY_FILES`). `playwright@1.63.0`과 `playwright-core`에는 설치 스크립트가 없어 브라우저를 내려받지 않는다.
