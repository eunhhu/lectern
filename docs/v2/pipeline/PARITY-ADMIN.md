# 관리자 콘솔 기능 대조표

`apps/server/src/ui.ts`의 옛 관리자 콘솔(`renderAdminPageHtml`, `ADMIN_PAGE_SCRIPT`, `/admin`)이 하는 일을 모두 적고, 새 웹 앱의 관리 화면(`/app/admin`)에서 같은 일을 하는 곳과 그것을 덮는 e2e 테스트를 짝짓는다. 옛 콘솔을 지우기(P5-14) 전에 빠진 기능이 없는지 확인하는 표다.

- P5-12(관리자 콘솔 1부)가 개요·사용자·작업·사용량을, P5-16(멤버와 녹음)이 사용자 상세·새 사용자·녹음을, P5-13(관리자 콘솔 2부)이 저장소·운영·설정·감사 로그·개요의 확인 필요와 최근 활동·콘솔 껍데기(탭 개수, 팔레트, 단축키, 자동 갱신, 새로고침)를 채웠다. `없음`인 행은 남지 않았다.
- 97–100행은 P5-13이 옮기지 않기로 한 옛 콘솔의 동작이다. `일부러 뺌` 행은 모두 사유를 적었고, P5-14(옛 콘솔 삭제)를 승인할 때 읽는다.
- 옛 콘솔에 없던 v1 사용량 화면(`/admin/v1-usage`)은 이 표에 없다. P6-03이 데이터를 만든 뒤에 더한다(STATUS "넘겨받은 요청").

상태 값:

- `있음`: 새 콘솔에 같은 일을 하는 기능이 있다. 방식이 달라도 같은 목적을 이루면 `있음`이고, 다른 점은 새 화면 칸에 적는다.
- `없음`: 새 콘솔에 아직 없다. 지금은 이 값인 행이 없다.
- `일부러 뺌(사유)`: 옮기지 않기로 했다. 사유를 상태 칸에 적는다.

e2e 칸은 `파일명 › 테스트 제목`이다. `server/`로 시작하면 `apps/web/e2e/server/`의 real-server e2e, 아니면 `apps/web/e2e/`의 fixture e2e다. 테스트 제목은 코드의 제목과 글자 그대로 같다.

옛 콘솔의 화면은 일곱 개다: 개요, 멤버, 강의, 작업, 스토리지, 감사 로그, 설정. 새 콘솔에서 멤버는 `사용자`, 강의는 `녹음`이다. 작업 화면은 P5-12가 v2 작업(`/api/v2/admin/jobs`)으로 새로 만들었고, 옛 v1 작업 보기(`/api/admin/ops`의 jobs)는 P5-13이 `운영` 탭의 `v1 작업` 절로 옮겼다. 스토리지는 `저장소`다.

## 개요

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 1 | 개요: 멤버 수(전체, 활성·대기·정지) | GET /api/admin/overview | /app/admin 카드 `전체 사용자`, `활성 사용자`, `승인 대기`, `정지된 사용자` | admin.e2e.ts › overview cards | 있음 |
| 2 | 개요: 강의 수(전체, 오류·공개) | GET /api/admin/overview | /app/admin `녹음` 수, 카드 `오류 난 녹음`, `공개 녹음` | admin.e2e.ts › overview cards | 있음 |
| 3 | 개요: 오디오 용량 | GET /api/admin/overview, GET /api/admin/storage | /app/admin 카드 `오디오 저장 용량` | admin.e2e.ts › overview cards | 있음 |
| 4 | 개요: 디스크 여유와 사용률 막대 | GET /api/admin/ops | /app/admin 카드 `오디오 저장 용량`의 `디스크 여유 X / Y (N% 사용)`. 사용률 막대는 /app/admin/storage `디스크` 카드(`디스크 사용률`) | admin-ops.e2e.ts › overview: attention items; admin-ops.e2e.ts › storage: breakdowns and the largest recordings | 있음 |
| 5 | 개요: v1 작업 수(실행 중·대기·24시간 완료·실패, 평균 처리 시간) | GET /api/admin/ops | /app/admin/ops `v1 작업 수치`(실행 중·대기 중·24시간 완료와 실패·평균 처리 시간). 개요의 `작업` 카드는 v2 작업(P5-12) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue | 있음 |
| 6 | 개요 확인 필요: 가입 승인 대기(승인 버튼) | PATCH /api/admin/users/:id {status} | /app/admin `확인 필요`의 `가입 승인 대기`, 버튼 `승인: <이메일>` | admin-ops.e2e.ts › overview: attention items | 있음 |
| 7 | 개요 확인 필요: 분석 실패 강의(재시도, 오류 강의 목록으로) | POST /api/lectures/:id/retry | `확인 필요`의 `분석 실패`, 버튼 `재시도: <제목>`, 링크 `오류 녹음 N개 모두 보기` → /app/admin/recordings?status=error | admin-ops.e2e.ts › overview: attention items | 있음 |
| 8 | 개요 확인 필요: 디스크 여유 부족 | GET /api/admin/ops | `확인 필요`의 `디스크 여유 공간 부족`(사용률), `저장소` 탭의 점 | admin-ops.e2e.ts › overview: trouble items | 있음 |
| 9 | 개요 확인 필요: 백업 없음·오래됨(유지보수 실행) | GET /api/admin/ops | `확인 필요`의 `백업이 오래되었습니다`·`백업이 없습니다`, 버튼 `유지보수 실행` | admin-ops.e2e.ts › overview: attention items | 있음 |
| 10 | 개요 확인 필요: ffmpeg 없음 | GET /api/admin/ops | `확인 필요`의 `ffmpeg를 사용할 수 없습니다`(그동안 압축 항목은 없다) | admin-ops.e2e.ts › overview: trouble items | 있음 |
| 11 | 개요 확인 필요: 압축 가능한 녹음 | GET /api/admin/storage | `확인 필요`의 `압축 가능한 녹음 N개`, 버튼 `압축 미리보기` → `전체 압축` 대화상자 | admin-ops.e2e.ts › overview: attention items | 있음 |
| 12 | 개요 확인 필요: 유지보수 오류 | GET /api/admin/ops | `확인 필요`의 `유지보수 오류 N건` | admin-ops.e2e.ts › overview: trouble items | 있음 |
| 13 | 개요 확인 필요: 최근 배포 실패 | GET /api/admin/ops | `확인 필요`의 `최근 배포 실패`(오류 메시지) | admin-ops.e2e.ts › overview: trouble items | 있음 |
| 14 | 개요 확인 필요: 운영·스토리지를 못 불러와 점검을 건너뛴 알림 | GET /api/admin/ops, GET /api/admin/storage | 개요 안내 `운영·저장소 정보를 불러오지 못해 디스크·백업·압축 점검은 건너뛰었습니다.` | admin-ops.e2e.ts › unavailable screens offer a retry | 있음 |
| 15 | 개요: 최근 활동(감사 로그 10건, 전체 보기) | GET /api/admin/overview | /app/admin `최근 활동` 10건, `자세히` → `감사 로그` 대화상자, 링크 `감사 로그 전체 보기` | admin-ops.e2e.ts › overview: recent activity | 있음 |

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
| 42 | 강의: 처리 중이거나 작업이 걸린 강의가 있으면 15초마다 목록을 다시 읽기(목록이 50개 이하일 때) | GET /api/admin/lectures | 녹음 목록·상세가 그동안 5초마다 다시 읽는다(목록 길이와 상관없이) | admin-members.e2e.ts › recording refreshes while it is being worked on | 있음 |
| 43 | 강의: 목록을 못 불러오면 개요의 최근 강의로 대신 보여 주기 | GET /api/admin/overview (recentLectures) | 오류 상자와 `다시 시도` | — | 일부러 뺌(최근 강의 몇 개로 바꿔 보이면 필터 개수와 더 보기가 맞지 않는 목록이 정상처럼 보인다. 새 콘솔은 불러오지 못했다고 말하고 다시 시도하게 한다) |
| 44 | 강의 상세: 속성(상태, 단계, 소유자, 과목, 길이, 오디오 크기·형식·압축됨, 압축 전후와 비율, 압축 시각, 보관 위치, 업로드 경로, 모델, 노트 글자 수, 공개, 생성·수정 시각, ID, 요약) | GET /api/admin/lectures/:id | /app/admin/recordings/$lectureId, 소유자는 사용자 상세 링크 | admin-members.e2e.ts › recording detail shows the lecture; server/admin.e2e.ts › admin members and recordings render against the real server | 있음 |
| 45 | 강의 상세: 오류 메시지 | GET /api/admin/lectures/:id | 녹음 상세 `오류 메시지` 메모 | admin-members.e2e.ts › retry an errored recording | 있음 |
| 46 | 강의 상세: 진행 중 작업(종류, 단계, 진행률) | GET /api/admin/ops | 녹음 상세 `진행 중 작업` 영역(종류 · 실행 중/대기열, 단계, 진행률 막대). 작업이 있는 동안 5초마다 다시 읽는다 | admin-ops.e2e.ts › recording job box | 있음 |
| 47 | 강의: 재시도(오디오가 있고 오류 또는 멈춘 처리 중; 409 = 이미 처리 중) | POST /api/lectures/:id/retry | 녹음 상세 `재시도` | admin-members.e2e.ts › retry an errored recording | 있음 |
| 48 | 강의: 지금 압축(완료, 압축 전, 건너뜀 아님, 업로드 폴더 안) | POST /api/admin/storage/compact {ids} | 녹음 상세 `지금 압축` | admin-members.e2e.ts › compact a recording | 있음 |
| 49 | 강의: 오디오 삭제(확인) | DELETE /api/lectures/:id/audio | 녹음 상세 `오디오 삭제` → 확인 대화상자 | admin-members.e2e.ts › recording actions ask first | 있음 |
| 50 | 강의: 강의 삭제(확인) | DELETE /api/lectures/:id | 녹음 상세 `녹음 삭제` → 확인 대화상자, 목록으로 | admin-members.e2e.ts › delete a recording | 있음 |
| 51 | 강의: 앱에서 열기(`/?lecture=<id>`) | — | — | — | 일부러 뺌(새 앱의 녹음 주소는 v2 녹음 id를 쓰는데 관리자 강의 응답에는 그 id가 없다. 운영자는 남의 녹음을 새 앱에서 열 수도 없다) |

## 작업(v1)

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 52 | 작업: 실행 중·대기·24시간 완료·평균 처리 시간, 동시 실행 수 | GET /api/admin/ops | /app/admin/ops `v1 작업` 절의 `v1 작업 수치`(실행 중과 동시 실행 수, 대기 중, 24시간 완료·실패, 평균 처리 시간) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue | 있음 |
| 53 | 작업: 실행 중 목록(종류, 강의, 소유자, 진행률, 단계, 시각) | GET /api/admin/ops | `실행 중인 v1 작업` 표(종류, 녹음 링크, 소유자, 진행률, 단계, 시각) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue | 있음 |
| 54 | 작업: 대기 목록 | GET /api/admin/ops | `대기 중인 v1 작업` 표 | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue; admin-ops.e2e.ts › ops refreshes by itself | 있음 |
| 55 | 작업: 최근 완료(성공·실패, 오류, 절약 용량, 걸린 시간) | GET /api/admin/ops | `최근 완료된 v1 작업` 표(성공·실패, 오류, 절약 용량, 걸린 시간) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue | 있음 |

## 스토리지

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 56 | 스토리지: 오디오·업로드 폴더·디스크·압축 절약 수치 | GET /api/admin/storage, GET /api/admin/ops | /app/admin/storage `저장소 수치`(오디오, 업로드 폴더, 디스크와 `디스크 사용률` 막대, 압축으로 절약) | admin-ops.e2e.ts › storage: breakdowns and the largest recordings; server/admin.e2e.ts › admin storage and audit render against the real server | 있음 |
| 57 | 스토리지: 압축 카드(자동 압축, 비트레이트, 대상, 예상 절약, 완료, 진행) | GET /api/admin/storage | `압축` 절(자동 압축, 비트레이트와 녹음 1시간당 용량, 대상, 예상 절약, 완료, 진행 상황), 링크 `설정 변경` | admin-ops.e2e.ts › storage: breakdowns and the largest recordings; admin-ops.e2e.ts › storage: compaction asks first | 있음 |
| 58 | 스토리지: 전체 압축(미리보기 → 확인) | POST /api/admin/storage/compact {all, dryRun} | `전체 압축` → 미리보기 대화상자(대상 수·용량·예상 절약) → `압축 시작`. 팔레트 `전체 압축 (미리보기)` | admin-ops.e2e.ts › storage: compaction asks first | 있음 |
| 59 | 스토리지: 보존 정책 적용(실패한 강의 오디오, 보존 기간 지난 오디오; 미리보기 → 확인) | POST /api/admin/storage/retention {dryRun} | `회수 가능 공간`의 `정리: 실패한 강의의 오디오`, `정리: 보존 기간이 지난 오디오` → 미리보기 → `영구 삭제` | admin-ops.e2e.ts › storage: retention runs after a preview | 있음 |
| 60 | 스토리지: 고아 파일 휴지통으로(미리보기 → 확인) | POST /api/admin/storage/gc {dryRun} | `회수 가능 공간`의 `휴지통으로 이동` → 파일 목록이 든 대화상자 → `휴지통으로 이동` | admin-ops.e2e.ts › storage: orphans go to the trash | 있음 |
| 61 | 스토리지: 휴지통 용량·자동 삭제 일수 | GET /api/admin/storage | `회수 가능 공간`의 휴지통 줄(개수 · 용량 · N일 후 자동 삭제) | admin-ops.e2e.ts › storage: orphans go to the trash | 있음 |
| 62 | 스토리지: 형식별 | GET /api/admin/storage | `형식별 용량` 막대 | admin-ops.e2e.ts › storage: breakdowns and the largest recordings | 있음 |
| 63 | 스토리지: 상태별 | GET /api/admin/storage | `상태별 용량` 막대 | admin-ops.e2e.ts › storage: breakdowns and the largest recordings | 있음 |
| 64 | 스토리지: 사용자별(한도 대비) | GET /api/admin/storage | `사용자별 용량` 막대(한도 대비 %, 사용자 상세 링크) | admin-ops.e2e.ts › storage: breakdowns and the largest recordings | 있음 |
| 65 | 스토리지: 가장 큰 녹음(압축, 오디오 삭제) | GET /api/admin/storage | `가장 큰 녹음` 표(녹음 링크, 버튼 `압축: <제목>`, `오디오 삭제: <제목>` → 확인) | admin-ops.e2e.ts › storage: breakdowns and the largest recordings | 있음 |

## 감사 로그

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 66 | 감사 로그: 목록(동작, 상세, 행위자, 시각) | GET /api/admin/audit | /app/admin/audit `감사 로그` 표(시각, 행위자, 동작, 대상, 상세) | admin-ops.e2e.ts › audit: filter and more; server/admin.e2e.ts › admin storage and audit render against the real server | 있음 |
| 67 | 감사 로그: 동작 접두어 필터(개수) | GET /api/admin/audit?action= | `분류` 선택(응답의 개수), 주소 `action` | admin-ops.e2e.ts › audit: filter and more | 있음 |
| 68 | 감사 로그: 검색 | GET /api/admin/audit?q= | `검색`, 주소 `q` | admin-ops.e2e.ts › audit: filter and more | 있음 |
| 69 | 감사 로그: 더 보기 | GET /api/admin/audit?cursor= | `더 보기 (N건 남음)`(커서), 끝나면 `모든 기록을 표시했습니다.` | admin-ops.e2e.ts › audit: filter and more | 있음 |
| 70 | 감사 로그 상세(시각, 동작, 수행자, 대상 링크, ID, 상세) | — | 줄의 `자세히: <동작>, <시각>` → `감사 로그` 대화상자(대상이 사용자·녹음이면 그 상세 링크) | admin-ops.e2e.ts › audit: a row opens its details | 있음 |

## 설정

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 71 | 설정: 공개 회원가입 허용 | PATCH /api/admin/settings | /app/admin/settings 스위치 `공개 회원가입 허용` | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 72 | 설정: 가입 승인 필요 | PATCH /api/admin/settings | 스위치 `가입 시 관리자 승인 필요` | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 73 | 설정: 새 사용자 기본 역할 | PATCH /api/admin/settings | `기본 역할` 선택(멤버, 보기 전용). 새 사용자 대화상자의 기본값이 된다 | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 74 | 설정: 서버 AI 키 기본 허용 | PATCH /api/admin/settings | 스위치 `서버 AI 키로 노트 만들기 기본 허용` | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 75 | 설정: 기본 오디오 한도 | PATCH /api/admin/settings | `기본 오디오 한도(MB)`. 새 사용자 대화상자의 기본값이 된다 | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 76 | 설정: 자동 압축 | PATCH /api/admin/settings | 스위치 `자동 압축` | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 77 | 설정: 압축 비트레이트 | PATCH /api/admin/settings | `압축 비트레이트` 선택(24–96 kbps, 녹음 1시간당 용량) | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 78 | 설정: 완료 강의 오디오 보존 일수 | PATCH /api/admin/settings | `완료된 강의의 오디오` 스위치(끄기 = 0)와 `보존 일수` | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 79 | 설정: 실패한 강의 보존 일수 | PATCH /api/admin/settings | `실패한 강의` 스위치와 `보존 일수` | admin-ops.e2e.ts › settings: saving sends only the form | 있음 |
| 80 | 설정: 감사 로그 보존 일수 | PATCH /api/admin/settings | `감사 로그` 스위치와 `보존 일수` | admin-ops.e2e.ts › settings: saving sends only the form; server/admin.e2e.ts › admin storage and audit render against the real server | 있음 |
| 81 | 설정: 저장하지 않은 변경 표시·되돌리기, 떠날 때 경고 | — | 바뀌면 `저장`이 켜지고 `되돌리기`가 보인다, ⌘/Ctrl+Enter로 저장, 다른 곳으로 가면 `저장하지 않은 변경` 대화상자(`계속 수정`, `버리고 떠나기`) | admin-ops.e2e.ts › settings: revert and ⌘Enter; admin-ops.e2e.ts › settings: leaving with changes asks | 있음 |

## 운영

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 82 | 운영: 유지보수 주기·마지막 실행·요약, 지금 실행(확인 → 결과) | GET /api/admin/ops, POST /api/admin/maintenance/run | /app/admin/ops `유지보수` 절(주기, 마지막 실행, 요약, `마지막 결과 자세히`, 오류 안내), `유지보수 지금 실행` → 단계 목록 확인 → `유지보수 완료` 결과 대화상자. 팔레트 `유지보수 실행` | admin-ops.e2e.ts › ops: run maintenance | 있음 |
| 83 | 운영: 백업(최신 파일·크기·시각, 보관 수·최대·합계) | GET /api/admin/ops | `백업` 절(최신 백업, 크기, 만든 시각, `N개 보관 중 (최대 M개)`, 합계) | admin-ops.e2e.ts › ops: backups | 있음 |
| 84 | 운영: 배포(진행 중, 성공·실패, sha, 시각, 오류) | GET /api/admin/ops | `배포` 절(진행 중, 결과, 커밋, 시각, 오류) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue; admin-ops.e2e.ts › overview: trouble items | 있음 |
| 85 | 운영: 서버(sha, 가동 시간, 메모리, Bun, 플랫폼, PID, ffmpeg, 요청·5xx) | GET /api/admin/ops | `서버` 절(커밋, 가동 시간, 메모리, Bun, 플랫폼, PID, ffmpeg, 요청·5xx) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue | 있음 |
| 86 | 운영: 데이터베이스(크기, WAL, 멤버·강의·세션·감사 로그 수) | GET /api/admin/ops | `데이터베이스` 절(크기와 WAL, 사용자·녹음·세션·감사 로그 수) | admin-ops.e2e.ts › ops: server, database, deploy and the v1 queue | 있음 |

## 콘솔 껍데기

| # | 옛 콘솔 기능 | 옛 요청 (메서드 경로) | 새 화면 | e2e 이름 | 상태 |
|---|---|---|---|---|---|
| 87 | 관리자 아님 화면(권한 없음 안내) | GET /api/auth/me | /app/admin은 관리자가 아니면 `페이지를 찾을 수 없습니다.`, 메뉴에 `관리`가 없다 | admin.e2e.ts › non-admin sees not found | 있음 |
| 88 | 로그인 필요 화면(로그인 페이지로) | GET /api/auth/me | 로그인하지 않으면 /app/login으로 갔다가 로그인 뒤 돌아온다 | organise.e2e.ts › a deep link without a session goes to login and comes back after it | 있음 |
| 89 | 연결할 수 없음 화면, 화면별 `불러오지 못함`과 다시 불러오기 | GET /api/auth/me 등 | 세션 확인은 앱이 맡는다(88행). 관리 화면마다 불러오지 못하면 오류 상자와 `다시 시도`, 개요는 14행의 안내 | admin-ops.e2e.ts › unavailable screens offer a retry | 있음 |
| 90 | 사이드바 보기별 개수와 점(멤버 수·대기, 강의 수·오류, 실행 중 작업, 디스크 부족) | GET /api/admin/overview, GET /api/admin/ops | `관리 메뉴` 탭의 개수와 점(`사용자` 수·승인 대기, `녹음` 수·오류, `운영` 진행 중 v1 작업, `저장소` 디스크 부족). 링크의 설명으로 읽힌다 | admin-ops.e2e.ts › admin tabs show counts; admin-ops.e2e.ts › overview: trouble items | 있음 |
| 91 | 좁은 화면의 메뉴 서랍 | — | 좁은 화면에서는 `관리 메뉴`가 본문 위에 줄로 접혀 들어간다(서랍 대신). 앱 전체의 좁은 화면 메뉴는 앱이 맡는다 | admin-ops.e2e.ts › admin on a phone: every screen fits | 있음 |
| 92 | 명령 팔레트(보기 이동, 명령, 강의 검색) | GET /api/admin/lectures?q= | 앱의 ⌘K 팔레트에 운영자에게만, 검색어가 있을 때 `관리` 묶음: `관리 › <탭>` 이동, `유지보수 실행`, `전체 압축 (미리보기)`, `고아 파일 정리 (미리보기)`, `보존 정책 적용 (미리보기)`, `새 사용자`, `관리 · 모든 녹음` 제목 검색. 옛 팔레트의 테마·단축키·새로고침·앱으로·로그아웃은 95·93·94·96행 | admin-ops.e2e.ts › palette: admin screens and commands; admin-ops.e2e.ts › palette: nothing of the console for others | 있음 |
| 93 | 키보드 단축키(G+키 이동, C 새 멤버, ? 도움말, j/k 행 이동, ⌘↵ 저장) | — | `G O`·`G M`·`G J`·`G ,` 이동(운영자만), `C` 새 사용자(사용자 화면), `?` 단축키 시트의 `관리` 묶음, ⌘/Ctrl+Enter 설정 저장. 옛 `G J`(v1 작업)는 v2 `작업` 탭으로 간다(v1 큐는 `운영`). `G L`·`G S`·`G A`, `J`/`K`, `/`는 97–99행 | admin-ops.e2e.ts › admin shortcuts; admin-ops.e2e.ts › settings: revert and ⌘Enter | 있음 |
| 94 | 5초마다 자동 갱신(개요·작업; 강의는 42행), 새로고침 버튼 | GET /api/admin/overview, GET /api/admin/ops | 개요는 운영 5초·개요 30초·저장소 60초마다, `운영`은 5초마다(창이 뒤에 있으면 멈춘다). `관리 메뉴` 아래 `새로고침`이 관리 응답을 모두 다시 읽는다(편집 중일 수 있는 설정 폼은 빼고) | admin-ops.e2e.ts › ops refreshes by itself; admin-ops.e2e.ts › 새로고침 reads the admin answers again | 있음 |
| 95 | 테마 전환 | — | 앱의 테마 전환(사용자 메뉴 `테마 전환`, 팔레트 `테마 전환`, 설정 › 이 브라우저 `테마`) | parity.e2e.ts › theme: 테마 전환 flips the page theme and a reload keeps it | 있음 |
| 96 | 앱으로 돌아가기, 로그아웃 | POST /api/auth/logout | 관리 화면은 앱 안에 있어 앱의 주 메뉴가 늘 보인다. 로그아웃은 앱의 사용자 메뉴 | organise.e2e.ts › user menu: profile and account settings; server/flow.e2e.ts › library, recordings, 물어보기 and sign-out over the real API | 있음 |
| 97 | 단축키 `G L`(강의)·`G S`(스토리지)·`G A`(감사 로그) | — | 탭, 팔레트 `관리 › 녹음`·`관리 › 저장소`·`관리 › 감사 로그` | — | 일부러 뺌(앱의 `G L`·`G S`·`G A`가 라이브러리·설정·물어보기로 간다. 관리 화면에서만 뜻이 바뀌면 같은 키가 두 곳으로 간다. 그 화면은 탭과 팔레트로 간다) |
| 98 | 단축키 `J`/`K`(↓/↑) 줄 이동과 `Enter`로 열기 | — | 표의 줄 링크·버튼을 Tab으로 오가고 Enter로 연다 | — | 일부러 뺌(앱의 어느 표에도 줄 선택이 없다. 관리 표만 다르게 움직이면 단축키 체계(P2)가 갈린다. 표의 링크와 버튼은 키보드로 닿는다) |
| 99 | 단축키 `/`(검색 칸으로, 없으면 팔레트) | — | ⌘K 팔레트, 검색 칸은 Tab으로 | — | 일부러 뺌(앱은 검색을 ⌘K 팔레트로 연다. `/`는 앱의 단축키에 없다) |
| 100 | 감사 로그를 못 불러오면 개요의 최근 감사 로그 안에서 거르고 찾기 | GET /api/admin/overview (auditLogs) | 오류 상자와 `다시 시도` | — | 일부러 뺌(43행과 같은 이유. 최근 몇십 건만 거른 결과가 개수·더 보기와 맞지 않는데 정상처럼 보인다. 새 콘솔은 불러오지 못했다고 말하고 다시 시도하게 한다) |
