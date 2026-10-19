// Recording detail (ARCHITECTURE §7): transcript ⇄ document ⇄ PDF/questions in three
// columns, with the audio player fixed at the bottom. Below 1280 px the columns become
// tabs. DOM order matches the visual order (WCAG 1.3.2).

import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Menu, MenuItem, MenuTrigger, Popover, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useApi, useDocument, useFolders, useJobProgress, useRecording, useTags, useTranscript } from "../../api/queries.ts";
import { ApiClientError } from "../../api/client.ts";
import type { RecordingDetail } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { DOMAIN_LABEL, STATUS, stageLabel } from "../../app/labels.ts";
import { formatDateTime, formatDuration } from "../../lib/format.ts";
import { createAudioElementClock, SimulatedClock, type MediaClock } from "../../lib/media-clock.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, Dot, EmptyState, ErrorBox, Progress, Spinner, uiStyles } from "../../ui/controls.tsx";
import { BulkDialogs, type BulkAction } from "../library/BulkDialogs.tsx";
import { folderPath } from "../library/folders.ts";
import { AudioPlayer } from "./AudioPlayer.tsx";
import { DocumentPane } from "./DocumentPane.tsx";
import { PlaybackProvider } from "./playback.tsx";
import { SidePane } from "./SidePane.tsx";
import { TranscriptPane } from "./TranscriptPane.tsx";
import s from "./recording.module.css";

const WIDE = "(min-width: 1280px)";

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
  const { recordingId } = useParams({ from: "/recordings/$recordingId" });
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

function RecordingView({ detail }: { detail: RecordingDetail }) {
  const api = useApi();
  const navigate = useNavigate();
  const search = useSearch({ from: "/recordings/$recordingId" });
  const rec = detail.recording;
  const hasTranscript = rec.status === "ready" || rec.status === "partial" || (rec.status === "processing" && detail.documents.length > 0);
  const transcript = useTranscript(rec.id, hasTranscript);
  const doc = useDocument(detail.documents[0]?.id);
  const folders = useFolders(rec.workspace_id).data ?? [];
  const tags = useTags(rec.workspace_id).data ?? [];
  const [action, setAction] = useState<BulkAction>(null);
  const wide = useMediaQuery(WIDE);
  const now = useMemo(() => new Date(), []);

  // One clock per recording view: the audio element when the API serves bytes, the
  // silent simulated clock for fixtures.
  const audioAsset = detail.assets.find((a) => a.kind === "audio");
  const clock = useMemo<MediaClock>(() => {
    const url = audioAsset ? api.assetContentUrl(audioAsset.id) : null;
    const durationMs = rec.duration_ms ?? 0;
    if (url) {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.src = url;
      return createAudioElementClock(audio, durationMs);
    }
    return new SimulatedClock(durationMs);
  }, [api, audioAsset, rec.duration_ms]);
  useEffect(() => () => clock.dispose(), [clock]);

  // ?t=<ms> (from search results) starts at that point.
  useEffect(() => {
    if (search.t !== undefined && transcript.data) clock.seek(search.t);
  }, [search.t, transcript.data, clock]);

  const status = STATUS[rec.status];
  const path = folderPath(folders, rec.folder_id);
  const pdfs = detail.assets.filter((a) => a.kind === "pdf");

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
            <Menu className={uiStyles.menu} onAction={(key) => setAction({ kind: key as "move" | "tag" | "delete", ids: [rec.id] })}>
              <MenuItem id="move" className={uiStyles.menuItem}>
                <Icon name="folder" /> 폴더로 이동…
              </MenuItem>
              <MenuItem id="tag" className={uiStyles.menuItem}>
                <Icon name="tag" /> 태그…
              </MenuItem>
              <MenuItem id="delete" className={uiStyles.menuItem}>
                <Icon name="trash" /> 삭제…
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
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
    <BulkDialogs
      action={action}
      onClose={() => {
        const deleted = action?.kind === "delete";
        setAction(null);
        if (deleted) setTimeout(() => void navigate({ to: "/library" }), 0);
      }}
      onFailed={() => {}}
    />
  );

  if (!hasTranscript) {
    return (
      <div className={s.page}>
        {header}
        <div className={s.state}>{rec.status === "failed" ? <FailedState /> : <ProcessingState detail={detail} />}</div>
        {dialogs}
      </div>
    );
  }

  if (transcript.isPending || (detail.documents[0] && doc.isPending)) {
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
  const panes = {
    transcript: (
      <section className={s.pane} aria-labelledby="pane-transcript">
        <h2 id="pane-transcript" className={s.paneTitle}>
          전사 <span className={s.paneCount}>구간 {t.segments.length.toLocaleString("ko-KR")}개</span>
        </h2>
        <TranscriptPane headingId="pane-transcript" />
      </section>
    ),
    document: (
      <section className={`${s.pane} ${s.docPane}`} aria-labelledby="pane-document">
        <h2 id="pane-document" className={s.paneTitle}>
          문서
        </h2>
        <div className={s.docScroll}>
          {doc.data ? (
            <DocumentPane doc={doc.data} pdfs={pdfs} headingId="pane-document" />
          ) : (
            <EmptyState icon="pdf" title="문서가 아직 없습니다.">
              전사는 준비됐고 문서를 만드는 중입니다.
            </EmptyState>
          )}
        </div>
      </section>
    ),
    side: (
      <section className={s.pane} aria-labelledby="pane-side">
        <h2 id="pane-side" className={s.paneTitle}>
          자료
        </h2>
        <SidePane recordingId={rec.id} assets={detail.assets} ready={rec.status === "ready" || rec.status === "partial"} />
      </section>
    ),
  };

  return (
    <PlaybackProvider clock={clock} segments={t.segments} gaps={t.gaps} speakers={t.speakers}>
      <div className={s.page}>
        {header}
        {rec.status === "partial" && (
          <p className={s.partialNote} role="note">
            <Icon name="alert" />
            일부 구간을 전사하지 못했습니다. 빠진 구간은 전사와 문서에 표시됩니다.
          </p>
        )}
        {wide ? (
          <div className={s.columns}>
            {panes.transcript}
            {panes.document}
            {panes.side}
          </div>
        ) : (
          <Tabs className={s.narrowTabs} defaultSelectedKey="document">
            <TabList className={s.tabList} aria-label="녹음 보기">
              <Tab id="transcript" className={s.tab}>
                전사
              </Tab>
              <Tab id="document" className={s.tab}>
                문서
              </Tab>
              <Tab id="side" className={s.tab}>
                자료
              </Tab>
            </TabList>
            <TabPanel id="transcript" className={s.narrowPanel}>
              {panes.transcript}
            </TabPanel>
            <TabPanel id="document" className={s.narrowPanel}>
              {panes.document}
            </TabPanel>
            <TabPanel id="side" className={s.narrowPanel}>
              {panes.side}
            </TabPanel>
          </Tabs>
        )}
        <AudioPlayer />
        {dialogs}
      </div>
    </PlaybackProvider>
  );
}

function ProcessingState({ detail }: { detail: RecordingDetail }) {
  const progress = useJobProgress(detail.active_job?.id).data;
  const rec = detail.recording;
  const label =
    rec.status === "uploading"
      ? "올리는 중…"
      : rec.status === "queued"
        ? "처리 대기 중…"
        : `${stageLabel(progress?.stage)}${progress?.progress != null ? ` · ${Math.round(progress.progress * 100)}%` : "…"}`;
  return (
    <div className={s.processing} aria-busy="true">
      <p className={s.processingTitle}>{label}</p>
      {progress?.progress != null && <Progress value={progress.progress} label="처리 진행률" valueLabel={label} />}
      <p className={uiStyles.hint}>처리가 끝나면 전사와 문서가 이 화면에 바로 표시됩니다.</p>
    </div>
  );
}

function FailedState() {
  return (
    <ErrorBox title="이 녹음을 처리하지 못했습니다.">파일이 재생되는지 확인한 뒤 다시 올리세요.</ErrorBox>
  );
}
