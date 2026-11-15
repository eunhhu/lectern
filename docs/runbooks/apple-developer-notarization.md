# 체크리스트: Apple Developer ID 서명과 공증 (D7)

> 결정: [ROADMAP.md D7](../v2/ROADMAP.md#결정-필요-사항) — "예". 배경: [ADR-0005](../adr/0005-native-priority-macos.md).
> 대상: `apps/macos` (번들 ID `com.qucord.lectern.macos`). CI 적용은 P6에서 한다.
> 신청과 인증서 발급은 운영자가 직접 한다. Apple 계정 암호, `.p12`, `.p8` 파일은 저장소와 채팅에 올리지 않는다.

## 0. 왜 하는가, 무엇이 바뀌는가

- 지금 `apps/macos/build-app.sh`는 ad-hoc 서명(`codesign --force --deep --sign -`)을 한다.
  - 내려받은 앱을 Gatekeeper가 막는다("확인되지 않은 개발자").
  - 빌드마다 서명이 바뀌어 macOS 개인정보 보호 설정(TCC)이 같은 앱으로 보지 않는다. 그래서 업데이트할 때마다 마이크 권한이 풀린다.
- Developer ID로 서명하고 공증(notarization)하면, 내려받아도 경고 없이 열리고 같은 서명 요구 사항이 유지돼 마이크 권한도 업데이트 뒤에 그대로 남는다. 처음 공증 빌드로 바꿀 때 한 번만 다시 묻는다.

| 단계 | 시점 | 걸리는 시간 |
|---|---|---|
| §1 Apple Developer Program 가입 | P5 전 아무 때(빠를수록 좋음) | 결제 후 보통 1~2일. 신원 확인이 걸리면 더 길다 |
| §2 Developer ID Application 인증서 | 가입 직후 | 10분 |
| §3 공증 자격 증명(App Store Connect API 키) | 가입 직후 | 10분 |
| §4 로컬에서 서명·공증 한 번 해 보기 | 가입 직후 | 30분 |
| §5 GitHub 시크릿 등록 | §4 성공 후 | 10분 |
| §6 CI 공증 적용 | P6 | P6 작업에 포함 |

## 1. Apple Developer Program 가입

1. Apple 계정에 이중 인증을 켠다(필수).
2. 가입 유형을 정한다.
   - **개인(Individual)**: 연 99달러(현지 통화로 청구될 수 있음). 서명 인증서와 Gatekeeper·앱 정보에 **운영자의 법적 실명이 개발자 이름으로 공개된다.**
   - **조직(Organization)**: 법인이 있어야 하고 D-U-N-S 번호가 필요하다. 개발자 이름이 법인명으로 표시된다. 준비에 몇 주가 걸릴 수 있다.
   - 법인이 없으면 개인으로 시작한다. 나중에 조직으로 옮길 수 있지만 인증서를 다시 발급해야 한다.
3. Mac이나 iPhone의 **Apple Developer 앱** → Account → Enroll now(또는 [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/))로 가입하고 결제한다.
4. 승인 메일을 받으면 [developer.apple.com/account](https://developer.apple.com/account) → Membership details에서 **Team ID**(10자리)를 확인해 기록한다(§8).

검증: developer.apple.com/account에 "Apple Developer Program" 멤버십과 만료일이 보인다. 멤버십은 매년 갱신해야 새 빌드를 서명·공증할 수 있다(이미 배포한 공증 앱은 멤버십이 끝나도 계속 실행된다).

## 2. Developer ID Application 인증서

Developer ID 인증서는 **Account Holder**만 만들 수 있다(개인 가입이면 본인). 팀당 최대 5개까지 만들 수 있다.

1. 서명에 쓸 Mac에서 인증서 서명 요청(CSR)을 만든다.
   - 키체인 접근 → 메뉴 키체인 접근 → 인증서 지원 → 인증 기관에서 인증서 요청
   - 이메일: Apple 계정 이메일, 일반 이름: `Lectern Developer ID`, "디스크에 저장됨" 선택 → `.certSigningRequest` 저장
2. [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list) → Certificates → `+` → Software 아래 **Developer ID** → **Developer ID Application** → Continue → CSR 업로드 → Download.
3. 내려받은 `.cer`을 더블클릭해 로그인 키체인에 설치한다.
4. 확인한다.
   ```bash
   security find-identity -v -p codesigning
   ```
   `"Developer ID Application: <이름> (<TEAMID>)"`가 보여야 한다. 이 전체 문자열이 서명 ID다.
5. CI용으로 인증서와 개인 키를 `.p12`로 내보낸다.
   - 키체인 접근 → 로그인 → 내 인증서 → `Developer ID Application: …`를 펼쳐 개인 키가 함께 있는지 확인 → 오른쪽 클릭 → 내보내기 → `.p12`
   - 강한 암호를 걸고, 그 암호를 비밀번호 관리자에 저장한다.
   - `.p12` 파일 자체도 비밀번호 관리자나 암호화된 저장소에 보관한다. 이 파일이 있으면 누구나 운영자 이름으로 앱을 서명할 수 있다.

## 3. 공증 자격 증명

CI에서는 Apple 계정 암호 대신 **App Store Connect API 키**를 쓴다(계정 암호와 이중 인증이 필요 없고, 따로 폐기할 수 있다).

1. [App Store Connect](https://appstoreconnect.apple.com/) → Users and Access → Integrations → App Store Connect API → Team Keys → `+`
   - 이름 `lectern-notarytool`, 역할(Access) **Developer**
2. `AuthKey_<KEYID>.p8`을 내려받는다. **한 번만 내려받을 수 있다.** 비밀번호 관리자나 암호화된 저장소에 보관한다.
3. 같은 화면에서 **Key ID**(10자)와 **Issuer ID**(UUID)를 기록한다(§8).
4. 로컬 Mac에 notarytool 프로필을 저장한다. 키체인에 `lectern-notary`라는 이름으로 들어가고, 저장할 때 자격 증명이 유효한지도 확인한다.
   ```bash
   xcrun notarytool store-credentials "lectern-notary" --key ~/secure/AuthKey_<KEYID>.p8 --key-id <KEYID> --issuer <ISSUER-ID>
   ```
   ```bash
   xcrun notarytool history --keychain-profile "lectern-notary"
   ```
   두 번째 명령이 오류 없이 (빈) 목록을 보여 주면 된다.

API 키를 만들 수 없으면 대안으로 Apple 계정 + 앱 암호를 쓴다. [appleid.apple.com](https://appleid.apple.com) → 로그인 및 보안 → 앱 암호에서 만들고 `xcrun notarytool store-credentials "lectern-notary" --apple-id <Apple 계정> --team-id <TEAMID>`로 저장한다(암호는 프롬프트로 입력).

## 4. 로컬에서 서명·공증 한 번 해 보기

`apps/macos`에서 진행한다. 이 절차가 성공해야 CI로 옮긴다.

1. 권한(entitlements) 파일을 만든다. Hardened Runtime에서 마이크를 쓰려면 `audio-input` 권한이 필요하다. 이 파일은 P6에서 `apps/macos/Lectern.entitlements`로 저장소에 넣는다.
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>com.apple.security.device.audio-input</key>
     <true/>
   </dict>
   </plist>
   ```
2. 앱을 만든다(현재 스크립트는 마지막에 ad-hoc으로 서명하지만, 다음 단계에서 덮어쓴다).
   ```bash
   cd apps/macos && ./build-app.sh
   ```
3. Developer ID와 Hardened Runtime, 보안 타임스탬프로 다시 서명한다. `--deep`은 쓰지 않는다(중첩 코드가 생기면 안쪽부터 하나씩 서명한다).
   ```bash
   codesign --force --options runtime --timestamp --entitlements Lectern.entitlements --sign "Developer ID Application: <이름> (<TEAMID>)" Lectern.app
   ```
   ```bash
   codesign --verify --strict --verbose=2 Lectern.app && codesign -d --entitlements - Lectern.app
   ```
4. 압축해서 공증을 요청하고 결과를 기다린다(보통 몇 분).
   ```bash
   ditto -c -k --keepParent Lectern.app Lectern-notarize.zip
   ```
   ```bash
   xcrun notarytool submit Lectern-notarize.zip --keychain-profile "lectern-notary" --wait
   ```
   `status: Accepted`가 나와야 한다. `Invalid`이면 원인을 본다.
   ```bash
   xcrun notarytool log <submission-id> --keychain-profile "lectern-notary"
   ```
5. 공증 티켓을 앱에 붙이고(staple) 배포용 zip을 다시 만든다. 공증 요청에 쓴 zip은 티켓이 없으니 배포하지 않는다.
   ```bash
   xcrun stapler staple Lectern.app && xcrun stapler validate Lectern.app
   ```
   ```bash
   rm -f Lectern-notarize.zip Lectern-macOS-arm64.zip && ditto -c -k --sequesterRsrc --keepParent Lectern.app Lectern-macOS-arm64.zip
   ```
6. 검증한다.
   ```bash
   spctl --assess --type execute -vv Lectern.app
   ```
   `accepted`와 `source=Notarized Developer ID`가 보여야 한다. 마지막으로 zip을 다른 Mac(또는 다른 사용자 계정)에 내려받아 열었을 때 경고 없이 열리고, 녹음을 시작하면 마이크 권한을 한 번만 묻는지 확인한다.

## 5. GitHub 시크릿 등록

저장소 `eunhhu/lectern`에 등록한다. 값은 파일이나 프롬프트로 넣어 셸 기록에 남기지 않는다.

| 시크릿 | 값 | 넣는 방법 |
|---|---|---|
| `MACOS_DEVELOPER_ID_P12_BASE64` | §2의 `.p12`를 base64로 인코딩한 값 | `base64 -i DeveloperID.p12 \| gh secret set MACOS_DEVELOPER_ID_P12_BASE64 --repo eunhhu/lectern` |
| `MACOS_DEVELOPER_ID_P12_PASSWORD` | `.p12` 암호 | `gh secret set MACOS_DEVELOPER_ID_P12_PASSWORD --repo eunhhu/lectern` (프롬프트에 입력) |
| `MACOS_SIGNING_IDENTITY` | `Developer ID Application: <이름> (<TEAMID>)` | 프롬프트로 입력 |
| `MACOS_CI_KEYCHAIN_PASSWORD` | CI 임시 키체인용 무작위 문자열 | `openssl rand -hex 24 \| gh secret set MACOS_CI_KEYCHAIN_PASSWORD --repo eunhhu/lectern` |
| `APPLE_TEAM_ID` | Team ID(10자) | 프롬프트로 입력 |
| `APP_STORE_CONNECT_API_KEY_P8_BASE64` | §3의 `.p8`을 base64로 인코딩한 값 | `base64 -i AuthKey_<KEYID>.p8 \| gh secret set APP_STORE_CONNECT_API_KEY_P8_BASE64 --repo eunhhu/lectern` |
| `APP_STORE_CONNECT_API_KEY_ID` | Key ID | 프롬프트로 입력 |
| `APP_STORE_CONNECT_API_ISSUER_ID` | Issuer ID | 프롬프트로 입력 |

권장
- 이 시크릿들은 저장소 시크릿 대신 **GitHub Environment**(`macos-signing`)에 넣고, 배포 브랜치를 `main`으로 제한한다. 그러면 PR 브랜치의 워크플로가 서명 키에 접근하지 못한다.
- 등록 확인:
  ```bash
  gh secret list --repo eunhhu/lectern
  ```
  Environment에 넣었다면 `gh secret list --repo eunhhu/lectern --env macos-signing`.

## 6. CI 공증 적용 (P6)

현재 `macos-native` 잡은 PR에서도 돌고 ad-hoc 서명만 한다. P6에서 다음 원칙으로 바꾼다.

- PR에서는 지금처럼 ad-hoc 빌드만 한다. 서명·공증은 **`main` 푸시(또는 `workflow_dispatch`)에서만** 도는 별도 잡이 `macos-signing` Environment로 한다.
- 임시 키체인에 `.p12`를 가져오고, 작업이 끝나면(실패해도) 키체인과 키 파일을 지운다.
- `notarytool`은 API 키 파일로 호출하고 `--wait`로 결과를 기다린다. `Accepted`가 아니면 잡을 실패시키고 로그를 남긴다.
- staple한 앱으로 배포 zip을 만들고, `spctl --assess`로 확인한 뒤 릴리스에 올린다.

단계 스케치(구현할 때 다듬는다)

```yaml
  # 기존 macos-native 잡(ad-hoc 빌드, PR 포함)은 그대로 두고, main에서만 도는 서명 잡을 추가한다.
  # release-native-clients는 이 잡의 산출물(Lectern-macOS-arm64)을 받도록 needs를 바꾼다.
  macos-signed:
    if: github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
    runs-on: macos-15
    environment: macos-signing
    steps:
      - uses: actions/checkout@v4
      - name: Build
        working-directory: apps/macos
        run: ./build-app.sh
      - name: Sign, notarize and staple
        working-directory: apps/macos
        env:
          P12_BASE64: ${{ secrets.MACOS_DEVELOPER_ID_P12_BASE64 }}
          P12_PASSWORD: ${{ secrets.MACOS_DEVELOPER_ID_P12_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.MACOS_CI_KEYCHAIN_PASSWORD }}
          IDENTITY: ${{ secrets.MACOS_SIGNING_IDENTITY }}
          ASC_KEY_BASE64: ${{ secrets.APP_STORE_CONNECT_API_KEY_P8_BASE64 }}
          ASC_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_API_ISSUER_ID }}
        run: |
          set -euo pipefail
          KC="$RUNNER_TEMP/signing.keychain-db"
          echo "$P12_BASE64" | base64 --decode > "$RUNNER_TEMP/devid.p12"
          echo "$ASC_KEY_BASE64" | base64 --decode > "$RUNNER_TEMP/AuthKey.p8"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KC"
          security set-keychain-settings -lut 3600 "$KC"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KC"
          security import "$RUNNER_TEMP/devid.p12" -k "$KC" -P "$P12_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KC" >/dev/null
          security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')
          codesign --force --options runtime --timestamp --entitlements Lectern.entitlements --sign "$IDENTITY" Lectern.app
          ditto -c -k --keepParent Lectern.app notarize.zip
          xcrun notarytool submit notarize.zip --key "$RUNNER_TEMP/AuthKey.p8" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" --wait
          xcrun stapler staple Lectern.app
          spctl --assess --type execute -vv Lectern.app
          rm -f notarize.zip Lectern-macOS-arm64.zip
          ditto -c -k --sequesterRsrc --keepParent Lectern.app Lectern-macOS-arm64.zip
      - name: Clean up signing material
        if: always()
        run: |
          security delete-keychain "$RUNNER_TEMP/signing.keychain-db" 2>/dev/null || true
          rm -f "$RUNNER_TEMP/devid.p12" "$RUNNER_TEMP/AuthKey.p8"
      - uses: actions/upload-artifact@v4
        with:
          name: Lectern-macOS-arm64
          path: apps/macos/Lectern-macOS-arm64.zip
```

산출물 이름이 기존 `macos-native` 잡과 겹치므로, 구현할 때 `macos-native`의 업로드 이름을 바꾸거나(예: `Lectern-macOS-arm64-adhoc`) 업로드를 PR에서만 하게 한다.

검증(P6): `main` 푸시 후 릴리스의 `Lectern-macOS-arm64.zip`을 내려받아 §4.6처럼 `spctl --assess`가 `Notarized Developer ID`로 통과하고, 마이크 권한이 업데이트 뒤에도 유지되는지 확인한다.

## 7. 갱신, 유출, 폐기

- 멤버십은 매년 갱신한다. 끝나도 이미 배포한 공증 앱은 계속 실행되지만 새 빌드는 서명·공증할 수 없다.
- 인증서가 만료돼도 만료 전에 서명하고 타임스탬프를 찍은 앱은 계속 실행된다. 새 빌드에는 새 인증서가 필요하다. 만료일을 §8에 적고 한 달 전에 새 인증서를 만들어 GitHub 시크릿을 바꾼다.
- **`.p12`나 `.p8`이 유출되면**
  - `.p8`: App Store Connect에서 그 API 키를 즉시 폐기(Revoke)하고 새로 만들어 시크릿을 바꾼다.
  - `.p12`: Certificates 페이지에서 인증서를 폐기하고 새로 발급한다. **폐기한 인증서로 서명한 앱은 이미 설치된 것도 더 이상 실행되지 않는다.** 새 인증서로 다시 서명·공증한 빌드를 바로 배포하고 사용자에게 업데이트를 안내한다.

## 8. 기록란

진행하면서 채운다. 시크릿 값은 적지 않는다.
- 가입 유형 / 승인일 / 멤버십 만료일: _
- Team ID: _
- Developer ID Application 인증서 만료일: _
- App Store Connect API Key ID / 만든 날: _
- GitHub Environment `macos-signing` 설정일: _
