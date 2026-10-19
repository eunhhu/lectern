# ADR-0007: API와 워커를 별도 프로세스로 분리하고 SQLite 영속 큐로 연결

- 상태: 채택
- 날짜: 2026-10-19
- 관련: [ARCHITECTURE.md §3](../v2/ARCHITECTURE.md#3-전체-구조), [§13](../v2/ARCHITECTURE.md#13-운영opsdx), [AI_HARNESS.md §4](../v2/AI_HARNESS.md#4-실행-엔진-영속-작업-큐), [ROADMAP.md P0](../v2/ROADMAP.md#p0--기반-정비)

## 맥락 (Context)

지금은 Bun 프로세스 하나(`lectern.service`)가 HTTP API, 웹 UI, SSE, 그리고 작업(Gemini 분석, ffmpeg 압축, 유지보수)을 모두 처리한다.

- 작업 큐는 인메모리다(`apps/server/src/jobs.ts`, 분석 동시 2, 압축 동시 1). 재시작하면 `status='processing'`인 강의를 다시 큐에 넣는 방식으로 복구한다. 진행 중이던 단계는 처음부터 다시 한다.
- 배포나 재시작 때 실행 중인 작업에 `LECTERN_SHUTDOWN_GRACE_SEC`(기본 20초)를 주고 기다린다. 그래서 배포가 작업에 묶이고, 긴 작업은 결국 중단된다.
- ffmpeg와 대용량 업로드가 같은 이벤트 루프와 메모리를 쓰므로 웹 응답이 느려질 수 있다.

v2 하네스는 단계가 많고(전사 청크 병렬, 구조화, 추출, 검증) 한 녹음이 수십 분 걸릴 수 있다. 어느 지점에서 죽어도 마지막 완료 단계부터 이어서 해야 한다(P0 종료 기준: 처리 중 `kill -9` 후 재개).

선택지
1. 단일 프로세스 유지 + 큐만 영속화: 재개는 되지만 배포·장애가 여전히 API와 작업을 함께 멈춘다.
2. **API와 워커 프로세스 분리 + SQLite 기반 영속 큐**: 같은 호스트, 같은 DB 파일을 공유한다.
3. 외부 큐(Redis, SQS 등) 도입: Pi 단일 노드에 구성 요소가 늘고, DB와 큐 사이 일관성 문제가 생긴다.

## 결정 (Decision)

2번을 택한다.

- 프로세스 두 개를 systemd로 따로 돌린다.
  - `lectern.service`: `apps/server/src/index.ts`. HTTP API, 정적 웹, SSE, 작업 **등록(enqueue)**만 한다.
  - `lectern-worker.service`: `apps/worker/src/index.ts`. 작업 **실행**을 맡는다(하네스 단계, 압축, 유지보수, 리마인더, 캘린더 동기화). 별도 타이머 유닛은 두지 않는다.
- 두 프로세스는 같은 체크아웃, 같은 `EnvironmentFile`(`/etc/lectern/lectern.env`), 같은 `DATA_DIR`(SQLite + 블롭)을 쓴다.
- 큐는 SQLite 테이블(`job`, `stage_run`, `artifact`, `ai_call`, `job_events`)이다.
  - 점유는 원자적 `UPDATE … RETURNING`과 lease(`lease_owner`, `lease_until`, 하트비트)로 한다. 만료된 lease는 회수해 다시 `queued`로 돌린다.
  - 기록 순서는 "산출물 저장 → `artifact` 행 → `stage_run` 상태 전이(항상 마지막)"다. 그래서 어디서 죽어도 끝나지 않은 단계부터 다시 한다.
- 진행 상황은 워커가 `job_events`에 쓰고, API가 읽어서 SSE로 보낸다(`Last-Event-ID`로 재전송).
- API의 `/api/ready`는 워커 하트비트가 60초 이내인지 함께 본다.
- 이행: P0에서 현재 인메모리 작업(분석, 압축, 유지보수)을 새 큐로 옮긴다. 사용자가 보기에 달라지는 것은 없어야 한다.

## 결과 (Consequences)

- 좋아지는 것
  - 워커가 죽거나 재시작돼도 웹은 계속 동작한다. API 배포가 긴 작업을 기다리지 않는다.
  - 작업이 영속되므로 강제 종료·정전 후에도 이어서 처리한다.
  - ffmpeg와 AI 호출이 웹 응답 지연에 영향을 주지 않는다.
  - 처리량이 부족하면 워커만 두 번째 호스트로 옮길 수 있다([ADR-0003](0003-single-node-pi-hosting.md) 확장 경로).
- 감수하는 것
  - 두 프로세스가 같은 SQLite에 쓴다. WAL과 `busy_timeout`으로 다루고, 쓰기 트랜잭션을 짧게 유지한다. 경합이 관측되면 Postgres 전환 신호로 본다.
  - 배포가 두 프로세스를 모두 새 코드로 재시작해야 한다. 한쪽만 바뀐 상태(버전 불일치)를 피하려면 큐 스키마 변경은 하위 호환으로 하고, 마이그레이션은 두 프로세스가 모두 멈추지 않아도 되게 쓴다.
  - systemd 유닛과 운영 런북이 늘어난다([deploy/systemd](../../deploy/systemd/), [host-setup](../runbooks/host-setup.md)).
- 다시 검토할 신호
  - SQLite 쓰기 경합(`SQLITE_BUSY`)이 반복될 때
  - 작업 종류가 늘어 워커 하나의 동시성 설정으로 공정성을 맞추기 어려울 때(작업 종류별 워커 분리 검토)
