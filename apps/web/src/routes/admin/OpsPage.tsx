// 관리 › 운영 (P5-13): the old console's 운영 정보 (the bottom of its 설정 view) and its 작업
// view, both from `GET /api/admin/ops`, read again every five seconds while the tab is
// visible: maintenance (interval, last run and its summary, "유지보수 지금 실행"), backups,
// the last deploy, the server, the database, and the v1 job queue (distill and compact:
// numbers, running, queued, recently finished). The v2 job list is 작업 (P5-12).
// `?run=maintenance` (from the command palette) asks to run maintenance on arrival.

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { AdminOps, FinishedJob, OpsJob } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminOps } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatDateTime, formatRelative } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox } from "../../ui/controls.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import { MaintenanceResultTable, StatTable, useAdminFlows } from "./flows.tsx";
import { formatElapsed, lectureStageLabel } from "./format.ts";
import s from "./admin.module.css";

export interface AdminOpsSearch {
  run?: "maintenance";
}

export const OPS_POLL_MS = 5_000;

/** The v1 queue's kinds; anything else (a v2 "index" job) shows as it comes. */
export function opsKindLabel(kind: string): string {
  return kind === "distill" ? "노트 생성" : kind === "compact" ? "압축" : kind;
}

const short = (sha: string) => sha.slice(0, 7) || "—";

export function OpsPage() {
  usePageTitle("관리 · 운영");
  const ops = useAdminOps({ pollMs: OPS_POLL_MS });
  const flows = useAdminFlows();
  const search = useSearch({ from: "/_authed/admin/ops" });
  const navigate = useNavigate();
  const running = ops.data?.maintenance.running ?? false;

  const started = useRef(false);
  useEffect(() => {
    if (search.run !== "maintenance") {
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    void navigate({ to: "/admin/ops", search: {}, replace: true });
    void flows.start("maintenance");
  }, [search.run, flows, navigate]);

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>운영</h1>
        <div className={s.headerActions}>
          <Button onPress={() => void flows.start("maintenance")} isDisabled={flows.busy !== null || running || !ops.data}>
            <Icon name="settings" size={16} />
            {flows.busy === "maintenance" ? "실행 중…" : "유지보수 지금 실행"}
          </Button>
        </div>
      </header>
      {ops.isError && !ops.data ? (
        <ErrorBox title={errorMessage(ops.error, "운영 정보를 불러오지 못했습니다.")} onRetry={() => void ops.refetch()} />
      ) : ops.data ? (
        <OpsBody o={ops.data} />
      ) : null}
      {flows.dialogs}
    </>
  );
}

function OpsBody({ o }: { o: AdminOps }) {
  const now = new Date();
  const mt = o.maintenance;
  const lr = mt.lastResult;
  const bk = o.backups;
  const dp = o.deploy.lastResult;
  const sv = o.server;
  const db = o.database;

  return (
    <div className={s.panels}>
      <section className={s.panel} aria-labelledby="ops-maintenance">
        <div className={s.panelHeader}>
          <h2 id="ops-maintenance" className={s.panelTitle}>
            유지보수
          </h2>
          {mt.running && <Badge tone="info">실행 중</Badge>}
        </div>
        <StatTable
          label="유지보수"
          rows={[
            ["주기", `${formatCount(mt.intervalMin)}분마다`],
            ["마지막 실행", mt.lastRunAt ? `${formatRelative(mt.lastRunAt, now)} (${formatDateTime(mt.lastRunAt, now)})` : "없음"],
            [
              "요약",
              lr
                ? `세션 ${formatCount(lr.expiredSessions)} · 고아 파일 ${formatCount(lr.orphanFiles.count)} · 보존 ${formatCount(lr.retention.count + lr.failedRetention.count)}${lr.errors.length ? ` · 오류 ${formatCount(lr.errors.length)}` : ""}`
                : "기록 없음",
            ],
          ]}
        />
        {lr && lr.errors.length > 0 && (
          <div className={s.callout} role="note" aria-label="마지막 유지보수 오류">
            <Icon name="alert" size={16} />
            <div>
              {lr.errors.map((e) => (
                <p key={e} className={s.pre}>
                  {e}
                </p>
              ))}
            </div>
          </div>
        )}
        {lr && (
          <details>
            <summary>마지막 결과 자세히</summary>
            <MaintenanceResultTable result={lr} />
          </details>
        )}
      </section>

      <section className={s.panel} aria-labelledby="ops-backups">
        <h2 id="ops-backups" className={s.panelTitle}>
          백업
        </h2>
        {bk.latest ? (
          <StatTable
            label="백업"
            rows={[
              ["최신 백업", <span className={s.code}>{bk.latest.file}</span>],
              ["크기", formatBytes(bk.latest.sizeBytes)],
              ["만든 시각", `${formatRelative(bk.latest.createdAt, now)} (${formatDateTime(bk.latest.createdAt, now)})`],
              ["보관", `${formatCount(bk.count)}개 보관 중 (최대 ${formatCount(bk.keep)}개) · ${formatBytes(bk.totalBytes)}`],
            ]}
          />
        ) : (
          <p className={s.warn}>
            <Icon name="alert" size={16} /> 아직 백업이 없습니다. 유지보수를 실행하면 백업이 생성됩니다.
          </p>
        )}
      </section>

      <section className={s.panel} aria-labelledby="ops-deploy">
        <h2 id="ops-deploy" className={s.panelTitle}>
          배포
        </h2>
        {o.deploy.inProgress ? (
          <p>
            <Badge tone="info">배포 진행 중…</Badge>
          </p>
        ) : dp ? (
          <>
            <StatTable
              label="배포"
              rows={[
                ["결과", dp.ok ? <Badge tone="success">성공</Badge> : <Badge tone="danger">실패</Badge>],
                ["커밋", <span className={s.code}>{short(dp.sha)}</span>],
                ["시각", `${formatRelative(dp.at, now)} (${formatDateTime(dp.at, now)})`],
              ]}
            />
            {dp.error && <p className={`${s.pre} ${s.callout}`}>{dp.error}</p>}
          </>
        ) : (
          <p className={s.muted}>배포 기록이 없습니다.</p>
        )}
      </section>

      <section className={s.panel} aria-labelledby="ops-server">
        <h2 id="ops-server" className={s.panelTitle}>
          서버
        </h2>
        <StatTable
          label="서버"
          rows={[
            ["커밋", <span className={s.code}>{short(sv.gitSha)}</span>],
            ["가동 시간", formatElapsed(sv.uptimeSec * 1000)],
            ["메모리", `${formatBytes(sv.memory.rssBytes)} (힙 ${formatBytes(sv.memory.heapUsedBytes)})`],
            ["Bun", sv.bunVersion || "—"],
            ["플랫폼", sv.platform || "—"],
            ["PID", String(sv.pid)],
            ["ffmpeg", sv.ffmpegAvailable ? "사용 가능" : <Badge tone="danger">없음</Badge>],
            ["요청", `${formatCount(sv.requests.total)}${sv.requests.errors5xx ? ` (5xx ${formatCount(sv.requests.errors5xx)})` : ""}`],
          ]}
        />
      </section>

      <section className={s.panel} aria-labelledby="ops-database">
        <h2 id="ops-database" className={s.panelTitle}>
          데이터베이스
        </h2>
        <StatTable
          label="데이터베이스"
          rows={[
            ["크기", `${formatBytes(db.sizeBytes)} (WAL ${formatBytes(db.walBytes)})`],
            ["사용자", formatCount(db.users)],
            ["강의", formatCount(db.lectures)],
            ["세션", formatCount(db.sessions)],
            ["감사 로그", formatCount(db.auditLogs)],
          ]}
        />
      </section>

      <V1Jobs jobs={o.jobs} now={now} />
    </div>
  );
}

function LectureLink({ id, title }: { id: string; title: string }) {
  return id ? (
    <Link to="/admin/recordings/$lectureId" params={{ lectureId: id }} className={s.link}>
      {title || "제목 없음"}
    </Link>
  ) : (
    <>{title || "—"}</>
  );
}

function V1Jobs({ jobs, now }: { jobs: AdminOps["jobs"]; now: Date }) {
  const oldest = jobs.queued.reduce<string | null>((m, j) => (!m || Date.parse(j.enqueuedAt) < Date.parse(m) ? j.enqueuedAt : m), null);
  const d = jobs.last24h;

  const live = (state: "running" | "queued"): Column<OpsJob>[] => [
    { key: "kind", header: "종류", sortValue: (j) => opsKindLabel(j.kind), cell: (j) => <Badge>{opsKindLabel(j.kind)}</Badge> },
    { key: "lecture", header: "강의", sortValue: (j) => j.lectureTitle, cell: (j) => <LectureLink id={j.lectureId} title={j.lectureTitle} /> },
    { key: "owner", header: "소유자", sortValue: (j) => j.ownerEmail, cell: (j) => j.ownerEmail || "—" },
    state === "running"
      ? {
          key: "stage",
          header: "단계",
          cell: (j) => `${j.kind === "distill" ? `${lectureStageLabel(j.stage, "processing")} · ${j.progress}%` : lectureStageLabel(j.stage, "processing")}`,
        }
      : { key: "stage", header: "단계", cell: () => "대기 중" },
    {
      key: "time",
      header: state === "running" ? "시작" : "들어온 시각",
      sortValue: (j) => Date.parse((state === "running" ? j.startedAt : j.enqueuedAt) ?? j.enqueuedAt),
      cell: (j) => formatRelative((state === "running" ? j.startedAt : j.enqueuedAt) ?? j.enqueuedAt, now),
    },
  ];
  const finished: Column<FinishedJob>[] = [
    { key: "ok", header: "결과", sortValue: (j) => (j.ok ? 1 : 0), cell: (j) => (j.ok ? <Badge tone="success">성공</Badge> : <Badge tone="danger">실패</Badge>) },
    { key: "kind", header: "종류", sortValue: (j) => opsKindLabel(j.kind), cell: (j) => opsKindLabel(j.kind) },
    {
      key: "lecture",
      header: "강의",
      sortValue: (j) => j.lectureTitle,
      cell: (j) => (
        <span className={s.person}>
          <LectureLink id={j.lectureId} title={j.lectureTitle} />
          {!j.ok && j.error && <span className={s.stageError}>{j.error}</span>}
          {j.ok && j.kind === "compact" && j.savedBytes > 0 && <span className={s.muted}>−{formatBytes(j.savedBytes)}</span>}
        </span>
      ),
    },
    { key: "owner", header: "소유자", sortValue: (j) => j.ownerEmail, cell: (j) => j.ownerEmail || "—" },
    { key: "took", header: "걸린 시간", align: "right", sortValue: (j) => j.durationMs, cell: (j) => formatElapsed(j.durationMs) },
    { key: "finished", header: "끝난 시각", sortValue: (j) => Date.parse(j.finishedAt), cell: (j) => formatRelative(j.finishedAt, now) },
  ];

  return (
    <section className={`${s.panel} ${s.panelWide}`} aria-labelledby="ops-jobs">
      <div className={s.panelHeader}>
        <h2 id="ops-jobs" className={s.panelTitle}>
          v1 작업
        </h2>
        <span className={s.muted}>노트 정리와 오디오 압축 대기열. v2 작업은 작업 탭에 있습니다.</span>
      </div>
      <ul className={s.cards} role="list" aria-label="v1 작업 수치">
        <li className={s.card}>
          <span className={s.cardLabel}>실행 중</span>
          <span className={s.cardValue}>{formatCount(jobs.running.length)}</span>
          <span className={s.muted}>
            동시 실행 · 노트 {formatCount(jobs.concurrency.distill)} · 압축 {formatCount(jobs.concurrency.compact)}
          </span>
        </li>
        <li className={s.card}>
          <span className={s.cardLabel}>대기 중</span>
          <span className={s.cardValue}>{formatCount(jobs.queued.length)}</span>
          <span className={s.muted}>{oldest ? `가장 오래된 대기 ${formatRelative(oldest, now)}` : "대기 중인 작업 없음"}</span>
        </li>
        <li className={s.card}>
          <span className={s.cardLabel}>24시간 완료</span>
          <span className={s.cardValue}>{formatCount(d.completed)}</span>
          <span className={s.muted}>실패 {formatCount(d.failed)}</span>
        </li>
        <li className={s.card}>
          <span className={s.cardLabel}>평균 처리 시간</span>
          <span className={s.cardValue}>{d.avgDurationMs ? formatElapsed(d.avgDurationMs) : "—"}</span>
          <span className={s.muted}>최근 24시간 기준</span>
        </li>
      </ul>
      <h3 className={s.panelTitle}>실행 중 ({formatCount(jobs.running.length)})</h3>
      <DataTable caption="실행 중인 v1 작업" columns={live("running")} rows={jobs.running} rowKey={(j) => j.id} empty="실행 중인 작업이 없습니다." />
      <h3 className={s.panelTitle}>대기 중 ({formatCount(jobs.queued.length)})</h3>
      <DataTable caption="대기 중인 v1 작업" columns={live("queued")} rows={jobs.queued} rowKey={(j) => j.id} empty="대기 중인 작업이 없습니다." />
      <h3 className={s.panelTitle}>최근 완료 ({formatCount(jobs.recent.length)})</h3>
      <DataTable caption="최근 완료된 v1 작업" columns={finished} rows={jobs.recent} rowKey={(j) => j.id} empty="최근 완료된 작업이 없습니다." />
    </section>
  );
}
