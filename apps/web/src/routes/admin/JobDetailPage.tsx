// 관리 › 작업 상세 (P5-12, AI_HARNESS §9): one job's stage timeline and model calls. Each
// stage is a row with its state, start, run time, attempts, cost (its calls added up) and
// error code; the bar's length is the run time against the longest stage, and the time is
// written out too. A failed or canceled job can be retried, after asking.

import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ApiClientError } from "../../api/client.ts";
import { errorMessage, isNotReady } from "../../api/errors.ts";
import { useAdminJob, useRetryJob } from "../../api/queries.ts";
import type { AiCall, StageRun } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatCount, formatDateTime, formatTimeOfDay } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox, ModalDialog } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { DataTable, type Column } from "./DataTable.tsx";
import { formatElapsed, formatUsd, JOB_KIND_LABEL, JOB_STATE_LABEL, STAGE_STATE_LABEL, stageElapsedMs } from "./format.ts";
import { STATE_TONE } from "./JobsPage.tsx";
import s from "./admin.module.css";

export function JobDetailPage() {
  const { jobId } = useParams({ from: "/_authed/admin/jobs/$jobId" });
  const detail = useAdminJob(jobId);
  const retry = useRetryJob();
  const [asking, setAsking] = useState(false);
  const job = detail.data?.job;
  usePageTitle(job ? `관리 · ${JOB_KIND_LABEL[job.kind]} 작업` : "관리 · 작업");
  const now = new Date();

  const runRetry = async () => {
    setAsking(false);
    try {
      await retry.mutateAsync(jobId);
      showToast({ title: "작업을 다시 대기열에 넣었습니다." });
    } catch (err) {
      if (isNotReady(err)) showToast({ title: "준비 중입니다.", tone: "info" });
      else if (err instanceof ApiClientError && err.status === 409) showToast({ title: errorMessage(err), tone: "danger" });
      else toastError("작업을 다시 시도하지 못했습니다.", err);
    }
  };

  if (detail.isError) {
    return (
      <>
        <BackLink />
        <ErrorBox title={errorMessage(detail.error, "작업을 불러오지 못했습니다.")} onRetry={() => void detail.refetch()} />
      </>
    );
  }
  if (!detail.data || !job) return <BackLink />;

  const { stage_runs: runs, ai_calls: calls } = detail.data;
  const stageOf = new Map(runs.map((r) => [r.id, r.stage]));
  const costOf = (run: StageRun) => calls.filter((c) => c.stage_run_id === run.id).reduce((n, c) => n + c.cost_microusd, 0);
  const longest = Math.max(1, ...runs.map((r) => stageElapsedMs(r, now.getTime()) ?? 0));
  const canRetry = job.state === "failed" || job.state === "canceled";

  const callColumns: Column<AiCall>[] = [
    { key: "stage", header: "단계", sortValue: (c) => stageOf.get(c.stage_run_id) ?? null, cell: (c) => <span className={s.code}>{stageOf.get(c.stage_run_id) ?? "—"}</span> },
    { key: "model", header: "모델", sortValue: (c) => c.model, cell: (c) => <span className={s.code}>{c.model}</span> },
    { key: "in", header: "입력 토큰", align: "right", sortValue: (c) => c.input_tokens, cell: (c) => formatCount(c.input_tokens) },
    { key: "out", header: "출력 토큰", align: "right", sortValue: (c) => c.output_tokens, cell: (c) => formatCount(c.output_tokens) },
    { key: "audio", header: "오디오(초)", align: "right", sortValue: (c) => c.audio_seconds, cell: (c) => formatCount(Math.round(c.audio_seconds)) },
    { key: "cost", header: "비용", align: "right", sortValue: (c) => c.cost_microusd, cell: (c) => formatUsd(c.cost_microusd) },
    { key: "latency", header: "지연", align: "right", sortValue: (c) => c.latency_ms, cell: (c) => formatElapsed(c.latency_ms) },
    { key: "status", header: "상태", sortValue: (c) => c.status, cell: (c) => (c.status === "ok" ? "정상" : <Badge tone="danger">{c.error_code ?? c.status}</Badge>) },
  ];

  return (
    <>
      <BackLink />
      <header className={s.header}>
        <h1 className={s.title}>{JOB_KIND_LABEL[job.kind]} 작업</h1>
        <Badge tone={STATE_TONE[job.state]}>{JOB_STATE_LABEL[job.state]}</Badge>
        {canRetry && (
          <div className={s.headerActions}>
            <Button variant="primary" onPress={() => setAsking(true)} isDisabled={retry.isPending}>
              다시 시도
            </Button>
          </div>
        )}
      </header>
      <dl className={s.facts}>
        <div>
          <dt>작업 id</dt>
          <dd className={s.code}>{job.id}</dd>
        </div>
        <div>
          <dt>워크스페이스</dt>
          <dd className={s.code}>{job.workspace_id ?? "시스템"}</dd>
        </div>
        <div>
          <dt>녹음</dt>
          <dd className={s.code}>{job.recording_id ?? "—"}</dd>
        </div>
        <div>
          <dt>만든 시각</dt>
          <dd>{formatDateTime(job.created_at, now)}</dd>
        </div>
        <div>
          <dt>시도</dt>
          <dd>{formatCount(job.attempts)}회</dd>
        </div>
        <div>
          <dt>비용</dt>
          <dd>
            {formatUsd(job.spent_microusd)}
            {job.budget_microusd !== null && <span className={s.muted}> / 예산 {formatUsd(job.budget_microusd)}</span>}
          </dd>
        </div>
        <div>
          <dt>오류 코드</dt>
          <dd className={s.code}>{job.error_code ?? "없음"}</dd>
        </div>
      </dl>

      <h2 className={s.subheading}>단계</h2>
      {runs.length === 0 ? (
        <p className={s.muted}>기록된 단계가 없습니다.</p>
      ) : (
        <ol className={s.timeline} aria-label="단계 타임라인">
          {runs.map((run) => {
            const ms = stageElapsedMs(run, now.getTime());
            const ratio = ms === null ? 0 : ms / longest;
            return (
              <li key={run.id} className={s.stage} data-state={run.state}>
                <span>
                  <span className={s.stageName}>{run.stage}</span>
                  {run.chunk_index !== null && <span className={s.muted}> #{run.chunk_index + 1}</span>}
                  <br />
                  <Badge tone={run.state === "failed" ? "danger" : run.state === "succeeded" ? "success" : "neutral"}>{STAGE_STATE_LABEL[run.state]}</Badge>
                </span>
                <span className={s.stageMeta}>
                  {run.started_at ? `${formatTimeOfDay(run.started_at)} 시작` : "시작 전"} · 걸린 시간 {ms === null ? "0초" : formatElapsed(ms)}
                  <br />
                  시도 {formatCount(run.attempts)}회 · 비용 {formatUsd(costOf(run))}
                  {run.cache_hit && " · 캐시"}
                </span>
                <span className={s.stageBar} aria-hidden="true">
                  <span className={s.stageFill} ref={(el) => el?.style.setProperty("width", `${Math.round(ratio * 1000) / 10}%`)} />
                </span>
                {run.error && (
                  <span className={s.stageError}>
                    <Icon name="alert" size={14} /> {run.error.code}: {run.error.message}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <h2 className={s.subheading}>AI 호출</h2>
      <DataTable caption="AI 호출" columns={callColumns} rows={calls} rowKey={(c) => c.id} empty="AI 호출이 없습니다." />

      <ModalDialog
        isOpen={asking}
        onOpenChange={setAsking}
        title="다시 시도"
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setAsking(false)} autoFocus>
              취소
            </Button>
            <Button variant="primary" onPress={runRetry}>
              다시 시도
            </Button>
          </>
        }
      >
        <p>이 작업을 다시 시도할까요?</p>
      </ModalDialog>
    </>
  );
}

function BackLink() {
  return (
    <Link to="/admin/jobs" className={s.link}>
      ← 작업 목록
    </Link>
  );
}
