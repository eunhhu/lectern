# apps/web — Lectern 웹 앱 (P2 셸)

v2 웹 앱이다([ARCHITECTURE §7](../../docs/v2/ARCHITECTURE.md#7-웹-앱-appsweb), [ROADMAP P2](../../docs/v2/ROADMAP.md#p2--데이터-모델-v2--웹-셸)). 백엔드 API v2가 아직 없으므로 **합성 픽스처 데이터로 동작하는 화면 셸**이다. 데이터 계층은 `@lectern/domain`의 `/api/v2` DTO로 타입을 정한 `ApiClient` 인터페이스 하나로 모여 있어서, 실제 API가 생기면 모듈 하나(`src/api/index.ts`)만 바꾸면 된다.

스택(결정 D2): React 19, TypeScript strict, React Aria Components, TanStack Router·Query·Virtual, CSS Modules와 `@lectern/design-tokens` CSS 변수, Bun 번들러. 의존성은 정확한 버전으로 고정했고 모두 나온 지 2주 넘은 버전이다(lockfile은 `bun install --minimum-release-age=1209600`으로 만들었다).

## 실행

```bash
bun run web:dev
```

- `http://127.0.0.1:4173/app/`에서 열린다(포트는 `bun run web:dev -- --port 5000`처럼 바꾼다). `src/`가 바뀌면 다시 빌드하고, 새로 고침하면 반영된다. 라이브 리로드 스크립트는 CSP 때문에 넣지 않았다.
- 미리보기 서버(`scripts/serve.ts`)는 API 서버를 띄우지 않는다. DB, 업로드 디렉터리, `HOME`의 파일을 읽지 않으며 데이터는 브라우저 메모리의 픽스처뿐이다. 새로 고침하면 처음 상태로 돌아간다.
- HTML 응답에는 운영보다 **엄격한** CSP(`script-src 'self'; style-src 'self'`, 외부 오리진 없음)를 붙인다. 여기서 동작하면 운영 정책에서도 동작한다.

| 명령 | 하는 일 |
|---|---|
| `bun run web:build` | `apps/web/dist`에 운영 빌드(해시된 `/app/assets/*`와 `index.html`) |
| `bun run web:dev` | 개발 빌드 + 감시 + 미리보기 서버 |
| `bun run web:e2e` | 운영 빌드 후 Playwright + axe |
| `bun test apps/web` | 순수 로직·픽스처 단위 테스트(루트 `bun test`에도 포함) |

처음 e2e를 돌리기 전에 브라우저를 받는다: `bunx playwright install chromium` (`apps/web`에서).

## 운영 서버에서 보기

`apps/server/src/http.ts`가 `LECTERN_WEB_SHELL=1`일 때만 `/app`, `/app/*`를 서빙한다(기본 꺼짐, `docs/env.md`).

- 확장자가 있는 경로는 `dist`의 파일이거나 404다. 없는 스크립트가 `index.html`로 돌아오지 않는다. 그 밖의 경로는 클라이언트 라우트라 `index.html`을 준다(SPA).
- `/app/assets/*`(해시된 파일)는 1년 캐시, `index.html`은 매번 재검증한다. `..`·점 파일·심볼릭 링크로 `dist` 밖을 읽을 수 없다.
- **운영 체크아웃에는 `dist`가 없다.** 배포는 빌드 단계 없는 git checkout이고 `dist/`는 `.gitignore` 대상이다. 지금 운영에서 플래그를 켜면 `/app`은 `503`과 "`bun run web:build`를 실행하세요"를 돌려준다. 켜기 전에 CD에 빌드 단계를 넣어야 한다(아래 "다음 단계").
- 기존 `/` 화면(`ui.ts`)과 배포 사전 점검(`preflight.ts`)은 바뀌지 않았다.

## 구조

```
scripts/   build.ts (Bun.build) · html.ts (index.html) · serve.ts (미리보기) · dev.ts
src/
  api/       client.ts (ApiClient 인터페이스) · index.ts (구현 선택: 여기만 바꾼다)
             queries.ts (TanStack Query 훅, 이벤트 → 캐시) · types.ts (domain 타입, 아래 요청 #1)
             fixture/client.ts (픽스처 구현)
  fixtures/  합성 데이터 생성기: scripts.ts (대본) · transcript-gen.ts · documents.ts · index.ts
  lib/       순수 로직: pairing.ts · segments.ts · hangul.ts · format.ts · josa.ts · keyboard.ts · media-clock.ts
  app/       셸: 라우터, 사이드바, 워크스페이스, ⌘K 팔레트, 단축키, 업로드 대화상자
  routes/    inbox · library · recording · placeholders (복습·일정·설정)
  ui/        React Aria 위에 토큰으로 칠한 공용 컨트롤, 아이콘, 토스트
test/      bun test (*.test.ts)
e2e/       Playwright (*.e2e.ts: bun test가 집어 가지 않도록 .spec이 아니다)
```

## 화면

- **앱 틀**: 사이드바(홈, 라이브러리, 복습, 일정, 설정), 워크스페이스 전환(개인 / 제품팀), 본문 바로가기, 좁은 화면의 서랍 메뉴, 토스트, live region.
- **홈(수신함)**: 처리 중인 녹음(이벤트로 갱신되는 단계·진행률), 확인할 일정 제안(추가·무시), 확인 필요(실패·일부 완료), 최근 문서.
- **라이브러리**: 폴더 트리(React Aria `Tree`), 스마트 보기, 태그, 제목 찾기, 다중 선택(`GridList`, Space·Shift·⌘A·Esc)과 일괄 이동·태그·삭제. 행을 폴더로 끌어다 놓으면 옮겨지고, 같은 일을 "폴더로 이동…"(일괄 막대, 행 메뉴, 녹음 상세)으로 키보드만으로 할 수 있다. 되돌릴 수 있는 작업은 토스트의 "실행 취소", 삭제는 개수를 입력해야 켜지는 확인. 팀 워크스페이스에서 남이 올린 녹음을 지우면 403이 나고 "N개 완료, M개 실패" 후 실패한 것만 선택으로 남는다.
- **녹음 상세**: 전사 ⇄ 문서 ⇄ 자료(PDF·질문·일정/할 일) 3열, 1280px 아래에서는 탭, 하단 고정 플레이어.
  - 전사는 TanStack Virtual로 가상 스크롤한다(픽스처 강의 3,082구간). `requestAnimationFrame`마다 `clock.currentTime`을 읽어 정렬된 구간을 이진 탐색하고 `aria-current="true"`를 단다. 휠·터치·스크롤바·목록 안 키 이동은 "사용자가 읽는 중"으로 보고 따라가기를 멈추며 "현재 위치로"를 띄운다. 우리가 하는 스크롤은 이 신호가 아니므로 스스로 꺼지지 않는다.
  - 구간 클릭·Enter로 그 시점으로 이동, ↑/↓·Home/End·PageUp/PageDown으로 구간 사이 이동(목록 전체가 탭 정지 하나).
  - 출처 칩: 누르면 재생 위치 이동 + 해당 구간 1.5초 강조 + 그리로 스크롤, 마우스를 올리거나 포커스하면 인용 미리보기(`PreviewTrigger`). PDF 칩(p.4)은 자료 탭에서 그 쪽을 가리킨다. 출처가 없는 블록은 "출처 확인 필요".
  - 플레이어: 재생, 10초 이동, 진행 막대(`aria-valuetext` "12분 30초 / 3시간 10분 1초"), 속도. 본문에서 Space 재생/일시정지, ←/→ 5초, Shift 30초, [/] 속도. 픽스처에는 소리가 없어 "소리 없는 미리보기" 시계(`SimulatedClock`)로 돈다.
  - 처리 중·대기·올리는 중·실패·일부 완료 상태 화면.
- **업로드 대화상자**: 오디오와 PDF를 한꺼번에 끌어다 놓거나 "파일 선택"으로 고르면 `lib/pairing.ts`가 짝을 짓고 이유("이름이 비슷함 · 번호가 같음")를 보여 준다. PDF마다 연결할 녹음을 바꿀 수 있고, "1부/2부"는 한 녹음의 오디오 파트가 되며, 지원하지 않는 파일은 이유와 함께 빠진다. 녹음마다 재개 가능한 업로드 세션(파트 계획 → 파트 PUT → complete)을 돌리고, 픽스처가 약 5초 동안 처리 단계를 흉내 낸 뒤 합성 전사와 문서를 만든다.
- **⌘K / Ctrl+K 팔레트**: 이동, 명령(올리기, 테마, 단축키, 워크스페이스 전환), 녹음, 폴더, 전사·문서 내용 검색, "라이브러리에서 찾기". 공백·대소문자 무시, 초성("ㅇㅇㅊㅈ" → 운영체제), 영문 별칭(theme, dark).
- **단축키**: `G` 다음 `H/L/R/C/S` 이동, `U` 올리기, `?` 단축키 표. 입력 필드 안, 한글 IME 조합 중(`isComposing`, `keyCode 229`), 대화상자가 열렸을 때는 동작하지 않고, 설정이나 단축키 표에서 끌 수 있다(WCAG 2.1.4).
- **복습·일정·설정**: DESIGN §4.1 빈 상태 자리 표시. 설정에는 이 브라우저용 테마와 한 글자 단축키 끄기를 두었다.

## 픽스처

모두 이 저장소를 위해 쓴 합성 데이터다. 실제 녹음·강의·회의·사람이 아니다.

- 워크스페이스 2개(개인, 제품팀), 폴더 9개, 태그 9개, 녹음 16개: 강의(운영체제·자료구조·미시경제학), 세미나, 면담, 통화, 메모, 회의, 사용자 인터뷰. 상태는 완료·처리 중·대기·일부 완료·실패·올리는 중이 모두 있다.
- 전사는 대본(`fixtures/scripts.ts`)을 시드 고정 난수로 조합해 브라우저에서 만든다. 저장소에 큰 JSON을 넣지 않는다. 시각은 원본 오디오 기준 ms이고 쉬는 시간·전사 실패 구간(`gaps`)도 있다.
- 문서 블록의 출처는 domain 계약대로 전사 구간 idx 범위(`SourceRef`)이며 화면이 구간의 원본 오디오 ms로 바꾼다. 대본의 "앵커" 문장을 가리키므로 칩을 누르면 블록이 말하는 내용이 실제로 나오는 구간으로 간다.
- 시각은 `now` 기준 상대값이라 언제 열어도 "최근 7일"이 의미가 있다. 테스트는 고정된 `now`를 쓴다.
- `test/fixtures.test.ts`가 모든 엔티티와 모든 `ApiClient` 응답을 `@lectern/domain` zod 스키마로 검증하고, 스키마가 못 잡는 참조(출처 범위, 폴더 부모·순환, 태그, 화자, 구간 정렬·겹침)도 확인한다.

## 테스트

- `bun test apps/web`: 짝짓기(18개 경우), 구간 탐색(긴 전사 선형 비교 포함), 초성 검색, 한국어 표기·조사, IME 판별, 시뮬레이션 시계, `index.html`에 인라인 스크립트·스타일·외부 오리진 없음, 스타일에 색 리터럴 없음과 모든 `var()`가 토큰인지(DESIGN §2.1 "손으로 쓴 색 금지"를 stylelint 대신 테스트로), 픽스처 검증.
- `bun run web:e2e`(Playwright + `@axe-core/playwright`):
  - axe WCAG 2.0/2.1/2.2 A·AA 태그로 홈, 라이브러리(전체·폴더·스마트 보기), 녹음 상세(완료·일부 완료·처리 중·실패), 복습, 일정, 설정을 라이트·다크에서, 팔레트·단축키 표·업로드 대화상자·삭제 확인·회의 상세까지 위반 0건.
  - 키보드만으로 업로드(파일 선택 → 자동 짝짓기 확인 → 올리기) → 처리 완료 → 홈에서 열기 → 문서 → 출처 칩으로 전사 강조까지.
  - 단축키가 입력·IME 조합·끔 상태에서 꺼지는지, 끌어다 놓기와 키보드 대안 이동, 가상 스크롤 전사의 키보드 이동과 따라가기 해제.
  - 모든 테스트는 CSP 위반이나 잡히지 않은 오류가 하나라도 나면 실패한다.
- CI: `.github/workflows/ci-cd.yml`의 `web` job(Bun 1.4.3, `--frozen-lockfile`). `deploy-server`의 `needs`는 그대로다.

## CSP 메모

- `index.html`은 같은 오리진 파일만 참조한다. 인라인 `<script>`·`<style>`·`style=""`가 없다. React의 `style` prop과 `element.style.setProperty`는 CSSOM이라 허용된다.
- React Aria의 `usePress`는 `touch-action` 규칙을 인라인 `<style id="react-aria-pressable-style">`로 넣으려 한다. 같은 id를 가진 요소가 있으면 건너뛰므로 앱 스타일시트 `<link>`에 그 id를 주고 같은 규칙을 `global.css`에 넣었다(`scripts/html.ts`). React Aria가 id를 바꾸면 e2e의 CSP 검사가 잡는다.
- React Aria의 `usePreventScroll`은 **iOS Safari에서 모달이 열릴 때만** `overscroll-behavior` 인라인 `<style>`을 넣는다. 끌 방법이 없어 `style-src 'self'` 아래에서는 막힌다(배경 스크롤 방지가 약해질 뿐 기능은 그대로). 지금 운영 CSP는 `'unsafe-inline'`을 허용하므로 영향이 없다.

## 지시와 다르게 한 부분과 이유

- **`packages/ui`를 만들지 않았다.** 공용 컨트롤은 `src/ui`에 있다. 지금 소비자가 이 앱 하나뿐이라 패키지 경계와 CSS Modules 교차 번들링 비용만 생긴다. 관리자 콘솔을 React로 옮길 때(P5) 분리한다.
- **Pretendard를 싣지 않았다.** `main`에는 직접 호스팅한 글꼴이 없고(jsDelivr CDN만 있음, 직접 호스팅은 미병합 브랜치 `claude/xenodochial-hamilton-b49ae7`의 `apps/server/assets/pretendard`), CDN은 금지라서 토큰의 시스템 글꼴 대체(`-apple-system`, `Apple SD Gothic Neo` 등)로 보인다. 그 브랜치가 들어오면 `@font-face`로 같은 경로를 가리키면 된다. CDN 링크를 다시 넣지 않는다.
- **진행 막대는 React Aria `Slider`가 아니라 기본 `<input type="range">`다.** DESIGN §3.10이 요구하는 `aria-valuetext`("12분 30초 / 1시간 23분 45초")를 React Aria Slider에서는 지정할 수 없다.
- **출처는 ms가 아니라 domain 계약의 전사 idx 범위로 저장된다.** domain이 동결됐고 `SourceRef`가 idx 범위라서 그대로 따랐다. 화면에서는 구간의 원본 오디오 ms로 바꿔 쓰므로 결과는 지시와 같다.
- **설정 자리 표시에 실제 옵션 두 개(테마, 한 글자 단축키)를 넣었다.** WCAG 2.1.4가 단축키를 끌 방법을 요구한다.
- **녹음 목록은 가상 스크롤하지 않는다.** 목록이 작다. 긴 전사는 가상 스크롤한다.
- **수식은 LaTeX 원문을 코드로 보여 준다.** 렌더러(KaTeX 등)는 의존성·CSP 검토가 필요해 뒤로 미뤘다.
- **PDF는 자리 표시다.** 칩이 가리키는 쪽 번호를 보여 준다. pdf.js 뷰어는 P3.
- **음량 조절이 없다.** 픽스처 시계에는 소리가 없다. 실제 오디오 시계(`createAudioElementClock`)는 준비돼 있다.
- **미리보기 서버가 `apps/server/src/web-shell.ts`를 가져다 쓴다.** 운영과 같은 `/app` 처리를 거치게 하려는 것이다(이 모듈은 `REPO_ROOT`만 읽고 DB나 설정을 건드리지 않는다).

## domain 요청

`packages/domain`은 동결되어 다른 흐름이 소유하므로 고치지 않았다. 필요한 것을 여기 적는다. 1번만 버그이고 나머지는 하위 호환 추가다.

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

## 다음 단계: 실제 API v2 연결

1. `src/api/http.ts`에 `ApiClient`의 HTTP 구현을 만든다. 같은 오리진 `fetch`(쿠키 인증, 토큰 헤더 없음), 응답을 domain zod 스키마로 검증, `{ error: { code, message } }` → `ApiClientError`, 변경 요청에 `Idempotency-Key`, 문서 저장에 `If-Match`. 이벤트는 `EventSource("/api/v2/events")`와 `Last-Event-ID`. 그다음 `src/api/index.ts`에서 구현만 바꾼다.
2. 오디오: `assetContentUrl()`이 `/api/v2/assets/{id}/content`를 돌려주면 녹음 상세가 자동으로 `createAudioElementClock`을 쓴다(서버는 Range 요청 지원 필요).
3. 운영 빌드: CD 배포(`apps/server/src/ops.ts`)에 `bun run web:build` 단계를 넣고, `LECTERN_WEB_SHELL=1`일 때 preflight가 `/app`을 점검하게 한다. 또는 design-tokens처럼 `dist`를 커밋한다(해시 파일 때문에 diff가 시끄러워 권하지 않는다).
4. 인증 게이트: `/api/v2/me`가 401이면 로그인 화면. 지금 셸은 로그인 없이 픽스처 사용자로 열린다.
5. 위 domain 요청 반영, Pretendard 직접 호스팅 병합 후 `@font-face`, pdf.js 뷰어(P3).
6. P2 종료 시 `ui.ts` 앱 화면을 제거하고 `/`를 `/app`으로 보낸다.

참고: 이 변경으로 `bun.lock`에 React, React Aria, TanStack, Playwright가 들어가므로 다음 운영 배포에서 Pi가 `bun install --frozen-lockfile`을 돌린다(`ops.ts`의 `DEPENDENCY_FILES`). `playwright@1.63.0`과 `playwright-core`에는 설치 스크립트가 없어 브라우저를 내려받지 않는다.
