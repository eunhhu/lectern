# 오케스트레이터 절차 (ORCHESTRATOR)

이 문서를 받은 세션은 아래를 **위에서부터 그대로** 한다. 다음에 무엇을 할지는 스스로 정하지 않고 `bun run pipeline next`에 묻는다. 배경은 [PIPELINE.md](PIPELINE.md)다.

## 지킬 것

1. 직접 구현하지 않는다. 코드는 워커가 쓴다. 오케스트레이터는 맡기고, 확인하고, 합친다.
2. 워커의 보고를 믿고 합치지 않는다. 게이트와 소유 경로를 직접 확인한다.
3. `main`에 push하지 않는다. 통합 브랜치만 push한다.
4. `CONTRACTS.md`, `CATALOG.md`, `wp/*.md`를 고치지 않는다. 맞지 않으면 그 WP를 `block`하고 넘어간다.
5. 실제 외부 호출(Gemini, Google, Apple, Resend)을 하지 않고, 워커에게도 시키지 않는다.
6. 운영 서버에 접속하지 않는다. sudo가 필요한 일은 사용자 몫이다.

## 0. 준비 (세션을 시작할 때 한 번)

```bash
git status --short
```
```bash
git branch --show-current
```
```bash
bun run pipeline check
```
```bash
bun run pipeline status
```

- 작업 트리가 깨끗하고, 현재 브랜치가 `pipeline.json`의 `integration_branch`이고, `check`가 `OK`여야 한다. 아니면 멈추고 보고한다.
- `status`에 `RUNNING`이 있으면 지난 세션이 중간에 끊긴 것이다. 그 WP의 작업 브랜치(`wp/<ID>`)가 있으면 2단계의 "확인"부터 이어서 하고, 없으면 `bun run pipeline reset <ID>`로 되돌린다.

## 1. 고르기

```bash
bun run pipeline next
```

| 출력 | 할 일 |
|---|---|
| `READY <ID> [등급, gate 게이트] 제목` | 2단계로 |
| `WAIT running: …` | 돌고 있는 워커가 끝나기를 기다린다 |
| `STUCK …` | 6단계(보고)로 |
| `DONE …` | 6단계(보고)로 |

병렬로 돌리려면 `bun run pipeline next --parallel`을 쓴다. 나온 WP마다 2~4단계를 따로 한다. 잘 모르겠으면 직렬로 한다.

## 2. 맡기기

```bash
bun run pipeline start <ID>
```

`start`가 "has no spec"으로 거절하면 그 WP의 명세(`wp/<ID>.md`)가 아직 없는 것이다. [SPEC-WRITER.md](SPEC-WRITER.md)를 읽게 한 명세 작성 에이전트(워커보다 좋은 모델)에게 그 명세 하나를 쓰게 하고 커밋한 뒤 다시 `start`한다. 좋은 모델이 없으면 5단계로 가서 `block`한다.

출력된 `git worktree add …` 명령을 그대로 실행해 작업 트리를 만든다. `pipeline.json`의 변경(`in_progress`)을 통합 브랜치에 커밋한다: `chore(pipeline): <ID> 시작`.

작업 트리에서 의존성을 설치한다.

```bash
cd .claude/worktrees/wp-<ID> && bun install --frozen-lockfile
```

워커를 띄운다. 모델은 등급으로 고른다: `basic`은 가장 작은 모델로 충분하다. `careful`은 쓸 수 있는 것 중 가장 좋은 모델을 쓴다(작은 모델밖에 없으면 그대로 돌리되 3단계 확인을 건너뛰지 않는다).

워커에게 주는 글(괄호만 바꾼다):

```
너는 Lectern 저장소의 작업 패키지 <ID>를 맡은 워커다.
작업 디렉터리는 <작업 트리의 절대 경로>이고 브랜치는 wp/<ID>다. 이 디렉터리 밖의 파일은 읽기만 한다.
다음 세 파일을 순서대로 읽고 그대로 수행해라.
1. AGENTS.md
2. docs/v2/pipeline/WORKER.md
3. docs/v2/pipeline/wp/<ID>.md
끝나면 WORKER.md 5절의 보고 형식으로만 답해라.
```

## 3. 확인 (워커가 `RESULT: DONE`을 보고한 뒤)

작업 트리에서 그 WP의 게이트를 직접 돌린다(`pipeline.json`의 `gate`, 명령은 PIPELINE.md의 표).

```bash
cd .claude/worktrees/wp-<ID> && bash scripts/pipeline/gate.sh <게이트>
```

통합 브랜치의 작업 디렉터리에서 소유 경로를 검사한다.

```bash
bun run pipeline verify <ID>
```

워커가 테스트를 지우거나 약하게 만들지 않았는지 본다. 아래 명령의 출력에 지워진 테스트 파일이나 `skip`·`todo`·`failing`으로 바뀐 줄이 있으면 실패로 본다.

```bash
git diff --stat <통합 브랜치>...wp/<ID> -- '*.test.ts' '*.e2e.ts'
```
```bash
git diff <통합 브랜치>...wp/<ID> | grep -nE '^\+.*\b(test|it|describe)\.(skip|todo|failing)\b'
```

| 결과 | 할 일 |
|---|---|
| 게이트 통과, `verify`가 `OK`, 약해진 테스트 없음 | 4단계로 |
| 하나라도 실패 | 실패 출력의 마지막 60줄을 같은 워커에게 보내 고치게 한다. 최대 2번. 그 뒤에도 실패하면 5단계로 |
| 워커가 `RESULT: BLOCKED` | 5단계로 |

## 4. 합치기

병렬로 돌렸다면 먼저 작업 트리에서 통합 브랜치를 합치고 게이트를 다시 돌린다.

```bash
cd .claude/worktrees/wp-<ID> && git merge <통합 브랜치>
```

통합 브랜치의 작업 디렉터리에서:

```bash
git merge --no-ff wp/<ID> -m "merge(wp): <ID> <제목>"
```
```bash
bun run pipeline merged <ID>
```
```bash
git add docs/v2/pipeline/pipeline.json && git commit -m "chore(pipeline): <ID> 병합"
```
```bash
git worktree remove .claude/worktrees/wp-<ID>
```

워커 보고의 `NEEDS`와 `DEVIATIONS`가 `none`이 아니면 `docs/v2/pipeline/STATUS.md`의 "넘겨받은 요청" 표에 한 줄로 옮겨 적고 같은 커밋에 넣는다.

한 단계(P1, P2 …)의 WP가 전부 `merged`가 되면:

1. `STATUS.md`의 그 단계 행을 고친다(무엇을 만들었고, 무엇이 가짜로만 테스트됐고, 무엇이 실측·사용자 몫인지).
2. `bash scripts/pipeline/gate.sh full`을 통합 브랜치에서 한 번 더 돌린다.
3. `git push origin <통합 브랜치>`.

1단계로 돌아간다.

## 5. 막힌 WP

```bash
bun run pipeline block <ID> "<이유 한 줄: 경로·심볼·오류>"
```

`pipeline.json` 변경을 커밋한다. 작업 브랜치와 작업 트리는 **지우지 않는다**(사람이 본다). 1단계로 돌아가 그 WP에 의존하지 않는 다른 WP를 한다.

## 6. 보고 (`STUCK`이거나 `DONE`일 때)

```bash
bun run pipeline status
```

`STATUS.md`를 실제 상태로 고치고 커밋·push한 뒤 사용자에게 보고한다. 보고에는 다음만 쓴다.

- 합쳐진 WP 수와 단계별 상태
- `BLOCKED` 목록과 이유
- `NEEDS_USER` 목록(사용자가 승인하거나 준비할 것)
- 실측이 필요한 것(`STATUS.md`의 표)

확인하지 않은 것을 됐다고 쓰지 않는다. 가짜로만 테스트한 것은 그렇게 쓴다.

## 사용자가 `needs_user`를 풀어 줄 때

사용자가 어떤 WP의 진행을 말로 승인하면, 그 WP의 `needs_user` 필드를 `pipeline.json`에서 지우고(그 한 줄만 고친다) 커밋한다: `chore(pipeline): <ID> 사용자 승인`. 사용자가 말하지 않은 WP의 `needs_user`는 지우지 않는다.
