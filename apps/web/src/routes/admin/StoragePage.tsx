// 관리 › 저장소 (P5-13): the old console's 스토리지 view (`GET /api/admin/storage`, the disk
// from `GET /api/admin/ops`): the numbers, the compaction card (전체 압축), the reclaimable
// space (보존 정책 정리, 고아 파일 → 휴지통, the trash), breakdowns by format, status and
// user (bars with the numbers in text), and the largest recordings with 압축 and 오디오
// 삭제. The three runs preview first (flows.tsx). `?run=compact|gc|retention` (from the
// command palette) starts one on arrival.

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { AdminStorage } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminLectureAction, useAdminOps, useAdminStorage, useRefreshAdmin } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatDateTime } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox, ModalDialog, Progress } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { DataTable, type Column } from "./DataTable.tsx";
import { useAdminFlows, StatTable, type FlowKind } from "./flows.tsx";
import { formatSeconds, LECTURE_STATUS_LABEL } from "./format.ts";
import s from "./admin.module.css";

export interface AdminStorageSearch {
  run?: Exclude<FlowKind, "maintenance">;
}

type Largest = AdminStorage["largest"][number];

/** "녹음 1시간당 약 18 MB" (the old console's estimate: kbps × 0.45). */
export function bitrateHint(kbps: number): string {
  return `녹음 1시간당 약 ${Math.round(kbps * 0.45 * 10) / 10} MB`;
}

const countBytes = (c: { count: number; bytes: number }) => `${formatCount(c.count)}개 · ${formatBytes(c.bytes)}`;
const extLabel = (ext: string) => (ext ? ext.replace(/^\./, "").toUpperCase() : "없음");

export interface Bar {
  key: string;
  label: React.ReactNode;
  value: number;
  text: string;
  tone?: "danger" | "attention" | "success";
}

/** Horizontal bars, each with its numbers written out (the bar alone says nothing to a reader). */
export function Bars({ label, bars }: { label: string; bars: Bar[] }) {
  if (!bars.length) return <p className={s.muted}>데이터가 없습니다.</p>;
  const max = Math.max(...bars.map((b) => b.value), 0);
  return (
    <ul className={s.bars} aria-label={label}>
      {bars.map((b) => (
        <li key={b.key} className={s.barRow} data-tone={b.tone}>
          <span className={s.barLabel}>{b.label}</span>
          <span className={s.stageBar} aria-hidden="true">
            <span className={s.stageFill} ref={(el) => el?.style.setProperty("width", `${max > 0 ? Math.round((b.value / max) * 1000) / 10 : 0}%`)} />
          </span>
          <span className={s.barValue}>{b.text}</span>
        </li>
      ))}
    </ul>
  );
}

const usageTone = (pct: number | null): Bar["tone"] => (pct === null ? undefined : pct >= 90 ? "danger" : pct >= 75 ? "attention" : undefined);

export function StoragePage() {
  usePageTitle("관리 · 저장소");
  const storage = useAdminStorage();
  const ops = useAdminOps();
  const flows = useAdminFlows();
  const search = useSearch({ from: "/_authed/admin/storage" });
  const navigate = useNavigate();

  // A run asked for in the address (the command palette) starts once, after the numbers
  // are in (the compaction preview checks ffmpeg there). Once the address is clear again the
  // next one can start, while the page stays open.
  const started = useRef(false);
  useEffect(() => {
    if (!search.run) {
      started.current = false;
      return;
    }
    if (started.current || !storage.data) return;
    started.current = true;
    const run = search.run;
    void navigate({ to: "/admin/storage", search: {}, replace: true });
    void flows.start(run);
  }, [search.run, storage.data, flows, navigate]);

  if (storage.isError) {
    return (
      <>
        <Header />
        <ErrorBox title={errorMessage(storage.error, "저장소 정보를 불러오지 못했습니다.")} onRetry={() => void storage.refetch()} />
      </>
    );
  }
  const st = storage.data;
  if (!st) return <Header />;
  return (
    <>
      <Header />
      <StorageBody st={st} disk={ops.data?.disk ?? null} diskError={ops.isError} flows={flows} />
      {flows.dialogs}
    </>
  );
}

function Header() {
  return (
    <header className={s.header}>
      <h1 className={s.title}>저장소</h1>
    </header>
  );
}

function StorageBody({
  st,
  disk,
  diskError,
  flows,
}: {
  st: AdminStorage;
  disk: { totalBytes: number; freeBytes: number; usedPct: number; low: boolean } | null;
  diskError: boolean;
  flows: ReturnType<typeof useAdminFlows>;
}) {
  const now = new Date();
  const c = st.compaction;
  const r = st.reclaimable;
  const ffOk = c.ffmpegAvailable;
  const failedDays = st.settings.failed_audio_retention_days;
  const busy = flows.busy !== null;
  const label = (kind: FlowKind, text: string) => (flows.busy === kind ? "실행 중…" : text);

  return (
    <>
      <ul className={s.cards} role="list" aria-label="저장소 수치">
        <li className={s.card}>
          <span className={s.cardLabel}>오디오</span>
          <span className={s.cardValue}>{formatBytes(st.totals.audioBytes)}</span>
          <span className={s.muted}>
            {formatCount(st.totals.withAudio)}개 녹음 · 강의 {formatCount(st.totals.lectures)}개
          </span>
        </li>
        <li className={s.card}>
          <span className={s.cardLabel}>업로드 폴더</span>
          <span className={s.cardValue}>{formatBytes(st.totals.uploadsBytes)}</span>
          <span className={s.muted}>{formatCount(st.totals.uploadsFiles)}개 파일 (고아 파일 포함)</span>
        </li>
        <li className={s.card}>
          <span className={s.cardLabel}>디스크</span>
          {disk ? (
            <>
              <span className={s.cardValue}>{formatBytes(disk.freeBytes)} 여유</span>
              <Progress value={Math.min(1, disk.usedPct / 100)} label="디스크 사용률" valueLabel={`${Math.round(disk.usedPct)}% 사용 · 전체 ${formatBytes(disk.totalBytes)}`} />
            </>
          ) : (
            <span className={s.muted}>{diskError ? "측정할 수 없음" : "확인 중…"}</span>
          )}
        </li>
        <li className={s.card}>
          <span className={s.cardLabel}>압축으로 절약</span>
          <span className={s.cardValue}>{formatBytes(c.savedBytesTotal)}</span>
          <span className={s.muted}>{formatCount(c.compactedCount)}개 녹음 압축됨</span>
        </li>
      </ul>

      <div className={s.panels}>
        <section className={s.panel} aria-labelledby="storage-compaction">
          <div className={s.panelHeader}>
            <h2 id="storage-compaction" className={s.panelTitle}>
              압축
            </h2>
            {!ffOk ? <Badge tone="danger">ffmpeg 없음</Badge> : c.enabled ? <Badge tone="success">자동 압축 켜짐</Badge> : <Badge>자동 압축 꺼짐</Badge>}
          </div>
          <StatTable
            label="압축"
            rows={[
              ["비트레이트", c.bitrateKbps ? `${formatCount(c.bitrateKbps)} kbps · ${bitrateHint(c.bitrateKbps)}` : "—"],
              ["압축 대상", `${formatCount(c.candidates)}개 · ${formatBytes(c.candidateBytes)}`],
              ["예상 절약", c.estimatedSavedBytes ? `약 ${formatBytes(c.estimatedSavedBytes)}` : "—"],
              ["압축 완료", `${formatCount(c.compactedCount)}개 · ${formatBytes(c.savedBytesTotal)} 절약`],
              ["진행 상황", `실행 ${formatCount(c.running)} · 대기 ${formatCount(c.queued)}`],
            ]}
          />
          {!ffOk && (
            <div className={s.callout} role="note">
              <Icon name="alert" size={16} />
              <span>서버에서 ffmpeg를 찾을 수 없어 압축할 수 없습니다.</span>
            </div>
          )}
          <div className={s.actions}>
            <Button variant="primary" onPress={() => void flows.start("compact")} isDisabled={busy || !ffOk || !c.candidates}>
              {label("compact", "전체 압축")}
            </Button>
            <Link to="/admin/settings" className={s.link}>
              설정 변경
            </Link>
          </div>
        </section>

        <section className={s.panel} aria-labelledby="storage-reclaim">
          <h2 id="storage-reclaim" className={s.panelTitle}>
            회수 가능 공간
          </h2>
          <div className={s.reclaim}>
            <div className={s.reclaimText}>
              <span>실패한 강의의 오디오</span>
              <span className={s.muted}>
                {countBytes(r.failedAudio)}
                {failedDays ? ` · ${formatCount(failedDays)}일 지나면 강의째 삭제` : " · 정리 정책 꺼짐"}
              </span>
            </div>
            <Link to="/admin/recordings" search={{ status: "error" }} className={s.link}>
              목록
            </Link>
            <Button size="sm" aria-label="정리: 실패한 강의의 오디오" onPress={() => void flows.start("retention")} isDisabled={busy || !r.failedAudio.count || !failedDays}>
              {label("retention", "정리")}
            </Button>
          </div>
          <div className={s.reclaim}>
            <div className={s.reclaimText}>
              <span>보존 기간이 지난 오디오</span>
              <span className={s.muted}>{r.retention.days ? `${countBytes(r.retention)} · ${formatCount(r.retention.days)}일 경과, 노트는 유지` : "보존 정책 꺼짐"}</span>
            </div>
            <Button size="sm" aria-label="정리: 보존 기간이 지난 오디오" onPress={() => void flows.start("retention")} isDisabled={busy || !r.retention.days || !r.retention.count}>
              {label("retention", "정리")}
            </Button>
          </div>
          <div className={s.reclaim}>
            <div className={s.reclaimText}>
              <span>고아 파일</span>
              <span className={s.muted}>{countBytes(r.orphans)} · 어떤 강의도 참조하지 않는 업로드</span>
            </div>
            <Button size="sm" onPress={() => void flows.start("gc")} isDisabled={busy || !r.orphans.count}>
              {label("gc", "휴지통으로 이동")}
            </Button>
          </div>
          <div className={s.reclaim}>
            <div className={s.reclaimText}>
              <span>휴지통</span>
              <span className={s.muted}>
                {countBytes(st.trash)} · {formatCount(st.trash.retentionDays || 7)}일 후 자동 삭제
              </span>
            </div>
          </div>
        </section>

        <section className={s.panel} aria-labelledby="storage-format">
          <h2 id="storage-format" className={s.panelTitle}>
            형식별
          </h2>
          <Bars label="형식별 용량" bars={st.byFormat.map((f) => ({ key: f.ext, label: <span className={s.code}>{extLabel(f.ext)}</span>, value: f.bytes, text: countBytes(f) }))} />
        </section>

        <section className={s.panel} aria-labelledby="storage-status">
          <h2 id="storage-status" className={s.panelTitle}>
            상태별
          </h2>
          <Bars
            label="상태별 용량"
            bars={st.byStatus.map((b) => ({
              key: b.status,
              label: LECTURE_STATUS_LABEL[b.status as keyof typeof LECTURE_STATUS_LABEL] ?? b.status,
              value: b.audioBytes,
              text: `${formatCount(b.count)}개 · ${formatBytes(b.audioBytes)}`,
              tone: b.status === "error" ? "danger" : b.status === "processing" ? "attention" : "success",
            }))}
          />
        </section>

        <section className={`${s.panel} ${s.panelWide}`} aria-labelledby="storage-users">
          <div className={s.panelHeader}>
            <h2 id="storage-users" className={s.panelTitle}>
              사용자별
            </h2>
            <span className={s.muted}>한도 대비 사용률</span>
          </div>
          <Bars
            label="사용자별 용량"
            bars={st.byUser.map((u) => ({
              key: u.userId,
              label: (
                <Link to="/admin/users/$userId" params={{ userId: u.userId }} className={s.link} title={u.email}>
                  {u.displayName || u.email}
                </Link>
              ),
              value: u.audioBytes,
              text: `${formatCount(u.lectureCount)}개 · ${formatBytes(u.audioBytes)} · ${u.usedPct === null ? "무제한" : `${Math.round(u.usedPct)}%`}`,
              tone: usageTone(u.usedPct),
            }))}
          />
        </section>

        <section className={`${s.panel} ${s.panelWide}`} aria-labelledby="storage-largest">
          <div className={s.panelHeader}>
            <h2 id="storage-largest" className={s.panelTitle}>
              가장 큰 녹음
            </h2>
            <span className={s.muted}>{formatCount(st.largest.length)}개</span>
          </div>
          <Largest rows={st.largest} now={now} />
        </section>
      </div>
    </>
  );
}

function Largest({ rows, now }: { rows: Largest[]; now: Date }) {
  const refresh = useRefreshAdmin();
  const compact = useAdminLectureAction((api, id) => api.admin.compactLectures([id]));
  const dropAudio = useAdminLectureAction((api, id) => api.admin.deleteLectureAudio(id));
  const [asking, setAsking] = useState<Largest | null>(null);
  const busy = compact.isPending || dropAudio.isPending;

  const runCompact = async (row: Largest) => {
    try {
      const r = await compact.mutateAsync(row.id);
      showToast(r.queued > 0 ? { title: `압축 대기열에 넣었습니다. 예상 절약 약 ${formatBytes(r.estimatedSavedBytes)}.` } : { title: "압축 대상이 아닙니다. 이미 압축되었거나 아직 완료되지 않은 녹음입니다.", tone: "info" });
      void refresh();
    } catch (err) {
      toastError("압축하지 못했습니다.", err);
    }
  };
  const runDropAudio = async () => {
    const row = asking;
    setAsking(null);
    if (!row) return;
    try {
      const r = await dropAudio.mutateAsync(row.id);
      showToast({ title: `오디오를 삭제했습니다. ${formatBytes(r.reclaimedBytes)} 확보.` });
      void refresh();
    } catch (err) {
      toastError("오디오를 삭제하지 못했습니다.", err);
    }
  };

  const columns: Column<Largest>[] = [
    {
      key: "title",
      header: "제목",
      sortValue: (l) => l.title,
      cell: (l) => (
        <span className={s.person}>
          <Link to="/admin/recordings/$lectureId" params={{ lectureId: l.id }} className={s.link}>
            {l.title || "제목 없음"}
          </Link>
          {l.course && <span className={s.muted}>{l.course}</span>}
        </span>
      ),
    },
    {
      key: "format",
      header: "형식",
      sortValue: (l) => l.ext,
      cell: (l) => (
        <span className={s.badges}>
          <Badge>{extLabel(l.ext)}</Badge>
          {l.compacted && <Badge tone="success">압축됨</Badge>}
        </span>
      ),
    },
    { key: "owner", header: "소유자", sortValue: (l) => l.ownerEmail, cell: (l) => l.ownerEmail || "—" },
    { key: "duration", header: "길이", align: "right", sortValue: (l) => l.durationSec, cell: (l) => formatSeconds(l.durationSec) },
    { key: "size", header: "크기", align: "right", sortValue: (l) => l.audioBytes, cell: (l) => formatBytes(l.audioBytes) },
    { key: "created", header: "만든 시각", sortValue: (l) => Date.parse(l.createdAt), cell: (l) => formatDateTime(l.createdAt, now) },
    {
      key: "actions",
      header: "동작",
      cell: (l) => (
        <span className={s.actions}>
          {!l.compacted && (
            <Button size="sm" aria-label={`압축: ${l.title}`} onPress={() => void runCompact(l)} isDisabled={busy}>
              압축
            </Button>
          )}
          <Button size="sm" variant="dangerText" aria-label={`오디오 삭제: ${l.title}`} onPress={() => setAsking(l)} isDisabled={busy}>
            오디오 삭제
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <DataTable caption="가장 큰 녹음" columns={columns} rows={rows} rowKey={(l) => l.id} empty="저장된 녹음이 없습니다." />
      <ModalDialog
        isOpen={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title="오디오 삭제"
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setAsking(null)} autoFocus>
              취소
            </Button>
            <Button variant="danger" onPress={() => void runDropAudio()}>
              오디오 삭제
            </Button>
          </>
        }
      >
        {asking && (
          <p>
            {asking.title || "제목 없음"}의 오디오 원본({formatBytes(asking.audioBytes)})을 영구 삭제합니다. 노트는 남지만 다시 듣거나 다시 분석할 수 없습니다.
          </p>
        )}
      </ModalDialog>
    </>
  );
}
