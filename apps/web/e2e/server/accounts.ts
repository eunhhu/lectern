// Test account and notes of the real-server e2e suite (start.ts seeds them into a
// throwaway database). Synthetic: no real person, lecture or key.

export const E2E_PORT = 4175;
export const E2E_OWNER_EMAIL = "e2e-owner@example.com";
/** A test value for the sandboxed e2e database only. */
export const E2E_OWNER_PASSWORD = "lectern-e2e-local-only";

export interface E2ELecture {
  title: string;
  course: string;
  audioSeconds: number;
  markdown: string;
  /**
   * Transcript rows seeded into the v2 tables after the lecture is projected. v1 lectures
   * have none (the projection gives them an empty transcript); one with a transcript lets
   * the suite check that the transcript follows the audio clock.
   */
  transcript?: { startMs: number; endMs: number; text: string }[];
}

/** v1 lectures (Markdown with [MM:SS] marks), owned by the e2e owner. */
export const E2E_LECTURES: E2ELecture[] = [
  {
    title: "정보보호 7주차 — 블록 암호 운영 모드",
    course: "정보보호",
    audioSeconds: 24,
    transcript: [
      { startMs: 0, endMs: 5_500, text: "오늘은 블록 암호의 운영 모드를 봅니다." },
      { startMs: 5_500, endMs: 11_000, text: "ECB 모드는 같은 평문 블록을 같은 암호문 블록으로 바꿉니다." },
      { startMs: 11_000, endMs: 16_500, text: "CBC 모드는 앞 블록의 암호문을 섞으므로 초기화 벡터가 필요합니다." },
      { startMs: 16_500, endMs: 23_500, text: "기말시험 범위는 운영 모드까지이고 CBC 복호화 그림이 꼭 나옵니다." },
    ],
    markdown: `# 정보보호 7주차 — 블록 암호 운영 모드

## 운영 모드
[00:03] ECB 모드는 같은 평문 블록을 같은 암호문 블록으로 바꾸기 때문에 패턴이 그대로 드러나 위험하다.
[00:09] CBC 모드는 앞 블록의 암호문을 다음 평문에 섞으므로 초기화 벡터가 필요하고, 초기화 벡터는 예측할 수 없어야 한다.

## 시험
[00:17] 기말시험 범위는 운영 모드까지이고 CBC 복호화 그림이 꼭 나온다.
`,
  },
  {
    title: "주간 제품 회의 — 출시 일정",
    course: "업무",
    audioSeconds: 12,
    markdown: `# 주간 제품 회의 — 출시 일정

## 결정
- [00:02] 출시일은 11월 3일로 확정했다.
- [00:06] QA 기간을 일주일 앞당기기로 했다.
`,
  },
];
