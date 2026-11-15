// Suggested questions for 물어보기 (GET /ask/suggestions, D-P2-4): built from rules, with no
// model call and no database read, so the route answers whether or not LECTERN_ASK is on.
// The sentences are fixed by the P2-01 spec; change them together with its tests.

export const MAX_SUGGESTIONS = 6;
const TITLE_MAX = 30;

const BY_DOMAIN: Record<string, readonly string[]> = {
  lecture: ["이 강의의 핵심 내용을 요약해 줘.", "시험에 나올 만한 내용은 뭐야?", "중요한 용어를 정리해 줘."],
  meeting: ["이 회의에서 결정된 것은 뭐야?", "내가 해야 할 일은 뭐야?", "다음 일정이 언급됐어?"],
  seminar: ["발표의 핵심 주장은 뭐야?", "질의응답에서 나온 내용을 정리해 줘.", "소개된 참고 자료가 있어?"],
  interview: ["인터뷰 대상자의 핵심 답변을 정리해 줘.", "인상적인 발언을 인용해 줘.", "후속 질문으로 무엇을 할 수 있을까?"],
};
BY_DOMAIN.one_on_one = BY_DOMAIN.meeting!;
BY_DOMAIN.call = BY_DOMAIN.meeting!;

const OTHER = ["이 녹음의 핵심 내용을 요약해 줘.", "할 일이나 일정이 있어?", "중요한 결정이나 결론은 뭐야?"];
const FOLDER = ["이 폴더의 녹음들을 한눈에 요약해 줘.", "이 폴더에서 해야 할 일을 모아 줘."];
const WORKSPACE = ["최근 녹음에서 해야 할 일은 뭐야?", "이번 주 일정과 관련된 내용을 찾아 줘.", "가장 최근 녹음을 요약해 줘."];

function sectionQuestion(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const chars = [...trimmed];
  const shown = chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join("")}…` : trimmed;
  return `「${shown}」 부분을 자세히 설명해 줘.`;
}

export function buildSuggestions(input: { scope: "recording" | "folder" | "workspace"; domain?: string; sectionTitles?: string[] }): string[] {
  const out: string[] = [];
  const add = (question: string | null) => {
    if (question && !out.includes(question)) out.push(question);
  };
  if (input.scope === "folder") FOLDER.forEach(add);
  else if (input.scope === "workspace") WORKSPACE.forEach(add);
  else {
    (BY_DOMAIN[input.domain ?? ""] ?? OTHER).forEach(add);
    for (const title of input.sectionTitles ?? []) add(sectionQuestion(title));
  }
  return out.slice(0, MAX_SUGGESTIONS);
}
