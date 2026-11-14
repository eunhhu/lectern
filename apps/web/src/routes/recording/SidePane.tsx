// The files panel: PDFs (the pdf.js viewer, D-P3-7) and the events and action items found
// in the recording.

import { useEffect, useState } from "react";
import { Button as AriaButton, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useActionItems, useRecordingEvents } from "../../api/queries.ts";
import type { AssetDto, SourceRef } from "../../api/types.ts";
import { formatBytes, formatDate, formatTimeOfDay, formatTimestamp } from "../../lib/format.ts";
import { resolveSourceRange } from "../../lib/segments.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, EmptyState } from "../../ui/controls.tsx";
import { PdfViewer } from "./pdf/PdfViewer.tsx";
import { usePlayback } from "./playback.tsx";
import s from "./recording.module.css";

const EVENT_STATUS: Record<string, { label: string; tone: "attention" | "success" | "neutral" | "info" }> = {
  suggested: { label: "제안", tone: "attention" },
  accepted: { label: "추가함", tone: "success" },
  dismissed: { label: "무시함", tone: "neutral" },
  synced: { label: "캘린더에 등록", tone: "info" },
};

export function SidePane({ recordingId, assets, ready }: { recordingId: string; assets: AssetDto[]; ready: boolean }) {
  const { pdfTarget } = usePlayback();
  const [tab, setTab] = useState<string>("files");
  useEffect(() => {
    if (pdfTarget) setTab("files");
  }, [pdfTarget]);
  return (
    <Tabs className={s.sideTabs} selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
      <TabList className={s.tabList} aria-label="자료">
        <Tab id="files" className={s.tab}>
          파일
        </Tab>
        <Tab id="items" className={s.tab}>
          일정·할 일
        </Tab>
      </TabList>
      <TabPanel id="files" className={s.tabPanel}>
        <Files recordingId={recordingId} assets={assets} />
      </TabPanel>
      <TabPanel id="items" className={s.tabPanel}>
        <Items recordingId={recordingId} enabled={ready} />
      </TabPanel>
    </Tabs>
  );
}

function Files({ recordingId, assets }: { recordingId: string; assets: AssetDto[] }) {
  const { pdfTarget } = usePlayback();
  const pdfs = assets.filter((a) => a.kind === "pdf");
  const audio = assets.filter((a) => a.kind === "audio");
  const name = (a: AssetDto) => (typeof a.meta.original_name === "string" ? a.meta.original_name : a.kind === "pdf" ? "PDF" : "오디오");
  return (
    <div className={s.sideStack}>
      {pdfs.length === 0 ? (
        <EmptyState icon="pdf" title="연결된 PDF가 없습니다.">
          강의 자료를 녹음과 함께 올리면 이곳에 표시됩니다.
        </EmptyState>
      ) : (
        pdfs.map((pdf) => {
          const target = pdfTarget?.assetId === pdf.id ? pdfTarget.page : null;
          return (
            <section key={pdf.id} className={s.pdfCard} aria-label={name(pdf)}>
              <p className={s.fileTitle}>
                <Icon name="pdf" />
                {name(pdf)}
              </p>
              <p className={s.fileMeta}>
                {pdf.page_count ? `${pdf.page_count}쪽 · ` : ""}
                {formatBytes(pdf.bytes)}
              </p>
              {pdf.page_count ? (
                <PdfViewer
                  assetId={pdf.id}
                  recordingId={recordingId}
                  name={name(pdf)}
                  pageCount={pdf.page_count}
                  targetPage={target !== null && pdfTarget ? { page: target, token: pdfTarget.token } : null}
                />
              ) : (
                <p className={s.fileMeta}>쪽을 아직 읽지 못한 PDF입니다. 처리가 끝나면 이곳에서 볼 수 있습니다.</p>
              )}
            </section>
          );
        })
      )}
      {audio.length > 0 && (
        <section className={s.audioFiles} aria-label="오디오 파일">
          {audio.map((a) => (
            <p key={a.id} className={s.fileMeta}>
              <Icon name="audio" /> {name(a)} · {formatBytes(a.bytes)}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

function SourceLinks({ sources }: { sources: SourceRef[] }) {
  const { segments, jumpToRange, showPdfPage } = usePlayback();
  return (
    <span className={s.chips}>
      {sources.map((ref, i) => {
        if (ref.kind === "transcript") {
          const range = resolveSourceRange(segments, ref);
          if (!range) return null;
          const ts = formatTimestamp(range.start_ms);
          return (
            <AriaButton key={i} className={s.chip} aria-label={`출처 ${ts}`} onPress={() => jumpToRange(ref)}>
              {ts}
            </AriaButton>
          );
        }
        if (ref.kind === "pdf_page") {
          return (
            <AriaButton key={i} className={s.chip} aria-label={`출처 p.${ref.page}`} onPress={() => showPdfPage(ref.asset_id, ref.page)}>
              p.{ref.page}
            </AriaButton>
          );
        }
        return null;
      })}
    </span>
  );
}

function Items({ recordingId, enabled }: { recordingId: string; enabled: boolean }) {
  const events = useRecordingEvents(recordingId, enabled).data ?? [];
  const actions = useActionItems(recordingId, enabled).data ?? [];
  const now = new Date();
  if (!events.length && !actions.length) {
    return <EmptyState icon="calendar" title="찾은 일정이나 할 일이 없습니다." />;
  }
  return (
    <div className={s.sideStack}>
      {events.length > 0 && (
        <section aria-labelledby="side-events">
          <h3 id="side-events" className={s.sideHeading}>
            일정
          </h3>
          <ul className={s.itemList} role="list">
            {events.map((e) => (
              <li key={e.id} className={s.item}>
                <p className={s.itemTitle}>
                  {e.title} <Badge tone={EVENT_STATUS[e.status]?.tone ?? "neutral"}>{EVENT_STATUS[e.status]?.label ?? e.status}</Badge>
                </p>
                <p className={s.itemMeta}>
                  {formatDate(e.start_at, now)}
                  {!e.all_day && ` ${formatTimeOfDay(e.start_at)}`} · “{e.raw_expression}”
                </p>
                <SourceLinks sources={e.evidence.sources} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {actions.length > 0 && (
        <section aria-labelledby="side-actions">
          <h3 id="side-actions" className={s.sideHeading}>
            할 일
          </h3>
          <ul className={s.itemList} role="list">
            {actions.map((a) => (
              <li key={a.id} className={s.item}>
                <p className={s.itemTitle} data-done={a.status === "done" || undefined}>
                  {a.status === "done" && <Icon name="check" size={14} />}
                  {a.text}
                  {a.status === "done" && <span className="visually-hidden"> (완료)</span>}
                </p>
                <p className={s.itemMeta}>
                  {[a.owner_name, a.due_raw ?? (a.due_at ? formatDate(a.due_at, now) : null)].filter(Boolean).join(" · ")}
                </p>
                <SourceLinks sources={a.evidence.sources} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
