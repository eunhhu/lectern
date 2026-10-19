# ADR-0008: Apple 네이티브(iOS·macOS)를 1급 클라이언트로 — 시스템 API 최대 활용

- 상태: 채택 (ROADMAP D6 변경)
- 날짜: 2026-10-19
- 대체: [ADR-0005](0005-native-priority-macos.md)의 "iOS 보류" 부분. macOS 우선, Developer ID 공증(D7), Android·Windows v1 어댑터 유지는 그대로 이어받는다.
- 관련: [docs/v2/NATIVE.md](../v2/NATIVE.md), [ROADMAP.md D6](../v2/ROADMAP.md#결정-필요-사항)

## 맥락 (Context)

ADR-0005는 1인 유지보수 부담 때문에 iOS 네이티브 앱을 보류하고 단축어로 버티기로 했다. 같은 날 운영자가 방향을 바꿨다. iOS는 Dynamic Island와 네이티브 API를 최대한 쓰는 앱으로 만들고, macOS도 지금 네이티브 API 활용이 너무 적다는 것이다.

점검 결과([NATIVE.md §2](../v2/NATIVE.md#2-현재-상태-2026-10-19-점검)):
- iOS 앱은 빌드되지 않는 웹뷰 스텁이다.
- macOS 앱은 메뉴바, `AVAudioRecorder`, 전역 단축키 외의 시스템 기능을 쓰지 않는다. 토큰도 `UserDefaults`에 평문으로 저장한다.

검토한 선택지
- **iOS 보류 유지(ADR-0005)**: 비용은 가장 적다. 하지만 휴대폰으로 녹음하는 강의·회의를 단축어에만 맡기게 된다. 잠금 화면 녹음, 끊기지 않는 업로드, 처리 진행 알림을 줄 수 없다.
- **웹뷰 래퍼 앱**: 만들기는 빠르다. 하지만 Live Activity, 제어 센터, 백그라운드 녹음 같은 핵심 이점을 못 쓰고, App Store 심사 지침 4.2(최소 기능)에 걸린다.
- **공유 Swift 모듈 위의 네이티브 iOS·macOS 앱**: 확장 타깃(위젯, Live Activity, 공유)과 APNs 발송기가 늘어난다. 대신 녹음·업로드·인증·렌더링 코드를 두 플랫폼이 함께 쓴다.

## 결정 (Decision)

- 우리는 iOS와 macOS를 웹과 같은 1급 클라이언트로 만든다. 웹뷰 래퍼는 만들지 않는다.
- 녹음과 처리의 시작부터 끝까지를 시스템 표면에서 다룬다.
  - iOS: Dynamic Island와 Live Activity, 제어 센터·동작 버튼(`AudioRecordingIntent`), 위젯, Spotlight·Siri
  - macOS: 메뉴바 HUD, 시스템 오디오 녹음, 회의 감지
- 기능 목록과 순서는 [NATIVE.md](../v2/NATIVE.md)를 따른다.
- 최소 OS는 iOS 26 / iPadOS 26 / macOS 26이다.
- 코드는 `apps/apple/`에 XcodeGen(`project.yml`) 프로젝트 하나로 둔다. 공유 Swift 패키지는 `LecternKit`, `RecorderKit`, `LecternUI`, `LecternIntents`다.
  - 이것은 [ADR-0001](0001-monorepo-layout.md)의 앱 목록 중 `apps/macos`, `apps/ios`를 대신한다.
  - 기존 `apps/macos`는 새 앱이 같은 번들 ID로 대체할 때까지 빌드를 유지한다.
- 온디바이스 처리(SpeechAnalyzer, Vision, Foundation Models)는 먼저 사용자 편의(실시간 자막, 추천)로 넣는다. 서버 단계를 대체하는 것은 ADR-0006 평가를 통과한 경우에만 한다.
- 서버는 하위 호환 추가만 한다: APNs 발송기, 기기·활동 토큰 API, 녹음 마커, 재개 가능한 업로드(IETF 초안 호환), `apple-app-site-association`, Sign in with Apple.
- iOS는 TestFlight로 먼저 배포하고, App Store 공개는 P5(계정 삭제, Sign in with Apple) 뒤에 한다.
- macOS의 토큰 평문 저장은 P6을 기다리지 않고 지금 Keychain으로 옮긴다(N0).

## 결과 (Consequences)

- 좋아지는 것
  - 앱을 열지 않고 녹음 시작부터 "문서 준비됨"까지 받을 수 있다.
  - 화면이 꺼지거나 네트워크가 끊겨도 녹음과 업로드가 이어진다.
  - 스캔 PDF 글자 인식, 제목·폴더 추천을 기기에서 하면 토큰 비용이 준다. 회의 녹음에서 시스템 오디오와 마이크를 따로 녹음하면 화자 구분이 좋아질 수 있다.
  - iPhone Live Activity는 Mac 메뉴바, Apple Watch, CarPlay에도 저절로 나타난다.
- 감수하는 것
  - 확장 타깃과 APNs `.p8` 키 관리가 늘어난다. 연 $99 Apple Developer Program은 D7에서 이미 정했다.
  - App Store 심사 요구가 생긴다: 녹음 권한 문구, 지침 4.8, 계정 삭제, Live Activity 남용 금지.
  - 최소 OS를 26으로 잡아 그보다 오래된 기기는 지원하지 않는다.
  - 1인 유지보수 부담이 커진다. 공유 패키지와 생성 클라이언트로 중복을 줄이고, UI 테스트는 핵심 흐름만 둔다.
- 다시 검토할 신호
  - TestFlight 사용자 가운데 iOS 앱 사용 비중이 낮을 때
  - Live Activity·APNs 정책이 바뀌어 처리 진행 표시가 막힐 때
  - 온디바이스 한국어 품질이 평가 기준에 계속 못 미칠 때(N5 범위 축소)

## 메모

- 확인되지 않은 사실과 검증 방법: [NATIVE.md §8](../v2/NATIVE.md#8-확인할-것)
