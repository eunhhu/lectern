# 런북: 백업과 복원

> 근거 코드: [apps/server/src/ops.ts](../../apps/server/src/ops.ts)(`backupDatabase`, `runMaintenance`), [apps/server/src/storage.ts](../../apps/server/src/storage.ts)(`scanOrphanUploads`, `moveToTrash`, `purgeTrash`)
> 운영 경로: `DATA_DIR=/home/eunhhu/work/lectern/data` (환경 변수 `LECTERN_DATA_DIR`)

## 1. 무엇이 어디에 백업되는가

| 대상 | 위치 | 백업 | 비고 |
|---|---|---|---|
| SQLite DB (계정, 세션, 강의 Markdown·메타데이터, 설정, 감사 로그) | `DATA_DIR/lectern.sqlite` (+ `-wal`, `-shm`) | **자동.** `DATA_DIR/backups/lectern-YYYYMMDD-HHMMSS.sqlite` | 시각은 UTC |
| 업로드 오디오 | `DATA_DIR/uploads/aud_<uuid>.<ext>` | **없음** | 오프호스트 복사 필요(§5) |
| 고아 업로드(참조하는 강의가 없는 파일) | `DATA_DIR/trash/` | 7일 보관 후 삭제 | 휴지통(§4) |
| 오너 강의 아카이브 (`_요약.md`, `_원본` 오디오) | `LECTERN_LECTURES_DIR` (`/home/eunhhu/work/lectures`) | **없음** | 오프호스트 복사 필요 |
| 시크릿 | `/etc/lectern/lectern.env` | **없음** | 비밀번호 관리자에 따로 보관 |

자동 백업의 동작
- 유지보수가 1시간마다 돈다(`LECTERN_MAINTENANCE_INTERVAL_MIN=60`, 부팅 2분 뒤 첫 실행).
- 마지막 백업이 24시간(`LECTERN_BACKUP_INTERVAL_HOURS`)보다 오래됐으면 `VACUUM INTO`로 새 백업을 쓴다. 서버가 계속 요청을 받는 중에도 일관된 스냅샷이 만들어진다.
- 최신 7개(`LECTERN_BACKUP_KEEP`)만 남기고 나머지는 지운다. 이 정리는 `lectern-YYYYMMDD-HHMMSS.sqlite` 이름만 대상으로 한다.
- **백업은 DB와 같은 디스크에 있다.** 디스크가 죽으면 함께 잃는다. 오프호스트 복사(§5)를 해야 재해 복구가 된다.

## 2. 수동 백업

배포 전(특히 스키마 변경), 복원 전, 장애 조사 전에 뜬다.

### 2.1 관리자 콘솔에서

`/admin` → 운영 보기 → "유지보수 실행". `POST /api/admin/maintenance/run`이 백업을 강제로 뜬다. 결과의 `backup.file`과 감사 로그 `ops.maintenance`로 확인한다. 이 백업은 자동 백업과 같은 이름 규칙이라 7개 순환에 포함된다.

### 2.2 호스트에서 (순환 대상이 아닌 이름으로)

`sqlite3` CLI가 없을 수 있으니 Bun으로 뜬다. `manual-` 접두사는 자동 정리 대상이 아니므로 직접 지워야 한다.

```bash
cd /home/eunhhu/work/lectern/data && STAMP=$(date -u +%Y%m%d-%H%M%S) && \
  /home/eunhhu/.bun/bin/bun -e "import { Database } from 'bun:sqlite'; const db = new Database('lectern.sqlite'); db.exec('PRAGMA busy_timeout = 5000'); db.exec(\"VACUUM INTO 'backups/manual-${STAMP}.sqlite'\"); console.log('backups/manual-${STAMP}.sqlite')"
```

검증
```bash
ls -lh /home/eunhhu/work/lectern/data/backups/
```
그다음 [§3.1](#31-백업-파일-점검)의 점검을 새 파일에 돌린다.

## 3. 데이터베이스 복원

**복원하면 백업 시각 이후의 DB 변경이 모두 사라진다.** 새 강의, 편집, 가입, 비밀번호 변경, 토큰 재발급, 로그인 세션이 모두 포함된다. 꼭 필요할 때만 한다.

### 3.1 백업 파일 점검

복원할 파일을 먼저 점검한다. 원본을 건드리지 않도록 읽기 전용으로 연다.

```bash
cd /home/eunhhu/work/lectern/data && /home/eunhhu/.bun/bin/bun -e "import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1], { readonly: true }); console.log(db.query('PRAGMA integrity_check').get()); for (const t of ['users','lectures','sessions','audit_logs']) console.log(t, db.query('SELECT COUNT(*) AS n FROM ' + t).get()); console.log('latest lecture', db.query('SELECT MAX(created_at) AS at FROM lectures').get())" backups/lectern-YYYYMMDD-HHMMSS.sqlite
```

`integrity_check`가 `ok`이고 건수와 최신 강의 시각이 예상과 맞아야 한다.

### 3.2 복원 절차

1. 서버(워커가 있으면 워커도)를 멈춘다. 멈추지 않으면 실행 중인 프로세스가 옛 파일 핸들에 계속 쓴다.
   ```bash
   sudo systemctl stop lectern
   ```
   ```bash
   sudo systemctl stop lectern-worker   # P0 워커가 들어온 뒤
   ```
2. 현재 DB 파일 세 개(본체, `-wal`, `-shm`)를 **모두** 옆으로 옮긴다. `-wal`을 남겨 두면 복원한 파일 위에 옛 WAL이 재생돼 DB가 망가질 수 있다.
   ```bash
   cd /home/eunhhu/work/lectern/data && ASIDE="restore-aside-$(date -u +%Y%m%d-%H%M%S)" && mkdir "$ASIDE" && \
     for f in lectern.sqlite lectern.sqlite-wal lectern.sqlite-shm; do [ -e "$f" ] && mv "$f" "$ASIDE/"; done; ls -la "$ASIDE"
   ```
3. 백업을 제자리에 복사한다(백업 파일 자체는 남겨 둔다).
   ```bash
   cd /home/eunhhu/work/lectern/data && cp backups/lectern-YYYYMMDD-HHMMSS.sqlite lectern.sqlite && chown eunhhu:eunhhu lectern.sqlite
   ```
4. 서버를 다시 띄운다.
   ```bash
   sudo systemctl start lectern
   ```
   ```bash
   sudo systemctl start lectern-worker   # P0 워커가 들어온 뒤
   ```
5. 검증한다.
   ```bash
   curl -fsS http://127.0.0.1:18775/api/health | jq '{status, checks}'
   ```
   ```bash
   journalctl -u lectern --since "5 min ago" --no-pager | tail -30
   ```
   - `status`가 `ok`, `checks.database`가 `ok`
   - 오너 계정으로 로그인되고, 강의 목록 건수가 §3.1에서 본 값과 맞는다.
6. 옆으로 옮긴 `restore-aside-*` 디렉터리는 복원이 확실히 끝날 때까지(최소 7일) 남겨 둔다. 개인 데이터가 들어 있으니 그 뒤에는 지운다.

### 3.3 복원 뒤 할 일

- **백업 이후에 바꾼 비밀번호와 API 토큰이 되돌아간다.** 유출 때문에 바꾼 것이었다면 [secret-rotation.md](secret-rotation.md)의 해당 절차를 다시 한다.
- 백업 이후에 만든 강의의 오디오 파일은 `uploads/`에 남아 있지만 DB 행이 없다. 다음 유지보수(1시간 이내)가 이 파일들을 고아로 보고 휴지통으로 옮기고, 7일 뒤 지운다. 살려야 하면 §4.3대로 7일 안에 다시 올린다.
- 사용자는 다시 로그인해야 할 수 있다(세션도 백업 시점으로 돌아간다).
- 복원 사실과 잃은 구간(백업 시각 ~ 복원 시각)을 [incident-response.md](incident-response.md)의 사고 기록에 남긴다.

## 4. 휴지통에서 파일 살리기

### 4.1 휴지통에 들어가는 것과 들어가지 않는 것

들어가는 것
- `DATA_DIR/uploads/`의 `aud_<uuid>.<ext>` 파일 중 **어떤 강의 행도 참조하지 않고 1시간 넘게 지난 것**(고아 업로드). 매시간 유지보수나 관리자 콘솔의 "고아 파일 정리"(`POST /api/admin/storage/gc`)가 옮긴다.
- 옮긴 시각부터 `LECTERN_TRASH_DAYS`(기본 7일) 뒤에 삭제된다.

들어가지 **않는** 것 (휴지통으로 되살릴 수 없음)
- 사용자가 강의를 삭제하거나 "오디오만 삭제"를 한 경우. 파일을 바로 지운다.
- 보존 정책(관리자 설정, 기본 꺼짐)이 지운 오디오와 실패 강의.
- 이런 삭제의 텍스트(Markdown, 메타데이터)는 DB 백업에만 남는다(최대 7일).

### 4.2 휴지통 확인

```bash
ls -lt /home/eunhhu/work/lectern/data/trash/ | head -30
```

파일 시각(mtime)이 휴지통에 들어간 시각이다. 그 시각 + 7일이 삭제 예정 시각이다.

어떤 강의의 파일이었는지 찾으려면 백업 DB에서 찾는다.

```bash
cd /home/eunhhu/work/lectern/data && /home/eunhhu/.bun/bin/bun -e "import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1], { readonly: true }); console.log(db.query('SELECT id, title, owner_id, created_at FROM lectures WHERE audio_path LIKE ?').all('%' + process.argv[2] + '%'))" backups/lectern-YYYYMMDD-HHMMSS.sqlite aud_<uuid>
```

### 4.3 살리기

조사하는 동안 삭제를 막으려면 먼저 휴지통 밖으로 복사해 둔다.

```bash
mkdir -p /home/eunhhu/lectern-recovered && cp -p /home/eunhhu/work/lectern/data/trash/aud_<uuid>.<ext> /home/eunhhu/lectern-recovered/
```

그다음 경우에 따라 처리한다.

- **DB를 복원해 이 파일을 참조하는 행이 다시 생긴 경우**: 파일을 `uploads/`로 되돌린다. 참조가 있으니 다시 고아로 분류되지 않는다.
  ```bash
  mv /home/eunhhu/work/lectern/data/trash/aud_<uuid>.<ext> /home/eunhhu/work/lectern/data/uploads/
  ```
- **참조하는 행이 없는 경우**: `uploads/`로 되돌리기만 하면 1시간 안에 다시 휴지통으로 간다. 복사본을 일반 업로드(웹 UI 또는 `/api/ingest/shortcut`)로 다시 올려 새 강의로 만든다. AI 처리 비용이 다시 든다.

검증
```bash
ls -l /home/eunhhu/work/lectern/data/uploads/aud_<uuid>.<ext>
```
웹 UI에서 해당 강의의 오디오가 재생되는지 확인한다.

조사 기간이 7일보다 길어질 것 같으면 `/etc/lectern/lectern.env`에서 `LECTERN_TRASH_DAYS=30`으로 늘리고 `sudo systemctl restart lectern`을 한 뒤, 끝나면 7로 되돌린다.

## 5. 오프호스트 복사 (재해 복구)

운영자 컴퓨터에서 주 1회 이상, 그리고 큰 변경 전에 돌린다. `<pi>`는 호스트의 SSH 별칭이다.

```bash
mkdir -p ~/lectern-offhost/backups ~/lectern-offhost/uploads
```
```bash
rsync -av <pi>:/home/eunhhu/work/lectern/data/backups/ ~/lectern-offhost/backups/
```
```bash
rsync -av <pi>:/home/eunhhu/work/lectern/data/uploads/ ~/lectern-offhost/uploads/
```

- 백업에는 이메일, 비밀번호 해시, 강의 내용 같은 개인정보가 들어 있다. 암호화된 디스크(FileVault 등)에만 둔다.
- 사용자가 삭제한 데이터가 오프호스트 사본에 오래 남지 않도록, 오프호스트 `backups/`도 최근 7개 정도만 유지한다(개인정보처리방침의 보관 기간과 맞춘다).

검증: 받아 온 최신 백업에 [§3.1](#31-백업-파일-점검) 점검을 돌린다(경로만 로컬 경로로 바꾼다).

## 6. 정기 점검 (월 1회)

1. 관리자 콘솔 운영 보기에서 백업 개수(7)와 최신 백업 시각(24시간 이내)을 확인한다.
2. 최신 백업에 §3.1 점검을 돌린다.
3. 오프호스트 복사가 최근 7일 안에 됐는지 확인한다.
4. 분기 1회는 오프호스트 사본으로 로컬에서 실제 복원 리허설을 한다.
   ```bash
   mkdir -p /tmp/lectern-restore-drill/{data,lectures,home} && cp ~/lectern-offhost/backups/<최신>.sqlite /tmp/lectern-restore-drill/data/lectern.sqlite
   ```
   `HOME`을 임시 디렉터리로 바꾸고 키를 비워서, 부팅 때 다시 큐에 들어가는 강의가 실제 Gemini를 호출하거나 메일을 보내지 않게 한다.
   ```bash
   HOME=/tmp/lectern-restore-drill/home GEMINI_API_KEY= RESEND_API_KEY= LECTERN_RESEND_CREDENTIALS_FILE= LECTERN_DATA_DIR=/tmp/lectern-restore-drill/data LECTERN_LECTURES_DIR=/tmp/lectern-restore-drill/lectures LECTERN_BASE_URL=http://127.0.0.1:18999 PORT=18999 bun apps/server/src/index.ts
   ```
   다른 터미널에서 `curl -fsS http://127.0.0.1:18999/api/health`가 `ok`이면 성공이다. 끝나면 서버를 멈추고 `/tmp/lectern-restore-drill`을 지운다.
