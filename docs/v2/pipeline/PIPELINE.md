# 빌드 파이프라인 (PIPELINE)

P1 후반 ~ P7을 **작업 패키지(WP) 89개**로 나눠, 작은 모델의 워커가 하나씩 만들고 게이트를 통과한 것만 통합 브랜치에 합치는 방식이다. 사람이나 상위 모델이 없어도 굴러가게, 판단이 필요한 일은 문서와 스크립트로 미리 정해 두었다.

## 구성

| 파일 | 역할 | 누가 고치나 |
|---|---|---|
| [CONTRACTS.md](CONTRACTS.md) | 설계 결정: 플래그, 테이블, 라우트, 모듈 경로·시그니처, 규칙 | 사람(또는 사람이 지정한 상위 모델)만 |
| [CATALOG.md](CATALOG.md) | WP마다 무엇을 만들고 무엇으로 끝났다고 보는지 | 위와 같음 |
| [`pipeline.json`](pipeline.json) | WP의 순서, 의존, 소유 경로, 등급, 게이트, **상태** | 오케스트레이터(`bun run pipeline …`으로만) |
| `wp/<ID>.md` | WP 하나의 단계별 명세 (워커가 읽는 것) | 명세 작성자. 워커는 고치지 않는다 |
| [RECIPES.md](RECIPES.md) | 기존 코드의 관례: 테이블·라우트·플래그·작업·단계·화면·테스트를 추가하는 법 | 관례가 바뀔 때 |
| [WORKER.md](WORKER.md) | 워커 규칙과 보고 형식 | 사람 |
| [SPEC-WRITER.md](SPEC-WRITER.md) | 명세를 새로 쓰거나 낡은 명세를 다시 쓰는 규칙 | 사람 |
| [ORCHESTRATOR.md](ORCHESTRATOR.md) | 오케스트레이터가 따라 하는 절차 | 사람 |
| [STATUS.md](STATUS.md) | 단계별 정직한 상태표와 사용자 몫 목록 | 오케스트레이터(단계가 끝날 때) |
| [`flags-on.env`](flags-on.env) | 게이트의 "전부 켬" preflight가 켜는 플래그 | 계약 WP |
| `scripts/pipeline/pipeline.ts` | 다음에 할 WP 고르기, 상태 바꾸기, 소유 경로 검사 | 사람 |
| `scripts/pipeline/gate.sh` | 게이트 | 사람 |

믿는 순서: CONTRACTS > CATALOG > `wp/<ID>.md`. 실제 코드와 계약이 어긋나면 워커는 멈추고 보고한다. 계약을 고쳐서 맞추지 않는다.

## 역할

- **워커**: WP 하나를 자기 작업 트리(`wp/<ID>` 브랜치)에서 만들고 게이트를 돌린 뒤 정해진 형식으로 보고한다. 판단하지 않는다. 막히면 멈춘다.
- **오케스트레이터**: `pipeline.ts`가 고른 WP를 워커에게 맡기고, 게이트와 소유 경로를 **직접 다시 확인한 뒤** 합친다. 워커의 보고를 믿고 합치지 않는다.
- **사용자**: `needs_user`가 붙은 WP의 승인, 실측(실제 Gemini·Google·Apple 호출, Pi, 실제 기기), `main` 배포.

## 상태

```
todo ──start──▶ in_progress ──게이트 통과 + 병합──▶ merged
                    │
                    └──두 번 고쳐도 실패 / 계약 불일치──▶ blocked ──사람이 풀면 reset──▶ todo
```

`needs_user`가 있는 WP는 사용자가 승인해 그 필드를 지우기 전에는 시작되지 않는다.

## 순서와 병렬

- **기본은 직렬이다.** `bun run pipeline next`는 `pipeline.json`의 순서에서 의존이 모두 `merged`인 첫 WP 하나를 준다. 직렬이면 병합 충돌이 생기지 않는다.
- 병렬(`next --parallel`)은 선택이다. 의존이 끝났고 **소유 경로가 서로 겹치지 않는** WP를 최대 `max_parallel`(3)개까지 준다. 서버(`apps/server/`), 웹(`apps/web/`), 하네스(`packages/harness/`), Apple(`apps/apple/`) 작업이 서로 다른 줄로 나란히 간다.
- 계약 WP(`*-C`)는 `packages/db/`, `packages/domain/`, `packages/config/`를 소유하므로 서로 겹쳐 항상 하나씩 돈다. 마이그레이션 번호가 꼬이지 않는다.

## 게이트

WP는 자기 게이트를 통과해야 합쳐진다. 게이트는 실제 공급자를 부르지 않는다.

| 게이트 | 명령 | 하는 일 |
|---|---|---|
| `quick` | `bash scripts/pipeline/gate.sh quick` | 설치(잠금 파일 고정), 타입 검사 |
| `unit` | `bash scripts/pipeline/gate.sh unit` | `quick` + `bun test` |
| `full` | `bash scripts/pipeline/gate.sh full` | `unit` + 웹 e2e(Playwright + axe) + preflight 두 번(플래그 끔, `flags-on.env` 전부 켬) |
| `apple` | `bash apps/apple/scripts/gate.sh` (P6-A1이 만든다. P6-A0은 `cd apps/macos && swift build`) | XcodeGen, 시뮬레이터·macOS 빌드, 패키지 단위 테스트 |
| `android` | `cd apps/android && ./gradlew testDebugUnitTest assembleDebug` | 단위 테스트와 빌드 |
| `windows` | 로컬에서 못 돈다. PR의 Windows CI 작업으로만 확인한다 | — |

준비(처음 한 번)

```bash
bun install
```
```bash
cd apps/web && bunx playwright install chromium
```

- e2e가 전부 "Executable doesn't exist"로 실패하면 위의 브라우저 설치가 빠진 것이다.
- 전사·미디어 테스트는 ffmpeg를 쓴다. 기계가 잠들거나 부하가 크면 시간 초과로 실패한다. 다른 무거운 작업을 멈추고 다시 돌린다. **시간 초과를 이유로 테스트의 제한 시간을 늘리거나 건너뛰지 않는다.**
- 기준선(`45a9d3b`)에서 `unit`은 794개 통과, e2e는 55개 통과, preflight는 플래그 끔에서 통과하고 **플래그 켬에서 실패한다**(`/`가 302). 첫 WP인 P0-01이 이것을 고친다. 그래서 P0-01이 합쳐지기 전에는 어떤 `full` 게이트도 통과하지 못한다.

## 병합 규칙

1. 워커가 `DONE`을 보고하면 오케스트레이터가 그 작업 트리에서 게이트를 **직접** 돌린다.
2. `bun run pipeline verify <ID>`로 바뀐 파일이 전부 소유 경로 안인지 본다.
3. 병렬로 돌렸다면 병합 전에 작업 브랜치에 통합 브랜치를 먼저 합치고(`git merge <통합 브랜치>`) 게이트를 다시 돌린다.
4. 통합 브랜치에서 `git merge --no-ff wp/<ID>`. 통합 브랜치에는 게이트를 통과한 상태만 들어간다.
5. `bun run pipeline merged <ID>` → `pipeline.json` 변경을 커밋한다.

`bun.lock` 충돌은 손으로 고치지 않는다: `git checkout --ours bun.lock && bun install` 뒤 `bun install --frozen-lockfile`로 확인한다.

## 실패 처리

- 게이트 실패나 소유 경로 위반: 실패 출력의 끝부분을 같은 워커에게 돌려보내 고치게 한다. **최대 2번.**
- 그래도 실패하거나 워커가 `BLOCKED`를 보고하면 `bun run pipeline block <ID> "<이유>"`. 그 WP에 의존하지 않는 다른 WP로 넘어간다.
- 막힌 WP를 푸는 것(계약 수정, 명세 수정)은 사람이나 상위 모델의 일이다. 워커와 오케스트레이터는 계약을 고치지 않는다.
- `next`가 `STUCK`을 내면 멈추고 `bun run pipeline status`의 `BLOCKED`·`NEEDS_USER` 목록을 사용자에게 보고한다.

## push

- 통합 브랜치만 push한다: `git push origin <통합 브랜치>`. 단계(P1, P2 …)가 끝날 때마다 한다.
- **`main`에는 push하지 않는다.** `main`에 들어가면 운영에 배포된다. 사용자가 그 배포를 말로 요청했을 때만 한다.

## 끝

`next`가 `DONE`을 내거나, 남은 것이 전부 `blocked`·`needs_user`일 때다. 그때 [STATUS.md](STATUS.md)를 실제 상태로 고치고 보고한다. "만들었다", "가짜로 테스트했다", "실측이 필요하다", "사용자가 해야 한다"를 섞어 쓰지 않는다.
