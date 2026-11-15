# 복원 리허설 (`scripts/rehearse`)

백업 파일 하나를 빈 작업 디렉터리에 복원해, 원본과 같은지 보고 그 사본으로 서버가 뜨는지(마이그레이션 포함) 확인한다. 사본에서만 돈다. 운영 호스트에서 돌릴 때는 [`docs/runbooks/backup-restore.md`](../../docs/runbooks/backup-restore.md) §7을 본다.

```bash
bun scripts/rehearse/restore.ts --backup <백업 파일> [--work <빈 디렉터리>] [--uploads <uploads 디렉터리>] [--keep] [--out <file>]
```

`--work`가 없으면 OS 임시 디렉터리에 만든다. 끝나면 작업 디렉터리를 지운다(`--keep`이면 남기고, 서버 로그는 그 안의 `server.log`). 종료 코드: `ok`면 0, 아니면 1, 백업이 없거나 인자가 틀리거나 디렉터리를 거절하면 2.

| 요약 필드 | 뜻 |
|---|---|
| `backup` | 파일 이름, 크기, 수정 시각 |
| `tables`, `rows_total` | 백업의 테이블 수와 전체 행 수 |
| `digest_equal` | 사본의 테이블별 건수·체크섬이 백업과 같은지 |
| `integrity`, `foreign_key_violations` | 사본의 `PRAGMA integrity_check`(`ok`여야 한다)와 외래 키 위반 수(0) |
| `server` | `started`(`/api/health`가 답했다), `health`(`checks.database`), `migration_ms`(띄운 뒤 답할 때까지) |
| `shrunk_tables` | 서버가 뜬 뒤 행이 줄어든 테이블(비어야 한다. 세션·작업 큐는 `notes`에만) |
| `audio` | `--uploads`가 있을 때: 강의가 가리키는 오디오 파일 수, 있는 수, 없는 파일 이름(최대 20개) |
| `ok`, `notes` | 위가 모두 통과했는지, 차이와 관찰 |

안전 규칙
- 작업 디렉터리 거절: 저장소의 `data/`, `LECTERN_DATA_DIR`·`LECTERN_LECTURES_DIR`와 겹치는 곳, 백업이 들어 있던 데이터 디렉터리(`<X>/backups/<파일>`이면 `<X>`), `lectern.sqlite`가 있는 곳(또는 그 아래), 비어 있지 않은 디렉터리(숨김 파일 포함), `/`, 홈, 저장소 루트. 거절하면 아무것도 만들거나 지우지 않는다. 이미 있던 빈 디렉터리를 주면 끝난 뒤 안만 비우고 디렉터리는 남긴다.
- 백업 파일은 읽기만 한다(immutable로 열어 옆에 `-wal`·`-shm`도 만들지 않는다). 오디오 파일은 있는지만 본다.
- 서버는 부모 환경을 받지 않는다: `PATH`와 샌드박스 경로, 빈 시크릿, `LECTERN_WORKER_MODE=external`(작업·유지보수가 돌지 않는다), `LECTERN_PREFLIGHT=1`(배포 사전 점검과 같은 모드), `.env`를 읽지 않는다(`--no-env-file`). 127.0.0.1의 빈 포트에만 뜬다.
- 요약에는 건수와 해시만 나온다(행 내용·이메일·제목 없음). 서버 로그(`server.log`)는 작업 디렉터리와 함께 지워진다.
- Ctrl-C·SIGTERM·SIGHUP에도 서버를 내리고 작업 디렉터리를 지운다.
