// Chips under the 물어보기 composer: what is worth asking about a scope. The server's list
// (GET /ask/suggestions, D-P2-4) comes first; when it is missing or fails, they are made
// here from what the screen already has: the kind of note, its extracted questions
// (deprecated, often none) and the latest note in a wider scope.

import type { AskScope, Question, RecordingListItem } from "../api/types.ts";

export function askSuggestions({
  scope,
  recordings,
  questions = [],
}: {
  scope: AskScope;
  /** Processed recordings of the workspace (any order). */
  recordings: RecordingListItem[];
  /** Questions of the recording, for a recording scope. */
  questions?: Question[];
}): string[] {
  if (scope.kind === "recording") {
    const rec = recordings.find((r) => r.id === scope.recording_id);
    const fromQuestions = questions
      .filter((q) => q.answer)
      .slice(0, 2)
      .map((q) => q.prompt);
    const base =
      rec?.domain === "meeting" || rec?.domain === "interview"
        ? ["결정된 사항은?", "누가 무엇을 맡았어?"]
        : rec?.domain === "lecture"
          ? ["핵심 내용을 요약해 줘", "시험이나 과제 관련 내용은?"]
          : ["핵심 내용을 요약해 줘", "해야 할 일이 있었어?"];
    return [...base, ...fromQuestions].slice(0, 4);
  }
  const inScope = scope.kind === "folder" ? recordings.filter((r) => r.folder_id !== null) : recordings;
  const latest = [...inScope].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const out = [scope.kind === "folder" ? "이 폴더 노트들의 핵심을 요약해 줘" : "다가오는 마감과 일정을 정리해 줘", "해야 할 일을 모아 줘"];
  if (inScope.some((r) => r.domain === "meeting")) out.push("최근 회의에서 결정된 사항은?");
  if (latest && scope.kind === "workspace") out.push(`‘${latest.title}’ 핵심 요약`);
  return out.slice(0, 4);
}

/** The server's suggestions when it gave any (at most six), otherwise the screen's own. */
export function pickSuggestions(remote: string[] | undefined, fallback: string[]): string[] {
  return remote && remote.length > 0 ? remote.slice(0, 6) : fallback;
}
