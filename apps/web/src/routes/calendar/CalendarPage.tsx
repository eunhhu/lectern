// 일정 (ARCHITECTURE §7, §11): a month view (React Aria Calendar: arrow keys move between
// days, PageUp/PageDown between months) and a week view of the events the user
// confirmed, the to-dos found in recordings, and the suggestions still waiting. The rail
// shows the selected day, the suggestion inbox, open to-dos and the calendar connection.

import { parseDate, today, type CalendarDate } from "@internationalized/date";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "react-aria-components";
import {
  useConfirmedEvents,
  useDecideSuggestion,
  useRecordings,
  useSuggestions,
  useUpdateActionItem,
  useWorkspaceActionItems,
} from "../../api/queries.ts";
import type { EventCandidate } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { addDays, dayKey, groupByDay, weekOf, type CalendarItem } from "../../lib/calendar.ts";
import { DEFAULT_TIME_ZONE, formatDate, formatTimeOfDay } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, CheckboxField, EmptyState } from "../../ui/controls.tsx";
import { announce, showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import layout from "../../app/layout.module.css";
import s from "./calendar.module.css";

const EVENT_KIND: Record<string, string> = { deadline: "마감", exam: "시험", meeting: "회의", task: "할 일", other: "일정" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function toItem(e: EventCandidate, recordingTitle: string, kind: "event" | "suggestion"): CalendarItem {
  return {
    id: e.id,
    kind,
    title: e.title,
    at: e.start_at,
    end: e.end_at,
    allDay: e.all_day,
    label: EVENT_KIND[e.kind] ?? "일정",
    recordingId: e.recording_id,
    recordingTitle,
    synced: e.status === "synced",
  };
}

function timeLabel(item: CalendarItem) {
  if (item.allDay) return "하루 종일";
  const start = formatTimeOfDay(item.at);
  return item.end && item.kind !== "task" ? `${start}–${formatTimeOfDay(item.end).replace(/^오[전후] /, "")}` : start;
}

export function CalendarPage() {
  usePageTitle("일정");
  const { workspaceId } = useWorkspace();
  const recordings = useRecordings(workspaceId).data ?? [];
  const confirmed = useConfirmedEvents(workspaceId).data ?? [];
  const suggestions = useSuggestions(workspaceId).data ?? [];
  const actionItems = useWorkspaceActionItems(workspaceId).data ?? [];
  const [selected, setSelected] = useState<CalendarDate>(() => today(DEFAULT_TIME_ZONE));
  const [view, setView] = useState<"month" | "week">("month");
  const now = useMemo(() => new Date(), []);

  const titleOf = (id: string) => recordings.find((r) => r.id === id)?.title ?? "녹음";
  const items: CalendarItem[] = useMemo(
    () => [
      ...confirmed.map((e) => toItem(e, titleOf(e.recording_id), "event")),
      ...suggestions.map((e) => toItem(e, titleOf(e.recording_id), "suggestion")),
      ...actionItems
        .filter(({ item }) => item.due_at && item.status !== "dismissed")
        .map(({ item, recording }) => ({
          id: item.id,
          kind: "task" as const,
          title: item.text,
          at: item.due_at!,
          end: null,
          allDay: false,
          label: "할 일",
          recordingId: recording.id,
          recordingTitle: recording.title,
          done: item.status === "done",
        })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmed, suggestions, actionItems, recordings],
  );
  const byDay = useMemo(() => groupByDay(items), [items]);
  const selectedKey = selected.toString();

  const select = (date: CalendarDate) => {
    setSelected(date);
    const list = byDay.get(date.toString()) ?? [];
    announce(`${formatDate(`${date.toString()}T03:00:00Z`, now)}: ${list.length ? `항목 ${list.length}개` : "일정 없음"}`);
  };

  return (
    <div className={s.layout}>
      <section className={s.main} aria-labelledby="calendar-title">
        <header className={layout.pageHeader}>
          <h1 id="calendar-title" className={layout.pageTitle}>
            일정
          </h1>
          <div className={layout.pageActions}>
            <Button onPress={() => select(today(DEFAULT_TIME_ZONE))}>오늘</Button>
          </div>
        </header>
        <Tabs selectedKey={view} onSelectionChange={(k) => setView(k as "month" | "week")} className={s.tabs}>
          <TabList aria-label="보기 단위" className={s.segmented}>
            <Tab id="month" className={s.segment}>
              월
            </Tab>
            <Tab id="week" className={s.segment}>
              주
            </Tab>
          </TabList>
          <TabPanel id="month" className={s.panel}>
            <Calendar aria-label="일정 달력" value={selected} onChange={select} className={s.calendar} firstDayOfWeek="sun">
              <div className={s.calendarHead}>
                <AriaButton slot="previous" className={s.navButton} aria-label="이전 달">
                  <Icon name="chevronLeft" />
                </AriaButton>
                <Heading className={s.monthHeading} />
                <AriaButton slot="next" className={s.navButton} aria-label="다음 달">
                  <Icon name="chevronRight" />
                </AriaButton>
              </div>
              <CalendarGrid className={s.grid} weekdayStyle="short">
                <CalendarGridHeader>{(day) => <CalendarHeaderCell className={s.weekday}>{day}</CalendarHeaderCell>}</CalendarGridHeader>
                <CalendarGridBody>
                  {(date) => (
                    <CalendarCell date={date} className={s.cell}>
                      {({ formattedDate, isOutsideMonth }) => {
                        const list = byDay.get(date.toString()) ?? [];
                        return (
                          <span className={s.cellInner} data-outside={isOutsideMonth || undefined}>
                            <span className={s.dayNumber} data-today={date.compare(today(DEFAULT_TIME_ZONE)) === 0 || undefined}>
                              {formattedDate}
                            </span>
                            {list.slice(0, 3).map((item) => (
                              <span key={item.id} className={s.pill} data-kind={item.kind} data-done={item.done || undefined}>
                                {!item.allDay && <span className={s.pillTime}>{formatTimeOfDay(item.at).replace(/^오[전후] /, "")}</span>}
                                <span className={s.pillTitle}>{item.title}</span>
                              </span>
                            ))}
                            {list.length > 3 && <span className={s.more}>+{list.length - 3}개</span>}
                          </span>
                        );
                      }}
                    </CalendarCell>
                  )}
                </CalendarGridBody>
              </CalendarGrid>
            </Calendar>
            <p className={s.legend} aria-hidden="true">
              <span className={s.legendItem}>
                <span className={s.legendSwatch} data-kind="event" /> 확정한 일정
              </span>
              <span className={s.legendItem}>
                <span className={s.legendSwatch} data-kind="suggestion" /> 일정 제안
              </span>
              <span className={s.legendItem}>
                <span className={s.legendSwatch} data-kind="task" /> 할 일 마감
              </span>
            </p>
          </TabPanel>
          <TabPanel id="week" className={s.panel}>
            <WeekView selectedKey={selectedKey} byDay={byDay} onSelect={(day) => select(parseDate(day))} now={now} />
          </TabPanel>
        </Tabs>
      </section>

      <aside className={s.rail} aria-label="선택한 날짜와 제안">
        <DayAgenda dayKeyValue={selectedKey} items={byDay.get(selectedKey) ?? []} now={now} />
        <SuggestionInbox suggestions={suggestions} titleOf={titleOf} now={now} />
        <OpenTasks />
        <section className={s.railCard} aria-labelledby="cal-connection">
          <h2 id="cal-connection" className={s.railTitle}>
            캘린더 연결
          </h2>
          <p className={s.railText}>
            Google 캘린더가 연결되지 않았습니다. 연결하면 확정한 일정이 ‘Lectern’ 캘린더에 들어갑니다.
          </p>
          <Link to="/settings" hash="integrations" className={s.railLink}>
            설정에서 연결 <Icon name="chevronRight" size={14} />
          </Link>
        </section>
      </aside>
    </div>
  );
}

function WeekView({
  selectedKey,
  byDay,
  onSelect,
  now,
}: {
  selectedKey: string;
  byDay: Map<string, CalendarItem[]>;
  onSelect: (day: string) => void;
  now: Date;
}) {
  const days = weekOf(selectedKey);
  const todayKey = dayKey(now.toISOString());
  const label = `${formatDate(`${days[0]}T03:00:00Z`, now)} – ${formatDate(`${days[6]}T03:00:00Z`, now)}`;
  return (
    <div className={s.week}>
      <div className={s.calendarHead}>
        <AriaButton className={s.navButton} aria-label="이전 주" onPress={() => onSelect(addDays(selectedKey, -7))}>
          <Icon name="chevronLeft" />
        </AriaButton>
        <h2 className={s.monthHeading}>{label}</h2>
        <AriaButton className={s.navButton} aria-label="다음 주" onPress={() => onSelect(addDays(selectedKey, 7))}>
          <Icon name="chevronRight" />
        </AriaButton>
      </div>
      <ol className={s.weekDays} role="list">
        {days.map((day, i) => {
          const list = byDay.get(day) ?? [];
          return (
            <li key={day} className={s.weekDay} data-selected={day === selectedKey || undefined}>
              <AriaButton className={s.weekDayHead} onPress={() => onSelect(day)} aria-label={`${formatDate(`${day}T03:00:00Z`, now)}, 항목 ${list.length}개`}>
                <span className={s.weekdayName}>{WEEKDAYS[i]}</span>
                <span className={s.dayNumber} data-today={day === todayKey || undefined}>
                  {Number(day.slice(8))}
                </span>
              </AriaButton>
              {list.length === 0 ? (
                <p className={s.weekEmpty}>없음</p>
              ) : (
                <ul className={s.weekItems} role="list">
                  {list.map((item) => (
                    <li key={item.id} className={s.weekItem} data-kind={item.kind} data-done={item.done || undefined}>
                      <span className={s.pillTime}>{timeLabel(item)}</span>
                      <span className={s.weekItemTitle}>{item.title}</span>
                      <span className={s.weekItemLabel}>{item.kind === "suggestion" ? "제안" : item.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DayAgenda({ dayKeyValue, items, now }: { dayKeyValue: string; items: CalendarItem[]; now: Date }) {
  return (
    <section className={s.railCard} aria-labelledby="cal-day" aria-live="polite">
      <h2 id="cal-day" className={s.railTitle}>
        {formatDate(`${dayKeyValue}T03:00:00Z`, now)}
      </h2>
      {items.length === 0 ? (
        <p className={s.railText}>이 날에는 일정과 할 일이 없습니다.</p>
      ) : (
        <ul className={s.agenda} role="list">
          {items.map((item) => (
            <li key={item.id} className={s.agendaItem} data-kind={item.kind}>
              <span className={s.agendaTime}>{timeLabel(item)}</span>
              <span className={s.agendaBody}>
                <span className={s.agendaTitle} data-done={item.done || undefined}>
                  {item.title}
                </span>
                <span className={s.agendaMeta}>
                  <Badge tone={item.kind === "suggestion" ? "attention" : item.kind === "task" ? "info" : "accent"}>
                    {item.kind === "suggestion" ? "제안" : item.label}
                  </Badge>
                  {item.synced && <Badge tone="success">캘린더에 등록됨</Badge>}
                  <Link to="/recordings/$recordingId" params={{ recordingId: item.recordingId }} className={s.source}>
                    {item.recordingTitle}
                  </Link>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestionInbox({ suggestions, titleOf, now }: { suggestions: EventCandidate[]; titleOf: (id: string) => string; now: Date }) {
  const { workspaceId } = useWorkspace();
  const decide = useDecideSuggestion(workspaceId);
  const run = async (e: EventCandidate, status: "accepted" | "dismissed") => {
    try {
      await decide.mutateAsync({ id: e.id, status });
    } catch (err) {
      toastError(status === "accepted" ? "일정을 추가하지 못했습니다." : "제안을 무시하지 못했습니다.", err);
      return;
    }
    showToast({ title: status === "accepted" ? `‘${e.title}’ 일정을 추가했습니다.` : `‘${e.title}’ 제안을 무시했습니다.`, tone: status === "accepted" ? "success" : "neutral" });
  };
  return (
    <section className={s.railCard} aria-labelledby="cal-suggestions">
      <h2 id="cal-suggestions" className={s.railTitle}>
        일정 제안 <span className={s.count}>{suggestions.length}</span>
      </h2>
      {suggestions.length === 0 ? (
        <p className={s.railText}>확인할 제안이 없습니다.</p>
      ) : (
        <ul className={s.agenda} role="list">
          {suggestions.map((e) => (
            <li key={e.id} className={s.suggestion}>
              <p className={s.agendaTitle}>{e.title}</p>
              <p className={s.agendaMeta}>
                {formatDate(e.start_at, now)} {!e.all_day && formatTimeOfDay(e.start_at)} · “{e.raw_expression}”
              </p>
              <p className={s.agendaMeta}>
                <Link to="/recordings/$recordingId" params={{ recordingId: e.recording_id }} className={s.source}>
                  {titleOf(e.recording_id)}
                </Link>
                {e.flags.includes("needs_review") && <Badge tone="attention">날짜 확인 필요</Badge>}
              </p>
              <div className={s.suggestionActions}>
                <Button size="sm" onPress={() => run(e, "dismissed")} aria-label={`무시: ${e.title}`}>
                  무시
                </Button>
                <Button size="sm" variant="primary" onPress={() => run(e, "accepted")} aria-label={`일정에 추가: ${e.title}`}>
                  일정에 추가
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OpenTasks() {
  const { workspaceId } = useWorkspace();
  const items = useWorkspaceActionItems(workspaceId).data ?? [];
  const update = useUpdateActionItem(workspaceId);
  const navigate = useNavigate();
  const now = new Date();
  const open = items
    .filter(({ item }) => item.status !== "dismissed")
    .sort((a, b) => Number(a.item.status === "done") - Number(b.item.status === "done") || (a.item.due_at ?? "9").localeCompare(b.item.due_at ?? "9"));
  return (
    <section className={s.railCard} aria-labelledby="cal-tasks">
      <h2 id="cal-tasks" className={s.railTitle}>
        할 일 <span className={s.count}>{open.filter(({ item }) => item.status === "open").length}</span>
      </h2>
      {open.length === 0 ? (
        <EmptyState icon="check" tone="success" title="남은 할 일이 없습니다." />
      ) : (
        <ul className={s.tasks} role="list">
          {open.map(({ item, recording }) => (
            <li key={item.id} className={s.task}>
              <CheckboxField
                isSelected={item.status === "done"}
                onChange={async (done) => {
                  try {
                    await update.mutateAsync({ id: item.id, status: done ? "done" : "open" });
                    announce(done ? `‘${item.text}’ 완료` : `‘${item.text}’ 다시 열림`);
                  } catch (err) {
                    toastError("할 일을 바꾸지 못했습니다.", err);
                  }
                }}
              >
                <span className={s.taskText} data-done={item.status === "done" || undefined}>
                  {item.text}
                </span>
              </CheckboxField>
              <p className={s.taskMeta}>
                {[item.owner_name, item.due_at ? `${formatDate(item.due_at, now)}까지` : item.due_raw].filter(Boolean).join(" · ")}
                {" · "}
                <AriaButton className={s.taskSource} onPress={() => void navigate({ to: "/recordings/$recordingId", params: { recordingId: recording.id } })}>
                  {recording.title}
                </AriaButton>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
