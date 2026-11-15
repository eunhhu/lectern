# 런북: 부하 시험

> 근거 코드: [scripts/load/](../../scripts/load/)(`uploads.ts`, `long-recording.ts`, `disk-full.ts`, [README](../../scripts/load/README.md)), [apps/web/e2e/server/start.ts](../../apps/web/e2e/server/start.ts)(가짜 Gemini가 붙은 샌드박스 서버)
> 관련: [host-setup.md](host-setup.md), [incident-response.md](incident-response.md) §3.3(디스크 부족), [deploy-and-rollback.md](deploy-and-rollback.md)

원칙
1. 시험 서버는 **운영 서비스와 따로** 뜬다. 다른 포트, 임시 디렉터리의 DB, 가짜 AI. 운영 DB·녹음·키를 건드리지 않는다.
2. 스크립트는 실제 데이터 디렉터리(`LECTERN_DATA_DIR`, `LECTERN_LECTURES_DIR`, `lectern.sqlite`가 있는 곳)를 받으면 거절한다. 거절을 피하려고 경로를 바꿔 끼우지 않는다.
3. 운영 환경 파일(`/etc/lectern/lectern.env` 같은 것)을 `source` 하지 않는다. 시험 셸에 `GEMINI_API_KEY`가 있어도 `plain` 모드는 넘기지 않고, `e2e` 모드는 가짜 키로 덮어쓰지만, 애초에 없는 셸에서 돌린다.
4. 요약 JSON은 저장소에 올리지 않는다.

## 1. 언제 돌리나

- 업로드·처리 경로를 크게 바꾼 뒤(파트 업로드, 오디오 분할, 작업 큐, 저장소 정리).
- 호스트를 바꾸거나 디스크·메모리 구성을 바꾼 뒤.
- 운영 서버와 CPU·디스크·메모리를 함께 쓴다. 사용자가 적은 시간에 돌리고, 도중에 운영 `/api/health`를 한 번씩 본다.

## 2. 준비

1. 저장소를 배포한 디렉터리가 아니라 **따로 받은 작업 디렉터리**에서 돌린다(예: `<작업 디렉터리>/lectern`). 운영 checkout에서 돌리면 배포와 엇갈릴 수 있다.
   ```bash
   cd <작업 디렉터리>/lectern && bun install --frozen-lockfile
   ```
2. 임시 파일 위치를 데이터 디스크의 빈 디렉터리로 잡는다. 3시간 WAV는 약 345 MB, 처리 중간 산출물(변환한 오디오, 청크)까지 약 1.5 GB 여유가 필요하다. `/tmp`가 작은 tmpfs면 반드시 바꾼다.
   ```bash
   mkdir -p <데이터 디스크>/lectern-load-tmp
   export TMPDIR=<데이터 디스크>/lectern-load-tmp
   ```
3. `ffmpeg`가 있는지 본다(`command -v ffmpeg`). 없으면 합성 오디오는 TypeScript로 만들지만, 처리(분할·정규화)는 ffmpeg가 필요하다.
4. 운영 서비스는 그대로 둔다. 시험 서버는 빈 포트를 스스로 고른다.

## 3. 실행

| 시험 | 명령(Pi 권장 인자) | 걸리는 시간(대략) |
|---|---|---|
| 동시 업로드 | `bun scripts/load/uploads.ts --n 3 --minutes 30 --out "$TMPDIR/uploads.json"` | 오디오 생성 + 업로드 + 처리 |
| 긴 녹음 | `bun scripts/load/long-recording.ts --hours 3 --out "$TMPDIR/long.json"` | 오디오 생성 수 분 + 처리 |
| 디스크 부족 | 아래 볼륨을 만든 뒤 `bun scripts/load/disk-full.ts --volume <마운트 지점> --out "$TMPDIR/disk.json"` | 수 분 |

디스크 부족 시험의 볼륨(200 MB, 1 GiB를 넘으면 스크립트가 거절한다). sudo가 필요해 스크립트는 만들지 않는다.
```bash
sudo mkdir -p <마운트 지점>
sudo mount -t tmpfs -o size=200m,uid=$(id -u),gid=$(id -g) tmpfs <마운트 지점>
```

- 처리까지 보지 않고 업로드만 재려면 `--no-processing`.
- 시험이 끝나면 스크립트가 시험 서버를 내린다. Ctrl-C로 멈춰도 내린다. 끝난 뒤 `ps -ef | grep -E "e2e/server/start.ts|apps/server/src/index.ts"`에 시험 서버가 남아 있지 않은지 본다(운영 서비스의 프로세스와 헷갈리지 않게, 시험 서버는 운영 포트가 아닌 다른 포트로 뜬다).

## 4. 결과 읽기

요약 JSON(stdout, `--out` 파일)의 필드는 [scripts/load/README.md](../../scripts/load/README.md)에 있다. 볼 것:

| 항목 | 기준 | 넘으면 |
|---|---|---|
| `server.max_rss_bytes` | 호스트 메모리의 50% 이하 | 처리 중 메모리를 조사한다(청크 크기, 동시 작업 수). **하한값이다**: 서버(bun) 프로세스만 재고 ffmpeg 자식 프로세스는 빠지며, 합성 오디오는 대부분 무음이라 압축한 청크(opus·flac)가 실제 말소리보다 훨씬 작다. 실제 녹음에서는 더 크다고 본다 |
| `notes`의 업로드 p95 | 같은 호스트의 이전 기록과 비교 | 디스크 쓰기 속도, 프록시를 본다 |
| `notes`의 처리 시간 | 가짜 AI라 거의 ffmpeg 시간이다 | ffmpeg 분할·정규화가 느린지 본다 |
| `failures` | 비어 있어야 한다 | 내용대로 조사한다. 서버가 죽었으면(`alive_at_end: false`) 시험 서버의 stderr를 본다 |
| 디스크 부족의 `notes` | 서버가 살아 있고, 성공으로 답한 업로드 수 = 목록의 녹음 수 | 성공이라고 답하고 잃은 녹음이 있으면 SEV2로 다룬다 |

가짜 AI는 청크마다 같은 세 문장을 준다. 전사 품질이 아니라 분할·청크 수·메모리·디스크를 보는 시험이다. 합성 오디오는 30초마다 1초씩 소리가 나는 톤이다(가짜 전사가 전사 검사를 통과하게).

## 5. 치우기

```bash
sudo umount <마운트 지점>
rm -rf "$TMPDIR"   # 위에서 만든 시험 전용 디렉터리만
unset TMPDIR
```
macOS에서 디스크 이미지를 썼으면 `hdiutil detach <마운트 지점>` 뒤 `.dmg` 파일을 지운다.

## 6. 기록

- 요약 JSON은 작업 디렉터리 밖(개인 보관)에 둔다. 저장소에 올리지 않는다.
- `docs/v2/pipeline/STATUS.md`의 "실측 필요" 항목에 날짜, 호스트 종류(예: Pi 5 8 GB), 시험 이름, 핵심 수치(최대 메모리, 업로드 p95, 처리 시간, 실패)만 적는다. 호스트 이름·사용자 이름·경로는 적지 않는다.
