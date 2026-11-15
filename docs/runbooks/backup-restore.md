# 런북: 백업과 복원

> 근거 코드: [apps/server/src/ops.ts](../../apps/server/src/ops.ts)(`backupDatabase`, `runMaintenance`), [apps/server/src/storage.ts](../../apps/server/src/storage.ts)(`scanOrphanUploads`, `moveToTrash`, `purgeTrash`), [packages/harness/src/retention.ts](../../packages/harness/src/retention.ts)(`sweepHarnessData`)
> 운영 경로: `DATA_DIR=/home/eunhhu/work/lectern/data` (환경 변수 `LECTERN_DATA_DIR`)

## 1. 무엇이 어디에 백업되는가

| 대상 | 위치 | 백업 | 비고 |
|---|---|---|---|
| SQLite DB (계정, 세션, 강의 Markdown·메타데이터, 설정, 감사 로그) | `DATA_DIR/lectern.sqlite` (+ `-wal`, `-shm`) | **자동.** `DATA_DIR/backups/lectern-YYYYMMDD-HHMMSS.sqlite` | 시각은 UTC |
| 업로드 오디오 | `DATA_DIR/uploads/aud_<uuid>.<ext>` | **없음** | 오프호스트 복사 필요(§5) |
| 고아 업로드(참조하는 강의가 없는 파일) | `DATA_DIR/trash/` | 7일 보관 후 삭제 | 휴지통(§4) |
| AI 처리 중간 결과(하네스 산출물: 변환한 오디오, 전사 조각 등) | `DATA_DIR/blobs/sha256/<2자리>/<sha256>` | **없음** | 다시 만들 수 있다. 녹음이나 오디오를 지우면 바로 지운다. 어떤 `artifact` 행도 참조하지 않는 블롭과 `blobs/tmp/`의 파일은 24시간 뒤 유지보수가 지운다(휴지통을 거치지 않음) |
| 오너 강의 아카이브 (`_요약.md`, `_원본` 오디오) | `LECTERN_LECTURES_DIR` (`/home/eunhhu/work/lectures`) | **없음** | 오프호스트 복사 필요 |
| 시크릿 | `/etc/lectern/lectern.env` | **없음** | 비밀번호 관리자에 따로 보관 |

자동 백업의 동작
- 유지보수가 1시간마다 돈다(`LECTERN_MAINTENANCE_INTERVAL_MIN=60`, 부팅 2분 뒤 첫 실행).
- 마지막 백업이 24시간(`LECTERN_BACKUP_INTERVAL_HOURS`)보다 오래됐으면 `VACUUM INTO`로 새 백업을 쓴다. 서버가 계속 요청을 받는 중에도 일관된 스냅샷이 만들어진다.
- 최신 7개(`LECTERN_BACKUP_KEEP`)만 남기고 나머지는 지운다. 이 정리는 `lectern-YYYYMMDD-HHMMSS.sqlite` 이름만 대상으로 한다.
- 마이그레이션 직전 사본 `pre-migrate-YYYYMMDD-HHMMSS.sqlite`는 최신 3개만 남고, 수동 사본 `manual-*.sqlite`(§2.2)와 함께 **만든 지 7일(파일 mtime 기준)이 지나면 유지보수가 지운다.** 결과의 `prunedSnapshots`와 로그 `pruned_snapshots`로 확인한다.
- **보관 기간 약속**: [개인정보처리방침](../../apps/server/static/legal/privacy.html#retention)은 삭제된 데이터가 백업 사본에 최대 7일 남는다고 약속한다. 호스트 안의 사본은 위 두 정리로 지켜진다. 오프호스트 사본(§5)은 운영자가 맞춘다.
- 장애 조사 때문에 7일보다 오래 둬야 하는 사본은 `backups/` 밖(예: `data/hold/`)으로 옮겨 둔다. 그대로 두면 지워진다. 조사가 끝나면 바로 지운다.
- **백업은 DB와 같은 디스크에 있다.** 디스크가 죽으면 함께 잃는다. 오프호스트 복사(§5)를 해야 재해 복구가 된다.

## 2. 수동 백업

배포 전(특히 스키마 변경), 복원 전, 장애 조사 전에 뜬다.

### 2.1 관리자 콘솔에서

`/admin` → 운영 보기 → "유지보수 실행". `POST /api/admin/maintenance/run`이 백업을 강제로 뜬다. 결과의 `backup.file`과 감사 로그 `ops.maintenance`로 확인한다. 이 백업은 자동 백업과 같은 이름 규칙이라 7개 순환에 포함된다.

### 2.2 호스트에서 (순환 대상이 아닌 이름으로)

`sqlite3` CLI가 없을 수 있으니 Bun으로 뜬다. `manual-` 사본은 7개 순환에는 들지 않고, 만든 지 7일이 지나면 유지보수가 지운다(§1).

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
   sudo systemctl stop lectern-worker   # 외부 워커를 쓰는 경우
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
   sudo systemctl start lectern-worker   # 외부 워커를 쓰는 경우
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
- 하네스 산출물(`DATA_DIR/blobs`)은 복원하지 않는다. 백업 시점의 `artifact` 행이 가리키는 블롭이 이미 지워졌으면 그 단계는 캐시 없이 다시 실행된다(AI 비용이 든다). 백업 이후에 만든 블롭은 참조가 없어져 24시간 뒤 유지보수가 지운다.
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

## 6. 정기 점검 (주 1회)

1. 7일이 지난 `pre-migrate-*`, `manual-*` 사본이 남아 있지 않은지 본다(유지보수가 지운다). 출력이 있으면 유지보수가 멈췄거나 실패한 것이니 관리자 콘솔의 마지막 유지보수 결과와 `errors`를 확인한다. `data/hold/`에 옮겨 둔 사본도 조사가 끝났으면 지운다.
   ```bash
   find /home/eunhhu/work/lectern/data/backups -maxdepth 1 \( -name 'pre-migrate-*.sqlite' -o -name 'manual-*.sqlite' \) -mtime +7 -print
   ```
2. 관리자 콘솔 운영 보기에서 백업 개수(7)와 최신 백업 시각(24시간 이내)을 확인한다.
3. 최신 백업에 §3.1 점검을 돌린다.
4. 오프호스트 복사가 최근 7일 안에 됐는지 확인하고, 오프호스트 `backups/`에서 7일이 지난 사본을 지운다.
5. 분기 1회 §7의 복원 리허설을 한다(운영 호스트의 최신 백업으로, 또는 오프호스트 사본으로 운영자 컴퓨터에서).

## 7. 복원 리허설 (분기 1회)

목적: 백업이 실제로 복원되는지 확인한다. 파일이 온전한지, 지금 코드의 서버가 그 위에서 뜨는지, 마이그레이션이 데이터를 잃지 않는지를 [scripts/rehearse/restore.ts](../../scripts/rehearse/restore.ts)가 한 번에 본다([README](../../scripts/rehearse/README.md)). 스크립트는 사본에서만 돈다. §3의 실제 복원 전에 그 백업으로 먼저 돌려 봐도 된다.

운영 호스트에서 돌리는 법
- 저장소를 배포한 checkout이 아니라 **따로 받은 작업 디렉터리**에서 돌린다([load-test.md](load-test.md) §2와 같다). 리허설 서버는 그 checkout의 코드로 뜬다.
- 작업 디렉터리는 **데이터 디렉터리 밖의 빈 디렉터리**로 준다. 데이터 디렉터리나 그 안, 백업이 들어 있던 데이터 디렉터리를 주면 스크립트가 거절한다. 거절을 피하려고 경로를 바꿔 끼우지 않는다. 여유 공간은 백업 크기의 약 3배(사본, 마이그레이션 직전 사본, WAL)가 필요하다.
- 운영 환경 파일(`lectern.env`)을 `source` 하지 않는다. 스크립트는 서버에 샌드박스 환경만 넘기지만(`.env`도 읽지 않는다), 셸에 키를 두지 않는다.
- 운영 서비스는 멈추지 않는다. 리허설 서버는 127.0.0.1의 빈 포트에 뜨고, 작업과 유지보수를 돌리지 않으며, `/api/health`를 확인한 뒤 바로 내려간다.

```bash
cd <작업 디렉터리>/lectern && bun install --frozen-lockfile
```
```bash
bun scripts/rehearse/restore.ts --backup <데이터 디렉터리>/backups/lectern-YYYYMMDD-HHMMSS.sqlite --work <빈 디렉터리> --uploads <데이터 디렉터리>/uploads --out <작업 디렉터리 밖의 요약 파일>
```
오프호스트 사본(§5)으로 할 때는 `--backup`에 받아 온 백업, `--uploads`에 받아 온 `uploads/`를 준다.

요약 읽는 법(종료 코드 0이면 `ok: true`)

| 필드 | 기대 | 아니면 |
|---|---|---|
| `digest_equal` | `true` | 사본이 백업과 다르다(복사 중 디스크 오류). 다시 돌리고, 또 다르면 디스크를 점검한다 |
| `integrity`, `foreign_key_violations` | `ok`, `0` | 백업이 깨졌다. 아래 "실패했을 때" |
| `server.health` | `ok` | `--keep`으로 다시 돌려 작업 디렉터리의 `server.log`를 본다. 마이그레이션이 실패하면 그 백업으로 복원해도 서버가 뜨지 않는다. 배포를 멈추고 고친다 |
| `shrunk_tables` | `[]` | 서버가 뜨면서 사용자 데이터 테이블의 행이 줄었다(마이그레이션이 지웠을 수 있다). 배포와 복원을 멈추고 SEV2로 조사한다. 세션·작업 큐가 줄어든 것은 `notes`에만 적힌다 |
| `audio.missing` | `[]` | 강의가 가리키는 오디오가 `uploads/`에 없다. 오디오는 DB 백업에 들어 있지 않다(§1). 오프호스트 사본(§5)에 있는지 보고, 없으면 그 강의는 오디오 없이 복원된다 |
| `server.migration_ms` | 기록 | 다음 리허설과 비교한다. 크게 늘면 마이그레이션이나 디스크를 본다 |

실패했을 때
- 백업이 깨졌으면 §2로 새 백업을 뜨고 그 파일로 다시 돌린다.
- 새 백업도 실패하면 운영 DB 자체가 문제일 수 있다. [incident-response.md](incident-response.md) §3.4를 보고 장애로 기록한다.

기록
- 날짜, 백업 파일 이름, `ok`, `server.migration_ms`, `audio`의 수를 **운영자 기록**에 남긴다. `docs/v2/pipeline/STATUS.md`가 아니다.
- 요약에는 건수와 해시, 오디오 파일 이름만 있지만 저장소에 올리지 않는다.
- 스크립트가 끝나면 작업 디렉터리를 지운다. `--keep`을 썼으면 확인한 뒤 직접 지운다(사본에 개인 데이터가 들어 있다).
