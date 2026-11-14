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

화면은 아직 "Lectern" 글자 하나뿐이다. LecternKit에는 API 클라이언트와 인증이 있다(P6-A2, 아래).

## API 클라이언트 (LecternKit)

- 클라이언트는 `packages/domain/openapi.json`에서 `swift-openapi-generator` SwiftPM 플러그인이 빌드 때 만든다(D-P6-7). 생성 코드와 그 입력은 커밋하지 않는다. 게이트의 `scripts/pre-gate-openapi.sh`가 입력을 `Packages/LecternKit/Sources/LecternKit/openapi.json`에 쓴다. Xcode에서만 빌드할 때는 먼저 그 스크립트를 한 번 돌린다.
- 입력은 그대로 복사하지 않고 `scripts/openapi-for-swift.py`로 세 가지를 고친다. 생성기가 zod의 표기를 다르게 읽기 때문이다. ① `anyOf: [X, null]`(nullable 참조)은 생성기가 속성째 버린다 → `X`로 바꾸고 `required`에서 뺀다(생성 필드가 옵셔널). ② 판별자가 있는 `oneOf`의 가지가 인라인 객체이면(`SourceRef`, `NativeTokenRequest`) 케이스 없는 enum이 된다 → 가지마다 컴포넌트(`SourceRefPdfPage` 등)와 `mapping`을 만든다. ③ 문자열 `enum`은 모르는 값에서 던지는 Swift enum이 된다. domain의 enum은 모두 열려 있다 → `enum`을 지우고(문자열) 모델에서 `unknown`으로 받는다.
- 앱은 생성 타입(`internal`)을 보지 않는다. `LecternAPI`(목록·상세·전사·문서·자산 요청)와 `Models/`의 값 타입만 쓴다. 모르는 블록 `type`은 `DocumentBlock.unknown`, 모르는 출처 `kind`는 빠진다(`OpenUnionMiddleware`).
- 인증은 `AuthProvider` 뒤에 있다. `ApiTokenProvider`는 v1 API 토큰(`X-Lectern-Token`), `NativeTokenProvider`는 네이티브 토큰 쌍(D-P5-4, `Authorization: Bearer`)이다. 401이면 refresh를 한 번 하고 한 번만 다시 보낸다. 동시에 여러 요청이 401을 받아도 refresh는 한 번이다. 토큰은 Keychain(`KeychainTokenStore`, 서비스 `com.qucord.lectern`, 앱이 넘기는 접근 그룹)에만 둔다.
- 패키지 의존(GitHub)을 받아야 하므로 처음 게이트는 네트워크가 필요하다. 버전은 `Packages/LecternKit/Package.resolved`에 고정돼 있다.

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
- 팀 id, 실제 서버 주소, 개인 이름은 저장소에 넣지 않는다(`Local.xcconfig`에만).
- iOS 전용 API를 쓰는 패키지 코드는 `#if os(iOS)`나 `#if canImport(ActivityKit)` 안에 둔다. `swift test`는 macOS 호스트에서 돈다.
- 기존 `apps/macos`(메뉴바 앱)와 `apps/ios`(단축어)는 그대로 둔다(D-P6-11). 이 앱이 그것을 대신할 때까지 함께 있다.
