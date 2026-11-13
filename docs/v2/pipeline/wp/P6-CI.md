# P6-CI CI: Apple 빌드 작업

> 등급: `careful` · 게이트: `quick` · 의존: `P6-A1` · 소유: `.github/`
> (이 줄은 `pipeline.json`의 값과 같아야 한다.)

## 1. 목표

GitHub Actions에 새 Apple 앱의 게이트(`apps/apple/scripts/gate.sh`)를 돌리는 작업을 더한다. PR과 push에서 돌고, 실패해도 서버 배포를 막지 않는다. 기존 작업은 한 줄도 바꾸지 않는다.

## 2. 먼저 읽을 것

- 계약: `CONTRACTS.md` D-0-11(`main` = 운영 배포), D-P6-9
- 코드: `.github/workflows/ci-cd.yml` 전체 — 작업 `core-and-server`, `web`, `deploy-server`(`needs: [core-and-server]`), `macos-native`(`runs-on: macos-14`), `android-native`, `windows-native`, `release-native-clients`(`needs: [macos-native, android-native, windows-native]`), 그리고 맨 위의 `on:`·`concurrency:`·`permissions:`
- 코드: `apps/apple/scripts/gate.sh`(P6-A1), `apps/apple/README.md`
- 문서: `AGENTS.md`의 CI·배포 절

## 3. 사전 점검

```bash
git grep -n "^  [a-z-]*:$" -- .github/workflows/ci-cd.yml
git grep -n "needs:" -- .github/workflows/ci-cd.yml
test -x apps/apple/scripts/gate.sh && echo gate-present
command -v actionlint || echo "actionlint: none"
```
`gate-present`가 안 나오면 멈춘다(P6-A1이 먼저다). `needs:` 줄 두 개를 적어 둔다(끝에 그대로인지 비교한다).

## 4. 만들 파일과 고칠 파일

| 경로 | 새로/수정 | 무엇 |
|---|---|---|
| `.github/workflows/ci-cd.yml` | 수정 | 작업 `apple` 하나 추가 |

## 5. 단계

1. `windows-native` 작업 뒤, `release-native-clients` 작업 앞에 넣는다(들여쓰기는 파일의 기존 작업과 같게).
   ```yaml
   apple:
     name: "Apple apps (XcodeGen, simulator build, SwiftPM tests)"
     # The new iOS/macOS app (apps/apple). Not part of deploy-server's needs: a red build here must not block a server deploy.
     runs-on: macos-26
     timeout-minutes: 45
     steps:
       - uses: actions/checkout@v4
       - name: Show toolchain
         run: |
           xcodebuild -version
           swift --version
       - name: Install XcodeGen
         run: brew install xcodegen
       - uses: oven-sh/setup-bun@v2
         with:
           bun-version: 1.4.3
       - name: Install workspace dependencies
         run: bun install --frozen-lockfile
       - name: Apple gate
         run: bash apps/apple/scripts/gate.sh
   ```
   - 러너 라벨: iOS 26 SDK(Xcode 26 이상)가 있는 GitHub 호스팅 macOS 러너여야 한다. `macos-26`이 맞는지 GitHub의 러너 이미지 목록으로 확인할 수 없으면(네트워크 없음) 이 라벨을 그대로 쓰고 `DEVIATIONS`에 "러너 라벨 미확인"을 적는다. Xcode를 고르는 단계가 필요하면 `sudo xcode-select -s /Applications/Xcode_<버전>.app`을 `Show toolchain` 앞에 넣는다.
   - Bun 단계는 게이트의 훅이 `packages/design-tokens`와 `packages/domain/openapi.json`을 읽기 때문에 있다(P6-A2, P6-A5). 파일의 다른 작업이 Bun을 설치하는 방식(액션 버전, Bun 버전 표기)이 위와 다르면 **기존 방식에 맞춘다.**
   - 시크릿을 쓰지 않는다. 서명하지 않는다. 산출물을 올리지 않는다.
2. **넣지 않는 곳**: `deploy-server`의 `needs`, `release-native-clients`의 `needs`. 두 줄은 사전 점검 때 적어 둔 것과 같아야 한다.
3. `on:` 트리거, `concurrency`, `permissions`, 다른 작업은 건드리지 않는다. 경로 필터(`paths:`)를 새로 넣지 않는다(기존 작업에 없으면).
4. 문법 확인
   - `actionlint`가 있으면 `actionlint .github/workflows/ci-cd.yml`.
   - 없으면 YAML로 읽히는지 본다: `bun -e 'const y = await import("yaml").catch(() => null); if (!y) { console.log("yaml package not available"); process.exit(0); } const d = y.parse(await Bun.file(".github/workflows/ci-cd.yml").text()); console.log(Object.keys(d.jobs).join(" "));'` — 출력에 `apple`과 기존 작업 이름이 모두 있어야 한다. `yaml` 패키지가 없으면 `ruby -ryaml -e 'puts YAML.load_file(".github/workflows/ci-cd.yml")["jobs"].keys.join(" ")'`를 쓴다.
5. `git diff --stat`이 `.github/workflows/ci-cd.yml` 한 파일이고, `git diff`에 삭제된 줄(`-`로 시작, 헤더 제외)이 없는지 본다.

## 6. 테스트

| 확인 | 기대 |
|---|---|
| 4단계의 문법 확인 | 오류 없음. 작업 목록에 `apple`과 기존 일곱 작업 |
| `git diff .github/workflows/ci-cd.yml \| grep -c '^-[^-]'` | `0`(삭제·수정된 기존 줄 없음) |
| `git grep -n "needs:" -- .github/workflows/ci-cd.yml` | 사전 점검 때와 같은 두 줄. `apple`이 어디에도 없다 |
| `git grep -n "secrets\." -- .github/workflows/ci-cd.yml` | `apple` 작업 범위 안에 없다 |

## 7. 검증 명령

```bash
bash scripts/pipeline/gate.sh quick
```
```bash
git diff .github/workflows/ci-cd.yml | grep -c '^-[^-]'
```

## 8. 하지 않는 것

- `main`에 push하지 않는다. 워크플로를 실제로 돌려 보지 않는다(통합 브랜치의 PR에서 처음 돈다. STATUS "실측 필요").
- 기존 작업의 수정, 러너 변경, 캐시 추가.
- Apple 앱의 서명·TestFlight·릴리스 작업.

## 9. 끝났다는 기준

- [ ] `apple` 작업이 있고 YAML이 유효하다
- [ ] 기존 줄이 하나도 바뀌지 않았다
- [ ] `deploy-server`와 `release-native-clients`의 `needs`가 그대로다
- [ ] 게이트 `quick`이 통과한다

## 10. 명세 작성자 메모

- 이 명세를 쓴 기계에는 `actionlint`가 없었다.
- 러너 라벨 `macos-26`과 그 이미지의 Xcode 버전은 확인하지 못했다. 첫 PR 실행에서 `Show toolchain` 단계의 출력으로 확인하고, 틀리면 라벨만 고친다.
- 이 작업은 `gate: quick`이다. Apple 게이트 자체를 로컬에서 돌리는 것은 이 작업의 검증이 아니다(P6-A1이 이미 했다).
