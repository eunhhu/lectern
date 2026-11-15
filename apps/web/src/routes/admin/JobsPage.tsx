// 관리 › 작업 (P5-12): jobs across workspaces, newest first, filtered by state and kind (both
// kept in the address, so the overview can link to `?state=failed`), fifty at a time with
// "더 보기". A row opens the job's timeline. The list has no start time: "걸린 시간" is from
// queued to finished, shown for finished jobs only.

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { errorMessage } from "../../api/errors.ts";
import { useAdminJobs } from "../../api/queries.ts";
import type { Job, JobKind, JobState } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { Badge, Button, ErrorBox, SelectField } from "../../ui/controls.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import { formatElapsed, formatUsd, JOB_KIND_LABEL, JOB_STATE_LABEL, jobElapsedMs } from "./format.ts";
import s from "./admin.module.css";

export interface AdminJobsSearch {
  state?: JobState;
  kind?: JobKind;
}

export const STATE_TONE = { queued: "neutral", running: "info", succeeded: "success", failed: "danger", canceled: "attention" } as const;

const STATE_OPTIONS = [
  { id: "all", label: "전체" },
  ...(["queued", "running", "failed", "succeeded", "canceled"] as const).map((st) => ({ id: st, label: JOB_STATE_LABEL[st] })),
];
const KIND_OPTIONS = [{ id: "all", label: "전체" }, ...(Object.keys(JOB_KIND_LABEL) as JobKind[]).map((k) => ({ id: k, label: JOB_KIND_LABEL[k] }))];

export function JobsPage() {
  usePageTitle("관리 · 작업");
  const search = useSearch({ from: "/_authed/admin/jobs" });
  const navigate = useNavigate();
  const jobs = useAdminJobs({ state: search.state, kind: search.kind });
  const now = new Date();
  const rows = jobs.data?.pages.flatMap((p) => p.items) ?? [];

  const setFilter = (key: "state" | "kind", value: string) => {
    const next: AdminJobsSearch = { state: search.state, kind: search.kind, [key]: value === "all" ? undefined : value };
    void navigate({ to: "/admin/jobs", search: next, replace: true });
  };

  const columns: Column<Job>[] = [
    {
      key: "kind",
      header: "종류",
      sortValue: (j) => JOB_KIND_LABEL[j.kind],
      cell: (j) => (
        <Link to="/admin/jobs/$jobId" params={{ jobId: j.id }} className={s.link}>
          {JOB_KIND_LABEL[j.kind]}
        </Link>
      ),
    },
    { key: "state", header: "상태", sortValue: (j) => JOB_STATE_LABEL[j.state], cell: (j) => <Badge tone={STATE_TONE[j.state]}>{JOB_STATE_LABEL[j.state]}</Badge> },
    { key: "workspace", header: "워크스페이스", cell: (j) => (j.workspace_id ? <span className={s.code}>{j.workspace_id}</span> : "시스템") },
    { key: "recording", header: "녹음", cell: (j) => (j.recording_id ? <span className={s.code}>{j.recording_id}</span> : "—") },
    { key: "created", header: "만든 시각", sortValue: (j) => Date.parse(j.created_at), cell: (j) => formatDateTime(j.created_at, now) },
    {
      key: "elapsed",
      header: "걸린 시간",
      align: "right",
      sortValue: (j) => jobElapsedMs(j),
      cell: (j) => {
        const ms = jobElapsedMs(j);
        return ms === null ? "—" : formatElapsed(ms);
      },
    },
    { key: "cost", header: "비용", align: "right", sortValue: (j) => j.spent_microusd, cell: (j) => formatUsd(j.spent_microusd) },
  ];

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>작업</h1>
      </header>
      <div className={s.filters}>
        <SelectField label="상태" items={STATE_OPTIONS} selectedKey={search.state ?? "all"} onSelectionChange={(v) => setFilter("state", v)} />
        <SelectField label="종류" items={KIND_OPTIONS} selectedKey={search.kind ?? "all"} onSelectionChange={(v) => setFilter("kind", v)} />
      </div>
      {jobs.isError ? (
        <ErrorBox title={errorMessage(jobs.error, "작업을 불러오지 못했습니다.")} onRetry={() => void jobs.refetch()} />
      ) : (
        <DataTable
          caption="작업"
          columns={columns}
          rows={rows}
          rowKey={(j) => j.id}
          empty={jobs.isPending ? "불러오는 중…" : "조건에 맞는 작업이 없습니다."}
          onRowClick={(j) => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: j.id } })}
        />
      )}
      {jobs.hasNextPage && (
        <div className={s.more}>
          <Button onPress={() => void jobs.fetchNextPage()} isDisabled={jobs.isFetchingNextPage}>
            {jobs.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
          </Button>
        </div>
      )}
    </>
  );
}
