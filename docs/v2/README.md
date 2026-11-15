# Lectern v2 설계 문서

Lectern을 "강의 녹음 → 요약" 앱에서 **녹음(+PDF) → 구조화 문서** 플랫폼으로 개편하기 위한 설계 문서 묶음이다.

| 문서 | 내용 | 먼저 읽을 사람 |
|---|---|---|
| [ROADMAP.md](ROADMAP.md) | **결정 필요 사항(D1~D14)**, 단계별 계획(P0~P7)과 종료 기준, 병렬화, 리스크, 보류 목록 | 의사결정자, 모두 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 현재 상태, 시스템 구조, 모노레포, 데이터 모델 v2, API v2, 웹·네이티브, 계정, 캘린더, 검색·물어보기, Ops·DX, 보안 | 구현 담당자 |
| [AI_HARNESS.md](AI_HARNESS.md) | AI 워커 파이프라인(단계, 색인, 영속 큐, 검증, 공급자 추상화, 비용, 템플릿, 평가, 물어보기 실행 경로) | 하네스 담당자 |
| [NATIVE.md](NATIVE.md) | Apple 네이티브(iOS·macOS): 시스템 API 활용 목록(Dynamic Island, Live Activity, 제어 센터, 시스템 오디오, 온디바이스 처리), 공통 구조, 서버 요구, 단계 | 네이티브 담당자 |
| [../../DESIGN.md](../../DESIGN.md) | 디자인 시스템: 토큰, 화면 원칙, 접근성 기준(§5) | 웹·네이티브 화면 담당자 |

읽는 순서: ROADMAP의 결정 표 → ARCHITECTURE §2(현재 상태)와 §5(데이터 모델) → AI_HARNESS §2~§4.

표기 규칙: 문서는 한국어로 쓰고, 코드 식별자, 테이블·컬럼 이름, 단계 이름(`transcribe`, `verify` 등)은 영어로 쓴다.

이 문서들은 결정이 내려질 때마다 갱신한다. 큰 결정은 `docs/adr/`에 ADR로 남기고 여기서 링크한다.

## ADR

새 ADR은 [템플릿](../adr/0000-template.md)을 복사해 쓴다.

| ADR | 결정 | 상태 |
|---|---|---|
| [0001](../adr/0001-monorepo-layout.md) | 모노레포 레이아웃과 의존 방향 | 채택 |
| [0002](../adr/0002-web-stack-react-aria.md) | 웹 스택: React 19 + React Aria Components + TanStack (D2) | 채택 |
| [0003](../adr/0003-single-node-pi-hosting.md) | P5까지 Raspberry Pi 단일 노드 유지 (D4) | 채택 |
| [0004](../adr/0004-workspace-scoped-data-model.md) | 데이터 모델은 첫날부터 워크스페이스 단위 (D5) | 채택 |
| [0005](../adr/0005-native-priority-macos.md) | 네이티브는 macOS 우선, iOS 보류 (D6, D7) | 대체됨(→ 0008) |
| [0006](../adr/0006-harness-provider-abstraction-eval-routing.md) | 하네스 공급자 추상화와 평가 기반 라우팅 (D1, D3) | 채택(메커니즘), 공급자 선택은 P1 평가 |
| [0007](../adr/0007-api-worker-process-split.md) | API와 워커 프로세스 분리, SQLite 영속 큐 | 채택 |
| [0008](../adr/0008-apple-native-first-class.md) | Apple 네이티브(iOS·macOS)를 1급 클라이언트로, 시스템 API 최대 활용 (D6 변경) | 채택 |
| [0009](../adr/0009-ask-rag.md) | 물어보기(RAG): 바이그램 FTS5 + 벡터 하이브리드 검색, 검증하는 인용, 비용 상한. 복습 기능 제외 (D13, D14) | 채택(설계·골격), 답변 모델은 평가 |

## 런북

운영 절차는 [docs/runbooks/](../runbooks/)에 있다.

| 런북 | 내용 |
|---|---|
| [deploy-and-rollback.md](../runbooks/deploy-and-rollback.md) | `main` → CI → CD 배포, 수동 배포, 롤백, 배포 사전 점검 |
| [backup-restore.md](../runbooks/backup-restore.md) | 자동·수동 백업, 복원, 지운 업로드 되살리기, 호스트 밖 사본, 복원 리허설(§7) |
| [secret-rotation.md](../runbooks/secret-rotation.md) | 시크릿 목록과 교체 절차(배포 토큰, Resend, Gemini, OAuth, APNs 키 등) |
| [incident-response.md](../runbooks/incident-response.md) | 장애 종류별 대응, 공급자 장애 리허설 결과(§3.5) |
| [host-setup.md](../runbooks/host-setup.md) | 운영 호스트 재현, systemd 유닛, 워커 유닛 설치 |
| [load-test.md](../runbooks/load-test.md) | Pi 부하 시험(동시 업로드, 3시간 녹음, 디스크 부족) |
| [google-oauth-verification.md](../runbooks/google-oauth-verification.md) | Google OAuth 클라이언트(로그인·캘린더)와 검증 신청 |
| [apple-developer-notarization.md](../runbooks/apple-developer-notarization.md) | Mac 앱의 Developer ID 서명과 공증 체크리스트(D7) |
| [handover-checklist.md](../runbooks/handover-checklist.md) | 인계 점검표: 처음 온 사람이 따라 하며 확인하는 순서와 기록 |

## 구현 파이프라인

이 설계를 작업 패키지(WP)로 나눠 구현한 기록이다. 입구는 [pipeline/README.md](pipeline/README.md)다.

| 문서 | 내용 |
|---|---|
| [pipeline/STATUS.md](pipeline/STATUS.md) | 단계별로 지금 사실인 것(만듦·가짜로 테스트함·실측 필요·사용자 필요), 넘겨받은 요청 |
| [pipeline/CONTRACTS.md](pipeline/CONTRACTS.md) | 파이프라인이 정한 계약(D-*)과 명세를 쓰며 더한 결정 |
| [pipeline/CATALOG.md](pipeline/CATALOG.md) | 작업 패키지 목록과 수용 기준 |
| [pipeline/PIPELINE.md](pipeline/PIPELINE.md), [ORCHESTRATOR.md](pipeline/ORCHESTRATOR.md), [WORKER.md](pipeline/WORKER.md), [SPEC-WRITER.md](pipeline/SPEC-WRITER.md), [RECIPES.md](pipeline/RECIPES.md) | 파이프라인의 진행 규칙, 역할별 지침, 구현 요리책 |
| [pipeline/PARITY.md](pipeline/PARITY.md) | 옛 웹 화면 ↔ 새 웹 앱 기능 대조표 |
| [pipeline/PARITY-ADMIN.md](pipeline/PARITY-ADMIN.md) | 옛 관리자 콘솔 ↔ 새 관리자 콘솔 기능 대조표 |
| [pipeline/A11Y-AUDIT.md](pipeline/A11Y-AUDIT.md) | 웹 앱 접근성: 자동 확인 범위와 VoiceOver 수동 점검표 |
