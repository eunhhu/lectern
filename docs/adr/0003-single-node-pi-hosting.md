# ADR-0003: P5까지 Raspberry Pi 단일 노드 호스팅 유지

- 상태: 채택 (ROADMAP D4)
- 날짜: 2026-10-19
- 관련: [ROADMAP.md D4](../v2/ROADMAP.md#결정-필요-사항), [ARCHITECTURE.md §3](../v2/ARCHITECTURE.md#3-전체-구조), [§15 확장 경로](../v2/ARCHITECTURE.md#15-확장-경로)

## 맥락 (Context)

운영 서버는 Raspberry Pi 5(aarch64) 한 대다. systemd `lectern.service`가 Bun 서버를 돌리고, Cloudflare를 거쳐 `lectern.qucord.com`으로 서비스한다. 서버는 `127.0.0.1:18775`에만 바인딩하고 앞단 프록시가 연결을 넘겨준다. 데이터는 `bun:sqlite`(WAL) 파일 하나와 로컬 디스크(`DATA_DIR/uploads`)에 있다. 백업은 같은 디스크의 `DATA_DIR/backups`에 `VACUUM INTO`로 매일 뜬다.

v2는 처리량(ffmpeg, 다단계 AI 호출)과 데이터량(PDF, 전사, 산출물)이 늘어난다. 선택지는 다음과 같았다.

1. **지금 클라우드로 옮기기**(관리형 Postgres + 객체 저장소 + 컨테이너): 확장성은 좋지만, 사용자가 적은 지금 고정비가 생기고 이전 작업이 핵심 경로(P1 하네스)를 늦춘다.
2. **Pi 단일 노드를 유지하고, 이식성은 인터페이스로 확보**: 고정비가 없고 운영이 단순하다. 단일 장애점과 디스크 용량이 한계다.
3. Pi + 외부 관리형 DB 혼합: 지연과 복잡도만 늘고 얻는 게 적다.

## 결정 (Decision)

**P5까지 Pi 한 대에서 SQLite(WAL) + 로컬 디스크로 운영한다.** 옮길 때를 대비해 다음을 지킨다.

- 블롭 접근은 `BlobStore` 인터페이스 뒤에 둔다. 처음 구현은 로컬 디스크(`DATA_DIR/blobs`)이고 키는 sha256 기반이다. S3/R2로 바꿔도 키 체계가 같다.
- DB 접근은 Drizzle 스키마와 리포지토리 뒤에 둔다. SQLite 전용 기능(FTS5 등)은 리포지토리 안에 가둔다.
- 경로와 설정은 `packages/config`의 환경 변수로 받는다. 하드코딩된 `/home/eunhhu/...` 경로는 없앤다(운영 값은 `/etc/lectern/lectern.env`에 둔다).
- API와 워커는 같은 호스트에서 별도 프로세스로 돈다([ADR-0007](0007-api-worker-process-split.md)). 같은 SQLite와 블롭 디렉터리를 공유한다.
- 호스트 구성은 `deploy/systemd/` 템플릿과 [host-setup 런북](../runbooks/host-setup.md)으로 재현할 수 있게 한다.

## 결과 (Consequences)

- 좋아지는 것
  - 고정비가 거의 없고, 배포·백업·롤백이 지금처럼 단순하다.
  - SQLite는 같은 호스트에서 지연이 거의 없고 백업이 파일 복사 수준이다.
- 감수하는 것
  - **단일 장애점**이다. Pi, SD/SSD, 가정용 회선, 전원 중 하나가 죽으면 서비스가 멈춘다. [incident-response 런북](../runbooks/incident-response.md)과 오프호스트 백업 복사로 대응한다.
  - 백업이 같은 디스크에 있으면 디스크 고장에 함께 잃는다. 오프호스트 복사를 런북에 넣는다([backup-restore](../runbooks/backup-restore.md)).
  - ffmpeg와 AI 호출이 늘면 CPU·메모리가 부족해질 수 있다. 워커 동시성 상한으로 막는다.
  - 업로드 크기와 동시 업로드 수가 Pi 메모리·디스크에 묶인다. v2 청크 업로드는 디스크로 스트리밍해 메모리 부담을 줄인다.
- 다시 검토할 신호 ([ARCHITECTURE.md §15](../v2/ARCHITECTURE.md#15-확장-경로))
  - 처리 대기열이 늘 쌓인다 → 워커 동시성 상향, 그다음 두 번째 호스트로 워커 분리
  - 디스크 사용률 80% 초과 → `BlobStore`를 S3/R2로 교체
  - SQLite 쓰기 경합이 관측되거나 다중 노드가 필요하다 → Postgres 전환
  - 외부 유료 사용자가 생겨 가용성 약속(SLA)이 필요하다
