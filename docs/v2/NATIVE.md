# Apple 네이티브 계획 (iOS·macOS)

> 결정: [ADR-0008](../adr/0008-apple-native-first-class.md)(D6 변경). [ADR-0005](../adr/0005-native-priority-macos.md)의 "iOS 보류"를 대체한다.
> 관련: [ROADMAP.md P6](ROADMAP.md#p6--apple-네이티브-iosmacos), [ARCHITECTURE.md §9](ARCHITECTURE.md#9-네이티브), [DESIGN.md §7 플랫폼 대응표](../../DESIGN.md), [apple-developer-notarization 런북](../runbooks/apple-developer-notarization.md)

iOS와 macOS를 웹과 같은 1급 클라이언트로 만든다. 웹 화면을 감싸는 앱이 아니라 OS가 주는 표면(Dynamic Island, 잠금 화면, 제어 센터, 동작 버튼, 메뉴바, Spotlight, Siri, 위젯)과 온디바이스 처리를 최대한 쓰는 앱이다.

## 1. 원칙

1. **웹뷰 래퍼를 만들지 않는다.** 문서 읽기, 전사 동기화, PDF 보기까지 SwiftUI·PDFKit으로 직접 그린다. 웹뷰만 있는 앱은 App Store 심사 지침 4.2(최소 기능)에도 걸린다.
2. **앱을 열지 않아도 되게 한다.** 녹음 시작·정지·마커·처리 진행·문서 열기는 시스템 표면(Dynamic Island, 잠금 화면, 제어 센터, 동작 버튼, 메뉴바, Siri, 단축어)에서 끝나야 한다.
3. **끊기지 않는다.** 화면이 꺼져도, 앱이 백그라운드로 가도, 네트워크가 끊겨도 녹음과 업로드가 이어진다.
4. **기기에서 할 수 있는 일은 기기에서 한다.** 실시간 자막, 스캔 PDF의 글자 인식, 제목·폴더 추천은 온디바이스로 먼저 시도해 토큰 비용을 줄인다. 단, 서버 단계를 대체하는 것은 [ADR-0006](../adr/0006-harness-provider-abstraction-eval-routing.md)의 평가를 통과한 경우에만 한다.
5. **OS 접근성 기본기를 그대로 받는다.** VoiceOver, Dynamic Type, 동작 줄이기, 키보드 조작, 한국어 IME.

**최소 OS: iOS 26 / iPadOS 26 / macOS 26.**
- SpeechAnalyzer, Foundation Models, `BGContinuedProcessingTask`가 26부터 있다. 메뉴바에 iPhone Live Activity가 보이는 것도 macOS 26부터다.
- 지금 최신이 27이므로 두 메이저 버전을 지원하는 셈이다.
- 27 전용 기능(가로 모드 Dynamic Island 등)은 `#available`로 감싼다.

## 2. 현재 상태 (2026-10-19 점검)

| 클라이언트 | 지금 | 쓰지 않는 네이티브 기능 |
|---|---|---|
| iOS (`apps/ios/LecternApp.swift`, 70줄) | 웹뷰를 띄우는 래퍼와 App Intent 하나. `LecternWebContainer`가 정의돼 있지 않아 빌드되지 않는다. Intent는 운영 URL을 하드코딩했고 인증 헤더를 보내지 않아 실제로는 401이 난다 | 앱 전체 |
| macOS (`apps/macos/.../main.swift`, 1,783줄) | `NSStatusItem` 메뉴바, `AVAudioRecorder` 녹음, Carbon 전역 단축키, 포그라운드 `URLSession` 업로드. macOS 13 대상 | Keychain, 알림, App Intents, 위젯, Spotlight, 시스템 오디오 캡처, 캘린더, 백그라운드 업로드, 로그인 시 실행, 자동 업데이트, Handoff |

**바로 고칠 것**: macOS 앱이 API 토큰을 `UserDefaults`에 평문으로 저장한다(`lectern_auth_token`). P6을 기다리지 않고 Keychain으로 옮긴다.

## 3. 공통 구조

```
apps/apple/
  project.yml            XcodeGen 정의 (생성된 .xcodeproj는 커밋하지 않는다)
  Packages/
    LecternKit/          OpenAPI 생성 클라이언트(swift-openapi-generator), 인증(Keychain), 업로드 큐, 모델
    RecorderKit/         AVAudioEngine 녹음, 레벨·무음 경고, 마커, (macOS) 시스템 오디오 탭
    LecternUI/           SwiftUI + Tokens.swift, 문서 블록 렌더러, 전사 동기화 플레이어, PDF 뷰어
    LecternIntents/      App Intents·App Entities (iOS·macOS 공통)
  iOS/                   앱, 위젯 확장(WidgetKit + Live Activity + Controls), 공유 확장
  macOS/                 앱, 위젯 확장, 공유 확장
```

- 위젯·Live Activity·공유 확장은 앱 확장 타깃이라 SwiftPM 실행 파일만으로는 만들 수 없다. 그래서 Xcode 프로젝트를 쓰되, 사람이 고친 `.xcodeproj` 대신 `project.yml`(XcodeGen)을 진실 공급원으로 둔다.
- 앱과 확장은 App Group 컨테이너와 Keychain 접근 그룹을 공유한다. 업로드 대기열, 인증 토큰, 최근 문서 캐시를 확장(위젯, 공유)이 함께 읽는다.
- API 클라이언트는 `packages/domain`이 만든 `openapi.json`에서 생성한다. 손으로 쓴 JSON 파싱을 없앤다.
- 문서·전사 렌더링 규칙(블록 종류, 출처 칩, 원본 오디오 기준 ms)은 웹과 같다. 알 수 없는 블록 종류는 아무것도 그리지 않는다([packages/domain 동결 규칙](../../packages/domain/README.md)).
- `apps/macos`는 새 macOS 앱이 같은 번들 ID(`com.qucord.lectern.macos`)로 대체할 때까지 지금처럼 빌드한다. 번들 ID를 유지해야 마이크 권한(TCC)이 이어진다.

## 4. iOS

| 기능 | Apple API | Lectern에서의 쓰임 | 서버 의존 |
|---|---|---|---|
| **녹음 Live Activity / Dynamic Island** | ActivityKit, `LiveActivityIntent` | 녹음 중 경과 시간(`Text(timerInterval:)`)과 입력 레벨을 compact·minimal·expanded에 표시한다. 일시정지/재개와 **"중요" 마커** 버튼을 둔다. 잠금 화면, StandBy, Apple Watch Smart Stack, CarPlay, (macOS 26+) Mac 메뉴바에도 보인다. iOS 27에서는 가로 모드 Dynamic Island 레이아웃도 점검한다 | 없음 |
| **제어 센터·잠금 화면·동작 버튼에서 녹음** | Controls(`ControlWidget`), `AudioRecordingIntent` | 앱을 열지 않고 녹음을 시작·정지한다. `AudioRecordingIntent`는 녹음을 시작할 때 Live Activity를 띄워야 하므로 위 항목과 한 묶음이다 | 없음 |
| **백그라운드 녹음** | `AVAudioSession`(background audio), 인터럽션·경로 변경 처리 | 화면이 꺼져도 3시간 강의를 녹음한다. 전화가 오면 일시정지하고 끝나면 재개를 제안한다. AirPods·외장 마이크 전환을 처리한다. Live Activity는 최대 8시간 활성이라 한 강의를 덮는다 | 없음 |
| **처리 진행 Live Activity** | ActivityKit 원격 업데이트(APNs), push-to-start | 업로드가 끝나면 같은 Live Activity가 서버 파이프라인 단계(전사 → 구조화 → 추출 → 검증)를 보여 준다. 끝나면 "문서 준비됨"과 열기 링크를 띄운다. Mac에서 올린 녹음도 push-to-start로 iPhone에 띄울 수 있다 | APNs 발송기, 기기 등록 API(§6) |
| **끊기지 않는 업로드** | 백그라운드 `URLSession`, 재개 가능한 업로드(IETF Resumable Uploads, iOS 17+), `BGContinuedProcessingTask`(iOS 26) | 앱이 종료돼도 업로드를 이어 가고, 끊긴 지점부터 다시 보낸다. 사용자가 시작한 큰 업로드는 시스템 진행 UI로 보여 준다 | P2 업로드 API를 IETF 프로토콜과 호환되게(§6) |
| **공유 확장** | Share Extension | 음성 메모, 파일 앱, Zoom·Teams 녹화본, PDF를 Lectern으로 보낸다. 오디오와 PDF를 함께 보내면 웹과 같은 규칙으로 짝짓는다. 녹음 시각을 미디어 메타데이터에서 읽어 `recorded_at`을 보낸다 | v2 업로드 |
| **문서 스캔** | VisionKit 문서 카메라, Vision 텍스트 인식(한국어 지원) | 종이 유인물을 찍어 참고 PDF로 붙인다. 글자 인식을 기기에서 해 텍스트 레이어로 올린다. 서버의 모델 OCR 비용([AI_HARNESS.md `pdf_ingest`](AI_HARNESS.md))을 피한다 | 텍스트 레이어 업로드 필드(§6) |
| **실시간 자막** | SpeechAnalyzer / `SpeechTranscriber` | 녹음 중 화면과 Live Activity expanded에 로컬 자막을 보여 준다. 오프라인 미리보기로 쓴다. 서버 전사를 대체할지는 D1 평가 후보로만 넣는다 | 없음(평가 시 업로드) |
| **온디바이스 제안** | Foundation Models | 제목, 폴더, 도메인(강의·회의 등) 추천과 오프라인 요약 초안을 만든다. 서버 분류 단계를 대체할지는 평가로 정한다 | 없음 |
| **Spotlight·Siri·단축어** | App Intents(`AppEntity`, `IndexedEntity`), App Shortcuts, Core Spotlight | 문서·녹음을 Spotlight에서 찾고 바로 연다. "렉턴으로 녹음 시작", "마지막 회의 문서 열어줘" 같은 한국어 문구를 단다. 기존 단축어 연동은 PAT 기반 Intent로 옮긴다 | v2 읽기 API |
| **위젯** | WidgetKit(홈·잠금 화면, interactive) | 빠른 녹음 버튼, 처리 중 녹음, 최근 문서, 확인할 일정 제안 | v2 읽기 API |
| **캘린더·미리 알림** | EventKit(쓰기 전용 권한) | 확정한 일정·할 일을 기기 캘린더와 미리 알림에 넣는다. iCloud 캘린더 사용자는 Google OAuth 없이 쓸 수 있다(P4 보완). 쓰기 전용 권한이라 기존 일정은 읽지 않는다 | 일정 API(P4) |
| **알림** | UserNotifications(시간 민감 알림, 알림 액션) | 문서 준비, 마감·리마인더. "열기", "공유" 액션 | APNs |
| **집중 모드 필터** | `SetFocusFilterIntent` | "수업" 집중 모드에서는 해당 과목 폴더만 보이게 한다 | 없음 |
| **Handoff·유니버설 링크** | `NSUserActivity`, Associated Domains | Mac에서 보던 문서를 iPhone에서 이어 본다. 공유 링크를 앱에서 연다 | `apple-app-site-association` 서빙(§6) |
| **iPad** | Stage Manager 다중 창, PencilKit + PDFKit | 전사와 PDF를 나란히 띄우고 Pencil로 PDF에 주석을 단다 | 주석 저장 API(후순위) |
| **Apple Watch** (후순위) | watchOS 앱, App Intents | 손목에서 녹음 시작·마커. Live Activity는 Smart Stack에 자동으로 뜬다 | 없음 |

## 5. macOS

| 기능 | Apple API | Lectern에서의 쓰임 |
|---|---|---|
| **메뉴바 녹음 HUD** | `MenuBarExtra`(SwiftUI) | 지금의 `NSStatusItem`을 대체한다. 경과 시간, 레벨, 마커, 처리 진행을 보여 준다 |
| **메인 창** | `NavigationSplitView`, PDFKit | 폴더 → 목록 → 상세(전사·문서·PDF). 웹과 같은 정보 구조 |
| **시스템 오디오 + 마이크 동시 녹음** | Core Audio 프로세스 탭(`CATapDescription`, macOS 14.2+), ScreenCaptureKit 오디오 | Zoom·Teams·Meet·브라우저 소리와 내 마이크를 함께 녹음한다. 채널을 나눠 저장(마이크/시스템)하면 "나"와 "상대"를 가르는 화자 구분 품질이 좋아질 수 있다. 이 효과는 D1 평가에서 확인한다 |
| **회의 자동 감지** | EventKit(읽기 권한, 사용자가 켤 때만), `NSWorkspace` 앱 실행 알림 | 캘린더 회의 시작 시각이나 Zoom 실행에 맞춰 "녹음할까요?" 알림 액션을 띄운다 |
| **전역 단축키** | `RegisterEventHotKey`(지금 방식 유지) | 사용자가 바꿀 수 있게 한다 |
| **로그인 시 실행** | `SMAppService.mainApp` | 설정에서 켜고 끈다 |
| **알림** | UserNotifications | 문서 준비, 회의 녹음 제안 |
| **App Intents·Spotlight** | App Intents, Core Spotlight | 단축어 앱, Spotlight에서 바로 녹음 시작·문서 열기(macOS 26 Spotlight 동작) |
| **위젯** | WidgetKit(데스크톱, 알림 센터) | 처리 중 녹음, 최근 문서 |
| **공유·서비스** | Share Extension, 서비스 메뉴, Finder 드래그 앤 드롭 | Finder·메일 첨부의 오디오·PDF를 바로 올린다 |
| **iPhone Live Activity 표시** | (macOS 26, iPhone 미러링) | iPhone에서 녹음·처리 중이면 Mac 메뉴바에도 보인다. 앱 쪽 추가 작업은 없고 iOS 앱이 있어야 한다 |
| **Handoff** | `NSUserActivity` | iPhone과 문서·녹음 상세를 이어 본다 |
| **온디바이스** | SpeechAnalyzer, Vision, Foundation Models | iOS와 같다(실시간 자막, 스캔 PDF 글자 인식, 제목·폴더 추천) |
| **배포** | Developer ID 서명·공증(D7), Sparkle 2(EdDSA 서명, appcast는 GitHub Release) | Gatekeeper 경고 없이 설치하고 앱 안에서 업데이트한다. Hardened Runtime과 마이크·시스템 오디오 권한 문구를 넣는다 |
| **인증** | Keychain | 토큰을 Keychain에만 둔다(§2 바로 고칠 것) |

## 6. 서버·도메인에 필요한 것

모두 하위 호환 추가다. `packages/domain` 변경은 그 패키지를 소유한 흐름에 요청한다.

- **APNs 발송기**
  - 토큰 기반 인증(`.p8` 키)을 쓴다. 키는 `/etc/lectern/lectern.env`에 두고 [시크릿 교체 런북](../runbooks/secret-rotation.md)에 항목을 추가한다.
  - 워커가 처리 단계가 바뀔 때만 Live Activity 업데이트를 보낸다(`apns-push-type: liveactivity`). 시스템이 업데이트 빈도를 제한하므로 진행률마다 보내지 않는다.
  - Pi에서 HTTP/2로 `api.push.apple.com`에 붙는다. Bun의 HTTP/2 클라이언트 동작은 먼저 검증한다(§8).
- **기기·활동 토큰 API**
  - 기기 등록(플랫폼, 알림 토큰, push-to-start 토큰)과 녹음별 Live Activity 토큰.
  - 토큰은 워크스페이스·사용자 범위로 저장하고, 로그아웃이나 기기 삭제 때 지운다.
- **녹음 마커**
  - `recording_marker`: 원본 오디오 기준 ms와 선택적 라벨.
  - 하네스가 마커 구간을 중요 구간 힌트로 쓴다. [AI_HARNESS.md](AI_HARNESS.md)의 구조화 단계 입력에 추가한다.
- **온디바이스 결과 업로드**
  - 선택 필드: 기기 OCR 텍스트 레이어(페이지별), 기기 자막(평가용).
  - 하네스는 이 값을 신뢰도가 낮은 입력으로만 쓰고, 대체 여부는 평가로 정한다.
- **재개 가능한 업로드**
  - P2의 청크 업로드를 IETF Resumable Uploads 초안과 호환되게 만든다.
  - 그러면 iOS·macOS의 `URLSession`이 재개를 스스로 처리한다. P2 웹·서버 흐름에 전달한다.
- **`apple-app-site-association`**
  - 유니버설 링크와 웹 자격 증명 공유에 쓴다. Hono 라우트로 서빙한다.
- **Sign in with Apple**
  - App Store 심사 지침 4.8은 Google 같은 제3자 로그인을 넣으면 개인정보 보호 수준이 같은 로그인 옵션을 함께 요구한다.
  - P5 로그인 수단에 Sign in with Apple을 추가한다.
- **앱 안에서 계정 삭제**
  - 지침 5.1.1(v)가 요구한다. P5의 계정 삭제를 iOS 앱에서도 열 수 있게 한다.
- **개인정보처리방침과 App Store 개인정보 라벨**
  - 방침에 Apple(APNs)을 처리자로 넣고, 온디바이스 처리 범위를 적는다.

## 7. 단계와 순서

ROADMAP의 P6을 "Apple 네이티브"로 바꾸고, 웹(P2)처럼 픽스처로 먼저 시작한다. Android·Windows 이전은 P6 뒤쪽에 둔다.

| 묶음 | 시점 | 내용 | 끝의 기준 |
|---|---|---|---|
| N0 | 지금 | macOS 토큰을 Keychain으로 옮긴다. 기존 사용자는 첫 실행 때 옮긴다 | `UserDefaults`에 토큰이 남지 않는다 |
| N1 기반 | P2 4주차부터(픽스처) | `apps/apple` 구조와 XcodeGen, `LecternKit`(생성 클라이언트·Keychain·백그라운드 업로드 큐), `RecorderKit`, `LecternUI` 토큰 연결, CI의 iOS·macOS 빌드 | 시뮬레이터와 Mac에서 픽스처 문서를 열고 녹음 파일을 만든다 |
| N2 iOS 녹음 | N1 뒤 | `AudioRecordingIntent` + 녹음 Live Activity/Dynamic Island + Controls + 백그라운드 녹음 + 공유 확장 + 네이티브 문서 리더. TestFlight 배포 | 잠금 화면에서 3시간 녹음 → 업로드 → 문서 확인을 앱을 열지 않고(문서 확인 제외) 끝낸다 |
| N3 macOS 재작성 | N2와 병렬 가능 | 시스템 오디오 탭, 회의 감지, `MenuBarExtra`, 메인 창, 로그인 시 실행, Sparkle, 공증 | 기존 `apps/macos`를 대체하고 마이크 권한이 업데이트 뒤에도 유지된다 |
| N4 시스템 표면 | API v2 + APNs 준비 뒤 | 처리 진행 Live Activity(APNs, push-to-start), Spotlight·Siri·위젯, 유니버설 링크, Handoff, EventKit 일정 등록(P4와 함께) | 업로드 뒤 앱을 열지 않고 Dynamic Island에서 "문서 준비됨"을 받는다 |
| N5 온디바이스 | 평가 게이트 | `SpeechTranscriber` 자막, Vision OCR, Foundation Models 제안. ADR-0006 평가를 통과한 것만 서버 단계를 대체한다 | 평가 리포트와 비용 비교(D11 기준) |
| 후순위 | — | iPad(Pencil 주석, 다중 창), Apple Watch | — |

App Store 공개는 P5(계정·Sign in with Apple·계정 삭제) 뒤에 한다. 그 전에는 TestFlight로 배포한다.

## 8. 확인할 것

이 문서를 쓰면서 1차 자료로 확정하지 못한 사실이다. 구현 전에 실제 SDK와 기기에서 확인한다.

- **`SpeechTranscriber`의 한국어 지원**
  - Apple 문서에서 `ko_KR` 목록을 찾지 못했다.
  - 기기에서 `SpeechTranscriber.supportedLocales`와 `supportedLocale(equivalentTo:)`로 확인하고, `AssetInventory`로 모델을 받는다. 시뮬레이터는 지원하지 않는다는 보고가 있다.
- **Foundation Models의 한국어 품질**
  - 지원 언어 목록에 한국어가 있다는 것은 2차 자료로만 확인했다.
  - 요약·분류 품질은 평가로 잰다.
- **Live Activity 정책**
  - 활성 시간 상한(8시간 + 잠금 화면 4시간), APNs 업데이트 빈도 제한, 가로 모드 Dynamic Island 레이아웃 API를 iOS 27 SDK 문서로 확인한다.
- **Bun의 HTTP/2 클라이언트**
  - Bun의 `node:http2` 클라이언트로 APNs에 붙는지 Pi(aarch64)에서 확인한다.
  - 안 되면 워커가 작은 발송 모듈을 따로 쓴다.
- **Core Audio 프로세스 탭 권한**
  - 시스템 오디오 녹음 권한 프롬프트와 공증 빌드에서의 동작을 macOS 26·27에서 확인한다.

참고 자료
- [Live Activities essentials — WWDC26 Session 223](https://developer.apple.com/videos/play/wwdc2026/223/)
- [SpeechTranscriber 문서](https://developer.apple.com/documentation/speech/speechtranscriber.md)
- [SpeechAnalyzer 포럼 스레드](https://developer.apple.com/forums/thread/790108)
- [macOS Tahoe 26 발표(메뉴바의 iPhone Live Activity)](https://www.apple.com/ph/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever)
- [Foundation Models 개요(2차 자료)](https://www.natashatherobot.com/p/apple-foundation-models)
