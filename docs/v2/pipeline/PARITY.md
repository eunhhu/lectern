# v1 화면 기능 대조표

`apps/server/src/ui.ts`의 사용자 앱 화면(`renderAppHtml`, `APP_PAGE_SCRIPT`)이 하는 일을 모두 적고, 새 웹 앱(`apps/web`)에서 같은 일을 하는 곳과 그것을 덮는 e2e 테스트를 짝짓는다. `/`를 새 앱으로 바꾸기(P2-09) 전에 빠진 기능이 없는지 확인하는 표다(CONTRACTS.md D-P2-6 ①). `apps/web/test/parity-doc.test.ts`가 이 표의 형식, 테스트 이름이 실제로 있는지, `ui.ts`의 `data-action`이 빠짐없이 들어 있는지를 검사한다.

상태 값:

- `있음`: 새 앱에 같은 일을 하는 기능이 있다. 방식이 달라도 같은 목적을 이루면 `있음`이고, 다른 점은 "새 앱의 위치"에 적는다.
- `없음`: 새 앱에 없다. "새 앱의 위치"에 `없음:`으로 시작하는 사유를 쓴다. 이 WP는 만들지 않는다. P2-09 전에 만들지 사용자가 정한다.

"덮는 e2e 테스트"는 `파일명 › 테스트 제목`이다. `server/`로 시작하면 `apps/web/e2e/server/`의 real-server e2e, 아니면 `apps/web/e2e/`의 fixture e2e다.

| # | v1 기능 | v1 위치(ui.ts) | 새 앱의 위치 | 덮는 e2e 테스트 | 상태 |
|---|---|---|---|---|---|
| 1 | 로그인, 로그아웃 | 로그인 폼, `data-action="logout"`, `fetch('/api/auth/me')`, `fetch('/api/auth/logout')` | `/app/login`, 사용자 메뉴 `로그아웃` | server/flow.e2e.ts › login: a visitor without a session lands on 로그인 and returns to the page they asked for; server/flow.e2e.ts › library, recordings, 물어보기 and sign-out over the real API; organise.e2e.ts › user menu: profile and account settings | 있음 |
| 2 | 회원가입과 이메일 인증번호(모달 전환 `auth-mode`, 닫기 `close-modal`) | `auth-mode`, `send-code`, `close-modal`, `fetch('/api/auth/send-code')` | `/app/signup`(P2-03) | server/account.e2e.ts › sign-up without a mailed code signs in; account.e2e.ts › sign-up with the keyboard only: code, fields, Enter, home; account.e2e.ts › sign-up errors are alerts | 있음 |
| 3 | 비밀번호 재설정(코드 메일) | `fetch('/api/auth/reset-password')` | `/app/reset`(P2-03) | server/account.e2e.ts › reset does not say whether the account exists; account.e2e.ts › password reset ends at the login link | 있음 |
| 4 | 로그인한 상태에서 비밀번호 바꾸기 | 설정 모달, `fetch('/api/auth/password')` | 없음: 설정에 비밀번호 변경 화면이 없다(재설정 메일로만 바꿀 수 있다) | - | 없음 |
| 5 | 표시 이름 바꾸기 | `save-display-name`, `fetch('/api/auth/profile')` | 설정 > 프로필(`PATCH /api/v2/me`) | organise.e2e.ts › user menu: profile and account settings | 있음 |
| 6 | 개인 API 토큰 보기·복사·재발급 | `copy-api-token`, `rotate-api-token`, `fetch('/api/auth/rotate-token')` | 없음: 설정에 토큰 화면이 없고, v2 개인 토큰 API(`POST /api/v2/me/tokens`)는 아직 501이다(P5) | - | 없음 |
| 7 | 클라이언트 연동 안내(iOS 단축어 curl 예시, 앱 내려받기 링크) | `open-clients`, `/api/clients/ios-shortcut` 안내 | 없음: 설정 > 연동은 Google 캘린더 자리만 있고 앱 내려받기·단축어 안내가 없다 | - | 없음 |
| 8 | 설정 열기 | `open-settings` | `/app/settings`(사용자 메뉴 `설정`, `프로필과 계정`) | organise.e2e.ts › user menu: profile and account settings | 있음 |
| 9 | 파일 올리기(여러 파일, 끌어 놓기, PDF 짝짓기) | `pick-file`, `fetch('/api/lectures/ingest')` | 업로드 대화상자(`U`, `녹음 올리기`) | server/flow.e2e.ts › upload: a recording goes up in parts and waits for processing; keyboard.e2e.ts › keyboard only: upload audio and a PDF, wait for processing, open the document, follow a source | 있음 |
| 10 | 브라우저 마이크로 바로 녹음, 일시정지·재개 | `open-recorder`, `toggle-mic`, `pause-recording` | 업로드 대화상자의 `MicRecorder` | parity-mic.e2e.ts › microphone: record, pause, resume and finish adds the file to the upload list | 있음 |
| 11 | 녹음 중 화면 꺼짐 방지(Screen Wake Lock) | 녹음기 `navigator.wakeLock.request('screen')` | `MicRecorder`(`절전 방지 켜짐`), 녹음을 마치면 놓는다 | parity-mic.e2e.ts › microphone: record, pause, resume and finish adds the file to the upload list | 있음 |
| 12 | 실패한 업로드 한꺼번에 다시 올리기 | `retry-all-uploads` | 업로드 대화상자: 다시 `올리기`를 누르면 올라간 것은 건너뛰고 실패한 녹음만 다시 올린다 | server/parity.e2e.ts › upload retry: a failed upload goes up with the next 올리기, and the recording can be deleted | 있음 |
| 13 | 노트 목록, 제목 검색, 과목별 보기 | 노트 목록, `fetch('/api/lectures?')` | 라이브러리(`제목으로 찾기`, 폴더). v1의 `/` 키 대신 ⌘K로 찾는다 | server/parity.e2e.ts › search: the library search keeps only the notes whose title matches; server/flow.e2e.ts › folders and moves go through the real API; ask.e2e.ts › ⌘K: typing a question offers 물어보기 first and answers on the 물어보기 screen | 있음 |
| 14 | 처리 진행·실패 표시와 실시간 갱신 | `new EventSource('/api/events')` | 홈·라이브러리·녹음 상세의 진행 표시, `ApiClient.subscribe`(`/api/v2/events`) | server/process.e2e.ts › v2 pipeline: upload → transcript → document → source jump; keyboard.e2e.ts › keyboard only: upload audio and a PDF, wait for processing, open the document, follow a source; a11y.e2e.ts › new screens and states have no axe violations | 있음 |
| 15 | 노트 읽기(Markdown, `[MM:SS]` 칩으로 재생 위치 이동) | 노트 보기 | 녹음 상세 문서(legacy Markdown은 문서로 그리고 `[MM:SS]`가 플레이어를 옮긴다) | a11y.e2e.ts › a carried-over v1 note: Markdown drawn as a document, [MM:SS] marks move the player; server/flow.e2e.ts › library, recordings, 물어보기 and sign-out over the real API | 있음 |
| 16 | 오디오 재생(Range 요청) | `<audio>` | 녹음 상세 `AudioPlayer` | server/flow.e2e.ts › library, recordings, 물어보기 and sign-out over the real API; server/flow.e2e.ts › the player says 오디오 준비 중 when the asset bytes are not served | 있음 |
| 17 | 노트 편집·저장·취소, 저장 안 하고 떠나면 경고 | `toggle-editor`, `save-edit`, `close-editor`, `beforeunload`, `fetch('/api/lectures/'` | 녹음 상세 `편집`(P2-04) | edit.e2e.ts › structured edit: save adds a version marked 직접 수정; edit.e2e.ts › leaving the page with unsaved changes asks first; server/zz-edit.e2e.ts › legacy note: a Markdown edit is a new version, for v1 clients too | 있음 |
| 18 | 공개·비공개 전환과 공유 링크 복사 | `toggle-visibility`, `share-lecture` | 녹음 작업 > `공유…`(P2-05). 공개 여부 대신 링크를 만들고 회수한다 | share.e2e.ts › make a link, see its address once, copy it; server/share.e2e.ts › make a link, open it signed out, revoke it, and it is gone | 있음 |
| 19 | 공유 링크 재발급 | `rotate-share-token` | 회수한 뒤 새 링크 만들기(P2-05) | share.e2e.ts › 회수 asks first; 취소 keeps the link, 회수 removes it; server/share.e2e.ts › make a link, open it signed out, revoke it, and it is gone | 있음 |
| 20 | Markdown 내려받기 | `download-markdown` | 녹음 작업 > `Markdown 내려받기`(P2-06) | recording-actions.e2e.ts › Markdown 내려받기 saves the document as <title>.md; server/zz-recording-actions.e2e.ts › Markdown 내려받기 saves the note's Markdown | 있음 |
| 21 | 오디오 파일 내려받기 | `download-audio` | 없음: 녹음 상세에 오디오를 파일로 내려받는 메뉴가 없다 | - | 없음 |
| 22 | PDF로 인쇄 | `print` | 없음: 앱 안에는 없고 공개 공유 페이지(`/s/:token`)에만 `PDF 인쇄`가 있다 | - | 없음 |
| 23 | 오디오만 삭제 | `delete-audio` | 녹음 작업 > `오디오만 삭제…`(P2-06) | recording-actions.e2e.ts › 오디오만 삭제 asks first, then removes only the audio; server/zz-recording-actions.e2e.ts › 오디오만 삭제 removes the audio and keeps the document | 있음 |
| 24 | 노트 삭제 | `delete-lecture` | 녹음 작업 > `삭제…`, 라이브러리 일괄 삭제 | server/parity.e2e.ts › upload retry: a failed upload goes up with the next 올리기, and the recording can be deleted; a11y.e2e.ts › library bulk delete confirmation has no axe violations | 있음 |
| 25 | 다시 분석 | `retry-distillation` | 녹음 작업 > `다시 처리…`, `문서만 다시 만들기`(P2-06, 비용 확인 뒤 실행) | recording-actions.e2e.ts › confirming starts the reprocess and the status shows 대기 중; server/zz-recording-actions.e2e.ts › 다시 처리 shows the server's estimate and sends no real request | 있음 |
| 26 | 과목 옮기기 | `move-course` | `폴더로 이동…`(녹음 작업, 라이브러리 선택, 끌어 놓기) | keyboard.e2e.ts › library: select rows with the keyboard and move them to a folder without dragging; server/flow.e2e.ts › folders and moves go through the real API | 있음 |
| 27 | 과목 정리(비슷한 과목 이름 합치기) | `open-cleanup`, `workspace-cleanup`, `fetch('/api/lectures/cleanup')` | 없음: 폴더 이름 바꾸기·옮기기는 있지만 과목을 한꺼번에 정리하는 기능이 없다 | - | 없음 |
| 28 | 테마 바꾸기 | `toggle-theme` | 사용자 메뉴 `테마 전환`, 설정 > 이 브라우저 | parity.e2e.ts › theme: 테마 전환 flips the page theme and a reload keeps it | 있음 |
| 29 | 좁은 화면 탭(노트·전사 전환) | `mobile-tab` | 녹음 상세의 `녹음 보기` 탭(문서·전사·자료·물어보기) | parity.e2e.ts › narrow screen: the recording shows 녹음 보기 tabs that switch by keyboard | 있음 |
| 30 | 로그아웃 상태 `/`의 공개 소개(서비스 설명, 개인정보처리방침·이용약관·문의 링크) | 로그인 화면 소개 문단, `/privacy` 링크 | 없음: 새 앱 로그인 화면에는 서비스 소개와 개인정보처리방침·이용약관·문의 링크가 없다. `/`가 새 앱으로 가면 Google OAuth 검증에 쓰는 공개 홈페이지가 사라진다 | - | 없음 |
| 31 | 관리자에게 보이는 관리자 콘솔 링크 | `/admin` 링크(`어드민·CRM`) | 없음: 새 앱에는 관리자 콘솔로 가는 링크가 없다(주소 `/admin`으로는 그대로 열린다) | - | 없음 |
| 32 | 세션 쿠키로만 인증(토큰을 브라우저 저장소에 두지 않음) | 같은 출처 요청이 쿠키로 인증 | 새 앱도 쿠키만 쓴다 | server/flow.e2e.ts › login: a visitor without a session lands on 로그인 and returns to the page they asked for | 있음 |

## 관리자 콘솔(이 표의 대상 아님)

`ui.ts`의 `renderAdminPageHtml`·`ADMIN_PAGE_SCRIPT`는 `/admin` 관리자 콘솔이다. P2-09·P2-10은 사용자 앱 화면만 바꾸고 관리자 콘솔은 그대로 둔다. 그래서 위 표에 넣지 않는다. 콘솔의 `data-action`은 다음과 같다: `approve-user`, `aud-more`, `chip`, `compact-all`, `delete-member`, `dlg-cancel`, `dlg-ok`, `drawer`, `drawer-close`, `gc`, `goto-lectures-error`, `lec-compact`, `lec-del-audio`, `lec-delete`, `lec-more`, `lec-retry`, `logout`, `maint-run`, `member-lectures`, `nav`, `new-member`, `palette`, `peek-close`, `refresh`, `reload-audit`, `reload-lectures`, `retention`, `settings-reset`, `settings-save`, `sheet-close`, `shortcuts`, `theme`.

없음 행: 8개
