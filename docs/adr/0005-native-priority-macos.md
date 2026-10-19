# ADR-0005: 네이티브 우선순위 — macOS 우선, Android·Windows는 v1 어댑터 유지, iOS 보류

- 상태: 채택 (ROADMAP D6, D7)
- 날짜: 2026-10-19
- 관련: [ROADMAP.md D6·D7](../v2/ROADMAP.md#결정-필요-사항), [ARCHITECTURE.md §9](../v2/ARCHITECTURE.md#9-네이티브), [apple-developer-notarization 런북](../runbooks/apple-developer-notarization.md)

## 맥락 (Context)

네이티브 클라이언트가 네 개 있고 모두 v1 API(`/api/lectures`, `/api/ingest/shortcut`)를 쓴다.

| 클라이언트 | 현황 |
|---|---|
| macOS (`apps/macos`) | `main.swift` 한 파일(약 1,800줄)의 메뉴바 앱. ad-hoc 서명(`codesign --sign -`)이라 Gatekeeper에 막히고, 빌드마다 서명이 바뀌어 마이크 권한이 풀린다 |
| Android (`apps/android`) | Jetpack Compose 앱과 빠른 설정 타일. 업로드 재시도는 WorkManager |
| Windows (`apps/windows`) | .NET 8 WinForms 트레이 앱. 긴 WAV를 올려 250MB 업로드 제한에 가장 먼저 걸린다 |
| iOS (`apps/ios`) | 빌드되지 않는 스텁. 실사용은 단축어(`/api/ingest/shortcut`) |

1인 유지보수로 네 플랫폼을 동시에 v2로 옮기면 P6이 핵심 경로를 늦춘다. 주 사용 환경은 macOS(강의·회의 중 노트북 녹음)다.

## 결정 (Decision)

- **macOS를 먼저** v2로 다시 만든다(P6).
  - Swift Package 모듈로 나눈다: `LecternKit`(OpenAPI 생성 클라이언트, Keychain 인증, 업로드 큐), `RecorderKit`(AVAudioEngine 녹음), `LecternUI`(SwiftUI + 디자인 토큰).
  - **Developer ID로 서명하고 공증한다(D7).** 연 $99의 Apple Developer Program에 가입한다. 서명이 안정되면 TCC 마이크 권한이 빌드마다 풀리지 않는다.
- **Android·Windows는 v1 어댑터로 계속 동작**시키고 P6에서 v2와 청크 업로드로 옮긴다. 그 전까지 v1 엔드포인트는 v2 테이블을 읽고 쓰는 어댑터로 유지한다(P2).
- **iOS 네이티브 앱은 보류**한다. 단축어 연동은 v1 어댑터로 유지하고, 이후 PAT(개인 액세스 토큰)로 옮긴다.
- v1 엔드포인트는 사용 로그로 사용량이 0이 됐거나 공지 기간이 끝난 뒤에만 차단한다.

## 결과 (Consequences)

- 좋아지는 것
  - 가장 많이 쓰는 클라이언트가 먼저 좋아지고, Gatekeeper 경고와 마이크 권한 문제가 사라진다.
  - OpenAPI 생성 클라이언트를 macOS에서 먼저 검증하고 Kotlin·C# 쪽에 같은 방식을 적용할 수 있다.
- 감수하는 것
  - v1 어댑터를 P6까지 유지해야 한다. v1 계약 테스트를 P2부터 CI에 둔다.
  - Windows의 250MB 제한은 P6 전까지 남는다. 우회가 필요하면 Windows 클라이언트만 먼저 청크 업로드로 옮기는 것을 검토한다.
  - Apple Developer Program 연회비와 인증서 갱신(5년마다, 공증 키 관리)이 운영 항목에 추가된다.
- 다시 검토할 신호
  - 모바일 웹이나 단축어로 부족하다는 iOS 요구가 반복될 때(보류 목록 트리거)
  - Android·Windows 사용자 비중이 macOS를 넘을 때
