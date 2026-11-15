# 인계 점검표

> 대상: 이 저장소를 처음 넘겨받는 사람(사람이든 에이전트든)
> 목표: [AGENTS.md](../../AGENTS.md)와 런북만 읽고 로컬 실행, 테스트, 배포, 롤백을 할 수 있다(ROADMAP P7)
> 관련: [STATUS.md](../v2/pipeline/STATUS.md)(무엇이 됐고 무엇이 남았는지), [docs/v2/README.md](../v2/README.md)(설계 문서와 런북 목록)

## 1. 이 문서의 쓰임

- 위에서 아래로 따라 하며 각 줄의 "확인" 칸을 채운다. 날짜, 누가(이름이 아니라 역할: 예 "새 운영자"), 결과(`성공` 또는 `실패: <무엇이 부족했나>`)를 적는다.
- 막히면 그 줄에 무엇이 부족했는지 적는다. 문서만으로 할 수 없었다면 그것이 문서 결함이다. 고친 문서의 PR을 같은 줄에 링크한다.
- §3은 로컬에서 할 수 있다. §4는 운영 호스트가 있어야 하고, 배포·롤백처럼 운영에 영향을 주는 줄은 운영자와 함께 한다.
- 시크릿 값, 실제 이메일, 녹음 내용은 이 문서에 적지 않는다(공개 저장소다).

## 2. 읽는 순서

| 순서 | 문서 | 무엇을 얻나 | 기대 시간 |
|---|---|---|---|
| 1 | [AGENTS.md](../../AGENTS.md) | 지켜야 할 규칙, 저장소 지도, 개발과 테스트 명령 | 30분 안쪽 |
| 2 | [docs/v2/README.md](../v2/README.md) | 설계 문서 목차, ADR, 런북과 파이프라인 문서 목록 | 15분 |
| 3 | [ARCHITECTURE.md](../v2/ARCHITECTURE.md) §2(현재 상태)·§5(데이터 모델) | 시스템 구조와 v2 테이블 | 30분 안쪽 |
| 4 | 런북: [배포·롤백](deploy-and-rollback.md), [백업·복원](backup-restore.md), [장애 대응](incident-response.md), [시크릿 교체](secret-rotation.md), [호스트 구성](host-setup.md) | 운영 절차 | 각 30분 안쪽 |
| 5 | [STATUS.md](../v2/pipeline/STATUS.md) | 구현된 것, 가짜로만 확인한 것, 실측·사용자가 할 일 | 30분 안쪽 |

## 3. 로컬에서 해 보기

실제 공급자(Gemini, Resend, Google, Apple)를 부르는 줄은 없다. 값이 필요한 곳은 `<임의 값>`처럼 적었다. 스스로 정한 값을 쓰고 어디에도 남기지 않는다.

| 번호 | 할 일 | 명령 | 기대 결과 | 근거 문서 | 확인(날짜·누가·결과) |
|---|---|---|---|---|---|
| 1 | 의존성 설치 | `bun install` | 오류 없이 끝나고 `bun.lock`이 바뀌지 않는다 | [AGENTS.md 개발과 테스트](../../AGENTS.md#개발과-테스트) | |
| 2 | 타입 검사, 단위 테스트 | `bun run typecheck`, `bun test` | 타입 오류 0, 테스트 실패 0(샌드박스에서 돈다) | 같은 절 | |
| 3 | 웹 빌드와 e2e | `bun run web:build`, `bun run web:e2e`(처음에는 `apps/web`에서 `bunx playwright install chromium`) | `apps/web/dist`가 생기고 e2e 전부 통과 | [apps/web/README.md](../../apps/web/README.md) | |
| 4 | 샌드박스로 로컬 서버를 띄우고 로그인 | AGENTS.md "로컬 서버"의 두 명령(임시 디렉터리, 비운 시크릿, `LECTERN_OWNER_EMAIL=dev@example.com LECTERN_OWNER_PASSWORD=<임의 값>`). 다른 셸에서 `curl -s http://localhost:18775/api/health`, 브라우저로 `http://localhost:18775`에 로그인 | health가 `"status":"ok"`, 로그인 성공. 끝나면 서버를 끈다(Ctrl+C). 임시 디렉터리는 9번에서 쓰므로 그때까지 둔다 | [AGENTS.md 개발과 테스트](../../AGENTS.md#개발과-테스트) | |
| 5 | 짧은 녹음 업로드(가짜 AI) | `bun scripts/load/uploads.ts --n 1 --minutes 2` | 요약 JSON의 `ok: true`, `processing[0].status`가 `ready`. 실제 Gemini를 부르는 처리(4번 서버에서 `LECTERN_WORKER_MODE`를 빼고 키를 넣는 것)는 비용이 든다 | [scripts/load/README.md](../../scripts/load/README.md) | |
| 6 | 게이트 | `bash scripts/pipeline/gate.sh quick`, `… unit`, `… full` | 각각 `GATE <단계> OK` | [AGENTS.md 개발과 테스트](../../AGENTS.md#개발과-테스트), [PIPELINE.md](../v2/pipeline/PIPELINE.md) | |
| 7 | 환경 변수 하나를 더하는 법(읽기만) | — | 세 곳: `packages/config/src/index.ts`, `bun run config:docs`(→ `docs/env.md`), `deploy/systemd/lectern.env.example`를 설명할 수 있다 | [AGENTS.md 개발과 테스트](../../AGENTS.md#개발과-테스트) | |
| 8 | 마이그레이션 만드는 법(읽기만) | — | `bun run --cwd packages/db generate`, 부팅 때 자동 적용과 `pre-migrate-*.sqlite` 백업, 깨는 변경은 두 단계라는 것을 설명할 수 있다 | 같은 절, [deploy-and-rollback.md §5](deploy-and-rollback.md#5-롤백) | |
| 9 | 부하 스크립트 소규모 실행, 복원 리허설 | 5번과 같은 부하 명령. 리허설은 4번 서버(끈 상태)의 DB로 사본을 뜨고(`bun -e "import { Database } from 'bun:sqlite'; new Database(process.argv[1]).exec(\"VACUUM INTO '\" + process.argv[2] + \"'\")" "$SANDBOX/data/lectern.sqlite" "$SANDBOX/lectern-copy.sqlite"`), `bun scripts/rehearse/restore.ts --backup "$SANDBOX/lectern-copy.sqlite" --work "$SANDBOX/rehearse-work"`. 끝나면 `rm -rf "$SANDBOX"` | 리허설 요약의 `ok: true`, `digest_equal: true`, `integrity: "ok"`, `server.health: "ok"`, `shrunk_tables: []` | [scripts/rehearse/README.md](../../scripts/rehearse/README.md), [backup-restore.md §7](backup-restore.md#7-복원-리허설-분기-1회) | |
| 10 | Apple·Android 게이트(도구가 있을 때) | `bash apps/apple/scripts/gate.sh`(Xcode, `xcodegen`), `cd apps/android && ./gradlew testDebugUnitTest assembleDebug`(JDK 17, Android SDK) | 둘 다 성공으로 끝난다 | [apps/apple/README.md](../../apps/apple/README.md), [apps/android/README.md](../../apps/android/README.md) | |

## 4. 운영에서 해 보기 (운영 호스트가 있어야 한다)

이 절의 확인 칸은 운영 호스트에서 실제로 해 본 사람이 채운다. 지금은 비어 있다(통합 브랜치의 내용은 아직 `main`에 합쳐지지 않았고 운영 호스트가 내려가 있다. [STATUS](../v2/pipeline/STATUS.md)).

| 번호 | 할 일 | 근거 문서 | 기대 결과 | 확인(날짜·누가·결과) |
|---|---|---|---|---|
| 1 | 상태 확인(`/api/health`) | [deploy-and-rollback.md §2](deploy-and-rollback.md#2-일반-배포), [incident-response.md §2](incident-response.md#2-첫-5분-점검) | `status`, `gitSha`, `checks.database`·`checks.disk`·`checks.worker`를 읽을 수 있다 | |
| 2 | 로그 보기(`journalctl`의 JSON 줄, `request_id`로 찾기) | [incident-response.md §2](incident-response.md#2-첫-5분-점검) | API와 워커 로그에서 한 요청을 따라간다 | |
| 3 | 수동 백업 | [backup-restore.md §2](backup-restore.md#2-수동-백업) | `backups/manual-*.sqlite`가 생기고 무결성 검사가 `ok` | |
| 4 | 복원 리허설(사본) | [backup-restore.md §7](backup-restore.md#7-복원-리허설-분기-1회) | 요약의 `ok: true`, 결과를 운영자 기록에 남긴다 | |
| 5 | 배포: 통합 브랜치 → `main` PR → CI → CD | [deploy-and-rollback.md §1–§4](deploy-and-rollback.md#1-배포-흐름-한눈에-보기) | `/api/health`의 `gitSha`가 머지 커밋이 된다 | |
| 6 | 롤백 | [deploy-and-rollback.md §5](deploy-and-rollback.md#5-롤백) | 이전 커밋으로 돌아가고 health가 `ok` | |
| 7 | 시크릿 교체 한 가지(예: 배포 토큰) | [secret-rotation.md §2](secret-rotation.md#2-배포-토큰-lectern_deploy_token) | 새 값으로 CD가 되고 옛 값은 거절된다. §11에 기록 | |
| 8 | 워커 유닛 확인 | [host-setup.md §6](host-setup.md#6-워커-유닛-설치-p0-워커가-들어온-뒤), [incident-response.md §3.7](incident-response.md#37-작업이-처리-중에서-멈춤) | `lectern-worker`가 돌고 `checks.worker`가 살아 있다 | |
| 9 | 기능 플래그 켜고 끄기 | [docs/env.md](../env.md), [host-setup.md §8](host-setup.md#8-물어보기-켜기와-끄기-lectern_ask)·[§10](host-setup.md#10-전사-시험-처리-켜기와-끄기-lectern_transcript_engine) | 아래 순서로 하나씩 켜고, 켤 때마다 health와 해당 화면을 본다 | |
| 10 | 부하 시험 | [load-test.md](load-test.md) | 세 시험의 수치를 STATUS "실측 필요"의 P7-01 행이 말한 형식으로 남긴다 | |

기능 플래그를 켜는 순서 **제안**(ROADMAP "운영 전환 계획"과 각 플래그의 전제에서 모은 것이다. 운영 호스트에서 이 순서로 해 본 사람은 아직 없다): `LECTERN_PIPELINE=v2`(새 업로드를 v2 처리로) → `LECTERN_WEB_SHELL=1`(웹 앱은 CD 배포가 `apps/web/dist.next`에 빌드해 넣는다, [deploy-and-rollback.md §1](deploy-and-rollback.md#1-배포-흐름-한눈에-보기))·`LECTERN_ASK=1` → `LECTERN_PDF=1` → `LECTERN_CALENDAR=1`(Google 캘린더는 OAuth 클라이언트가 있어야 한다) → `LECTERN_GOOGLE_LOGIN=1`·`LECTERN_APPLE_LOGIN=1`·`LECTERN_TEAMS=1` → `LECTERN_APNS=1`. `LECTERN_V1_SUNSET`·`LECTERN_V1_BLOCK`은 맨 마지막이고, Android·Windows 앱의 읽기 경로가 v2로 옮겨진 뒤다(STATUS "사용자 필요"). 되돌릴 때는 그 변수를 끔 값으로 바꾸거나 지우고 서비스를 다시 시작한다. 켜진 동안 쓴 데이터(v2 행, 색인, 연동)는 남는다. 이 순서를 한 곳에 적은 런북은 아직 없다(§7).

## 5. 계정과 외부 서비스

값은 적지 않는다. 값을 넣는 곳은 운영 호스트의 환경 파일(`/etc/lectern/lectern.env`, 예시는 [deploy/systemd/lectern.env.example](../../deploy/systemd/lectern.env.example))이다.

| 서비스 | 무엇에 쓰나 | 어디에 넣나(환경 변수) | 교체 절차 | 없으면 |
|---|---|---|---|---|
| Gemini API | 전사, 노트, OCR, 물어보기, 색인 임베딩 | `GEMINI_API_KEY`(비면 서비스 사용자의 `~/local.env`) | [secret-rotation.md §4](secret-rotation.md#4-gemini-api-키) | AI 처리 전부가 설정 오류로 실패한다 |
| Resend | 인증번호, 비밀번호 재설정, 초대, 리마인더 메일 | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`(또는 `LECTERN_RESEND_CREDENTIALS_FILE`) | [secret-rotation.md §3](secret-rotation.md#3-resend-api-키) | 메일이 가지 않는다. 가입은 인증번호 없이 된다(메일 키가 없을 때의 동작) |
| Cloudflare와 도메인 | 공개 주소, TLS, 호스트 앞단 | 호스트 쪽 설정(저장소 밖). 프록시 단 수는 `LECTERN_TRUSTED_PROXY_HOPS` | [incident-response.md §3.8](incident-response.md#38-밖에서만-접속이-안-됨-프록시cloudflare회선), [host-setup.md](host-setup.md) | 밖에서 접속할 수 없다 |
| Google OAuth 클라이언트와 검증 | Google 로그인, Google 캘린더 연동 | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, 플래그 `LECTERN_GOOGLE_LOGIN`, `LECTERN_CALENDAR` | [google-oauth-verification.md](google-oauth-verification.md), [secret-rotation.md §8](secret-rotation.md#8-google-oauth-클라이언트-시크릿-google_oauth_client_secret) | Google 로그인 버튼과 캘린더 연동이 꺼진다(ICS 구독은 된다) |
| Apple Developer: Sign in with Apple | Apple로 로그인 | `APPLE_SIGNIN_CLIENT_ID`, `APPLE_SIGNIN_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY_FILE`, 플래그 `LECTERN_APPLE_LOGIN` | [secret-rotation.md §9](secret-rotation.md#9-sign-in-with-apple-키-apple_signin_key_id-apple-signinp8) | Apple 로그인이 꺼진다 |
| Apple Developer: APNs 키 | 처리 Live Activity, 문서 준비 알림 | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY_FILE`, `APNS_TOPIC_IOS`, `APNS_ENV`, 플래그 `LECTERN_APNS`. 유니버설 링크는 `APPLE_APP_IDS` | [secret-rotation.md §10](secret-rotation.md#10-apns-키-apns_key_id-apnsp8) | 푸시 알림과 원격 Live Activity 갱신이 없다 |
| Apple Developer ID | Mac 앱 서명·공증 | 운영자의 Mac과 CI(저장소에 넣지 않는다) | [apple-developer-notarization.md](apple-developer-notarization.md) | Mac 앱을 내려받으면 Gatekeeper가 막고, 업데이트마다 권한이 풀린다 |
| GitHub 저장소 시크릿 | CD 배포, Android 릴리스 서명 | `LECTERN_DEPLOY_TOKEN`, `LECTERN_ANDROID_KEYSTORE_BASE64`·`LECTERN_ANDROID_KEYSTORE_PASSWORD`·`LECTERN_ANDROID_KEY_ALIAS`·`LECTERN_ANDROID_KEY_PASSWORD`(`.github/workflows/ci-cd.yml`). 2026-11-15의 `gh secret list`에는 `LECTERN_DEPLOY_TOKEN`만 있다 | [secret-rotation.md §2](secret-rotation.md#2-배포-토큰-lectern_deploy_token), [apps/android/README.md](../../apps/android/README.md) | 배포 토큰이 없으면 CI가 배포하지 못한다. Android 서명 시크릿이 없으면 릴리스 APK가 러너의 일회용 디버그 키로 서명돼 이전 빌드 위에 업데이트로 설치되지 않는다(지금 그렇다) |

## 6. 확인 기록

이 문서를 쓴 작업(P7-05)이 로컬에서 실제로 해 본 기록이다. 실행하지 않은 것은 그렇게 적었다.

### 6.1 §3의 줄마다

| 번호 | 실행한 명령 | 결과 | 날짜 |
|---|---|---|---|
| 1 | `bun install` | 성공. 바뀐 패키지 없음, `bun.lock` 그대로 | 2026-11-15 |
| 2 | `bun run typecheck`, `bun test`, `bun test apps/server/test/ops.test.ts` | 성공. 타입 오류 0, 1853개 통과(파일 152개, 83초), 33개 통과 | 2026-11-15 |
| 3 | `bun run web:build`, `bun run web:e2e`, `bun run web:dev`(띄워서 `/app/`이 200인 것을 보고 PID로 끔) | 성공. `apps/web/dist` 생성, e2e 218개 통과(1.8분), 개발 서버 200 | 2026-11-15 |
| 4 | AGENTS.md "로컬 서버"의 두 명령(오너 비밀번호는 무작위로 만들고 어디에도 남기지 않음), `curl /api/health`, `POST /api/auth/login`, `GET /api/v2/me`, 틀린 비밀번호로 한 번 더 | 성공. health 200·`status: ok`(외부 워커 모드라 `checks.worker`는 `"missing"`), 로그인 200과 `lectern_session` 쿠키, `/me` 200, 틀린 비밀번호 401, 서버 로그에 오류 0줄. PID로 끄고 임시 디렉터리를 지웠다. 브라우저 대신 curl로 같은 요청을 보냈다 | 2026-11-15 |
| 5 | `bun scripts/load/uploads.ts --n 1 --minutes 2` | 성공. `ok: true`, 처리 `ready`, 업로드 110 ms, 처리 약 2초(가짜 Gemini) | 2026-11-15 |
| 6 | `bash scripts/pipeline/gate.sh quick`, `… unit`, `… full` | 성공. `GATE quick OK`(2초), `GATE unit OK`(93초), `GATE full OK`(203초) | 2026-11-15 |
| 7 | 읽기만. 그리고 `bun run config:docs` | 세 곳이 있다. `config:docs`를 다시 돌려도 `docs/env.md`가 바뀌지 않았다(문서가 코드와 같다) | 2026-11-15 |
| 8 | 읽기만 | `packages/db/package.json`의 `generate`(`drizzle-kit generate`)를 확인했다. 스키마 변경이 없어 실행하지 않았다 | 2026-11-15 |
| 9 | 5번의 부하 명령, 4번 서버(끈 뒤) DB를 `VACUUM INTO`로 뜬 사본으로 `bun scripts/rehearse/restore.ts --backup <사본> --work <없는 디렉터리>`, 그다음 임시 디렉터리 삭제 | 성공. `ok: true`, 테이블 64개, `digest_equal: true`, `integrity: ok`, 서버 health ok, `migration_ms` 2280, `shrunk_tables: []`, 작업 디렉터리는 끝난 뒤 지워졌다. 더 해 본 것: `long-recording.ts --hours 0.05`(ok, `ready`), `bench/search.ts --recordings 200`(p95 15.5 ms), `--recordings 1000 --max-p95-ms 200`(p95 60.7 ms, 통과). `disk-full.ts`는 실행하지 않았다(작은 볼륨을 마운트해야 한다) | 2026-11-15 |
| 10 | `bash apps/apple/scripts/gate.sh`, `cd apps/android && ./gradlew testDebugUnitTest assembleDebug`(JDK 17) | 성공. `gate: apple ok`(171초. 이 Mac은 CoreSimulator가 Xcode보다 오래돼 "Simulator device support disabled" 경고가 나오지만 패키지 테스트와 서명 없는 빌드는 된다), `BUILD SUCCESSFUL` | 2026-11-15 |

그 밖에 실행한 것: `bun run pipeline status`, `bun run pipeline check`(`OK 90 work packages`), `git fetch origin main && git rev-parse origin/main`, `bun apps/server/scripts/rehearse-v2-migration.ts <새 샌드박스 DB의 사본>`(`rehearsal: lossless`), `cd apps/macos && ./build-app.sh`(성공. 만든 zip은 `.gitignore`에 없어 지웠다), `gh run list --workflow ci-cd.yml --branch main --limit 3`(`main`의 마지막 실행 `45a9d3b`는 배포 작업만 실패, 나머지 작업은 성공), `gh secret list`, `dig +short TXT qucord.com`, `ffmpeg -version`, cloudflare 접속 확인. 런북에 나오는 SQL 10개(`lectures`, `job`, `ai_call`, `users`, `sessions`, `audit_logs`, `system_state`)는 지금 스키마로 만든 빈 DB에서 모두 돌았다. 명령마다 뒤에 `git status --short`를 보았고, 바뀐 파일은 이 작업이 고친 문서뿐이었다.

### 6.2 문서별 명령 확인

대상 문서의 코드 블록(목록 안에 들여쓴 것까지) 198개를 세 부류로 나눴다. **실행**: 로컬에서 실제로 돌렸다. **대조**: 운영 호스트에서만 되는 명령이라 실행하지 않고, 환경 변수 이름·유닛 이름·저장소 경로·로그에서 찾는 `"msg"` 문구가 저장소(`packages/config/src/index.ts`, `deploy/systemd/*`, 서버·워커 코드)에 있는지 스크립트로 대조했고, SQL은 지금 스키마의 빈 DB에서 돌려 보았다. **실행하지 않음**: 비용이 들거나 바깥(운영, GitHub에 쓰기, 실제 홈 디렉터리)에 영향을 주거나, 없는 계정(Developer ID)이 필요하다. **명령 아님**: 디렉터리 그림, 기록 양식, 설정 파일 예시.

| 문서 | 실행 | 대조 | 실행하지 않음 | 명령 아님 | 메모 |
|---|---|---|---|---|---|
| `AGENTS.md` | 6 | 0 | 0 | 1 | 설치, 타입 검사, 테스트, 게이트, 샌드박스 로컬 서버 두 줄 |
| `README.md` | 0 | 0 | 0 | 0 | 코드 블록이 없다. 본문의 `bun run cli`는 실제 Gemini 호출(비용)이라 실행하지 않았다 |
| `docs/runbooks/apple-developer-notarization.md` | 2 | 7 | 4 | 2 | 실행: `apps/macos/build-app.sh`, `gh secret list`. 실행하지 않음: 공증 뒤의 `ditto`·`stapler`·`spctl`(Developer ID가 없다) |
| `docs/runbooks/backup-restore.md` | 2 | 19 | 1 | 0 | 실행: `bun install --frozen-lockfile`, `restore.ts`. 대조: 백업 이름 `lectern-<시각>.sqlite`(`ops.ts`), `trash/`·`uploads/`·`aud_<uuid>`(`storage.ts`), 유닛 이름, SQL. 실행하지 않음: 실제 홈에 `~/lectern-offhost`를 만드는 줄 |
| `docs/runbooks/deploy-and-rollback.md` | 7 | 10 | 9 | 0 | 실행: `bun install`·`typecheck`·`test`, `gh run list`, `git fetch … && git rev-parse origin/main`, `rehearse-v2-migration.ts`. 대조: `journalctl`의 유닛과 `"msg"` 문구(`server listening`, `shutting down`, `lectern-worker started` 등), 운영 DB 사본 사전 점검의 환경 변수. 실행하지 않음: 운영 주소 curl, `gh run watch`, `gh workflow run`, CD 배포, `git push`·`gh pr create`, 자리 표시가 있는 롤백 `git revert` 두 줄 |
| `docs/runbooks/google-oauth-verification.md` | 1 | 0 | 1 | 0 | 실행: `dig +short TXT qucord.com`. 실행하지 않음: 운영 `/privacy`·`/terms` curl(호스트가 내려가 있다) |
| `docs/runbooks/host-setup.md` | 1 | 44 | 2 | 0 | 실행: `ffmpeg -version`. 대조: 유닛 템플릿과 유닛 이름, 환경 파일 경로, `~/lectern-host-snapshot` 줄, `sqlite3` SQL 5개(스키마로 확인), 모델 ID. 실행하지 않음: bun 설치 스크립트(`curl … \| bash`), 운영 health curl |
| `docs/runbooks/incident-response.md` | 2 | 24 | 1 | 1 | 실행: `gh run list`, cloudflare 접속 확인. 대조: `vcgencmd`(Pi 전용), `journalctl`, `127.0.0.1:18775`의 health(같은 요청을 샌드박스 서버에 보내 `checks.worker`를 읽었다. 이 Mac에는 `jq`가 없어 python으로). 명령 아님: 장애 기록 양식 |
| `docs/runbooks/load-test.md` | 1 | 3 | 0 | 0 | 실행: `bun install --frozen-lockfile`. 대조: `sudo mount -t tmpfs`·`umount`, 데이터 디스크의 `TMPDIR` |
| `docs/runbooks/secret-rotation.md` | 0 | 32 | 6 | 0 | 대조: 환경 변수 이름(오너 재설정 줄 포함), 키 파일 경로, 유닛 이름. 실행하지 않음: `gh secret set`, `gh workflow run`, 운영 주소로 보내는 curl 네 줄 |
| `docs/v2/pipeline/README.md` | 1 | 0 | 0 | 1 | `bun run pipeline status` |
| `apps/web/README.md` | 1 | 0 | 0 | 1 | `bun run web:dev` |
| `scripts/bench/README.md` | 2 | 0 | 0 | 1 | 200건, 1000건(`--max-p95-ms 200`) |
| `scripts/load/README.md` | 1 | 0 | 0 | 0 | 블록 하나에 명령 셋: `uploads.ts`·`long-recording.ts`는 작게 실행, `disk-full.ts`는 작은 볼륨이 필요해 실행하지 않았다 |
| `scripts/rehearse/README.md` | 1 | 0 | 0 | 0 | 6.1의 9번 |

대조에서 어긋난 이름·경로·문구는 없었다(유닛으로 잘못 잡힌 `~/lectern-host-snapshot` 한 건은 디렉터리 이름이다). 고친 런북 줄도 없다.

### 6.3 링크

- Markdown 상대 링크 검사(파이프라인 명세 P7-05 5절 11단계의 한 줄 명령): `broken links: 1`. 그 1건은 `docs/v2/pipeline/wp/P7-05.md`의 코드 블록 안 템플릿 줄(상태 줄 끝의 `pipeline/STATUS.md` 링크)로, `ROADMAP.md`에 넣을 때의 경로라 명세 파일 자리에서는 깨져 보인다. 오탐으로 두었다(명세는 고치지 않는다).
- `AGENTS.md`, `docs/v2/README.md`, 이 문서, `STATUS.md`(그리고 `README.md`, `ROADMAP.md`)의 `#앵커` 링크를 GitHub 제목 규칙으로 대조했다: 0건 어긋남.

## 7. 알려진 빈 곳

문서만으로는 할 수 없는 것이다. 자세한 것은 [STATUS](../v2/pipeline/STATUS.md)의 "실측 필요"와 "사용자 필요".

- §4 전부: 운영 호스트가 내려가 있고 통합 브랜치(`p0-foundations`)는 아직 `main`에 합쳐지지 않았다. 합칠지와 언제 합칠지는 사용자가 정한다(`main`으로 가는 PR [eunhhu/lectern#1](https://github.com/eunhhu/lectern/pull/1)).
- 기능 플래그를 켜는 순서를 한 곳에 적은 런북이 없다. §4 아래의 순서는 이 문서가 처음 모은 것이다.
- 이 점검표의 마지막 판정("처음 온 사람이 문서만으로 할 수 있었다")은 처음 온 사람이 실제로 해 봐야 한다. §3의 확인 칸은 그 사람이 채운다.
- 사용자 결정이 남은 작업: P2-09(기능 대조표 `없음` 8행)와 그 뒤의 P2-10·P7-03, P5-14(옛 관리자 콘솔 삭제), P6-A12(Developer ID), P6-W1(Windows 빌드 환경).
- 실제 공급자·기기 확인 전부: Gemini 평가 세트와 비용, Google OAuth 검증, 유료 Apple Developer 팀과 기기 점검(`apps/apple/MANUAL_CHECKS.md` 1–57), APNs, Pi에서의 부하·복원·검색 측정, VoiceOver 점검([A11Y-AUDIT.md](../v2/pipeline/A11Y-AUDIT.md)).
- `disk-full.ts`(디스크 부족 시험)는 작은 볼륨을 마운트해야 해서 §3에 넣지 않았다([load-test.md](load-test.md)).
- `apps/web/README.md`의 테스트 수("e2e 55개 … 단위 테스트 98개")가 지금 수와 다르다. 이 작업이 고칠 수 있는 파일이 아니다.
