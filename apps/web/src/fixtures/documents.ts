// Fixture documents, one per processed recording. Synthetic content only.

import type { DocumentSection, TranscriptGap } from "../api/types.ts";
import { type DocBuilder, section } from "./doc-builder.ts";

export type DocumentWriter = (b: DocBuilder, ctx: { gaps: TranscriptGap[] }) => DocumentSection[];

export const OS_SCHEDULING_DOC: DocumentWriter = (b, { gaps }) => {
  const pause = gaps.find((g) => g.kind === "break");
  return [
    section("summary", "핵심 요약", [
      b.paragraph(
        "CPU 스케줄링은 준비 큐의 여러 프로세스 중 다음에 CPU를 받을 프로세스를 고르는 일이다. 강의는 평가 기준을 정리한 뒤 FCFS, SJF, 라운드 로빈, 우선순위, 다단계 큐 순서로 장단점을 비교했다.",
        b.t("intro_goal", "criteria_waiting"),
      ),
      b.list([
        ["FCFS는 단순하지만 긴 작업 뒤에 짧은 작업이 줄줄이 기다리는 호위 효과가 생긴다.", b.t("convoy")],
        ["SJF는 평균 대기 시간이 최소인 최적 알고리즘이지만 실행 시간을 미리 알아야 한다.", b.t("sjf_optimal")],
        ["라운드 로빈의 성능은 타임 퀀텀 크기에 달려 있다.", b.t("rr_quantum_large", "rr_quantum_small")],
        ["우선순위 스케줄링의 기아 문제는 에이징으로 푼다.", b.t("starvation", "aging")],
      ]),
    ]),
    section("exam_points", "시험·과제 포인트", [
      b.callout("assignment", "과제 3: 스케줄링 시뮬레이터 구현. 다음 주 화요일 밤 11시 59분까지 제출.", b.t("assignment")),
      b.callout("exam", "중간고사는 다음 주 수요일 수업 시간. 범위는 1장부터 6장까지.", b.t("midterm")),
      b.callout("important", "대기 시간 = 반환 시간 − 실행 시간. 시험에 가장 자주 나오는 계산이다.", b.t("criteria_waiting")),
    ]),
    section("topics", "주제별 상세", [
      b.list(
        [
          ["CPU 이용률: CPU가 쉬지 않고 일하는 비율", b.t("criteria_waiting")],
          ["반환 시간: 도착부터 완료까지 걸린 시간", b.t("criteria_waiting")],
          ["응답 시간: 요청 후 첫 반응까지의 시간. 대화형 시스템에서 중요하다", []],
        ],
        "bullet",
        "평가 기준",
      ),
      b.term("호위 효과(convoy effect)", "실행 시간이 긴 프로세스 하나 때문에 뒤의 짧은 프로세스들이 오래 기다리는 현상.", [b.t("convoy")[0]!, b.page(7)], "FCFS"),
      b.paragraph(
        "SJF는 다음 CPU 버스트 길이를 알 수 없으므로 과거 버스트의 지수 평균으로 예측한다. 선점형으로 바꾼 것이 SRTF다.",
        [...b.t("sjf_predict"), b.page(9)],
        "SJF와 SRTF",
      ),
      b.formula(
        "\\tau_{n+1} = \\alpha t_n + (1-\\alpha)\\tau_n",
        "α가 클수록 최근 버스트를 더 믿는다. α = 0이면 과거 예측만, α = 1이면 직전 값만 쓴다.",
        b.t("sjf_predict"),
      ),
      ...(pause ? [b.gap("break", pause.start_ms, pause.end_ms)] : []),
      b.paragraph(
        "라운드 로빈은 모든 프로세스에 같은 타임 퀀텀을 돌아가며 준다. 퀀텀이 너무 크면 FCFS와 같아지고, 너무 작으면 문맥 교환 비용이 커진다. 경험적으로 CPU 버스트의 80%가 한 퀀텀 안에 끝나게 잡는다.",
        [...b.t("rr_quantum_large", "rr_quantum_small", "rr_rule"), b.page(12)],
        "라운드 로빈",
      ),
      b.term("기아(starvation)", "우선순위가 낮은 프로세스가 계속 밀려 실행되지 못하는 상태.", b.t("starvation"), "우선순위 스케줄링"),
      b.term("에이징(aging)", "기다린 시간에 비례해 우선순위를 높여 기아를 막는 기법.", b.t("aging")),
      b.paragraph(
        "다단계 피드백 큐는 퀀텀을 다 쓴 프로세스를 아래 큐로 내리고 오래 기다린 프로세스는 올린다. CPU를 오래 쓰는 작업은 아래로 가고 짧은 대화형 작업은 빨리 응답한다.",
        [...b.t("mlfq"), b.page(16)],
        "다단계 큐",
      ),
      b.paragraph(
        "멀티코어에서는 코어별 준비 큐와 부하 분산(푸시·풀 이주)을 쓴다. 다만 프로세서 친화성 때문에 프로세스를 옮기는 비용이 있다.",
        b.t("affinity"),
        "멀티코어 스케줄링",
      ),
      b.paragraph(
        "실시간 시스템에서는 마감 시간을 기준으로 스케줄링하며, 강의에서는 다음 시간에 다룬다고 했다.",
        [],
      ),
    ]),
    section("quotes", "주요 발언", [
      b.quote("타임 퀀텀이 너무 크면 라운드 로빈은 사실상 FCFS와 같아집니다.", "S1", b.t("rr_quantum_large")),
    ]),
  ];
};

export const OS_THREADS_DOC: DocumentWriter = (b) => [
  section("summary", "핵심 요약", [
    b.paragraph("프로세스와 스레드의 차이, 스레드가 공유하는 자원, 다중 스레드 모델을 다뤘다.", b.t("pcb", "thread_share")),
  ]),
  section("topics", "주제별 상세", [
    b.term("PCB", "운영체제가 프로세스를 관리하려고 유지하는 상태, 프로그램 카운터, 레지스터 등의 정보.", [b.t("pcb")[0]!, b.page(3)], "프로세스"),
    b.list(
      [
        ["공유: 코드, 데이터, 힙, 열린 파일", b.t("thread_share")],
        ["각자: 스택, 레지스터, 프로그램 카운터", b.t("thread_share")],
      ],
      "bullet",
      "스레드가 공유하는 것",
    ),
    b.paragraph("일대일 모델은 병렬성이 좋지만 커널 스레드가 많이 필요하다.", [...b.t("one_to_one"), b.page(11)], "다중 스레드 모델"),
  ]),
];

export const DS_HEAP_DOC: DocumentWriter = (b) => [
  section("summary", "핵심 요약", [
    b.list([
      ["우선순위 큐는 넣기와 최우선 원소 꺼내기 두 연산으로 정의된다.", b.t("pq_def")],
      ["힙의 삽입·삭제는 O(log n), 배열 전체로 힙 만들기는 O(n)이다.", b.t("heap_log", "heap_build")],
      ["힙 정렬은 최악에도 O(n log n)이다.", b.t("heapsort")],
    ]),
  ]),
  section("topics", "주제별 상세", [
    b.term("최대 힙", "모든 노드에서 부모가 자식보다 크거나 같은 완전 이진 트리.", b.t("heap_log"), "힙"),
    b.formula("\\text{left}(i) = 2i,\\quad \\text{right}(i) = 2i + 1,\\quad \\text{parent}(i) = \\lfloor i/2 \\rfloor", "인덱스를 1부터 셀 때의 공식이다.", b.t("heap_log")),
    b.callout("exam", "힙 만들기가 O(n)인 이유를 설명하는 문제가 자주 나온다.", b.t("heap_build")),
  ]),
];

export const DS_TREES_DOC: DocumentWriter = (b, { gaps }) => {
  const missing = gaps.find((g) => g.kind === "missing_transcript");
  return [
    section("summary", "핵심 요약", [
      b.paragraph("이진 트리의 네 가지 순회를 비교했다. 녹음 중간 일부는 전사하지 못했다.", b.t("inorder_bst", "level_queue")),
    ]),
    section("topics", "주제별 상세", [
      b.paragraph("이진 탐색 트리를 중위 순회하면 키가 정렬된 순서로 나온다.", b.t("inorder_bst"), "깊이 우선 순회"),
      ...(missing ? [b.gap("missing_transcript", missing.start_ms, missing.end_ms)] : []),
      b.paragraph("레벨 순회는 큐를 써서 위에서 아래로, 왼쪽에서 오른쪽으로 방문한다.", b.t("level_queue"), "레벨 순회"),
    ]),
  ];
};

export const ECON_CHOICE_DOC: DocumentWriter = (b) => [
  section("summary", "핵심 요약", [
    b.paragraph("소비자는 예산선과 무차별곡선이 접하는 점에서 효용을 극대화한다. 그 점에서 한계대체율이 가격비와 같다.", [
      ...b.t("optimum"),
      b.page(5),
    ]),
  ]),
  section("exam_points", "시험·과제 포인트", [b.callout("exam", "다음 주 목요일 쪽지 시험: 소비자 선택 단원.", b.t("quiz"))]),
  section("topics", "주제별 상세", [
    b.formula("-\\frac{P_1}{P_2}", "예산선의 기울기는 두 재화의 가격비다.", b.t("budget_slope"), "예산선"),
    b.term("한계대체율(MRS)", "같은 효용을 유지하며 한 재화를 한 단위 더 얻으려고 포기하는 다른 재화의 양.", b.t("mrs"), "무차별곡선"),
    b.formula("MRS_{12} = \\frac{MU_1}{MU_2} = \\frac{P_1}{P_2}", "최적 선택 조건.", [...b.t("optimum"), b.page(8)], "소비자 균형"),
  ]),
];

export const SEMINAR_ASR_DOC: DocumentWriter = (b) => [
  section("summary", "핵심 요약", [
    b.paragraph("한국어 음성 인식 평가는 띄어쓰기에 덜 민감한 CER을 주 지표로 쓰자는 제안과, 청크 경계의 화자 번호 문제를 다뤘다.", [
      ...b.t("cer", "chunk_speaker"),
      b.page(2),
    ]),
  ]),
  section("topics", "주제별 상세", [
    b.term("CER", "글자 단위 오류율. 치환·삭제·삽입 수를 기준 글자 수로 나눈 값.", [b.t("cer")[0]!, b.page(4)], "평가 지표"),
    b.formula("\\mathrm{CER} = \\frac{S + D + I}{N}", null, b.t("cer")),
    b.paragraph("청크 경계에서 화자 번호가 바뀌는 문제는 겹치는 구간을 두고 다시 맞춰 해결했다.", b.t("chunk_speaker"), "화자 분리"),
    b.callout("note", "다음 발표 전까지 강의실 녹음 세 시간으로 평가 세트를 만든다.", b.t("eval_set")),
  ]),
];

export const ADVISING_DOC: DocumentWriter = (b) => [
  section("summary", "요약", [b.paragraph("대학원 진학 준비 일정과 다음 면담까지 할 일을 정했다.", b.t("reading", "deadline"))]),
  section("action_items", "할 일", [
    b.list([
      ["추천 논문 세 편 읽고 요약하기", b.t("reading")],
      ["추천서 미리 부탁하기", []],
    ]),
  ]),
  section("next_events", "다음 일정", [b.list([["대학원 원서 접수 마감: 11월 28일", b.t("deadline")]])]),
];

export const DENTIST_CALL_DOC: DocumentWriter = (b) => [
  section("summary", "요약", [b.paragraph("치과 예약을 다음 주 금요일 오후 4시로 옮겼다.", b.t("new_time"))]),
  section("action_items", "할 일", [b.list([["지난번 엑스레이 사진 챙기기", b.t("bring")]])]),
];

export const IDEA_MEMO_DOC: DocumentWriter = (b) => [
  section("summary", "요약", [b.paragraph("강의 녹음을 복습 카드로 바꾸고, 카드마다 원래 강의 위치를 붙이자는 아이디어.", b.t("idea_core"))]),
];

export const TEAM_WEEKLY_DOC: DocumentWriter = (b) => [
  section("summary", "요약", [
    b.paragraph("온보딩 이탈을 줄이기 위해 가입 직후 바로 올리기 화면으로 보내기로 했다. 가격 실험은 데이터가 더 모일 때까지 결론을 미뤘고, 다음 배포는 목요일이다.", b.t("onboarding_decision", "pricing_open", "release_date")),
  ]),
  section("decisions", "결정 사항", [b.list([["가입 직후 바로 올리기 화면으로 보낸다.", b.t("onboarding_decision")]])]),
  section("action_items", "할 일", [
    b.list([
      ["QA 체크리스트 정리 (윤서아, 수요일까지)", b.t("qa_owner")],
      ["릴리스 노트 초안 (최도현, 금요일까지)", b.t("notes_owner")],
    ]),
  ]),
  section("topics", "논의 주제별 요점", [
    b.paragraph("첫 녹음까지 단계가 많다는 피드백이 반복된다. 이탈은 권한 요청 화면에서 가장 많다.", b.t("onboarding_decision"), "온보딩"),
    b.quote("연간 요금제를 계속 앞에 둘지는 데이터가 더 모이면 다시 정하죠.", "S2", b.t("pricing_open"), "가격 실험"),
  ]),
  section("open_issues", "미결 쟁점", [b.list([["연간 요금제 노출 위치", b.t("pricing_open")], ["학생 할인 분리 분석", []]])]),
  section("next_events", "다음 일정", [b.list([["출시 점검 회의: 다음 주 목요일 오후 2시", b.t("release_date")]])]),
];

export const USER_INTERVIEW_DOC: DocumentWriter = (b) => [
  section("summary", "요약", [
    b.paragraph("참여자는 녹음을 쌓아 두지만 필요한 부분을 찾지 못해 다시 듣지 않는다. 요약을 믿으려면 문장마다 원래 위치가 필요하다고 했다.", b.t("pain", "sources")),
  ]),
  section("topics", "논의 주제별 요점", [
    b.quote("녹음은 쌓이는데 정작 필요한 부분을 찾을 수가 없어요.", "S2", b.t("pain"), "기록 습관"),
    b.quote("요약 문장마다 원래 녹음 위치가 붙어 있으면 믿고 쓸 것 같아요.", "S2", b.t("sources"), "신뢰"),
  ]),
];

export const UPLOADED_GENERIC_DOC: DocumentWriter = (b) => [
  section("summary", "핵심 요약", [
    b.paragraph("업로드 흐름을 확인하려고 만든 합성 문서입니다. 실제 서버가 연결되면 처리 결과로 바뀝니다.", b.t("generic_summary")),
    b.list([["출처 칩을 누르면 해당 전사 구간으로 이동합니다.", b.t("generic_next")]]),
  ]),
];
