# 관리자 콘솔 기능 대조표

`apps/server/src/ui.ts`의 옛 관리자 콘솔(`renderAdminPageHtml`, `ADMIN_PAGE_SCRIPT`, `/admin`)이 하는 일을 모두 적고, 새 웹 앱의 관리 화면(`/app/admin`)에서 같은 일을 하는 곳과 그것을 덮는 e2e 테스트를 짝짓는다. 옛 콘솔을 지우기(P5-14) 전에 빠진 기능이 없는지 확인하는 표다.

- P5-12(관리자 콘솔 1부)와 P5-16(멤버와 녹음)이 덮는 행은 채웠다.
- 저장소·운영·설정·감사 로그·개요의 확인 필요·콘솔 껍데기(팔레트, 단축키, 자동 갱신, 테마, 로그아웃 등)는 P5-13이 채운다. 그 행은 새 화면 칸이 `P5-13`, e2e 칸이 `—`, 상태가 `없음`이다.

상태 값:

- `있음`: 새 콘솔에 같은 일을 하는 기능이 있다. 방식이 달라도 같은 목적을 이루면 `있음`이고, 다른 점은 새 화면 칸에 적는다.
- `없음`: 새 콘솔에 아직 없다. 모두 P5-13 몫이다.
- `일부러 뺌(사유)`: 옮기지 않기로 했다. 사유를 상태 칸에 적는다.

e2e 칸은 `파일명 › 테스트 제목`이다. `server/`로 시작하면 `apps/web/e2e/server/`의 real-server e2e, 아니면 `apps/web/e2e/`의 fixture e2e다. 테스트 제목은 코드의 제목과 글자 그대로 같다.

옛 콘솔의 화면은 일곱 개다: 개요, 멤버, 강의, 작업, 스토리지, 감사 로그, 설정. 새 콘솔에서 멤버는 `사용자`, 강의는 `녹음`이다. 작업 화면은 P5-12가 v2 작업(`/api/v2/admin/jobs`)으로 새로 만들었고, 옛 v1 작업 보기(`/api/admin/ops`의 jobs)는 P5-13이 옮긴다.

## 개요

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 1 | 개요: 멤버 수(전체, 활성·대기·정지) | GET /api/admin/overview | /app/admin 카드 `전체 사용자`, `활성 사용자`, `승인 대기`, `정지된 사용자` | admin.e2e.ts › overview cards | 있음 |
| 2 | 개요: 강의 수(전체, 오류·공개) | GET /api/admin/overview | /app/admin `녹음` 수, 카드 `오류 난 녹음`, `공개 녹음` | admin.e2e.ts › overview cards | 있음 |
| 3 | 개요: 오디오 용량 | GET /api/admin/overview, GET /api/admin/storage | /app/admin 카드 `오디오 저장 용량` | admin.e2e.ts › overview cards | 있음 |
| 4 | 개요: 디스크 여유와 사용률 막대 | GET /api/admin/ops | P5-13 | — | 없음 |
| 5 | 개요: v1 작업 수(실행 중·대기·24시간 완료·실패, 평균 처리 시간) | GET /api/admin/ops | P5-13 | — | 없음 |
| 6 | 개요 확인 필요: 가입 승인 대기(승인 버튼) | PATCH /api/admin/users/:id {status} | P5-13 | — | 없음 |
| 7 | 개요 확인 필요: 분석 실패 강의(재시도, 오류 강의 목록으로) | POST /api/lectures/:id/retry | P5-13 | — | 없음 |
| 8 | 개요 확인 필요: 디스크 여유 부족 | GET /api/admin/ops | P5-13 | — | 없음 |
| 9 | 개요 확인 필요: 백업 없음·오래됨(유지보수 실행) | GET /api/admin/ops | P5-13 | — | 없음 |
| 10 | 개요 확인 필요: ffmpeg 없음 | GET /api/admin/ops | P5-13 | — | 없음 |
| 11 | 개요 확인 필요: 압축 가능한 녹음 | GET /api/admin/storage | P5-13 | — | 없음 |
| 12 | 개요 확인 필요: 유지보수 오류 | GET /api/admin/ops | P5-13 | — | 없음 |
| 13 | 개요 확인 필요: 최근 배포 실패 | GET /api/admin/ops | P5-13 | — | 없음 |
| 14 | 개요 확인 필요: 운영·스토리지를 못 불러와 점검을 건너뛴 알림 | GET /api/admin/ops, GET /api/admin/storage | P5-13 | — | 없음 |
| 15 | 개요: 최근 활동(감사 로그 10건, 전체 보기) | GET /api/admin/overview | P5-13 | — | 없음 |

## 멤버 → 사용자

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 16 | 멤버: 목록(이름, 이메일, 역할, 상태, 강의·오류 수, 오디오/한도, 최근 로그인) | GET /api/admin/overview (users) | /app/admin/users 표(사용자, 역할, 상태, 가입일, 마지막 로그인, 녹음, 오디오). 오류 수와 한도 막대는 사용자 상세에 있다 | admin.e2e.ts › sort by keyboard | 있음 |
| 17 | 멤버: 상태 필터 없이 볼 때 상태별 묶음(승인 대기 먼저) | — | 표 하나 | — | 일부러 뺌(새 콘솔의 표는 머리글로 정렬하고 상태 필터로 거른다. `상태` 머리글 정렬과 상태 필터가 같은 일을 한다) |
| 18 | 멤버: 역할 필터(전체·소유자·관리자·멤버·보기 전용, 개수) | — | /app/admin/users `역할` 선택(개수), 주소 `role` | admin-members.e2e.ts › user filters stay in the address | 있음 |
| 19 | 멤버: 상태 필터(활성·승인 대기·정지, 개수) | — | /app/admin/users `상태` 선택(개수), 주소 `status` | admin-members.e2e.ts › user filters stay in the address | 있음 |
| 20 | 멤버: 검색(이름, 이메일, 메모) | — | /app/admin/users `검색`, 주소 `q` | admin-members.e2e.ts › user filters stay in the address | 있음 |
| 21 | 멤버: 가입 승인 | PATCH /api/admin/users/:id {status} | 사용자 줄 `승인`, 사용자 상세 `가입 승인` | admin.e2e.ts › approve and suspend | 있음 |
| 22 | 멤버 상세: 속성(상태, 역할, 강의·공개·오류, 오디오/한도, 세션 수, 최근 로그인, 가입, ID) | GET /api/admin/overview (users) | /app/admin/users/$userId | admin-members.e2e.ts › user detail shows the account | 있음 |
| 23 | 멤버 상세: 이 멤버의 강의 보기 | GET /api/admin/lectures?owner= | 사용자 상세 `이 사용자의 녹음` → /app/admin/recordings?owner= | admin-members.e2e.ts › owner link | 있음 |
| 24 | 멤버 수정: 표시 이름 | PATCH /api/admin/users/:id {displayName} | 사용자 상세 `표시 이름` | admin-members.e2e.ts › edit a user | 있음 |
| 25 | 멤버 수정: 역할(자기 자신은 못 바꿈, 소유자는 소유자만) | PATCH /api/admin/users/:id {role} | 사용자 상세 `역할`, 사용자 줄 역할 선택 | admin-members.e2e.ts › edit a user | 있음 |
| 26 | 멤버 수정: 상태(활성·대기·정지) | PATCH /api/admin/users/:id {status} | 사용자 상세 `상태`, 사용자 줄 `정지`·`정지 해제` | admin.e2e.ts › approve and suspend | 있음 |
| 27 | 멤버 수정: 녹음·업로드 허용 | PATCH /api/admin/users/:id {canIngest} | 사용자 상세 스위치 `녹음·업로드 허용` | admin-members.e2e.ts › edit a user | 있음 |
| 28 | 멤버 수정: 공개 공유 링크 허용 | PATCH /api/admin/users/:id {canShare} | 사용자 상세 스위치 `공개 공유 링크 허용` | admin-members.e2e.ts › edit a user | 있음 |
| 29 | 멤버 수정: 서버 AI 키 사용 | PATCH /api/admin/users/:id {canUseServerKey} | 사용자 상세 스위치 `서버 AI 키로 노트 만들기` | admin-members.e2e.ts › edit a user | 있음 |
| 30 | 멤버 수정: 오디오 한도(MB, 0 = 무제한) | PATCH /api/admin/users/:id {quotaMb} | 사용자 상세 `오디오 저장 한도(MB)` | admin-members.e2e.ts › edit a user | 있음 |
| 31 | 멤버 수정: 메모 | PATCH /api/admin/users/:id {memo} | 사용자 상세 `메모` | admin-members.e2e.ts › edit a user | 있음 |
| 32 | 멤버 수정: 비밀번호 재설정(6자 이상, 비우면 그대로) | PATCH /api/admin/users/:id {newPassword} | 사용자 상세 `새 비밀번호` | admin-members.e2e.ts › edit a user; admin-members.e2e.ts › short password is refused | 있음 |
| 33 | 멤버 수정: 모든 세션 로그아웃 | PATCH /api/admin/users/:id {revokeSessions} | 사용자 상세 스위치 `저장할 때 모든 세션 로그아웃` | admin-members.e2e.ts › edit a user | 있음 |
| 34 | 멤버 삭제(이메일을 입력해 확인) | DELETE /api/admin/users/:id | 사용자 줄 `삭제`, 사용자 상세 `삭제` → 확인 대화상자 | admin.e2e.ts › delete user needs the e-mail | 있음 |
| 35 | 새 멤버 만들기(이메일, 이름, 비밀번호, 역할, 상태, 권한 셋, 한도, 메모; 기본값은 설정) | POST /api/admin/users | /app/admin/users `새 사용자` 대화상자, 만든 뒤 그 사용자 상세로 | admin-members.e2e.ts › create a user | 있음 |

## 강의 → 녹음

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 36 | 강의: 전체 목록(상태, 제목, 과목, 소유자, 길이, 크기, 압축됨, 만든 시각) | GET /api/admin/lectures | /app/admin/recordings 표(상태, 제목과 과목, 소유자, 길이, 오디오, 만든 시각), 머리글 정렬 | admin-members.e2e.ts › recordings table sorts; server/admin.e2e.ts › admin members and recordings render against the real server | 있음 |
| 37 | 강의: 처리 중 진행률 표시 | GET /api/admin/lectures | 상태 배지 `처리 중 40%`, 압축 작업은 `압축 대기`·`압축 중` | admin-members.e2e.ts › recordings filter, search and more | 있음 |
| 38 | 강의: 상태 필터(전체·처리 중·오류·완료, 개수) | GET /api/admin/lectures?status= | `상태` 선택(응답의 `counts`), 주소 `status` | admin-members.e2e.ts › recordings filter, search and more | 있음 |
| 39 | 강의: 검색(제목, 과목, 소유자) | GET /api/admin/lectures?q= | `검색`(250ms 뒤 요청), 주소 `q` | admin-members.e2e.ts › recordings filter, search and more | 있음 |
| 40 | 강의: 소유자 필터와 해제 칩 | GET /api/admin/lectures?owner= | 주소 `owner`, 버튼 `소유자 필터 해제: <이름>` | admin-members.e2e.ts › owner link | 있음 |
| 41 | 강의: 더 보기(50개씩) | GET /api/admin/lectures?offset= | `더 보기 (N개 남음)` | admin-members.e2e.ts › recordings filter, search and more | 있음 |
| 42 | 강의: 처리 중이거나 작업이 걸린 강의가 있으면 5초마다 목록·상세를 다시 읽기 | GET /api/admin/lectures, GET /api/admin/lectures/:id | 녹음 목록·상세가 그동안 5초마다 다시 읽는다 | admin-members.e2e.ts › recording refreshes while it is being worked on | 있음 |
| 43 | 강의: 목록을 못 불러오면 개요의 최근 강의로 대신 보여 주기 | GET /api/admin/overview (recentLectures) | 오류 상자와 `다시 시도` | — | 일부러 뺌(최근 강의 몇 개로 바꿔 보이면 필터 개수와 더 보기가 맞지 않는 목록이 정상처럼 보인다. 새 콘솔은 불러오지 못했다고 말하고 다시 시도하게 한다) |
| 44 | 강의 상세: 속성(상태, 단계, 소유자, 과목, 길이, 오디오 크기·형식·압축됨, 압축 전후와 비율, 압축 시각, 보관 위치, 업로드 경로, 모델, 노트 글자 수, 공개, 생성·수정 시각, ID, 요약) | GET /api/admin/lectures/:id | /app/admin/recordings/$lectureId, 소유자는 사용자 상세 링크 | admin-members.e2e.ts › recording detail shows the lecture; server/admin.e2e.ts › admin members and recordings render against the real server | 있음 |
| 45 | 강의 상세: 오류 메시지 | GET /api/admin/lectures/:id | 녹음 상세 `오류 메시지` 메모 | admin-members.e2e.ts › retry an errored recording | 있음 |
| 46 | 강의 상세: 진행 중 작업(종류, 단계, 진행률) | GET /api/admin/ops | P5-13 | — | 없음 |
| 47 | 강의: 재시도(오디오가 있고 오류 또는 멈춘 처리 중; 409 = 이미 처리 중) | POST /api/lectures/:id/retry | 녹음 상세 `재시도` | admin-members.e2e.ts › retry an errored recording | 있음 |
| 48 | 강의: 지금 압축(완료, 압축 전, 건너뜀 아님, 업로드 폴더 안) | POST /api/admin/storage/compact {ids} | 녹음 상세 `지금 압축` | admin-members.e2e.ts › compact a recording | 있음 |
| 49 | 강의: 오디오 삭제(확인) | DELETE /api/lectures/:id/audio | 녹음 상세 `오디오 삭제` → 확인 대화상자 | admin-members.e2e.ts › recording actions ask first | 있음 |
| 50 | 강의: 강의 삭제(확인) | DELETE /api/lectures/:id | 녹음 상세 `녹음 삭제` → 확인 대화상자, 목록으로 | admin-members.e2e.ts › delete a recording | 있음 |
| 51 | 강의: 앱에서 열기(`/?lecture=<id>`) | — | — | — | 일부러 뺌(새 앱의 녹음 주소는 v2 녹음 id를 쓰는데 관리자 강의 응답에는 그 id가 없다. 운영자는 남의 녹음을 새 앱에서 열 수도 없다) |

## 작업(v1)

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 52 | 작업: 실행 중·대기·24시간 완료·평균 처리 시간, 동시 실행 수 | GET /api/admin/ops | P5-13 | — | 없음 |
| 53 | 작업: 실행 중 목록(종류, 강의, 소유자, 진행률, 단계, 시각) | GET /api/admin/ops | P5-13 | — | 없음 |
| 54 | 작업: 대기 목록 | GET /api/admin/ops | P5-13 | — | 없음 |
| 55 | 작업: 최근 완료(성공·실패, 오류, 절약 용량, 걸린 시간) | GET /api/admin/ops | P5-13 | — | 없음 |

## 스토리지

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 56 | 스토리지: 오디오·업로드 폴더·디스크·압축 절약 수치 | GET /api/admin/storage, GET /api/admin/ops | P5-13 | — | 없음 |
| 57 | 스토리지: 압축 카드(자동 압축, 비트레이트, 대상, 예상 절약, 완료, 진행) | GET /api/admin/storage | P5-13 | — | 없음 |
| 58 | 스토리지: 전체 압축(미리보기 → 확인) | POST /api/admin/storage/compact {all, dryRun} | P5-13 | — | 없음 |
| 59 | 스토리지: 보존 정책 적용(실패한 강의 오디오, 보존 기간 지난 오디오; 미리보기 → 확인) | POST /api/admin/storage/retention {dryRun} | P5-13 | — | 없음 |
| 60 | 스토리지: 고아 파일 휴지통으로(미리보기 → 확인) | POST /api/admin/storage/gc {dryRun} | P5-13 | — | 없음 |
| 61 | 스토리지: 휴지통 용량·자동 삭제 일수 | GET /api/admin/storage | P5-13 | — | 없음 |
| 62 | 스토리지: 형식별 | GET /api/admin/storage | P5-13 | — | 없음 |
| 63 | 스토리지: 상태별 | GET /api/admin/storage | P5-13 | — | 없음 |
| 64 | 스토리지: 사용자별(한도 대비) | GET /api/admin/storage | P5-13 | — | 없음 |
| 65 | 스토리지: 가장 큰 녹음(압축, 오디오 삭제) | GET /api/admin/storage | P5-13 | — | 없음 |

## 감사 로그

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 66 | 감사 로그: 목록(동작, 상세, 행위자, 시각) | GET /api/admin/audit | P5-13 | — | 없음 |
| 67 | 감사 로그: 동작 접두어 필터(개수) | GET /api/admin/audit?action= | P5-13 | — | 없음 |
| 68 | 감사 로그: 검색 | GET /api/admin/audit?q= | P5-13 | — | 없음 |
| 69 | 감사 로그: 더 보기 | GET /api/admin/audit?cursor= | P5-13 | — | 없음 |
| 70 | 감사 로그 상세(시각, 동작, 수행자, 대상 링크, ID, 상세) | — | P5-13 | — | 없음 |

## 설정

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 71 | 설정: 공개 회원가입 허용 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 72 | 설정: 가입 승인 필요 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 73 | 설정: 새 사용자 기본 역할 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 74 | 설정: 서버 AI 키 기본 허용 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 75 | 설정: 기본 오디오 한도 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 76 | 설정: 자동 압축 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 77 | 설정: 압축 비트레이트 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 78 | 설정: 완료 강의 오디오 보존 일수 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 79 | 설정: 실패한 강의 보존 일수 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 80 | 설정: 감사 로그 보존 일수 | PATCH /api/admin/settings | P5-13 | — | 없음 |
| 81 | 설정: 저장하지 않은 변경 표시·되돌리기, 떠날 때 경고 | — | P5-13 | — | 없음 |

## 운영

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 82 | 운영: 유지보수 주기·마지막 실행·요약, 지금 실행(확인 → 결과) | GET /api/admin/ops, POST /api/admin/maintenance/run | P5-13 | — | 없음 |
| 83 | 운영: 백업(최신 파일·크기·시각, 보관 수·최대·합계) | GET /api/admin/ops | P5-13 | — | 없음 |
| 84 | 운영: 배포(진행 중, 성공·실패, sha, 시각, 오류) | GET /api/admin/ops | P5-13 | — | 없음 |
| 85 | 운영: 서버(sha, 가동 시간, 메모리, Bun, 플랫폼, PID, ffmpeg, 요청·5xx) | GET /api/admin/ops | P5-13 | — | 없음 |
| 86 | 운영: 데이터베이스(크기, WAL, 멤버·강의·세션·감사 로그 수) | GET /api/admin/ops | P5-13 | — | 없음 |

## 콘솔 껍데기

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 87 | 관리자 아님 화면(권한 없음 안내) | GET /api/auth/me | /app/admin은 관리자가 아니면 `페이지를 찾을 수 없습니다.`, 메뉴에 `관리`가 없다 | admin.e2e.ts › non-admin sees not found | 있음 |
| 88 | 로그인 필요 화면(로그인 페이지로) | GET /api/auth/me | 로그인하지 않으면 /app/login으로 갔다가 로그인 뒤 돌아온다 | organise.e2e.ts › a deep link without a session goes to login and comes back after it | 있음 |
| 89 | 연결할 수 없음 화면, 화면별 `불러오지 못함`과 다시 불러오기 | GET /api/auth/me 등 | P5-13 | — | 없음 |
| 90 | 사이드바 보기별 개수와 점(멤버 수·대기, 강의 수·오류, 실행 중 작업, 디스크 부족) | GET /api/admin/overview, GET /api/admin/ops | P5-13 | — | 없음 |
| 91 | 좁은 화면의 메뉴 서랍 | — | P5-13 | — | 없음 |
| 92 | 명령 팔레트(보기 이동, 명령, 강의 검색) | GET /api/admin/lectures?q= | P5-13 | — | 없음 |
| 93 | 키보드 단축키(G+키 이동, C 새 멤버, ? 도움말, j/k 행 이동, ⌘↵ 저장) | — | P5-13 | — | 없음 |
| 94 | 5초마다 자동 갱신(개요·작업; 강의는 42행), 새로고침 버튼 | GET /api/admin/overview, GET /api/admin/ops | P5-13 | — | 없음 |
| 95 | 테마 전환 | — | P5-13 | — | 없음 |
| 96 | 앱으로 돌아가기, 로그아웃 | POST /api/auth/logout | P5-13 | — | 없음 |
