# 런북: 배포와 롤백

> 대상: 운영 서버 `lectern.qucord.com` (Raspberry Pi, systemd `lectern.service`)
> 근거 코드: [.github/workflows/ci-cd.yml](../../.github/workflows/ci-cd.yml)의 `deploy-server` 잡, [apps/server/src/ops.ts](../../apps/server/src/ops.ts)의 `releaseCheckout`·`runPreflight`, [apps/server/src/preflight.ts](../../apps/server/src/preflight.ts)

**`main`에 푸시하면 곧바로 운영에 배포된다.** `main`에 직접 푸시하지 않는다. 모든 변경은 브랜치 → PR → CI 통과 → 머지로 들어간다.

## 1. 배포 흐름 한눈에 보기

1. `main`에 커밋이 들어온다(PR 머지).
2. GitHub Actions `core-and-server` 잡이 `bun run typecheck`와 `bun test`를 돌린다.
3. 통과하면 `deploy-server` 잡이 시작된다. 배포는 `production-deploy` 동시성 그룹으로 한 번에 하나씩만 돈다.
   - 이번 푸시가 서버 경로(`apps/server/`, `packages/`, `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`)를 건드리지 않았으면 배포를 건너뛴다. `workflow_dispatch`로 실행하면 항상 배포한다.
   - P0 워커가 들어오면 `apps/worker/`도 이 필터에 추가해야 한다.
4. CI가 `POST https://lectern.qucord.com/api/cd/deploy`를 보낸다. 헤더는 `X-Lectern-Deploy-Token`(GitHub 시크릿 `LECTERN_DEPLOY_TOKEN`)과 `X-Lectern-Deploy-Sha`(테스트한 커밋 SHA)다.
5. 서버가 `LECTERN_REPO_DIR`(운영: `/home/eunhhu/work/lectern`) 체크아웃에서 다음을 한다.
   1. `git fetch origin main`. 이 SHA가 `origin/main`에 없으면 거부한다.
   2. 이미 배포된 SHA이면 `already-deployed`, 지금 것보다 오래된 SHA이면 `superseded`로 답하고 아무것도 하지 않는다. **체크아웃은 뒤로 가지 않는다.**
   3. `git reset --hard <sha>`
   4. 의존성 파일(`bun.lock`, `package.json`, `apps/server/package.json`, `packages/core/package.json`)이 바뀌었으면 `bun install --frozen-lockfile`. 다른 워크스페이스 패키지의 의존성이 바뀌어도 `bun.lock`이 함께 바뀌므로 여기서 잡힌다.
   5. 사전 점검: 운영 DB를 `VACUUM INTO`로 임시 디렉터리에 복사하고, 새 코드(`apps/server/src/preflight.ts`)를 그 사본과 임시 경로로 띄운다. 새 릴리스의 마이그레이션이 **실제 데이터 사본에 먼저 적용**되고, `/api/health`, `/`, `/admin`, `/s/…`(404), `/api/lectures`(401), `/assets/*` 응답을 확인한다. 설정 값이 잘못돼도(`packages/config` 검증 실패) 여기서 걸린다.
   6. 3~5 중 하나라도 실패하면 이전 커밋으로 `reset --hard`하고(필요하면 의존성도 다시 설치) 실패를 응답한다. **운영 서버는 재시작되지 않는다.**
   7. 성공하면 감사 로그에 `ops.deploy`를 남기고 응답한 뒤, 우아한 종료를 시작한다. 실행 중인 작업에 `LECTERN_SHUTDOWN_GRACE_SEC`(기본 20초)를 주고, SSE를 닫고, 종료 코드 0으로 끝난다.
6. systemd(`Restart=always`, `RestartSec=1`)가 새 코드로 서버를 다시 띄운다. 부팅할 때 대기 중인 마이그레이션이 있으면 적용 직전에 `DATA_DIR/backups/pre-migrate-YYYYMMDD-HHMMSS.sqlite`를 뜬다(최신 3개 보관). 실행 중이던 작업은 종료할 때 영속 큐(`job` 테이블)로 돌아가고, 새 프로세스가 다시 실행한다. 강제 종료(`kill -9`, 정전)면 lease가 만료된 뒤 회수돼 다시 실행된다.
   - `LECTERN_WORKER_MODE=embedded`(기본)이면 API 프로세스가 작업도 실행한다. `lectern-worker.service`를 설치하고 `external`로 바꾸면 워커 프로세스만 작업을 실행한다([host-setup.md §6](host-setup.md#6-워커-유닛-설치-p0-워커가-들어온-뒤)).
7. CI가 `/api/health`의 `gitSha`가 이 SHA(또는 이 SHA를 포함하는 더 새 커밋)가 될 때까지 최대 약 90초 기다린다.

## 2. 일반 배포

### 2.1 머지 전

```bash
bun install
```
```bash
bun run typecheck
```
```bash
bun test
```

- 테스트는 `bunfig.toml`의 preload([apps/server/test/preload.ts](../../apps/server/test/preload.ts))로 임시 디렉터리에서 돈다. 운영 DB나 키를 건드리지 않는다.
- 스키마를 바꾸는 변경이면 머지 직전에 수동 백업을 하나 뜬다([backup-restore.md §2](backup-restore.md#2-수동-백업)).

### 2.2 머지와 관찰

1. PR을 `main`에 머지한다.
2. 실행을 지켜본다.
   ```bash
   gh run list --workflow ci-cd.yml --branch main --limit 3
   ```
   ```bash
   gh run watch "$(gh run list --workflow ci-cd.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')"
   ```
3. `deploy-server` 잡의 "Release this commit on the server" 단계에 `CD response (200): {...}`가 찍힌다. 응답 해석은 [§4](#4-cd-응답-해석)를 본다.

### 2.3 검증

```bash
curl -fsS https://lectern.qucord.com/api/health | jq '{status, gitSha, uptimeSec, checks}'
```
```bash
git fetch origin main && git rev-parse origin/main
```

- `gitSha`가 머지한 커밋과 같고, `status`가 `ok`, `checks.database`가 `ok`이며, `uptimeSec`가 작아야(방금 재시작) 성공이다.
- `checks.worker`는 `"embedded"`(API가 작업 실행) 또는 `"ok"`(외부 워커가 1분 안에 하트비트를 보냄)여야 한다. `"missing"`이면 [incident-response.md §3.7](incident-response.md#37-작업이-처리-중에서-멈춤).
- 관리자 콘솔(`/admin`) 감사 로그에 `ops.deploy  <이전 7자리> → <새 7자리>`가 있다.
- 호스트에서 확인하려면:
  ```bash
  journalctl -u lectern --since "10 min ago" -o cat --no-pager | grep -E '"msg":"(shutting down|server listening)"'
  ```
  로그는 JSON 한 줄 형식이다. `"msg":"shutting down","reason":"deploy"` 다음에 `"msg":"server listening"`과 `"sha":"<새 7자리>"`가 보여야 한다.
- (외부 워커를 쓰는 경우) 배포는 API만 재시작한다. 워커는 15초마다 API가 기록한 릴리스를 확인하고, 더 새 릴리스면 실행 중인 작업을 마치거나 큐로 돌려준 뒤 종료하며, systemd가 새 코드로 다시 띄운다. 배포 후 1~2분 안에 워커도 새 SHA로 떠야 한다.
  ```bash
  journalctl -u lectern-worker --since "10 min ago" -o cat --no-pager | grep -E '"msg":"lectern-worker (shutting down|started)"'
  ```
  `"msg":"lectern-worker started"`의 `sha`가 새 7자리와 같아야 한다. 관리자 콘솔 운영 보기의 워커 목록에서도 SHA를 볼 수 있다.

## 3. 수동 배포 트리거

CI가 배포를 건너뛰었거나(경로 필터) 네트워크 문제로 실패했을 때 쓴다.

**권장: 워크플로를 다시 실행한다.** `workflow_dispatch`는 경로 필터 없이 `main`의 최신 커밋을 테스트하고 배포한다.

```bash
gh workflow run ci-cd.yml --ref main
```

**비상용: 웹훅을 직접 호출한다.** 토큰을 셸 기록에 남기지 않도록 파일에서 읽는다. 배포할 SHA는 반드시 `origin/main`에 있는 커밋이어야 한다.

```bash
SHA=$(git rev-parse origin/main)
curl -sS --max-time 300 -X POST https://lectern.qucord.com/api/cd/deploy \
  -H "X-Lectern-Deploy-Token: $(cat ~/.config/lectern/deploy-token)" \
  -H "X-Lectern-Deploy-Sha: ${SHA}" | jq
```

검증은 [§2.3](#23-검증)과 같다.

## 4. CD 응답 해석

| HTTP | 본문 | 뜻 | 할 일 |
|---|---|---|---|
| 200 | `ok: true, note: "deployed", restarting: true` | 배포 성공, 재시작 중 | §2.3 검증 |
| 200 | `note: "already-deployed"` | 이미 이 SHA가 돌고 있음 | 없음 |
| 200 | `note: "superseded"` | 더 새 커밋이 이미 돌고 있음 | 없음 |
| 401 | `Unauthorized CD request` | 서버의 `LECTERN_DEPLOY_TOKEN`이 비었거나 GitHub 시크릿과 다름 | [secret-rotation.md §2](secret-rotation.md#2-배포-토큰-lectern_deploy_token) |
| 409 | `다른 배포가 진행 중입니다.` | 배포가 겹침 | 앞 배포가 끝난 뒤 다시 실행 |
| 500 | `ok: false, rolledBack: true` | 설치나 사전 점검 실패. 체크아웃은 이전 커밋으로 복구됐고 서버는 그대로 | `error`와 `steps`를 읽고 고친 PR을 머지 |
| 500 | `ok: false, rolledBack: false` | 복구에도 실패. 체크아웃이 어중간한 상태일 수 있음 | **즉시 [§5.3](#53-비상-호스트에서-직접-되돌리기)**. 서버는 아직 옛 코드로 돌지만, 다음 재시작 때 깨진 체크아웃으로 뜰 수 있다 |
| 500 | `origin/main에 없는 커밋은 배포하지 않습니다.` | SHA가 main에 없음 | SHA 확인 |
| 500 | `배포 대상 체크아웃(LECTERN_REPO_DIR)이 설정되지 않았습니다.` | 환경 변수 누락 | [host-setup.md](host-setup.md) |

사전 점검 실패 원인을 호스트에서 재현하려면 같은 조건으로 직접 돌린다. 운영 DB 사본을 쓰므로 마이그레이션 리허설도 같이 된다. 사본에는 개인정보가 들어 있으니 끝나면 반드시 지운다.

```bash
cd /home/eunhhu/work/lectern
SANDBOX=$(mktemp -d) && mkdir -p "$SANDBOX"/{data,lectures,home}
/home/eunhhu/.bun/bin/bun -e "import { Database } from 'bun:sqlite'; new Database('/home/eunhhu/work/lectern/data/lectern.sqlite').exec(\"VACUUM INTO '$SANDBOX/data/lectern.sqlite'\")"
LECTERN_PREFLIGHT=1 LECTERN_DATA_DIR="$SANDBOX/data" LECTERN_LECTURES_DIR="$SANDBOX/lectures" \
  HOME="$SANDBOX/home" LECTERN_RESEND_CREDENTIALS_FILE="$SANDBOX/none.json" LECTERN_LOG_REQUESTS=0 \
  GEMINI_API_KEY= RESEND_API_KEY= LECTERN_DEPLOY_TOKEN= \
  bun run apps/server/src/preflight.ts; echo "exit=$?"; rm -rf "$SANDBOX"
```

`Preflight passed (N checks).`와 `exit=0`이면 통과다.

## 5. 롤백

### 5.1 자동 롤백 (설치·사전 점검 실패)

할 일이 없다. 서버는 재시작되지 않았고 체크아웃은 이전 커밋으로 돌아갔다. 확인만 한다.

```bash
curl -fsS https://lectern.qucord.com/api/health | jq -r .gitSha
```

이전 SHA가 나오면 정상이다.

### 5.2 이미 배포된 릴리스가 문제일 때 (권장: 되돌리는 커밋)

사전 점검은 통과했지만 운영에서 버그가 드러난 경우다. **웹훅으로 이전 SHA를 다시 배포할 수는 없다.** 체크아웃은 뒤로 가지 않으므로 `superseded`가 돌아온다. 되돌리는 커밋을 앞으로 배포한다.

1. 브랜치를 만들고 문제 커밋을 되돌린다.
   ```bash
   git fetch origin && git switch -c revert/<짧은-설명> origin/main
   ```
   ```bash
   git revert --no-edit <문제-SHA>
   ```
   머지 커밋이면 `git revert -m 1 <머지-SHA>`를 쓴다.
2. 로컬 검사 후 PR을 만들고 머지한다.
   ```bash
   bun run typecheck && bun test
   ```
   ```bash
   git push -u origin HEAD && gh pr create --fill --base main
   ```
3. 배포를 관찰하고 [§2.3](#23-검증)으로 검증한다.

### 5.3 비상: 호스트에서 직접 되돌리기

CI를 기다릴 수 없을 때(서비스가 죽었거나 데이터를 망가뜨리고 있을 때) 쓴다.

1. 호스트에 접속해 마지막으로 정상이던 SHA를 찾는다. 감사 로그의 `ops.deploy` 항목이나 다음 명령으로 찾는다.
   ```bash
   cd /home/eunhhu/work/lectern && git log --oneline -10
   ```
2. 체크아웃을 그 SHA로 돌리고 의존성을 맞춘다.
   ```bash
   cd /home/eunhhu/work/lectern && git fetch origin && git reset --hard <정상-SHA>
   ```
   ```bash
   cd /home/eunhhu/work/lectern && /home/eunhhu/.bun/bin/bun install --frozen-lockfile
   ```
3. 서버(워커가 있으면 워커도)를 재시작한다.
   ```bash
   sudo systemctl restart lectern
   ```
   ```bash
   sudo systemctl restart lectern-worker   # 외부 워커를 쓰는 경우
   ```
   워커는 API의 릴리스가 바뀐 것을 보고 스스로 재시작하지만, 직접 재시작하면 기다릴 필요가 없다.
4. 검증한다.
   ```bash
   curl -fsS http://127.0.0.1:18775/api/health | jq '{status, gitSha}'
   ```
   ```bash
   curl -fsS https://lectern.qucord.com/api/health | jq '{status, gitSha}'
   ```
5. **곧바로 [§5.2](#52-이미-배포된-릴리스가-문제일-때-권장-되돌리는-커밋)의 되돌리는 커밋을 `main`에 넣는다.** 그 전까지 주의할 점:
   - 실패한 워크플로를 "Re-run"하지 않는다. 문제 SHA는 지금 돌고 있는 정상 SHA의 조상이 아니므로, 웹훅이 문제 SHA를 다시 배포한다.
   - 되돌리는 커밋보다 먼저 다른 PR을 머지하지 않는다. 그 커밋은 문제 커밋을 포함하므로 문제 코드가 다시 나간다.

### 5.4 데이터베이스도 되돌려야 할 때

- 스키마는 `packages/db/migrations`의 버전 관리되는 SQL 마이그레이션(Drizzle)으로 바뀐다. 마이그레이션은 앞으로만 적용되고 되돌리는 SQL은 없다.
- **추가만 하는 마이그레이션**(새 테이블, 새 컬럼)이면 옛 코드가 그대로 읽을 수 있으므로 코드만 되돌리면 된다. DB는 그대로 둔다.
- 옛 코드가 읽지 못하는 마이그레이션이 적용됐거나 잘못된 릴리스가 데이터를 망가뜨렸다면 백업을 복원한다([backup-restore.md §3](backup-restore.md#3-데이터베이스-복원)).
  - 1순위는 문제 릴리스가 부팅하면서 뜬 `DATA_DIR/backups/pre-migrate-YYYYMMDD-HHMMSS.sqlite`다. 시각이 배포 시각과 맞는지 확인한다.
  - 복원하면 그 백업 이후 생긴 데이터를 잃는다. 순서는 "코드 되돌리기(§5.3) → 서버 정지 → DB 복원 → 서버 시작"이다. 새 코드가 다시 뜨면 마이그레이션이 다시 적용되므로 순서를 바꾸지 않는다.

## 6. 하지 말 것

- `main`에 직접 푸시하지 않는다.
- 운영 체크아웃(`/home/eunhhu/work/lectern`)에서 파일을 직접 고치지 않는다. 다음 배포의 `git reset --hard`가 지운다.
- 운영 체크아웃에서 `git clean -fdx`를 하지 않는다. 현재 `DATA_DIR`(`data/`)이 체크아웃 안에 있어서 DB, 업로드, 백업이 모두 지워진다.
- 배포 토큰을 명령줄 인자나 채팅에 붙여 넣지 않는다.
