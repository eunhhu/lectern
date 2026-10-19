// The 물어보기 conversation, shared by the 물어보기 screen and the "이 노트에 물어보기"
// panel: questions and streaming answers, `[c1]` citation markers as small numbered marks
// with a preview, the source list under each answer, copy, and the ways a turn can end:
// answered, 근거 없음 (`no_answer`), answered without a valid source (`unsupported`,
// collapsed behind a warning), failed, stopped, or 준비 중 (the server has no 물어보기
// yet). The composer sends with Enter (never while a Korean IME is composing) and adds a
// line with Shift+Enter.

import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, Form, Popover, PreviewTrigger, TextArea, TextField } from "react-aria-components";
import type { AskCitation } from "../../api/types.ts";
import { isImeComposing } from "../../lib/keyboard.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ErrorBox, NotReady, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { citationName, citationNumber, citationStartMs, citationWhere } from "./citations.ts";
import type { AskSession, AskTurnView } from "./session.ts";
import s from "./ask.module.css";

export interface AskConversationProps {
  session: AskSession;
  /** Sends the question with the scope chosen around the conversation. */
  onAsk: (question: string) => void;
  suggestions: string[];
  /** Above the composer: the scope picker. */
  scopeControl?: ReactNode;
  /** A citation was pressed (inline mark or source list in the panel). */
  onCitation: (citation: AskCitation) => void;
  /** Source list entries are links to the recording (the 물어보기 screen) instead of buttons. */
  linkSources?: boolean;
  /** Offered when nothing was found in a narrower scope. */
  onWiden?: (question: string) => void;
  empty: { title: string; text: string };
  compact?: boolean;
  /** Focus the composer when shown. */
  autoFocus?: boolean;
  composerLabel?: string;
}

export function AskConversation(props: AskConversationProps) {
  const { session, onAsk, suggestions, scopeControl, empty, compact, autoFocus, composerLabel = "질문" } = props;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = session.turns.at(-1);

  // Keep the newest answer in view while it streams, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [last?.text, last?.phase, session.turns.length]);

  const submit = (text = draft) => {
    if (!text.trim() || session.busy) return;
    onAsk(text);
    setDraft("");
    stick.current = true;
  };

  return (
    <div className={s.conversation} data-compact={compact || undefined}>
      <div
        ref={scrollRef}
        className={s.scroll}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {session.turns.length === 0 ? (
          <div className={s.empty}>
            <span className={s.emptyIcon} aria-hidden="true">
              <Icon name="spark" size={20} />
            </span>
            <p className={s.emptyTitle}>{empty.title}</p>
            <p className={s.emptyText}>{empty.text}</p>
            {suggestions.length > 0 && (
              <ul className={s.suggestions} role="list" aria-label="추천 질문">
                {suggestions.map((q) => (
                  <li key={q}>
                    <AriaButton className={s.suggestion} onPress={() => submit(q)} isDisabled={session.busy}>
                      {q}
                    </AriaButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ol className={s.turns} role="list" aria-label="대화">
            {session.turns.map((turn) => (
              <Turn key={turn.key} turn={turn} {...props} />
            ))}
          </ol>
        )}
      </div>
      <Form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {scopeControl}
        <div className={s.inputRow}>
          <TextField className={s.field} aria-label={composerLabel} value={draft} onChange={setDraft} autoFocus={autoFocus}>
            <TextArea
              className={s.textarea}
              rows={1}
              placeholder="노트에 물어보세요…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e.nativeEvent)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </TextField>
          {session.busy ? (
            <Button variant="secondary" icon="stop" iconOnly aria-label="답 멈추기" onPress={session.stop} />
          ) : (
            <Button type="submit" variant="primary" icon="send" iconOnly aria-label="보내기" isDisabled={!draft.trim()} />
          )}
        </div>
        <p className={s.composerHint}>Enter로 보내기, Shift+Enter로 줄 바꿈. 답은 고른 범위의 노트에서만 찾고, 근거를 번호로 붙입니다.</p>
      </Form>
    </div>
  );
}

function RetrievalStatus({ turn }: { turn: AskTurnView }) {
  if (turn.phase === "searching" || (turn.phase === "pending" && !turn.text)) {
    return (
      <p className={s.status}>
        <span className={uiStyles.spinner} aria-hidden="true" />
        {turn.phase === "pending" ? "저장된 답을 불러오는 중…" : "노트에서 찾는 중…"}
      </p>
    );
  }
  if (turn.tool) {
    return (
      <p className={s.status}>
        <span className={uiStyles.spinner} aria-hidden="true" />
        노트를 더 찾는 중…
      </p>
    );
  }
  const used = turn.citations.length;
  if (turn.retrieval && (turn.phase === "streaming" || turn.phase === "completed" || turn.phase === "stopped")) {
    return (
      <p className={s.status}>
        노트 {turn.retrieval.recordings}개에서 찾음{used > 0 && ` · 출처 ${used}개`}
      </p>
    );
  }
  if (turn.phase === "completed" && used > 0) return <p className={s.status}>출처 {used}개</p>;
  return null;
}

function Turn({ turn, session, onCitation, linkSources, onWiden }: { turn: AskTurnView } & AskConversationProps) {
  const streaming = turn.phase === "searching" || turn.phase === "streaming";
  const finished = turn.phase === "completed" || turn.phase === "stopped";
  const [showUnsupported, setShowUnsupported] = useState(false);
  const answered = turn.phase !== "completed" || turn.outcome === "answered";
  return (
    <li className={s.turn}>
      <p className={s.question}>
        <span className="visually-hidden">질문: </span>
        {turn.question}
      </p>
      <div className={s.answer} aria-busy={streaming || turn.phase === "pending" || undefined}>
        <span className="visually-hidden">답변: </span>
        <RetrievalStatus turn={turn} />

        {turn.phase === "not_ready" ? (
          <NotReady title="물어보기는 아직 준비 중입니다">이 서버에서 물어보기가 켜지면 여기서 바로 답합니다.</NotReady>
        ) : turn.phase === "completed" && turn.outcome === "no_answer" ? (
          <div className={s.noEvidence} role="note">
            <Icon name="search" />
            <div>
              <p className={s.noEvidenceTitle}>관련 내용을 찾지 못했습니다</p>
              {turn.text && <p>{plainAnswer(turn.text)}</p>}
              {onWiden && turn.scope.kind !== "workspace" && (
                <Button size="sm" onPress={() => onWiden(turn.question)} isDisabled={session.busy}>
                  전체 노트에서 다시 묻기
                </Button>
              )}
            </div>
          </div>
        ) : turn.phase === "completed" && turn.outcome === "unsupported" ? (
          <div className={s.unsupported} role="note">
            <p className={s.unsupportedTitle}>
              <Icon name="alert" />
              출처를 확인하지 못한 답입니다
            </p>
            <p>노트의 어느 부분에서 나온 말인지 확인되지 않았습니다. 그대로 믿기 전에 노트를 직접 확인하세요.</p>
            <Button size="sm" variant="ghost" aria-expanded={showUnsupported} onPress={() => setShowUnsupported((v) => !v)}>
              {showUnsupported ? "답 숨기기" : "답 보기"}
            </Button>
            {showUnsupported && <AnswerText text={turn.text} citations={turn.citations} onCitation={onCitation} />}
          </div>
        ) : turn.phase === "failed" || turn.phase === "error" ? (
          <ErrorBox title="답을 받지 못했습니다." onRetry={() => session.retry(turn.key)}>
            {turn.error?.message}
            {turn.phase === "error" && turn.turnId && (
              <>
                {" "}
                <Button size="sm" variant="ghost" onPress={() => session.recover(turn.key)}>
                  저장된 답 불러오기
                </Button>
              </>
            )}
          </ErrorBox>
        ) : (
          turn.text && <AnswerText text={turn.text} citations={turn.citations} onCitation={onCitation} streaming={streaming} />
        )}

        {turn.phase === "stopped" && (
          <div className={s.stopped}>
            <p>답을 멈췄습니다. 서버는 이 답을 끝까지 만들어 대화 기록에 남깁니다.</p>
            {turn.turnId && (
              <Button size="sm" variant="ghost" onPress={() => session.recover(turn.key)}>
                끝까지 만든 답 보기
              </Button>
            )}
          </div>
        )}

        {finished && answered && turn.citations.length > 0 && <Sources citations={turn.citations} onCitation={onCitation} link={linkSources} />}

        {finished && answered && turn.text && (
          <div className={s.answerActions}>
            <Button size="sm" variant="ghost" icon="copy" onPress={() => void copyAnswer(turn)}>
              답 복사
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

const MARKER = /(\[c\d{1,3}\]|\*\*)/;
/** A marker still arriving at the end of a streamed piece (`[c`, `[c1`). */
const PARTIAL_MARKER = /\[c?\d{0,3}$/;

/** The answer as plain text: markers and bold marks removed (for the 근거 없음 note). */
function plainAnswer(text: string): string {
  return text
    .replace(/\[\[모름\]\]\s*/g, "")
    .replace(/\[c\d{1,3}\]/g, "")
    .replaceAll("**", "")
    .trim();
}

/** Answer text: paragraphs, "- " bullets, **bold** and `[c1]` citation marks. */
export function AnswerText({ text, citations, onCitation, streaming }: { text: string; citations: AskCitation[]; onCitation: (c: AskCitation) => void; streaming?: boolean }) {
  const shown = streaming ? text.replace(PARTIAL_MARKER, "") : text;
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of shown.split("\n")) {
    const list = line.startsWith("- ");
    const prev = blocks.at(-1);
    if (prev && prev.list && list) prev.lines.push(line.slice(2));
    else blocks.push({ list, lines: [list ? line.slice(2) : line] });
  }
  const caret = streaming ? <span className={s.caret} aria-hidden="true" /> : null;
  return (
    <div className={s.answerText}>
      {blocks.map((block, bi) => {
        const isLast = bi === blocks.length - 1;
        if (block.list) {
          return (
            <ul key={bi} className={s.answerList}>
              {block.lines.map((line, li) => (
                <li key={li}>
                  <Inline text={line} citations={citations} onCitation={onCitation} />
                  {isLast && li === block.lines.length - 1 && caret}
                </li>
              ))}
            </ul>
          );
        }
        return block.lines[0] ? (
          <p key={bi}>
            <Inline text={block.lines[0]} citations={citations} onCitation={onCitation} />
            {isLast && caret}
          </p>
        ) : null;
      })}
    </div>
  );
}

function Inline({ text, citations, onCitation }: { text: string; citations: AskCitation[]; onCitation: (c: AskCitation) => void }) {
  // `**` toggles bold, so a bold run still streaming in renders bold already.
  let bold = false;
  return (
    <>
      {text.split(MARKER).map((part, i) => {
        if (part === "**") {
          bold = !bold;
          return null;
        }
        const label = /^\[(c\d{1,3})\]$/.exec(part)?.[1];
        if (label) {
          // The server strips markers it did not provide; one without a citation (yet) is not drawn.
          const c = citations.find((x) => x.label === label);
          return c ? <CitationMark key={i} citation={c} onPress={() => onCitation(c)} /> : null;
        }
        if (!part) return null;
        return bold ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function CitationPreview({ citation }: { citation: AskCitation }) {
  const where = citationWhere(citation);
  return (
    <>
      <p className={s.previewTitle}>{citation.recording_title}</p>
      {where && <p className={s.previewMeta}>{where}</p>}
      {citation.snippet && <p className={s.previewQuote}>“{citation.snippet}”</p>}
      {citation.support === "weak" && <p className={s.weakNote}>답의 문장이 이 부분과 잘 맞지 않습니다. 직접 확인하세요.</p>}
      <p className={uiStyles.hint}>누르면 이 부분으로 이동합니다.</p>
    </>
  );
}

function CitationMark({ citation, onPress }: { citation: AskCitation; onPress: () => void }) {
  if (!citation.available) {
    return (
      <span className={s.mark} data-unavailable="true" role="img" aria-label={citationName(citation)} title="지금은 볼 수 없는 출처">
        {citationNumber(citation)}
      </span>
    );
  }
  return (
    <PreviewTrigger delay={400}>
      <AriaButton className={s.mark} data-weak={citation.support === "weak" || undefined} aria-label={citationName(citation)} onPress={onPress}>
        {citationNumber(citation)}
      </AriaButton>
      <Popover className={`${uiStyles.popover} ${s.preview}`} placement="top">
        <CitationPreview citation={citation} />
      </Popover>
    </PreviewTrigger>
  );
}

function Sources({ citations, onCitation, link }: { citations: AskCitation[]; onCitation: (c: AskCitation) => void; link?: boolean }) {
  return (
    <div className={s.sources}>
      <p className={s.sourcesTitle}>출처</p>
      <ol className={s.sourceList} role="list">
        {citations.map((c) => {
          const where = citationWhere(c);
          const body = (
            <>
              <span className={s.sourceN} aria-hidden="true">
                {citationNumber(c)}
              </span>
              <span className={s.sourceBody}>
                <span className={s.sourceTitle}>{c.recording_title}</span>
                <span className={s.sourceMeta}>
                  {where}
                  {c.support === "weak" && <span className={s.weakBadge}> · 근거 약함</span>}
                  {!c.available && " · 지금은 볼 수 없음"}
                </span>
                {c.snippet && <span className={s.sourceQuote}>“{c.snippet}”</span>}
              </span>
            </>
          );
          const label = citationName(c);
          if (!c.available) {
            return (
              <li key={c.label}>
                <div className={s.source} data-unavailable="true" role="group" aria-label={label}>
                  {body}
                </div>
              </li>
            );
          }
          const t = citationStartMs(c);
          return (
            <li key={c.label}>
              {link ? (
                <Link
                  className={s.source}
                  to="/recordings/$recordingId"
                  params={{ recordingId: c.recording_id }}
                  search={t !== null ? { t } : {}}
                  aria-label={label}
                >
                  {body}
                </Link>
              ) : (
                <AriaButton className={s.source} aria-label={label} onPress={() => onCitation(c)}>
                  {body}
                </AriaButton>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

async function copyAnswer(turn: AskTurnView) {
  const sources = turn.citations.map((c) => `[${citationNumber(c)}] ${c.recording_title} ${citationWhere(c)}${c.snippet ? ` “${c.snippet}”` : ""}`);
  const body = turn.text.replace(/\[(c\d{1,3})\]/g, (_, label: string) => `[${label.slice(1)}]`).replaceAll("**", "");
  const text = [body, sources.length ? `\n출처\n${sources.join("\n")}` : ""].join("\n").trim();
  try {
    await navigator.clipboard.writeText(text);
    showToast({ title: "답을 복사했습니다." });
  } catch {
    showToast({ title: "복사하지 못했습니다.", description: "브라우저가 클립보드 접근을 막았습니다.", tone: "danger" });
  }
}
