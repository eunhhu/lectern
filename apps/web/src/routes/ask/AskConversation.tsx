// The 물어보기 conversation, shared by the 물어보기 screen and the "이 노트에 물어보기"
// panel: questions and streaming answers, `[n]` citations as small marks with a preview,
// the numbered source list under each answer, copy, and the states an answer can end in
// (근거 없음, 오류, 멈춤). The composer sends with Enter (never while a Korean IME is
// composing) and adds a line with Shift+Enter.

import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, Form, Popover, PreviewTrigger, TextArea, TextField } from "react-aria-components";
import type { AskCitation } from "../../api/types.ts";
import { formatTimestamp } from "../../lib/format.ts";
import { isImeComposing } from "../../lib/keyboard.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ErrorBox, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import type { AskSession, AskTurn } from "./session.ts";
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
  }, [last?.text, last?.status, session.turns.length]);

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
              <Turn key={turn.id} turn={turn} {...props} />
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

function Turn({ turn, session, onCitation, linkSources, onWiden }: { turn: AskTurn } & AskConversationProps) {
  const streaming = turn.status === "searching" || turn.status === "streaming";
  return (
    <li className={s.turn}>
      <p className={s.question}>
        <span className="visually-hidden">질문: </span>
        {turn.question}
      </p>
      <div className={s.answer} aria-busy={streaming || undefined}>
        <span className="visually-hidden">답변: </span>
        {turn.status === "searching" ? (
          <p className={s.status}>
            <span className={uiStyles.spinner} aria-hidden="true" />
            노트에서 찾는 중…
          </p>
        ) : turn.status === "streaming" || turn.status === "complete" || turn.status === "stopped" ? (
          <p className={s.status}>
            노트 {turn.searched}개에서 찾음{turn.citations.length > 0 && ` · 출처 ${turn.citations.length}개`}
          </p>
        ) : null}

        {turn.status === "no_evidence" ? (
          <div className={s.noEvidence} role="note">
            <Icon name="search" />
            <div>
              <p className={s.noEvidenceTitle}>관련 내용을 찾지 못했습니다</p>
              <p>{turn.text}</p>
              {onWiden && turn.scope.kind !== "workspace" && (
                <Button size="sm" onPress={() => onWiden(turn.question)} isDisabled={session.busy}>
                  전체 노트에서 다시 묻기
                </Button>
              )}
            </div>
          </div>
        ) : turn.status === "error" ? (
          <ErrorBox title="답을 받지 못했습니다." onRetry={() => session.retry(turn.id)}>
            {turn.error}
          </ErrorBox>
        ) : (
          turn.text && <AnswerText text={turn.text} citations={turn.citations} onCitation={onCitation} streaming={streaming} />
        )}

        {turn.status === "stopped" && <p className={s.stopped}>답을 멈췄습니다. 같은 질문을 다시 보내면 처음부터 답합니다.</p>}

        {(turn.status === "complete" || turn.status === "stopped") && turn.citations.length > 0 && (
          <Sources citations={turn.citations} onCitation={onCitation} link={linkSources} />
        )}

        {(turn.status === "complete" || turn.status === "stopped") && turn.text && (
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

/** Answer text: paragraphs, "- " bullets, **bold** and `[n]` citation marks. */
export function AnswerText({ text, citations, onCitation, streaming }: { text: string; citations: AskCitation[]; onCitation: (c: AskCitation) => void; streaming?: boolean }) {
  const lines = text.split("\n");
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of lines) {
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
      {text.split(/(\[\d+\]|\*\*)/).map((part, i) => {
        if (part === "**") {
          bold = !bold;
          return null;
        }
        const n = /^\[(\d+)\]$/.exec(part);
        if (n) {
          const c = citations.find((x) => x.n === Number(n[1]));
          return c ? <CitationMark key={i} citation={c} onPress={() => onCitation(c)} /> : null;
        }
        if (!part) return null;
        return bold ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function CitationMark({ citation, onPress }: { citation: AskCitation; onPress: () => void }) {
  const ts = formatTimestamp(citation.start_ms);
  return (
    <PreviewTrigger delay={400}>
      <AriaButton className={s.mark} aria-label={`출처 ${citation.n}, ${citation.recording_title} ${ts}`} onPress={onPress}>
        {citation.n}
      </AriaButton>
      <Popover className={`${uiStyles.popover} ${s.preview}`} placement="top">
        <p className={s.previewTitle}>{citation.recording_title}</p>
        <p className={s.previewMeta}>
          {ts}
          {citation.speaker && ` · ${citation.speaker}`}
        </p>
        <p className={s.previewQuote}>“{citation.quote}”</p>
        <p className={uiStyles.hint}>누르면 이 구간으로 이동합니다.</p>
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
          const body = (
            <>
              <span className={s.sourceN} aria-hidden="true">
                {c.n}
              </span>
              <span className={s.sourceBody}>
                <span className={s.sourceTitle}>{c.recording_title}</span>
                <span className={s.sourceMeta}>
                  {formatTimestamp(c.start_ms)}
                  {c.speaker && ` · ${c.speaker}`}
                </span>
                <span className={s.sourceQuote}>“{c.quote}”</span>
              </span>
            </>
          );
          const label = `출처 ${c.n}: ${c.recording_title} ${formatTimestamp(c.start_ms)}${c.speaker ? `, ${c.speaker}` : ""}`;
          return (
            <li key={c.n}>
              {link ? (
                <Link className={s.source} to="/recordings/$recordingId" params={{ recordingId: c.recording_id }} search={{ t: c.start_ms }} aria-label={label}>
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

async function copyAnswer(turn: AskTurn) {
  const sources = turn.citations.map((c) => `[${c.n}] ${c.recording_title} ${formatTimestamp(c.start_ms)} “${c.quote}”`);
  const text = [turn.text.replaceAll("**", ""), sources.length ? `\n출처\n${sources.join("\n")}` : ""].join("\n").trim();
  try {
    await navigator.clipboard.writeText(text);
    showToast({ title: "답을 복사했습니다." });
  } catch {
    showToast({ title: "복사하지 못했습니다.", description: "브라우저가 클립보드 접근을 막았습니다.", tone: "danger" });
  }
}
