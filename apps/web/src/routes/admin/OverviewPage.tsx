// 관리 › 개요 (P5-12, P5-13): the numbers the old console's overview shows (users,
// recordings, audio on disk and the disk's free space) from `GET /api/admin/overview` and
// `/api/admin/ops`, job counts by state from the v2 job list (the failed count links to the
// failed jobs), what needs attention (ui.ts attentionItems: sign-ups waiting with 승인,
// failed recordings with 재시도, a low disk, a missing or old backup with 유지보수 실행,
// ffmpeg missing, recordings that can be compacted with 미리보기, maintenance errors, a
// failed deploy), and the last ten audit log rows. Like the old console it reads ops again
// every five seconds, the overview every thirty and storage every minute, while the tab is
// visible.

import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { AdminAuditLog } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminJobCount, useAdminLectureAction, useAdminOps, useAdminOverview, useAdminStorage, useUpdateAdminUser } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatRelative } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ErrorBox } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { AuditDetailDialog } from "./AuditPage.tsx";
import { useAdminFlows } from "./flows.tsx";
import { OPS_POLL_MS } from "./OpsPage.tsx";
import s from "./admin.module.css";

const OVERVIEW_POLL_MS = 30_000;
const STORAGE_POLL_MS = 60_000;
/** The old console called a backup old after a day and a half. */
const BACKUP_STALE_MS = 36 * 3_600_000;

function Card({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <li className={s.card}>
      <span className={s.cardLabel}>{label}</span>
      <span className={s.cardValue}>{children}</span>
      {note && <span className={s.muted}>{note}</span>}
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
  const overview = useAdminOverview(true, OVERVIEW_POLL_MS);
  const ops = useAdminOps({ pollMs: OPS_POLL_MS });
  const storage = useAdminStorage({ pollMs: STORAGE_POLL_MS });
  const flows = useAdminFlows();
  const [log, setLog] = useState<AdminAuditLog | null>(null);
  const m = overview.data?.metrics;
  const disk = ops.data?.disk;
  const now = new Date();
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
        <Card
          label="오디오 저장 용량"
          note={disk ? `디스크 여유 ${formatBytes(disk.freeBytes)} / ${formatBytes(disk.totalBytes)} (${Math.round(disk.usedPct)}% 사용)` : ops.isError ? "디스크 정보 없음" : "디스크 확인 중…"}
        >
          {m ? formatBytes(storage.data?.totals.audioBytes ?? m.totalAudioBytes) : "…"}
        </Card>
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

      <Attention flows={flows} opsFailed={ops.isError} storageFailed={storage.isError} />

      <div className={s.panelHeader}>
        <h2 className={s.subheading} id="overview-activity">
          최근 활동
        </h2>
        <Link to="/admin/audit" className={`${s.link} ${s.headerActions}`}>
          감사 로그 전체 보기
        </Link>
      </div>
      {overview.data &&
        (overview.data.auditLogs.length ? (
          <ul className={s.attention} aria-labelledby="overview-activity">
            {overview.data.auditLogs.slice(0, 10).map((a) => (
              <li key={a.id} className={s.attentionItem}>
                <span className={s.code}>{a.action}</span>
                <span className={s.attentionText}>
                  <span>{a.detail || "—"}</span>
                  <span className={s.muted}>{a.actor_email}</span>
                </span>
                <span className={s.muted}>{formatRelative(a.created_at, now)}</span>
                <Button size="sm" variant="ghost" aria-label={`자세히: ${a.action}, ${formatRelative(a.created_at, now)}`} onPress={() => setLog(a)}>
                  자세히
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.muted}>기록된 활동이 없습니다.</p>
        ))}
      <AuditDetailDialog log={log} onClose={() => setLog(null)} />
      {flows.dialogs}
    </>
  );
}

function Attention({ flows, opsFailed, storageFailed }: { flows: ReturnType<typeof useAdminFlows>; opsFailed: boolean; storageFailed: boolean }) {
  const overview = useAdminOverview().data;
  const ops = useAdminOps().data;
  const storage = useAdminStorage().data;
  const approve = useUpdateAdminUser();
  const retry = useAdminLectureAction((api, id) => api.admin.retryLecture(id));
  const now = new Date();
  const items: ReactNode[] = [];

  const runApprove = async (id: string, email: string) => {
    try {
      await approve.mutateAsync({ id, patch: { status: "active" } });
      showToast({ title: `${email} 가입을 승인했습니다.` });
    } catch (err) {
      toastError("가입을 승인하지 못했습니다.", err);
    }
  };
  const runRetry = async (id: string) => {
    try {
      await retry.mutateAsync(id);
      showToast({ title: "재시도를 시작했습니다." });
    } catch (err) {
      toastError("재시도하지 못했습니다.", err);
    }
  };

  if (overview) {
    const pending = overview.users.filter((u) => u.status === "pending");
    for (const u of pending.slice(0, 5)) {
      items.push(
        <li key={`pending-${u.id}`} className={s.attentionItem}>
          <Icon name="user" size={16} />
          <span className={s.attentionText}>
            <span className={s.attentionTitle}>가입 승인 대기</span>
            <Link to="/admin/users/$userId" params={{ userId: u.id }} className={s.link}>
              {u.display_name || u.email}
            </Link>
            <span className={s.muted}>
              {u.email} · {formatRelative(u.created_at, now)}
            </span>
          </span>
          <Button size="sm" aria-label={`승인: ${u.email}`} onPress={() => void runApprove(u.id, u.email)} isDisabled={approve.isPending}>
            승인
          </Button>
        </li>,
      );
    }
    if (pending.length > 5) {
      items.push(
        <li key="pending-more" className={s.attentionItem}>
          <Link to="/admin/users" search={{ status: "pending" }} className={s.link}>
            승인 대기 사용자 {formatCount(pending.length - 5)}명 더 보기
          </Link>
        </li>,
      );
    }
    const failed = overview.recentLectures.filter((l) => l.status === "error");
    for (const l of failed.slice(0, 5)) {
      items.push(
        <li key={`failed-${l.id}`} className={s.attentionItem}>
          <Icon name="alert" size={16} />
          <span className={s.attentionText}>
            <span className={s.attentionTitle}>분석 실패</span>
            <Link to="/admin/recordings/$lectureId" params={{ lectureId: l.id }} className={s.link}>
              {l.title || "제목 없음"}
            </Link>
            <span className={s.muted}>
              {l.owner_email} · {formatRelative(l.updated_at || l.created_at, now)}
            </span>
          </span>
          {l.has_audio && (
            <Button size="sm" aria-label={`재시도: ${l.title || l.id}`} onPress={() => void runRetry(l.id)} isDisabled={retry.isPending}>
              재시도
            </Button>
          )}
        </li>,
      );
    }
    const errTotal = overview.metrics.errorLectures;
    if (errTotal > Math.min(5, failed.length)) {
      items.push(
        <li key="failed-more" className={s.attentionItem}>
          <Link to="/admin/recordings" search={{ status: "error" }} className={s.link}>
            오류 녹음 {formatCount(errTotal)}개 모두 보기
          </Link>
        </li>,
      );
    }
  }
  if (ops?.disk?.low) {
    items.push(
      <li key="disk" className={s.attentionItem}>
        <Icon name="alert" size={16} />
        <span className={s.attentionText}>
          <span className={s.attentionTitle}>디스크 여유 공간 부족</span>
          <span className={s.muted}>
            남은 공간 {formatBytes(ops.disk.freeBytes)} · {Math.round(ops.disk.usedPct)}% 사용
          </span>
        </span>
        <Link to="/admin/storage" className={s.link}>
          저장소 보기
        </Link>
      </li>,
    );
  }
  if (ops) {
    const latest = ops.backups.latest;
    const age = latest ? Date.now() - Date.parse(latest.createdAt) : Infinity;
    if (!latest || age > BACKUP_STALE_MS) {
      items.push(
        <li key="backup" className={s.attentionItem}>
          <Icon name="clock" size={16} />
          <span className={s.attentionText}>
            <span className={s.attentionTitle}>{latest ? "백업이 오래되었습니다" : "백업이 없습니다"}</span>
            <span className={s.muted}>{latest ? `마지막 백업 ${formatRelative(latest.createdAt, now)}` : "유지보수를 실행하면 백업이 만들어집니다."}</span>
          </span>
          <Button size="sm" onPress={() => void flows.start("maintenance")} isDisabled={flows.busy !== null || ops.maintenance.running}>
            {flows.busy === "maintenance" ? "실행 중…" : "유지보수 실행"}
          </Button>
        </li>,
      );
    }
  }
  const ffmpegMissing = ops?.server.ffmpegAvailable === false || storage?.compaction.ffmpegAvailable === false;
  if (ffmpegMissing) {
    items.push(
      <li key="ffmpeg" className={s.attentionItem}>
        <Icon name="alert" size={16} />
        <span className={s.attentionText}>
          <span className={s.attentionTitle}>ffmpeg를 사용할 수 없습니다</span>
          <span className={s.muted}>오디오 압축이 동작하지 않습니다. 서버에 ffmpeg를 설치하세요.</span>
        </span>
      </li>,
    );
  }
  const comp = storage?.compaction;
  if (comp && !ffmpegMissing && comp.candidates > 0) {
    items.push(
      <li key="compact" className={s.attentionItem}>
        <Icon name="folder" size={16} />
        <span className={s.attentionText}>
          <span className={s.attentionTitle}>압축 가능한 녹음 {formatCount(comp.candidates)}개</span>
          <span className={s.muted}>
            약 {formatBytes(comp.estimatedSavedBytes)} 절약 가능 ({formatCount(comp.bitrateKbps)} kbps)
          </span>
        </span>
        <Button size="sm" aria-label="압축 미리보기" onPress={() => void flows.start("compact")} isDisabled={flows.busy !== null}>
          {flows.busy === "compact" ? "실행 중…" : "미리보기"}
        </Button>
      </li>,
    );
  }
  const lastMaint = ops?.maintenance.lastResult;
  if (lastMaint && lastMaint.errors.length) {
    items.push(
      <li key="maint-errors" className={s.attentionItem}>
        <Icon name="alert" size={16} />
        <span className={s.attentionText}>
          <span className={s.attentionTitle}>유지보수 오류 {formatCount(lastMaint.errors.length)}건</span>
          <span className={s.muted}>{lastMaint.errors[0]}</span>
        </span>
        <Link to="/admin/ops" className={s.link}>
          운영 보기
        </Link>
      </li>,
    );
  }
  const dep = ops?.deploy.lastResult;
  if (dep && !dep.ok) {
    items.push(
      <li key="deploy" className={s.attentionItem}>
        <Icon name="alert" size={16} />
        <span className={s.attentionText}>
          <span className={s.attentionTitle}>최근 배포 실패</span>
          <span className={s.muted}>
            {dep.error || dep.sha.slice(0, 7)} · {formatRelative(dep.at, now)}
          </span>
        </span>
        <Link to="/admin/ops" className={s.link}>
          운영 보기
        </Link>
      </li>,
    );
  }

  return (
    <section aria-labelledby="overview-attention">
      <h2 className={s.subheading} id="overview-attention">
        확인 필요{items.length ? ` (${formatCount(items.length)})` : ""}
      </h2>
      {items.length ? (
        <ul className={s.attention} aria-labelledby="overview-attention">
          {items}
        </ul>
      ) : (
        <p className={s.muted}>
          <Icon name="check" size={14} /> 확인이 필요한 항목이 없습니다.
        </p>
      )}
      {(opsFailed || storageFailed) && (
        <p className={s.muted} role="note">
          <Icon name="alert" size={14} /> 운영·저장소 정보를 불러오지 못해 디스크·백업·압축 점검은 건너뛰었습니다.
        </p>
      )}
    </section>
  );
}
