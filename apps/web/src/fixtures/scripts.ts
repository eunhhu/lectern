// Synthetic scripts for the fixture transcripts. All of this text was written for the
// fixtures: no line comes from a real recording, lecture or meeting, and every name is
// made up.

import type { Script } from "./transcript-gen.ts";

const LECTURE_FILLERS = ["자, ", "그러니까 ", "음, ", "여기서 ", "그래서 ", "보시면 ", "네, "];
const TALK_FILLERS = ["음, ", "그러니까 ", "아, ", "네, ", "근데 "];

/** 운영체제 7주차: the long lecture (≈2h48m, thousands of segments) used to test virtual scrolling. */
export const OS_SCHEDULING: Script = {
  speakers: [
    { label: "S1", name: "김 교수" },
    { label: "S2", name: null },
  ],
  turns: { S1: 1 },
  fillers: LECTURE_FILLERS,
  breaks: [{ at: 0.5, ms: 9 * 60_000 + 50_000 }],
  tailMs: 35_000,
  interjections: [
    {
      speaker: "S2",
      rate: 0.012,
      lines: [
        "교수님, 타임 퀀텀은 보통 얼마로 잡나요?",
        "SJF에서 실행 시간이 같으면 어떻게 하나요?",
        "에이징은 얼마나 자주 올려 주나요?",
        "시험에 간트 차트 그리는 문제가 나오나요?",
        "선점형이면 문맥 교환이 더 자주 일어나는 거죠?",
        "멀티코어에서도 라운드 로빈을 그대로 쓰나요?",
      ],
      replies: [
        "좋은 질문입니다. 슬라이드 다음 쪽에서 바로 다룰게요.",
        "네, 거의 매 학기 나옵니다. 손으로 그려 보는 연습을 하세요.",
        "맞아요. 그게 선점의 비용입니다.",
        "그건 구현마다 달라요. 시험에서는 문제에 조건을 줄 겁니다.",
        "보통 수십 밀리초 단위로 잡습니다. 뒤에서 기준을 말씀드릴게요.",
      ],
    },
  ],
  phases: [
    {
      key: "intro",
      weight: 6,
      lines: [
        "시작하겠습니다. 오늘은 출석을 따로 부르지 않을게요.",
        "지난 시간에 프로세스 상태 전이를 봤죠.",
        "준비, 실행, 대기 세 상태를 다시 떠올려 보세요.",
        "실행 중인 프로세스가 입출력을 요청하면 대기 상태로 갑니다.",
        "입출력이 끝나면 바로 실행되는 게 아니라 준비 상태로 돌아가요.",
        "준비 큐에는 언제나 여러 프로세스가 줄을 서 있습니다.",
        "슬라이드 {n:2-4}쪽을 같이 보죠.",
        "오늘 내용은 시험 비중이 큽니다.",
      ],
      anchors: [
        { key: "intro_goal", text: "오늘의 질문은 하나입니다. 준비 큐에 여러 프로세스가 있을 때 다음에 누구에게 CPU를 줄 것인가." },
      ],
    },
    {
      key: "criteria",
      weight: 8,
      lines: [
        "스케줄러를 평가하는 기준부터 정리하겠습니다.",
        "CPU 이용률은 CPU가 쉬지 않고 일하는 비율이에요.",
        "처리량은 단위 시간에 끝나는 프로세스 수입니다.",
        "반환 시간은 도착부터 완료까지 걸린 전체 시간이고요.",
        "대기 시간은 준비 큐에서 기다린 시간의 합입니다.",
        "응답 시간은 요청하고 첫 반응이 오기까지의 시간이에요.",
        "대화형 시스템에서는 응답 시간이 특히 중요하죠.",
        "이 기준들은 서로 부딪힙니다. 하나를 올리면 다른 게 떨어져요.",
      ],
      anchors: [
        {
          key: "criteria_waiting",
          text: ["시험에서는 대기 시간을 가장 많이 물어봅니다.", "대기 시간은 반환 시간에서 실행 시간을 뺀 값이에요."],
        },
      ],
    },
    {
      key: "fcfs",
      weight: 12,
      lines: [
        "FCFS는 먼저 온 순서대로 처리합니다.",
        "구현은 아주 간단해요. 큐 하나면 됩니다.",
        "프로세스 P{n:1-5}의 도착 시간이 {n:0-9}초, 실행 시간이 {n:2-12}초라고 해 봅시다.",
        "간트 차트를 그려 보면 바로 보이죠.",
        "첫 작업이 길면 뒤에 있는 짧은 작업들이 다 기다려야 합니다.",
        "평균 대기 시간을 계산하면 {n:3-17}초가 나옵니다.",
        "도착 순서만 바꿔도 결과가 크게 달라져요.",
        "비선점이라서 한번 CPU를 잡으면 끝날 때까지 놓지 않습니다.",
      ],
      anchors: [{ key: "convoy", text: "긴 작업 하나 뒤에 짧은 작업들이 줄줄이 기다리는 현상, 이걸 호위 효과라고 합니다." }],
    },
    {
      key: "sjf",
      weight: 12,
      lines: [
        "그럼 짧은 작업을 먼저 하면 어떨까요.",
        "이게 SJF, 최단 작업 우선입니다.",
        "문제는 다음 실행 시간을 미리 알 수 없다는 거죠.",
        "그래서 과거 실행 시간으로 다음 값을 예측합니다.",
        "선점형으로 바꾸면 SRTF가 됩니다.",
        "새로 온 프로세스의 남은 시간이 더 짧으면 지금 것을 내려놓게 하는 거예요.",
        "프로세스 P{n:1-5}의 남은 시간이 {n:1-8}초로 줄었네요.",
        "알파가 0.{n:3-8}이면 최근 값과 과거 평균을 어떻게 섞는지 계산해 보세요.",
      ],
      anchors: [
        { key: "sjf_optimal", text: "SJF는 평균 대기 시간을 최소로 만드는 최적 알고리즘입니다. 단, 실행 시간을 알 때만요." },
        { key: "sjf_predict", text: "다음 실행 시간은 지수 평균으로 예측합니다. 알파 값이 클수록 최근 값을 더 믿는 거예요." },
      ],
    },
    {
      key: "rr",
      weight: 16,
      lines: [
        "이제 라운드 로빈입니다.",
        "모든 프로세스에 같은 시간 조각을 돌아가면서 줍니다.",
        "이 시간 조각을 타임 퀀텀이라고 해요.",
        "퀀텀이 끝나면 준비 큐의 맨 뒤로 갑니다.",
        "타임 퀀텀을 {n:10-100}밀리초로 잡았다고 해 봅시다.",
        "문맥 교환 비용도 같이 생각해야 합니다.",
        "응답 시간은 좋아지지만 반환 시간은 SJF보다 길어지기 쉬워요.",
        "프로세스가 {n:3-6}개면 한 바퀴 도는 데 얼마나 걸릴까요.",
      ],
      anchors: [
        { key: "rr_quantum_large", text: "타임 퀀텀이 너무 크면 라운드 로빈은 사실상 FCFS와 같아집니다." },
        {
          key: "rr_quantum_small",
          text: ["반대로 너무 작으면 문맥 교환에 시간을 다 써 버리죠.", "그래서 퀀텀은 문맥 교환 시간보다 훨씬 크게 잡습니다."],
        },
        { key: "rr_rule", text: "경험적으로는 CPU 버스트의 80퍼센트가 한 퀀텀 안에 끝나도록 잡으라고 합니다." },
      ],
    },
    {
      key: "priority",
      weight: 12,
      lines: [
        "우선순위 스케줄링은 숫자가 작은 쪽을 먼저 실행한다고 약속하겠습니다.",
        "교재마다 방향이 다르니 문제를 잘 읽으세요.",
        "우선순위가 낮은 프로세스는 계속 밀릴 수 있어요.",
        "선점형과 비선점형 둘 다 가능합니다.",
        "우선순위가 같으면 FCFS로 정하는 게 일반적이에요.",
        "프로세스 P{n:1-5}의 우선순위를 {n:1-9}로 두고 다시 그려 봅시다.",
      ],
      anchors: [
        { key: "starvation", text: "낮은 우선순위 프로세스가 영원히 실행되지 못하는 것, 이게 기아 상태입니다." },
        { key: "aging", text: "해결책은 에이징입니다. 기다린 시간만큼 우선순위를 조금씩 올려 주는 거예요." },
      ],
    },
    {
      key: "mlq",
      weight: 12,
      lines: [
        "프로세스를 성격별로 나눠서 큐를 여러 개 둘 수 있습니다.",
        "대화형 작업은 위쪽 큐, 배치 작업은 아래쪽 큐에 둡니다.",
        "큐마다 다른 알고리즘을 쓸 수 있어요.",
        "위쪽 큐는 라운드 로빈, 맨 아래는 FCFS 같은 식이죠.",
        "다단계 피드백 큐에서는 프로세스가 큐 사이를 이동합니다.",
        "퀀텀을 다 쓰면 한 단계 아래로 내려가요.",
        "오래 기다리면 다시 위로 올려 줍니다.",
      ],
      anchors: [
        {
          key: "mlfq",
          text: "다단계 피드백 큐는 CPU를 오래 쓰는 작업을 아래로 내려서, 짧은 대화형 작업이 빨리 응답하게 만듭니다.",
        },
      ],
    },
    {
      key: "multicore",
      weight: 10,
      lines: [
        "코어가 여러 개면 이야기가 더 복잡해집니다.",
        "각 코어가 자기 준비 큐를 갖는 방식이 요즘 일반적이에요.",
        "한 코어만 바쁘고 나머지가 놀면 안 되겠죠.",
        "그래서 부하 분산이 필요합니다.",
        "푸시 이주와 풀 이주 두 가지가 있어요.",
        "프로세스를 옮기면 캐시를 다시 채워야 합니다.",
      ],
      anchors: [
        {
          key: "affinity",
          text: "프로세서 친화성, 즉 캐시가 데워진 코어에 프로세스를 계속 두려는 성질과 부하 분산은 서로 부딪힙니다.",
        },
      ],
    },
    {
      key: "wrapup",
      weight: 6,
      lines: [
        "오늘 내용 정리하겠습니다.",
        "질문 있으면 지금 해 주세요.",
        "다음 시간에는 동기화로 넘어갑니다.",
        "교재 6장을 미리 읽어 오세요.",
        "슬라이드는 강의 게시판에 올려 두겠습니다.",
      ],
      anchors: [
        { key: "assignment", text: "과제 3은 스케줄링 시뮬레이터 구현입니다. 다음 주 화요일 밤 11시 59분까지 제출하세요." },
        { key: "midterm", text: "중간고사는 다음 주 수요일 수업 시간에 봅니다. 범위는 1장부터 오늘 배운 6장까지예요." },
      ],
    },
  ],
};

export const OS_THREADS: Script = {
  speakers: [
    { label: "S1", name: "김 교수" },
    { label: "S2", name: null },
  ],
  turns: { S1: 1 },
  fillers: LECTURE_FILLERS,
  interjections: [
    {
      speaker: "S2",
      rate: 0.015,
      lines: ["스레드끼리는 스택도 공유하나요?", "사용자 수준 스레드가 더 빠른 이유가 뭔가요?"],
      replies: ["스택은 스레드마다 따로 있습니다. 코드와 데이터, 힙을 공유해요.", "커널을 거치지 않아서 전환 비용이 적기 때문이에요."],
    },
  ],
  phases: [
    {
      key: "process",
      weight: 4,
      lines: [
        "프로세스는 실행 중인 프로그램입니다.",
        "프로세스마다 주소 공간이 따로 있어요.",
        "PCB에는 상태, 프로그램 카운터, 레지스터가 들어갑니다.",
        "fork를 부르면 자식 프로세스가 만들어집니다.",
      ],
      anchors: [{ key: "pcb", text: "PCB는 운영체제가 프로세스를 관리하려고 들고 있는 정보 묶음입니다." }],
    },
    {
      key: "threads",
      weight: 5,
      lines: [
        "스레드는 프로세스 안의 실행 흐름입니다.",
        "같은 프로세스의 스레드는 코드와 데이터를 공유합니다.",
        "스레드를 만드는 비용은 프로세스보다 훨씬 작아요.",
        "웹 서버를 생각해 보면 요청마다 스레드를 하나씩 둘 수 있죠.",
      ],
      anchors: [{ key: "thread_share", text: "스레드끼리 공유하는 건 코드, 데이터, 열린 파일이고 스택과 레지스터는 각자 갖습니다." }],
    },
    {
      key: "models",
      weight: 3,
      lines: [
        "사용자 스레드와 커널 스레드를 어떻게 연결하느냐가 다중 스레드 모델입니다.",
        "일대일 모델이 요즘 가장 흔합니다.",
        "다대일 모델은 하나가 막히면 전부 막혀요.",
      ],
      anchors: [{ key: "one_to_one", text: "일대일 모델은 병렬성이 좋지만 커널 스레드를 많이 만들어야 합니다." }],
    },
  ],
};

export const DS_HEAP: Script = {
  speakers: [
    { label: "S1", name: "이 교수" },
    { label: "S2", name: null },
  ],
  turns: { S1: 1 },
  fillers: LECTURE_FILLERS,
  interjections: [
    {
      speaker: "S2",
      rate: 0.02,
      lines: ["힙은 꼭 완전 이진 트리여야 하나요?", "배열 인덱스는 0부터 시작해도 되나요?"],
      replies: ["네, 그래야 배열에 빈칸 없이 담을 수 있어요.", "됩니다. 그때는 자식 인덱스 공식이 조금 달라져요."],
    },
  ],
  phases: [
    {
      key: "pq",
      weight: 3,
      lines: [
        "우선순위 큐는 가장 중요한 원소를 먼저 꺼내는 자료구조입니다.",
        "정렬된 배열로 만들면 삽입이 느려요.",
        "연결 리스트로 만들면 탐색이 느리고요.",
      ],
      anchors: [{ key: "pq_def", text: "우선순위 큐의 연산은 두 개입니다. 넣기와, 가장 우선순위가 높은 원소 꺼내기." }],
    },
    {
      key: "heap",
      weight: 5,
      lines: [
        "최대 힙은 부모가 항상 자식보다 크거나 같습니다.",
        "힙은 배열 하나로 표현할 수 있어요.",
        "인덱스 {n:1-9}의 왼쪽 자식은 인덱스 곱하기 2입니다.",
        "새 원소는 맨 끝에 넣고 위로 올립니다.",
        "꺼낼 때는 루트를 빼고 마지막 원소를 루트로 옮긴 뒤 아래로 내립니다.",
      ],
      anchors: [
        { key: "heap_log", text: "삽입과 삭제 모두 트리 높이만큼만 움직이니까 O(log n)입니다." },
        { key: "heap_build", text: "배열 전체로 힙을 만드는 건 아래에서부터 내리면 O(n)에 됩니다." },
      ],
    },
    {
      key: "heapsort",
      weight: 3,
      lines: ["힙 정렬은 힙에서 하나씩 꺼내면 끝입니다.", "제자리 정렬이지만 안정 정렬은 아니에요."],
      anchors: [{ key: "heapsort", text: "힙 정렬은 최악에도 O(n log n)이라 퀵 정렬보다 예측이 쉽습니다." }],
    },
  ],
};

export const DS_TREES: Script = {
  speakers: [{ label: "S1", name: "이 교수" }],
  turns: { S1: 1 },
  fillers: LECTURE_FILLERS,
  breaks: [{ at: 0.55, ms: 4 * 60_000 + 20_000, kind: "missing_transcript" }],
  phases: [
    {
      key: "traversal",
      weight: 5,
      lines: [
        "전위 순회는 루트, 왼쪽, 오른쪽 순서입니다.",
        "중위 순회는 왼쪽, 루트, 오른쪽이에요.",
        "후위 순회는 자식을 다 본 다음 루트를 봅니다.",
        "재귀로 쓰면 세 줄이면 끝납니다.",
      ],
      anchors: [{ key: "inorder_bst", text: "이진 탐색 트리를 중위 순회하면 정렬된 순서가 나옵니다." }],
    },
    {
      key: "level",
      weight: 3,
      lines: ["레벨 순회는 큐를 씁니다.", "루트를 넣고, 꺼낼 때마다 자식을 넣습니다."],
      anchors: [{ key: "level_queue", text: "레벨 순회는 스택이 아니라 큐를 쓴다는 게 핵심입니다." }],
    },
  ],
};

export const ECON_CHOICE: Script = {
  speakers: [
    { label: "S1", name: "정 교수" },
    { label: "S2", name: null },
  ],
  turns: { S1: 1 },
  fillers: LECTURE_FILLERS,
  interjections: [
    {
      speaker: "S2",
      rate: 0.012,
      lines: ["무차별곡선은 왜 서로 만나면 안 되나요?", "한계대체율이 체감한다는 게 무슨 뜻인가요?"],
      replies: ["만나면 같은 묶음이 두 효용 수준을 갖게 돼서 모순이에요.", "하나를 더 가질수록 그걸 위해 포기할 다른 재화가 줄어든다는 뜻입니다."],
    },
  ],
  phases: [
    {
      key: "budget",
      weight: 4,
      lines: [
        "예산선은 주어진 소득으로 살 수 있는 묶음의 경계입니다.",
        "가격이 오르면 예산선이 안쪽으로 돌아갑니다.",
        "소득이 {n:10-90}만 원으로 늘면 예산선이 평행하게 바깥으로 이동하죠.",
      ],
      anchors: [{ key: "budget_slope", text: "예산선의 기울기는 두 재화의 가격비, 즉 마이너스 P1 나누기 P2입니다." }],
    },
    {
      key: "indiff",
      weight: 4,
      lines: [
        "무차별곡선은 같은 만족을 주는 묶음을 이은 선입니다.",
        "원점에서 멀수록 더 높은 효용이에요.",
        "보통 원점을 향해 볼록한 모양입니다.",
      ],
      anchors: [{ key: "mrs", text: "무차별곡선의 기울기가 한계대체율입니다. 한 재화를 더 얻으려고 포기하는 다른 재화의 양이에요." }],
    },
    {
      key: "optimum",
      weight: 4,
      lines: ["소비자 균형은 예산선과 무차별곡선이 접하는 점입니다.", "그 점에서 기울기가 같아요.", "가격 변화는 대체 효과와 소득 효과로 나눠 봅니다."],
      anchors: [
        { key: "optimum", text: "최적 선택에서는 한계대체율이 가격비와 같습니다." },
        { key: "quiz", text: "다음 주 목요일에 이 단원으로 쪽지 시험을 봅니다." },
      ],
    },
  ],
};

export const SEMINAR_ASR: Script = {
  speakers: [
    { label: "S1", name: "발표자" },
    { label: "S2", name: "지도 교수" },
    { label: "S3", name: null },
  ],
  turns: { S1: 8, S2: 1, S3: 1 },
  maxRun: 8,
  fillers: TALK_FILLERS,
  phases: [
    {
      key: "metrics",
      weight: 4,
      lines: [
        "음성 인식은 보통 WER로 평가합니다.",
        "한국어는 띄어쓰기가 흔들려서 단어 단위가 불안정해요.",
        "그래서 글자 단위인 CER을 같이 봅니다.",
        "치환, 삭제, 삽입을 모두 세서 기준 길이로 나눕니다.",
      ],
      anchors: [{ key: "cer", text: "한국어 평가에는 띄어쓰기에 덜 민감한 CER을 주 지표로 쓰자고 제안합니다." }],
    },
    {
      key: "speaker",
      weight: 3,
      lines: [
        "화자 분리는 따로 DER로 잽니다.",
        "회의 녹음에서는 겹쳐 말하는 구간이 문제예요.",
        "청크를 나눠 처리하면 청크 경계에서 화자 번호가 바뀝니다.",
      ],
      anchors: [{ key: "chunk_speaker", text: "청크 경계에서 화자 번호가 바뀌는 문제는 겹치는 구간을 두고 다시 맞춰서 해결했습니다." }],
    },
    {
      key: "discussion",
      weight: 3,
      lines: ["평가 세트는 몇 시간 정도면 충분할까요?", "녹음 환경이 다양해야 합니다.", "강의실 잔향이 꽤 영향을 줍니다."],
      turns: { S1: 3, S2: 3, S3: 2 },
      anchors: [{ key: "eval_set", text: "다음 발표 전까지 강의실 녹음 세 시간으로 평가 세트를 만들기로 하죠.", speaker: "S2" }],
    },
  ],
};

export const ADVISING: Script = {
  speakers: [
    { label: "S1", name: "박 교수" },
    { label: "S2", name: "나" },
  ],
  turns: { S1: 1, S2: 1 },
  maxRun: 3,
  fillers: TALK_FILLERS,
  phases: [
    {
      key: "plan",
      weight: 3,
      lines: [
        "석사 과정에서 어떤 걸 해 보고 싶어요?",
        "음성 쪽 연구에 관심이 있습니다.",
        "학부 연구생으로 한 학기 해 보는 게 좋겠어요.",
        "논문 몇 편 읽어 보고 다시 얘기하죠.",
      ],
      anchors: [{ key: "reading", text: "다음 면담 전까지 추천한 논문 세 편을 읽고 요약해 오세요.", speaker: "S1" }],
    },
    {
      key: "timeline",
      weight: 2,
      lines: ["원서는 11월 말까지입니다.", "추천서는 미리 부탁해 두는 게 좋아요.", "연구 계획서는 두 쪽이면 충분합니다."],
      anchors: [{ key: "deadline", text: "대학원 원서 접수는 11월 28일까지예요.", speaker: "S1" }],
    },
  ],
};

export const DENTIST_CALL: Script = {
  speakers: [
    { label: "S1", name: "나" },
    { label: "S2", name: "병원" },
  ],
  turns: { S1: 1, S2: 1 },
  maxRun: 2,
  phases: [
    {
      key: "call",
      weight: 1,
      lines: ["네, 예약 확인해 드릴게요.", "성함이 어떻게 되세요?", "그 시간은 이미 찼어요.", "네, 알겠습니다."],
      anchors: [
        { key: "new_time", text: "그럼 다음 주 금요일 오후 4시로 옮겨 드릴게요.", speaker: "S2" },
        { key: "bring", text: "오실 때 지난번 엑스레이 사진 가져오세요.", speaker: "S2" },
      ],
    },
  ],
};

export const IDEA_MEMO: Script = {
  speakers: [{ label: "S1", name: "나" }],
  turns: { S1: 1 },
  fillers: TALK_FILLERS,
  phases: [
    {
      key: "idea",
      weight: 1,
      lines: [
        "녹음한 강의를 바로 복습 카드로 만들면 좋겠다.",
        "시험 전날 카드만 넘겨 봐도 되게.",
        "틀린 카드만 다시 보여 주면 더 좋고.",
        "출처를 누르면 그 부분을 다시 들을 수 있어야 해.",
      ],
      anchors: [{ key: "idea_core", text: "핵심은 카드마다 원래 강의 위치가 붙어 있는 거야." }],
    },
  ],
};

export const TEAM_WEEKLY: Script = {
  speakers: [
    { label: "S1", name: "한지민" },
    { label: "S2", name: "오세훈" },
    { label: "S3", name: "윤서아" },
    { label: "S4", name: "최도현" },
  ],
  turns: { S1: 4, S2: 3, S3: 3, S4: 2 },
  maxRun: 4,
  fillers: TALK_FILLERS,
  phases: [
    {
      key: "review",
      weight: 3,
      lines: [
        "지난주 할 일부터 확인할게요.",
        "온보딩 문구 수정은 끝났습니다.",
        "결제 오류 건은 아직 원인을 찾는 중이에요.",
        "대시보드 속도는 {n:20-60}퍼센트 정도 좋아졌어요.",
      ],
    },
    {
      key: "onboarding",
      weight: 4,
      lines: [
        "첫 녹음까지 가는 단계가 너무 많다는 피드백이 계속 와요.",
        "회원 가입하고 바로 올리기 화면을 보여 주면 어떨까요.",
        "샘플 녹음을 하나 넣어 두자는 의견도 있었고요.",
        "이탈이 제일 많은 곳은 권한 요청 화면이에요.",
      ],
      anchors: [{ key: "onboarding_decision", text: "그럼 가입 직후 바로 올리기 화면으로 보내는 걸로 정하죠.", speaker: "S1" }],
    },
    {
      key: "pricing",
      weight: 4,
      lines: [
        "가격 실험은 2주 더 돌려 보기로 했었죠.",
        "연간 요금제 전환율이 생각보다 낮아요.",
        "표본이 아직 작아서 결론 내기는 이릅니다.",
        "학생 할인은 따로 떼어서 봐야 할 것 같아요.",
      ],
      anchors: [
        { key: "pricing_open", text: "연간 요금제를 계속 앞에 둘지는 데이터가 더 모이면 다시 정하죠.", speaker: "S2" },
      ],
    },
    {
      key: "release",
      weight: 3,
      lines: ["다음 배포는 목요일 오후로 잡을게요.", "QA는 수요일까지 끝내야 해요.", "릴리스 노트는 제가 쓰겠습니다."],
      anchors: [
        { key: "release_date", text: "출시 점검 회의는 다음 주 목요일 오후 2시에 하겠습니다.", speaker: "S1" },
        { key: "qa_owner", text: "QA 체크리스트는 서아 님이 수요일까지 정리해 주세요.", speaker: "S1" },
        { key: "notes_owner", text: "릴리스 노트 초안은 제가 금요일까지 올릴게요.", speaker: "S4" },
      ],
    },
  ],
};

export const USER_INTERVIEW: Script = {
  speakers: [
    { label: "S1", name: "진행자" },
    { label: "S2", name: "참여자" },
  ],
  turns: { S1: 1, S2: 2 },
  maxRun: 3,
  fillers: TALK_FILLERS,
  phases: [
    {
      key: "habits",
      weight: 3,
      lines: [
        "수업은 보통 어떻게 기록하세요?",
        "노트북으로 받아 적다가 놓치는 게 많아요.",
        "녹음은 하는데 다시 듣지는 않게 되더라고요.",
        "세 시간짜리를 다시 듣는 건 엄두가 안 나요.",
      ],
      anchors: [{ key: "pain", text: "녹음은 쌓이는데 정작 필요한 부분을 찾을 수가 없어요.", speaker: "S2" }],
    },
    {
      key: "trust",
      weight: 3,
      lines: [
        "요약을 믿을 수 있으려면 뭐가 필요할까요?",
        "원문을 바로 확인할 수 있으면 좋겠어요.",
        "틀린 요약을 시험 공부에 쓰면 큰일이니까요.",
      ],
      anchors: [{ key: "sources", text: "요약 문장마다 원래 녹음 위치가 붙어 있으면 믿고 쓸 것 같아요.", speaker: "S2" }],
    },
  ],
};

/** Content for recordings created in the upload dialog (the fixture "processes" them). */
export const UPLOADED_GENERIC: Script = {
  speakers: [{ label: "S1", name: null }],
  turns: { S1: 1 },
  fillers: TALK_FILLERS,
  phases: [
    {
      key: "body",
      weight: 1,
      lines: [
        "올린 녹음의 전사는 이 자리에 표시됩니다.",
        "미리보기 데이터라서 실제 녹음 내용이 아닙니다.",
        "구간을 누르면 그 시점으로 이동합니다.",
        "문서의 출처 칩을 누르면 해당 구간이 강조됩니다.",
      ],
      anchors: [
        { key: "generic_summary", text: "이 녹음은 업로드 흐름을 확인하려고 만든 합성 전사입니다." },
        { key: "generic_next", text: "실제 서버가 연결되면 여기에 처리된 전사가 들어옵니다." },
      ],
    },
  ],
};
