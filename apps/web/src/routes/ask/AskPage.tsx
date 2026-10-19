// 물어보기 (agent / RAG over the notes): ask across the workspace, a folder or one note and
// get an answer that cites the moments it came from. The conversation history is on the
// left; ⌘K and the home card open this screen with a question (?q=) and it asks at once.
// Answers stream from ApiClient.askQuestion (packages/domain/src/api/ask.ts). While the
// server has no 물어보기 (501), the screen says it is 준비 중 instead of failing.

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { isNotReady } from "../../api/errors.ts";
import { useAskSuggestions, useAskThread, useAskThreads, useFolders, useRecordings } from "../../api/queries.ts";
import { asId, type AskCitation, type AskScope } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatRelative } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, NotReady } from "../../ui/controls.tsx";
import { AskConversation } from "./AskConversation.tsx";
import { citationStartMs, scopeLabel } from "./citations.ts";
import { ScopePicker } from "./ScopePicker.tsx";
import { useAskSession } from "./session.ts";
import layout from "../../app/layout.module.css";
import s from "./ask.module.css";

export interface AskSearch {
  q?: string;
  scope?: "workspace" | "folder" | "recording";
  /** Folder or recording id for those scopes. */
  id?: string;
  thread?: string;
}

function scopeFromSearch(search: AskSearch): AskScope {
  if (search.scope === "folder" && search.id) return { kind: "folder", folder_id: asId(search.id), include_subfolders: true };
  if (search.scope === "recording" && search.id) return { kind: "recording", recording_id: asId(search.id) };
  return { kind: "workspace" };
}

const SCOPE_ICON = { workspace: "library", folder: "folder", recording: "audio" } as const;
const scopeIcon = (kind: string) => SCOPE_ICON[kind as keyof typeof SCOPE_ICON] ?? "spark";

export function AskPage() {
  usePageTitle("물어보기");
  const navigate = useNavigate();
  const search = useSearch({ from: "/ask" });
  const { workspaceId } = useWorkspace();
  const session = useAskSession(workspaceId);
  const threadsQuery = useAskThreads(workspaceId);
  const threads = threadsQuery.data ?? [];
  const notReady = isNotReady(threadsQuery.error);
  const folders = useFolders(workspaceId).data ?? [];
  const recordings = useRecordings(workspaceId).data ?? [];
  const detail = useAskThread(search.thread ?? null);
  const [scope, setScope] = useState<AskScope>(() => scopeFromSearch(search));
  const suggestions = useAskSuggestions(workspaceId, scope);
  const asked = useRef<string | null>(null);

  // ?q= from ⌘K or the home card: ask once, then drop it from the URL.
  useEffect(() => {
    if (!search.q || asked.current === search.q) return;
    asked.current = search.q;
    const fromSearch = scopeFromSearch(search);
    setScope(fromSearch);
    session.reset();
    session.send(search.q, fromSearch);
    void navigate({ to: "/ask", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q]);

  // ?thread= shows a saved conversation (unless it is the one on screen). A stored turn
  // that is still running is shown as pending and replaced when the thread is read again.
  useEffect(() => {
    if (!detail.data) return;
    const pending = session.turns.some((t) => t.phase === "pending");
    if (detail.data.thread.id !== session.threadId || pending) {
      session.load(detail.data);
      setScope(detail.data.thread.scope);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  // A new conversation gets its thread id once the first answer is saved.
  useEffect(() => {
    if (session.threadId && session.threadId !== search.thread) void navigate({ to: "/ask", search: { thread: session.threadId }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.threadId]);

  // Switching workspaces starts over.
  const lastWs = useRef(workspaceId);
  useEffect(() => {
    if (lastWs.current === workspaceId) return;
    lastWs.current = workspaceId;
    session.reset();
    setScope({ kind: "workspace" });
    void navigate({ to: "/ask", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const openCitation = (c: AskCitation) => {
    const t = citationStartMs(c);
    void navigate({ to: "/recordings/$recordingId", params: { recordingId: c.recording_id }, search: t !== null ? { t } : {} });
  };

  return (
    <div className={s.page}>
      <nav className={s.history} aria-labelledby="ask-history">
        <div className={s.historyHead}>
          <h2 id="ask-history" className={s.historyTitle}>
            대화 기록
          </h2>
          <Button
            size="sm"
            icon="plus"
            onPress={() => {
              session.reset();
              setScope({ kind: "workspace" });
              void navigate({ to: "/ask", search: {} });
            }}
          >
            새 대화
          </Button>
        </div>
        {notReady ? (
          <p className={s.historyEmpty}>물어보기가 준비되면 대화가 여기에 남습니다.</p>
        ) : threads.length === 0 ? (
          <p className={s.historyEmpty}>아직 대화가 없습니다.</p>
        ) : (
          <ul className={s.threadList} role="list">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={s.thread}
                  aria-current={t.id === session.threadId ? "true" : undefined}
                  onClick={() => void navigate({ to: "/ask", search: { thread: t.id } })}
                >
                  <span className={s.threadTitle}>{t.title}</span>
                  <span className={s.threadMeta}>
                    <Icon name={scopeIcon(t.scope.kind)} size={14} />
                    <span className={s.threadScope}>{scopeLabel(t.scope, folders, recordings)}</span> · {formatRelative(t.updated_at, new Date())}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section className={s.main} aria-labelledby="ask-title">
        <header className={`${layout.pageHeader} ${s.mainHeader}`}>
          <h1 id="ask-title" className={layout.pageTitle}>
            물어보기
          </h1>
        </header>
        {notReady && (
          <div className={s.notReady}>
            <NotReady title="물어보기는 아직 준비 중입니다">
              이 서버에서 물어보기가 아직 켜지지 않았습니다. 켜지면 녹음과 문서에서 답을 찾아 출처와 함께 보여 줍니다.
            </NotReady>
          </div>
        )}
        <AskConversation
          session={session}
          onAsk={(q) => session.send(q, scope)}
          suggestions={suggestions}
          scopeControl={<ScopePicker workspaceId={workspaceId} value={scope} onChange={setScope} />}
          onCitation={openCitation}
          linkSources
          onWiden={(q) => {
            setScope({ kind: "workspace" });
            session.send(q, { kind: "workspace" });
          }}
          empty={{ title: "노트에 물어보세요", text: "녹음한 강의·회의·메모에서 답을 찾아, 어느 순간에 나온 말인지 출처를 붙여 답합니다." }}
          autoFocus={!search.q && !search.thread}
        />
      </section>
    </div>
  );
}
