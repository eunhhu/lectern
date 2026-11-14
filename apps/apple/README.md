# Lectern Apple 앱 (`apps/apple`)

iOS·macOS용 새 Lectern 앱이다. XcodeGen 정의(`project.yml`) 하나에서 iOS 앱, macOS 앱, 위젯 확장, 공유 확장이 생성되고, 기능은 Swift 패키지 네 개에 나눠 둔다(CONTRACTS §6.2, NATIVE §3). 최소 OS는 iOS 26 / macOS 26이다.

```
apps/apple/
  project.yml                         XcodeGen (생성된 .xcodeproj는 커밋하지 않는다)
  Config/Base.xcconfig                공통 빌드 설정. 서명 값은 Local.xcconfig에서 읽는다
  Packages/LecternKit/                API 클라이언트, Keychain 인증, 업로드 큐, 모델
  Packages/RecorderKit/               AVAudioEngine 녹음, 레벨, 마커, (macOS) 시스템 오디오 탭
  Packages/LecternUI/                 SwiftUI 토큰, 문서 블록 렌더러, 전사 동기화 플레이어
  Packages/LecternIntents/            App Intents, App Entities
  iOS/  (App, Widgets: Live Activity·Controls, Share)
  macOS/ (App: MenuBarExtra + 메인 창)
  scripts/gate.sh                     Apple 게이트
  MANUAL_CHECKS.md                    실제 기기에서만 확인되는 것
```

iOS 앱에는 로그인, 라이브러리, 녹음 상세, 설정 화면이 있다(P6-A6, 아래). macOS 앱은 아직 "Lectern" 글자 하나뿐이다. LecternKit에는 API 클라이언트, 인증, 업로드 큐가 있고(P6-A2·A3), RecorderKit에는 녹음 엔진이(P6-A4), LecternUI에는 문서·전사·플레이어 부품과 화면 뷰모델이 있다(P6-A5·A6).

## API 클라이언트 (LecternKit)

- 클라이언트는 `packages/domain/openapi.json`에서 `swift-openapi-generator` SwiftPM 플러그인이 빌드 때 만든다(D-P6-7). 생성 코드와 그 입력은 커밋하지 않는다. 게이트의 `scripts/pre-gate-openapi.sh`가 입력을 `Packages/LecternKit/Sources/LecternKit/openapi.json`에 쓴다. Xcode에서만 빌드할 때는 먼저 그 스크립트를 한 번 돌린다.
- 입력은 그대로 복사하지 않고 `scripts/openapi-for-swift.py`로 세 가지를 고친다. 생성기가 zod의 표기를 다르게 읽기 때문이다. ① `anyOf: [X, null]`(nullable 참조)은 생성기가 속성째 버린다 → `X`로 바꾸고 `required`에서 뺀다(생성 필드가 옵셔널). ② 판별자가 있는 `oneOf`의 가지가 인라인 객체이면(`SourceRef`, `NativeTokenRequest`) 케이스 없는 enum이 된다 → 가지마다 컴포넌트(`SourceRefPdfPage` 등)와 `mapping`을 만든다. ③ 문자열 `enum`은 모르는 값에서 던지는 Swift enum이 된다. domain의 enum은 모두 열려 있다 → `enum`을 지우고(문자열) 모델에서 `unknown`으로 받는다.
- 앱은 생성 타입(`internal`)을 보지 않는다. `LecternAPI`(목록·상세·전사·문서·자산 요청)와 `Models/`의 값 타입만 쓴다. 모르는 블록 `type`은 `DocumentBlock.unknown`, 모르는 출처 `kind`는 빠진다(`OpenUnionMiddleware`).
- 인증은 `AuthProvider` 뒤에 있다. `ApiTokenProvider`는 v1 API 토큰(`X-Lectern-Token`), `NativeTokenProvider`는 네이티브 토큰 쌍(D-P5-4, `Authorization: Bearer`)이다. 401이면 refresh를 한 번 하고 한 번만 다시 보낸다. 동시에 여러 요청이 401을 받아도 refresh는 한 번이다. 토큰은 Keychain(`KeychainTokenStore`, 서비스 `com.qucord.lectern`, 앱이 넘기는 접근 그룹)에만 둔다.
- 업로드는 `Upload/`의 `UploadQueue`(actor)다(P6-A3, D-P6-6). 대기열은 App Group 컨테이너의 `UploadQueue/<id>.json`(항목마다 파일 하나, 원자적 쓰기)이라 공유 확장·위젯도 같이 본다. 항목 id가 `createUpload`·`completeUpload`의 `Idempotency-Key`다. 재개할 때는 서버의 `received_parts`가 기준이고, 파트는 파일의 그 구간만 읽어 보낸다(메모리에 올리지 않는다). 백그라운드 `URLSession` 연결은 `BackgroundUploader`이고 단위 테스트가 없다(`MANUAL_CHECKS.md` 1–3).
- 패키지 의존(GitHub)을 받아야 하므로 처음 게이트는 네트워크가 필요하다. 버전은 `Packages/LecternKit/Package.resolved`에 고정돼 있다.

## 녹음 (RecorderKit)

- `Recorder`(actor)가 마이크를 AAC .m4a(44.1kHz, 모노, 64kbps — 기존 macOS 앱과 같은 값)로 쓴다. 입력은 `EngineAudioInput`(AVAudioEngine 탭, 하드웨어 형식은 `BufferConverter`로 파일 형식에 맞춘다), 파일은 `FileAudioSink`. 녹음마다 새 `Recorder`를 만든다.
- 일시정지 중에는 파일에 쓰지 않는다. 그래서 파일 길이 = 일시정지를 뺀 시간이고, 마커 시각(`addMarker`)은 쓴 프레임 수로 계산해 서버 전사의 시간축과 같다.
- 상태 전이는 순수 함수 `reduce`(P6-A4 명세의 표). 사용자가 일시정지했으면 시스템(통화 끝, 이어폰 복귀)이 재개하지 않는다. 통화·경로 끊김 뒤에는 엔진이 멈춰 있으므로 다음 재개 때 입력을 다시 시작하고, 시작하지 못하면 일시정지 상태로 남는다.
- iOS는 `SessionCoordinator`가 오디오 세션(`.playAndRecord`, 블루투스 HFP, 스피커)을 켜고 통화·경로 변경 알림을 `Recorder.handle`로 넘긴다. 마이크 권한 문구(`NSMicrophoneUsageDescription`)와 백그라운드 오디오(`UIBackgroundModes: audio`)는 `project.yml`에 있다. 권한 요청(`AVAudioApplication.requestRecordPermission`)은 앱이 녹음 전에 한다.
- `levels`(0…1, 오디오 시간 기준 초당 최대 10번)와 `silenceWarning`(녹음 시간으로 20초 무음)은 읽을 때마다 새 스트림이다. 화면과 Live Activity가 함께 읽을 수 있다.
- 저장 공간이 200MB 아래면 시작하지 않는다. 쓰기에 실패하면 `failed`가 되고 그때까지의 파일은 지우지 않는다. m4a는 녹음 중 앱이 죽으면 읽을 수 없다(MANUAL_CHECKS 9).

## 화면 부품 (LecternUI)

- 디자인 토큰은 `packages/design-tokens/dist/Tokens.swift`를 `Packages/LecternUI/Sources/LecternUI/Tokens/`에 **복사해 커밋한다**(SwiftPM은 패키지 밖 파일을 못 읽는다). 게이트의 `scripts/pre-gate-tokens.sh`는 두 파일이 다르면 멈추고 복사 명령을 알려 준다(대신 복사하지 않는다). 토큰을 바꾼 뒤에는 `bun run tokens:build` → 복사.
- 화면 코드는 `Theme`의 색 이름과 `.lecternFont(<역할>)`만 쓴다. 색 16진수와 글자 크기 숫자를 쓰지 않는다. `Font.system(size:weight:)`에는 `relativeTo:`가 없어 `lecternFont`가 `@ScaledMetric(relativeTo:)`로 Dynamic Type을 따른다.
- `DocumentView(document:transcript:onSource:)`: 웹 DocumentPane과 같은 규칙. 모르는 블록은 그리지 않는다. 블록 글은 일반 텍스트다(Markdown으로 읽지 않는다). 섹션이 없는 옛 노트는 Markdown(인라인만)으로 보인다. 출처 칩은 전사가 있어야 시각(`12:05`)을 보이고, 구간을 찾지 못하면 "원본 없음", 출처가 없으면 "출처 확인 필요".
- `TranscriptList`는 재생 위치를 따라 현재 구간을 강조하고 스크롤한다. 사용자가 스크롤하면 멈춘 뒤 5초 동안 따라가지 않는다. `PlayerViewModel`/`PlayerBar`는 첫 재생 때 항목을 불러온다.
- 뷰 모양은 스냅샷 테스트하지 않는다. 라벨·시간 표기·그릴 블록·출처 해석은 순수 함수로 테스트한다. 미리보기는 `Preview/PreviewData.swift`(블록 종류마다 밝은·어두운·가장 큰 글자).

## iOS 앱 (P6-A6)

- 화면: 로그인(이메일·비밀번호, 서버 주소, API 토큰으로 로그인), 라이브러리(`NavigationSplitView`: 워크스페이스·폴더 | 녹음 목록 | 상세, iPhone은 스택), 녹음 상세(문서/전사 탭, iPad 가로는 나란히, 아래 플레이어), 설정(계정, 서버, 버전, 로그아웃, 계정 삭제·방침·약관은 Safari). 웹뷰는 쓰지 않는다.
- 서버 주소: 사용자가 바꾼 값(`UserDefaults` `lectern_server_url`) → 없으면 `Info.plist`의 `LecternServerURL`(빌드 설정 `LECTERN_SERVER_URL`, `Local.xcconfig`에서 바꾼다). 서버를 바꾸면 로그아웃한다.
- 로그인: 서버가 native 토큰 라우트에 501·404를 주면(P5-03 전 서버) API 토큰 로그인으로 바뀐다. 토큰은 Keychain에만 둔다.
- 오디오: `?token=`에 자격을 넣은 자산 주소를 AVPlayer에 준다(헤더를 못 붙인다). native 접근 토큰은 1시간이라, 재생 중 항목이 실패하면 새 주소로 한 번 다시 불러 같은 위치에서 잇는다.
- 픽스처 모드: 실행 인자 `-LECTERN_FIXTURE 1`(또는 환경 변수 `LECTERN_FIXTURE=1`)이면 서버 없이 예시 데이터(폴더 3, 녹음 8)로 로그인된 채 시작한다. Xcode 스킴의 Arguments에 넣어 화면을 볼 수 있다.
- UI 테스트(`LecterniOSUITests`, 픽스처 모드로 녹음을 열고 전사 탭까지)는 게이트가 빌드만 한다(`build-for-testing`). 실행: `xcodebuild test -project apps/apple/Lectern.xcodeproj -scheme LecterniOS -destination 'platform=iOS Simulator,name=iPhone 17'`.

## 처음 실행

1. 서명 값을 로컬 파일에 둔다. 이 파일은 커밋하지 않는다(`.gitignore`).
   ```bash
   cp apps/apple/Local.xcconfig.example apps/apple/Local.xcconfig
   ```
   `DEVELOPMENT_TEAM`에 자기 팀 id를, `LECTERN_SERVER_URL`에 붙을 서버 주소를 적는다. 비워 두면 서버는 `http://localhost:18775`다.
2. 프로젝트를 만든다.
   ```bash
   cd apps/apple && xcodegen generate
   ```
3. Xcode에서 `apps/apple/Lectern.xcodeproj`를 열고 `LecterniOS` 또는 `LecternMac` 스킴을 실행한다.

## 게이트

```bash
bash apps/apple/scripts/gate.sh
```

프로젝트를 생성하고, 패키지 네 개의 `swift test`를 돌리고, 두 앱을 서명 없이(`CODE_SIGNING_ALLOWED=NO`) 빌드한다. 마지막 줄이 `gate: apple ok`이면 통과다. 이후 작업이 `scripts/pre-gate-*.sh`에 단계(토큰 동기화, OpenAPI 복사)를 더한다. 서명 없이 빌드하면 App Group과 Keychain 접근 그룹은 실제로 동작하지 않는다. 그런 동작은 `MANUAL_CHECKS.md`에 적고 실제 기기에서 확인한다.

## 규칙

- `.xcodeproj`는 커밋하지 않는다. `project.yml`을 고치고 `xcodegen generate`로 다시 만든다.
- Info.plist와 `.entitlements`는 `project.yml`의 `info.properties`·`entitlements.properties`에서 XcodeGen이 매번 다시 쓴다. 파일을 직접 고치면 다음 생성 때 사라진다.
- 팀 id, 실제 서버 주소, 개인 이름은 저장소에 넣지 않는다(`Local.xcconfig`에만).
- iOS 전용 API를 쓰는 패키지 코드는 `#if os(iOS)`나 `#if canImport(ActivityKit)` 안에 둔다. `swift test`는 macOS 호스트에서 돈다.
- 기존 `apps/macos`(메뉴바 앱)와 `apps/ios`(단축어)는 그대로 둔다(D-P6-11). 이 앱이 그것을 대신할 때까지 함께 있다.
