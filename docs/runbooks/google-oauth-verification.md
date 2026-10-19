# 체크리스트: Google OAuth 앱 검증 신청 (D8)

> 결정: [ROADMAP.md D8](../v2/ROADMAP.md#결정-필요-사항) — "예, P0에 바로 신청". 캘린더 설계는 [ARCHITECTURE.md §11](../v2/ARCHITECTURE.md#11-캘린더리마인더), 로그인은 [§10](../v2/ARCHITECTURE.md#10-계정인증권한쿼터공유).
> 신청은 운영자가 직접 한다. 이 문서는 순서대로 따라 하면 되도록 썼다. 콘솔 메뉴 이름은 2026-10 기준(Google Auth Platform: Branding, Audience, Clients, Data Access, Verification Center)이며 바뀔 수 있다.

## 0. 한눈에 보기

검증은 두 단계다.
1. **브랜드 검증(Branding)**: 앱 이름, 로고, 홈페이지, 개인정보처리방침, 승인된 도메인을 확인한다. 자동 검토는 보통 몇 분 안에 끝난다. **지금(P0) 끝낼 수 있다.**
2. **데이터 접근 검증(Data access)**: 요청하는 scope가 민감(sensitive) 등급이면 필요하다. 데모 영상과 scope별 정당화가 필요하고, 영상은 실제 동작하는 기능을 보여야 한다. **캘린더 연동이 동작하는 P4에 제출한다.** `calendar.app.created`가 민감 등급인지는 공개 문서로 확인되지 않았다. §4에서 콘솔 표시를 보고 정한다.

| 시점 | 할 일 | 걸리는 시간 |
|---|---|---|
| P0 1주차 | §1 차단 요소 해소, §2 Search Console 도메인 확인, §3 프로젝트·Branding·Audience·Data Access·Clients 설정, 브랜드 검증 | DNS 전파 몇 분~몇 시간, 브랜드 검토 보통 몇 분(수동 검토면 며칠) |
| P0~P4 | Testing 상태로 개발. 테스트 사용자만 사용(§6 한도) | — |
| P4 (캘린더 연동 동작 후) | §5 정당화 문구, §7 데모 영상, Verification Center 제출 | Google 안내는 민감 scope 검토가 보통 영업일 3~5일. 질문·보완 왕복을 고려해 **2~6주**를 잡는다 |
| 승인 후 | Production 게시, 사용자 상한 해제 | — |

## 1. 차단 요소 (제출 전에 반드시 해소)

- [ ] **공개 홈페이지.** Google은 홈페이지가 로그인한 사용자만 보는 페이지이면 안 되고, 앱을 설명하고 개인정보처리방침을 링크해야 한다고 요구한다. **지금 `https://lectern.qucord.com/`은 로그인 화면뿐이라 이 조건을 못 맞춘다.**
  - 할 일: 로그아웃 상태의 `/`(또는 홈페이지로 등록할 공개 경로)에 Lectern이 무엇을 하는지(녹음 → 전사·문서, 일정 추출, Google 캘린더 연동), `/privacy`·`/terms` 링크, 문의처를 보이게 한다. 이 작업은 웹 UI(`apps/server/src/ui.ts`)와 라우트를 소유한 세션의 몫이다.
- [ ] **`/privacy`와 `/terms`가 실제로 서빙된다.** 파일은 `apps/server/static/legal/privacy.html`, `terms.html`이고, `apps/server/src/http.ts`(Hono 진입점)가 `/privacy`, `/terms`로 서빙한다. 이 코드가 `main`에 배포돼야 운영에서 열린다.
  - 두 페이지는 인라인 `<style>` 하나를 쓴다. CSP의 `style-src`에서 `'unsafe-inline'`을 빼면 그 해시(`'sha256-Ia0aH08zjPbxs8BI3T0x37ocu7Zu4c1RwKfMXdGTJDo='`)를 두 경로의 CSP에 넣어야 스타일이 적용된다. 스타일이 막혀도 내용은 읽힌다.
- [ ] **자리표시자 교체.** 다음 명령의 결과가 비어 있어야 한다.
  ```bash
  grep -n '{{' apps/server/static/legal/*.html
  ```
  `{{CONTACT_EMAIL}}`(문의 이메일), `{{OPERATOR_NAME}}`(개인정보 보호책임자 이름), `{{EFFECTIVE_DATE}}`(공고·시행일, 예: 2026년 10월 26일)를 채운다. 개인 이메일을 공개하고 싶지 않으면 `qucord.com` 도메인의 별도 주소(예: privacy@ 또는 support@)를 만들어 쓴다.
- [ ] **(P4·P5) 기능 구현.** Google 로그인과 캘린더 연동이 운영에서 동작해야 데모 영상을 찍을 수 있다. 리디렉션 URI 경로는 구현할 때 정해진다(§3.5).

검증: 로그아웃한 브라우저(시크릿 창)에서 `https://lectern.qucord.com/`이 앱 설명과 개인정보처리방침 링크를 보여 주고, `https://lectern.qucord.com/privacy`와 `/terms`가 200으로 열린다.

## 2. 도메인 소유 확인 (Search Console)

승인된 도메인 `qucord.com`은 Cloud 프로젝트의 **소유자(Owner) 또는 편집자(Editor)인 Google 계정**으로 Search Console에서 확인해야 한다.

1. [Google Search Console](https://search.google.com/search-console)에 Cloud 프로젝트 소유자 계정으로 로그인한다.
2. 속성 추가 → **도메인** 유형 → `qucord.com` 입력.
3. 표시되는 `google-site-verification=…` TXT 레코드를 복사한다.
4. Cloudflare 대시보드 → `qucord.com` → DNS → Records → Add record
   - Type `TXT`, Name `@`, Content에 복사한 값, TTL Auto
5. Search Console로 돌아와 "확인"을 누른다. 실패하면 몇 분 뒤 다시 시도한다.
   ```bash
   dig +short TXT qucord.com
   ```
   위 명령에 `google-site-verification=` 값이 보이면 DNS에는 들어간 것이다.

검증: Search Console 설정 → 사용자 및 권한에 이 계정이 "소유자"로 보인다. TXT 레코드는 지우지 않는다(지우면 확인이 풀린다).

## 3. Cloud 프로젝트와 Google Auth Platform 설정

### 3.1 프로젝트

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 OAuth 전용 프로젝트를 만든다(예: 이름 `Lectern`). Gemini 키를 쓰는 프로젝트와 나누면 키 관리와 검증 상태를 따로 볼 수 있다.
2. 프로젝트 → IAM → 연락처 이메일이 운영자가 실제로 읽는 주소인지 확인한다. Google은 검증 관련 연락에 늦게 답하면 API 접근을 잃을 수 있다고 경고한다.
3. API 및 서비스 → 라이브러리 → **Google Calendar API**를 사용 설정한다.

### 3.2 Branding

Google Auth Platform → Branding에 다음을 넣는다.

| 항목 | 값 |
|---|---|
| App name | `Lectern` |
| User support email | 운영자 Google 계정 이메일 또는 운영자가 관리하는 Google 그룹 |
| App logo | 정사각형 Lectern 로고(콘솔 안내의 크기·형식 제한을 따른다). Google 로고를 흉내 내지 않는다 |
| Application home page | `https://lectern.qucord.com/` (§1의 공개 홈페이지) |
| Application privacy policy link | `https://lectern.qucord.com/privacy` |
| Application terms of service link | `https://lectern.qucord.com/terms` |
| Authorized domains | `qucord.com` |
| Developer contact information | 운영자가 읽는 이메일 |

저장한 뒤 **Verify branding**을 누르고, 통과하면 **Publish branding**을 누른다. 나중에 이름, 로고, URL을 바꾸면 다시 검증을 거치고, 바꾼 브랜딩을 7일 안에 게시해야 검증 상태가 유지된다.

### 3.3 Audience

- User type: **External**
- Publishing status: 처음에는 **Testing**
- Test users: 개발과 데모 촬영에 쓸 Google 계정을 추가한다(최대 100명). 데모용으로 개인 데이터가 없는 별도 테스트 계정을 하나 만든다.

### 3.4 Data Access

1. **Add or remove scopes**에서 다음을 추가한다. 목록에 없으면 "Manually add scopes"에 전체 URL을 붙여 넣는다.
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email` (`email`)
   - `https://www.googleapis.com/auth/userinfo.profile` (`profile`)
   - `https://www.googleapis.com/auth/calendar.app.created`
2. 저장한 뒤 `calendar.app.created`가 **"Your non-sensitive scopes"와 "Your sensitive scopes" 중 어디에 들어갔는지** 확인해 이 문서 §8 기록란에 적는다. 이 결과로 §4의 경로가 정해진다.
3. `calendar.events`, `calendar` 같은 넓은 scope는 추가하지 않는다. 코드가 요청하는 scope와 여기 등록한 scope가 다르면 사용자에게 미검증 경고가 뜬다.

### 3.5 Clients

1. **Create client** → Application type **Web application**, 이름 `lectern-web-prod`.
   - Authorized JavaScript origins: `https://lectern.qucord.com`
   - Authorized redirect URIs: P5의 Google 로그인과 P4의 캘린더 연결 구현이 정하는 콜백 경로(예: `https://lectern.qucord.com/api/v2/integrations/google/callback`). 구현 PR에서 이 문서에 실제 경로를 적는다.
2. 로컬 개발용 클라이언트를 따로 만든다(`lectern-web-dev`, origin `http://localhost:18775`). 운영 클라이언트에 localhost를 섞지 않는다.
3. Client ID와 Client secret은 비밀번호 관리자에 보관하고, 운영 값은 `/etc/lectern/lectern.env`에만 넣는다(변수 이름은 구현 때 `packages/config`에 추가). 저장소에 커밋하지 않는다. 교체 절차는 [secret-rotation.md](secret-rotation.md)에 추가한다.

검증: Verification Center에서 Branding 상태가 "Verified" 또는 "Published"이고, Data Access에 위 4개 scope가 등록돼 있다.

## 4. scope 등급에 따른 경로

| §3.4 결과 | 필요한 검증 | Production으로 바꿀 수 있는 시점 | 사용자에게 보이는 것 |
|---|---|---|---|
| `calendar.app.created`가 **non-sensitive** | 브랜드 검증만 | 브랜드 검증 직후 | 일반 동의 화면. 데모 영상과 데이터 접근 검증이 필요 없다 |
| `calendar.app.created`가 **sensitive** | 브랜드 검증 + 데이터 접근 검증(§5, §7) | 언제든 가능하지만, 승인 전에는 미검증 경고 화면이 뜨고 신규 사용자 100명 상한이 걸린다 | 승인 후 일반 동의 화면 |
| restricted | 보안 평가(CASA)까지 필요 | — | 예상하지 않는다. 이렇게 나오면 설계를 다시 검토한다 |

`openid`, `email`, `profile`은 non-sensitive다. 이것만으로 Google 로그인을 먼저 열 수 있다(P5).

## 5. scope별 정당화 문구 (제출 양식에 붙여 넣기)

검토자는 영어로 읽는다. 아래 문구를 그대로 쓰거나 실제 구현에 맞게 고친다.

**openid, email, profile**

> Lectern uses Google Sign-In so users can create and access their Lectern account with their Google account. We read the account's email address, name and profile picture only to create or link the Lectern account and to show who is signed in. We do not use this data for any other purpose and never share it.

**https://www.googleapis.com/auth/calendar.app.created**

> Lectern turns lecture and meeting recordings into structured notes and finds the deadlines, exams and meetings mentioned in them. When the user confirms a suggested event (or turns on automatic adding), Lectern creates one secondary calendar named "Lectern" in the user's Google Calendar and creates, updates and deletes events only in that calendar. Each event carries the title, date and time, a short description and a link back to the source recording. Lectern reads events from that calendar only to avoid duplicates and to sync edits and cancellations.
>
> We request calendar.app.created because it is the narrowest scope that supports this feature: it only grants access to calendars the app itself creates. Broader scopes such as calendar.events or calendar would give access to every event in the user's calendars, which Lectern never needs to read or change. Without this scope the "Add to Google Calendar" feature cannot work, and users would be limited to an ICS subscription link, which Google Calendar can take up to a day to refresh.

**데이터 처리 설명이 필요할 때 (요약)**

> Google user data is used only for sign-in and for writing events to the Lectern-created calendar. It is not sold, not used for advertising, not transferred except as needed to provide the feature, and not used to train AI or machine-learning models. OAuth tokens are stored encrypted on our server and deleted when the user disconnects. See https://lectern.qucord.com/privacy (section 5).

## 6. Testing 상태의 한도

- 테스트 사용자로 등록한 Google 계정만 승인할 수 있다(최대 100명).
- 외부(External) 앱이 Testing 상태이면 **refresh token이 7일 뒤 만료된다.** 요청 scope가 이름·이메일·프로필의 부분집합일 때만 예외인데, `calendar.app.created`를 넣으면 예외가 아니다. 그래서 Testing 동안 캘린더 연동은 매주 다시 연결해야 한다. 실사용자에게 열기 전에 Production으로 바꿔야 한다.
- 미검증 상태로 Production에 두면(민감 scope일 때) 사용자는 "Google에서 확인하지 않은 앱" 경고를 보고, 신규 사용자 100명 상한이 걸린다.
- 별개로 Google 계정 하나와 OAuth 클라이언트 하나 사이에 refresh token은 최대 100개다. 넘으면 가장 오래된 것이 경고 없이 무효가 된다. 기기마다 새 토큰을 받지 않도록 구현한다.

## 7. 데모 영상 대본 (민감 scope일 때 필요)

요건: YouTube에 **일부 공개(Unlisted)**로 올린다. 동의 화면 전체가 보여야 하고, 동의 화면 왼쪽 아래 언어를 **English**로 바꾼다. 신청한 것과 같은 앱(이름, 로고)과 같은 scope가 보여야 하고, 각 scope를 쓰는 기능을 실제로 보여야 한다.

준비
- 개인 데이터가 없는 데모용 Google 계정(테스트 사용자로 등록)과, 일정이 언급되는 짧은 데모 녹음(예: "다음 주 화요일 오후 3시에 중간고사").
- 브라우저 주소창이 보이게 녹화한다(동의 화면 URL의 `client_id`가 신청한 클라이언트와 같은지 검토자가 본다). 1080p, 3~5분. 음성 대신 화면 자막을 넣어도 된다.

| 시간 | 화면 | 보여 줄 것 |
|---|---|---|
| 0:00 | `https://lectern.qucord.com/` (로그아웃 상태) | 앱 설명, 개인정보처리방침 링크, 주소창 |
| 0:15 | "Google로 로그인" 클릭 → 계정 선택 → 동의 화면 | 앱 이름 Lectern, 요청 scope(이메일·프로필), 언어 English, 주소창의 `client_id` |
| 0:45 | 로그인 후 라이브러리 | Google 계정 이름·이메일이 계정으로 연결된 것 |
| 1:00 | 데모 녹음 열기 | 녹음에서 찾은 일정 제안과 근거 구간(원문 시간) |
| 1:30 | 설정 → Google 캘린더 연결 → 동의 화면 | `calendar.app.created` 설명("Make secondary Google calendars, and see, create, change, and delete events on them")이 보이는 전체 동의 화면, 허용 |
| 2:00 | 일정 제안 확정 → `calendar.google.com` | 새 보조 캘린더 "Lectern"과 그 안의 일정. 기본 캘린더와 다른 캘린더는 그대로인 것 |
| 2:30 | Lectern에서 일정 날짜 수정 → Google 캘린더 새로고침 | 수정이 반영됨. 제안 무시(취소) → Google 캘린더에서 사라짐 |
| 2:50 | 설정 → 연결 해제(전용 캘린더 삭제 선택) | 연결 해제와 정리. `myaccount.google.com/permissions`에서 Lectern 접근이 사라진 것 |
| 3:15 | `https://lectern.qucord.com/privacy#google` | Google 사용자 데이터 절(제한적 사용 고지) |

## 8. 제출 (P4)

1. §1의 모든 항목, §3 검증이 끝났는지 확인한다.
2. Google Auth Platform → **Verification Center** → 데이터 접근 검증 준비 → scope별 정당화(§5), 데모 영상 URL(§7)을 넣고 제출한다.
3. Google Trust & Safety의 메일에는 같은 스레드로 빨리 답한다. 요구 사항을 고쳤으면 무엇을 어디서 고쳤는지 URL과 함께 적는다.
4. 승인되면 Audience → **Publish app**으로 Production에 게시한다.
5. 검증: 테스트 사용자가 아닌 새 Google 계정으로 로그인과 캘린더 연결을 해 보고, 미검증 경고가 뜨지 않는지와 7일이 지나도 연결이 유지되는지 확인한다.

기록란 (진행하면서 채운다. 시크릿은 적지 않는다)
- Cloud 프로젝트 ID: _
- Search Console 도메인 확인일: _
- `calendar.app.created` 등급(§3.4): _
- 브랜드 검증 통과일: _
- 데이터 접근 검증 제출일 / 승인일: _
- Production 게시일: _

## 9. 승인 뒤 유지

- 앱 이름, 로고, 홈페이지·개인정보처리방침 URL, 승인된 도메인, scope를 바꾸면 다시 검증을 받는다. scope를 늘리는 변경은 먼저 이 문서의 정당화와 [개인정보처리방침](../../apps/server/static/legal/privacy.html)을 고친다.
- 개인정보처리방침에 적은 대로만 Google 사용자 데이터를 쓴다. 쓰는 방식이 바뀌면 방침을 먼저 고친다.
- Search Console의 TXT 레코드와 `qucord.com` 도메인을 유지한다.
- 프로젝트 연락처 이메일을 최신으로 유지하고 Google의 메일에 답한다.
