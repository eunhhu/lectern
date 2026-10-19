// 홈/수신함 (ARCHITECTURE §7): recordings in progress, recordings that need attention and
// 물어보기 (ask the notes, recent conversations) on the left; event suggestions to confirm and what is coming up on the
// right; recent documents below.

import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Form, Input, TextField } from "react-aria-components";
import {
  useAskThreads,
  useConfirmedEvents,
  useFolders,
  useDecideSuggestion,
  useJobProgress,
  useRecording,
  useRecordings,
  useSuggestions,
  useWorkspaceActionItems,
} from "../../api/queries.ts";
import type { EventCandidate, JobId, RecordingListItem } from "../../api/types.ts";
import { scopeLabel } from "../ask/citations.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { DOMAIN_LABEL, STATUS, stageLabel } from "../../app/labels.ts";
import { openOverlay } from "../../app/overlays.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatDate, formatDateTime, formatDuration, formatRelative, formatTimeOfDay } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, Dot, EmptyState, Progress } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import layout from "../../app/layout.module.css";
import s from "./inbox.module.css";

const BUSY = new Set(["uploading", "queued", "processing"]);
const EVENT_KIND: Record<string, string> = { deadline: "마감", exam: "시험", meeting: "회의", task: "할 일", other: "일정" };

export function InboxPage() {
  usePageTitle("홈");
  const { workspaceId, current } = useWorkspace();
  const recordings = useRecordings(workspaceId).data ?? [];
  const suggestions = useSuggestions(workspaceId).data ?? [];
  const now = useMemo(() => new Date(), []);

  const busy = recordings.filter((r) => BUSY.has(r.status));
  const attention = recordings.filter((r) => r.status === "failed" || r.status === "partial");
  const recent = recordings.filter((r) => r.status === "ready").slice(0, 6);

  return (
    <div className={layout.page}>
      <header className={layout.pageHeader}>
        <h1 className={layout.pageTitle}>홈</h1>
        <p className={s.workspace}>{current?.workspace.name} 워크스페이스</p>
        <div className={layout.pageActions}>
          <Button variant="primary" icon="upload" onPress={() => openOverlay("upload")}>
            녹음 올리기
          </Button>
        </div>
      </header>

      <div className={s.grid}>
        <div className={s.column}>
          <section className={s.card} aria-labelledby="inbox-busy">
            <h2 id="inbox-busy" className={s.cardTitle}>
              처리 중 <span className={s.count}>{busy.length}</span>
            </h2>
            {busy.length === 0 ? (
              <EmptyState icon="check" tone="success" title="처리 중인 녹음이 없습니다." />
            ) : (
              <ul className={s.rows} role="list" aria-busy={busy.length > 0}>
                {busy.map((r) => (
                  <BusyRow key={r.id} rec={r} />
                ))}
              </ul>
            )}
          </section>

          {attention.length > 0 && (
            <section className={s.card} aria-labelledby="inbox-attention">
              <h2 id="inbox-attention" className={s.cardTitle}>
                확인 필요 <span className={s.count}>{attention.length}</span>
              </h2>
              <ul className={s.rows} role="list">
                {attention.map((r) => (
                  <li key={r.id} className={s.row}>
                    <Icon name="alert" />
                    <div className={s.rowMain}>
                      <Link to="/recordings/$recordingId" params={{ recordingId: r.id }} className={s.rowLink}>
                        {r.title}
                      </Link>
                      <p className={s.rowMeta}>
                        {r.status === "failed" ? "처리하지 못했습니다. 녹음을 열어 원인을 확인하세요." : "일부 구간을 전사하지 못했습니다. 문서에 빠진 구간이 표시됩니다."}
                      </p>
                    </div>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AskCard />
        </div>
        <div className={s.column}>
          <section className={s.card} aria-labelledby="inbox-suggestions">
            <h2 id="inbox-suggestions" className={s.cardTitle}>
              확인할 일정 제안 <span className={s.count}>{suggestions.length}</span>
            </h2>
            {suggestions.length === 0 ? (
              <EmptyState icon="check" tone="success" title="확인할 일정 제안이 없습니다." />
            ) : (
              <ul className={s.rows} role="list">
                {suggestions.map((e) => (
                  <SuggestionRow key={e.id} event={e} recording={recordings.find((r) => r.id === e.recording_id)} now={now} />
                ))}
              </ul>
            )}
          </section>

          <UpcomingCard now={now} />
        </div>
      </div>

      <section className={s.recentSection} aria-labelledby="inbox-recent">
        <div className={s.sectionHead}>
          <h2 id="inbox-recent" className={s.sectionTitle}>
            최근 문서
          </h2>
          <Link to="/library" className={s.more}>
            라이브러리 전체 보기 <Icon name="chevronRight" size={14} />
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon="audio" title="아직 문서가 없습니다.">
            파일을 끌어다 놓거나 ‘녹음 올리기’를 누르세요.
          </EmptyState>
        ) : (
          <ul className={s.recent} role="list">
            {recent.map((r) => (
              <li key={r.id}>
                <Link to="/recordings/$recordingId" params={{ recordingId: r.id }} className={s.recentItem}>
                  <span className={s.recentKind}>{DOMAIN_LABEL[r.domain]}</span>
                  <span className={s.recentTitle}>{r.title}</span>
                  <span className={s.rowMeta} title={formatDateTime(r.recorded_at, now)}>
                    {formatRelative(r.recorded_at, now)}
                    {r.duration_ms ? ` · ${formatDuration(r.duration_ms)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BusyRow({ rec }: { rec: RecordingListItem }) {
  const job = useActiveJobId(rec.id);
  const progress = useJobProgress(job).data;
  const status = STATUS[rec.status];
  const label =
    rec.status === "uploading"
      ? "올리는 중…"
      : rec.status === "queued"
        ? "처리 대기 중…"
        : `${stageLabel(progress?.stage)}${progress?.progress != null ? ` · ${Math.round(progress.progress * 100)}%` : "…"}`;
  return (
    <li className={s.row}>
      <Dot tone={status.tone} live />
      <div className={s.rowMain}>
        <Link to="/recordings/$recordingId" params={{ recordingId: rec.id }} className={s.rowLink}>
          {rec.title}
        </Link>
        {rec.status === "processing" && progress?.progress != null ? (
          <Progress value={progress.progress} label={`${rec.title} 처리 진행률`} valueLabel={label} />
        ) : (
          <p className={s.rowMeta}>{label}</p>
        )}
      </div>
    </li>
  );
}

/** Job ids are exposed on RecordingDetail.active_job; the event stream keeps it fresh. */
function useActiveJobId(recordingId: string): JobId | null {
  return useRecording(recordingId).data?.active_job?.id ?? null;
}

function SuggestionRow({ event, recording, now }: { event: EventCandidate; recording: RecordingListItem | undefined; now: Date }) {
  const { workspaceId } = useWorkspace();
  const decide = useDecideSuggestion(workspaceId);
  const when = event.all_day ? formatDate(event.start_at, now) : `${formatDate(event.start_at, now)} ${formatTimeOfDay(event.start_at)}`;
  const run = async (status: "accepted" | "dismissed") => {
    await decide.mutateAsync({ id: event.id, status });
    showToast({
      title: status === "accepted" ? `‘${event.title}’ 일정을 추가했습니다.` : `‘${event.title}’ 제안을 무시했습니다.`,
      tone: status === "accepted" ? "success" : "neutral",
    });
  };
  return (
    <li className={s.row}>
      <Icon name="calendar" />
      <div className={s.rowMain}>
        <p className={s.rowTitle}>
          {event.title} <Badge>{EVENT_KIND[event.kind] ?? "일정"}</Badge>
          {event.flags.includes("needs_review") && <Badge tone="attention">날짜 확인 필요</Badge>}
        </p>
        <p className={s.rowMeta}>
          {when} · “{event.raw_expression}”
          {recording && (
            <>
              {" · "}
              <Link to="/recordings/$recordingId" params={{ recordingId: recording.id }} className={s.inlineLink}>
                {recording.title}
              </Link>
            </>
          )}
        </p>
      </div>
      <div className={s.actions}>
        <Button size="sm" onPress={() => run("dismissed")} aria-label={`무시: ${event.title}`}>
          무시
        </Button>
        <Button size="sm" variant="primary" onPress={() => run("accepted")} aria-label={`일정에 추가: ${event.title}`}>
          일정에 추가
        </Button>
      </div>
    </li>
  );
}

function UpcomingCard({ now }: { now: Date }) {
  const { workspaceId } = useWorkspace();
  const events = useConfirmedEvents(workspaceId).data ?? [];
  const items = useWorkspaceActionItems(workspaceId).data ?? [];
  const upcoming = [
    ...events.filter((e) => new Date(e.start_at) >= startOfDay(now)).map((e) => ({ key: e.id, at: e.start_at, title: e.title, kind: EVENT_KIND[e.kind] ?? "일정", allDay: e.all_day })),
    ...items
      .filter(({ item }) => item.status === "open" && item.due_at && new Date(item.due_at) >= startOfDay(now))
      .map(({ item }) => ({ key: item.id, at: item.due_at!, title: item.text, kind: "할 일", allDay: false })),
  ]
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(0, 5);
  return (
    <section className={s.card} aria-labelledby="inbox-upcoming">
      <div className={s.cardHead}>
        <h2 id="inbox-upcoming" className={s.cardTitle}>
          다가오는 일정
        </h2>
        <Link to="/calendar" className={s.more}>
          일정 보기 <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <EmptyState icon="calendar" title="다가오는 일정이 없습니다." />
      ) : (
        <ul className={s.rows} role="list">
          {upcoming.map((u) => (
            <li key={u.key} className={s.row}>
              <span className={s.when}>
                <span className={s.whenDay}>{formatDate(u.at, now)}</span>
                <span className={s.whenTime}>{u.allDay ? "하루 종일" : formatTimeOfDay(u.at)}</span>
              </span>
              <div className={s.rowMain}>
                <p className={s.rowTitle}>{u.title}</p>
              </div>
              <Badge>{u.kind}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AskCard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const threads = (useAskThreads(workspaceId).data ?? []).slice(0, 3);
  const folders = useFolders(workspaceId).data ?? [];
  const recordings = useRecordings(workspaceId).data ?? [];
  const [question, setQuestion] = useState("");
  const now = new Date();
  return (
    <section className={s.card} aria-labelledby="inbox-ask">
      <div className={s.cardHead}>
        <h2 id="inbox-ask" className={s.cardTitle}>
          물어보기
        </h2>
        <Link to="/ask" className={s.more}>
          대화 전체 <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      <Form
        className={s.askForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) void navigate({ to: "/ask", search: { q: question.trim(), scope: "workspace" } });
        }}
      >
        <TextField className={s.askField} aria-label="노트에 질문" value={question} onChange={setQuestion}>
          <Input className={s.askInput} placeholder="예: 다가오는 마감 정리해 줘" />
        </TextField>
        <Button type="submit" variant="primary" icon="spark" isDisabled={!question.trim()}>
          묻기
        </Button>
      </Form>
      {threads.length > 0 && (
        <ul className={s.rows} role="list" aria-label="최근 대화">
          {threads.map((t) => (
            <li key={t.id} className={s.row}>
              <Icon name="spark" />
              <div className={s.rowMain}>
                <Link to="/ask" search={{ thread: t.id }} className={s.rowTitle}>
                  {t.title}
                </Link>
                <p className={s.rowMeta}>
                  {scopeLabel(t.scope, folders, recordings)} · {formatRelative(t.updated_at, now)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
