# 부하 시험 (`scripts/load`)

샌드박스 서버를 띄워 합성 오디오를 v2 파트 업로드로 올리고, JSON 요약을 stdout에 낸다(진행은 stderr). Pi에서 돌리는 법: [`docs/runbooks/load-test.md`](../../docs/runbooks/load-test.md).

| 스크립트 | 무엇 |
|---|---|
| `uploads.ts` | 동시 업로드 N건, 처리(가짜 AI)까지 |
| `long-recording.ts` | 긴 녹음 한 건(기본 3시간, 약 345 MB WAV) |
| `disk-full.ts` | 작은 볼륨에서 디스크가 찰 때까지 올리고, 서버가 살아 있는지·잃은 녹음이 없는지 본다 |

```bash
bun scripts/load/uploads.ts --n 3 --minutes 10 [--timeout-min 30] [--no-processing] [--out <file>]
bun scripts/load/long-recording.ts --hours 3 [--timeout-min 120] [--no-processing] [--out <file>]
bun scripts/load/disk-full.ts --volume <작은 볼륨의 마운트 지점> [--out <file>]
```

종료 코드: `ok`면 0, 아니면 1, 인자가 틀리거나 디렉터리를 거절하면 2.

| 요약 필드 | 뜻 |
|---|---|
| `server.mode`, `server.processing` | `e2e`(가짜 Gemini로 처리)·`plain`(작업이 돌지 않는다), `on`·`unavailable`·`off` |
| `server.max_rss_bytes`, `server.alive_at_end` | 서버(bun) 프로세스의 최대 메모리(1초 표본. ffmpeg 자식은 빠지고 무음이 많은 합성 오디오라 하한값), 끝까지 살아 있었는지 |
| `uploads[]` | 건마다 `ok`, `recordingId`, `bytes`, `parts`, `uploadMs`, `status`, `error`, `stage`(실패한 단계) |
| `processing[]` | 녹음마다 끝난 상태(`ready`·`partial`·`failed`·`canceled`·`timeout`)와 걸린 시간 |
| `failures`, `notes`, `ok` | `ok`가 아닌 이유, 관찰(시간 p50·p95, 파일 크기, 디스크 시험의 결과) |

안전 규칙
- 실제 데이터 디렉터리를 쓰지 않는다: 저장소의 `data/`, `LECTERN_DATA_DIR`·`LECTERN_LECTURES_DIR`(겹치는 경로 포함), `lectern.sqlite`가 있는 곳(또는 그 아래), 비어 있지 않은 디렉터리, `/`, 홈, 저장소 루트는 거절한다.
- 실제 AI를 부르지 않는다: 처리는 `apps/web/e2e/server/start.ts`의 가짜 Gemini가 답한다. `plain` 모드는 작업 자체가 돌지 않고, 부모의 `GEMINI_API_KEY` 같은 시크릿을 넘기지 않는다.
- 합성 오디오는 30초마다 1초씩 소리가 나는 톤·잡음이다. 가짜 전사(청크마다 12초 분량)가 전사 검사를 통과하려면 청크의 말소리가 20초 미만이어야 하기 때문이다. 61초 이상으로 만든다.

작은 볼륨 만들기(디스크 시험, 200 MB면 충분하다. 1 GiB를 넘으면 거절한다)
- macOS: `hdiutil create -size 200m -fs HFS+ -volname lectern-load <파일>.dmg` → `hdiutil attach <파일>.dmg -mountpoint <dir>`, 끝나면 `hdiutil detach <dir>`
- Linux: `sudo mount -t tmpfs -o size=200m tmpfs <dir>`, 끝나면 `sudo umount <dir>`(sudo가 필요해 스크립트는 하지 않는다)
