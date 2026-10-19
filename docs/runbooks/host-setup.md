# 런북: 호스트 구성과 재현

> 대상: Raspberry Pi 5 (aarch64), 서비스 사용자 `eunhhu`, 체크아웃 `/home/eunhhu/work/lectern`
> 템플릿: [deploy/systemd/lectern.service](../../deploy/systemd/lectern.service), [deploy/systemd/lectern-worker.service](../../deploy/systemd/lectern-worker.service), [deploy/systemd/lectern.env.example](../../deploy/systemd/lectern.env.example)
> 관련 결정: [ADR-0003](../adr/0003-single-node-pi-hosting.md)(단일 노드), [ADR-0007](../adr/0007-api-worker-process-split.md)(API·워커 분리)

이 런북은 두 가지 경우에 쓴다.
- **기존 호스트**: 호스트에만 있던 유닛 파일을 저장소 템플릿과 `EnvironmentFile`로 옮긴다(§1 → §3 → §4 → §5).
- **새 호스트**: 처음부터 다시 만든다(§2 → §4 → §5 → §7).

모든 단계는 끝에 검증이 있다. 검증이 실패하면 다음 단계로 가지 않는다.

## 1. 현재 상태 기록 (기존 호스트, 아무것도 바꾸기 전에)

1. 기록용 디렉터리를 만든다. 유닛 파일에 시크릿이 들어 있을 수 있으니 권한을 700으로 둔다.
   ```bash
   install -d -m 700 ~/lectern-host-snapshot
   ```
2. 실제 유닛 파일 경로와 drop-in을 확인하고 복사한다.
   ```bash
   systemctl show -p FragmentPath -p DropInPaths lectern
   ```
   ```bash
   sudo cp "$(systemctl show -P FragmentPath lectern)" ~/lectern-host-snapshot/lectern.service.bak && sudo chown eunhhu: ~/lectern-host-snapshot/lectern.service.bak && chmod 600 ~/lectern-host-snapshot/lectern.service.bak
   ```
   ```bash
   systemctl cat lectern > ~/lectern-host-snapshot/lectern.systemctl-cat.txt && chmod 600 ~/lectern-host-snapshot/lectern.systemctl-cat.txt
   ```
3. 런타임과 체크아웃 상태를 적어 둔다.
   ```bash
   { /home/eunhhu/.bun/bin/bun --version; git -C /home/eunhhu/work/lectern rev-parse HEAD; git -C /home/eunhhu/work/lectern status --short | head; df -h /home/eunhhu; ffmpeg -version | head -1; } | tee ~/lectern-host-snapshot/runtime.txt
   ```
   - Bun은 CI와 같은 `1.4.3`이어야 한다.
   - `git status`에 수정된 추적 파일이 있으면 안 된다(다음 배포의 `git reset --hard`가 지운다).
4. **프록시 확인.** 서버는 `127.0.0.1:18775`에만 바인딩한다. 그 앞에 무엇이 있는지 확인해 기록한다.
   ```bash
   sudo ss -ltnp | grep -E ':(80|443|18775)\b'
   ```
   ```bash
   systemctl list-units --type=service --no-pager | grep -Ei 'nginx|caddy|cloudflared|traefik|haproxy'
   ```
   `X-Forwarded-For`에 주소를 붙이는 프록시 수를 센다. 셈이 애매하면 실제 헤더를 본다. 휴대폰 LTE처럼 다른 네트워크에서 `https://lectern.qucord.com/api/health`를 여는 동안 호스트에서 잠깐만 캡처한다. 이 캡처에는 쿠키가 평문으로 보이므로 파일로 저장하지 않고 확인 즉시 끈다.
   ```bash
   sudo timeout 30 tcpdump -A -s 0 -i lo 'tcp dst port 18775' 2>/dev/null | grep -i '^x-forwarded-for'
   ```
   보이는 값이 `<내 공인 IP>, A, B`라면 내 IP 오른쪽 항목 수 + 1이 `LECTERN_TRUSTED_PROXY_HOPS`다. 예를 들어 `<내 IP>, <Cloudflare 엣지>`이면 2다. 헤더가 아예 없으면 프록시가 XFF를 붙이지 않는 것이다. 이때는 IP별 rate limit이 꺼지고 이메일별 제한만 남는다(서버가 한 번 경고를 남긴다). 프록시 설정에서 XFF를 켜는 것을 검토한다.

검증: `~/lectern-host-snapshot/`에 `lectern.service.bak`, `lectern.systemctl-cat.txt`, `runtime.txt`가 있고 프록시 체인과 홉 수를 적어 두었다.

## 2. 새 호스트 준비

1. 패키지를 설치한다.
   ```bash
   sudo apt-get update && sudo apt-get install -y git ffmpeg jq curl rsync
   ```
2. 서비스 사용자로 Bun `1.4.3`을 설치한다(CI와 운영이 같은 버전이어야 한다).
   ```bash
   curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3"
   ```
   ```bash
   /home/eunhhu/.bun/bin/bun --version
   ```
3. 체크아웃을 만들고 의존성을 설치한다.
   ```bash
   mkdir -p /home/eunhhu/work && git clone https://github.com/eunhhu/lectern.git /home/eunhhu/work/lectern
   ```
   ```bash
   cd /home/eunhhu/work/lectern && /home/eunhhu/.bun/bin/bun install --frozen-lockfile
   ```
4. 기존 데이터를 옮기는 경우 오프호스트 사본에서 복원한다([backup-restore.md §5](backup-restore.md#5-오프호스트-복사-재해-복구)). 운영자 컴퓨터에서 실행한다.
   ```bash
   rsync -av ~/lectern-offhost/uploads/ <새-pi>:/home/eunhhu/work/lectern/data/uploads/
   ```
   ```bash
   scp ~/lectern-offhost/backups/<최신>.sqlite <새-pi>:/home/eunhhu/work/lectern/data/lectern.sqlite
   ```
   오너 강의 아카이브(`/home/eunhhu/work/lectures`)도 따로 옮긴다. `secret.key`는 옮기지 않아도 된다.
5. 앞단 프록시(Cloudflare Tunnel, nginx 등)를 구성해 `127.0.0.1:18775`로 보내고, §1.4처럼 홉 수를 확인한다. 프록시 구성은 이 저장소에 없다. 구성했으면 이 런북의 "현재 구성" 메모(§8)에 적는다.

검증: `bun --version`이 `1.4.3`, `git -C /home/eunhhu/work/lectern rev-parse HEAD`가 `origin/main`과 같다.

## 3. 저장소 템플릿과 운영 유닛 비교 (기존 호스트)

유닛을 바꾸기 전에 반드시 차이를 본다. 템플릿은 배포된 체크아웃에 있다(이 파일이 `main`에 들어간 뒤).

```bash
diff -u ~/lectern-host-snapshot/lectern.service.bak /home/eunhhu/work/lectern/deploy/systemd/lectern.service
```

차이를 한 줄씩 판단한다.

| 차이 | 처리 |
|---|---|
| 템플릿에 `EnvironmentFile=/etc/lectern/lectern.env`, `TimeoutStopSec=40`, `KillSignal=SIGTERM`이 추가됨 | 의도한 변경이다. 유지한다 |
| 운영 유닛에 `Environment=KEY=value` 줄이 있음 | **§4에서 모두 환경 파일로 옮긴다.** 옮기지 않은 채 템플릿으로 바꾸면 그 값이 사라진다 |
| 운영 유닛에 템플릿에 없는 다른 지시어(`LimitNOFILE=`, `Nice=`, `After=` 대상 등) | 이유를 확인한다. 필요하면 템플릿 쪽에 넣는 PR을 만들고, 그 PR이 머지될 때까지 §5를 미룬다 |
| `ExecStart`, `User`, `WorkingDirectory`, `Restart`, `RestartSec`가 다름 | 템플릿과 운영 중 어느 쪽이 맞는지 확인한다. 템플릿은 `bun run /home/eunhhu/work/lectern/apps/server/src/index.ts`, `Restart=always`, `RestartSec=1`이다 |
| drop-in(`*.service.d/*.conf`)이 있음 | 내용을 템플릿이나 환경 파일로 옮기고, §5에서 drop-in을 지운다 |

검증: 남은 차이가 모두 "유지" 또는 "옮김"으로 분류됐다.

## 4. 환경 파일 만들기

1. 디렉터리와 파일을 만든다. 파일은 root 소유, 권한 600이다(systemd가 root로 읽은 뒤 `eunhhu`로 권한을 낮춘다).
   ```bash
   sudo install -d -m 0755 /etc/lectern
   ```
   ```bash
   sudo install -m 0600 -o root -g root /home/eunhhu/work/lectern/deploy/systemd/lectern.env.example /etc/lectern/lectern.env
   ```
2. 값을 채운다.
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
   - 운영 유닛의 `Environment=` 값(§3)을 모두 옮긴다.
   - `LECTERN_REPO_DIR`, `LECTERN_DATA_DIR`, `LECTERN_LECTURES_DIR`는 템플릿 값 그대로 **명시한다.** 코드 기본값(`<repo>/lectures`)은 운영 아카이브 위치(`/home/eunhhu/work/lectures`)와 다르다.
   - `LECTERN_TRUSTED_PROXY_HOPS`에 §1.4에서 센 값을 넣는다.
   - `GEMINI_API_KEY`: 지금 서비스 사용자의 `~/local.env`에서 읽고 있다면 그 값을 옮긴다. 옮긴 뒤 [secret-rotation.md §4](secret-rotation.md#4-gemini-api-키) 5번으로 파일 사본을 지운다.
   - `RESEND_API_KEY`: 지금 대체 자격 증명 파일에서 읽고 있다면 그 값을 옮긴다.
   - `LECTERN_DEPLOY_TOKEN`: 운영 유닛에 있던 값을 옮긴다. 새로 만들면 GitHub 시크릿도 함께 바꾼다([secret-rotation.md §2](secret-rotation.md#2-배포-토큰-lectern_deploy_token)).
   - `LECTERN_OWNER_EMAIL`을 넣는다면 지금 오너 계정의 로그인 이메일과 정확히 같아야 한다. `LECTERN_OWNER_PASSWORD`는 비워 둔다(새 호스트의 첫 부팅만 예외. §7 참고).
   - `LECTERN_WORKER_MODE=embedded`로 둔다. 워커 유닛은 §6에서 따로 켠다.
3. 서비스와 같은 조건으로 설정 검증을 돌린다. `packages/config`가 배포된 체크아웃에서만 동작한다.
   ```bash
   sudo systemd-run --wait --pipe --quiet -p User=eunhhu -p EnvironmentFile=/etc/lectern/lectern.env -p WorkingDirectory=/home/eunhhu/work/lectern /home/eunhhu/.bun/bin/bun -e "import { loadConfig } from './packages/config/src/index.ts'; const c = loadConfig(); console.log('config ok', c.dataDir, c.lecturesDir, c.repoDir, c.workerMode, c.trustedProxyHops)"
   ```

검증: `config ok /home/eunhhu/work/lectern/data /home/eunhhu/work/lectures /home/eunhhu/work/lectern embedded <홉 수>`가 출력되고, `sudo stat -c '%a %U' /etc/lectern/lectern.env`가 `600 root`다. `Invalid environment:`가 나오면 표시된 변수를 고친다.

## 5. API 유닛 설치

1. 긴 작업이 돌고 있지 않은지 관리자 콘솔 작업 보기에서 확인한다.
2. 유닛을 설치하고 문법을 검사한다.
   ```bash
   sudo install -m 0644 /home/eunhhu/work/lectern/deploy/systemd/lectern.service /etc/systemd/system/lectern.service
   ```
   ```bash
   sudo systemd-analyze verify /etc/systemd/system/lectern.service
   ```
   §3에서 옮긴 drop-in이 있으면 지운다(`sudo rm /etc/systemd/system/lectern.service.d/<파일>.conf`).
3. 다시 읽고 재시작한다.
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable lectern && sudo systemctl restart lectern
   ```
4. 검증한다.
   ```bash
   systemctl show lectern -p ActiveState -p EnvironmentFiles -p TimeoutStopUSec -p Restart
   ```
   ```bash
   curl -fsS http://127.0.0.1:18775/api/health | jq '{status, gitSha, checks}'
   ```
   ```bash
   curl -fsS https://lectern.qucord.com/api/health | jq '{status, gitSha}'
   ```
   ```bash
   journalctl -u lectern --since "5 min ago" -o cat --no-pager | tail -30
   ```
   - `ActiveState=active`, `EnvironmentFiles=/etc/lectern/lectern.env`, `TimeoutStopUSec=40s`, `Restart=always`
   - health가 `ok`이고, 웹 로그인과 강의 목록이 된다.
   - 로그에 `server listening`(JSON 한 줄, `sha`와 `worker_mode` 포함)이 있고 `Invalid environment` 같은 오류가 없다.
   - CD가 새 환경 파일로도 동작하는지 확인한다: `gh workflow run ci-cd.yml --ref main` → `already-deployed` 200.
5. 문제가 생기면 되돌린다.
   ```bash
   sudo cp ~/lectern-host-snapshot/lectern.service.bak /etc/systemd/system/lectern.service && sudo systemctl daemon-reload && sudo systemctl restart lectern
   ```
6. 일주일 동안 문제가 없으면 시크릿이 들어 있는 스냅샷을 지운다.
   ```bash
   rm -rf ~/lectern-host-snapshot
   ```

## 6. 워커 유닛 설치 (P0 워커가 들어온 뒤)

`apps/worker/src/index.ts`가 `main`으로 배포된 뒤에만 이 절을 한다. 없는 파일을 가리키는 유닛은 재시작을 무한히 반복한다. 워커는 `LECTERN_WORKER_MODE=external`이 아니면 바로 종료(상태 2)하므로, **모드를 먼저 바꾸고 워커를 켠다.** 그 사이 몇 초 동안 새 작업은 영속 큐에서 기다릴 뿐 사라지지 않는다.

1. 진입점이 배포됐는지 확인한다.
   ```bash
   test -f /home/eunhhu/work/lectern/apps/worker/src/index.ts && echo present
   ```
2. CI의 배포 경로 필터(`.github/workflows/ci-cd.yml`의 `deploy-server`)에 `apps/worker/`가 들어 있는지 확인한다. 없으면 워커만 바꾼 커밋이 배포되지 않는다.
   ```bash
   grep -n "apps/worker" /home/eunhhu/work/lectern/.github/workflows/ci-cd.yml
   ```
3. 유닛을 설치만 하고 아직 켜지 않는다.
   ```bash
   sudo install -m 0644 /home/eunhhu/work/lectern/deploy/systemd/lectern-worker.service /etc/systemd/system/lectern-worker.service
   ```
   ```bash
   sudo systemd-analyze verify /etc/systemd/system/lectern-worker.service && sudo systemctl daemon-reload
   ```
4. 관리자 콘솔 작업 보기에서 긴 작업이 없을 때, 환경 파일에서 `LECTERN_WORKER_MODE=external`로 바꾼다.
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
5. API를 재시작해 작업 실행을 멈추게 하고, 곧바로 워커를 켠다. API 로그에 "no lectern-worker heartbeat yet" 경고가 잠깐 보이는 것은 정상이다.
   ```bash
   sudo systemctl restart lectern && sudo systemctl enable --now lectern-worker
   ```
6. 검증한다.
   ```bash
   curl -fsS http://127.0.0.1:18775/api/health | jq '{status, gitSha, worker: .checks.worker}'
   ```
   ```bash
   journalctl -u lectern-worker --since "5 min ago" -o cat --no-pager | tail -20
   ```
   - 1분 안에 `checks.worker`가 `"ok"`가 된다(`"missing"`이면 워커 하트비트가 없다는 뜻이다).
   - 워커 로그에 `lectern-worker started`와 지금 배포된 SHA가 보인다. 관리자 콘솔 운영 보기의 워커 목록에도 나온다.
   - 짧은 테스트 녹음을 올리면 워커 로그에 작업이 나타나고 노트가 완성된다.
   - 재개 확인(선택): 처리 중에 워커를 강제로 죽인다. systemd가 다시 띄우고, lease가 만료된 뒤(기본 60초) 작업이 이어서 처리된다.
     ```bash
     sudo systemctl kill -s KILL lectern-worker
     ```
7. 배포할 때는 API만 재시작된다. 워커는 15초마다 API가 기록한 릴리스를 확인하고, 더 새 릴리스면 작업을 넘긴 뒤 종료해 systemd가 새 코드로 다시 띄운다. 매 배포 뒤 [deploy-and-rollback.md §2.3](deploy-and-rollback.md#23-검증)대로 워커의 SHA를 확인한다.

되돌리기: 환경 파일을 `LECTERN_WORKER_MODE=embedded`로 바꾸고 다음을 실행한다.
```bash
sudo systemctl disable --now lectern-worker && sudo systemctl restart lectern
```
검증: `checks.worker`가 `"embedded"`.

## 7. 새 호스트의 첫 부팅

1. 빈 DB로 시작한다면 오너 계정이 처음 만들어진다. 환경 파일에 `LECTERN_OWNER_EMAIL`(오너 로그인 이메일)과 강한 `LECTERN_OWNER_PASSWORD`를 넣고 시작한다. 비밀번호가 비어 있으면 무작위 비밀번호로 만들어지고, 이메일 재설정으로 로그인해야 한다.
2. §5대로 API 유닛을 설치하고 시작한다.
3. 로그인한 뒤 웹에서 비밀번호를 한 번 바꾸고, 환경 파일의 `LECTERN_OWNER_PASSWORD=`를 비운 뒤 재시작한다.
4. 유지보수가 첫 백업을 뜨는지 확인한다(부팅 2분 뒤).
   ```bash
   ls -l /home/eunhhu/work/lectern/data/backups/
   ```
5. GitHub 시크릿 `LECTERN_DEPLOY_TOKEN`이 새 호스트 값과 같은지 확인하고, `gh workflow run ci-cd.yml --ref main`으로 CD를 확인한다.
6. DNS나 터널이 새 호스트를 가리키게 바꾸고 `https://lectern.qucord.com/api/health`의 `gitSha`를 확인한다.

## 8. 물어보기 켜기와 끄기 (`LECTERN_ASK`)

물어보기([ADR-0009](../adr/0009-ask-rag.md), [ARCHITECTURE §12.4](../v2/ARCHITECTURE.md#124-v1-브리지p2-전까지))는 기본으로 꺼져 있다. 켜면 Gemini 비용이 든다.

- **켜기 전**
  - 처음 백필 비용을 가늠한다. 완료된 강의 Markdown 전체가 한 번 임베딩된다(`gemini-embedding-2`, 1M 토큰당 $0.20, 대략 강의 한 시간 분량에 $0.003).
    ```bash
    sqlite3 "$LECTERN_DATA_DIR/lectern.sqlite" "SELECT COUNT(*), SUM(LENGTH(markdown)) FROM lectures WHERE status = 'done'"
    ```
    글자 수 × 0.65 ≈ 토큰 수다. 강의 수백 개면 보통 $1 안쪽이다.
  - `GEMINI_API_KEY`가 유료 계층 키인지 확인한다.
  - [개인정보처리방침](../../apps/server/static/legal/privacy.html)에 물어보기와 검색 색인 내용이 들어간 버전이 공고됐는지 확인한다(수집 항목이 늘어나는 변경은 30일 전 공고).
- **켜기**
  - 환경 파일에 `LECTERN_ASK=1`을 넣는다. 한도를 바꾸려면 `LECTERN_ASK_MONTHLY_LIMIT_MICROUSD`(기본 2000000 = $2/워크스페이스/월)도 넣는다.
  - API를 재시작하고, 외부 워커를 쓰면 워커도 재시작한다.
  - 첫 유지보수(부팅 2분 뒤)가 백필 `index` 작업을 큐에 넣는다. 진행은 관리자 작업 목록이나 다음 질의로 본다.
    ```bash
    sqlite3 "$LECTERN_DATA_DIR/lectern.sqlite" "SELECT state, COUNT(*) FROM job WHERE kind = 'index' GROUP BY state"
    ```
- **비용 확인**
    ```bash
    sqlite3 "$LECTERN_DATA_DIR/lectern.sqlite" "SELECT model, COUNT(*), SUM(cost_microusd) FROM ai_call WHERE model IN ('gemini-embedding-2', 'gemini-3.5-flash-lite') GROUP BY model"
    ```
- **끄기**
  - `LECTERN_ASK=0`으로 바꾸고 재시작한다. 라우트는 501로 답하고 새 색인 작업은 생기지 않는다.
  - 색인과 대화 기록은 남는다. 강의나 계정을 지우면 그 색인과 대화도 지워진다.

## 9. 운영 수칙과 현재 구성 메모

- 운영 체크아웃에서 `git clean -fdx`를 하지 않는다. `DATA_DIR`(`data/`)이 체크아웃 안에 있어 DB, 업로드, 백업, `secret.key`가 모두 지워진다. 장기적으로는 `DATA_DIR`을 체크아웃 밖(예: `/var/lib/lectern`)으로 옮기는 것을 검토한다.
- 운영 체크아웃의 추적 파일을 손으로 고치지 않는다.
- journald 용량을 확인한다. 기본 설정이면 디스크의 일정 비율까지 쓴다.
  ```bash
  journalctl --disk-usage
  ```
- 현재 구성 메모(호스트에서 확인한 값을 여기 적는다. 시크릿은 적지 않는다)
  - 앞단 프록시 체인: _(§1.4 결과)_
  - `LECTERN_TRUSTED_PROXY_HOPS`: _(값)_
  - 마지막 호스트 점검일: _(YYYY-MM-DD)_
