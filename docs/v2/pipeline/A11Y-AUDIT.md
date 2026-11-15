# 웹 앱 접근성 점검 (P7-04)

> 근거: [DESIGN.md](../../../DESIGN.md) §5, [apps/web/e2e/fixtures.ts](../../../apps/web/e2e/fixtures.ts)(`axe`, `tabTo`), [apps/web/e2e/keyboard-only.ts](../../../apps/web/e2e/keyboard-only.ts), [apps/web/e2e/server/zzz-keyboard-journey.e2e.ts](../../../apps/web/e2e/server/zzz-keyboard-journey.e2e.ts)
> 이 문서의 §4·§5 결과 칸은 사람이 VoiceOver와 브라우저로 직접 확인하고 채운다. 비어 있는 칸은 아직 확인하지 않았다는 뜻이다.

## 1. 기준

- WCAG 2.2 AA, DESIGN.md §5(접근성: 자동·수동 기준).
- **자동**: axe(WCAG 2.0·2.1·2.2 A·AA 태그, 위반 0건)와 키보드 e2e. Playwright가 화면마다 돌린다. 모든 e2e는 CSP 위반이나 잡히지 않은 오류가 하나라도 나면 실패한다.
  - 키보드 전용 여정(`e2e/server/zzz-keyboard-journey.e2e.ts`, 실제 서버): 가입 → 업로드 → 처리 중인 녹음 → 설정 → 로그아웃, 그리고 운영자 로그인 → 라이브러리 → 문서의 시각 표시로 플레이어 이동 → 공유 링크 만들기(Esc로 닫으면 `녹음 작업`으로 포커스 복귀) → 설정의 모든 구역 → 관리의 모든 탭(페이지마다 `<h1>`, 표에서 포커스가 빠져나옴) → 로그아웃. 페이지를 조작하는 것은 `page.keyboard.*`와 파일 선택 대화상자(OS의 것이라 Enter로 열고 `setFiles`로 고른다)뿐이다. `apps/web/test/keyboard-only.test.ts`가 소스에 마우스·`fill` 류 호출이 없는지 검사한다.
- **수동**: VoiceOver가 실제로 무엇을 읽는가, 확대·좁은 폭, 다크 모드 대비를 눈으로, 동작 줄이기, 다른 브라우저. 자동 검사가 통과해도 수동 항목은 따로 확인한다.

## 2. 자동 확인 범위

`apps/web/src/app/router.tsx`의 모든 경로(앞에 `basepath` `/app`). axe 칸은 그 화면에서 `axe(page, …)`를 부르는 e2e 파일과 라벨이다. 키보드 칸은 그 화면에서 Tab·화살표·Enter·Space·단축키·입력으로 조작하는 단계가 있는 e2e 파일이다(Esc로 닫기만 하는 것은 넣지 않았다). 대부분 마우스 조작과 섞여 있고, 처음부터 끝까지 키보드만 쓰는 것은 `server/zzz-keyboard-journey.e2e.ts`(전용)뿐이다. `server/`는 실제 서버(`e2e/server/start.ts`), 나머지는 픽스처 빌드다.

| 화면(경로) | axe를 도는 e2e | 키보드로 조작하는 e2e |
|---|---|---|
| `/app/login` | `a11y.e2e.ts`(로그인(Google·Apple), 다크), `organise.e2e.ts`(로그인, 다크, 오류), `server/flow.e2e.ts`(로그인 (서버)), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 로그인) | `server/zzz-keyboard-journey.e2e.ts`(전용), `account.e2e.ts`, `organise.e2e.ts` |
| `/app/signup` | `account.e2e.ts`(회원가입, 다크), `a11y.e2e.ts`(회원가입(Google·Apple) (다크)), `server/account.e2e.ts`(회원가입 (서버)), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 회원가입) | `server/zzz-keyboard-journey.e2e.ts`(전용), `account.e2e.ts` |
| `/app/reset` | `account.e2e.ts`(비밀번호 재설정, 다크) | 없음 |
| `/app/` | `a11y.e2e.ts`(홈, 라이트·다크), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 홈, 올리기 대화상자) | `server/zzz-keyboard-journey.e2e.ts`(전용), `keyboard.e2e.ts`, `organise.e2e.ts`, `search.e2e.ts`(⌘K), `admin-ops.e2e.ts`(⌘K) |
| `/app/library` | `a11y.e2e.ts`(라이브러리, 폴더, 스마트 보기, 폴더·태그 메뉴, 폴더 이름 바꾸기), `parity.e2e.ts`(라이브러리), `parity-mic.e2e.ts`(마이크 녹음 중), `server/flow.e2e.ts`(라이브러리 (서버)), `server/parity.e2e.ts`(라이브러리 검색, 올리기 실패), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 라이브러리) | `server/zzz-keyboard-journey.e2e.ts`(전용), `keyboard.e2e.ts`, `organise.e2e.ts`, `a11y.e2e.ts`(⌘K·?·U·Space), `ask.e2e.ts`(⌘K), `server/flow.e2e.ts` |
| `/app/recordings/$recordingId` | `a11y.e2e.ts`(녹음 상세: 긴 강의·일부 완료·처리 중·실패, 회의 상세, 원문 전사, 이전 노트), `keyboard.e2e.ts`(올린 녹음 상세), `ask.e2e.ts`(이 노트에 물어보기), `parity.e2e.ts`(좁은 화면), `pdf.e2e.ts`(PDF 뷰어, OCR 확인), `recording-actions.e2e.ts`(다시 처리, 오디오 삭제), `edit.e2e.ts`(문서 편집), `share.e2e.ts`(공유), `server/flow.e2e.ts`, `server/process.e2e.ts`, `server/share.e2e.ts`, `server/zz-edit.e2e.ts`, `server/zz-recording-actions.e2e.ts`, `server/zzz-keyboard-journey.e2e.ts`(처리 중인 녹음, 녹음 상세, 공유 대화상자) | `server/zzz-keyboard-journey.e2e.ts`(전용), `keyboard.e2e.ts`, `recording-actions.e2e.ts`, `share.e2e.ts`, `edit.e2e.ts`, `pdf.e2e.ts`, `parity.e2e.ts`, `ask.e2e.ts`(⌘K) |
| `/app/search` | `a11y.e2e.ts`(검색), `search.e2e.ts`(검색) | `search.e2e.ts` |
| `/app/ask` | `a11y.e2e.ts`(물어보기, 물어보기 대화), `ask.e2e.ts`(빈 상태, 여러 노트 답, 근거 없음, 오류), `server/flow.e2e.ts`(물어보기 (서버)) | `ask.e2e.ts`(⌘K로 묻고 Enter로 이 화면에 오는 것까지) |
| `/app/calendar` | `a11y.e2e.ts`(일정, 일정 (월)·(주)) | `organise.e2e.ts` |
| `/app/settings` | `a11y.e2e.ts`(설정, 설정 계정, 설정 연동·알림, 워크스페이스 설정, 새 토큰, 연결 해제 확인, 계정 삭제 요청, 멤버 내보내기 확인), `share.e2e.ts`(설정 · 공유 링크, 회수 확인), `server/account.e2e.ts`(설정 연동 (준비 중)), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 설정, 설정 (운영자)) | `server/zzz-keyboard-journey.e2e.ts`(전용), `account.e2e.ts`, `calendar-settings.e2e.ts` |
| `/app/invite` | `a11y.e2e.ts`(초대 수락, 초대 수락 오류) | 없음 |
| `/app/admin` | `a11y.e2e.ts`(관리 개요, 문제 있음), `server/admin.e2e.ts`(관리 개요 (서버)), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 개요) | `server/zzz-keyboard-journey.e2e.ts`(전용), `admin-ops.e2e.ts`(⌘K) |
| `/app/admin/users` | `a11y.e2e.ts`(관리 사용자, 새 사용자, 사용자 삭제 확인, 한도 설정), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 사용자) | `server/zzz-keyboard-journey.e2e.ts`(전용), `admin.e2e.ts` |
| `/app/admin/users/$userId` | `a11y.e2e.ts`(관리 사용자 상세) | 없음 |
| `/app/admin/recordings` | `a11y.e2e.ts`(관리 녹음), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 녹음) | `server/zzz-keyboard-journey.e2e.ts`(전용), `admin-members.e2e.ts` |
| `/app/admin/recordings/$lectureId` | `a11y.e2e.ts`(관리 녹음 상세, 오류) | 없음 |
| `/app/admin/jobs` | `a11y.e2e.ts`(관리 작업), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 작업) | `server/zzz-keyboard-journey.e2e.ts`(전용) |
| `/app/admin/jobs/$jobId` | `a11y.e2e.ts`(관리 작업 상세) | 없음 |
| `/app/admin/usage` | `a11y.e2e.ts`(관리 사용량), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 사용량) | `server/zzz-keyboard-journey.e2e.ts`(전용) |
| `/app/admin/storage` | `a11y.e2e.ts`(관리 저장소, 전체 압축 미리보기, 보존 정책 확인), `server/admin.e2e.ts`(관리 저장소 (서버)), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 저장소) | `server/zzz-keyboard-journey.e2e.ts`(전용), `admin-ops.e2e.ts` |
| `/app/admin/ops` | `a11y.e2e.ts`(관리 운영, 유지보수 결과), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 운영) | `server/zzz-keyboard-journey.e2e.ts`(전용) |
| `/app/admin/settings` | `a11y.e2e.ts`(관리 설정, 저장하지 않은 변경), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 설정) | `server/zzz-keyboard-journey.e2e.ts`(전용) |
| `/app/admin/audit` | `a11y.e2e.ts`(관리 감사 로그, 감사 로그 항목), `server/admin.e2e.ts`(관리 감사 로그 (서버)), `server/zzz-keyboard-journey.e2e.ts`(키보드 여정: 관리 감사 로그) | `server/zzz-keyboard-journey.e2e.ts`(전용) |

라우터 밖의 화면: 명령 팔레트·단축키 표·업로드 대화상자는 `a11y.e2e.ts`(명령 팔레트, 단축키, 업로드 대화상자, 사용자 메뉴)가 axe를 돈다. 공개 공유 페이지(`/s/…`)는 서버가 그리는 페이지라 이 앱의 e2e 밖이다(수동 점검 §4.10).

## 3. 이 작업에서 고친 것

| 화면 | 증상 | 고친 파일 |
|---|---|---|
| 녹음 상세(처리 중) | 처리 상태 문구(`처리 대기 중…`, `받아쓰는 중 · 40%`)가 상태 영역이 아니어서 바뀌어도 읽히지 않았다. 감싼 요소의 `aria-busy="true"`는 처리가 끝날 때까지 알림을 미루게 할 수 있었다 | `apps/web/src/routes/recording/RecordingPage.tsx`(문구에 `role="status"`, `aria-busy` 제거) |
| 녹음 상세 | `녹음 작업` 메뉴에서 연 대화상자(공유, 다시 처리, 오디오만 삭제, 폴더로 이동, 태그)를 닫으면 포커스가 `<body>`로 사라졌다(대화상자를 연 메뉴 항목이 이미 없다) | `apps/web/src/routes/recording/RecordingPage.tsx`(메뉴에서 연 대화상자가 닫힐 때 `녹음 작업` 버튼으로 포커스를 돌려보낸다. 제목 옆 `태그 붙이기`·`태그 편집` 버튼으로 연 대화상자는 그 버튼으로 돌아간다). 확인: 공유는 키보드 여정, 폴더로 이동·태그·공유·`태그 붙이기`는 `recording-actions.e2e.ts`의 새 테스트, 오디오만 삭제의 취소도 같은 파일. 다시 처리는 원래 돌아갔다(같은 파일의 기존 키보드 테스트) |

## 4. VoiceOver 수동 점검표

모든 화면에 공통 항목 1~7을 확인하고, 그 화면만의 항목을 이어서 확인한다. 결과는 `통과` 또는 `실패: <무엇을 들었나>`로 적는다.

공통 항목
1. 페이지에 들어가면 제목(문서 제목과 `<h1>`)을 읽는다
2. 로터의 랜드마크 목록에 내비게이션·본문이 있다
3. 로터의 제목 목록이 화면 구조와 맞다
4. 모든 버튼·링크·입력 칸의 이름을 읽는다(아이콘 버튼 포함)
5. 상태가 바뀌면 알려 준다(저장됨, 오류, 업로드 진행, 처리 완료)
6. 대화상자·메뉴를 열면 그 안으로 가고, 닫으면 연 곳으로 돌아온다
7. 오류 문구가 해당 입력 칸과 함께 읽힌다

### 4.1 로그인 (`/app/login`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 틀린 비밀번호 | 오류 문구를 바로 읽고, 비밀번호 칸이 비워졌다는 것을 알 수 있다 | | |
| Google·Apple 로그인 버튼 | 어느 서비스로 로그인하는지 이름으로 구별된다 | | |

### 4.2 회원가입 (`/app/signup`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 인증번호 받기 | 보냈다·실패했다·다시 보낼 수 있는 시간(초)을 읽는다 | | |
| 비밀번호 확인이 다를 때 | 오류가 비밀번호 확인 칸과 함께 읽힌다 | | |
| 승인 대기 | 가입 뒤 승인 대기 안내를 읽는다 | | |

### 4.3 비밀번호 재설정 (`/app/reset`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 인증번호 요청 뒤 | "가입된 계정이라면…" 안내를 읽는다(계정이 있는지 드러내지 않는다) | | |
| 단계가 바뀔 때 | 새 비밀번호 단계로 넘어간 것을 알 수 있다 | | |

### 4.4 홈 (`/app/`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 처리 중인 녹음 | 목록의 각 줄에서 제목과 처리 상태를 함께 읽는다 | | |
| 일정 제안 | 제안의 날짜·제목과 수락·무시 버튼의 대상이 읽힌다 | | |
| 사이드바 `홈`의 개수 | `확인할 항목 n개`로 읽힌다 | | |

### 4.5 라이브러리 (`/app/library`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 폴더 트리 | 폴더 이름, 펼침 상태, 단계(깊이)가 읽힌다 | | |
| 녹음 목록 | 줄마다 제목·날짜·길이·상태를 읽고, 선택하면 `n개 선택됨`을 읽는다 | | |
| 끌어다 놓기 대안 | `폴더로 이동…`으로 같은 일을 할 수 있다는 것을 찾을 수 있다 | | |

### 4.6 업로드 대화상자

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 파일을 고른 뒤 | `파일 n개를 골랐습니다. 녹음 m개로 묶었습니다.`를 읽는다 | | |
| 오디오·PDF 짝짓기 | 어느 녹음에 어느 PDF가 붙었는지, 붙은 이유를 읽는다 | | |
| 올리기 진행과 끝 | 진행률과 `녹음 n개를 올렸습니다.`를 읽는다 | | |

### 4.7 녹음 상세 (`/app/recordings/…`: 문서·전사·플레이어·출처)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 재생 중 전사 | 현재 전사 줄이 바뀔 때 계속 읽어 대지 않는다 | | |
| 출처 버튼 | `출처 1, 12분 30초`처럼 번호와 시각으로 읽힌다 | | |
| 재생 위치 슬라이더 | 값이 시간(`1분 5초 / 3분`)으로 읽힌다 | | |
| 처리 중 | 처리 상태 문구가 바뀔 때 읽힌다(이 작업에서 고침) | | |

### 4.8 문서 편집

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 편집 모드 들어가기·나가기 | 편집 중이라는 것과 저장 여부를 읽는다 | | |
| 저장 충돌 | 충돌 안내와 고를 수 있는 동작을 읽는다 | | |
| 저장하지 않은 변경 | 떠나려 할 때 확인 대화상자를 읽는다 | | |

### 4.9 공유 대화상자

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 링크를 만든 뒤 | "지금만 볼 수 있습니다" 안내와 링크 칸, `링크 복사`를 읽는다 | | |
| 만든 링크 목록 | 링크마다 범위·만료와 회수 버튼의 대상이 읽힌다 | | |
| 닫은 뒤 | `녹음 작업` 버튼으로 돌아온다(이 작업에서 고침) | | |

### 4.10 공개 공유 페이지 (`/s/…`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 비밀번호가 있는 링크 | 비밀번호 칸과 틀렸을 때의 오류를 읽는다 | | |
| 로그인 없이 | 로그인 화면으로 보내지 않고 문서를 읽는다 | | |

### 4.11 물어보기 (`/app/ask`, 녹음 상세의 물어보기 패널)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 답이 흘러나오는 동안 | 한 글자씩 읽어 대지 않고, 끝나면 `답변을 마쳤습니다. 출처 n개.`를 읽는다 | | |
| 출처 링크 | 어느 녹음의 몇 분인지 읽는다 | | |
| 근거 없음 | `관련 내용을 찾지 못했습니다.`를 읽는다 | | |

### 4.12 일정 (`/app/calendar`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 날짜 칸 | 날짜와 그날의 일정 수를 읽는다 | | |
| 월·주 전환 | 바뀐 보기와 기간을 읽는다 | | |

### 4.13 설정 (`/app/settings`, 각 구역)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 목차 | 목차 링크로 구역으로 옮겨 가면 그 구역 제목부터 읽는다 | | |
| 프로필 저장 | `프로필을 저장했습니다.`를 읽는다 | | |
| 토큰 만들기 | 새 토큰 원문이 한 번만 보인다는 안내와 복사 버튼을 읽는다 | | |
| 계정 삭제·멤버 내보내기 | 확인 대화상자가 무엇을 지우는지 읽는다 | | |

### 4.14 초대 수락 (`/app/invite`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 다른 계정으로 로그인한 경우 | 어느 계정으로 초대됐는지와 오류를 읽는다 | | |
| 수락 뒤 | 들어간 워크스페이스를 알 수 있다 | | |

### 4.15 관리 (`/app/admin/…`, 각 페이지)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다(개요, 사용자, 사용자 상세, 녹음, 녹음 상세, 작업, 작업 상세, 사용량, 저장소, 운영, 설정, 감사 로그 각각) | | |
| 표 | 열 제목이 칸과 함께 읽힌다 | | |
| 관리 메뉴의 개수·점 | 링크 이름은 탭 이름이고, 개수와 상태는 설명으로 읽힌다 | | |
| 위험한 동작 | 사용자 삭제·유지보수 실행 같은 확인 대화상자가 대상과 결과를 읽는다 | | |

### 4.16 명령 팔레트 (⌘K)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 입력하는 동안 | 결과 수와 선택된 항목을 읽는다 | | |
| 실행 뒤 | 닫히고 이동한 화면의 제목을 읽는다 | | |

### 4.17 단축키 표 (`?`)

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 공통 1~7 | 위와 같다 | | |
| 단축키 목록 | 키와 동작을 짝지어 읽는다 | | |
| `한 글자 단축키 사용` 스위치 | 켜짐·꺼짐 상태를 읽는다 | | |

## 5. 그 밖의 수동 항목

| 확인 항목 | 기대 | 결과 | 확인한 날 |
|---|---|---|---|
| 200% 확대 | 가로 스크롤 없이 모든 화면을 쓸 수 있다 | | |
| 320 px 폭 | 메뉴 열기 버튼으로 사이드바를 열고 모든 기능에 닿는다 | | |
| 다크 모드 대비 | 계산값이 아니라 눈으로 보아 글자·경계·포커스 표시가 구별된다 | | |
| 동작 줄이기(`prefers-reduced-motion`) | 전환·스크롤 애니메이션이 줄거나 없어진다 | | |
| Safari 키보드 | 키보드만으로 §1의 여정을 한 번(Safari는 설정 › 고급 › "Tab 키로 웹 페이지의 각 항목 강조"를 켠다) | | |
| Firefox 키보드 | 키보드만으로 §1의 여정을 한 번 | | |

## 6. 확인 방법

1. macOS VoiceOver를 켠다: ⌘F5(또는 시스템 설정 › 손쉬운 사용 › VoiceOver). 끌 때도 ⌘F5.
2. 로터: VO(Control+Option)+U. 좌우 화살표로 랜드마크·제목·링크·양식 컨트롤 목록을 바꿔 본다.
3. 순서: 로컬 서버(AGENTS.md "개발과 테스트")를 `LECTERN_WEB_SHELL=1`로 띄우고 `bun run web:build` 뒤 Safari로 `/app`을 연다. §4.1부터 차례로, 화면마다 공통 항목을 먼저, 그다음 그 화면의 항목. 실제 녹음은 쓰지 않는다(합성 오디오나 테스트용 녹음).
4. 결과 칸에 `통과` 또는 `실패: <들은 것>`, 확인한 날에 날짜를 적는다.
5. 결함을 찾으면 `docs/v2/pipeline/STATUS.md`의 "넘겨받은 요청"에 화면·증상·재현 순서(누른 키)를 적는다.
