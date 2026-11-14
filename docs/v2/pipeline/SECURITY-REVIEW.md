# 보안 테스트 결과 (P5-15)

- 실행한 커밋: `4196733`(p0-foundations) 위의 `wp/P5-15` 작업 트리 · 날짜: 2026-11-15 · 테스트 수: 49 · 통과: 47 · 실패: 2
- 실행: `bun test apps/server/test/security`(저장소 루트에서. 루트의 `bunfig.toml`이 테스트 샌드박스를 먼저 띄운다)
- 테스트는 서버가 실제로 받는 입구(`handleRequest`, `/`를 보는 시험만 `createHttpApp`)에 요청을 보내고 응답과 DB를 본다. 서버 코드는 바꾸지 않았다.

## 발견

| # | 심각도 | 분류 | 무엇 | 재현 (테스트 이름) | 영향 | 고칠 곳 (파일:줄) |
|---|---|---|---|---|---|---|
| 1 | 중간 | CSRF | 세션 쿠키로 인증한 v2 변경 요청(POST·PUT·PATCH·DELETE)에 출처 검사가 없다. 다른 사이트의 `Origin`과 `Sec-Fetch-Site: cross-site`를 단 요청이 그대로 처리된다. 시험에서 프로필 이름이 바뀌고(`updateMe` 200) 폴더가 지워졌으며, `createAccessToken` 201, `createExport` 202, `cancelAccountDeletion` 200, `createWorkspace` 201, `batchRecordings` 200 등 쓰기 라우트 49개가 403이 아니었다. 출처를 보는 곳은 물어보기 라우트의 `crossSiteCookie`(cross-site만) 하나뿐이다. | `security/csrf.test.ts` › "cross-site cookie requests are refused", "apple callback is the only cross-site POST" | `SameSite=Lax`라서 지금 브라우저는 다른 사이트의 POST에 쿠키를 싣지 않는다. 그러나 같은 사이트(`qucord.com`의 다른 하위 도메인)에서 오는 요청에는 싣는다. 그 하위 도메인을 장악하거나 그곳에 XSS가 있으면, 로그인한 사용자 대신 녹음 삭제, 토큰 발급, 계정 삭제 취소 같은 변경을 할 수 있다. 응답은 읽지 못한다. Lax를 따르지 않는 클라이언트도 막지 못한다. | `apps/server/src/api/v2/index.ts:87`(v2 미들웨어 자리): 쿠키로 인증한 변경 요청은 `Sec-Fetch-Site`가 `same-origin`(또는 `none`)이거나 `Origin`이 `LECTERN_BASE_URL`의 출처일 때만 받는다. 토큰 요청과 `/auth/apple/callback`은 뺀다. `apps/server/src/api/v2/ask.ts:78`의 검사를 이것으로 바꾼다. v1 쿠키 라우트(`/api/auth/*`, `/api/admin/*`, `/api/lectures/*`. 새 관리자 콘솔이 쿠키로 쓴다)도 같은 검사가 필요하다: `apps/server/src/http.ts:28`의 앱 전체 미들웨어가 알맞다. |

발견 1의 두 테스트는 고칠 때까지 실패한 채로 둔다(`test.skip`·`todo`·`failing`으로 가리지 않았다).

## 확인한 것 (통과)

| 분류 | 테스트 | 확인한 성질 |
|---|---|---|
| 세션 | `session.test.ts` › "login issues a new session id" | 로그인 전에 심은 `lectern_session` 값을 버리고 새 값을 준다. 심은 값으로는 인증되지 않는다(세션 고정 없음) |
| 세션 | "session cookie attributes" | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure`(https 요청과 `X-Forwarded-Proto: https` 둘 다). `Secure`는 요청이 아니라 `LECTERN_BASE_URL`이 https인지로 정한다(기본값이 https) |
| 세션 | "logout invalidates the session" | 로그아웃 뒤 같은 쿠키로 `GET /api/v2/me`는 401 |
| 세션 | "password reset signs other sessions out" | 비밀번호 재설정 뒤 옛 세션은 401 |
| 세션 | "expired session" | `sessions.expires_at`이 지나면 401 |
| CSRF | `csrf.test.ts` › "same-origin cookie requests pass" | 자기 출처(`Origin: http://localhost`, `Sec-Fetch-Site: same-origin`)의 쿠키 요청은 출처 헤더가 없을 때와 모든 쓰기 라우트에서 같은 응답 |
| CSRF | "token requests need no origin check" | `Authorization: Bearer <PAT>` 요청은 다른 출처에서도 같은 응답 |
| CSRF | "form content types cannot reach JSON routes" | JSON 본문 라우트 전부: `application/x-www-form-urlencoded`·`text/plain`·`multipart/form-data`로 보낸 JSON은 400 또는 415(본문으로 해석되지 않는다) |
| 횟수 제한 | `rate-limit.test.ts` › "login" | 이메일당 실패 10번 뒤 429와 `Retry-After`. 그동안은 맞는 비밀번호도 429 |
| 횟수 제한 | "native token password grant" | 10번 뒤 429 |
| 횟수 제한 | "share link password" | 링크·주소당 1분에 10번 뒤 429와 `Retry-After: 60` |
| 횟수 제한 | "invite accept" | 사용자당 10번 뒤 429 |
| 횟수 제한 | "signup code and reset code" | 코드 보내기는 이메일당 5번(가입·재설정 합산), 재설정은 10번 뒤 429 |
| 횟수 제한 | "limits are per e-mail and per IP" | 한 주소에서 여러 이메일은 30번까지, 다른 주소는 영향 없음. 한 이메일은 주소를 바꿔도 10번 |
| 횟수 제한 | "X-Forwarded-For cannot dodge the limit" | 신뢰 프록시 1단(기본값, Cloudflare 터널)에서 클라이언트가 왼쪽에 붙인 값을 바꿔도 프록시가 붙인 마지막 주소로 센다. 한 계정은 주소와 관계없이 이메일 한도 |
| 업로드 | `upload.test.ts` › "rejects a non-audio file" | `text/html`·`image/svg+xml` 오디오, HTML 이미지는 거절(400 또는 415) |
| 업로드 | "rejects a mismatched extension" | `audio/mpeg`에 이름 `x.exe`는 415 |
| 업로드 | "path traversal in the file name" | `../../etc/passwd`, `..\..\x.mp3`, `/abs/x.mp3`, NUL, `../../../tmp/evil.mp3`는 받되, 끝까지 올린 파일은 데이터 디렉터리 안에 생성한 이름(`aud_…​.mp3`)으로 저장된다. 받은 이름은 경로에 쓰이지 않는다 |
| 업로드 | "part numbers out of range" | 파트 0, -1, 100000, 1.5, `abc`는 400 |
| 업로드 | "oversized part" | 계획보다 큰 파트는 413, 4GB를 넘는 파일은 만들 때 413 |
| 업로드 | "someone else's upload session" | 남의 업로드 세션 읽기·파트·완료·취소는 404, 원래 세션은 그대로 |
| 업로드 | "asset content needs access" | 남의 녹음 파일 내용은 404(이름도 안 보인다), 인증 없이는 401 |
| 업로드 | "served files are not executable in the browser" | 오디오는 `audio/*`, PDF(본문에 HTML을 넣은 것도)는 `application/pdf`와 `X-Content-Type-Options: nosniff` |
| 리다이렉트 | `redirect.test.ts` › "oauth next" | Google 로그인의 `next`가 외부 주소·`//`·`/\`·`javascript:`면 `/app`, `/%2F%2Fevil.example`은 같은 출처의 경로로 남는다(외부로 나가지 않는다) |
| 리다이렉트 | "google calendar return_to" | 외부 값은 스키마가 400, `/%2F%2F…`는 같은 출처의 경로 |
| 리다이렉트 | "/ and /admin redirects are fixed" | `/`는 `Host`·`X-Forwarded-Host`와 관계없이 상대 경로 `/app…`, `/admin`은 리다이렉트가 아니다 |
| 토큰 저장 | `token-storage.test.ts` › "PAT", "native access", "native refresh"(교체한 쌍 포함), "invite", "ICS feed", "share link (v2)", "oauth state"(로그인과 캘린더 연결) | DB 파일의 모든 테이블 모든 TEXT 열에 원문이 없고, 해당 `*_hash` 열에 `sha256Hex(원문)`이 있다 |
| 토큰 저장 | "google refresh token is sealed" | `integration.token_enc`에 원문이 없고 `openSecret`으로 열린다 |
| 토큰 저장 | "known exceptions are exactly the v1 ones" | 평문으로 남는 것은 `users.api_token`, `sessions.token`, `lectures.share_token` 셋이고 각자 그 열에만 있다(v1 계약의 예외). v1 공유 토큰의 v2 링크는 해시다 |
| 토큰 저장 | "tokens do not appear in logs" | 위 흐름 동안의 로그 출력에 원문이 없다 |
| 남의 리소스 | `idor.test.ts` › "every v2 route refuses a foreign workspace" | 사용자 A의 워크스페이스(개인·팀)·녹음·문서·폴더·태그·보기·업로드·파일·작업·물어보기 대화·공유 링크·초대·내보내기·토큰·기기·identity·연동·화자·할 일·일정 제안 id로 낯선 사용자 B가 모든 v2 라우트를 토큰과 쿠키로 부른다: 403 또는 404, 일괄 처리는 항목마다 실패. 응답에 A의 이메일·제목·이름이 없다 |
| 남의 리소스 | "A reaches its own ids (control for the refusals above)" | 위 거절이 없는 id에 대한 404가 아니라는 대조: A가 같은 id로 같은 라우트를 부르면 경로 매개변수 이름마다 하나 이상이 성공(또는 실제 행에서만 나는 409·412)한다. 물어보기 서비스가 꺼진 프로세스에서는 `thread_id`만 빠진다 |
| 남의 리소스 | "unauthenticated" | 인증 없이, 위조한 쿠키·PAT로는 공개가 아닌 라우트 전부 401 |
| 남의 리소스 | "viewer cannot write" | 계정은 보통이고 팀 멤버십만 viewer인 사용자의 팀 쓰기는 403·404(일괄은 항목마다 실패). 같은 요청을 소유자는 할 수 있다. 저장된 보기·자기 ICS 피드·자기 Google 연결은 그 사용자의 것이라 허용(팀이 공유하는 것을 바꾸지 않는다) |
| 남의 리소스 | "private recording inside a shared workspace" | 같은 팀의 관리자도 남의 비공개 녹음은 읽기·수정·삭제 404, 목록·검색에 없다 |
| 남의 리소스 | "ids are not guessable sequences" | 새 녹음 id는 숫자가 아니고, 연이어 만든 둘의 뒷부분이 거의 다르다(UUIDv7의 무작위 부분) |
| 남의 리소스 | "SSE stream only carries my workspaces" | 남의 워크스페이스 구독은 403. 처음부터 다시 받아도(`Last-Event-ID: 0`) 실시간으로도 내 워크스페이스의 이벤트만 온다 |
| 헤더 | `headers.test.ts` › "html responses carry a CSP without unsafe-inline scripts" | `/`(옛 앱), `/admin`(옛 콘솔), `/privacy`, 공유 페이지와 그 비밀번호 화면: `script-src 'self'`, `'unsafe-inline'`·`'unsafe-eval'` 없음, `object-src 'none'` |
| 헤더 | "frame and sniff protections" | 위 HTML에 `nosniff`, `frame-ancestors 'none'`과 `X-Frame-Options: DENY`, `Referrer-Policy`. API 응답에도 `nosniff`와 `Referrer-Policy` |
| 헤더 | "api responses are not cached" | 인증된 v2 JSON 응답은 `Cache-Control: no-store` |
| 헤더 | "errors do not leak internals" | 500 응답 본문은 `{"error":{"code":"internal",…}}`과 요청 id뿐이다(스택·파일 경로·SQL·파서 오류 문구 없음) |

## 테스트하지 못한 것

- `/app` 웹 셸 HTML의 헤더: 테스트 프로세스에서는 웹 셸이 꺼져 있다(`LECTERN_WEB_SHELL`, 빌드한 `apps/web/dist`가 있어야 한다). 웹 셸도 같은 `applySecurityHeaders`(`apps/server/src/index.ts`)를 지나므로 다른 HTML 다섯 개로 대신 확인했다. 실제 `/app`의 CSP는 배포된 서버에서 한 번 봐야 한다.
- 실제 Google·Apple과의 흐름: 가짜 Google(`test/fakes/google.ts`)로만 돌렸다. Apple 콜백은 출처 검사에서 빠지는지만 보았다(상태 토큰 검증은 `apple-login.test.ts`).
- 프록시 뒤의 `X-Forwarded-For`: 신뢰 프록시 1단(기본값)을 가정했다. 실제 경로(Cloudflare → cloudflared → 서버)에서 프록시가 몇 단인지, cloudflared가 `X-Forwarded-For`를 어떻게 붙이는지는 운영 서버에서 확인해야 한다. 단 수가 다르면 주소별 한도가 모두를 한 바구니에 넣거나 클라이언트가 바꿀 수 있는 값을 센다.
- TLS 설정, HSTS: 서버 앞단(Cloudflare)의 일이라 이 테스트 범위 밖이다.
- v1 라우트의 CSRF: 6절은 v2 라우트만 돈다. 발견 1의 고칠 곳에 v1 쿠키 라우트도 적었다.
- 물어보기 라우트: 물어보기 서비스는 프로세스에서 처음 읽을 때 정해진다(`apps/server/src/ask/service.ts`). 앞선 테스트 파일이 꺼진 상태로 읽었으면 물어보기 라우트는 모두에게 501이고, 그때는 이 묶음에서 501을 "데이터에 닿지 않음"으로 보았다. 물어보기의 권한은 `ask-api.test.ts`가 따로 본다.
- 업로드 내용 검사: 오디오 파일의 실제 내용(매직 바이트)은 보지 않는다. 형식은 선언한 MIME으로 정한다. 받은 파일은 다운로드·재생으로만 쓰이고, 응답은 `nosniff`와 오디오 타입이다.

## 사람이 봐야 하는 것

- 이 테스트는 알려진 유형만 본다. 인증·권한 코드의 리뷰는 사용자(또는 상위 모델)의 몫이다.
- v1 로그인(`POST /api/auth/login`)은 세션 토큰을 응답 본문(`token`)에도 준다(v1 계약). 쿠키가 `HttpOnly`여도 페이지의 스크립트가 이 응답을 읽으면 토큰을 얻는다. 새 웹 앱이 이 값을 쓰지 않는다면 본문에서 빼는 것을 검토할 만하다.
- 발견 1을 고칠 때, 새 관리자 콘솔(`/app/admin`)은 v1 관리자 API를 쿠키로 부른다. v1에 같은 검사를 넣으면 같은 출처 요청만 남는지 웹 e2e로 확인해야 한다.
