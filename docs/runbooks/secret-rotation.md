# 런북: 시크릿 교체

> 저장소 `github.com/eunhhu/lectern`은 **공개 저장소**다. 한 번이라도 커밋된 시크릿은 이력에서 지워도 유출된 것으로 본다.
> 시크릿 값은 명령줄 인자, 셸 기록, 채팅, 이슈, 로그에 남기지 않는다. 아래 명령은 값을 파일이나 프롬프트로 받는다.

## 1. 시크릿 목록

| 시크릿 | 저장 위치 | 쓰는 곳 | 교체 시점 |
|---|---|---|---|
| 배포 토큰 `LECTERN_DEPLOY_TOKEN` | 호스트 `/etc/lectern/lectern.env` + GitHub Actions 시크릿 | `POST /api/cd/deploy` | 유출 의심, 관리자 변경, 연 1회 |
| Resend API 키 `RESEND_API_KEY` | `/etc/lectern/lectern.env`. 비어 있으면 대체 파일(`LECTERN_RESEND_CREDENTIALS_FILE`, 비우면 오너 홈의 옛 경로)의 `resend.api_key` | 인증번호·비밀번호 재설정 메일 | 유출 의심, 연 1회 |
| Gemini API 키 `GEMINI_API_KEY` | `/etc/lectern/lectern.env`. 비어 있으면 서비스 사용자의 `~/local.env` | AI 처리 | 유출 의심, 비정상 과금, 연 1회 |
| 오너 계정 비밀번호 | DB `users.password_hash`(scrypt) | 관리자 로그인 | **지금 바로**(§5), 이후 유출 의심 시 |
| 사용자 API 토큰 `lct_…` | DB `users.api_token`(평문) | 네이티브 앱, iOS 단축어(`X-Lectern-Token`) | 기기 분실, 유출 의심 |
| 로그인 세션 `ses_…` | DB `sessions` | 웹 쿠키 `lectern_session` | 비밀번호 교체 시 자동 만료 |
| 호스트 봉인 키 | `DATA_DIR/secret.key`(0600, 자동 생성) | 사용자가 업로드에 붙인 Gemini 키를 작업 동안 AES-256-GCM으로 봉인 | 호스트 침해 의심 |
| Android 서명 키 | GitHub 시크릿 `LECTERN_ANDROID_KEYSTORE_*` | CI 릴리스 APK 서명 | 유출 의심(키를 바꾸면 기존 설치본 업데이트 불가) |
| (P6) Apple 서명·공증 | GitHub 시크릿 | macOS 공증 | [apple-developer-notarization.md](apple-developer-notarization.md) |
| Google OAuth 클라이언트 ID·시크릿 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `/etc/lectern/lectern.env` | Google 캘린더 연결·(P5) Google 로그인 | 유출 의심, 연 1회(§8) |
| Google 연동 토큰(refresh token) | DB `integration.token_enc`(호스트 봉인 키로 암호화) | 캘린더 동기화 | 호스트 봉인 키 교체 시 전부 무효(§7) |

공통 사전 확인
1. 지금 이 시크릿이 실제로 어디 있는지 확인한다. 호스트가 아직 `EnvironmentFile`로 옮겨지지 않았다면 유닛 파일의 `Environment=` 줄에 있을 수 있다.
   ```bash
   systemctl cat lectern | grep -nE '^(Environment|EnvironmentFile)='
   ```
   `Environment=` 줄에 값이 보이면 [host-setup.md §4](host-setup.md#4-환경-파일-만들기)로 먼저 옮긴다. 이 명령은 값을 화면에 출력하므로 화면 공유 중에는 돌리지 않는다.
2. 재시작하면 실행 중인 작업이 큐로 돌아갔다가 다시 실행된다. 관리자 콘솔의 작업 보기에서 긴 작업이 없을 때 재시작한다.
   - **외부 워커를 쓰면**(`/api/health`의 `checks.worker`가 `"ok"`) 워커도 같은 환경 파일을 읽으므로, 아래의 `sudo systemctl restart lectern`을 `sudo systemctl restart lectern lectern-worker`로 바꿔 실행한다. 특히 Gemini 키는 작업을 실행하는 워커가 쓴다.
3. 환경 파일은 항상 `sudoedit`로 고친다(편집기가 임시 사본을 쓰고 권한을 유지한다).
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```

## 2. 배포 토큰 (`LECTERN_DEPLOY_TOKEN`)

1. 새 토큰을 만든다. 운영자 컴퓨터의 권한 600 파일에 저장해 둔다(비상 수동 배포에서 이 파일을 읽는다).
   ```bash
   mkdir -p ~/.config/lectern && (umask 077 && openssl rand -hex 32 > ~/.config/lectern/deploy-token)
   ```
2. 호스트 환경 파일의 `LECTERN_DEPLOY_TOKEN=`을 새 값으로 바꾸고 서버를 재시작한다.
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
   ```bash
   sudo systemctl restart lectern
   ```
3. 바로 GitHub 시크릿도 바꾼다. 2와 3 사이에 배포가 돌면 401로 실패할 뿐 운영에는 영향이 없다.
   ```bash
   gh secret set LECTERN_DEPLOY_TOKEN --repo eunhhu/lectern < ~/.config/lectern/deploy-token
   ```
4. 검증한다.
   - 틀린 토큰은 거부된다(401이 나와야 한다).
     ```bash
     curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lectern.qucord.com/api/cd/deploy -H 'X-Lectern-Deploy-Token: wrong'
     ```
   - CI가 새 토큰으로 배포한다. `deploy-server` 잡이 `already-deployed`로 200을 받아야 한다.
     ```bash
     gh workflow run ci-cd.yml --ref main
     ```

## 3. Resend API 키

1. Resend 대시보드 → API Keys → Create API Key. 권한은 **Sending access**, 도메인은 `qucord.com`으로 제한한다. 키는 한 번만 보이므로 비밀번호 관리자에 바로 저장한다.
2. 환경 파일의 `RESEND_API_KEY=`를 새 키로 바꾸고 재시작한다. `RESEND_API_KEY`가 있으면 대체 파일은 읽지 않는다.
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
   ```bash
   sudo systemctl restart lectern
   ```
3. 검증한다. 직접 받을 수 있는 테스트 계정으로 재설정 메일을 요청한다. 응답은 계정이 있든 없든 항상 200이므로, **메일이 실제로 왔는지**와 Resend 대시보드 → Emails에 `delivered`가 찍혔는지로 확인한다.
   ```bash
   curl -sS -X POST https://lectern.qucord.com/api/auth/send-code -H 'Content-Type: application/json' -d '{"email":"<테스트-계정-이메일>","purpose":"reset"}'
   ```
   `429`가 나오면 rate limit이다. `Retry-After`만큼 기다린다.
4. Resend 대시보드에서 옛 키를 삭제한다.
5. 대체 파일(오너 홈의 자격 증명 JSON)에 옛 키가 남아 있으면 지운다. 이 파일은 호스트의 다른 도구도 쓸 수 있으니, 같은 키를 쓰는 도구가 없는지 먼저 확인한다.

## 4. Gemini API 키

1. Google AI Studio(또는 Google Cloud 콘솔 → APIs & Services → Credentials)에서 **결제가 연결된 프로젝트**에 새 키를 만든다.
   - API 제한을 "Generative Language API"로 건다.
   - 프로젝트가 유료 계층(Paid tier)인지 확인한다. 무료 계층에서는 Google이 입력과 응답을 제품 개선에 쓸 수 있어서 [개인정보처리방침](../../apps/server/static/legal/privacy.html)과 맞지 않는다.
2. 환경 파일의 `GEMINI_API_KEY=`를 바꾸고 재시작한다(외부 워커가 있으면 워커도).
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
   ```bash
   sudo systemctl restart lectern
   ```
   ```bash
   sudo systemctl restart lectern-worker   # 외부 워커를 쓰는 경우
   ```
3. 검증한다. 키를 명령줄에 쓰지 않도록 환경 파일에서 읽는다. 모델 이름이 출력되면 키가 유효하다.
   ```bash
   KEY=$(sudo sed -n 's/^GEMINI_API_KEY=//p' /etc/lectern/lectern.env) && curl -fsS -H "x-goog-api-key: ${KEY}" https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash | jq -r .name; unset KEY
   ```
   그다음 짧은 테스트 녹음(1분 이내)을 올려 노트가 생성되는지 확인한다.
4. 콘솔에서 옛 키를 삭제한다. 비정상 과금이 교체 이유였다면 Cloud Billing에서 해당 기간 사용량을 확인하고 예산 알림을 건다.
5. 서비스 사용자의 `~/local.env`에 `GEMINI_API_KEY=` 줄이 남아 있으면 지운다(CLI용으로 쓰고 있었다면 그쪽도 새 키로 바꾼다).
   ```bash
   grep -n '^GEMINI_API_KEY=' /home/eunhhu/local.env && sed -i '/^GEMINI_API_KEY=/d' /home/eunhhu/local.env
   ```

## 5. 오너 계정 비밀번호 — 지금 바로 교체

**왜 지금인가.** 2026-10-14 커밋 `6ab32bb`의 `apps/server/src/db.ts`에는 개인 값으로 된 기본 오너 비밀번호가 들어 있었다. 같은 날 `a354bd1`에서 지웠지만 공개 저장소 이력에는 그대로 남아 있다. 그 기본값이 있던 동안, `LECTERN_OWNER_PASSWORD` 없이 오너 계정이 만들어진 DB라면 지금 오너 비밀번호가 그 값일 수 있다. 그 뒤 코드의 기본값(`lectern-local-dev-only`)도 소스에 공개돼 있다. **둘 다 유출된 값으로 보고, 오너 비밀번호를 지금 바꾼다.** 같은 비밀번호를 다른 서비스에서도 썼다면 그쪽도 바꾼다.

### 5.1 로그인할 수 있을 때 (권장)

1. 비밀번호 관리자로 20자 이상 무작위 비밀번호를 만든다.
2. 웹에서 오너로 로그인 → 계정 설정 → 비밀번호 변경. `POST /api/auth/password`가 **지금 기기를 뺀 모든 세션을 만료**시키고 감사 로그에 `account.password_change`를 남긴다.
3. §6.1로 오너 API 토큰도 재발급한다. 비밀번호를 아는 사람은 `/api/auth/me`로 토큰을 읽을 수 있었다.

### 5.2 로그인할 수 없을 때

먼저 이메일 재설정(로그인 화면 → 비번 재설정)을 시도한다. 메일이 안 되면 환경 변수로 한 번만 재설정한다.

1. 환경 파일에 세 줄을 넣는다. `LECTERN_OWNER_EMAIL`은 **지금 오너 계정의 로그인 이메일과 정확히 같아야 한다.** 다르면 오너 계정이 하나 더 만들어진다.
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
   ```
   LECTERN_OWNER_EMAIL=<오너-로그인-이메일>
   LECTERN_OWNER_PASSWORD=<새-비밀번호>
   LECTERN_FORCE_RESET_OWNER_PASSWORD=1
   ```
2. 재시작한다.
   ```bash
   sudo systemctl restart lectern
   ```
3. 새 비밀번호로 로그인되는지 확인한 뒤, **곧바로** 환경 파일에서 `LECTERN_OWNER_PASSWORD=`를 비우고 `LECTERN_FORCE_RESET_OWNER_PASSWORD=0`으로 되돌리고 다시 재시작한다. 그대로 두면 재시작할 때마다 비밀번호가 이 값으로 되돌아간다.
4. 환경 변수 재설정은 다른 세션을 만료시키지 않는다. 로그인한 상태에서 §5.1의 비밀번호 변경을 한 번 더 해서 다른 세션을 모두 끊는다.
5. §6.1로 오너 API 토큰을 재발급한다.

### 5.3 검증

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lectern.qucord.com/api/auth/login -H 'Content-Type: application/json' -d @- <<'EOF'
{"email":"<오너-로그인-이메일>","password":"<옛-비밀번호>"}
EOF
```

`401`이 나와야 한다(실패가 반복되면 `429`). 새 비밀번호로는 웹 로그인이 된다. 관리자 콘솔 감사 로그에서 최근 `auth.login` 기록 중 모르는 것이 없는지 확인한다.

## 6. API 토큰 (`lct_…`)

### 6.1 본인 토큰 재발급

1. 웹 → 계정 설정 → API 토큰 재발급(`POST /api/auth/rotate-token`). 감사 로그에 `account.rotate_token`이 남는다.
2. 이 토큰을 쓰는 모든 클라이언트를 갱신한다. macOS 앱 설정, Android 앱(다시 로그인), Windows 트레이 앱 설정, iOS 단축어의 `X-Lectern-Token` 값.
3. 검증한다. 옛 토큰은 401, 새 토큰은 200이어야 한다.
   ```bash
   read -rs TOKEN && curl -s -o /dev/null -w '%{http_code}\n' https://lectern.qucord.com/api/lectures -H "X-Lectern-Token: ${TOKEN}"; unset TOKEN
   ```

### 6.2 다른 사용자의 토큰 (관리자)

토큰 유출이 의심되는 사용자가 있으면 관리자 콘솔 → 멤버 → 해당 사용자의 상태를 **정지(suspended)로 바꿨다가 다시 활성**으로 바꾼다. 정지할 때 세션이 모두 만료되고 API 토큰이 새로 발급된다. 사용자에게 다시 로그인하고 클라이언트 토큰을 갱신하라고 알린다.

### 6.3 전체 교체 (DB나 백업 파일이 유출됐을 때)

DB 사본이 유출되면 모든 API 토큰(평문), 세션, 공유 토큰이 노출되고 비밀번호 해시도 오프라인 공격 대상이 된다.

1. 서버를 멈춘다(외부 워커가 있으면 워커도).
   ```bash
   sudo systemctl stop lectern
   ```
   ```bash
   sudo systemctl stop lectern-worker   # 외부 워커를 쓰는 경우
   ```
2. 수동 백업을 뜬 뒤([backup-restore.md §2.2](backup-restore.md#22-호스트에서-순환-대상이-아닌-이름으로)) 모든 API 토큰을 새로 만들고 세션을 지운다.
   ```bash
   cd /home/eunhhu/work/lectern/data && /home/eunhhu/.bun/bin/bun -e "import { Database } from 'bun:sqlite'; import { randomBytes } from 'node:crypto'; const db = new Database('lectern.sqlite'); const users = db.query('SELECT id FROM users').all(); const upd = db.query('UPDATE users SET api_token = ? WHERE id = ?'); db.transaction(() => { for (const u of users) upd.run('lct_' + randomBytes(20).toString('base64url'), u.id); db.exec('DELETE FROM sessions'); })(); console.log('rotated', users.length)"
   ```
3. 서버(와 워커)를 시작하고 health를 확인한다.
   ```bash
   sudo systemctl start lectern && curl -fsS http://127.0.0.1:18775/api/health | jq .status
   ```
   ```bash
   sudo systemctl start lectern-worker   # 외부 워커를 쓰는 경우
   ```
4. 오너 비밀번호(§5)와 env 파일의 시크릿(§2~§4)도 모두 교체한다.
5. 모든 사용자에게 비밀번호 재설정을 안내한다. 공유 토큰(`/s/:token`)은 이 절차로 바뀌지 않는다. 비공개 강의의 공유 링크는 원래 소유자만 열 수 있지만, **공개로 설정된 강의는 유출된 토큰으로 계속 열린다.** 노출되면 안 되는 강의는 공개를 해제한다.
6. 개인정보 유출 신고 의무를 검토한다([incident-response.md §5](incident-response.md#5-개인정보-유출이-의심될-때)).

## 7. 호스트 봉인 키 (`DATA_DIR/secret.key`)

사용자가 업로드에 자기 Gemini 키(`X-Gemini-Key`)를 붙이면, 그 키는 작업이 끝날 때까지 이 키로 봉인돼 `job` 테이블에 있다가 작업이 끝나면 지워진다. DB 백업에는 이 파일이 들어가지 않는다.

> **주의**: Google 연동 토큰(`integration.token_enc`)도 이 키로 암호화돼 있다. 키를 지우면 서버가 그 토큰을 열 수 없어 모든 Google 연동이 `needs_reauth`가 되고, 사용자마다 설정에서 Google 캘린더를 다시 연결해야 한다.

교체(호스트 침해 의심 시)
1. 관리자 콘솔 작업 보기에서 대기·실행 중인 작업이 없을 때 진행한다. 남아 있는 작업 중 사용자 키를 가진 것은 "키를 열 수 없음" 오류로 끝나고, 사용자가 다시 시도해야 한다.
2. 서버를 멈추고 키 파일을 지운 뒤 다시 시작한다. 첫 사용 때 새 키가 만들어진다.
   ```bash
   sudo systemctl stop lectern-worker   # 외부 워커를 쓰는 경우
   ```
   ```bash
   sudo systemctl stop lectern && rm /home/eunhhu/work/lectern/data/secret.key && sudo systemctl start lectern
   ```
   ```bash
   sudo systemctl start lectern-worker   # 외부 워커를 쓰는 경우
   ```
3. 검증: 사용자 키를 붙인 짧은 업로드가 끝까지 처리되고, `secret.key`가 권한 600으로 다시 생겼는지 확인한다.
   ```bash
   ls -l /home/eunhhu/work/lectern/data/secret.key
   ```

## 8. Google OAuth 클라이언트 시크릿 (`GOOGLE_OAUTH_CLIENT_SECRET`)

클라이언트 시크릿을 바꿔도 사용자가 이미 받은 refresh token은 그대로 유효하다. 연결을 다시 할 필요는 없다.

1. Google Cloud 콘솔 → Google Auth Platform → Clients → 해당 클라이언트 → **Add secret**으로 새 시크릿을 만든다(옛 시크릿은 아직 지우지 않는다).
2. 환경 파일의 값을 바꾸고 다시 시작한다. 외부 워커를 쓰면 `lectern-worker`도 다시 시작한다.
   ```bash
   sudoedit /etc/lectern/lectern.env
   ```
   ```bash
   sudo systemctl restart lectern
   ```
3. 검증: 설정 → 연동 → Google 캘린더 연결이 Google 동의 화면까지 가고, 동의한 뒤 Lectern으로 돌아와 연결됨으로 보이는지 확인한다.
4. 콘솔에서 옛 시크릿을 비활성화한 뒤 삭제한다.

## 9. 교체 기록

교체할 때마다 날짜, 시크릿 이름, 이유, 수행자를 운영 메모에 남긴다(값은 절대 남기지 않는다). 다음 정기 교체 날짜도 적어 둔다.
