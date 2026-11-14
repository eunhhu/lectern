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

지금은 뼈대다. 화면은 "Lectern" 글자 하나뿐이고, 패키지마다 이름을 확인하는 테스트 하나가 있다.

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
