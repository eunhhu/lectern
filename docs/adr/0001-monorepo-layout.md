# ADR-0001: 모노레포 레이아웃과 의존 방향

- 상태: 채택
- 날짜: 2026-10-19
- 관련: [ARCHITECTURE.md §4](../v2/ARCHITECTURE.md#4-모노레포-레이아웃), [ROADMAP.md 병렬화와 동결 지점](../v2/ROADMAP.md#병렬화와-동결-지점)

## 맥락 (Context)

지금 저장소는 Bun 워크스페이스(`packages/*`, `apps/server`) 하나다. 서버 코드는 `apps/server/src`의 큰 파일 몇 개(`index.ts` 약 2,900줄, `db.ts` 약 1,700줄, `ui.ts` 약 6,500줄)에 몰려 있고, AI 호출은 `packages/core` 하나에 있다. 네이티브 클라이언트(`apps/macos`, `apps/android`, `apps/windows`, `apps/ios`)는 같은 저장소에 있지만 서버 코드와 공유하는 것이 없다.

v2는 API, 워커, 웹 SPA, AI 하네스, 디자인 토큰, 네이티브 코드 생성을 **여러 에이전트 세션이 병렬로** 만든다. 그러려면 다음이 필요하다.

- 작업 흐름마다 소유하는 디렉터리가 분명해야 한다. 두 흐름이 같은 파일을 동시에 고치면 충돌한다.
- 엔티티와 API 계약이 한곳에 있어야 웹·워커·네이티브가 같은 스키마를 쓴다.
- 운영 호스트의 systemd `ExecStart`가 `apps/server/src/index.ts`를 직접 가리키므로, 이 경로는 쉽게 옮길 수 없다.

검토한 선택지
1. **현행 유지(단일 서버 패키지)**: 이동 비용은 없지만 병렬 작업 경계가 없고 파일이 계속 커진다.
2. **여러 저장소로 분리**: 경계는 강해지지만 1인 유지보수에 CI·버전 관리 부담이 크고, 스키마 공유가 패키지 배포를 거쳐야 한다.
3. **한 저장소 안에서 `apps/*` + `packages/*`로 나누는 모노레포**: Bun 워크스페이스를 그대로 쓰고, 경계는 디렉터리와 import 규칙으로 잡는다.

## 결정 (Decision)

3번을 택한다. 레이아웃은 다음과 같다.

```
apps/
  server/        # HTTP API (Hono). systemd ExecStart 경로를 지키려고 이름을 바꾸지 않는다
  worker/        # 작업 러너: 하네스 단계, 압축, 유지보수, 리마인더, 캘린더 동기화
  web/           # React SPA. 빌드 결과는 server가 정적으로 서빙한다
  macos/ android/ windows/ ios/
packages/
  domain/        # zod 스키마 = 단일 진실 공급원 (엔티티, API DTO, 이벤트, 템플릿 스키마)
  db/            # Drizzle 스키마, SQL 마이그레이션, 리포지토리
  harness/       # AI 파이프라인 단계, 공급자 어댑터, 프롬프트, 템플릿, 검증기, 평가
  media/         # ffmpeg/ffprobe 래퍼, VAD, 청크 분할, 시간 맵
  design-tokens/ # tokens.json(DTCG) → CSS / Swift / Kotlin
  ui/            # React 컴포넌트 (React Aria Components + 토큰)
  config/        # 환경 변수 스키마(zod), 기본값, 경로
  core/          # 현행 v1 AI 경로. 하네스가 대체하면 정리한다
docs/{v2,adr,runbooks}/
deploy/systemd/  # 호스트 유닛 템플릿과 EnvironmentFile 예시
DESIGN.md, AGENTS.md
```

의존 방향은 한쪽으로만 흐른다.

- `apps/*` → `packages/{harness,db,media,ui,config}` → `packages/domain` → (없음)
- `packages/domain`은 런타임 의존성이 zod뿐이고 저장소 안의 다른 패키지를 import하지 않는다.
- `apps/*`끼리는 서로 import하지 않는다. 공유할 코드는 `packages/`로 옮긴다.
  - **과도기 예외**: P0의 `apps/worker`는 `@lectern/server`에 의존한다(`apps/worker/package.json`). 가져다 쓰는 것은 작업 처리 모듈(`job-handlers.ts`, `queue.ts`, `events.ts`, `maintenance.ts` 등)뿐이고 `index.ts`(HTTP 서버)는 import하지 않는다. 이 코드는 P1에서 `packages/harness`·`packages/db`로 옮기고, 옮긴 뒤 이 예외를 없앤다.
- 경계 파일은 `packages/domain` 하나뿐이다. 동결 후에는 하위 호환 추가만 허용하고, 깨는 변경은 ADR을 거친다.

## 결과 (Consequences)

- 좋아지는 것
  - 작업 흐름(하네스, 웹, 네이티브 준비)이 디렉터리 단위로 독립한다.
  - OpenAPI와 Swift·Kotlin 클라이언트를 `packages/domain`의 스키마 하나에서 만든다.
  - 서버 파일이 기능 모듈로 나뉘어 리뷰와 인계가 쉬워진다.
- 감수하는 것
  - 패키지 경계를 지키는 규칙이 아직 도구로 강제되지 않는다. 처음에는 리뷰로 지키고, 위반이 생기면 lint 규칙(import 경로 제한)을 추가한다.
  - CI의 배포 판단(`deploy-server` 잡의 경로 필터)이 `apps/server/`와 `packages/`만 본다. `apps/worker/`도 필터에 넣어야 워커만 바꾼 커밋이 배포된다. 새 앱을 추가할 때마다 필터를 확인한다.
  - `tsconfig.json`의 `include`도 새 앱을 추가할 때마다 넓힌다(`apps/worker`는 P0에서 추가됨).
- 다시 검토할 신호
  - 네이티브 클라이언트의 릴리스 주기가 서버와 크게 달라 CI가 서로를 막을 때
  - 외부 기여자가 생겨 저장소 권한을 나눠야 할 때
