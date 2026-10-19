// 복습 (ARCHITECTURE §7): active-recall cards from lectures and issue / discussion
// prompts from meetings, gathered from processed recordings. One card at a time: read the
// question, reveal the answer (Space), say whether you knew it (1 다시 볼래요 / 2 알았어요),
// move with ←/→. Sources jump to the moment in the recording. Results live for this visit
// only until the domain has review progress (README "domain 요청").

import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { useTranscript, useWorkspaceQuestions } from "../../api/queries.ts";
import type { Question, RecordingListItem } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { insideDialog } from "../../app/GlobalShortcuts.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatTimestamp } from "../../lib/format.ts";
import { isImeComposing, isTypingTarget } from "../../lib/keyboard.ts";
import { resolveSourceRange } from "../../lib/segments.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, EmptyState, Kbd, SelectField, Spinner } from "../../ui/controls.tsx";
import { announce } from "../../ui/toast.tsx";
import layout from "../../app/layout.module.css";
import s from "./review.module.css";

type Card = { question: Question; recording: RecordingListItem };
type Result = "again" | "known";

const KIND_LABEL: Record<string, string> = { recall: "질문 카드", issue: "쟁점", discussion: "토론" };
const DIFFICULTY: Record<string, { label: string; tone: "success" | "attention" | "danger" }> = {
  easy: { label: "쉬움", tone: "success" },
  medium: { label: "보통", tone: "attention" },
  hard: { label: "어려움", tone: "danger" },
};

export function ReviewPage() {
  usePageTitle("복습");
  const { workspaceId } = useWorkspace();
  const all = useWorkspaceQuestions(workspaceId);
  const [deck, setDeck] = useState("all");
  const [source, setSource] = useState("all");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [onlyAgain, setOnlyAgain] = useState(false);

  const cards: Card[] = useMemo(() => {
    const list = (all.data ?? []).filter(
      (c) =>
        (deck === "all" || (deck === "recall" ? c.question.kind === "recall" : c.question.kind !== "recall")) &&
        (source === "all" || c.recording.id === source),
    );
    return onlyAgain ? list.filter((c) => results[c.question.id] === "again") : list;
  }, [all.data, deck, source, onlyAgain, results]);

  const recordings = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of all.data ?? []) seen.set(c.recording.id, c.recording.title);
    return [...seen].map(([id, label]) => ({ id, label }));
  }, [all.data]);

  const card = cards[index];
  const finished = cards.length > 0 && index >= cards.length;
  const known = cards.filter((c) => results[c.question.id] === "known").length;
  const again = cards.filter((c) => results[c.question.id] === "again").length;

  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(cards.length, next)));
    setRevealed(false);
  };
  const reveal = () => {
    setRevealed(true);
    announce(card?.question.answer ? "정답을 펼쳤습니다." : "정해진 답이 없는 쟁점입니다.");
  };
  const rate = (result: Result) => {
    if (!card) return;
    setResults((prev) => ({ ...prev, [card.question.id]: result }));
    go(index + 1);
  };
  const restart = (again: boolean) => {
    setOnlyAgain(again);
    setIndex(0);
    setRevealed(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isImeComposing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as Element | null;
      if (isTypingTarget(target) || insideDialog(target)) return;
      // Space and Enter on a focused control belong to that control.
      const onControl = target?.closest?.('button, a, [role="button"], [role="option"], [role="menuitem"], [role="tab"]');
      if ((e.key === " " || e.key === "Enter") && onControl) return;
      if (!card) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealed) reveal();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (revealed && e.key === "1") {
        e.preventDefault();
        rate("again");
      } else if (revealed && e.key === "2") {
        e.preventDefault();
        rate("known");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className={s.layout}>
      <section className={s.main} aria-labelledby="review-title">
        <header className={layout.pageHeader}>
          <h1 id="review-title" className={layout.pageTitle}>
            복습
          </h1>
          <div className={s.filters}>
            <SelectField
              label="카드 종류"
              items={[
                { id: "all", label: "모든 카드" },
                { id: "recall", label: "강의 질문 카드" },
                { id: "meeting", label: "회의 쟁점·토론" },
              ]}
              selectedKey={deck}
              onSelectionChange={(k) => {
                setDeck(k);
                restart(false);
              }}
            />
            <SelectField
              label="녹음"
              items={[{ id: "all", label: "모든 녹음" }, ...recordings]}
              selectedKey={source}
              onSelectionChange={(k) => {
                setSource(k);
                restart(false);
              }}
            />
          </div>
        </header>

        {all.isPending ? (
          <div className={s.center}>
            <Spinner label="카드를 불러오는 중…" />
          </div>
        ) : cards.length === 0 ? (
          <EmptyState icon="review" title={onlyAgain ? "다시 볼 카드가 없습니다." : "복습할 카드가 없습니다."} action={onlyAgain ? <Button onPress={() => restart(false)}>처음부터</Button> : undefined}>
            {onlyAgain ? "모두 알았다고 표시했습니다." : "처리가 끝난 강의와 회의에서 질문 카드가 만들어집니다."}
          </EmptyState>
        ) : finished ? (
          <div className={s.done} role="status">
            <Icon name="check" size={28} />
            <p className={s.doneTitle}>카드 {cards.length}장을 모두 봤습니다.</p>
            <p className={s.doneStats}>
              알았어요 {known} · 다시 볼래요 {again} · 표시 안 함 {cards.length - known - again}
            </p>
            <div className={s.doneActions}>
              {again > 0 && (
                <Button variant="primary" onPress={() => restart(true)}>
                  다시 볼 카드만 ({again})
                </Button>
              )}
              <Button onPress={() => restart(false)}>처음부터</Button>
            </div>
          </div>
        ) : (
          card && (
            <CardView
              key={card.question.id}
              card={card}
              position={index + 1}
              total={cards.length}
              revealed={revealed}
              onReveal={reveal}
              onRate={rate}
              onPrev={() => go(index - 1)}
              onNext={() => go(index + 1)}
            />
          )
        )}
      </section>

      {cards.length > 0 && (
        <aside className={s.rail} aria-labelledby="review-list">
          <h2 id="review-list" className={s.railTitle}>
            카드 {cards.length}장
          </h2>
          <ol className={s.cardList} role="list">
            {cards.map((c, i) => {
              const r = results[c.question.id];
              return (
                <li key={c.question.id}>
                  <AriaButton
                    className={s.cardListItem}
                    data-current={i === index || undefined}
                    aria-current={i === index ? "step" : undefined}
                    onPress={() => go(i)}
                  >
                    <span className={s.cardListDot} data-result={r} aria-hidden="true" />
                    <span className={s.cardListText}>{c.question.prompt}</span>
                    <span className="visually-hidden">{r === "known" ? "(알았어요)" : r === "again" ? "(다시 볼래요)" : ""}</span>
                  </AriaButton>
                </li>
              );
            })}
          </ol>
        </aside>
      )}
    </div>
  );
}

function CardView({
  card,
  position,
  total,
  revealed,
  onReveal,
  onRate,
  onPrev,
  onNext,
}: {
  card: Card;
  position: number;
  total: number;
  revealed: boolean;
  onReveal: () => void;
  onRate: (r: Result) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const q = card.question;
  const difficulty = q.difficulty ? DIFFICULTY[q.difficulty] : null;
  return (
    <article className={s.card} aria-labelledby="card-prompt" aria-roledescription="복습 카드">
      <div className={s.cardTop}>
        <span className={s.position}>
          {position} / {total}
        </span>
        <span className={s.progress} aria-hidden="true">
          <span className={s.progressFill} ref={(el) => el?.style.setProperty("width", `${(position / total) * 100}%`)} />
        </span>
      </div>
      <p className={s.cardMeta}>
        <Badge tone={q.kind === "recall" ? "accent" : "info"}>{KIND_LABEL[q.kind] ?? "카드"}</Badge>
        {difficulty && (
          <Badge tone={difficulty.tone} dot>
            난이도 {difficulty.label}
          </Badge>
        )}
        {q.flags.includes("low_confidence") && <Badge tone="attention">출처 확인 필요</Badge>}
        <Link to="/recordings/$recordingId" params={{ recordingId: card.recording.id }} className={s.recordingLink}>
          {card.recording.title}
        </Link>
      </p>
      <h2 id="card-prompt" className={s.prompt}>
        {q.prompt}
      </h2>

      {revealed ? (
        <div className={s.answer}>
          <h3 className={s.answerLabel}>{q.answer ? "정답" : "아직 결론이 없는 쟁점입니다"}</h3>
          {q.answer ? <p className={s.answerText}>{q.answer}</p> : <p className={s.answerText}>회의에서 나온 근거를 보고 직접 정리해 보세요.</p>}
          <Sources recordingId={card.recording.id} question={q} />
          <div className={s.rateRow}>
            <Button onPress={() => onRate("again")}>
              다시 볼래요 <Kbd keys={["1"]} />
            </Button>
            <Button variant="primary" onPress={() => onRate("known")}>
              알았어요 <Kbd keys={["2"]} />
            </Button>
          </div>
        </div>
      ) : (
        <div className={s.revealRow}>
          <Button variant="primary" size="lg" icon="flip" onPress={onReveal} autoFocus>
            정답 보기
          </Button>
          <span className={s.hint}>
            <Kbd keys={["Space"]} /> 정답 보기 · <Kbd keys={["←", "→"]} /> 이전·다음
          </span>
        </div>
      )}

      <div className={s.navRow}>
        <Button variant="ghost" icon="chevronLeft" onPress={onPrev} isDisabled={position === 1}>
          이전
        </Button>
        <Button variant="ghost" onPress={onNext}>
          {position === total ? "마치기" : "건너뛰기"} <Icon name="chevronRight" />
        </Button>
      </div>
    </article>
  );
}

/** Source chips: they need the transcript to turn segment ranges into times. */
function Sources({ recordingId, question }: { recordingId: string; question: Question }) {
  const transcript = useTranscript(recordingId, true);
  const segments = transcript.data?.segments ?? [];
  const refs = question.sources.filter((x) => x.kind === "transcript");
  if (!refs.length) return null;
  return (
    <p className={s.sources}>
      <span className={s.sourcesLabel}>출처</span>
      {refs.map((ref, i) => {
        if (ref.kind !== "transcript") return null;
        const range = resolveSourceRange(segments, ref);
        if (!range) return null;
        return (
          <Link
            key={i}
            to="/recordings/$recordingId"
            params={{ recordingId }}
            search={{ t: range.start_ms }}
            className={s.sourceChip}
            aria-label={`출처 ${formatTimestamp(range.start_ms)}, 녹음에서 듣기`}
          >
            {formatTimestamp(range.start_ms)}
          </Link>
        );
      })}
    </p>
  );
}
