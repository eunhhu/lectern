# 상태표 (STATUS)

단계별로 **지금 사실인 것**만 적는다. 네 칸을 섞지 않는다.

- **만듦**: 코드가 통합 브랜치에 있다.
- **가짜로 테스트함**: 자동 테스트가 통과한다. 외부 서비스는 가짜가 답했다.
- **실측 필요**: 실제 공급자·기기·운영 호스트에서 확인해야 한다. 아직 안 했다.
- **사용자 필요**: 사용자가 준비·승인·결정해야 진행된다.

WP 단위의 진행은 `bun run pipeline status`가 원본이다. 이 표는 단계가 끝날 때 오케스트레이터가 고친다.

기준: 2026-11-15, 통합 브랜치 `p0-foundations`(`611678e`, P5-15를 합친 커밋). `bun run pipeline status`: **merged 84 / blocked 1 / todo 5**(작업 90개). `pipeline next`는 `STUCK`이다(남은 작업은 모두 막혔거나 사용자가 필요하다). 안 된 것: P2-09(`BLOCKED`, 기능 대조표 `없음` 8행 결정 대기), P2-10(그 뒤, 옛 화면 삭제 승인), P5-14(옛 관리자 콘솔 삭제 승인), P6-A12(Developer ID 필요), P6-W1(Windows 빌드 환경 필요), P7-03(P2-09 뒤에 선다). 지금 전체 테스트: `bun test` 1908개(파일 160개), `bun run web:e2e` 218개, 모두 통과(2026-11-15, 이 Mac). 표의 단계별 수는 그 단계를 합칠 때의 전체 수다. `main`은 `45a9d3b`(2026-10-20)이고 통합 브랜치의 조상이다(`611678e` 기준으로 통합 브랜치가 218커밋 앞).

| 단계 | 만듦 | 가짜로 테스트함 | 실측 필요 | 사용자 필요 |
|---|---|---|---|---|
| P0 기반 | 작업 큐·워커 분리, 마이그레이션 러너, Hono 진입점, JSON 로그, 설정 패키지, 디자인 토큰, 법적 페이지, CD 사전 점검 | 단위 테스트 794개 | 운영에는 `5b0ef75`까지만 배포됨(`main`은 그 뒤 `45a9d3b`까지 왔지만 그 커밋의 CI에서 배포 작업만 실패했다. 운영 호스트가 내려가 있다). 그 뒤 커밋(v2 테이블 이전 포함)은 운영 DB에서 돌려 본 적이 없다 | 운영 호스트 복구, `lectern-worker` 유닛 설치, Google OAuth 검증 신청 |
| P1 하네스 | 단계 실행기, 미디어 처리(정규화·말소리 지도·청크·여러 오디오 파트 잇기), 전사 → 병합 → 화자, 노트 단계(분류·구조화·추출·검증), Gemini 전사·LLM 어댑터, v2 처리 작업(`process`)과 다시 만들기(`regenerate`)·작업 취소·관리자 재시도, v1 다리(`lectures.markdown` = 구조화 문서), 평가 CLI(전사 지표, `--notes` 문서·추출 지표), 웹의 v2 처리 상태 | 단위 테스트 1082개(스크립트 공급자, 합성 세트, 노트 오라클), 웹 e2e 56개(가짜 Gemini로 v2 올리기 → 전사 → 문서 → 출처 이동), axe 0건 | Gemini 전사·노트 요청 형식(실제 호출로 확인한 적 없음), 1시간당 비용, 실제 녹음의 구조화·추출 품질 지표 | 평가 세트(동의받은 녹음 10건 이상과 주석), D11 비용 목표 확정, 운영에서 `LECTERN_PIPELINE=v2` 켜기 |
| P2 데이터·웹 | v2 테이블과 이전, API v2, 새 웹 앱(`/app`), 물어보기 v1, `/` → `/app` 리다이렉트(플래그 켬일 때). 파이프라인에서 더한 것: 오디오만 삭제, 문서 Markdown 내보내기, 서버 추천 질문, 공유 링크(만들기·바꾸기·회수)와 공개 페이지 `/s/:token`, 웹 회원가입·이메일 인증·비밀번호 재설정, 문서 편집(블록 글자, legacy Markdown, 저장 충돌), 공유 UI, 다시 처리·Markdown 내려받기, Pretendard 직접 호스팅, v1 화면 기능 대조표(`PARITY.md`)와 빠진 e2e | 단위 테스트(전체 1357개), 웹 e2e(전체 129개, fixture 107개), axe 0건, v1 계약 테스트 | 운영 DB 사본에서의 이전 리허설, 물어보기 평가(재현율·인용 정밀도) | **대조표 `없음` 8행(#4 #6 #7 #21 #22 #27 #30 #31)을 만들지 정하기(P2-09가 여기서 멈춤)**, `LECTERN_WEB_SHELL=1`·`LECTERN_ASK=1` 켜기, 옛 화면 삭제 승인(P2-10) |
| P3 PDF·검색 | PDF 업로드(`LECTERN_PDF`), 쪽 글자 추출(`packages/pdf`), `pdf_ingest` 단계와 `pdf_page` 저장, `align` 단계와 노트 문맥의 PDF 쪽, 스캔본 OCR(dry run 견적 → 사용자 승인 뒤에만 Gemini), PDF 쪽 색인·쪽 인용·하이브리드 `GET /search`, 물어보기 도구 루프 테스트, 웹 PDF 뷰어(pdf.js, 파일 패널, OCR 비용 확인), 전역 검색 화면 `/app/search`와 ⌘K의 PDF 적중·IME 가드, 검색 성능 측정 스크립트(`scripts/bench/`) | 가짜 Gemini(스크립트 응답)로 OCR·도구 루프·PDF 인용, 웹 e2e(PDF 뷰어 12개, 검색 10개), axe 0건. 검색 측정: Apple M3에서 합성 1000건(조각 21,660개) p95 53 ms | Pi에서 검색 p95 200 ms, 실제 Gemini OCR의 비용·품질, PDF 포함 평가 | PDF 포함 평가 녹음 5건, 운영에서 `LECTERN_PDF=1` 켜기 |
| P4 캘린더 | `LECTERN_CALENDAR` 플래그와 P4 테이블(`calendar_feed`, `calendar_event_link`, `reminder`, `oauth_state`), ICS 구독 주소(`/cal/<토큰>.ics`, 해시만 저장), Google 캘린더 OAuth(PKCE)·다시 연결·해제(토큰 폐기)와 `needs_reauth`, `calendar_sync` 작업(전용 "Lectern" 캘린더에 넣기·고치기·지우기, 401 한 번 재시도, 일시 오류 지연 재시도), 일정 자동 수락(설정 `calendar_auto_add`)과 재처리 멱등성, 이메일 리마인더(`reminder` 작업, 5분 주기, 한 번만 발송, 90일 뒤 정리)와 `mail.ts`, 물어보기 `list_items` 도구의 데이터, 웹 설정 "연동"·"알림"과 일정 화면의 연결 상태 | 단위 테스트(전체 1471개, 가짜 Google 서버·가짜 Resend), 웹 e2e(전체 138개, 캘린더 설정 7개와 캘린더 꺼짐 서버 e2e), axe 0건 | 실제 Google 동의 화면과 전용 캘린더 생성·동기화, 실제 Resend로 리마인더 메일 발송, Apple 캘린더·Outlook에서 ICS 구독 | Google OAuth 클라이언트와 검증, `calendar.app.created` 범위 승인, 운영에서 `LECTERN_CALENDAR=1` 켜기 |
| P5 계정 | 계정 계약(플래그 `LECTERN_GOOGLE_LOGIN`·`LECTERN_APPLE_LOGIN`·`LECTERN_TEAMS`, 계정 테이블), 로그인 기기의 이름·마지막 사용, 개인 액세스 토큰(이름·범위·만료), 네이티브 앱 토큰 쌍(refresh 회전, 재사용 감지), Google로 계속하기(OIDC 코드 + PKCE), Apple로 계속하기(ES256, form_post), 팀 워크스페이스(메일 초대, 역할, 팀 업로드), 사용량과 쿼터, 데이터 내보내기(zip, 7일 보관), 계정 삭제(7일 유예, 취소), 웹 계정 화면·멤버·초대·사용량, 관리자 콘솔 React 이식 1·2부와 옛 콘솔 기능 대조표(`PARITY-ADMIN.md`), 쿠키로 인증한 변경 요청의 출처 검사(`apps/server/src/csrf.ts`, `ea052f4`). **안 된 것**: P5-14 옛 관리자 콘솔 삭제(승인 대기) | 권한 정책 표 테스트(`apps/server/test/api-v2-access.test.ts`), 보안 테스트 묶음 55개(`apps/server/test/security`, 보고서 `SECURITY-REVIEW.md`: 세션, CSRF, 횟수 제한, 업로드, 리다이렉트, 토큰 저장, 남의 리소스, 헤더), 가짜 Google·Apple 서버와 가짜 Resend로 로그인·초대, 웹 e2e(계정 화면, 멤버, 관리자 콘솔), axe 0건 | Google·Apple 로그인 실제 흐름, 보안 리뷰, 운영 프록시 단 수와 출처 헤더, 배포된 `/app`의 CSP | Apple Developer 계정(Sign in with Apple), 보안 리뷰어, 쿼터 기본값, 옛 관리자 콘솔 삭제 승인(P5-14), 운영에서 `LECTERN_GOOGLE_LOGIN`·`LECTERN_APPLE_LOGIN`·`LECTERN_TEAMS` 켜기 |
| P6 네이티브 | 기존 macOS·Android·Windows 클라이언트(v1 API). 파이프라인에서 더한 것: 서버의 APNs 계약과 발송기(처리 Live Activity, 완료 알림), 푸시 기기·Live Activity 토큰·녹음 마커 API, `apple-app-site-association`, v1 사용량 집계와 Sunset·차단 플래그, 옛 macOS 앱의 토큰을 Keychain으로, `apps/apple`(뼈대와 게이트, LecternKit API 클라이언트·인증·재개 가능한 업로드 큐, RecorderKit, LecternUI, iOS 앱 셸, iOS 녹음 표면과 백그라운드 업로드, 공유 확장, macOS 앱, Mac 회의 녹음(마이크 + 시스템 오디오 2채널, 회의 감지), 시스템 표면(푸시, Live Activity, 알림, 유니버설 링크, Spotlight·Siri, 위젯, 캘린더)), CI의 Apple 작업, Android v2 파트 업로드. **안 된 것**: P6-A12 Sparkle과 공증, P6-W1 Windows v2 업로드 | Android 단위 테스트, SwiftPM 패키지 테스트와 서명 없는 iOS·macOS 빌드(Apple 게이트), 서버 단위 테스트(가짜 APNs h2 서버). CI의 Apple 작업이 처음으로 통과(2026-11-15) | 실제 기기 전부(3시간 백그라운드 녹음, Dynamic Island, APNs, 시스템 오디오 권한), Windows 빌드, `apps/apple/MANUAL_CHECKS.md` 1–57, Android 끊긴 업로드 이어 올리기 | Apple Developer ID(D7), APNs 키, TestFlight, v1 차단 시점 결정, 유료 Apple Developer 팀(기기 점검 전부에 필요), `LECTERN_ASSOCIATED_DOMAIN`·`APPLE_APP_IDS`, 운영에서 `LECTERN_APNS` 켜기 |
| P7 하드닝 | 런북 8종과 인계 점검표(`docs/runbooks/handover-checklist.md`), 부하 시험 스크립트(`scripts/load`), 복원 리허설 스크립트(`scripts/rehearse`)와 공급자 장애 테스트, 키보드 전용 여정 e2e와 접근성 점검표(`A11Y-AUDIT.md`), 인계 문서 맞추기(AGENTS.md 지도·명령, README, 설계 문서 목차, 로드맵 상태 줄). **안 된 것**: P7-03 성능 예산(`todo`, 의존하는 P2-09가 `BLOCKED`) | 부하 시험 세 가지를 Mac에서(3시간 녹음 포함), 리허설 테스트 17개와 장애 테스트 10개(장애 테스트는 ffmpeg가 있는 곳에서만, CI는 건너뛴다), 키보드 여정 2개와 소스 검사 3개, 인계 점검표 §3을 로컬에서(§6 기록) | Pi 부하 시험, 백업 복원 리허설, VoiceOver 수동 점검, 시간 예산의 CI 보정(P7-03 뒤) | 인계 점검을 해 볼 사람, P2-09 결정(P7-03이 그 뒤에 선다) |

## 알려진 결함 (파이프라인이 고친다)

| 결함 | 고치는 WP |
|---|---|
| (없음. `LECTERN_WEB_SHELL=1`일 때 배포 사전 점검이 실패하던 것은 P0-01이 고쳤다) | — |
| 전사가 모두 실패하면 사용자에게 보이는 메시지에 공급자 원문 응답이 붙고 `failure_code`가 `legacy_error`다(P7-02 장애 테스트에서 관찰) | 없음("넘겨받은 요청" P7-02 행) |

## 로드맵에서 뺀 것

| 항목 | 이유 |
|---|---|
| Claude·전용 STT 어댑터와 D1·D3·D13 비교 실험 | Gemini만 쓴다(2026-10-19 사용자 결정) |
| N5 온디바이스(실시간 자막, 기기 OCR, 기기 제안) | 평가 게이트와 실제 기기 확인이 먼저다(CONTRACTS D-P6-10) |
| IETF Resumable Uploads 호환 | 지금의 파트 업로드를 네이티브 큐가 재개한다(D-P6-6) |
| 브라우저 응답에서 세션 토큰 빼기 | 네이티브 클라이언트가 같은 응답을 쓴다(D-P2-5) |

## 명세를 쓰며 드러난 열린 항목

명세(`wp/*.md`)의 10절이 "STATUS에 적는다"고 한 것을 모았다. 구현이 끝나도 남는 일이다. 오케스트레이터는 해당 WP가 합쳐질 때 이 표를 고친다(확인됐으면 날짜와 누가, 아니면 그대로).

### 실측 필요 (실제 공급자·기기·운영 호스트·CI)

| 항목 | WP |
|---|---|
| Raspberry Pi에서 검색 p95 200 ms. `bun scripts/bench/search.ts --recordings 1000 --max-p95-ms 200`으로 잰다. 참고: Apple M3에서 p95 53 ms(2026-11-14) | P3-10 |
| 실제 Google 동의 화면과 전용 캘린더 생성·동기화 | P4-02, P4-03 |
| Bun의 `node:http2` 클라이언트가 Apple의 실제 APNs 서버(TLS, ALPN h2)와 붙는지. 테스트의 가짜는 평문 h2다 | P6-02 |
| 옛 macOS 앱으로 로그인한 Mac에서 새 빌드로 토큰이 키체인으로 옮겨지는지 | P6-A0 |
| ~~`swift-openapi-generator`가 이 저장소의 `openapi.json`을 처리하는지~~ 확인됨(2026-11-15, P6-A2): 1.14.4가 처리한다. 다만 nullable 참조·인라인 판별 유니온·문자열 enum을 그대로 두면 필드가 빠지거나 디코딩이 실패해서 `apps/apple/scripts/openapi-for-swift.py`가 입력을 고친다 | P6-A2 |
| 샌드박스 앱에서 시스템 오디오 탭이 되는지, 추가 entitlement가 필요한지 | P6-A10 |
| 실제 iPhone에서 푸시 등록, Live Activity(원격 갱신·push-to-start), 알림, 유니버설 링크, 위젯 | P6-A7, P6-A11 |
| 서명한 빌드에서 App Group(`group.com.qucord.lectern`)과 Keychain 접근 그룹이 프로비저닝되고 앱·위젯·공유 확장이 같이 쓰는지. P6-A1부터 entitlements가 비어 있어서(XcodeGen이 매번 지웠다, 2026-11-15에 고침) 서명한 빌드로 확인된 적이 없다 | P6-A1, P6-A2, P6-A3 |
| 녹음 엔진의 기기 점검(통화 중 일시정지, AirPods 빼기, 화면 끈 3시간, 무음 경고, 장치 바뀜, 녹음 중 강제 종료): `apps/apple/MANUAL_CHECKS.md` 4–9 | P6-A4 |
| 화면 부품의 기기 점검(가장 큰 글자, VoiceOver로 문서 끝까지, 전사 직접 스크롤 뒤 5초 — Mac 휠·트랙패드가 스크롤 단계를 보고하는지 포함): `apps/apple/MANUAL_CHECKS.md` 10–12 | P6-A5 |
| iOS 앱 셸의 기기 점검(만료된 토큰으로 긴 재생, VoiceOver로 목록·상세, iPad 나란히 보기, 픽스처 UI 테스트 실행): `apps/apple/MANUAL_CHECKS.md` 13–16. UI 테스트는 이 Mac의 CoreSimulator가 Xcode보다 오래돼 빌드만 했다. iPhone이 녹음 목록부터 보이는지(`preferredCompactColumn`)도 여기서 본다 | P6-A6 |
| 녹음 표면의 기기 점검(제어 센터·동작 버튼·Siri로 시작, 잠금 화면 3시간 녹음과 잠긴 채 업로드, Dynamic Island, 통화 중 일시정지가 Live Activity에 보이는지, Live Activity를 꺼도 녹음, 녹음 뒤 재생 음질): `apps/apple/MANUAL_CHECKS.md` 17–25(25: 앱에서 정지하고 바로 잠가도 업로드가 끝나는지). 컨트롤의 인텐트(`RecordingToggleIntent`)가 위젯 확장이 아니라 앱 프로세스에서 도는지는 17에서 본다(명세의 전제). 빌드 산출물의 `Metadata.appintents`에 인텐트 다섯 개와 단축어 문구 세 개가 들어간 것까지는 확인했다 | P6-A7 |
| 공유 확장의 기기 점검(음성 메모에서 공유 → 앱에서 업로드, 오디오와 PDF 짝짓기, 1GB 공유, 메타데이터 없는 옛 파일의 녹음 시각, 오디오·PDF에만 보이는지): `apps/apple/MANUAL_CHECKS.md` 26–30. 활성화 규칙(술어 문자열)은 macOS `NSPredicate`로 읽히고 빌드된 확장의 Info.plist에 한 줄로 들어간 것까지 확인했다 | P6-A8 |
| macOS 앱의 기기 점검(서명한 빌드): 옛 앱 다음 마이크 권한·로그인 이어짐(Keychain 창이 뜰 수 있고, 못 읽으면 한 번 다시 로그인), 메뉴바 녹음 → 업로드 → `문서가 준비되었습니다` 알림 → 클릭으로 열기, 다른 앱이 앞에 있을 때 ⌥Space, 로그인 시 실행, 창을 닫아도 녹음이 이어지고 녹음 중 종료하면 저장, data protection keychain에 로그인이 남는지, 메인 창 키보드, `Lectern 열기`가 창을 하나만 여는지, HUD의 `설정…`: `apps/apple/MANUAL_CHECKS.md` 31–40 | P6-A9 |
| Mac 회의 녹음의 기기 점검(서명한 빌드): 시스템 오디오 권한 문구, 음악 + 목소리가 오른쪽·왼쪽에, 소리 없을 때 마이크가 끊기지 않음, 권한 거부 때 마이크만 녹음과 경고(거부가 'nope' 오류로 온다고 가정했다. 무음으로만 나타나면 경고가 뜨지 않는다), 30분 동안 두 채널의 어긋남, Zoom 실행 알림과 `녹음 시작`(Teams·Webex·FaceTime 번들 id 확인), 올린 회의 파일의 전사, 녹음 중 출력 장치 변경: `apps/apple/MANUAL_CHECKS.md` 41–48 | P6-A10 |
| iPhone 시스템 표면의 기기 점검(유료 팀으로 서명, 서버에 `APNS_*`): 알림 허용 뒤 `push_device` 행과 재설치 뒤 기기 id, 앱을 닫은 채 처리 Live Activity의 단계 변화(활동이 두 개 뜨지 않음), Mac 업로드의 push-to-start, 문서 준비 알림을 눌러 열기, Spotlight·Siri("Lectern에서 … 열기"), 위젯과 로그아웃 뒤 비움, 메모 앱의 `/app/recordings/<id>` 유니버설 링크와 `/s/` 링크가 앱으로 되돌아오지 않는지, Mac↔iPhone Handoff(Mac에서 창이 하나만), `캘린더에 추가`가 한 번만: `apps/apple/MANUAL_CHECKS.md` 49–57 | P6-A11 |
| ~~CI의 `apple` 작업 첫 실행~~ 확인됨(2026-11-15, CI 실행 43675075222, `d5e3319`): 통과(12분 20초). 이미지 `macos-26-arm64`(20261102), Xcode 26.6, Swift 6.3.3(명세가 예상한 6.2가 아니다). 로컬 게이트는 Xcode 27.2로 돌았다. 실패해도 서버 배포는 막지 않는다 | P6-CI |
| Android v2 업로드의 기기 점검: 느린 연결에서 긴 녹음(예: 3시간)을 올리다 비행기 모드로 끊고 다시 켜면 대기 목록의 `업로드 중 (n/m)`이 처음부터가 아니라 이어서 오른다. WorkManager는 포그라운드가 아닌 작업을 약 10분 뒤 멈추므로 여러 번의 작업 실행에 걸쳐 이어진다. 설정 → `새 업로드 방식`을 끄면 v1로 올라간다 | P6-D1 |
| 공증된 빌드에서 Sparkle 업데이트와 시스템 오디오 권한 유지 | P6-A12 |
| ~~CI 러너 라벨 `macos-26`과 그 Xcode 버전, Apple CI 작업의 첫 실행~~ 확인됨(2026-11-15, 위 행과 같은 실행): 라벨이 잡히고 Xcode 26.6으로 통과 | P6-CI |
| Android 실제 기기에서 3시간 녹음을 올리다 끊고 이어 올리기 | P6-D1 |
| Windows 앱의 컴파일(이 명세의 C# 코드는 컴파일해 보지 못했다)과 실제 녹음 → 업로드 | P6-W1 |
| Pi에서 부하 시험 세 가지의 수치: `docs/runbooks/load-test.md`대로 `uploads.ts --n 3 --minutes 30`, `long-recording.ts --hours 3`, tmpfs 200 MB의 `disk-full.ts`. 날짜·호스트 종류(예: Pi 5 8 GB)·최대 메모리·업로드 p95·처리 시간·실패만 적는다. `server.max_rss_bytes`는 하한값이다(bun 프로세스만 재고 ffmpeg 자식은 빠지며, 합성 오디오는 대부분 무음이라 압축한 청크가 실제 말소리보다 작다). Mac에서는 셋 다 통과했다(3시간: 345,600,078바이트, 파트 42개, ready 14초, RSS 약 314 MB) | P7-01 |
| 운영 백업 파일로 하는 복원 리허설: 운영 호스트의 최신 백업으로 `docs/runbooks/backup-restore.md` §7대로 `scripts/rehearse/restore.ts --backup … --work <데이터 디렉터리 밖의 빈 디렉터리> --uploads …` 1회(따로 받은 checkout에서). `ok`, `shrunk_tables`(운영 데이터의 마이그레이션에서 줄어드는 테이블이 있는지), `audio.missing`, `server.migration_ms`를 본다. 결과는 운영자 기록에(이 파일이 아니다). 로컬에서는 샌드박스 DB 사본으로만 통과했다 | P7-02 |
| 시간 예산(전사 스크롤 프레임, 검색 p95)을 CI의 첫 측정값으로 보정 | P7-03 |
| VoiceOver 수동 점검표: `docs/v2/pipeline/A11Y-AUDIT.md` §4(화면 17곳, 공통 7 + 화면별 항목)와 §5(200% 확대, 320 px, 다크 모드 대비를 눈으로, 동작 줄이기, Safari·Firefox에서 키보드 여정 한 번)의 결과 칸을 사람이 채운다(§6이 순서). Apple 앱은 각 앱의 `MANUAL_CHECKS.md` | P7-04, P6-A* |
| 인계 점검표 §4(운영에서 해 보기: 상태 확인, 로그, 수동 백업, 복원 리허설, 배포, 롤백, 시크릿 교체, 워커 유닛, 기능 플래그 켜고 끄기, 부하 시험)를 운영 호스트에서 한 번. 확인 칸이 비어 있다 | P7-05 |
| CI는 `main`으로 가는 PR이 있어야 통합 브랜치에서 돈다. 2026-11-13에 초안 PR [eunhhu/lectern#1](https://github.com/eunhhu/lectern/pull/1)을 열었다. `windows` 게이트, Apple CI 작업, 시간 예산 보정은 이 PR의 체크로 확인한다(해당 WP가 합쳐진 뒤). Apple CI 작업은 확인됨(2026-11-15, 위의 P6-CI 행). `windows` 게이트(P6-W1)와 시간 예산 보정(P7-03)은 그 WP가 합쳐지지 않아 아직이다 | P6-W1, P6-CI, P7-03 |
| 운영의 프록시 단 수(`LECTERN_TRUSTED_PROXY_HOPS`, 기본 1)와 cloudflared가 붙이는 `X-Forwarded-For`, 배포된 `/app`의 CSP(보안 테스트는 프록시 1단을 가정했고 `/app` 셸은 테스트 프로세스에서 꺼져 있다). 출처 검사(`ea052f4`)가 보는 `Origin`·`Sec-Fetch-Site`를 cloudflared가 그대로 넘기는지와 운영의 `LECTERN_BASE_URL`이 브라우저가 보는 출처와 같은지(다르면 `Sec-Fetch-Site`를 보내지 않는 옛 브라우저의 쓰기가 403이 된다) | P5-15 |

### 사용자 필요 (결정·승인·준비)

| 항목 | WP |
|---|---|
| 초안 PR [eunhhu/lectern#1](https://github.com/eunhhu/lectern/pull/1)을 **합칠지와 언제 합칠지**. 합치면 `main`에 push되고 운영에 배포된다. 오케스트레이터와 워커는 이 PR을 합치지 않고, 초안 상태도 풀지 않는다. 2026-11-15에 보니 이 PR은 초안이 아니다(오케스트레이터가 바꾼 것이 아니다). 그날 머리 `32722fd`의 CI는 모두 통과했다 | 전체 |
| 사람이 하는 보안 리뷰(테스트 통과가 안전하다는 뜻은 아니다). 인증 경로를 바꾼 두 커밋(출처 검사 `ea052f4`, API 토큰 접두어 `ffe3466`)과 `SECURITY-REVIEW.md`의 "사람이 봐야 하는 것"(출처 검사의 가정, 푸시 기기의 APNs 토큰 이전, 앞단 프록시 로그의 `?token=`)을 함께 본다 | P5-15 |
| Apple의 서버 간 알림(계정 삭제·이메일 변경 통지)과 토큰 폐기를 받지 않는다. 필요한지 정한다 | P5-05 |
| App Store에 올리려면 앱 안에서 계정 삭제를 시작할 수 있어야 할 수 있다(지침 5.1.1(v)). 지금은 "웹에서 열기"다 | P6-A6 |
| 마이크·시스템 오디오 2채널을 서버가 화자 구분에 쓰게 할지(평가가 필요하다) | P6-A10 |
| 녹음 파일 형식. 지금은 AAC .m4a라서 녹음 중 앱이 죽으면 그 파일을 읽을 수 없다(끝낼 때 색인을 쓴다). CAF로 쓰고 끝낼 때 바꾸는 식으로 바꿀지 MANUAL_CHECKS 9를 확인한 뒤 정한다. 같이 정할 것: 사용자 일시정지 중에도 입력이 돌아 iOS 마이크 표시가 켜져 있다(백그라운드에서 엔진을 멈추면 다시 시작하지 못할 수 있어서) | P6-A4 |
| 옛 관리자 콘솔을 지우면 롤백 수단이 "웹 셸 끄기"에서 "이전 릴리스로 되돌리기"로 바뀐다. 승인할 때 알고 있어야 한다 | P5-14 |
| `LECTERN_V1_BLOCK`을 켜는 시점. **Android와 Windows 앱은 목록·상세를 아직 `/api/lectures`로 읽는다.** 차단을 켜면 그 화면이 깨진다(아래 "후속 작업"의 첫 줄이 먼저다) | P6-03 |
| 처음 온 사람이 인계 점검표를 실제로 따라 해 보는 것 | P7-05 |
| 올린 뒤 기기의 녹음·공유 파일을 자동으로 지울지. 지금 대기열은 완료된 항목의 파일을 사용자가 그 항목을 지울 때까지 둔다(공유한 파일은 원본이 따로 있어 복사본이 하나 더 남는다) | P6-A8 |
| 샌드박스 Mac 앱에서 Core Audio 프로세스 탭(시스템 오디오)이 동작하지 않으면 샌드박스 정책을 어떻게 할지(MANUAL_CHECKS 41에서 드러난다) | P6-A10 |
| iOS 앱 entitlements에 Push Notifications와 Associated Domains가 들어가 무료 개인 팀으로는 자동 서명이 되지 않는다. iPhone에서 하는 모든 수동 점검(MANUAL_CHECKS 1–57)에 유료 Apple Developer 팀이 필요하다 | P6-A11 |
| 유니버설 링크: `apps/apple/Local.xcconfig`의 `LECTERN_ASSOCIATED_DOMAIN`(서버 호스트)과 배포 서버의 `APPLE_APP_IDS`(TEAMID.com.qucord.lectern.ios, …macos)를 넣는다. 빈 값으로 서명하면 entitlement가 `applinks:`만 남는다. 배포 서명에서는 `aps-environment`를 production으로 | P6-A11 |

### 후속 작업 (이 파이프라인에 WP가 없다)

| 항목 | 나온 곳 |
|---|---|
| Android·Windows의 읽기 경로(`/api/lectures`)를 v2로 옮기기. v1 차단의 전제 조건이다 | P6-D1, P6-W1 |
| 만료·취소된 업로드 세션과 같은 `Idempotency-Key`로 `createUpload`를 부르면 서버가 죽은 세션을 돌려준다. 클라이언트는 키에 세대 번호를 붙여 피한다(CONTRACTS S-21). 서버에서 고치는 편이 낫다 | P6-D1 |
| OAuth로만 가입한(비밀번호 없는) 계정의 네이티브 앱 로그인 | P5-03 |
| "어떤 로그인 수단이 켜져 있는지" 알려 주는 라우트. 지금은 웹이 start 주소를 찔러 본다 | P5-10 |
| 계정 삭제 확인 메일(방침과 문구가 필요하다) | P5-09 |
| iOS 앱에 문서 편집·물어보기·검색·캘린더·PDF 보기가 없다(PDF 출처는 눌러도 아무 일도 없다). 웹을 따라잡는 화면은 이 파이프라인의 WP가 아니다 | P6-A6 |
| 업로드 대기열 항목이 계정에 묶여 있지 않다. 로그아웃 뒤 다른 계정으로 로그인하면 이전 계정의 녹음을 그 계정으로 올린다 | P6-A6 |
| 대기열에 넣지 못한 녹음 파일과 쓰다 실패한 녹음 파일은 App Group의 `Recordings/`에 남지만 다시 넣거나 지우는 화면이 없다 | P6-A7 |
| 공유 확장의 여유 공간 확인은 명세대로 '가져올 크기 + 200MB'다. 같은 볼륨 복사는 복제라 실제로는 공간을 거의 쓰지 않아, 들어갈 공유를 거절할 수 있다 | P6-A8 |
| 새 녹음은 언제나 백그라운드 세션으로 올린다. 다만 앱이 포그라운드에서 다시 올리던 예전 항목(`run()`이 잡고 있던 것)은 백그라운드로 갈 때 넘기지 않는다. 멈추면 그 파트가 실패해 `네트워크를 기다리는 중`이 되고 다음 활성화 때 이어진다. 백그라운드 세션은 이 Mac에서 돌려 보지 못했다(빌드만) | P6-A7 |
| 내보내기 zip의 ZIP64(4 GiB를 넘는 워크스페이스) | P5-08 |
| v1 사용량 관리자 화면: P5-13이 P6-C보다 먼저 돌면 빠진다. P6-03 뒤에 더해야 한다 | P5-13 |
| 관리자 콘솔 2부를 P5-16(멤버·녹음·대조표)과 P5-13(저장소·운영·설정·감사 로그)으로 나눴다(옛 콘솔 기능 85행, CONTRACTS S-33). `LECTERN_V1_BLOCK`을 켜면 새 콘솔의 녹음 동작(재시도·삭제·오디오 삭제, `/api/lectures*`)도 막힌다 | P5-16, P6-03 |
| macOS 앱의 APNs 토픽(`APNS_TOPIC_MACOS`)과 macOS 푸시 | P6-C |
| iOS 앱의 문서 편집, 물어보기, 검색, 캘린더 화면 | P6-A6 |
| `BGContinuedProcessingTask`, IETF 재개 업로드 | P6-A3 |
| 디스크가 부족할 때 업로드를 거절하는 서버 규칙(`disk-full.ts`의 관찰 결과를 보고 정한다) | P7-01 |
| 관리자 강의의 아카이브 `.md` 파일을 v2 처리 결과로도 쓰기 | P1-11 |
| 다시 만들기(`regenerate`)가 PDF 문맥 없이 노트를 만든다. PDF 쪽 출처(`pdf_pages` 라벨)가 모두 지워진다 | P3-04 |
| 이미 처리된 녹음에 나중에 붙인 PDF는 `pdf_ingest`를 타지 않는다(쪽 추출은 `process` 작업 안에서만 돈다) | P3-03 |
| 작업 단계 이름(`StageName`)에 `pdf_ocr`이 없다. OCR 작업의 진행이 단계 이름 없이 보인다 | P3-05 |
| 같은 녹음의 다른 PDF OCR이 큐에 있으면 409다(큐가 녹음 단위로 중복을 막는다). PDF 단위로 풀지 정한다 | P3-05 |
| 웹 fixture 물어보기에 `pdf_page` 인용 경로가 없어 "인용을 누르면 그 쪽이 열린다" e2e가 없다. PDF 콘텐츠의 Range 요청 경로도 e2e로 보지 않았다 | P3-08 |
| `calendar_event_link`의 기본 키가 `event_candidate_id`라 일정 하나가 연동 하나에만 링크된다. 팀 워크스페이스에서 두 사람이 각자 Google을 연결하면 공유 일정을 번갈아 찾아 입양(PATCH)한다(중복은 없고 호출만 는다). 표 정의를 `(event_candidate_id, integration_id)`로 바꾸는 계약 변경이 필요하다 | P4-03 |
| 계정을 지울 때 Google 토큰을 폐기하지 않는다(`integration` 행만 지운다) | P4-03, P5 계정 삭제 |
| `packages/db`의 `WORKSPACE_TABLES`(`deleteWorkspaceRows`)에 P4 표가 없다. 계정 삭제는 `deleteUserAndData`가 사용자 기준으로 지우지만, 팀 워크스페이스를 지울 때는 남는다 | P4-05 |
| domain 설명 문구 두 곳: `UpdateWorkspaceRequest.settings`는 "Replaces"라고 하지만 서버는 얕게 합친다. `StartGoogleIntegrationRequest.return_to` 예시는 `/settings/integrations`지만 실제 경로는 `/app/settings#integrations`다 | P4-02, P4-04 |
| 물어보기 runner는 검색이 질문을 노트에 근거 짓지 못하면 모델을 부르지 않는다. 그래서 "이번 주 마감이 뭐야?"처럼 노트 본문과 겹치지 않는 질문은 `list_items`에 닿지 못한다. 근거가 없어도 도구 라운드를 한 번 열지 정한다 | P4-06 |
| 서버 타입 `OpsJob.kind`·`stage`와 `AdminLectureDto.job_kind`는 `"distill" \| "compact"`인데 v2 `"index"` 작업이 온다. 웹은 아무 문자열이나 받는다 | P5-13, P5-16 |
| v1 로그인 응답 본문의 세션 토큰(`token`) 제거 검토: `HttpOnly` 쿠키와 같은 값을 스크립트가 읽을 수 있다(v1 계약) | P5-15 |

### 명세 자체의 한계

- 명세 89개 가운데 31개는 에이전트가 썼고, 그 10절(작성자 메모)을 사람이 다시 읽지 않았다. 워커가 `BLOCKED`로 멈추면 먼저 그 명세의 10절을 본다.
- 명세가 가리키는 심볼 가운데 "앞선 WP가 만든다"고 적힌 것은 아직 없는 코드다. 앞선 WP가 다른 이름으로 만들면 뒤의 명세가 사전 점검(3절)에서 멈춘다. 그것이 의도한 동작이다.
- 명세를 쓰며 계약에 더한 결정은 [CONTRACTS §8 보충](CONTRACTS.md#8-보충--명세를-쓰며-정한-것)에 있다.

## 넘겨받은 요청

워커 보고의 `NEEDS`·`DEVIATIONS`를 오케스트레이터가 여기에 옮겨 적는다.

| 날짜 | WP | 내용 | 처리 |
|---|---|---|---|
| 2026-11-15 | P6-C | 로컬 브랜치 `wp/P5-15`의 `apps/server/test/security/routes.ts` `PATH_PARAMS`에 `marker_id`가 없다. 그 브랜치를 올리거나 합칠 때 더한다(없으면 새 라우트에서 "no sample for path param"으로 멈춘다) | 고침(P5-15를 옮길 때 표시·푸시 기기·Live Activity 샘플과 함께 더함) |
| 2026-11-15 | P6-C | 계정 삭제가 P6 테이블을 미리 목록에 넣어 두었는데 `push_device`에는 `workspace_id`가 없어, 테이블이 생기자 삭제가 실패했다. 워크스페이스 표에서 빼고, `live_activity`는 그 사용자의 기기로 지우게 고쳤다 | P6-C에서 고침 |
| 2026-11-15 | P6-C | `LECTERN_V1_SUNSET`의 틀린 날짜는 시작을 막지 않고 `null`(헤더·차단 없음)이다. 명세 5단계 괄호와 6절 테스트가 달라 테스트를 따랐다 | 기록만 |
| 2026-11-15 | P6-C | 녹음 삭제(휴지통 비우기 포함)와 팀 워크스페이스 삭제 때 `recording_marker`·`live_activity` 정리 | P6-01에서 함(v2 녹음 삭제, 강의 삭제, 계정·관리자 사용자 삭제. 팀 워크스페이스 삭제 라우트는 없다) |
| 2026-11-15 | P6-01 | 앱 하나에서 로그아웃하거나 비밀번호를 바꾸면(전체 로그아웃 포함) 그 사용자의 **모든** 푸시 기기가 지워진다(명세 5절 6단계). 앱은 실행·로그인 때마다 `PUT /me/push-devices/{id}`를 해야 한다 | P6-A7에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-01 | 방침 1.2 "앱 알림 정보"에 마커 시각이 들어 있고 3장 보관 기간은 "로그아웃하거나 기기를 지울 때까지"다. 실제로 마커는 녹음이나 마커를 지울 때까지 남는다. 문구를 고칠지 | 사용자 결정 |
| 2026-11-15 | P6-01 | 전체 게이트에서 `export.test.ts`가 흔들렸다(두 강의가 같은 밀리초면 내보내기의 녹음 번호가 무작위 id로 바뀜). 테스트에서 두 강의 사이를 띄웠다 | P6-01에서 고침 |
| 2026-11-15 | P6-A1 | 이 Mac의 `xcodebuild`가 "CoreSimulator is out of date … Simulator device support disabled"를 낸다. 시뮬레이터 대상 빌드는 되지만 시뮬레이터 실행·UI 테스트에는 Xcode 추가 구성 요소 설치가 필요하다(`sudo xcodebuild -runFirstLaunch` 또는 Xcode를 한 번 열기) | 사용자(로컬 환경) |
| 2026-11-15 | P6-A0 | Keychain 쓰기가 실패하면 옛 값은 `UserDefaults`에 남지만 그 실행에서는 로그인이 풀린 것처럼 보인다(`authToken`이 빈 값). 그 상태에서 로그아웃하면 평문 사본이 남고 다음 실행에서 다시 옮겨진다. 명세대로이며 실측 때 이 경우도 본다 | 실측 항목(P6-A0 행)에 포함 |
| 2026-11-15 | P6-02 | 처리 단계 Live Activity와 완료 알림 발송기가 들어갔다. 실제 APNs 서버(TLS + ALPN h2) 연결과 sandbox 발송은 Pi에서 키·팀·토픽을 넣고 한 번 확인한다(실측 표의 P6-02 행) | 실측 항목 |
| 2026-11-15 | P6-02 | push-to-start의 `attributes-type`은 `ProcessingActivityAttributes`, ContentState는 `stage`, `stage_label`, `progress`(0–100 또는 null), `recording_id`, `document_ready`다. 픽스처: `apps/server/test/fixtures/apns/*.json` | P6-A11에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-02 | process 작업이 여러 번 끊겨 실패로 끝나거나(onLost) 대기 중 취소되면(onCanceled)도 Live Activity를 끝낸다(명세 파일 목록에 없던 `job-handlers.ts`). PDF 단계의 예기치 못한 오류로 끝나는 경로는 기존처럼 녹음 상태를 바꾸지 않아 Live Activity도 그대로다 | 기록만 |
| 2026-11-15 | P6-03 | `LECTERN_V1_SUNSET`·`LECTERN_V1_BLOCK`은 켜지 않았다. 관리자 화면(P5-13)의 v1 사용량에서 폐기 대상 경로(`/api/lectures`, `/api/ingest/`, `/api/events`, `/api/clients/`)의 건수를 보고 정한다. `/api/auth/*`의 browser 건수는 새 웹 앱이 쓰므로 0이 되지 않는다 | 사용자 결정 |
| 2026-11-15 | P6-03 | 배포 환경에 `APPLE_APP_IDS=<TEAM_ID>.com.qucord.lectern.ios,<TEAM_ID>.com.qucord.lectern.macos`를 넣어야 AASA가 열린다. Apple CDN이 받아 가는지는 실제 도메인에서 확인한다 | 사용자(배포) |
| 2026-11-15 | P6-A2 | 파트 업로드(스트림 본문)는 AuthMiddleware가 401에서 다시 보내지 않는다. 업로드 쪽이 refresh 뒤 그 파트를 다시 올린다 | P6-A3에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A2 | Apple 게이트는 `python3`(입력 변환), 첫 실행의 GitHub 접근(패키지 의존), `xcodebuild -skipPackagePluginValidation`이 필요하다 | P6-CI에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A2 | 앱은 `KeychainTokenStore(accessGroup: "$(AppIdentifierPrefix)com.qucord.lectern")`을 넘긴다. 앱·위젯·공유 확장이 한 쌍을 같이 쓰므로 refresh 전에 저장소를 다시 읽는다(쓴 refresh 토큰을 다시 보내면 서버가 가족 전체를 끊는다) | P6-A6·A9에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A2 | 이벤트·할 일 목록을 래퍼에 여는 작업은 그 응답의 열린 유니온(`evidence` 등)을 `OpenUnionMiddleware`에 더한다 | 후속 WP |
| 2026-11-15 | P6-A3 | 앱이 `UploadQueue(store: .inContainer(<App Group>), transport: LecternUploadTransport(api:), containerURL:)`를 하나 만든다. 실행·포그라운드·네트워크 복귀 때 `run()`, 백그라운드에서는 `BackgroundUploader.send`, iOS 앱 델리게이트의 `handleEventsForBackgroundURLSession`에서 `handleEvents`. 백그라운드 파트 작업이 걸린 항목에 `run()`을 부르기 전에 `reconcile`로 확인한다(같은 파트를 두 번 보낸다. 결과는 맞지만 데이터를 두 번 쓴다). 공유 확장은 `enqueue`만 한다 | P6-A6·A7·A8에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A3 | IETF Resumable Uploads 호환과 `BGContinuedProcessingTask`(시스템 진행 UI)는 하지 않았다(D-P6-6, 명세 8절). 큐는 서버의 파트 방식으로 재개한다 | 기록만 |
| 2026-11-15 | P6-A3 | 같은 Idempotency-Key는 서버에서 죽은 세션(만료·취소)을 계속 돌려주므로 세션을 새로 시작할 때마다 키를 `<id>.<n>`으로 바꾼다. 완료 응답만 잃은 경우는 세션이 completed라 파트를 보내지 않고 같은 키로 완료를 다시 부른다(고치기 전에는 녹음이 둘 생겼다, `bf0a31b`) | 기록만 |
| 2026-11-15 | P6-A1 | XcodeGen은 `info`·`entitlements`의 파일을 generate 때마다 `properties`로 다시 쓴다. properties가 없어서 P6-A1의 Info.plist 키(마이크 문구, 백그라운드 오디오, Live Activity, 확장의 NSExtension)와 entitlements 네 개가 모두 지워진 채 커밋돼 있었다. `project.yml`의 properties로 옮겼다(`e3a7ef3`). 이 파일들은 `project.yml`에서 고친다 | P6-A6~A12에 전달 → P6-A6, P6-A7, P6-A8, P6-A9, P6-A10, P6-A11 합쳐짐, P6-A12 대기 |
| 2026-11-15 | P6-A4 | 녹음 전에 `AVAudioApplication.requestRecordPermission`, iOS는 `SessionCoordinator.activate()` 뒤 `Recorder.start()`, 끝나면 `deactivate()`. 녹음마다 `Recorder`를 새로 만든다. `RecordingResult.markers`는 LecternKit `Marker`로 옮겨 업로드 항목에 넣는다(`atMs`가 같다) | P6-A6·A8에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A4 | `EngineAudioInput.onInputLost`를 `recorder.handle(.routeLost)`로 잇는다(macOS는 오디오 세션이 없어 장치가 사라져도 다른 신호가 없다). 방해 뒤 사용자가 직접 재개할 때는 `resume()` 전에 `activate()`를 다시 부르고 `resume()` 뒤 `state`를 확인한다(입력을 다시 시작하지 못하면 일시정지로 남는다) | P6-A6·A8에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A5 | 녹음 상세는 `DocumentView(document:transcript:onSource:)`, `TranscriptList`, `PlayerBar`를 조립한다. 전사 출처는 `SourceResolver.range(...)?.startMs`로 `seek(toMs:)` 뒤 재생. `TranscriptRow`는 `.equatable()`이라 처음 받은 `onSeek`를 계속 쓰므로 바뀌지 않는 참조만 잡게 넘긴다 | P6-A6·A9에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A5 | Apple 앱의 시간 표기는 명세 테스트대로 `0:59`·`12:05`·`1:02:05`다(웹은 `00:59`). 블록 글은 Markdown으로 읽지 않는다(웹과 같다). 강조 상자 라벨은 domain 값의 시험·과제·중요·참고다 | 기록만 |
| 2026-11-15 | P6-A6 | 화면은 `LecternClient` 프로토콜로만 서버에 묻는다(`LiveClient`, `FixtureClient`). 뷰모델(`LoginViewModel`·`LibraryViewModel`·`RecordingViewModel`)과 `PlayerViewModel`은 LecternUI에 있다. macOS는 `LiveClient(platform: "macos")`로 같은 뷰모델을 쓴다 | P6-A9에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A6 | 오디오는 `LecternAPI.assetContentURL`이 자격을 `?token=`에 넣은 주소로 재생한다(AVPlayer는 헤더를 못 붙인다). 접근 토큰이 1시간이라 재생 중 항목이 실패하면 새 주소로 한 번 다시 불러 같은 위치에서 잇는다 | 기록만 |
| 2026-11-15 | P6-A6 | 백그라운드 업로드(`BackgroundUploader`, `handleEventsForBackgroundURLSession`)는 아직 없다. 앱이 활성일 때만 `run()`한다. 대기열은 프로세스마다 하나여야 하는데 지금은 `AppModel`이 만들고 서버 주소가 바뀌면 다시 만든다. 인텐트가 장면 없이 앱을 깨우면 `AppModel`이 없을 수 있다 | P6-A7에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A6 | 붙여 넣은 API 토큰은 만료가 없는데 이제 `?token=`으로도 간다. 서버 v2 로그는 pathname만 남긴다(쿼리 없음). 앞단 프록시의 접근 로그가 쿼리를 남기는지 확인한다 | `SECURITY-REVIEW.md` "사람이 봐야 하는 것"에 적음 |
| 2026-11-15 | P6-A7 | 프로세스에 하나인 `AppServices`(`App.init`에서 만든다)가 클라이언트, 업로드 대기열과 `BackgroundUploader`, 녹음 세션을 갖는다. 업로드는 활성일 때 `run(skipping: inFlightJobIDs())`, 활성이 아닐 때 `BackgroundUploader.start(jobID:)`(`UploadQueue.claimForBackground`)로, 한 항목은 한쪽만 올린다. 공유 확장은 `enqueue`만 하고 올리지 않는다 | P6-A8·A9에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A7 | 녹음 Live Activity(`RecordingActivityAttributes`, LecternIntents)는 정지 4초 뒤 끝난다. 처리 진행은 별도 활동으로 잇는다. 인텐트는 App Group `default_workspace_id`(로그인 때 앱이 개인 워크스페이스를 적는다)로 녹음한다 | P6-A11에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A7 | 설치된 SDK의 `ControlWidgetToggle`은 `SetValueIntent` 하나만 받아서 컨트롤은 시작·정지 인텐트 둘이 아니라 `RecordingToggleIntent`(SetValueIntent + AudioRecordingIntent) 하나다. App Shortcuts는 앱 타깃에 두고 문구는 "Lectern으로 녹음 시작"이다 | 기록만 |
| 2026-11-15 | P6-A8 | `UploadJob.audioPartRelativePaths`(1부·2부를 오디오 여러 개의 녹음 하나로, 서버는 올린 순서로 `part_index`)와 `allRelativePaths`가 생겼다. 다른 프로세스가 저장한 항목은 `UploadQueue.reloadFromStore()`로 들어오고 `run()`이 먼저 부른다. 로그인한 워크스페이스는 `AppEnvironment.defaultWorkspaceIDKey`(App Group `UserDefaults`)다 | P6-A9에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A8 | 웹 짝짓기 테스트는 18개다(명세의 `git grep -c`가 19로 센 것은 `name.split(".")` 줄이 걸린 것). 18개를 옮기고 NFD 하나를 더했다. 웹 규칙이 받는 weba·caf·amr은 서버가 받지 않아 대기열에서 서버의 문장으로 실패한다(웹과 같다) | 기록만 |
| 2026-11-15 | P6-A9 | macOS 앱은 프로세스에 하나인 `MacServices`가 클라이언트, 업로드 대기열(백그라운드 세션 없이 `run()`), 녹음 세션(`NoRecordingActivity`, 녹음 중 App Nap·유휴 잠자기 막음)과 `MacRecordingViewModel`, 전역 단축키, 알림(`ReadyNotifier`: 업로드가 끝난 녹음을 30초마다 확인)을 갖는다. 시스템 오디오(P6-A10)는 이 녹음 세션에, 푸시(P6-A11)는 `ReadyNotifier`를 대신하거나 함께 쓴다 | P6-A10·A11에 전달 → 받은 작업 합쳐짐 |
| 2026-11-15 | P6-A9 | `KeychainTokenStore`는 macOS에서 접근 그룹이 있으면 data protection keychain을 쓴다(명세에 없음. 접근 그룹은 그곳에만 있다. 나중에 바꾸면 사용자가 로그아웃된다). 옛 앱의 토큰은 처음 한 번만(`legacy_token_settled`) 가져온다. `MacRecordingViewModel`은 프로토콜 둘 대신 `RecordingSession`을 받는다. Space 재생은 메뉴 단축키가 아니라 창의 키 이벤트다 | 기록만 |
| 2026-11-15 | P6-A10 | 서버의 오디오 압축(`apps/server/src/storage.ts`)은 `-ac 1`로 모노로 내려 섞는다. Mac의 2채널 회의 파일(왼쪽 마이크, 오른쪽 시스템 오디오)은 두 목소리가 각각 절반 크기로 전사에 들어간다. 조용한 상대방 소리가 빠지거나 화자 구분에 두 채널을 쓰려면 서버 쪽 작업이다 | 서버에 전달 |
| 2026-11-15 | P6-A10 | 시스템 오디오 탭의 형식은 시작할 때 한 번 읽는다. 녹음 중 출력 장치가 바뀌면(AirPods) 형식이 바뀌는지 모른다(MANUAL_CHECKS 48). 회의 알림 본문은 시스템 오디오가 꺼져 있으면 `Lectern이 마이크로 회의를 녹음합니다.`다. `ChannelMixer`에 `bufferedMicFrames`·`bufferedSystemFrames`, `DualInput`은 `SystemAudioSource` 프로토콜로 탭을 받는다 | 기록만 |
| 2026-11-15 | P6-A11 | 서버의 문서 준비 알림(`apps/server/src/apns/payload.ts`)에 `category`가 없어 앱의 카테고리 `DOCUMENT_READY`·액션 `열기` 버튼이 보이지 않는다(누르면 열리는 것은 된다). 버튼이 필요하면 페이로드의 `aps`에 `"category": "DOCUMENT_READY"`를 더한다 | 서버에 전달 |
| 2026-11-15 | P6-A11 | 기기 id는 Keychain `device_id`(재설치 뒤 새 id인지는 MANUAL_CHECKS 49), `OpenRecordingIntent`는 `supportedModes = .foreground`(iOS 26에서 `openAppWhenRun` deprecated), 위젯의 로그아웃 상태는 App Group `default_workspace_id`, 녹음 일정은 느슨한 디코더로 읽고 웹에서 수락한 일정만 캘린더 버튼, small `최근 문서` 위젯은 한 개, 앱 활동과 push-to-start가 겹치면 나중 것을 끝냄, Handoff는 Mac도 알리고 받음(`RecordingHandoff`는 LecternKit) | 기록만 |
| 2026-11-15 | P6-D1 | 만료·취소된 세션의 `Idempotency-Key`로 `createUpload`를 부르면 서버가 그 죽은 세션을 돌려준다. Android는 키에 세대(`<id>-g1`)를 붙여 피한다. 서버가 새 세션을 만들어 주는 편이 낫다면 서버 쪽 작업이다. `/api/lectures`(목록·상세)는 여전히 v1이므로 `LECTERN_V1_BLOCK`을 켜기 전에 Android의 읽기 경로도 v2로 옮겨야 한다 | 서버에 전달 |
| 2026-11-15 | P6-D1 | Android 위 막대의 `로그아웃` 버튼을 `설정`으로 바꾸고, 설정 창에 `새 업로드 방식` 스위치와 `로그아웃`(기존 확인 창)을 두었다. 폴더 이름이 거절되면(400·422) 폴더 없이 올린다. 파트에서 409면 세션을 다시 읽어 다른 실행이 완료했으면 성공으로 본다. 서버의 v2 API는 플래그 없이 붙어 있고 APK와 서버가 같은 main push에서 나간다(새 APK + 옛 서버 = 404, 문구가 스위치를 끄라고 안내). Android 빌드는 JDK 17이 필요하다(이 Mac의 기본 JDK 25로는 Gradle 8.7이 돌지 않는다) | 기록만 |
| 2026-11-15 | P7-01 | 디스크가 차면 v2 `complete`가 500 `업로드한 파일을 합치지 못했습니다.`로 답한다(파트는 받았는데 합칠 자리가 없다, ENOSPC). 녹음을 잃지는 않았다(성공으로 답한 44건이 모두 목록에 있고 서버는 살아 있었다). 507이나 "저장 공간이 부족합니다" 같은 분명한 답, 또는 create 단계의 여유 공간 검사(`diskStats().low`)는 서버 쪽 작업이다 | 서버에 전달 |
| 2026-11-15 | P7-01 | `apps/web/e2e/server/start.ts`의 가짜 전사(청크마다 12초 분량의 세 문장)는 보통 오디오의 전사 검사를 통과하지 못한다(청크의 말소리가 20초 이상이면 30% 이상 덮어야 한다. 계속되는 소리로는 1분짜리도 실패). 명세 §10의 전제가 틀렸다. 부하 스크립트는 30초마다 1초씩 소리가 나는 오디오를 써서 피했다. 가짜를 고칠지는 정하지 않았다 | 기록만 |
| 2026-11-15 | P7-02 | 전사가 모두 실패하면(공급자 5xx·429·타임아웃) 사용자에게 보이는 메시지(강의 `error_message`, 녹음 `failure_message`)에 공급자 원문이 붙는다: `전사에 성공한 구간이 없습니다: Gemini request failed (503): {"error":…}`. `failure_code`는 `legacy_error`다. 한국어 문장만 남기고 원인은 코드(예: `transcript_failed`)와 로그로 두는 편이 낫다. 타임아웃형 장애에서는 시도마다 `LECTERN_GEMINI_TIMEOUT_MS`(기본 15분)를 기다려 1시간 녹음이 약 4시간 뒤에야 `failed`로 끝난다(런북 incident-response §3.5에 적었다) | 서버에 전달 |
| 2026-11-15 | P7-02 | 장애 테스트는 명세의 `runProcessJob(directJob(…))` 대신 `registerProcessJobHandler(deps)`와 테스트 파일의 `JobWorker`로 돌려 작업 행의 최종 상태를 큐가 쓴 값으로 본다. 재시도는 관리자 재시도 API(같은 작업이 실패한 단계부터 이어서 `ready`). 리허설 서버는 `LECTERN_PREFLIGHT=1`·`--no-env-file`·빈 시크릿으로 뜬다. 부팅 정리 예외 목록은 명세대로 두었지만 실제로 줄어든 테이블은 없었다. 작업 디렉터리는 숨김 파일까지 비어 있어야 한다(끝난 뒤 비우므로). 장애 테스트는 ffmpeg가 필요해 CI에서는 건너뛰고 로컬 게이트에서만 돈다 | 기록만 |
| 2026-11-15 | 통합 | CI(ce16ee3)의 `pdf-search` "other users see nothing"이 403 대신 401: API 토큰(`lct_` + 무작위)이 약 13만 개에 하나꼴로 `lct_at_`·`lct_rt_`·`lct_pat_`로 시작해 v2가 네이티브·PAT 토큰으로 보고 거절했다. 새 토큰은 그 접두어를 피하고, 이미 발급된 토큰은 v2가 API 토큰으로 다시 찾는다(ffe3466). 그 실행의 토큰은 확인할 수 없어 원인은 추정이다. 같은 테스트가 다시 401이면 이 추정이 틀린 것이다(그 실행에서 바뀐 순서는 `scripts/load/load.test.ts`가 맨 앞에 온 것뿐). 인증 경로를 바꾼 것이라 사람이 하는 보안 리뷰(P5-15)에 넣는다 | 고침 |
| 2026-11-15 | P7-04 | 키보드 전용 여정(가입 → 업로드 → 설정 → 로그아웃, 운영자 로그인 → 문서의 시각 표시 → 공유 → 설정의 모든 구역 → 관리의 모든 탭)이 막힌 두 곳을 고쳤다(`RecordingPage.tsx`): 처리 중 상태 문구에 `role="status"`(감싼 `aria-busy` 제거), `녹음 작업` 메뉴에서 연 대화상자를 닫으면 포커스가 `<body>`로 가던 것 → 메뉴 버튼으로. 키보드 단계가 있는 e2e가 없는 화면은 `/app/reset`, `/app/invite`, 관리의 상세 페이지 세 곳이다(axe는 모든 경로) | P7-04에서 고침 / 기록만 |
| 2026-11-15 | P7-04 | 여정에서 사이드바(사용자 메뉴, 라이브러리)는 Shift+Tab으로 간다(화면이 바뀌면 포커스가 `<main>`에 있고 사이드바는 그 앞). 관리 메뉴 링크는 이름에 개수·설명이 붙고 사이드바에 같은 이름(녹음, 설정)이 있어 관리 메뉴 안에서만 찾는다. 관리 콘솔은 연결을 열어 두어 `networkidle`이 오지 않는다(표·`불러오는 중…`로 로드를 본다). 올린 파일 이름은 가입 이름과 겹치지 않게 `여정 녹음.wav` | 기록만 |
| 2026-11-15 | 통합 | CI(`d5e3319`)의 Core 작업에서 `scripts/rehearse/rehearse.test.ts`의 digest·integrity·restore 테스트가 "unable to open database file"로 실패: 백업을 `file:…?immutable=1`로 여는데 Linux의 Bun 내장 SQLite는 URI 파일 이름이 기본으로 꺼져 있다(macOS는 시스템 SQLite라 로컬 게이트가 통과했다). `SQLITE_OPEN_URI` 플래그를 직접 주고 행 쿼리만 `safeIntegers`로 읽게 고쳤다(`e25f24b`). 확인됨: `32722fd`의 CI에서 Core 작업 통과(2026-11-15, 같은 실행의 다른 작업도 모두 통과). 실패한 실행에서 Apple 작업은 처음으로 통과했다 | 고침 |
| 2026-11-15 | P5-15 | 보안 테스트의 발견 1(중간, CSRF: 쿠키로 인증한 변경 요청에 출처 검사 없음)을 사용자 결정("CSRF 수정")으로 고쳤다. `ea052f4`(`fix(server)`, P5-15 소유 밖이라 따로 커밋): `apps/server/src/csrf.ts` 한 곳에서 판정하고, v2는 `createApiV2App` 미들웨어, v2 밖은 `http.ts`가 검사한다. `Sec-Fetch-Site`가 있으면 same-origin·none만(same-site도 403), 없으면 `Origin`이 요청을 받은 출처나 `LECTERN_BASE_URL`의 출처일 때만, 둘 다 없으면 통과. 토큰 요청과 Apple 콜백은 보지 않는다. 물어보기의 cross-site 전용 검사를 이것으로 바꿨다. P5-15를 이 위로 옮겨 경계 테스트 6개(same-site, Origin만, 빈 토큰, 읽기, v1 쿠키 쓰기)를 더했고 보안 테스트 55개, 게이트 `full`(웹 e2e 218개: 실제 Chromium의 v2 쓰기와 v1 로그아웃, 새 관리자 콘솔 읽기)이 통과했다. 수정 전 서버에서는 거절 테스트 7개가 실패한다 | 고침 |
