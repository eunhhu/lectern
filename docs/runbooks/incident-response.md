# 런북: 장애 대응

> 운영: `lectern.qucord.com` → Cloudflare → (호스트의 앞단 프록시) → `127.0.0.1:18775` (`lectern.service`, P0 이후 `lectern-worker.service`)
> 관련: [deploy-and-rollback.md](deploy-and-rollback.md), [backup-restore.md](backup-restore.md), [secret-rotation.md](secret-rotation.md), [host-setup.md](host-setup.md)

원칙
1. **먼저 피해를 멈춘다.** 원인 분석은 서비스를 되살리거나 데이터 손상을 멈춘 뒤에 한다.
2. 무엇을 했는지 시각과 함께 바로 적는다(§6 기록 양식). 기억에 의존하지 않는다.
3. 데이터를 지우는 조치(휴지통 비우기, 백업 삭제, `git clean`)는 마지막 수단이다. 하기 전에 수동 백업을 뜬다.
4. 시크릿, 사용자 개인정보, 녹음 내용을 공개 채널(이슈, PR, 채팅)에 붙이지 않는다.

## 1. 심각도

| 등급 | 기준 | 목표 |
|---|---|---|
| SEV1 | 서비스 전체 불가, 데이터 손실·손상 진행 중, 보안 사고·개인정보 유출 의심 | 즉시 대응, 1시간 안에 복구 또는 차단 |
| SEV2 | 핵심 기능 장애: 업로드 불가, AI 처리 전부 실패, 로그인·메일 불가 | 당일 복구 |
| SEV3 | 일부 기능·일부 사용자, 지연, 관리 기능 오류 | 다음 작업일 |

## 2. 첫 5분 점검

1. 밖에서 본 상태
   ```bash
   curl -sS -m 10 -w '\nHTTP %{http_code}\n' https://lectern.qucord.com/api/health
   ```
2. 호스트 안에서 본 상태(호스트에 접속해서)
   ```bash
   curl -sS -m 5 -w '\nHTTP %{http_code}\n' http://127.0.0.1:18775/api/health
   ```
   - 안에서는 `ok`인데 밖에서 실패 → 프록시, 터널, Cloudflare, 회선 문제다(§3.8).
   - 안에서도 실패 → 서버 문제다. 다음으로 간다.
3. 프로세스와 최근 로그
   ```bash
   systemctl status lectern --no-pager
   ```
   ```bash
   systemctl show lectern -p NRestarts -p ActiveEnterTimestamp
   ```
   ```bash
   journalctl -u lectern -n 200 -o cat --no-pager
   ```
   로그는 JSON 한 줄 형식이다. 오류만 보려면:
   ```bash
   journalctl -u lectern --since "1 hour ago" -o cat --no-pager | jq -c 'select(.level == "error" or .level == "warn")'
   ```
   사용자가 받은 오류 응답에 `request_id`가 있으면(응답 헤더 `X-Request-Id`도 같다) 그 요청의 로그를 바로 찾는다.
   ```bash
   journalctl -u lectern --since "1 day ago" -o cat --no-pager | grep '<request_id>'
   ```
   외부 워커를 쓰면 `lectern-worker` 유닛에도 같은 명령을 돌린다.
4. 자원
   ```bash
   df -h /home/eunhhu && free -h && uptime
   ```
   ```bash
   vcgencmd measure_temp; vcgencmd get_throttled
   ```
   `get_throttled`가 `0x0`이 아니면 전원 부족이나 과열로 클럭이 떨어진 것이다.
5. 최근 변경
   ```bash
   gh run list --workflow ci-cd.yml --branch main --limit 5
   ```
   관리자 콘솔 감사 로그에서 최근 `ops.deploy`, `admin.*`, `storage.*` 항목을 본다. **장애 직전에 배포가 있었다면 먼저 롤백을 검토한다**([deploy-and-rollback.md §5](deploy-and-rollback.md#5-롤백)).

## 3. 상황별 대응

### 3.1 서버가 뜨지 않음 (재시작 반복)

`NRestarts`가 계속 오르고 health가 응답하지 않는다.

- 로그에 `Invalid environment:` → 환경 파일 값이 잘못됐다. 표시된 변수를 고치고 재시작한다. 값은 [host-setup.md §4](host-setup.md#4-환경-파일-만들기) 3번 명령으로 검증한다.
  ```bash
  sudoedit /etc/lectern/lectern.env
  ```
  ```bash
  sudo systemctl restart lectern
  ```
- 로그에 마이그레이션 오류 → 새 코드의 마이그레이션이 운영 DB에서 실패했다. 코드를 직전 정상 SHA로 되돌리고([deploy-and-rollback.md §5.3](deploy-and-rollback.md#53-비상-호스트에서-직접-되돌리기)), DB가 반쯤 바뀌었으면 `pre-migrate-*.sqlite`로 복원한다([deploy-and-rollback.md §5.4](deploy-and-rollback.md#54-데이터베이스도-되돌려야-할-때)).
- 로그에 모듈을 찾지 못하는 오류 → 의존성이 맞지 않는다.
  ```bash
  cd /home/eunhhu/work/lectern && /home/eunhhu/.bun/bin/bun install --frozen-lockfile && sudo systemctl restart lectern
  ```
- 그 밖의 코드 오류(배포 직후) → [deploy-and-rollback.md §5.3](deploy-and-rollback.md#53-비상-호스트에서-직접-되돌리기)로 직전 정상 SHA로 되돌린다.

검증: health가 `ok`이고 `NRestarts`가 더 오르지 않는다.

### 3.2 배포 직후 오류 증가

[deploy-and-rollback.md §5.2](deploy-and-rollback.md#52-이미-배포된-릴리스가-문제일-때-권장-되돌리는-커밋)(되돌리는 커밋), 급하면 §5.3(호스트에서 직접). 실패한 워크플로를 "Re-run"하지 않는다.

### 3.3 디스크 부족 (`checks.disk: "low"`)

남은 공간이 2GB 미만이거나 10% 미만이면 `low`다. SQLite는 WAL과 백업(`VACUUM INTO`, DB 크기만큼)에 여유 공간이 필요하다.

1. 무엇이 큰지 본다.
   ```bash
   du -sh /home/eunhhu/work/lectern/data/* /home/eunhhu/work/lectures 2>/dev/null | sort -h
   ```
   ```bash
   journalctl --disk-usage
   ```
2. 지우지 않고 줄이는 것부터 한다.
   - 관리자 콘솔 저장소 보기 → 압축 대기 중인 오디오를 압축한다(mono AAC로 다시 인코딩, 원본보다 15% 이상 작을 때만 교체).
   - journald 로그를 줄인다.
     ```bash
     sudo journalctl --vacuum-size=500M
     ```
3. 그래도 부족하면 지운다(되돌릴 수 없음).
   - `data/backups/manual-*.sqlite` 중 필요 없는 것
   - `data/restore-aside-*` 디렉터리(복원 후 7일이 지난 것)
   - 휴지통(`data/trash/`)을 7일보다 일찍 비우는 것은 마지막 수단이다. 먼저 오프호스트로 복사한다.
4. 장기 대응: 보존 정책 켜기(관리자 설정), 더 큰 디스크, [ADR-0003](../adr/0003-single-node-pi-hosting.md)의 확장 신호(디스크 80%) 검토.

검증: `curl -fsS http://127.0.0.1:18775/api/health | jq .checks.disk`가 `"ok"`.

### 3.4 데이터베이스 오류 (`checks.database: "error"`, 503)

1. 로그에서 `SQLITE_BUSY`(잠김), `SQLITE_CORRUPT`/`malformed`(손상), `SQLITE_FULL`(디스크)을 찾는다.
   ```bash
   journalctl -u lectern -n 500 --no-pager | grep -i sqlite
   ```
2. `SQLITE_FULL` → §3.3.
3. `SQLITE_BUSY`가 반복 → 다른 프로세스가 DB를 오래 잡고 있는지 본다(수동으로 연 `bun -e`나 `sqlite3` 세션 등). 그것을 끝내고, 그래도 계속되면 서버(와 워커)를 재시작한다.
   ```bash
   sudo lsof /home/eunhhu/work/lectern/data/lectern.sqlite
   ```
4. 손상 → 서버를 멈추고 무결성을 확인한 뒤 백업에서 복원한다([backup-restore.md §3](backup-restore.md#3-데이터베이스-복원)). 손상된 파일은 `restore-aside-*`에 보존해 원인 조사에 쓴다.

### 3.5 AI 처리가 대량으로 실패

관리자 콘솔 작업 보기에서 실패 메시지를 묶어 본다.

| 증상 | 원인 | 대응 |
|---|---|---|
| 401/403, "API key not valid" | 키 만료·삭제·제한 | [secret-rotation.md §4](secret-rotation.md#4-gemini-api-키) |
| 429, quota | 할당량 초과 | `LECTERN_MAX_CONCURRENT_JOBS`를 낮추고 재시작. Cloud 콘솔에서 할당량 확인 |
| 5xx, 타임아웃 | Google 쪽 장애 | Google AI Studio 상태 페이지 확인. 일시 오류는 자동 재시도된다. 장애가 끝나면 실패한 강의에서 재시도 |
| 모델을 찾을 수 없음 | 모델 폐기 | `LECTERN_GEMINI_MODEL`을 지원되는 고정 버전으로 바꾸고 재시작. 모델 변경은 평가를 거치는 변경이므로 사후에 PR로 남긴다([ADR-0006](../adr/0006-harness-provider-abstraction-eval-routing.md)) |
| 비정상 과금 | 키 유출, 반복 루프 | 키를 즉시 교체하고 Cloud Billing 예산 알림 확인 |

검증: 짧은 테스트 녹음이 끝까지 처리된다.

### 3.6 메일이 가지 않음 (가입·재설정 인증번호)

1. 로그에서 `RESEND_API_KEY`가 설정되지 않았다는 오류나 Resend 응답 오류를 찾는다.
   ```bash
   journalctl -u lectern -n 500 --no-pager | grep -iE 'resend|email'
   ```
2. Resend 대시보드 → Emails에서 상태(bounced, failed)와 도메인(`qucord.com`) 인증 상태를 본다.
3. 키 문제면 [secret-rotation.md §3](secret-rotation.md#3-resend-api-키).

### 3.7 작업이 "처리 중"에서 멈춤

먼저 작업을 실행할 프로세스가 살아 있는지 본다.
```bash
curl -fsS http://127.0.0.1:18775/api/health | jq .checks.worker
```

- `"missing"`: `LECTERN_WORKER_MODE=external`인데 1분 넘게 워커 하트비트가 없다. 작업은 큐에 쌓이기만 한다.
  ```bash
  systemctl status lectern-worker --no-pager
  ```
  ```bash
  journalctl -u lectern-worker -n 100 -o cat --no-pager
  ```
  - 유닛이 없거나 꺼져 있으면 [host-setup.md §6](host-setup.md#6-워커-유닛-설치-p0-워커가-들어온-뒤)대로 켠다.
  - 종료 상태 2로 계속 재시작하면 워커가 보는 `LECTERN_WORKER_MODE`가 `external`이 아니다. 환경 파일을 확인한다.
  - 급하면 환경 파일을 `LECTERN_WORKER_MODE=embedded`로 바꾸고 `sudo systemctl restart lectern`을 해서 API가 작업을 실행하게 한다.
- `"ok"` 또는 `"embedded"`인데 멈춰 있으면 아래를 본다.
- 작업은 영속 큐(`job` 테이블)에 있고 lease로 점유된다. 프로세스가 죽으면 lease가 만료된 뒤 다시 큐로 돌아간다. 몇 분 기다린 뒤에도 그대로면 작업을 실행하는 프로세스를 재시작한다.
  ```bash
  sudo systemctl restart lectern            # LECTERN_WORKER_MODE=embedded
  ```
  ```bash
  sudo systemctl restart lectern-worker     # LECTERN_WORKER_MODE=external
  ```
- 같은 작업이 계속 중단되면 최대 시도 횟수 뒤 `lease_lost`로 실패하고, 강의는 재시도 가능한 오류 상태가 된다. 그 녹음 파일이 원인(손상, 지나치게 긴 길이)인지 확인한다.

### 3.8 밖에서만 접속이 안 됨 (프록시·Cloudflare·회선)

1. 앞단 프록시 서비스 상태를 본다([host-setup.md §9](host-setup.md#9-운영-수칙과-현재-구성-메모)에 적어 둔 구성).
   ```bash
   systemctl list-units --type=service --no-pager | grep -Ei 'nginx|caddy|cloudflared|traefik|haproxy'
   ```
2. Cloudflare 상태 페이지와 대시보드(DNS, 터널 상태, SSL 모드)를 확인한다.
3. 호스트의 외부 연결을 확인한다.
   ```bash
   curl -sS -m 5 -o /dev/null -w '%{http_code}\n' https://www.cloudflare.com
   ```

### 3.9 호스트 고장 (부팅 불가, 저장 장치 고장)

- 새 장치나 새 저장 장치로 [host-setup.md §2](host-setup.md#2-새-호스트-준비)부터 진행하고, 오프호스트 사본으로 데이터를 복원한다.
- 잃는 범위: DB는 마지막 오프호스트 복사 시점까지(그 사본 안의 최신 백업은 최대 24시간 전), 업로드 오디오는 마지막 `rsync` 시점까지.
- 복구하는 동안 사용자에게 알릴 방법이 서비스 자체밖에 없다. 장애가 길어지면 오너 계정으로 주요 사용자에게 직접 연락한다.

## 4. 사용자에게 알리기

- SEV1·SEV2가 30분 넘게 이어지면 영향받는 사용자에게 알린다. 아직 상태 페이지가 없으므로 이메일로 알린다(개별 발송, 수신자를 숨김 참조로).
- 알릴 내용: 무엇이 안 되는지, 언제부터인지, 데이터 손실 여부, 다음 안내 시각. 원인 추측은 쓰지 않는다.

## 5. 개인정보 유출이 의심될 때

예: DB나 백업 파일이 외부로 나감, 다른 사용자의 강의가 보였다는 신고, 관리자 계정 무단 로그인, 호스트 침해.

1. **차단**
   - 무단 접근 경로를 막는다(해당 계정 정지, 공개 공유 링크 해제, 필요하면 서비스 중지: `sudo systemctl stop lectern`).
   - 시크릿을 교체한다. DB 유출이면 [secret-rotation.md §6.3](secret-rotation.md#63-전체-교체-db나-백업-파일이-유출됐을-때) 전체 교체.
2. **증거 보존**(지우기 전에)
   ```bash
   install -d -m 700 ~/incident-$(date -u +%Y%m%d) && journalctl -u lectern --since "-7 days" --no-pager > ~/incident-$(date -u +%Y%m%d)/lectern.journal.txt
   ```
   감사 로그는 관리자 콘솔에서 내보내거나 수동 백업(DB 사본)으로 보존한다. 보존본도 개인정보이므로 권한 700 디렉터리에 둔다.
3. **범위 파악**: 어떤 사용자의 어떤 항목(이메일, 이름, 녹음, 전사, 문서, 토큰)이 언제부터 노출됐는지 적는다.
4. **통지·신고 판단**: 개인정보 보호법은 유출을 알게 된 때부터 **72시간 이내**에 정보주체에게 알리고, 1천 명 이상이거나 민감정보·고유식별정보이거나 외부의 불법 접근(해킹)에 의한 경우 개인정보보호위원회 또는 한국인터넷진흥원(KISA)에 신고하도록 한다. 기준과 예외는 국가법령정보센터의 개인정보 보호법 제34조와 시행령 제39조·제40조 최신 조문으로 확인한다. 이 런북은 법률 자문이 아니다.
5. 사용자 통지에는 유출 항목, 시점과 경위, 피해를 줄이기 위해 사용자가 할 일(비밀번호 변경, 토큰 재발급), 우리가 한 조치, 연락처(`개인정보처리방침`의 문의처)를 넣는다.
6. Google 사용자 데이터(P4 이후 캘린더 연동)가 관련됐다면 Google API 서비스 약관의 보안 사고 보고 의무도 확인한다.

## 6. 기록과 사후 검토

장애마다 아래 양식으로 기록한다. 개인정보가 들어갈 수 있으므로 **공개 저장소가 아니라** 운영자의 비공개 메모에 둔다. 재발 방지 작업은 이슈나 PR로 만든다(개인정보는 빼고).

```
# 장애 기록: <한 줄 제목>
- 등급: SEV1 | SEV2 | SEV3
- 감지: YYYY-MM-DD HH:MM (KST) / 감지 경로(사용자 신고, CI, 직접 발견)
- 복구: YYYY-MM-DD HH:MM (KST) / 영향 시간: N분
- 영향: 누가, 무엇을 못 했는가. 데이터 손실 여부와 범위
- 타임라인: 시각 — 관찰한 것 / 한 일
- 원인: 직접 원인, 그것을 가능하게 한 조건
- 잘 된 것 / 안 된 것
- 후속 작업: [ ] 담당, 기한 (런북·테스트·모니터링 보강 포함)
```

사후 검토에서 런북이 틀렸거나 빠진 단계가 있었으면 같은 주에 런북을 고친다.
