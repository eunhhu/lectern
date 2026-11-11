# v2 빌드 파이프라인

[ROADMAP](../ROADMAP.md)의 남은 부분(P1 후반 ~ P7)을 설계 결정과 작업 명세로 풀어 둔 곳이다. 구현은 여기 없다. 작은 모델의 워커가 명세 하나씩을 구현하고, 게이트를 통과한 것만 통합 브랜치에 합친다.

## 넘겨받은 세션이 할 일

새 세션(사람이든 에이전트든)에게는 이 한 줄이면 된다.

```
docs/v2/pipeline/ORCHESTRATOR.md를 읽고 0단계부터 그대로 실행해. 워커는 작은 모델의 서브에이전트로 띄워.
```

지금 어디까지 왔는지는 명령 하나로 본다.

```bash
bun run pipeline status
```

## 읽는 순서

| 누가 | 읽을 것 |
|---|---|
| 넘겨받은 오케스트레이터 | [ORCHESTRATOR.md](ORCHESTRATOR.md) → [PIPELINE.md](PIPELINE.md) |
| 워커 | `AGENTS.md` → [WORKER.md](WORKER.md) → `wp/<ID>.md` |
| 설계를 보려는 사람 | [CONTRACTS.md](CONTRACTS.md) → [CATALOG.md](CATALOG.md) |
| 무엇이 됐고 무엇이 안 됐는지 | [STATUS.md](STATUS.md) |

## 한눈에

- 작업 패키지 89개: P0 1개(기준선 고치기), P1 17개, P2 11개, P3 11개, P4 8개, P5 16개, P6 20개, P7 5개.
- 기본은 직렬이다. 병렬은 소유 경로가 겹치지 않는 것끼리만, 최대 3개다.
- 모든 새 기능은 기능 플래그 뒤에 있고 기본으로 꺼져 있다.
- AI 공급자는 Gemini 하나다. 테스트와 게이트는 실제 외부 호출을 하지 않는다.
- `main`에는 push하지 않는다(`main` = 운영 배포). 통합 브랜치만 push한다.

## 이 파이프라인으로 끝나지 않는 것

코드와 가짜 테스트로는 확인할 수 없어서 사용자가 해야 하는 일이 있다. 목록은 [STATUS.md](STATUS.md)에 있고, 요약하면 다음과 같다.

- 실제 Gemini 호출로 하는 품질 평가(동의받은 녹음 10건 이상과 주석)와 비용 실측
- Google OAuth 검증 신청, Apple Developer ID, TestFlight, APNs 키
- Raspberry Pi에서의 부하·복원 시험과 운영 배포
- 실제 기기에서만 보이는 것(3시간 백그라운드 녹음, Dynamic Island, 시스템 오디오 권한)
- 옛 화면을 지우는 두 작업(P2-10, P5-14)의 승인
