// "이 노트에 물어보기": the 물어보기 conversation in the recording's side panel. A citation
// from this note opens the transcript at that moment (the conversation stays and one
// click brings it back); one from another note opens that recording.

import { useNavigate } from "@tanstack/react-router";
import { useAskSuggestions } from "../../api/queries.ts";
import type { AskCitation, AskScope, Recording } from "../../api/types.ts";
import { AskConversation } from "../ask/AskConversation.tsx";
import { NoteScopePicker } from "../ask/ScopePicker.tsx";
import type { AskSession } from "../ask/session.ts";
import { usePlayback } from "./playback.tsx";

export function AskPanel({
  recording,
  session,
  scope,
  onScopeChange,
  onJump,
  autoFocus,
}: {
  recording: Recording;
  session: AskSession;
  scope: AskScope;
  onScopeChange: (scope: AskScope) => void;
  /** A citation of this note opened the transcript. */
  onJump: () => void;
  autoFocus?: boolean;
}) {
  const navigate = useNavigate();
  const { jumpToRange } = usePlayback();
  const suggestions = useAskSuggestions(recording.workspace_id, scope).data ?? [];

  const openCitation = (c: AskCitation) => {
    if (c.recording_id === recording.id) {
      jumpToRange({ start_idx: c.start_idx, end_idx: c.end_idx });
      onJump();
    } else {
      void navigate({ to: "/recordings/$recordingId", params: { recordingId: c.recording_id }, search: { t: c.start_ms } });
    }
  };

  return (
    <AskConversation
      compact
      session={session}
      onAsk={(q) => session.send(q, scope)}
      suggestions={suggestions}
      scopeControl={<NoteScopePicker recordingId={recording.id} folderId={recording.folder_id} value={scope} onChange={onScopeChange} />}
      onCitation={openCitation}
      onWiden={(q) => {
        onScopeChange({ kind: "workspace" });
        session.send(q, { kind: "workspace" });
      }}
      empty={{ title: "이 노트에 물어보세요", text: "답은 이 녹음의 전사와 문서에서 찾고, 번호를 누르면 그 순간의 전사로 갑니다." }}
      composerLabel="이 노트에 질문"
      autoFocus={autoFocus}
    />
  );
}
