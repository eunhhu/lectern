// Recording detail (ARCHITECTURE §7): the organised document is the main reading column;
// one side panel beside it holds the transcript (open by default), the files (PDFs,
// events, to-dos) or "이 노트에 물어보기", opened from the header and closed to read the
// document full width. The 물어보기 conversation lives here, so switching panels keeps it. The audio player stays at the bottom. Below 1280 px the document and the
// panels become tabs. DOM order matches the visual order (WCAG 1.3.2).

import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Menu, MenuItem, MenuTrigger, Popover, Separator, Tab, TabList, TabPanel, Tabs, ToggleButton, type Key } from "react-aria-components";
import { useApi, useDocument, useFolders, useLiveProgress, useRecording, useTags, useTranscript } from "../../api/queries.ts";
import { ApiClientError } from "../../api/client.ts";
import type { AskScope, RecordingDetail } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { setPreferences, usePreferences, type RecordingPanel } from "../../app/preferences.ts";
import { DOMAIN_LABEL, partialNote, progressLabel, STATUS } from "../../app/labels.ts";
import { primaryDocument } from "../../lib/documents.ts";
import { saveBlob } from "../../lib/download.ts";
import { formatDateTime, formatDuration } from "../../lib/format.ts";
import { createAudioClock, SimulatedClock, type AudioPart, type MediaClock } from "../../lib/media-clock.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Badge, Button, Dot, EmptyState, ErrorBox, Progress, Segmented, Spinner, uiStyles } from "../../ui/controls.tsx";
import { BulkDialogs, type BulkAction } from "../library/BulkDialogs.tsx";
import { toastError } from "../library/organise.ts";
import { ShareDialog } from "../share/ShareDialog.tsx";
import { folderPath } from "../library/folders.ts";
import { useAskSession } from "../ask/session.ts";
import { AskPanel } from "./AskPanel.tsx";
import { AudioPlayer } from "./AudioPlayer.tsx";
import { DeleteAudioDialog } from "./DeleteAudioDialog.tsx";
import { DocumentPane } from "./DocumentPane.tsx";
import { DocumentEditor } from "./edit/DocumentEditor.tsx";
import { PlaybackProvider, usePlayback, type SidePanel } from "./playback.tsx";
import { ReprocessDialog, type ReprocessMode } from "./ReprocessDialog.tsx";
import { SidePane } from "./SidePane.tsx";
import { TranscriptPane } from "./TranscriptPane.tsx";
import s from "./recording.module.css";

const WIDE = "(min-width: 1280px)";

const PANEL_TOGGLES: { id: SidePanel; label: string; icon: IconName }[] = [
  { id: "transcript", label: "전사", icon: "quote" },
  { id: "files", label: "자료", icon: "pdf" },
  { id: "ask", label: "물어보기", icon: "spark" },
];

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", fn);
      return () => mql.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
  );
}

export function RecordingPage() {
  const { recordingId } = useParams({ from: "/_authed/recordings/$recordingId" });
  const detail = useRecording(recordingId);
  usePageTitle(detail.data?.recording.title ?? "녹음");

  if (detail.isPending) {
    return (
      <div className={s.loading}>
        <Spinner />
      </div>
    );
  }
  if (detail.isError) {
    const notFound = detail.error instanceof ApiClientError && detail.error.status === 404;
    return (
      <div className={s.loading}>
        {notFound ? (
          <EmptyState icon="search" title="녹음을 찾을 수 없습니다." action={<BackToLibrary />}>
            삭제됐거나 다른 워크스페이스의 녹음입니다.
          </EmptyState>
        ) : (
          <ErrorBox title="녹음을 불러오지 못했습니다." onRetry={() => void detail.refetch()}>
            {detail.error.message} 잠시 후 다시 시도하세요.
          </ErrorBox>
        )}
      </div>
    );
  }
  return <RecordingView key={recordingId} detail={detail.data} />;
}

function BackToLibrary() {
  const navigate = useNavigate();
  return <Button onPress={() => void navigate({ to: "/library" })}>라이브러리로</Button>;
}

// Per audio part the original upload is the timeline the transcript uses; a compacted or
// normalized copy (same timeline, smaller) stands in when the original is gone.
const AUDIO_PREFERENCE = ["audio", "audio_compact", "audio_normalized"] as const;

function playableParts(assets: RecordingDetail["assets"], urlOf: (id: string) => string | null): AudioPart[] {
  const byPart = new Map<number, RecordingDetail["assets"][number]>();
  for (const kind of AUDIO_PREFERENCE) {
    for (const a of assets) if (a.kind === kind && !byPart.has(a.part_index)) byPart.set(a.part_index, a);
  }
  const out: AudioPart[] = [];
  for (const a of [...byPart.values()].sort((x, y) => x.part_index - y.part_index)) {
    const url = urlOf(a.id);
    if (!url) return [];
    out.push({ url, durationMs: a.duration_ms });
  }
  return out;
}

const EDIT_BUTTON_ID = "document-edit";

function RecordingView({ detail }: { detail: RecordingDetail }) {
  const api = useApi();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authed/recordings/$recordingId" });
  const rec = detail.recording;
  // A reprocess keeps the old document on screen while it is queued or running.
  const hasTranscript =
    rec.status === "ready" || rec.status === "partial" || ((rec.status === "processing" || rec.status === "queued") && detail.documents.length > 0);
  const transcript = useTranscript(rec.id, hasTranscript);
  const primary = primaryDocument(detail.documents);
  const doc = useDocument(primary?.id);
  const folders = useFolders(rec.workspace_id).data ?? [];
  const tags = useTags(rec.workspace_id).data ?? [];
  const [action, setAction] = useState<BulkAction>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Reprocess, audio deletion and export (D-P2-4).
  const [reprocess, setReprocess] = useState<ReprocessMode | null>(null);
  const [lastReprocess, setLastReprocess] = useState<ReprocessMode>("full");
  const [deleteAudio, setDeleteAudio] = useState(false);
  const wide = useMediaQuery(WIDE);
  const now = useMemo(() => new Date(), []);
  const prefs = usePreferences();
  const panel = prefs.recordingPanel;
  const [narrowTab, setNarrowTab] = useState<"document" | SidePanel>("document");
  const ask = useAskSession(rec.workspace_id);
  const [askScope, setAskScope] = useState<AskScope>({ kind: "recording", recording_id: rec.id });
  // After a citation opened the transcript, offer the way back to the conversation.
  const [backToAsk, setBackToAsk] = useState(false);
  // Focus the composer only when the reader opened 물어보기, not on page load.
  const [askFocus, setAskFocus] = useState(false);
  // Document editing (D-P2-2); closing it puts focus back on "편집".
  const [editing, setEditing] = useState(false);
  const [refocusEdit, setRefocusEdit] = useState(false);
  const closeEditor = useCallback(() => {
    setEditing(false);
    setRefocusEdit(true);
  }, []);
  useEffect(() => {
    if (!refocusEdit || editing) return;
    const button = document.getElementById(EDIT_BUTTON_ID);
    if (button) {
      button.focus();
      setRefocusEdit(false);
    }
  });
  const setPanel = (next: RecordingPanel) => {
    setBackToAsk(false);
    setAskFocus(next === "ask");
    setPreferences({ recordingPanel: next });
  };
  const showTab = (next: "document" | SidePanel) => {
    setBackToAsk(false);
    setAskFocus(next === "ask");
    setNarrowTab(next);
  };
  // A source chip opens the transcript, a PDF chip the files panel.
  const requestPanel = useCallback((next: SidePanel) => {
    setPreferences({ recordingPanel: next });
    setNarrowTab(next);
  }, []);

  // One clock per recording view: the audio element when the API serves bytes, the
  // silent simulated clock for fixtures.
  const audioKey = detail.assets.map((a) => `${a.id}:${a.kind}:${a.part_index}`).join(",");
  const clock = useMemo<MediaClock>(() => {
    const durationMs = rec.duration_ms ?? 0;
    const parts = playableParts(detail.assets, (id) => api.assetContentUrl(id));
    if (parts.length) {
      const audio = new Audio();
      audio.preload = "metadata";
      return createAudioClock(audio, parts, durationMs);
    }
    return new SimulatedClock(durationMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, audioKey, rec.duration_ms]);
  useEffect(() => () => clock.dispose(), [clock]);

  // ?t=<ms> (from search results and answers) starts at that point.
  useEffect(() => {
    if (search.t !== undefined && transcript.data) clock.seek(search.t);
  }, [search.t, transcript.data, clock]);

  // ?ask=<question> (⌘K "이 노트에 물어보기"): open the panel and ask at once.
  useEffect(() => {
    if (!search.ask) return;
    const scope: AskScope = { kind: "recording", recording_id: rec.id };
    setAskScope(scope);
    setPreferences({ recordingPanel: "ask" });
    setNarrowTab("ask");
    ask.send(search.ask, scope);
    void navigate({ to: "/recordings/$recordingId", params: { recordingId: rec.id }, search: search.t !== undefined ? { t: search.t } : {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.ask]);

  const status = STATUS[rec.status];
  const path = folderPath(folders, rec.folder_id);
  const pdfs = detail.assets.filter((a) => a.kind === "pdf");

  const hasAudio = detail.assets.some((a) => a.kind.startsWith("audio"));
  const busy = rec.status === "processing" || rec.status === "queued";
  const disabledKeys = [
    ...(hasAudio ? [] : ["delete-audio", "reprocess"]),
    ...(detail.documents.length ? [] : ["export", "regenerate"]),
    ...(busy ? ["reprocess", "regenerate"] : []),
  ];
  const exportMarkdown = async () => {
    const target = primary ?? detail.documents[0];
    if (!target) return;
    try {
      const { blob, filename } = await api.exportDocument(target.id);
      saveBlob(blob, filename);
    } catch (err) {
      toastError("내려받지 못했습니다.", err);
    }
  };
  const openReprocess = (mode: ReprocessMode) => {
    setLastReprocess(mode);
    setReprocess(mode);
  };
  const onMenuAction = (key: Key) => {
    if (key === "share") setShareOpen(true);
    else if (key === "reprocess") openReprocess("full");
    else if (key === "regenerate") openReprocess("document");
    else if (key === "delete-audio") setDeleteAudio(true);
    else if (key === "export") void exportMarkdown();
    else setAction({ kind: key as "move" | "tag" | "delete", ids: [rec.id] });
  };

  const header = (
    <header className={s.header}>
      <nav aria-label="이동 경로" className={s.breadcrumbs}>
        <Link to="/library" className={s.crumb}>
          라이브러리
        </Link>
        {rec.folder_id && (
          <>
            <Icon name="chevronRight" size={12} />
            <Link to="/library" search={{ folder: rec.folder_id }} className={s.crumb}>
              {path}
            </Link>
          </>
        )}
      </nav>
      <div className={s.titleRow}>
        <h1 className={s.title}>{rec.title}</h1>
        <MenuTrigger>
          <Button variant="ghost" icon="more" iconOnly aria-label="녹음 작업" />
          <Popover className={uiStyles.popover} placement="bottom end">
            <Menu className={uiStyles.menu} onAction={onMenuAction} disabledKeys={disabledKeys}>
              <MenuItem id="move" className={uiStyles.menuItem}>
                <Icon name="folder" /> 폴더로 이동…
              </MenuItem>
              <MenuItem id="tag" className={uiStyles.menuItem}>
                <Icon name="tag" /> 태그…
              </MenuItem>
              <MenuItem id="share" className={uiStyles.menuItem}>
                <Icon name="send" /> 공유…
              </MenuItem>
              <Separator className={uiStyles.menuSeparator} />
              <MenuItem id="reprocess" className={uiStyles.menuItem}>
                <Icon name="forward" /> 다시 처리…
              </MenuItem>
              <MenuItem id="regenerate" className={uiStyles.menuItem}>
                <Icon name="spark" /> 문서만 다시 만들기
              </MenuItem>
              <MenuItem id="delete-audio" className={uiStyles.menuItem}>
                <Icon name="trash" /> 오디오만 삭제…
              </MenuItem>
              <MenuItem id="export" className={uiStyles.menuItem}>
                Markdown 내려받기
              </MenuItem>
              <Separator className={uiStyles.menuSeparator} />
              <MenuItem id="delete" className={uiStyles.menuItem}>
                <Icon name="trash" /> 삭제…
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
        {hasTranscript && wide && (
          // Toggle buttons, not radios: pressing the open panel closes it.
          <div role="group" aria-label="옆 패널" className={s.panelToggles}>
            {PANEL_TOGGLES.map((p) => (
              <ToggleButton key={p.id} className={s.panelToggle} isSelected={panel === p.id} onChange={(on) => setPanel(on ? p.id : "none")}>
                <Icon name={p.icon} size={16} /> {p.label}
              </ToggleButton>
            ))}
          </div>
        )}
      </div>
      <p className={s.meta}>
        <Badge>{DOMAIN_LABEL[rec.domain]}</Badge>
        <span title={rec.recorded_at_source === "upload" ? "녹음 시각을 알 수 없어 올린 시각을 씁니다." : undefined}>
          {formatDateTime(rec.recorded_at, now)}
        </span>
        {rec.duration_ms !== null && <span>{formatDuration(rec.duration_ms)}</span>}
        <span className={s.status}>
          <Dot tone={status.tone} live={status.busy} />
          {status.label}
        </span>
        <span className={s.headerTags}>
          {detail.tags
            .map((rt) => tags.find((t) => t.id === rt.tag_id))
            .filter((t): t is NonNullable<typeof t> => Boolean(t))
            .map((t) => (
              <span key={t.id} className={s.headerTag}>
                <span className={s.tagDot} data-color={t.color} aria-hidden="true" />
                {t.name}
              </span>
            ))}
          <Button size="sm" variant="ghost" icon="tag" onPress={() => setAction({ kind: "tag", ids: [rec.id] })}>
            {detail.tags.length ? "태그 편집" : "태그 붙이기"}
          </Button>
        </span>
      </p>
    </header>
  );

  const dialogs = (
    <>
      <BulkDialogs
        action={action}
        onClose={() => {
          const deleted = action?.kind === "delete";
          setAction(null);
          if (deleted) setTimeout(() => void navigate({ to: "/library" }), 0);
        }}
        onFailed={() => {}}
      />
      <ShareDialog recording={rec} isOpen={shareOpen} onOpenChange={setShareOpen} />
      <ReprocessDialog recording={rec} mode={reprocess ?? lastReprocess} isOpen={reprocess !== null} onOpenChange={(open) => !open && setReprocess(null)} />
      <DeleteAudioDialog recording={rec} isOpen={deleteAudio} onOpenChange={setDeleteAudio} />
    </>
  );

  if (!hasTranscript) {
    return (
      <div className={s.page}>
        {header}
        <div className={s.state}>{rec.status === "failed" ? <FailedState failure={detail.failure} /> : <ProcessingState detail={detail} />}</div>
        {dialogs}
      </div>
    );
  }

  if (transcript.isPending || (primary && doc.isPending)) {
    return (
      <div className={s.page}>
        {header}
        <div className={s.state} aria-busy="true">
          <Spinner label="전사와 문서를 불러오는 중…" />
        </div>
      </div>
    );
  }
  if (transcript.isError) {
    return (
      <div className={s.page}>
        {header}
        <div className={s.state}>
          <ErrorBox title="전사를 불러오지 못했습니다." onRetry={() => void transcript.refetch()}>
            {transcript.error.message}
          </ErrorBox>
        </div>
      </div>
    );
  }

  const t = transcript.data;
  const panelHead = (id: string, title: string, extra?: ReactNode) => (
    <div className={s.panelHead}>
      <h2 id={id} className={s.panelTitle}>
        {title}
      </h2>
      {extra}
      {wide && <Button size="sm" variant="ghost" icon="close" iconOnly aria-label={`${title} 패널 닫기`} onPress={() => setPanel("none")} />}
    </div>
  );
  const panes = {
    document: (
      <section className={s.docPane} aria-labelledby="pane-document">
        <h2 id="pane-document" className="visually-hidden">
          문서
        </h2>
        <div className={s.docScroll}>
          {doc.data && editing ? (
            <DocumentEditor doc={doc.data} recordingId={rec.id} onClose={closeEditor} />
          ) : doc.data ? (
            <DocumentPane doc={doc.data} pdfs={pdfs} headingId="pane-document" onEdit={() => setEditing(true)} editButtonId={EDIT_BUTTON_ID} />
          ) : (
            <EmptyState icon="pdf" title="문서가 아직 없습니다.">
              전사는 준비됐고 문서를 만드는 중입니다.
            </EmptyState>
          )}
        </div>
      </section>
    ),
    transcript: (
      <section className={s.panel} aria-labelledby="pane-transcript">
        {panelHead(
          "pane-transcript",
          "전사",
          <>
            {backToAsk && (
              <Button size="sm" variant="ghost" icon="chevronLeft" onPress={() => (wide ? setPanel("ask") : showTab("ask"))}>
                물어보기로
              </Button>
            )}
            <Segmented
              label="전사 표시"
              size="sm"
              value={prefs.transcriptMode}
              onChange={(mode) => setPreferences({ transcriptMode: mode })}
              options={[
                { id: "reading", label: "읽기 모드" },
                { id: "verbatim", label: "원문" },
              ]}
            />
          </>,
        )}
        <TranscriptPane headingId="pane-transcript" mode={prefs.transcriptMode} />
      </section>
    ),
    files: (
      <section className={s.panel} aria-labelledby="pane-files">
        {panelHead("pane-files", "자료")}
        <SidePane recordingId={rec.id} assets={detail.assets} ready={rec.status === "ready" || rec.status === "partial"} />
      </section>
    ),
    ask: (
      <section className={s.panel} aria-labelledby="pane-ask">
        {panelHead("pane-ask", "물어보기")}
        <AskPanel
          recording={rec}
          session={ask}
          scope={askScope}
          onScopeChange={setAskScope}
          autoFocus={askFocus}
          onJump={() => setBackToAsk(true)}
        />
      </section>
    ),
  };
  const sidePanel = panel === "none" ? null : panel === "files" ? panes.files : panel === "ask" ? panes.ask : panes.transcript;

  return (
    <PlaybackProvider clock={clock} segments={t.segments} gaps={t.gaps} speakers={t.speakers} onRequestPanel={requestPanel}>
      <PdfDeepLink recordingId={rec.id} pdf={search.pdf} t={search.t} />
      <div className={s.page}>
        {header}
        {rec.status === "partial" && (
          <p className={s.partialNote} role="note">
            <Icon name="alert" />
            {partialNote(detail.failure)}
          </p>
        )}
        {wide ? (
          <div className={s.columns} data-panel={sidePanel ? panel : undefined}>
            {panes.document}
            {sidePanel}
          </div>
        ) : (
          <Tabs className={s.narrowTabs} selectedKey={narrowTab} onSelectionChange={(k) => showTab(String(k) as typeof narrowTab)}>
            <TabList className={s.tabList} aria-label="녹음 보기">
              <Tab id="document" className={s.tab}>
                문서
              </Tab>
              <Tab id="transcript" className={s.tab}>
                전사
              </Tab>
              <Tab id="files" className={s.tab}>
                자료
              </Tab>
              <Tab id="ask" className={s.tab}>
                물어보기
              </Tab>
            </TabList>
            <TabPanel id="document" className={s.narrowPanel}>
              {panes.document}
            </TabPanel>
            <TabPanel id="transcript" className={s.narrowPanel}>
              {panes.transcript}
            </TabPanel>
            <TabPanel id="files" className={s.narrowPanel}>
              {panes.files}
            </TabPanel>
            <TabPanel id="ask" className={s.narrowPanel}>
              {panes.ask}
            </TabPanel>
          </Tabs>
        )}
        <AudioPlayer audioDeleted={!hasAudio} />
        {dialogs}
      </div>
    </PlaybackProvider>
  );
}

/** `?pdf=<asset>:<page>` (a PDF search hit): show that page once, then drop the parameter. */
function PdfDeepLink({ recordingId, pdf, t }: { recordingId: string; pdf?: string; t?: number }) {
  const { showPdfPage } = usePlayback();
  const navigate = useNavigate();
  useEffect(() => {
    if (!pdf) return;
    const [assetId, page] = pdf.split(":");
    showPdfPage(assetId!, Number(page));
    void navigate({ to: "/recordings/$recordingId", params: { recordingId }, search: t !== undefined ? { t } : {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);
  return null;
}

function ProcessingState({ detail }: { detail: RecordingDetail }) {
  const progress = useLiveProgress(detail.progress);
  const rec = detail.recording;
  const label = progressLabel(rec.status, progress);
  return (
    <div className={s.processing} aria-busy="true">
      <p className={s.processingTitle}>{label}</p>
      {progress?.progress != null && <Progress value={progress.progress} label="처리 진행률" valueLabel={label} />}
      <p className={uiStyles.hint}>처리가 끝나면 전사와 문서가 이 화면에 바로 표시됩니다.</p>
    </div>
  );
}

function FailedState({ failure }: { failure: RecordingDetail["failure"] }) {
  return (
    <ErrorBox title="이 녹음을 처리하지 못했습니다.">{failure?.message || "파일이 재생되는지 확인한 뒤 다시 올리세요."}</ErrorBox>
  );
}
