// 관리 › 개요 (P5-12): the numbers the old console's overview shows (users, recordings,
// audio on disk) from `GET /api/admin/overview`, and job counts by state from the v2 job
// list. The failed count links to the failed jobs.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAdminJobCount, useAdminOverview } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount } from "../../lib/format.ts";
import { ErrorBox } from "../../ui/controls.tsx";
import { errorMessage } from "../../api/errors.ts";
import s from "./admin.module.css";

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className={s.card}>
      <span className={s.cardLabel}>{label}</span>
      <span className={s.cardValue}>{children}</span>
    </li>
  );
}

function JobCount({ state }: { state: "queued" | "running" | "failed" }) {
  const q = useAdminJobCount(state);
  if (!q.data) return <>{q.isError ? "—" : "…"}</>;
  return <>{`${formatCount(q.data.count)}${q.data.more ? "+" : ""}`}</>;
}

export function OverviewPage() {
  usePageTitle("관리 · 개요");
  const overview = useAdminOverview();
  const m = overview.data?.metrics;
  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>개요</h1>
      </header>
      {overview.isError && <ErrorBox title={errorMessage(overview.error, "개요를 불러오지 못했습니다.")} onRetry={() => void overview.refetch()} />}
      <h2 className={s.subheading}>사용자와 녹음</h2>
      <ul className={s.cards} role="list" aria-label="사용자와 녹음">
        <Card label="전체 사용자">{m ? formatCount(m.totalUsers) : "…"}</Card>
        <Card label="활성 사용자">{m ? formatCount(m.activeUsers) : "…"}</Card>
        <Card label="승인 대기">{m ? formatCount(m.pendingUsers) : "…"}</Card>
        <Card label="정지된 사용자">{m ? formatCount(m.suspendedUsers) : "…"}</Card>
        <Card label="녹음">{m ? formatCount(m.totalLectures) : "…"}</Card>
        <Card label="공개 녹음">{m ? formatCount(m.publicLectures) : "…"}</Card>
        <Card label="오류 난 녹음">{m ? formatCount(m.errorLectures) : "…"}</Card>
        <Card label="오디오 저장 용량">{m ? formatBytes(m.totalAudioBytes) : "…"}</Card>
      </ul>
      <h2 className={s.subheading}>작업</h2>
      <ul className={s.cards} role="list" aria-label="작업">
        <Card label="대기 중인 작업">
          <JobCount state="queued" />
        </Card>
        <Card label="실행 중인 작업">
          <JobCount state="running" />
        </Card>
        <Card label="실패한 작업">
          <Link to="/admin/jobs" search={{ state: "failed" }}>
            <JobCount state="failed" />
            <span className={s.srOnly}>개, 실패한 작업 보기</span>
          </Link>
        </Card>
      </ul>
    </>
  );
}
