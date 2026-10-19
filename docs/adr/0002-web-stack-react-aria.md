# ADR-0002: 웹 프런트엔드 스택 — React 19 + React Aria Components + TanStack

- 상태: 채택 (ROADMAP D2)
- 날짜: 2026-10-19
- 관련: [ROADMAP.md D2](../v2/ROADMAP.md#결정-필요-사항), [ARCHITECTURE.md §7](../v2/ARCHITECTURE.md#7-웹-앱-appsweb)

## 맥락 (Context)

현재 웹 UI는 `apps/server/src/ui.ts`(약 6,500줄)의 TypeScript 템플릿 문자열이다. 앱, 공유 페이지, 관리자 콘솔이 모두 여기 있고, 스크립트는 `/assets/*.js`로 분리해 CSP `script-src 'self'`를 지킨다. 이 방식은 타입 검사와 린트가 거의 되지 않고, 컴포넌트 재사용이 어렵고, 사용자 데이터 이스케이프를 손으로 챙겨야 한다.

v2 웹은 상용 수준의 상호작용을 요구한다. 가상 스크롤 전사, 오디오와 동기화된 하이라이트, ⌘K 명령 팔레트, 다중 선택 일괄 작업, 드래그 앤 드롭, 날짜 입력, 그리고 WCAG 2.2 AA다. 한국어 IME 입력도 제대로 돼야 한다.

제약
- 1인 유지보수이고 언젠가 인계해야 한다. 채용 시장과 자료가 많은 기술이 유리하다.
- CSP를 느슨하게 만들지 않는다. 런타임 CSS-in-JS(스타일 주입)와 인라인 스크립트는 쓰지 않는다.
- Bun 하나로 빌드하고 싶다(도구 체인을 늘리지 않는다).

검토한 선택지
| 선택지 | 장점 | 단점 |
|---|---|---|
| 현행 템플릿 문자열 유지 | 이동 비용 없음 | 위 문제 그대로, 규모가 커질수록 악화 |
| React + Radix UI | 자료 많음, 스타일 자유 | a11y 범위가 React Aria보다 얕음(국제화, 날짜·시간 입력, 일부 ARIA 패턴) |
| **React + React Aria Components** | 포커스 관리, 키보드, 스크린리더, 국제화·IME, 날짜 입력까지 동작을 제공하고 스타일은 우리가 정함 | 컴포넌트 API가 장황한 편, 스타일을 직접 다 입혀야 함 |
| Svelte/Solid 계열 | 번들 작음 | 인계·채용 측면에서 불리, a11y 헤드리스 라이브러리 선택지 적음 |

## 결정 (Decision)

`apps/web`은 다음 스택으로 만든다.

- **React 19 + TypeScript**
- **React Aria Components**: 접근성 동작의 기반. 스타일은 `packages/ui`에서 디자인 토큰 CSS 변수와 CSS Modules로 입힌다.
- **TanStack Router**(타입 안전 라우팅), **TanStack Query**(서버 상태), **TanStack Virtual**(긴 전사 가상 스크롤)
- **Bun 번들러**로 빌드한다. 결과물은 `apps/server`가 정적 파일로 서빙한다.
- 스타일은 빌드 시점에 만들어지는 CSS(CSS Modules + `tokens.css`)만 쓴다. 런타임에 `<style>`을 주입하는 라이브러리는 쓰지 않는다.

하지 않는 것
- SSR/RSC는 쓰지 않는다. 같은 오리진에서 정적 SPA로 서빙하고 쿠키 인증을 쓴다.
- 기존 `ui.ts` 화면은 P2 종료 시 제거한다. 그 전까지는 두 UI가 공존한다.

## 결과 (Consequences)

- 좋아지는 것
  - 타입 검사와 린트가 UI 전체에 적용된다. 이스케이프는 JSX 기본 동작이 된다.
  - 키보드 내비게이션, 포커스 가두기, live region 같은 a11y 기본기를 라이브러리가 맡는다.
  - Playwright + axe 자동 검사를 CI에 넣기 쉽다.
- 감수하는 것
  - 번들 크기와 초기 로드가 지금보다 커진다. 성능 예산(P7)으로 관리한다.
  - React Aria 컴포넌트마다 스타일을 직접 입혀야 해서 `packages/ui` 초기 작업량이 크다.
  - CSP를 지키려면 빌드 결과에 인라인 스크립트가 없어야 한다. 번들러 설정과 CI 검사로 확인한다.
- 다시 검토할 신호
  - React Aria가 필요한 패턴을 지원하지 않아 우회 코드가 계속 늘 때
  - Bun 번들러가 필요한 기능(코드 분할, CSS Modules)을 안정적으로 지원하지 못할 때. 이때는 Vite로 바꾸는 것을 검토한다.
