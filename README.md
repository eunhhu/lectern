# Lectern

음성 녹음과 참고 PDF로 구조화된 노트를 만드는 서비스다. 강의·회의·세미나·인터뷰 녹음을 올리면 전사하고, 템플릿에 맞춘 문서와 일정·할 일·결정을 뽑고, 문서의 내용에 전사 구간과 PDF 쪽 출처를 단다. 쌓인 노트를 검색하고, 출처가 있는 답만 하는 물어보기로 질문할 수 있다. 운영: **[https://lectern.qucord.com](https://lectern.qucord.com)**

[![Lectern Multi-Platform CI/CD](https://github.com/eunhhu/lectern/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/eunhhu/lectern/actions/workflows/ci-cd.yml)

## 구성

| 부분 | 위치 | 무엇 |
|---|---|---|
| API 서버 | `apps/server` | Bun + Hono, SQLite. v1 API와 `/api/v2`, 웹 앱 서빙, CD 웹훅 |
| 워커 | `apps/worker` | SQLite 영속 큐의 작업(전사·노트·색인·압축·유지보수)을 돌린다 |
| AI 하네스 | `packages/harness`, `packages/media` | 단계 실행기, Gemini 어댑터, 오디오 정규화와 청크 |
| 웹 | `apps/web` | `/app`의 새 웹 앱(React 19 + React Aria) |
| 네이티브 | `apps/apple`, `apps/android`, `apps/macos`, `apps/windows`, `apps/ios` | 새 iOS·macOS 앱, Android 앱, 옛 macOS·Windows·단축어 클라이언트 |

AI는 Gemini만 쓰고 모델 ID는 버전을 고정한다. 운영은 Raspberry Pi 한 대(systemd)이고, `main`에 들어간 커밋은 CI를 통과하면 바로 배포된다([배포와 롤백](docs/runbooks/deploy-and-rollback.md)).

## 빠른 시작

설치, 타입 검사, 테스트, 샌드박스 로컬 서버, 웹·네이티브 빌드는 [AGENTS.md의 "개발과 테스트"](AGENTS.md#개발과-테스트)에 있다. 명령은 그곳 한 군데에만 적는다.

v1 노트 CLI(`bun run cli <오디오 파일>`)는 실제 Gemini를 불러 비용이 든다.

## 문서 지도

1. [AGENTS.md](AGENTS.md): 작업 규칙, 저장소 지도, 개발과 테스트
2. [docs/v2/README.md](docs/v2/README.md): 설계 문서와 ADR
3. [docs/runbooks/](docs/runbooks/): 배포·롤백, 백업·복원, 시크릿 교체, 장애 대응, 호스트 구성, 부하 시험, [인계 점검표](docs/runbooks/handover-checklist.md)
4. [docs/v2/pipeline/](docs/v2/pipeline/README.md): 구현 파이프라인과 [상태표](docs/v2/pipeline/STATUS.md)
5. [docs/env.md](docs/env.md): 환경 변수 레퍼런스

## 내려받기 (GitHub Actions가 빌드한 릴리스)

- macOS 메뉴바 앱(옛 앱): [Lectern-macOS-arm64.zip](https://github.com/eunhhu/lectern/releases/latest/download/Lectern-macOS-arm64.zip)
- Android 앱: [Lectern-android-universal.apk](https://github.com/eunhhu/lectern/releases/latest/download/Lectern-android-universal.apk)
- Windows 트레이 앱: [LecternTray-win-x64.exe](https://github.com/eunhhu/lectern/releases/latest/download/LecternTray-win-x64.exe)
- iOS 단축어: [lectern-ios-shortcut.json](https://lectern.qucord.com/api/clients/ios-shortcut)

새 iOS·macOS 앱(`apps/apple`)은 아직 배포하지 않는다. 서명·공증과 기기 점검이 남았다([상태표](docs/v2/pipeline/STATUS.md)).

## 라이선스

MIT. [LICENSE](LICENSE)를 본다.
