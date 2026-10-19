# Lectern 디자인 시스템

> 버전 v1 (P0, 2026-10-19) · 단일 진실 공급원: [`packages/design-tokens/tokens.json`](packages/design-tokens/tokens.json) · 관련: [docs/v2/ARCHITECTURE.md §7–§8](docs/v2/ARCHITECTURE.md#8-디자인-시스템-designmd-p0-산출물)

Lectern은 녹음과 PDF를 구조화된 문서로 바꾸는 도구다. 사용자는 긴 전사와 문서를 오래 읽고, 같은 화면을 매일 연다. 이 문서는 웹(`apps/web`, React 19 + React Aria Components), macOS(SwiftUI), Android(Compose)가 같은 규칙으로 화면을 만들도록 원칙, 토큰, 컴포넌트, 패턴, 접근성, 문구를 정한다.

**읽는 법**
- 표 안의 토큰 값과 대비 수치는 `bun run tokens:build`가 `tokens.json`에서 생성한다(`<!-- tokens:… -->` 사이). 손으로 고치지 않는다. 생성 결과와 다르면 테스트가 실패한다.
- 토큰을 바꿀 때는 `tokens.json`을 고치고 `bun run tokens:build`를 실행한 뒤, `dist/`와 이 문서의 변경을 함께 커밋한다. 대비 기준에 못 미치면 빌드와 `bun test`가 실패한다.
- 코드 식별자, 토큰 이름, CSS 변수는 영어로 쓰고 설명은 한국어로 쓴다.

**목차**
1. [원칙](#1-원칙)
2. [토큰](#2-토큰)
3. [컴포넌트 명세](#3-컴포넌트-명세)
4. [패턴](#4-패턴)
5. [접근성 규칙과 점검표](#5-접근성-규칙과-점검표)
6. [문구 규칙](#6-문구-규칙-한국어-ui)
7. [플랫폼 대응표](#7-플랫폼-대응표-css--swiftui--compose)
8. [참고 원칙](#8-참고-원칙)
- [부록 A. 관리자 콘솔 별칭](#부록-a-관리자-콘솔-별칭)
- [부록 B. 기존 팔레트에서 바뀐 것](#부록-b-기존-팔레트에서-바뀐-것)

---

## 1. 원칙

### 1.1 밀도 있지만 조용하게

한 화면에 많은 정보를 담되, 눈에 띄는 것은 사용자가 지금 판단해야 하는 것뿐이어야 한다.

- **밀도**: UI 본문 13px, 기본 컨트롤 높이 28px, 목록 행 36px. 여백은 4px 그리드에서 고르고, 필요 없는 카드 테두리나 구획을 겹치지 않는다.
- **색은 의미에만 쓴다**: 위계는 중립색 3단계(`text.primary` / `secondary` / `tertiary`)와 굵기로 만든다. 강조색(인디고)은 주요 동작, 선택, 포커스에만 쓰고, 상태색은 상태를 알릴 때만 쓴다. 장식용 그라데이션, 색 배경 카드, 일러스트를 넣지 않는다.
- **조용한 표면**: 흐름 안의 콘텐츠는 평평하다(그림자 없음, 1px 구분선). 그림자는 떠 있는 층(상세 패널, 다이얼로그, 팔레트, 토스트)에만 쓴다.
- **움직임은 짧게**: 전환은 100–240ms이고, 상태를 설명할 때만 움직인다. 반복 애니메이션은 진행 표시(스피너, 실시간 점)에만 쓴다.
- **숫자는 정렬한다**: 수치, 시간, 크기는 `font-variant-numeric: tabular-nums`로 자릿수를 맞추고, 단위는 숫자보다 옅게 쓴다.

### 1.2 키보드 우선

마우스 없이 모든 기능을 쓸 수 있어야 하고, 자주 쓰는 동작은 키보드가 더 빨라야 한다.

- **⌘K(Ctrl+K) 명령 팔레트**가 모든 이동과 명령의 공통 입구다. 화면에 있는 동작은 팔레트에서도 찾을 수 있다.
- 단축키는 화면에 보인다(버튼 툴팁, 팔레트 항목 오른쪽의 키캡, `?` 단축키 시트). 사용자가 외우지 않아도 발견할 수 있어야 한다.
- 이동 단축키는 `G` 다음 글자(`G` `M` = 멤버), 목록 이동은 `↑`/`↓`(또는 `J`/`K`), 열기는 `Enter`, 닫기는 `Esc`로 통일한다.
- 한 글자 단축키는 입력 필드에 포커스가 있을 때나 **한글 IME 조합 중**(`event.isComposing` 또는 `keyCode 229`)에는 동작하지 않는다. 설정에서 끌 수 있어야 한다(WCAG 2.1.4).
- 포커스는 항상 보인다(`:focus-visible`에 2px `border.focus` 링). 다이얼로그는 포커스를 가두고 닫히면 연 자리로 돌려준다.

### 1.3 출처가 보이는 AI

AI가 만든 문장은 사용자가 원문으로 확인할 수 있어야 한다.

- 문서 블록의 모든 사실 문장은 **출처 칩**(전사 구간 타임스탬프, PDF 페이지)을 단다. 칩을 누르면 오디오가 그 시점으로 이동하고 전사 구간이 강조된다.
- 출처를 찾지 못한 문장(검증 단계 실패)은 숨기지 않고 `status.attention` 표시와 함께 "출처 확인 필요"로 남긴다.
- AI 생성물과 사용자 편집을 구분한다. 사용자가 고친 블록은 "직접 수정"으로 표시하고, 다시 생성해도 덮어쓰지 않는다.
- 상세 정보에 모델과 처리 단계(`transcribe`, `verify` 등)를 남겨 결과가 어디서 왔는지 추적할 수 있게 한다.
- AI를 의인화하지 않는다("제가 정리했어요" ✗). 결과물은 단정하지 않고 근거와 함께 보여 준다.

---

## 2. 토큰

### 2.1 구조와 이름

- **두 층**: `palette.*`는 원시 색(중립 스케일과 색상별 단계)이고 출력 파일로 내보내지 않는다. 화면 코드는 의미 토큰 `color.*`만 쓴다. 의미 토큰은 팔레트를 별칭(`{palette.neutral.950}`)으로 참조한다.
- **모드**: `light`(기본)와 `dark`. 의미 토큰의 `$value`가 라이트 값이고, 다크 값은 `$extensions["com.qucord.lectern"].modes.dark`에 있다. 두 모드가 같으면 테마와 무관한 토큰으로 출력된다.
- **이름 → 플랫폼**: 경로를 그대로 쓴다. `color.text.secondary` → CSS `--color-text-secondary`, Swift `LecternTokens.Colors.textSecondary`, Kotlin `LecternColors.textSecondary`. 숫자로 시작하는 이름은 그룹 머리글자를 붙인다(`space.8` → `LecternTokens.Space.s8`).
- **출력**
  | 파일 | 대상 | 테마 처리 |
  |---|---|---|
  | `dist/tokens.css` | 웹 | `:root`(라이트) → `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` → `[data-theme="dark"]`. `[data-theme]`는 하위 트리에도 쓸 수 있다 |
  | `dist/tokens-css.ts` | 서버 렌더링 페이지 | `tokens.css`와 같은 문자열(`tokensCss`) |
  | `dist/Tokens.swift` | macOS 13+ / iOS 16+ | 시스템 외관을 따르는 동적 `Color` |
  | `dist/Tokens.kt` | Android Compose | `LecternLightColors` / `LecternDarkColors` 인스턴스를 `CompositionLocal`로 제공 |
- **손으로 쓴 색 금지**: 화면 코드에 `#hex`, `rgb()`, `hsl()`를 쓰지 않는다. 관리자 콘솔은 테스트(`packages/design-tokens/test/admin-console.test.ts`)가 이를 막고, `apps/web`은 P2에서 stylelint 규칙으로 막는다. 예외는 사용자별 아바타 색(§3.9) 하나이며, 이 식도 테스트로 대비를 검사한다.
- **생성기**: Style Dictionary 대신 작은 자체 생성기(`packages/design-tokens/src`)를 쓴다. 의존성을 추가하지 않고(운영 서버가 `bun install` 없이 git checkout으로 배포된다), DTCG 2025.10 색 객체와 모드 확장, 대비 검사를 한 번의 패스에서 처리하기 위해서다. 생성 파일은 커밋하며, 테스트가 매번 다시 생성해 바이트 단위로 비교한다.

### 2.2 색

**표면 쌓기**. 표면은 아래에서 위로 쌓는다. 같은 층 안의 상태(hover, 선택)는 반투명 층을 덧칠해 표현하므로, 어느 표면 위에서도 같은 토큰을 쓴다.

```
canvas (사이드바·페이지)
 └ panel (주 작업 영역: 목록, 본문)
    └ raised (카드, 상세 패널, 다이얼로그, 팔레트, 토스트)
       ├ + hover     (반투명, 마우스 올림)
       ├ + active    (반투명, 키보드 선택·켜진 칩·빈 트랙)
       └ + selected  (반투명 인디고, 열린 항목·강조 배지)
```

**글자 위계**
- `text.primary`: 제목, 본문, 값.
- `text.secondary`: 레이블, 보조 열, 설명.
- `text.tertiary`: 개수, 힌트, 타임스탬프, 자리표시자. 가장 옅지만 이것도 4.5:1 이상이다. 읽을 필요가 없는 글자라면 아예 지운다.
- 세 단계 모두 canvas·panel·raised와 그 위의 hover·active·selected 층, 버튼 hover 면, 세그먼트 엄지, 상태 옅은 배경 어디에 올려도 4.5:1을 넘는다(§5.2). 표면에 따라 글자 토큰을 바꿀 필요가 없다.
- `text.disabled`: 비활성 컨트롤에만 쓴다. 대비 기준 예외(WCAG 1.4.3)이므로 정보 전달에 쓰지 않는다.

**강조색(인디고)**
- `accent.solid`: 주요 버튼, 켜진 스위치, 진행 막대. 위에 올리는 글자는 `text.on-solid`(흰색, 4.69:1).
- `accent.solid-hover`: 두 테마 모두 한 단계 **어둡게** 간다. 밝게 가면 흰 글자가 4.5:1 아래로 떨어지기 때문이다.
- `accent.fg`: 강조 글자. `border.focus`: 포커스 링과 선택 행 표시줄(다크에서는 더 밝은 인디고라 어두운 면에서도 4:1 이상).

**상태색**은 다섯 가지이고, 각각 역할별 토큰을 갖는다.

| 상태 | 뜻 | 예 |
|---|---|---|
| `success` | 완료, 활성, 정상 | 처리 완료, 활성 멤버 |
| `attention` | 대기, 진행 중, 확인 필요 | 승인 대기, 분석 중, 출처 확인 필요 |
| `severe` | 임계치 근접, 조치 권장 | 사용량 75% 이상, 오래된 백업 |
| `danger` | 오류, 실패, 파괴적 작업 | 분석 실패, 삭제 버튼 |
| `info` | 정보, 관리자 역할 | Admin 배지, 안내 |

| 역할 | 쓰임 | 기준 |
|---|---|---|
| `fg` | 상태 글자, 작은 아이콘 | 모든 표면에서 4.5:1 |
| `ui` | 상태 점, 진행 막대, 큰 아이콘 | 모든 표면에서 3:1 |
| `subtle` | 안내 상자 배경(반투명) | 위 글자는 `text.primary` |
| `border` | 배지·안내 상자 테두리 | 장식용, 기준 없음 |
| `solid` (`danger`만) | 파괴적 버튼 채움 | 흰 글자 4.5:1 |

- 상태는 **색만으로 알리지 않는다**. 점 옆에는 항상 글자(“정지”, “실패”)나 아이콘 모양 차이가 있어야 한다(WCAG 1.4.1).
- 라이트 테마의 상태색은 다크보다 어둡다. 흰 바탕에서 노랑·초록·파랑 점이 3:1을 넘으려면 채도를 유지한 채 명도를 낮춰야 하기 때문이다.

**장식용 토큰**: `border.subtle`, `border.default`, `accent.border`, `status.*.border`는 대비 기준이 없다. 그래서 컴포넌트를 알아보는 유일한 단서로 쓰지 않는다. 외곽선 말고는 알아볼 단서가 없는 컨트롤(체크박스, 라디오, 레이블 없는 입력)에는 `border.control`(3:1 이상)을 쓴다.

### 2.3 타이포그래피

- **글꼴**: 웹은 `Pretendard Variable`(가변 글꼴, 한글·라틴 균형), 네이티브는 시스템 글꼴(macOS SF Pro + Apple SD Gothic Neo, Android Roboto + Noto Sans CJK)을 쓴다. 모노는 `SF Mono` → `JetBrains Mono` → `D2Coding`(한글 고정폭) 순이며 ID, 로그, 코드, 타임스탬프에만 쓴다.
- **크기 단계**: 11 / 12 / 13(기본) / 14 / 15(읽기) / 16 / 20 / 24px. 이 밖의 크기를 새로 만들지 않는다.
- **줄 높이**: UI 1.45, 다이얼로그·설명 1.6, 문서 본문 1.7. 한글 긴 글은 1.6 아래로 내리지 않는다.
- **자간**: Pretendard는 기본 자간이 넓어 UI 글자에 약간 음수를 준다(본문 −0.08px, 제목 −0.15 ~ −0.48px). 문서 본문과 모노는 0이다.
- **한국어 줄바꿈**: 제목, 버튼, 배지, 표 머리글은 `word-break: keep-all`로 어절 단위로 끊는다. 이메일, URL, ID처럼 긴 토큰은 `overflow-wrap: anywhere`로 넘침을 막는다.
- **줄 길이**: 문서 본문은 한 줄에 한글 35–45자(약 `max-width: 40em`)를 넘기지 않는다.
- 굵기는 400(본문), 500(레이블·버튼), 600(제목·값), 700(로고 등 예외)만 쓴다.

### 2.4 간격과 크기

- 모든 간격은 **4px 그리드**(`space.4`의 배수)이다. 2px·6px 반 단계는 컴포넌트 내부(아이콘과 글자 사이, 배지 안쪽)에서만 쓴다.
- 레이아웃 간격: 행 안 요소 사이 8px, 섹션 안쪽 여백 16px, 섹션 사이 24–32px, 페이지 여백 24px(모바일 12–16px).
- 컨트롤 높이: `size.control.sm` 24px(툴바, 칩) / `md` 28px(기본 버튼) / `lg` 32px(입력 필드, 터치 우선 화면).
- 목록 행: `compact` 32px / `default` 36px / `comfortable` 44px(터치). 포인터가 거친 기기(`@media (pointer: coarse)`)에서는 `comfortable`과 `control.lg`로 올린다.
- 아이콘은 16px 격자에 1.4–1.6px 선으로 그린다(`size.icon.sm` 14 / `md` 16 / `lg` 20).

### 2.5 반경

`radius.xs` 4px(배지, 키캡) / `sm` 6px(버튼, 입력, 칩, 목록 항목) / `md` 8px(카드, 패널, 토스트) / `lg` 10px(다이얼로그, 팔레트) / `full`(아바타, 점, 스위치). 바깥 요소의 반경은 안쪽 요소보다 같거나 크게 한다(안쪽 반경 = 바깥 반경 − 안쪽 여백).

### 2.6 그림자(elevation)

| 층 | 토큰 | 쓰임 |
|---|---|---|
| 0 | 없음 | 흐름 안의 모든 콘텐츠(목록, 카드, 본문) |
| 1 | `shadow.sm` | 세그먼트 엄지처럼 살짝 뜬 컨트롤 |
| 2 | `shadow.md` | 메뉴, 팝오버, 툴팁 |
| 3 | `shadow.lg` | 상세 패널, 다이얼로그, 명령 팔레트, 토스트 |

다크 테마에서는 그림자가 잘 보이지 않으므로 `md`·`lg`에 1px 밝은 외곽선 겹(spread 1px)을 함께 둔다. 층이 높을수록 표면도 `raised`로 한 단계 밝아진다.

### 2.7 모션

- 지속 시간: `motion.duration.fast` 100ms(hover, 색, 스위치) / `base` 160ms(패널·서랍 슬라이드, 토스트) / `slow` 240ms(큰 레이아웃 전환, 상한).
- 이징: `motion.easing.standard`(= CSS `ease`) 기본, `enter`(감속)는 나타날 때, `exit`(가속)는 사라질 때 쓴다.
- **`prefers-reduced-motion: reduce`**에서는 전환과 등장 애니메이션을 끈다. 위치 이동은 즉시 바꾸고, 진행 상황을 알리는 스피너만 남긴다. 강조 반짝임(출처 이동 시 구간 강조)은 애니메이션 없이 배경만 바꾼다.

### 2.8 z-index

정해진 층만 쓴다: `z.sticky` 10 → `peek` 40 → `scrim` 45 → `drawer` 50 → `overlay` 60(다이얼로그, 팔레트) → `popover` 70 → `toast` 80 → `tooltip` 85 → `gate` 90. 새 층이 필요하면 토큰을 추가한다. 임의의 `z-index: 9999`를 쓰지 않는다.

### 2.9 토큰 전체 표

<!-- tokens:reference:start -->
#### 색

| CSS 변수 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--color-bg-canvas` | `#fbfbfb` | `#0f1011` | 앱 바탕. 사이드바와 페이지 배경. |
| `--color-bg-panel` | `#ffffff` | `#141516` | 주 작업 영역(목록, 본문)의 배경. |
| `--color-bg-raised` | `#ffffff` | `#1a1b1e` | 패널 위에 뜨는 표면: 카드, 상세 패널, 다이얼로그, 팔레트, 토스트, 보조 버튼. |
| `--color-bg-raised-hover` | `#f4f4f5` | `#222327` | raised 표면 버튼의 hover. |
| `--color-bg-control-selected` | `#ffffff` | `#2a2b30` | 세그먼트·탭 선택 상태의 엄지(thumb). |
| `--color-bg-input` | `#ffffff` | `rgb(255 255 255 / 0.025)` | 입력 필드 배경. |
| `--color-bg-hover` | `rgb(0 0 0 / 0.035)` | `rgb(255 255 255 / 0.04)` | 행·메뉴 항목 hover. 아래 표면 위에 겹쳐 칠한다. |
| `--color-bg-active` | `rgb(0 0 0 / 0.055)` | `rgb(255 255 255 / 0.07)` | 키보드 선택 행, 활성 메뉴, 켜진 칩. 진행 막대·스위치의 빈 트랙. |
| `--color-bg-selected` | `rgb(94 106 210 / 0.12)` | `rgb(94 106 210 / 0.18)` | 열린 항목(상세 패널에 표시 중인 행), 강조 배지, 텍스트 선택 영역. |
| `--color-bg-scrim` | `rgb(15 16 17 / 0.22)` | `rgb(0 0 0 / 0.55)` | 모달·서랍 뒤를 덮는 막. |
| `--color-border-subtle` | `#e8e8ea` | `rgb(255 255 255 / 0.07)` | 행·섹션 구분선. 장식용이며 컴포넌트를 식별하는 유일한 단서로 쓰지 않는다. |
| `--color-border-default` | `#dcdce0` | `rgb(255 255 255 / 0.11)` | 카드, 보조 버튼, 입력 필드, 배지의 외곽선. 장식용. |
| `--color-border-control` | `#81848a` | `#747880` | 외곽선이 유일한 식별 단서인 컨트롤(체크박스, 라디오, 레이블 없는 입력). 3:1 이상. |
| `--color-border-focus` | `#5560c7` | `#7180ea` | 키보드 포커스 링과 선택 행 표시줄. 3:1 이상. |
| `--color-text-primary` | `#1a1b1e` | `#f7f8f8` | 본문, 제목, 값. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-text-secondary` | `#595d64` | `#9ca1aa` | 보조 설명, 레이블, 열 값. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-text-tertiary` | `#666a71` | `#8f949d` | 개수, 힌트, 타임스탬프, 자리표시자. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-text-disabled` | `#9ca1aa` | `#666a71` | 비활성 컨트롤의 글자. WCAG 1.4.3 예외(비활성 UI)라 대비 기준을 두지 않는다. |
| `--color-text-on-solid` | `#ffffff` | `#ffffff` | accent.solid, status.danger.solid 같은 채움색 위의 글자와 아이콘. |
| `--color-accent-solid` | `#5e6ad2` | `#5e6ad2` | 주요 버튼, 켜진 스위치, 진행 막대 채움, 로고. |
| `--color-accent-solid-hover` | `#5560c7` | `#5560c7` | 주요 버튼 hover. 흰 글자 대비를 지키려고 두 테마 모두 한 단계 어둡게 간다. |
| `--color-accent-fg` | `#5560c7` | `#9aa2f5` | 강조 글자(소유자 배지, 강조 수치, 링크성 글자). |
| `--color-accent-border` | `rgb(94 106 210 / 0.45)` | `rgb(94 106 210 / 0.45)` | 강조 배지 테두리. 장식용. |
| `--color-status-success-fg` | `#0b794e` | `#4cb782` | 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-status-success-ui` | `#269865` | `#4cb782` | 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. |
| `--color-status-success-subtle` | `rgb(38 152 101 / 0.08)` | `rgb(76 183 130 / 0.1)` | 상태 안내 상자(callout)의 옅은 배경. |
| `--color-status-success-border` | `rgb(38 152 101 / 0.35)` | `rgb(76 183 130 / 0.35)` | 상태 배지·안내 상자의 테두리. 장식용. |
| `--color-status-attention-fg` | `#886502` | `#f2c94c` | 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-status-attention-ui` | `#a48203` | `#f2c94c` | 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. |
| `--color-status-attention-subtle` | `rgb(164 130 3 / 0.12)` | `rgb(242 201 76 / 0.08)` | 상태 안내 상자(callout)의 옅은 배경. |
| `--color-status-attention-border` | `rgb(164 130 3 / 0.35)` | `rgb(242 201 76 / 0.35)` | 상태 배지·안내 상자의 테두리. 장식용. |
| `--color-status-severe-fg` | `#a65404` | `#f2994a` | 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-status-severe-ui` | `#c67116` | `#f2994a` | 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. |
| `--color-status-severe-subtle` | `rgb(198 113 22 / 0.08)` | `rgb(242 153 74 / 0.1)` | 상태 안내 상자(callout)의 옅은 배경. |
| `--color-status-severe-border` | `rgb(198 113 22 / 0.35)` | `rgb(242 153 74 / 0.35)` | 상태 배지·안내 상자의 테두리. 장식용. |
| `--color-status-danger-fg` | `#c43336` | `#f76260` | 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-status-danger-ui` | `#e75454` | `#e75454` | 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. |
| `--color-status-danger-subtle` | `rgb(231 84 84 / 0.07)` | `rgb(231 84 84 / 0.09)` | 상태 안내 상자(callout)의 옅은 배경. |
| `--color-status-danger-border` | `rgb(231 84 84 / 0.35)` | `rgb(231 84 84 / 0.35)` | 상태 배지·안내 상자의 테두리. 장식용. |
| `--color-status-danger-solid` | `#cf3c3c` | `#cf3c3c` | 파괴적 작업 버튼의 채움색. |
| `--color-status-danger-solid-hover` | `#c43336` | `#c43336` | 파괴적 작업 버튼 hover. |
| `--color-status-info-fg` | `#0f6bc1` | `#4ea7fc` | 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. |
| `--color-status-info-ui` | `#2e8add` | `#4ea7fc` | 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. |
| `--color-status-info-subtle` | `rgb(46 138 221 / 0.08)` | `rgb(78 167 252 / 0.1)` | 상태 안내 상자(callout)의 옅은 배경. |
| `--color-status-info-border` | `rgb(46 138 221 / 0.35)` | `rgb(78 167 252 / 0.35)` | 상태 배지·안내 상자의 테두리. 장식용. |

#### 간격

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--space-0` | 0px |  |
| `--space-2` | 2px |  |
| `--space-4` | 4px |  |
| `--space-6` | 6px |  |
| `--space-8` | 8px |  |
| `--space-12` | 12px |  |
| `--space-16` | 16px |  |
| `--space-20` | 20px |  |
| `--space-24` | 24px |  |
| `--space-32` | 32px |  |
| `--space-40` | 40px |  |
| `--space-48` | 48px |  |
| `--space-64` | 64px |  |

#### 크기

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--size-control-sm` | 24px | 작은 버튼, 칩, 툴바 아이콘 버튼. WCAG 2.5.8 최소 표적 크기. |
| `--size-control-md` | 28px | 기본 버튼, 검색 입력. |
| `--size-control-lg` | 32px | 입력 필드, 터치 우선 화면의 기본 컨트롤. |
| `--size-row-compact` | 32px | 조밀한 목록 행. |
| `--size-row-default` | 36px | 기본 목록 행. |
| `--size-row-comfortable` | 44px | 터치 화면 목록 행(Apple HIG 44pt). |
| `--size-icon-sm` | 14px |  |
| `--size-icon-md` | 16px |  |
| `--size-icon-lg` | 20px |  |
| `--size-peek-width` | 448px | 상세 패널 너비. |
| `--size-sidebar-width` | 232px | 사이드바 너비. |

#### 반경

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--radius-xs` | 4px | 배지, 키캡, 막대. |
| `--radius-sm` | 6px | 버튼, 입력, 칩, 목록 항목. |
| `--radius-md` | 8px | 카드, 패널, 토스트. |
| `--radius-lg` | 10px | 다이얼로그, 명령 팔레트. |
| `--radius-full` | 9999px | 원형(아바타, 상태 점, 스위치). |

#### 글꼴

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--font-family-sans` | Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Segoe UI, Apple SD Gothic Neo, Noto Sans KR, Malgun Gothic, sans-serif | UI와 문서 본문. 웹은 Pretendard Variable, 네이티브는 시스템 글꼴을 쓴다. |
| `--font-family-mono` | SF Mono, ui-monospace, JetBrains Mono, D2Coding, Menlo, Consolas, monospace | ID, 로그, 코드, 타임스탬프. |
| `--font-size-xs` | 11px | 배지, 키캡, 캡션. |
| `--font-size-sm` | 12px | 메타 정보, 보조 열, 레이블. |
| `--font-size-base` | 13px | UI 본문과 컨트롤. |
| `--font-size-md` | 14px | 섹션 제목, 다이얼로그 제목, 팔레트 입력. |
| `--font-size-lg` | 16px | 상세 패널 제목. |
| `--font-size-reading` | 15px | 문서 본문(긴 글 읽기). |
| `--font-size-xl` | 20px | 페이지 제목. |
| `--font-size-xxl` | 24px | 핵심 수치(KPI). |
| `--font-weight-regular` | 400 |  |
| `--font-weight-medium` | 500 |  |
| `--font-weight-semibold` | 600 |  |
| `--font-weight-bold` | 700 |  |
| `--font-line-height-tight` | 1.25 | 큰 수치, 한 줄 제목. |
| `--font-line-height-snug` | 1.35 | 여러 줄 제목. |
| `--font-line-height-base` | 1.45 | UI 본문. |
| `--font-line-height-relaxed` | 1.6 | 설명 문단, 다이얼로그 본문. |
| `--font-line-height-reading` | 1.7 | 문서 본문. 한글 긴 글은 1.6 이상. |

#### 글자 조합

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--typography-caption` | 400 12px/1.45, 자간 -0.07px, Pretendard Variable | 메타 정보, 힌트. |
| `--typography-body` | 400 13px/1.45, 자간 -0.08px, Pretendard Variable | UI 기본 글자. |
| `--typography-label` | 500 12px/1.45, 자간 -0.07px, Pretendard Variable | 필드 레이블, 그룹 머리글. |
| `--typography-title` | 600 14px/1.35, 자간 -0.15px, Pretendard Variable | 섹션·다이얼로그 제목. |
| `--typography-heading` | 600 16px/1.35, 자간 -0.24px, Pretendard Variable | 상세 패널 제목. |
| `--typography-display` | 600 24px/1.25, 자간 -0.48px, Pretendard Variable | 핵심 수치. |
| `--typography-reading` | 400 15px/1.7, 자간 0px, Pretendard Variable | 문서 본문. |
| `--typography-mono` | 400 12px/1.45, 자간 0px, SF Mono | ID, 로그, 타임스탬프. |

#### 그림자(elevation)

| CSS 변수 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--shadow-sm` | 0px 1px 2px 0px rgb(0 0 0 / 0.18) | 0px 1px 2px 0px rgb(0 0 0 / 0.18) | 세그먼트 엄지, 눌리는 표면. 1단계. |
| `--shadow-md` | 0px 4px 16px 0px rgb(0 0 0 / 0.08), 0px 0px 0px 1px rgb(0 0 0 / 0.05) | 0px 4px 16px 0px rgb(0 0 0 / 0.35), 0px 0px 0px 1px rgb(255 255 255 / 0.04) | 메뉴, 팝오버, 툴팁. 2단계. |
| `--shadow-lg` | 0px 16px 48px 0px rgb(0 0 0 / 0.12), 0px 0px 0px 1px rgb(0 0 0 / 0.05) | 0px 16px 48px 0px rgb(0 0 0 / 0.5), 0px 0px 0px 1px rgb(255 255 255 / 0.04) | 상세 패널, 다이얼로그, 명령 팔레트, 토스트. 3단계. |

#### 모션

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--motion-duration-fast` | 100ms | hover, 색 변화, 스위치. |
| `--motion-duration-base` | 160ms | 패널·서랍 슬라이드, 토스트 등장. |
| `--motion-duration-slow` | 240ms | 큰 레이아웃 전환. 이보다 길게 쓰지 않는다. |
| `--motion-easing-standard` | cubic-bezier(0.25, 0.1, 0.25, 1) | 기본(CSS ease와 같다). |
| `--motion-easing-enter` | cubic-bezier(0, 0, 0.2, 1) | 나타날 때(감속). |
| `--motion-easing-exit` | cubic-bezier(0.4, 0, 1, 1) | 사라질 때(가속). |

#### z-index

| CSS 변수 | 값 | 용도 |
|---|---|---|
| `--z-sticky` | 10 | 스크롤 영역 안의 고정 머리글. |
| `--z-peek` | 40 | 상세 패널. |
| `--z-scrim` | 45 | 서랍 뒤 막. |
| `--z-drawer` | 50 | 모바일 사이드바 서랍. |
| `--z-overlay` | 60 | 다이얼로그, 명령 팔레트, 시트. |
| `--z-popover` | 70 | 메뉴, 팝오버(다이얼로그 위에도 뜬다). |
| `--z-toast` | 80 | 토스트. |
| `--z-tooltip` | 85 | 툴팁. |
| `--z-gate` | 90 | 로그인·권한 차단 화면. |
<!-- tokens:reference:end -->

---

## 3. 컴포넌트 명세

공통 규칙
- 웹 컴포넌트는 React Aria Components 위에 만든다. 포커스 관리, 키보드, ARIA, 한국어 IME 처리를 직접 구현하지 않는다.
- 모든 상태(기본, hover, active, `:focus-visible`, 선택, 비활성, 로딩, 오류)를 명세하고 토큰으로만 칠한다.
- 비활성 상태는 `opacity: 0.45`로 표시하되, 가능하면 비활성화 대신 누를 수 있게 두고 왜 안 되는지 알린다.

### 3.1 버튼

| 종류 | 배경 | 글자 | 테두리 | 쓰임 |
|---|---|---|---|---|
| primary | `accent.solid` → hover `accent.solid-hover` | `text.on-solid` | 없음 | 화면당 하나의 주요 동작 |
| secondary | `bg.raised` → hover `bg.raised-hover` | `text.primary` | `border.default` | 일반 동작 |
| ghost | 투명 → hover `bg.hover` | `text.secondary` → `text.primary` | 없음 | 툴바, 아이콘 버튼 |
| danger | `status.danger.solid` → hover `solid-hover` | `text.on-solid` | 없음 | 파괴적 동작 확인 |
| danger-text | 투명 → hover `status.danger.subtle` | `status.danger.fg` | `border.default` | 파괴적 동작의 진입점 |

- 크기: sm 24px(글자 12px, 좌우 8px) / md 28px(12.5–13px, 좌우 10px) / lg 32px. 아이콘만 있는 버튼은 정사각형이고 `aria-label`과 툴팁을 갖는다.
- 로딩: 너비를 유지한 채 스피너를 보이고 `aria-busy="true"`, 중복 클릭을 막는다.
- 레이블은 동사형 명사(“저장”, “다시 시도”)이고 아이콘은 레이블 앞에 둔다. 단축키가 있으면 툴팁에 함께 적는다(“새 멤버 (C)”).
- React Aria: `Button`.

### 3.2 입력

- 높이 32px(폼), 28px(검색·툴바). 배경 `bg.input`, 테두리 `border.default`, 반경 `radius.sm`.
- 포커스: 테두리 `accent.solid` + 3px `bg.selected` 링. 오류: 테두리 `status.danger.ui`, 아래에 `status.danger.fg` 메시지, `aria-invalid="true"`, `aria-describedby`로 연결.
- 레이블은 항상 보인다. 자리표시자(`text.tertiary`)는 예시이지 레이블이 아니다.
- 붙여넣기를 막지 않는다(인증번호, 비밀번호 포함, WCAG 3.3.8). 인증번호는 `autocomplete="one-time-code"`, 이메일은 `type="email"`과 `autocomplete="email"`.
- 한글 IME: 조합 중에는 `Enter`로 제출하지 않는다(`isComposing` 확인).
- React Aria: `TextField`, `SearchField`, `NumberField`, `Select`, `Switch`, `Checkbox`.

### 3.3 목록 행

- 높이 `size.row.default` 36px(콘솔은 38px), 좌우 16–18px, 행 사이 `border.subtle`. 첫 열은 아이콘·아바타, 가운데는 제목(굵게)과 보조 정보(`text.secondary`), 오른쪽은 고정폭 열(상태, 수치, 시간).
- 상태: hover `bg.hover` / 키보드 선택 `bg.active` + 왼쪽 2px `border.focus` 표시줄 / 상세 패널에 열림 `bg.selected` / 다중 선택 시 체크박스 표시.
- 키보드: `↑`/`↓`(`J`/`K`) 이동, `Enter` 열기, `X` 또는 `Space` 선택, `Shift`+이동으로 범위 선택, `Esc` 선택 해제.
- 행 안 동작 버튼은 hover와 포커스 때 보이고, 같은 동작이 상세 패널·팔레트·컨텍스트 메뉴에도 있다(마우스 hover에만 의존하지 않는다).
- 긴 목록은 가상 스크롤(TanStack Virtual)하고 그룹 머리글은 `position: sticky`(`z.sticky`).
- React Aria: `GridList`(행 안에 버튼이 있을 때) 또는 `ListBox`.

### 3.4 상세 패널(peek)

- 오른쪽에 뜨는 너비 448px 패널(`size.peek-width`), `bg.raised`, `shadow.lg`, `radius.md`. 목록을 가리지 않고 옆에서 상세를 보여 준다.
- 모달이 아니다. 포커스를 가두지 않고, 열린 상태에서 목록 이동(`J`/`K`)이 패널 내용을 바꾼다. `Esc`로 닫으면 포커스가 원래 행으로 돌아간다.
- 구조: 머리(이동 경로 + 닫기) → 본문(제목, 속성 표 `dl`, 섹션) → 바닥(동작 버튼, 파괴적 동작은 왼쪽 끝).
- 900px 이하에서는 전체 화면 시트가 되고 그때는 모달로 동작한다.
- 나타남: `motion.duration.base`, `easing.enter`로 오른쪽에서 슬라이드.

### 3.5 다이얼로그

- 너비 440px(확인), 520px(폼), `radius.lg`, `shadow.lg`, 뒤에 `bg.scrim`.
- 포커스를 가두고, 열릴 때 첫 입력 또는 가장 안전한 버튼에 포커스를 둔다. `Esc`와 바깥 클릭으로 닫히되 입력 중인 내용이 있으면 닫기 전에 묻는다. 닫히면 연 요소로 포커스를 돌려준다.
- 제목은 하려는 일(“멤버 삭제”), 본문은 결과와 되돌릴 수 있는지, 버튼은 오른쪽 정렬로 “취소” 다음에 동작 동사(“영구 삭제”). “확인”만 있는 버튼을 쓰지 않는다.
- React Aria: `Modal` + `Dialog`, 확인용은 `role="alertdialog"`.

### 3.6 토스트

- 오른쪽 아래(상세 패널이 열려 있으면 그 왼쪽), 최대 너비 380px, `bg.raised`, `shadow.lg`. 앞에 상태 점(`status.*.ui`).
- 성공·정보는 `aria-live="polite"`, 오류는 `role="alert"`. 5초 뒤 사라지되 hover나 포커스가 있는 동안에는 멈춘다(WCAG 2.2.1).
- 토스트에만 있는 동작을 만들지 않는다. “실행 취소” 버튼을 둘 수는 있지만, 같은 결과를 다른 곳에서도 얻을 수 있어야 한다.
- 문장은 결과를 말한다(“멤버를 추가했습니다.”). 한 번에 최대 3개를 쌓는다.
- React Aria: `ToastRegion` + `Toast`.

### 3.7 명령 팔레트

- `⌘K` / `Ctrl+K`로 연다. 너비 640px, 화면 위에서 12vh, 최대 높이 560px.
- 구조: 검색 입력(48px) → 그룹(이동, 명령, 최근, 검색 결과) → 바닥에 키 안내(`↑↓` 이동, `↵` 실행, `esc` 닫기).
- 검색은 공백·대소문자를 무시하고 **초성 검색**(“ㄱㅇ” → “강의”)과 영문 별칭(`theme`, `dark`)을 지원한다.
- 항목: 아이콘 + 이름 + (보조 설명) + 오른쪽 단축키. 선택 항목은 `bg.active`.
- 결과가 없으면 “일치하는 항목이 없습니다.”와 함께 검색어로 전체 검색하는 항목을 남긴다.
- React Aria: `Autocomplete` + `Menu`(또는 `ComboBox`), 바깥은 `Modal`.

### 3.8 탭

- **세그먼트 탭**(같은 데이터의 보기 전환, 설정 값 선택): 트랙 `bg.active`, 선택 엄지 `bg.control-selected` + `shadow.sm`, 높이 24–28px.
- **밑줄 탭**(같은 화면 안의 구역 전환: 전사 / 문서 / PDF): 선택 탭 아래 2px `accent.solid`, 글자 `text.primary`, 나머지 `text.secondary`.
- 키보드: `←`/`→` 이동. 내용이 가벼우면 이동과 동시에 선택하고(자동), 무거우면 `Enter`/`Space`로 선택한다(수동).
- React Aria: `Tabs`, 세그먼트는 `ToggleButtonGroup` 또는 `RadioGroup`.

### 3.9 배지와 아바타

- 배지: 높이 18px, 좌우 6px, 글자 11px/500, `radius.xs`, 테두리 `border.default`. 상태 배지는 글자 `status.*.fg` + 테두리 `status.*.border`, 강조 배지는 `accent.fg` + `accent.border` + 배경 `bg.selected`.
- 배지는 누를 수 없다. 누를 수 있으면 칩(필터 칩, 출처 칩)으로 만든다.
- 아바타: 원형 20px(목록) / 36px(상세), 글자 `text.on-solid`. 배경은 사용자 ID 해시로 고른 색상각 `h`에 대해 `oklch(52% 0.08 h)`이다. 이 식은 모든 색상각에서 sRGB 안에 있고 흰 글자 대비가 5.2:1 이상이다(테스트가 360개 색상각을 모두 검사). 아바타는 `aria-hidden`이고 이름은 옆에 글자로 쓴다.

### 3.10 오디오 플레이어

- 녹음 상세 화면 아래에 고정되는 막대(높이 56px, `bg.raised`, 위쪽 `border.subtle`).
- 구성: 재생/일시정지 → 10초 뒤로/앞으로 → 진행 막대(슬라이더) → 현재/전체 시간(모노, `tabular-nums`, “12:30 / 1:23:45”) → 속도(0.75–2배) → 음량.
- 진행 막대: 트랙 `bg.active`, 재생된 부분 `accent.solid`, 손잡이 12px. 슬라이더의 `aria-valuetext`는 “12분 30초 / 1시간 23분 45초”처럼 읽히게 한다.
- 키보드(입력 필드 밖에서): `Space` 재생/일시정지, `←`/`→` 5초, `Shift`+`←`/`→` 30초, `[`/`]` 속도. 슬라이더에 포커스가 있으면 화살표가 슬라이더를 움직인다.
- 자동 재생하지 않는다(WCAG 1.4.2).
- React Aria: `Slider`, `ToggleButton`.

### 3.11 전사 구간

- 한 구간 = 타임스탬프(모노 12px, `text.tertiary`) + 화자(12px/500, `text.secondary`) + 본문(`typography.reading` 또는 UI 13–14px).
- 현재 재생 중인 구간은 `aria-current="true"`와 함께 왼쪽 2px `accent.solid` 표시줄과 `bg.hover` 배경을 갖는다. 출처 칩에서 이동해 온 구간은 `bg.selected`로 1.5초 강조한다(줄인 모션에서는 애니메이션 없이 배경만).
- 구간을 클릭하거나 포커스 후 `Enter`를 누르면 그 시점으로 이동한다. 구간 사이는 `↑`/`↓`로 움직인다.
- 재생 중에는 현재 구간을 따라 자동 스크롤하되, 사용자가 직접 스크롤하면 멈추고 “현재 위치로” 버튼을 띄운다.
- 화자 이름은 사용자가 바꿀 수 있고(“화자 1” → “김 교수”), 바꾼 이름은 모든 구간에 반영된다.
- 검색 결과는 `<mark>`(배경 `status.attention.subtle`)로 강조한다.

### 3.12 문서 블록

- 블록 종류: 제목(h2–h4), 문단, 목록, 표, 인용, 안내 상자(callout), 질문 카드, 일정 제안. 본문은 `typography.reading`(15px/1.7), 한 줄 35–45자.
- 각 AI 블록은 끝에 출처 칩 묶음을 단다. 출처가 없으면 `status.attention` 칩 “출처 확인 필요”를 단다.
- hover·포커스 때 블록 오른쪽에 동작(복사, 편집, 다시 생성)이 나타난다. 사용자가 편집한 블록은 “직접 수정” 배지를 달고, 다시 생성할 때 덮어쓰지 않는다(또는 비교 후 선택).
- 안내 상자: 배경 `status.*.subtle`, 테두리 `status.*.border`, 아이콘 `status.*.ui`, 글자 `text.primary`.
- 표는 가로 스크롤을 허용하고(320px 화면), 숫자 열은 오른쪽 정렬과 `tabular-nums`.

### 3.13 출처 칩

- 인라인 칩: 높이 20px, 좌우 6px, `radius.xs`, 글자 모노 11–12px `accent.fg`, 배경 투명 → hover `bg.selected`. 내용은 “12:30”(전사 구간) 또는 “p.4”(PDF 페이지).
- 누르면 오디오가 그 시점으로 이동하고 전사의 해당 구간으로 스크롤해 강조한다. PDF 출처는 해당 페이지로 이동한다.
- hover·포커스 때 원문 인용(구간 본문 앞뒤 1–2문장)을 미리 보여 준다(`Tooltip`이 아니라 포커스 가능한 `Popover`, WCAG 1.4.13: 사라지지 않고, 마우스로 옮겨 갈 수 있고, `Esc`로 닫힌다).
- 접근 가능한 이름은 “출처: 12분 30초, 화자 1”처럼 완전한 문장으로 쓴다.
- 상태: 정상(`accent.fg`) / 출처 불일치·누락(`status.attention.fg`, 아이콘 함께) / 원본 삭제됨(`text.disabled`, 누를 수 없음).
- React Aria: `Button` + `DialogTrigger`(`Popover`).

---

## 4. 패턴

### 4.1 빈 상태

- 구성: 옅은 아이콘(`text.tertiary`) → 한 줄 설명(`text.secondary`) → 다음 행동 하나(버튼 또는 단축키 안내).
- **처음이라 비어 있음**과 **필터 때문에 비어 있음**을 구분한다. 후자는 “조건에 맞는 강의가 없습니다.”와 “필터 지우기”를 보인다.
- 문제가 없어서 비어 있으면 긍정으로 쓴다(“확인할 항목이 없습니다.”, 아이콘 `status.success.ui`).

### 4.2 로딩

- 300ms 안에 끝나면 아무것도 보이지 않는다(깜빡임 방지). 그보다 길면 첫 로딩은 **스켈레톤**(실제 레이아웃과 같은 크기의 `bg.active` 막대)을 보이고, 이후 갱신은 기존 내용을 유지한 채 머리글에 작은 스피너를 보인다.
- 레이아웃이 밀리지 않게 자리를 미리 잡는다(CLS 0에 가깝게).
- AI 처리처럼 긴 작업은 단계 이름과 진행률을 보이고(“전사 중 · 42%”), 끝나면 live region으로 알린다.
- 로딩 영역에는 `aria-busy="true"`를 둔다.

### 4.3 오류

- 문장 구조: **무엇이 안 됐는지 + (알면) 왜 + 어떻게 하면 되는지**. “강의 정보를 불러오지 못했습니다. 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.”
- 필드 오류는 필드 바로 아래, 화면 오류는 해당 영역 안(점선 테두리 상자 + “다시 시도”), 전체 오류(오프라인, 권한)는 차단 화면.
- 사용자를 탓하지 않는다(“잘못 입력하셨습니다” ✗ → “이메일 형식이 아닙니다” ✓).
- 지원 요청에 필요한 정보(요청 ID, 오류 코드)는 모노 글자로 복사할 수 있게 둔다.
- 입력한 내용은 오류가 나도 지우지 않는다.

### 4.4 파괴적 작업 확인

되돌릴 수 있는 정도에 따라 세 단계로 나눈다.

| 단계 | 예 | 처리 |
|---|---|---|
| 되돌릴 수 있음 | 태그 제거, 보관, 휴지통으로 이동 | 확인 없이 실행하고 토스트에 “실행 취소” |
| 되돌릴 수 없음(작음) | 공유 링크 해제, 세션 종료 | 확인 다이얼로그. 버튼은 동작 동사(“해제”), danger 스타일 |
| 되돌릴 수 없음(큼·연쇄) | 멤버 삭제, 녹음 영구 삭제, 일괄 삭제 | 영향(강의 수, 용량)을 숫자로 보이고, 대상 이름이나 이메일을 입력해야 버튼이 켜진다 |

- 기본 포커스는 “취소”에 둔다. `Enter`가 파괴적 동작을 실행하지 않게 한다.
- 실행 후에는 결과를 토스트로 알리고, 목록에서 다음 항목으로 선택을 옮긴다.

### 4.5 일괄 작업

- 선택: 클릭(하나), `Shift`+클릭(범위), `⌘`/`Ctrl`+클릭(토글), 목록 안 `⌘A`(전체), `Esc`(해제). 선택 모드에서는 행 앞에 체크박스가 보인다.
- 하나 이상 선택하면 목록 위(또는 아래)에 일괄 작업 막대가 나타난다: “3개 선택됨 · 이동 · 태그 · 삭제 · 선택 해제”. 막대가 나타나면 live region으로 개수를 알린다.
- 파괴적 일괄 작업은 개수와 합계를 확인 다이얼로그에 보인다(“강의 12개, 오디오 1.4 GB를 삭제합니다.”).
- 일부만 실패하면 “10개 완료, 2개 실패”로 알리고 실패한 항목만 다시 선택된 상태로 남겨 다시 시도할 수 있게 한다.
- 끌어다 놓기(폴더 이동)는 항상 메뉴 동작(“폴더로 이동…”)으로도 할 수 있다(WCAG 2.5.7).

---

## 5. 접근성 규칙과 점검표

기준은 **WCAG 2.2 AA**이다. 화면 언어는 `lang="ko"`이고, 영어 구간은 `lang="en"`으로 표시한다.

### 5.1 규칙

1. **대비**: 색은 토큰으로만 칠한다. 글자 토큰은 모든 표면(채움색 위에는 `text.on-solid`만 쓴다)에서 4.5:1, UI 토큰(포커스 링, 상태 점, 컨트롤 외곽선)은 3:1 이상이며 `bun test`가 매번 검사한다(§5.2). 큰 글자 예외(3:1)에 기대지 않는다. 모든 글자 토큰이 크기와 무관하게 4.5:1을 넘는다.
2. **포커스**: `:focus-visible`에 2px `border.focus` 링(오프셋 1px). 포커스된 요소가 고정 머리글·토스트·상세 패널에 가려지지 않게 `scroll-padding`을 둔다(2.4.11).
3. **키보드**: 모든 기능이 키보드로 되고, 포커스 순서가 시각 순서와 같다. 한 글자 단축키는 입력 중·IME 조합 중에 꺼지고 설정에서 끌 수 있다(2.1.4).
4. **표적 크기**: 누를 수 있는 요소는 24×24px 이상이거나 주변에 24px 간격이 있다(2.5.8). 터치 화면은 44px.
5. **색만으로 알리지 않기**: 상태 점에는 글자가, 오류에는 아이콘과 문장이 함께 있다.
6. **알림**: 처리 진행, 완료, 토스트, 일괄 선택 개수는 live region으로 알린다(4.1.3).
7. **모션**: `prefers-reduced-motion`을 지키고, 3회/초 이상 깜빡이는 것을 만들지 않는다.
8. **구조**: 랜드마크(`header`, `nav`, `main`, `aside`), 본문 바로가기 링크, 제목 위계(h1 하나), 페이지마다 다른 `<title>`(“멤버 · Lectern Admin”).
9. **확대와 재배치**: 200% 확대와 320px 너비에서 가로 스크롤 없이 쓸 수 있다(표와 전사 타임라인 제외). 글자 간격을 사용자가 늘려도 잘리지 않는다(1.4.12).
10. **인증**: 비밀번호·인증번호 붙여넣기와 비밀번호 관리자 자동 입력을 막지 않는다. 퍼즐·기억력 테스트를 요구하지 않는다(3.3.8).
11. **오디오 콘텐츠**: 녹음에는 항상 전사가 함께 있다(1.2.1). Lectern의 핵심 산출물이 곧 대체 텍스트다.

### 5.2 대비 검사 결과

`tokens.json`의 `$extensions["com.qucord.lectern"].contrast`가 검사할 조합을 선언한다. **표면 묶음**(`base`: canvas·panel·raised와 그 위에 hover·active·selected·input을 겹친 13가지, `emphasis`: raised-hover·control-selected, `tinted`: 상태 옅은 배경, `solid`: 채움색, `opaque`: 불투명 바탕 3가지)과 **조합**(어떤 전경 토큰을 어떤 묶음 위에서 어떤 기준으로 검사할지)으로 이루어진다. 반투명 층은 실제 렌더링처럼 아래에서 위로 합성한 뒤 잰다. 장식용 토큰은 `exempt`에 이유와 함께 적는다. 어느 쪽에도 없는 색 토큰이 생기면 테스트가 실패한다.

<!-- tokens:contrast:start -->
검사한 조합 820개 중 모두 통과. 아래 값은 각 전경 토큰이 허용된 표면 전체에서 낸 **최저** 대비이고, 괄호 안이 그 표면이다(`+`는 반투명 층을 겹친 결과).

| 전경 토큰 | 역할 | 기준 | 라이트 최저 | 다크 최저 |
|---|---|---|---|---|
| `text.primary` | 글자 | 4.5:1 | 14.73 (`canvas + active`) | 13.27 (`control-selected`) |
| `text.secondary` | 글자 | 4.5:1 | 5.66 (`canvas + active`) | 5.44 (`control-selected`) |
| `text.tertiary` | 글자 | 4.5:1 | 4.64 (`canvas + active`) | 4.63 (`control-selected`) |
| `accent.fg` | 글자 | 4.5:1 | 4.62 (`canvas + active`) | 5.96 (`control-selected`) |
| `status.success.fg` | 글자 | 4.5:1 | 4.65 (`canvas + active`) | 5.65 (`control-selected`) |
| `status.attention.fg` | 글자 | 4.5:1 | 4.59 (`canvas + active`) | 8.90 (`control-selected`) |
| `status.severe.fg` | 글자 | 4.5:1 | 4.61 (`canvas + active`) | 6.34 (`control-selected`) |
| `status.danger.fg` | 글자 | 4.5:1 | 4.63 (`canvas + active`) | 4.62 (`control-selected`) |
| `status.info.fg` | 글자 | 4.5:1 | 4.61 (`canvas + active`) | 5.55 (`control-selected`) |
| `text.on-solid` | 글자 | 4.5:1 | 4.69 (`accent.solid`) | 4.69 (`accent.solid`) |
| `border.focus` | UI | 3:1 | 4.62 (`canvas + active`) | 4.02 (`control-selected`) |
| `border.control` | UI | 3:1 | 3.20 (`canvas + active`) | 3.18 (`control-selected`) |
| `status.success.ui` | UI | 3:1 | 3.11 (`canvas + active`) | 5.65 (`control-selected`) |
| `status.attention.ui` | UI | 3:1 | 3.11 (`canvas + active`) | 8.90 (`control-selected`) |
| `status.severe.ui` | UI | 3:1 | 3.11 (`canvas + active`) | 6.34 (`control-selected`) |
| `status.danger.ui` | UI | 3:1 | 3.10 (`canvas + active`) | 3.89 (`control-selected`) |
| `status.info.ui` | UI | 3:1 | 3.10 (`canvas + active`) | 5.55 (`control-selected`) |
| `accent.solid` | UI | 3:1 | 4.54 (`canvas`) | 3.66 (`raised`) |
| `status.danger.solid` | UI | 3:1 | 4.64 (`canvas`) | 3.57 (`raised`) |

<details>
<summary>전체 조합</summary>

| 전경 | 표면 | 라이트 | 다크 |
|---|---|---|---|
| `text.primary` | `canvas` | 16.64 | 17.90 |
| `text.primary` | `canvas + hover` | 15.41 | 16.45 |
| `text.primary` | `canvas + active` | 14.73 | 15.20 |
| `text.primary` | `panel` | 17.22 | 17.18 |
| `text.primary` | `panel + hover` | 15.94 | 15.62 |
| `text.primary` | `panel + active` | 15.24 | 14.35 |
| `text.primary` | `panel + selected` | 14.80 | 14.31 |
| `text.primary` | `panel + input` | 17.22 | 16.23 |
| `text.primary` | `raised` | 17.22 | 16.18 |
| `text.primary` | `raised + hover` | 15.94 | 14.56 |
| `text.primary` | `raised + active` | 15.24 | 13.31 |
| `text.primary` | `raised + selected` | 14.80 | 13.38 |
| `text.primary` | `raised + input` | 17.22 | 15.18 |
| `text.primary` | `raised-hover` | 15.66 | 14.75 |
| `text.primary` | `control-selected` | 17.22 | 13.27 |
| `text.primary` | `panel + status.success.subtle` | 15.73 | 14.81 |
| `text.primary` | `raised + status.success.subtle` | 15.73 | 13.81 |
| `text.primary` | `panel + status.attention.subtle` | 15.08 | 14.70 |
| `text.primary` | `raised + status.attention.subtle` | 15.08 | 13.67 |
| `text.primary` | `panel + status.severe.subtle` | 15.73 | 14.65 |
| `text.primary` | `raised + status.severe.subtle` | 15.73 | 13.65 |
| `text.primary` | `panel + status.danger.subtle` | 15.83 | 15.70 |
| `text.primary` | `raised + status.danger.subtle` | 15.83 | 14.71 |
| `text.primary` | `panel + status.info.subtle` | 15.73 | 14.85 |
| `text.primary` | `raised + status.info.subtle` | 15.73 | 13.83 |
| `text.secondary` | `canvas` | 6.39 | 7.34 |
| `text.secondary` | `canvas + hover` | 5.92 | 6.74 |
| `text.secondary` | `canvas + active` | 5.66 | 6.23 |
| `text.secondary` | `panel` | 6.61 | 7.04 |
| `text.secondary` | `panel + hover` | 6.12 | 6.40 |
| `text.secondary` | `panel + active` | 5.85 | 5.88 |
| `text.secondary` | `panel + selected` | 5.68 | 5.87 |
| `text.secondary` | `panel + input` | 6.61 | 6.65 |
| `text.secondary` | `raised` | 6.61 | 6.63 |
| `text.secondary` | `raised + hover` | 6.12 | 5.97 |
| `text.secondary` | `raised + active` | 5.85 | 5.45 |
| `text.secondary` | `raised + selected` | 5.68 | 5.49 |
| `text.secondary` | `raised + input` | 6.61 | 6.22 |
| `text.secondary` | `raised-hover` | 6.01 | 6.04 |
| `text.secondary` | `control-selected` | 6.61 | 5.44 |
| `text.secondary` | `panel + status.success.subtle` | 6.04 | 6.07 |
| `text.secondary` | `raised + status.success.subtle` | 6.04 | 5.66 |
| `text.secondary` | `panel + status.attention.subtle` | 5.79 | 6.03 |
| `text.secondary` | `raised + status.attention.subtle` | 5.79 | 5.60 |
| `text.secondary` | `panel + status.severe.subtle` | 6.04 | 6.01 |
| `text.secondary` | `raised + status.severe.subtle` | 6.04 | 5.59 |
| `text.secondary` | `panel + status.danger.subtle` | 6.08 | 6.44 |
| `text.secondary` | `raised + status.danger.subtle` | 6.08 | 6.03 |
| `text.secondary` | `panel + status.info.subtle` | 6.04 | 6.08 |
| `text.secondary` | `raised + status.info.subtle` | 6.04 | 5.67 |
| `text.tertiary` | `canvas` | 5.25 | 6.25 |
| `text.tertiary` | `canvas + hover` | 4.86 | 5.74 |
| `text.tertiary` | `canvas + active` | 4.64 | 5.30 |
| `text.tertiary` | `panel` | 5.43 | 5.99 |
| `text.tertiary` | `panel + hover` | 5.03 | 5.45 |
| `text.tertiary` | `panel + active` | 4.80 | 5.01 |
| `text.tertiary` | `panel + selected` | 4.67 | 4.99 |
| `text.tertiary` | `panel + input` | 5.43 | 5.66 |
| `text.tertiary` | `raised` | 5.43 | 5.65 |
| `text.tertiary` | `raised + hover` | 5.03 | 5.08 |
| `text.tertiary` | `raised + active` | 4.80 | 4.64 |
| `text.tertiary` | `raised + selected` | 4.67 | 4.67 |
| `text.tertiary` | `raised + input` | 5.43 | 5.30 |
| `text.tertiary` | `raised-hover` | 4.94 | 5.15 |
| `text.tertiary` | `control-selected` | 5.43 | 4.63 |
| `text.tertiary` | `panel + status.success.subtle` | 4.96 | 5.17 |
| `text.tertiary` | `raised + status.success.subtle` | 4.96 | 4.82 |
| `text.tertiary` | `panel + status.attention.subtle` | 4.76 | 5.13 |
| `text.tertiary` | `raised + status.attention.subtle` | 4.76 | 4.77 |
| `text.tertiary` | `panel + status.severe.subtle` | 4.96 | 5.11 |
| `text.tertiary` | `raised + status.severe.subtle` | 4.96 | 4.76 |
| `text.tertiary` | `panel + status.danger.subtle` | 4.99 | 5.48 |
| `text.tertiary` | `raised + status.danger.subtle` | 4.99 | 5.13 |
| `text.tertiary` | `panel + status.info.subtle` | 4.96 | 5.18 |
| `text.tertiary` | `raised + status.info.subtle` | 4.96 | 4.83 |
| `accent.fg` | `canvas` | 5.22 | 8.03 |
| `accent.fg` | `canvas + hover` | 4.83 | 7.38 |
| `accent.fg` | `canvas + active` | 4.62 | 6.82 |
| `accent.fg` | `panel` | 5.40 | 7.71 |
| `accent.fg` | `panel + hover` | 5.00 | 7.01 |
| `accent.fg` | `panel + active` | 4.78 | 6.44 |
| `accent.fg` | `panel + selected` | 4.64 | 6.42 |
| `accent.fg` | `panel + input` | 5.40 | 7.28 |
| `accent.fg` | `raised` | 5.40 | 7.26 |
| `accent.fg` | `raised + hover` | 5.00 | 6.53 |
| `accent.fg` | `raised + active` | 4.78 | 5.97 |
| `accent.fg` | `raised + selected` | 4.64 | 6.01 |
| `accent.fg` | `raised + input` | 5.40 | 6.81 |
| `accent.fg` | `raised-hover` | 4.91 | 6.62 |
| `accent.fg` | `control-selected` | 5.40 | 5.96 |
| `accent.fg` | `panel + status.success.subtle` | 4.93 | 6.65 |
| `accent.fg` | `raised + status.success.subtle` | 4.93 | 6.20 |
| `accent.fg` | `panel + status.attention.subtle` | 4.73 | 6.60 |
| `accent.fg` | `raised + status.attention.subtle` | 4.73 | 6.14 |
| `accent.fg` | `panel + status.severe.subtle` | 4.94 | 6.58 |
| `accent.fg` | `raised + status.severe.subtle` | 4.94 | 6.12 |
| `accent.fg` | `panel + status.danger.subtle` | 4.97 | 7.05 |
| `accent.fg` | `raised + status.danger.subtle` | 4.97 | 6.60 |
| `accent.fg` | `panel + status.info.subtle` | 4.94 | 6.66 |
| `accent.fg` | `raised + status.info.subtle` | 4.94 | 6.21 |
| `status.success.fg` | `canvas` | 5.25 | 7.62 |
| `status.success.fg` | `canvas + hover` | 4.87 | 7.00 |
| `status.success.fg` | `canvas + active` | 4.65 | 6.47 |
| `status.success.fg` | `panel` | 5.44 | 7.31 |
| `status.success.fg` | `panel + hover` | 5.03 | 6.65 |
| `status.success.fg` | `panel + active` | 4.81 | 6.11 |
| `status.success.fg` | `panel + selected` | 4.67 | 6.09 |
| `status.success.fg` | `panel + input` | 5.44 | 6.91 |
| `status.success.fg` | `raised` | 5.44 | 6.88 |
| `status.success.fg` | `raised + hover` | 5.03 | 6.19 |
| `status.success.fg` | `raised + active` | 4.81 | 5.66 |
| `status.success.fg` | `raised + selected` | 4.67 | 5.69 |
| `status.success.fg` | `raised + input` | 5.44 | 6.46 |
| `status.success.fg` | `raised-hover` | 4.95 | 6.28 |
| `status.success.fg` | `control-selected` | 5.44 | 5.65 |
| `status.success.fg` | `panel + status.success.subtle` | 4.97 | 6.30 |
| `status.success.fg` | `raised + status.success.subtle` | 4.97 | 5.88 |
| `status.success.fg` | `panel + status.attention.subtle` | 4.76 | 6.26 |
| `status.success.fg` | `raised + status.attention.subtle` | 4.76 | 5.82 |
| `status.success.fg` | `panel + status.severe.subtle` | 4.97 | 6.23 |
| `status.success.fg` | `raised + status.severe.subtle` | 4.97 | 5.81 |
| `status.success.fg` | `panel + status.danger.subtle` | 5.00 | 6.68 |
| `status.success.fg` | `raised + status.danger.subtle` | 5.00 | 6.26 |
| `status.success.fg` | `panel + status.info.subtle` | 4.97 | 6.32 |
| `status.success.fg` | `raised + status.info.subtle` | 4.97 | 5.89 |
| `status.attention.fg` | `canvas` | 5.19 | 12.00 |
| `status.attention.fg` | `canvas + hover` | 4.80 | 11.03 |
| `status.attention.fg` | `canvas + active` | 4.59 | 10.19 |
| `status.attention.fg` | `panel` | 5.37 | 11.52 |
| `status.attention.fg` | `panel + hover` | 4.97 | 10.47 |
| `status.attention.fg` | `panel + active` | 4.75 | 9.62 |
| `status.attention.fg` | `panel + selected` | 4.61 | 9.59 |
| `status.attention.fg` | `panel + input` | 5.37 | 10.88 |
| `status.attention.fg` | `raised` | 5.37 | 10.85 |
| `status.attention.fg` | `raised + hover` | 4.97 | 9.76 |
| `status.attention.fg` | `raised + active` | 4.75 | 8.92 |
| `status.attention.fg` | `raised + selected` | 4.61 | 8.97 |
| `status.attention.fg` | `raised + input` | 5.37 | 10.18 |
| `status.attention.fg` | `raised-hover` | 4.88 | 9.89 |
| `status.attention.fg` | `control-selected` | 5.37 | 8.90 |
| `status.attention.fg` | `panel + status.success.subtle` | 4.90 | 9.93 |
| `status.attention.fg` | `raised + status.success.subtle` | 4.90 | 9.26 |
| `status.attention.fg` | `panel + status.attention.subtle` | 4.70 | 9.86 |
| `status.attention.fg` | `raised + status.attention.subtle` | 4.70 | 9.17 |
| `status.attention.fg` | `panel + status.severe.subtle` | 4.90 | 9.82 |
| `status.attention.fg` | `raised + status.severe.subtle` | 4.90 | 9.15 |
| `status.attention.fg` | `panel + status.danger.subtle` | 4.93 | 10.53 |
| `status.attention.fg` | `raised + status.danger.subtle` | 4.93 | 9.86 |
| `status.attention.fg` | `panel + status.info.subtle` | 4.90 | 9.95 |
| `status.attention.fg` | `raised + status.info.subtle` | 4.90 | 9.27 |
| `status.severe.fg` | `canvas` | 5.21 | 8.55 |
| `status.severe.fg` | `canvas + hover` | 4.82 | 7.86 |
| `status.severe.fg` | `canvas + active` | 4.61 | 7.26 |
| `status.severe.fg` | `panel` | 5.39 | 8.21 |
| `status.severe.fg` | `panel + hover` | 4.99 | 7.46 |
| `status.severe.fg` | `panel + active` | 4.77 | 6.86 |
| `status.severe.fg` | `panel + selected` | 4.64 | 6.84 |
| `status.severe.fg` | `panel + input` | 5.39 | 7.75 |
| `status.severe.fg` | `raised` | 5.39 | 7.73 |
| `status.severe.fg` | `raised + hover` | 4.99 | 6.95 |
| `status.severe.fg` | `raised + active` | 4.77 | 6.36 |
| `status.severe.fg` | `raised + selected` | 4.64 | 6.39 |
| `status.severe.fg` | `raised + input` | 5.39 | 7.25 |
| `status.severe.fg` | `raised-hover` | 4.91 | 7.04 |
| `status.severe.fg` | `control-selected` | 5.39 | 6.34 |
| `status.severe.fg` | `panel + status.success.subtle` | 4.93 | 7.08 |
| `status.severe.fg` | `raised + status.success.subtle` | 4.93 | 6.60 |
| `status.severe.fg` | `panel + status.attention.subtle` | 4.72 | 7.02 |
| `status.severe.fg` | `raised + status.attention.subtle` | 4.72 | 6.53 |
| `status.severe.fg` | `panel + status.severe.subtle` | 4.93 | 7.00 |
| `status.severe.fg` | `raised + status.severe.subtle` | 4.93 | 6.52 |
| `status.severe.fg` | `panel + status.danger.subtle` | 4.96 | 7.50 |
| `status.severe.fg` | `raised + status.danger.subtle` | 4.96 | 7.03 |
| `status.severe.fg` | `panel + status.info.subtle` | 4.93 | 7.09 |
| `status.severe.fg` | `raised + status.info.subtle` | 4.93 | 6.61 |
| `status.danger.fg` | `canvas` | 5.23 | 6.23 |
| `status.danger.fg` | `canvas + hover` | 4.85 | 5.72 |
| `status.danger.fg` | `canvas + active` | 4.63 | 5.29 |
| `status.danger.fg` | `panel` | 5.42 | 5.98 |
| `status.danger.fg` | `panel + hover` | 5.01 | 5.43 |
| `status.danger.fg` | `panel + active` | 4.79 | 4.99 |
| `status.danger.fg` | `panel + selected` | 4.66 | 4.98 |
| `status.danger.fg` | `panel + input` | 5.42 | 5.65 |
| `status.danger.fg` | `raised` | 5.42 | 5.63 |
| `status.danger.fg` | `raised + hover` | 5.01 | 5.06 |
| `status.danger.fg` | `raised + active` | 4.79 | 4.63 |
| `status.danger.fg` | `raised + selected` | 4.66 | 4.66 |
| `status.danger.fg` | `raised + input` | 5.42 | 5.28 |
| `status.danger.fg` | `raised-hover` | 4.93 | 5.13 |
| `status.danger.fg` | `control-selected` | 5.42 | 4.62 |
| `status.danger.fg` | `panel + status.success.subtle` | 4.95 | 5.15 |
| `status.danger.fg` | `raised + status.success.subtle` | 4.95 | 4.80 |
| `status.danger.fg` | `panel + status.attention.subtle` | 4.74 | 5.11 |
| `status.danger.fg` | `raised + status.attention.subtle` | 4.74 | 4.76 |
| `status.danger.fg` | `panel + status.severe.subtle` | 4.95 | 5.10 |
| `status.danger.fg` | `raised + status.severe.subtle` | 4.95 | 4.75 |
| `status.danger.fg` | `panel + status.danger.subtle` | 4.98 | 5.46 |
| `status.danger.fg` | `raised + status.danger.subtle` | 4.98 | 5.12 |
| `status.danger.fg` | `panel + status.info.subtle` | 4.95 | 5.16 |
| `status.danger.fg` | `raised + status.info.subtle` | 4.95 | 4.81 |
| `status.info.fg` | `canvas` | 5.21 | 7.48 |
| `status.info.fg` | `canvas + hover` | 4.82 | 6.88 |
| `status.info.fg` | `canvas + active` | 4.61 | 6.36 |
| `status.info.fg` | `panel` | 5.39 | 7.18 |
| `status.info.fg` | `panel + hover` | 4.99 | 6.53 |
| `status.info.fg` | `panel + active` | 4.77 | 6.00 |
| `status.info.fg` | `panel + selected` | 4.63 | 5.98 |
| `status.info.fg` | `panel + input` | 5.39 | 6.79 |
| `status.info.fg` | `raised` | 5.39 | 6.77 |
| `status.info.fg` | `raised + hover` | 4.99 | 6.09 |
| `status.info.fg` | `raised + active` | 4.77 | 5.56 |
| `status.info.fg` | `raised + selected` | 4.63 | 5.60 |
| `status.info.fg` | `raised + input` | 5.39 | 6.35 |
| `status.info.fg` | `raised-hover` | 4.90 | 6.17 |
| `status.info.fg` | `control-selected` | 5.39 | 5.55 |
| `status.info.fg` | `panel + status.success.subtle` | 4.92 | 6.19 |
| `status.info.fg` | `raised + status.success.subtle` | 4.92 | 5.77 |
| `status.info.fg` | `panel + status.attention.subtle` | 4.72 | 6.15 |
| `status.info.fg` | `raised + status.attention.subtle` | 4.72 | 5.72 |
| `status.info.fg` | `panel + status.severe.subtle` | 4.92 | 6.13 |
| `status.info.fg` | `raised + status.severe.subtle` | 4.92 | 5.71 |
| `status.info.fg` | `panel + status.danger.subtle` | 4.95 | 6.57 |
| `status.info.fg` | `raised + status.danger.subtle` | 4.95 | 6.15 |
| `status.info.fg` | `panel + status.info.subtle` | 4.92 | 6.21 |
| `status.info.fg` | `raised + status.info.subtle` | 4.92 | 5.79 |
| `text.on-solid` | `accent.solid` | 4.69 | 4.69 |
| `text.on-solid` | `accent.solid-hover` | 5.40 | 5.40 |
| `text.on-solid` | `status.danger.solid` | 4.81 | 4.81 |
| `text.on-solid` | `status.danger.solid-hover` | 5.42 | 5.42 |
| `border.focus` | `canvas` | 5.22 | 5.42 |
| `border.focus` | `canvas + hover` | 4.83 | 4.98 |
| `border.focus` | `canvas + active` | 4.62 | 4.60 |
| `border.focus` | `panel` | 5.40 | 5.20 |
| `border.focus` | `panel + hover` | 5.00 | 4.73 |
| `border.focus` | `panel + active` | 4.78 | 4.34 |
| `border.focus` | `panel + selected` | 4.64 | 4.33 |
| `border.focus` | `panel + input` | 5.40 | 4.91 |
| `border.focus` | `raised` | 5.40 | 4.90 |
| `border.focus` | `raised + hover` | 5.00 | 4.41 |
| `border.focus` | `raised + active` | 4.78 | 4.03 |
| `border.focus` | `raised + selected` | 4.64 | 4.05 |
| `border.focus` | `raised + input` | 5.40 | 4.59 |
| `border.focus` | `raised-hover` | 4.91 | 4.46 |
| `border.focus` | `control-selected` | 5.40 | 4.02 |
| `border.focus` | `panel + status.success.subtle` | 4.93 | 4.48 |
| `border.focus` | `raised + status.success.subtle` | 4.93 | 4.18 |
| `border.focus` | `panel + status.attention.subtle` | 4.73 | 4.45 |
| `border.focus` | `raised + status.attention.subtle` | 4.73 | 4.14 |
| `border.focus` | `panel + status.severe.subtle` | 4.94 | 4.43 |
| `border.focus` | `raised + status.severe.subtle` | 4.94 | 4.13 |
| `border.focus` | `panel + status.danger.subtle` | 4.97 | 4.75 |
| `border.focus` | `raised + status.danger.subtle` | 4.97 | 4.45 |
| `border.focus` | `panel + status.info.subtle` | 4.94 | 4.49 |
| `border.focus` | `raised + status.info.subtle` | 4.94 | 4.19 |
| `border.control` | `canvas` | 3.62 | 4.30 |
| `border.control` | `canvas + hover` | 3.35 | 3.95 |
| `border.control` | `canvas + active` | 3.20 | 3.65 |
| `border.control` | `panel` | 3.74 | 4.12 |
| `border.control` | `panel + hover` | 3.47 | 3.75 |
| `border.control` | `panel + active` | 3.31 | 3.44 |
| `border.control` | `panel + selected` | 3.22 | 3.43 |
| `border.control` | `panel + input` | 3.74 | 3.89 |
| `border.control` | `raised` | 3.74 | 3.88 |
| `border.control` | `raised + hover` | 3.47 | 3.49 |
| `border.control` | `raised + active` | 3.31 | 3.19 |
| `border.control` | `raised + selected` | 3.22 | 3.21 |
| `border.control` | `raised + input` | 3.74 | 3.64 |
| `border.control` | `raised-hover` | 3.41 | 3.54 |
| `border.control` | `control-selected` | 3.74 | 3.18 |
| `border.control` | `panel + status.success.subtle` | 3.42 | 3.55 |
| `border.control` | `raised + status.success.subtle` | 3.42 | 3.31 |
| `border.control` | `panel + status.attention.subtle` | 3.28 | 3.53 |
| `border.control` | `raised + status.attention.subtle` | 3.28 | 3.28 |
| `border.control` | `panel + status.severe.subtle` | 3.42 | 3.52 |
| `border.control` | `raised + status.severe.subtle` | 3.42 | 3.27 |
| `border.control` | `panel + status.danger.subtle` | 3.44 | 3.77 |
| `border.control` | `raised + status.danger.subtle` | 3.44 | 3.53 |
| `border.control` | `panel + status.info.subtle` | 3.42 | 3.56 |
| `border.control` | `raised + status.info.subtle` | 3.42 | 3.32 |
| `status.success.ui` | `canvas` | 3.52 | 7.62 |
| `status.success.ui` | `canvas + hover` | 3.26 | 7.00 |
| `status.success.ui` | `canvas + active` | 3.11 | 6.47 |
| `status.success.ui` | `panel` | 3.64 | 7.31 |
| `status.success.ui` | `panel + hover` | 3.37 | 6.65 |
| `status.success.ui` | `panel + active` | 3.22 | 6.11 |
| `status.success.ui` | `panel + selected` | 3.13 | 6.09 |
| `status.success.ui` | `panel + input` | 3.64 | 6.91 |
| `status.success.ui` | `raised` | 3.64 | 6.88 |
| `status.success.ui` | `raised + hover` | 3.37 | 6.19 |
| `status.success.ui` | `raised + active` | 3.22 | 5.66 |
| `status.success.ui` | `raised + selected` | 3.13 | 5.69 |
| `status.success.ui` | `raised + input` | 3.64 | 6.46 |
| `status.success.ui` | `raised-hover` | 3.31 | 6.28 |
| `status.success.ui` | `control-selected` | 3.64 | 5.65 |
| `status.success.ui` | `panel + status.success.subtle` | 3.33 | 6.30 |
| `status.success.ui` | `raised + status.success.subtle` | 3.33 | 5.88 |
| `status.success.ui` | `panel + status.attention.subtle` | 3.19 | 6.26 |
| `status.success.ui` | `raised + status.attention.subtle` | 3.19 | 5.82 |
| `status.success.ui` | `panel + status.severe.subtle` | 3.33 | 6.23 |
| `status.success.ui` | `raised + status.severe.subtle` | 3.33 | 5.81 |
| `status.success.ui` | `panel + status.danger.subtle` | 3.35 | 6.68 |
| `status.success.ui` | `raised + status.danger.subtle` | 3.35 | 6.26 |
| `status.success.ui` | `panel + status.info.subtle` | 3.33 | 6.32 |
| `status.success.ui` | `raised + status.info.subtle` | 3.33 | 5.89 |
| `status.attention.ui` | `canvas` | 3.51 | 12.00 |
| `status.attention.ui` | `canvas + hover` | 3.25 | 11.03 |
| `status.attention.ui` | `canvas + active` | 3.11 | 10.19 |
| `status.attention.ui` | `panel` | 3.63 | 11.52 |
| `status.attention.ui` | `panel + hover` | 3.36 | 10.47 |
| `status.attention.ui` | `panel + active` | 3.22 | 9.62 |
| `status.attention.ui` | `panel + selected` | 3.12 | 9.59 |
| `status.attention.ui` | `panel + input` | 3.63 | 10.88 |
| `status.attention.ui` | `raised` | 3.63 | 10.85 |
| `status.attention.ui` | `raised + hover` | 3.36 | 9.76 |
| `status.attention.ui` | `raised + active` | 3.22 | 8.92 |
| `status.attention.ui` | `raised + selected` | 3.12 | 8.97 |
| `status.attention.ui` | `raised + input` | 3.63 | 10.18 |
| `status.attention.ui` | `raised-hover` | 3.30 | 9.89 |
| `status.attention.ui` | `control-selected` | 3.63 | 8.90 |
| `status.attention.ui` | `panel + status.success.subtle` | 3.32 | 9.93 |
| `status.attention.ui` | `raised + status.success.subtle` | 3.32 | 9.26 |
| `status.attention.ui` | `panel + status.attention.subtle` | 3.18 | 9.86 |
| `status.attention.ui` | `raised + status.attention.subtle` | 3.18 | 9.17 |
| `status.attention.ui` | `panel + status.severe.subtle` | 3.32 | 9.82 |
| `status.attention.ui` | `raised + status.severe.subtle` | 3.32 | 9.15 |
| `status.attention.ui` | `panel + status.danger.subtle` | 3.34 | 10.53 |
| `status.attention.ui` | `raised + status.danger.subtle` | 3.34 | 9.86 |
| `status.attention.ui` | `panel + status.info.subtle` | 3.32 | 9.95 |
| `status.attention.ui` | `raised + status.info.subtle` | 3.32 | 9.27 |
| `status.severe.ui` | `canvas` | 3.51 | 8.55 |
| `status.severe.ui` | `canvas + hover` | 3.25 | 7.86 |
| `status.severe.ui` | `canvas + active` | 3.11 | 7.26 |
| `status.severe.ui` | `panel` | 3.63 | 8.21 |
| `status.severe.ui` | `panel + hover` | 3.36 | 7.46 |
| `status.severe.ui` | `panel + active` | 3.21 | 6.86 |
| `status.severe.ui` | `panel + selected` | 3.12 | 6.84 |
| `status.severe.ui` | `panel + input` | 3.63 | 7.75 |
| `status.severe.ui` | `raised` | 3.63 | 7.73 |
| `status.severe.ui` | `raised + hover` | 3.36 | 6.95 |
| `status.severe.ui` | `raised + active` | 3.21 | 6.36 |
| `status.severe.ui` | `raised + selected` | 3.12 | 6.39 |
| `status.severe.ui` | `raised + input` | 3.63 | 7.25 |
| `status.severe.ui` | `raised-hover` | 3.30 | 7.04 |
| `status.severe.ui` | `control-selected` | 3.63 | 6.34 |
| `status.severe.ui` | `panel + status.success.subtle` | 3.32 | 7.08 |
| `status.severe.ui` | `raised + status.success.subtle` | 3.32 | 6.60 |
| `status.severe.ui` | `panel + status.attention.subtle` | 3.18 | 7.02 |
| `status.severe.ui` | `raised + status.attention.subtle` | 3.18 | 6.53 |
| `status.severe.ui` | `panel + status.severe.subtle` | 3.32 | 7.00 |
| `status.severe.ui` | `raised + status.severe.subtle` | 3.32 | 6.52 |
| `status.severe.ui` | `panel + status.danger.subtle` | 3.34 | 7.50 |
| `status.severe.ui` | `raised + status.danger.subtle` | 3.34 | 7.03 |
| `status.severe.ui` | `panel + status.info.subtle` | 3.32 | 7.09 |
| `status.severe.ui` | `raised + status.info.subtle` | 3.32 | 6.61 |
| `status.danger.ui` | `canvas` | 3.50 | 5.25 |
| `status.danger.ui` | `canvas + hover` | 3.24 | 4.83 |
| `status.danger.ui` | `canvas + active` | 3.10 | 4.46 |
| `status.danger.ui` | `panel` | 3.62 | 5.04 |
| `status.danger.ui` | `panel + hover` | 3.35 | 4.58 |
| `status.danger.ui` | `panel + active` | 3.20 | 4.21 |
| `status.danger.ui` | `panel + selected` | 3.11 | 4.20 |
| `status.danger.ui` | `panel + input` | 3.62 | 4.76 |
| `status.danger.ui` | `raised` | 3.62 | 4.75 |
| `status.danger.ui` | `raised + hover` | 3.35 | 4.27 |
| `status.danger.ui` | `raised + active` | 3.20 | 3.90 |
| `status.danger.ui` | `raised + selected` | 3.11 | 3.93 |
| `status.danger.ui` | `raised + input` | 3.62 | 4.45 |
| `status.danger.ui` | `raised-hover` | 3.29 | 4.33 |
| `status.danger.ui` | `control-selected` | 3.62 | 3.89 |
| `status.danger.ui` | `panel + status.success.subtle` | 3.31 | 4.35 |
| `status.danger.ui` | `raised + status.success.subtle` | 3.31 | 4.05 |
| `status.danger.ui` | `panel + status.attention.subtle` | 3.17 | 4.31 |
| `status.danger.ui` | `raised + status.attention.subtle` | 3.17 | 4.01 |
| `status.danger.ui` | `panel + status.severe.subtle` | 3.31 | 4.30 |
| `status.danger.ui` | `raised + status.severe.subtle` | 3.31 | 4.00 |
| `status.danger.ui` | `panel + status.danger.subtle` | 3.33 | 4.61 |
| `status.danger.ui` | `raised + status.danger.subtle` | 3.33 | 4.31 |
| `status.danger.ui` | `panel + status.info.subtle` | 3.31 | 4.35 |
| `status.danger.ui` | `raised + status.info.subtle` | 3.31 | 4.06 |
| `status.info.ui` | `canvas` | 3.50 | 7.48 |
| `status.info.ui` | `canvas + hover` | 3.24 | 6.88 |
| `status.info.ui` | `canvas + active` | 3.10 | 6.36 |
| `status.info.ui` | `panel` | 3.62 | 7.18 |
| `status.info.ui` | `panel + hover` | 3.35 | 6.53 |
| `status.info.ui` | `panel + active` | 3.20 | 6.00 |
| `status.info.ui` | `panel + selected` | 3.11 | 5.98 |
| `status.info.ui` | `panel + input` | 3.62 | 6.79 |
| `status.info.ui` | `raised` | 3.62 | 6.77 |
| `status.info.ui` | `raised + hover` | 3.35 | 6.09 |
| `status.info.ui` | `raised + active` | 3.20 | 5.56 |
| `status.info.ui` | `raised + selected` | 3.11 | 5.60 |
| `status.info.ui` | `raised + input` | 3.62 | 6.35 |
| `status.info.ui` | `raised-hover` | 3.29 | 6.17 |
| `status.info.ui` | `control-selected` | 3.62 | 5.55 |
| `status.info.ui` | `panel + status.success.subtle` | 3.31 | 6.19 |
| `status.info.ui` | `raised + status.success.subtle` | 3.31 | 5.77 |
| `status.info.ui` | `panel + status.attention.subtle` | 3.17 | 6.15 |
| `status.info.ui` | `raised + status.attention.subtle` | 3.17 | 5.72 |
| `status.info.ui` | `panel + status.severe.subtle` | 3.31 | 6.13 |
| `status.info.ui` | `raised + status.severe.subtle` | 3.31 | 5.71 |
| `status.info.ui` | `panel + status.danger.subtle` | 3.33 | 6.57 |
| `status.info.ui` | `raised + status.danger.subtle` | 3.33 | 6.15 |
| `status.info.ui` | `panel + status.info.subtle` | 3.31 | 6.21 |
| `status.info.ui` | `raised + status.info.subtle` | 3.31 | 5.79 |
| `accent.solid` | `canvas` | 4.54 | 4.05 |
| `accent.solid` | `panel` | 4.69 | 3.88 |
| `accent.solid` | `raised` | 4.69 | 3.66 |
| `status.danger.solid` | `canvas` | 4.64 | 3.95 |
| `status.danger.solid` | `panel` | 4.81 | 3.80 |
| `status.danger.solid` | `raised` | 4.81 | 3.57 |

</details>
<!-- tokens:contrast:end -->

### 5.3 WCAG 2.2 AA 점검표

릴리스 전에 아래를 확인한다. “자동”은 CI(P2부터 Playwright + axe, 토큰 대비는 지금도 `bun test`), “수동”은 키보드만으로 하는 점검과 VoiceOver(macOS Safari) 점검이다.

| SC | 이름 | Lectern에서 지키는 방법 | 확인 |
|---|---|---|---|
| 1.1.1 | 텍스트 아닌 콘텐츠 | 아이콘 버튼에 `aria-label`, 장식 아이콘·아바타는 `aria-hidden` | 자동 + 수동 |
| 1.2.1 | 오디오 전용(녹음) | 모든 녹음에 전사 제공 | 수동 |
| 1.3.1 | 정보와 관계 | 표는 `table`, 속성은 `dl`, 폼은 `label`·`fieldset`, 제목 위계 | 자동 |
| 1.3.2 | 의미 있는 순서 | DOM 순서 = 시각 순서(3열 상세 포함) | 수동 |
| 1.3.3 | 감각적 특성 | “오른쪽 버튼”이 아니라 버튼 이름으로 안내 | 수동 |
| 1.3.4 | 화면 방향 | 가로·세로 모두 지원 | 수동 |
| 1.3.5 | 입력 목적 | `autocomplete`(email, current-password, one-time-code) | 자동 |
| 1.4.1 | 색 사용 | 상태 점 + 글자, 오류 아이콘 + 문장, 링크 밑줄 | 수동 |
| 1.4.2 | 오디오 제어 | 자동 재생 없음 | 수동 |
| 1.4.3 | 대비(최소) | 글자 토큰 4.5:1, §5.2 | 자동(`bun test`) |
| 1.4.4 | 글자 크기 조정 | 200% 확대에서 잘림 없음, 크기는 px이되 확대에 반응 | 수동 |
| 1.4.5 | 글자 이미지 | 글자는 모두 실제 텍스트 | 수동 |
| 1.4.10 | 재배치 | 320px에서 가로 스크롤 없음(표·타임라인 제외) | 수동 |
| 1.4.11 | 텍스트 아닌 대비 | 포커스 링, 상태 점, 컨트롤 외곽선 3:1, §5.2 | 자동(`bun test`) |
| 1.4.12 | 텍스트 간격 | 고정 높이 글자 상자 없음, 넘침은 줄바꿈 | 수동 |
| 1.4.13 | 호버·포커스 콘텐츠 | 출처 미리보기는 `Esc`로 닫히고, 위로 옮겨 갈 수 있고, 저절로 사라지지 않음 | 수동 |
| 2.1.1 | 키보드 | 모든 기능 키보드로 가능, 끌어다 놓기는 메뉴 대안 | 수동 |
| 2.1.2 | 키보드 함정 없음 | 모달만 포커스를 가두고 `Esc`로 나감 | 수동 |
| 2.1.4 | 단축키 | 한 글자 단축키는 입력·IME 조합 중 꺼짐, 설정에서 끄기 | 수동 |
| 2.2.1 | 시간 조절 | 토스트는 hover·포커스 중 멈춤, 세션 만료 전 경고 | 수동 |
| 2.2.2 | 일시 정지·정지·숨기기 | 5초 넘게 움직이는 것은 진행 표시뿐 | 수동 |
| 2.3.1 | 세 번 번쩍임 | 번쩍임 없음 | 수동 |
| 2.4.1 | 블록 건너뛰기 | 본문 바로가기 링크, 랜드마크 | 자동 |
| 2.4.2 | 페이지 제목 | 보기마다 `<title>` 갱신 | 자동 |
| 2.4.3 | 포커스 순서 | 다이얼로그·패널은 열고 닫을 때 포커스 이동·복귀 | 수동 |
| 2.4.4 | 링크 목적 | 링크 글자만으로 목적이 드러남(“자세히” 금지) | 수동 |
| 2.4.5 | 여러 방법 | 내비게이션 + 명령 팔레트 + 검색 | 수동 |
| 2.4.6 | 제목과 레이블 | 섹션 제목, 필드 레이블이 내용을 설명 | 수동 |
| 2.4.7 | 포커스 표시 | `:focus-visible` 2px 링 | 자동 + 수동 |
| 2.4.11 | 포커스 가려짐 없음 | 고정 요소 높이만큼 `scroll-padding` | 수동 |
| 2.5.1 | 포인터 제스처 | 여러 손가락·경로 제스처 없이도 가능 | 수동 |
| 2.5.2 | 포인터 취소 | 동작은 `click`(up 이벤트)에서 실행 | 수동 |
| 2.5.3 | 이름 안의 레이블 | 접근 가능한 이름이 보이는 레이블로 시작 | 자동 |
| 2.5.4 | 움직임으로 작동 | 기기 흔들기 등 없음 | 수동 |
| 2.5.7 | 끌기 동작 | 끌어다 놓기마다 메뉴·버튼 대안 | 수동 |
| 2.5.8 | 표적 크기(최소) | 24×24px 이상 | 자동 + 수동 |
| 3.1.1 | 페이지 언어 | `lang="ko"` | 자동 |
| 3.1.2 | 부분 언어 | 영어 전사·문서 구간은 `lang="en"` | 수동 |
| 3.2.1 | 포커스 시 | 포커스만으로 화면이 바뀌지 않음 | 수동 |
| 3.2.2 | 입력 시 | 선택만으로 제출하지 않음(설정은 “저장” 버튼) | 수동 |
| 3.2.3 | 일관된 내비게이션 | 사이드바 순서 고정 | 수동 |
| 3.2.4 | 일관된 식별 | 같은 동작은 같은 이름·아이콘(§6.5 용어집) | 수동 |
| 3.2.6 | 일관된 도움말 | 도움말·단축키 시트 위치 고정(사이드바 아래) | 수동 |
| 3.3.1 | 오류 식별 | 필드 오류 문장 + `aria-invalid` | 자동 + 수동 |
| 3.3.2 | 레이블 또는 설명 | 모든 입력에 보이는 레이블, 형식 힌트 | 자동 |
| 3.3.3 | 오류 제안 | 고치는 방법을 문장에 포함 | 수동 |
| 3.3.4 | 오류 예방(중요) | 파괴적 작업 3단계 확인(§4.4) | 수동 |
| 3.3.7 | 중복 입력 | 같은 과정에서 이미 입력한 값을 다시 묻지 않음 | 수동 |
| 3.3.8 | 접근 가능한 인증 | 붙여넣기·자동 입력 허용, 인지 테스트 없음 | 수동 |
| 4.1.2 | 이름·역할·값 | React Aria Components 사용, 직접 만든 위젯은 ARIA 패턴 준수 | 자동 + 수동 |
| 4.1.3 | 상태 메시지 | 토스트·진행·선택 개수를 live region으로 | 수동 |

---

## 6. 문구 규칙 (한국어 UI)

### 6.1 문체

- **문장은 합니다체**로 쓴다: “백업이 없습니다.”, “다시 시도하세요.” 해요체와 섞지 않는다.
- **버튼·메뉴·탭·레이블은 명사형**으로 짧게 쓴다: “저장”, “되돌리기”, “다시 시도”, “새 멤버”, “승인”. “~하기”를 붙이지 않는다(“저장하기” ✗).
- 주어(“사용자님”, “고객님”)를 생략한다. 높임 표현은 “-세요” 정도로만 쓰고 “-하시겠습니까?”를 남발하지 않는다.
- 한 문장에는 한 가지만 말한다. 두 줄을 넘으면 나눈다.

### 6.2 상황별

| 상황 | 규칙 | 예 |
|---|---|---|
| 성공 토스트 | 과거형으로 결과만 | “멤버를 추가했습니다.” |
| 진행 중 | 명사형 + 줄임표(…, U+2026) | “불러오는 중…”, “전사 중 · 42%” |
| 오류 | 무엇이 + 왜 + 어떻게 | “녹음을 올리지 못했습니다. 파일이 250MB를 넘습니다. 파일을 나눠서 올리세요.” |
| 빈 상태 | 사실 + 다음 행동 | “아직 녹음이 없습니다. 파일을 끌어다 놓거나 ‘녹음 올리기’를 누르세요.” |
| 확인 다이얼로그 | 제목은 동작, 본문은 결과와 되돌릴 수 있는지 | 제목 “녹음 삭제”, 본문 “오디오와 문서가 영구히 삭제됩니다. 되돌릴 수 없습니다.” |
| 확인 버튼 | 동작 동사(“확인” 금지) | “취소” / “영구 삭제” |
| 권한 없음 | 이유와 누구에게 물을지 | “이 작업은 관리자만 할 수 있습니다. 워크스페이스 관리자에게 요청하세요.” |

### 6.3 AI 결과물

- AI가 만든 것은 “AI 요약”, “자동 생성”처럼 드러내고, 사용자가 고친 것은 “직접 수정”으로 표시한다.
- 의인화하지 않는다(“제가 정리해 드렸어요” ✗). 단정하지 않고 출처를 붙인다.
- 확신이 낮거나 검증에 실패한 내용은 “출처 확인 필요”로 표시한다. 문구로 얼버무리지 않는다(“~인 것 같습니다” ✗).

### 6.4 표기

- **숫자와 단위**: 숫자와 단위 사이를 띄운다(“2 GB”, “37 MB”). 한글 단위는 붙인다(“3개”, “12분”). 천 단위 쉼표(“1,204개”).
- **날짜·시간**: 같은 해는 “10월 19일 (일)”, 다른 해는 “2025년 10월 19일”, 시각은 “오후 3:05”. 최근 일은 상대 시간(“방금 전”, “3분 전”, “어제”)으로 쓰고 툴팁에 절대 시각을 둔다. 길이는 “1시간 23분”, 전사 타임스탬프는 “1:23:45”(1시간 미만은 “23:45”).
- **조사**: 변수 뒤 조사는 받침에 맞게 고른다(“강의를”, “녹음을”). 영문·숫자처럼 받침을 판별하기 어려우면 “을(를)” 대신 문장을 바꾼다(“확인하려면 다음을 입력하세요: park@example.com”).
- **줄임표·따옴표**: 줄임표는 “…” 한 글자, 인용은 큰따옴표 “ ”, 고유 명칭은 따옴표 없이 쓴다.
- **단축키**: macOS는 기호(⌘K, ⇧⌘P), Windows·Linux는 “Ctrl+K”. 키캡 안에는 기호나 대문자 한 글자.
- **외래어**: 국립국어원 표기를 따른다(이메일, 로그인, 업로드, 워크스페이스). 시스템 역할명(Owner, Admin, Member, Viewer)은 영어 그대로 쓴다.

### 6.5 용어집

같은 개념은 모든 화면과 플랫폼에서 같은 말로 쓴다.

| 개념 (코드) | 쓰는 말 | 쓰지 않는 말 |
|---|---|---|
| recording | 녹음 | 레코딩, 파일 |
| transcript | 전사 | 녹취록, 스크립트 |
| segment | 구간 | 세그먼트, 블록 |
| speaker | 화자 | 발화자, 스피커 |
| document | 문서 | 노트(문서를 가리킬 때) |
| source | 출처 | 근거, 소스 |
| workspace | 워크스페이스 | 작업공간 |
| folder / tag | 폴더 / 태그 | 디렉터리 / 라벨 |
| upload | 올리기(동작), 업로드(명사) | 전송 |
| reprocess | 다시 처리 | 재분석, 리프로세스 |
| share link | 공유 링크 | 공개 URL |
| quota | 사용량 한도 | 쿼터 |
| member | 멤버 | 사용자(관리 화면에서) |
| suggestion (calendar) | 일정 제안 | 추천 일정 |

---

## 7. 플랫폼 대응표 (CSS ↔ SwiftUI ↔ Compose)

단위: CSS 1px = SwiftUI 1pt = Compose 1dp(글자는 sp). 토큰 이름은 세 플랫폼에서 같은 경로를 쓴다.

### 7.1 토큰 사용

| 개념 | Web (CSS) | SwiftUI (`Tokens.swift`) | Compose (`Tokens.kt`) |
|---|---|---|---|
| 색 | `color: var(--color-text-primary)` | `.foregroundStyle(LecternTokens.Colors.textPrimary)` | `color = LocalLecternColors.current.textPrimary` |
| 테마 전환 | `<html data-theme="dark">`, 없으면 `prefers-color-scheme` | 시스템 외관을 자동으로 따름(`.preferredColorScheme(.dark)`로 강제) | `if (isSystemInDarkTheme()) LecternDarkColors else LecternLightColors`를 `CompositionLocalProvider`로 |
| 반투명 상태 층 | `background: var(--color-bg-hover)` 겹치기 | `.background(LecternTokens.Colors.bgHover)` | `Modifier.background(colors.bgHover)` |
| 간격 | `gap: var(--space-8)` | `.padding(LecternTokens.Space.s8)`, `spacing: LecternTokens.Space.s8` | `Arrangement.spacedBy(LecternTokens.Space.s8)` |
| 컨트롤 크기 | `height: var(--size-control-md)` | `.frame(height: LecternTokens.Size.controlMd)` | `Modifier.height(LecternTokens.Size.controlMd)` |
| 반경 | `border-radius: var(--radius-sm)` | `RoundedRectangle(cornerRadius: LecternTokens.Radius.sm)` | `RoundedCornerShape(LecternTokens.Radius.sm)` |
| 글자 조합 | `font: var(--typography-body); letter-spacing: var(--typography-body-letter-spacing)` | `.font(s.font).tracking(s.tracking).lineSpacing(s.lineSpacing)` (`s = LecternTokens.TextStyles.body`) | `style = LecternTokens.TextStyles.body` |
| 글꼴 | Pretendard Variable | 시스템(SF Pro + Apple SD Gothic Neo) | `FontFamily.Default`(Roboto + Noto Sans CJK) |
| 글자 크기 확대 | 브라우저 확대·`rem` | Dynamic Type: `.dynamicTypeSize(...)` 범위 지정, 고정 크기 남용 금지 | `sp`가 글꼴 배율을 따름 |
| 그림자 | `box-shadow: var(--shadow-lg)` | `.shadow(color: l.color, radius: l.radius, x: l.x, y: l.y)` (spread 겹은 `.overlay(strokeBorder)`) | `drawBehind`로 `LocalLecternElevation.current.lg` 그리기 |
| 지속 시간·이징 | `transition: background var(--motion-duration-fast) var(--motion-easing-standard)` | `withAnimation(LecternTokens.Motion.easingStandard.animation(duration: LecternTokens.Motion.durationFast))` | `tween(LecternTokens.Motion.durationFast, easing = LecternTokens.Motion.easingStandard)` |
| 줄인 모션 | `@media (prefers-reduced-motion: reduce)` | `@Environment(\.accessibilityReduceMotion)` | `Settings.Global.ANIMATOR_DURATION_SCALE == 0f` 확인 |
| 쌓임 순서 | `z-index: var(--z-overlay)` | `.zIndex(LecternTokens.ZIndex.overlay)` | `Modifier.zIndex(LecternTokens.ZIndex.overlay)` |
| 포커스 링 | `:focus-visible { outline: 2px solid var(--color-border-focus) }` | 시스템 포커스 링(`.focusable()`), 직접 그릴 때 `borderFocus` | `Modifier.focusable()` + `indication`에 `borderFocus` |

`LocalLecternColors`와 `LocalLecternElevation`은 앱이 `staticCompositionLocalOf`로 정의한다. 생성 파일(`Tokens.kt`)에는 값만 있다.

### 7.2 컴포넌트 대응

| 컴포넌트 | Web (React Aria) | SwiftUI (macOS 13+) | Compose |
|---|---|---|---|
| 버튼 | `Button` | `Button` + `.buttonStyle(...)` | `Button` / `TextButton` |
| 입력 | `TextField`, `SearchField` | `TextField`, `.searchable` | `OutlinedTextField` |
| 스위치·체크박스 | `Switch`, `Checkbox` | `Toggle(.switch / .checkbox)` | `Switch`, `Checkbox` |
| 목록 행 | `GridList` / `ListBox` | `List` + `selection` | `LazyColumn` |
| 상세 패널 | 오른쪽 `aside` | `NavigationSplitView` 상세 열(`.inspector`는 macOS 14+) | 넓은 화면은 2열, 좁은 화면은 `ModalBottomSheet` |
| 다이얼로그 | `Modal` + `Dialog` | `.sheet`, `.alert`, `.confirmationDialog` | `AlertDialog`, `Dialog` |
| 토스트 | `ToastRegion` + `Toast` | 직접 만든 오버레이 + `NSAccessibility.post(element:notification: .announcementRequested)` | `SnackbarHost` |
| 명령 팔레트 | `Autocomplete` + `Menu` | 직접 만든 시트 + `.commands`(메뉴 막대 단축키) | 직접 만든 `Dialog` + 검색 |
| 탭 | `Tabs`, `ToggleButtonGroup` | `Picker(.segmented)`, `TabView` | `SegmentedButton`, `TabRow` |
| 배지 | `span` | `Text` + `.overlay(Capsule().stroke)` | `Badge` 대신 `Surface` + 테두리 |
| 오디오 진행 막대 | `Slider` | `Slider` | `Slider` |
| 단축키 | `keydown`(입력·IME 조합 중 무시) | `.keyboardShortcut` | `Modifier.onPreviewKeyEvent` |

---

## 8. 참고 원칙

다음 세 시스템에서 **원칙만** 가져온다. 화면 구성, 레이아웃, 아이콘, 브랜드 색, 문구는 가져오지 않는다.

**Linear**
- 속도가 기능이다. 낙관적 갱신, 즉시 이동, 로딩 없는 전환을 목표로 한다.
- 키보드가 일급이다. 명령 팔레트가 모든 기능의 입구이고, 단축키는 화면에서 발견할 수 있다.
- 채도 낮은 중립색 위에서 색은 상태와 선택에만 쓴다. 목록이 화면의 중심이고 상세는 옆에서 열린다.

**Vercel Geist**
- 색 단계마다 역할(배경, 컴포넌트, 테두리, 글자)을 정하고, 역할별로 대비를 보장한다. 이 문서의 역할별 토큰(`fg`/`ui`/`subtle`/`border`)과 선언적 대비 검사가 여기서 왔다.
- 수치는 고정폭 숫자로, 기술 정보는 모노로 쓴다. 빈 상태·오류 상태도 컴포넌트처럼 명세한다.
- 크기, 간격, 반경을 정해진 단계에서만 고른다.

**Apple Human Interface Guidelines**
- 명료함(clarity), 콘텐츠 우선(deference), 층으로 위계를 만드는 깊이(depth).
- 플랫폼 관습을 따른다. macOS에서는 메뉴 막대, 표준 단축키, 시트, 시스템 글꼴과 컨트롤을 쓰고 웹 화면을 그대로 옮기지 않는다.
- Dynamic Type, VoiceOver, 줄인 모션, 대비 증가 설정을 존중하고, 터치 표적은 44pt 이상으로 한다.

---

## 부록 A. 관리자 콘솔 별칭

관리자 콘솔(`renderAdminPageHtml()`, `apps/server/src/ui.ts`)은 P0에서 토큰 파이프라인을 증명하는 첫 소비자다. 렌더링할 때 `dist/tokens-css.ts`의 `tokensCss`를 `<style>`에 그대로 넣고, 콘솔이 원래 쓰던 짧은 변수 이름을 토큰의 별칭으로 둔다. 그래서 선택자는 바꾸지 않았다. 새 규칙은 토큰 이름을 직접 쓴다. 이 콘솔은 P5에서 React로 옮기며, 그때 별칭을 없앤다.

| 콘솔 변수 | 토큰 |
|---|---|
| `--bg` / `--panel` / `--raised` / `--raised-2` / `--seg-on` | `--color-bg-canvas` / `-panel` / `-raised` / `-raised-hover` / `-control-selected` |
| `--hover` / `--active` / `--accent-soft` / `--input-bg` / `--overlay` | `--color-bg-hover` / `-active` / `-selected` / `-input` / `-scrim` |
| `--border` / `--border-strong` | `--color-border-subtle` / `-default` |
| `--text` / `--text-2` / `--text-3` | `--color-text-primary` / `-secondary` / `-tertiary` |
| `--accent` / `--accent-hover` / `--accent-text` | `--color-accent-solid` / `-solid-hover` / `-fg` |
| `--green` `--yellow` `--orange` `--red` `--blue` | `--color-status-{success,attention,severe,danger,info}-ui` |
| `--green-text` … `--blue-text` | `--color-status-{…}-fg` |
| `--red-soft` / `--yellow-soft` | `--color-status-danger-subtle` / `-attention-subtle` |
| `--shadow` / `--font` / `--mono` | `--shadow-lg` / `--font-family-sans` / `--font-family-mono` |

별칭은 `:root`에서 한 번 계산된다. 콘솔 안에서 `[data-theme]`로 하위 트리만 테마를 바꾸려면 별칭이 아니라 토큰 이름을 써야 한다.

## 부록 B. 기존 팔레트에서 바뀐 것

관리자 콘솔의 Linear 풍 팔레트와 밀도를 그대로 출발점으로 삼았다. 표면, 구분선, 강조색, 크기는 바꾸지 않았고, 대비 기준(글자 4.5:1, UI 3:1)에 못 미치던 값만 같은 색상각을 유지한 채 명도를 옮겼다.

| 항목 | 이전 | 이후 | 이유 |
|---|---|---|---|
| 다크 `text-2` | `#8a8f98` (최저 4.35) | `#9ca1aa` | `text-3`을 올리면서 위계를 유지 |
| 다크 `text-3` | `#62666d` (최저 2.45) | `#8f949d` | 개수·힌트·시각이 실제 글자인데 2.45:1이었다 |
| 다크 빨강 글자 | `#eb5757` (최저 4.06) | `#f76260` | 선택 행 위에서 4.5:1 미달 |
| 라이트 `text-2` / `text-3` | `#6b6f76` / `#9b9ea4` (2.24) | `#595d64` / `#666a71` | 같은 이유 |
| 라이트 상태 글자 | 초록·노랑·주황·빨강·파랑 3.2–3.8 | `#0b794e` `#886502` `#a65404` `#c43336` `#0f6bc1` | 흰 바탕과 선택 행 위에서 4.5:1 |
| 라이트 상태 점·막대 | 다크 값을 그대로 씀(1.3–2.9) | 라이트 전용 `status.*.ui` | 흰 바탕에서 3:1 |
| 위험 버튼 | `#eb5757` + 흰 글자 3.48, hover 더 밝게 | `#cf3c3c`(4.81), hover `#c43336` | 흰 글자 4.5:1 |
| 주요 버튼 hover | `#6e79e0` + 흰 글자 3.84 | `#5560c7`(5.41) | 흰 글자 4.5:1 |
| 포커스 링·선택 행 표시줄 | `--accent` (다크 3.01) | `border.focus`, 다크 `#7180ea`(4.02 이상) | 어두운 면에서도 분명하게 |
| 아바타 | `hsl(h 40% 46%)` + 흰 글자(최저 2.63) | `oklch(52% 0.08 h)`(최저 5.28) | 색상각과 무관하게 같은 밝기 |
| 모션 | 항상 재생 | `prefers-reduced-motion`에서 전환·등장 애니메이션 끔 | WCAG 2.3.3 권고, 멀미 방지 |
| 배지·안내 상자 테두리 | 다크 상태색의 rgba를 두 테마에 공통 사용 | 테마별 `status.*.border` | 라이트에서 상태색과 맞춤 |
