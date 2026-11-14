// 관리 › 녹음 › 한 강의 (P5-16): what the old console's lecture panel showed
// (`GET /api/admin/lectures/:id`: everything but the note) and its actions, under the same
// conditions and sent to the same routes: 재시도 (`POST /api/lectures/:id/retry`), 지금 압축
// (`POST /api/admin/storage/compact { ids }`), 오디오 삭제 and 녹음 삭제
// (`DELETE /api/lectures/:id[/audio]`). The two deletions ask first; while an action runs
// its button is off and says so. P5-13: the job box (the lecture's running or queued v1
// job from `GET /api/admin/ops`), read again with the lecture while one is on.

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { AdminLectureDetail, OpsJob } from "../../api/admin.ts";
import { ApiClientError } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminLecture, useAdminLectureAction, useAdminOps, useAdminOverview } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatDateTime, formatRelative } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox, ModalDialog } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { formatSeconds, lectureStageLabel } from "./format.ts";
import { opsKindLabel } from "./OpsPage.tsx";
import { LectureStatusBadge } from "./RecordingsPage.tsx";
import s from "./admin.module.css";

type Asking = "audio" | "lecture" | null;

export function RecordingDetailPage() {
  const { lectureId } = useParams({ from: "/_authed/admin/recordings/$lectureId" });
  const detail = useAdminLecture(lectureId);
  const l = detail.data;
  usePageTitle(l ? `관리 · ${l.title || "제목 없음"}` : "관리 · 녹음");

  if (detail.isError) {
    return (
      <>
        <BackLink />
        <ErrorBox title={errorMessage(detail.error, "녹음을 불러오지 못했습니다.")} onRetry={() => void detail.refetch()} />
      </>
    );
  }
  if (!l) return <BackLink />;
  return <RecordingDetail lecture={l} />;
}

function RecordingDetail({ lecture: l }: { lecture: AdminLectureDetail }) {
  const navigate = useNavigate();
  const users = useAdminOverview().data?.users ?? [];
  const retry = useAdminLectureAction((api, id) => api.admin.retryLecture(id));
  const compact = useAdminLectureAction((api, id) => api.admin.compactLectures([id]));
  const dropAudio = useAdminLectureAction((api, id) => api.admin.deleteLectureAudio(id));
  const drop = useAdminLectureAction((api, id) => api.admin.deleteLecture(id));
  const [asking, setAsking] = useState<Asking>(null);
  const now = new Date();
  const busy = retry.isPending || compact.isPending || dropAudio.isPending || drop.isPending;
  const owner = users.find((u) => u.id === l.owner_id);
  const title = l.title || "제목 없음";
  const saved = l.compacted && l.audio_original_size > l.audio_size ? l.audio_original_size - l.audio_size : 0;

  // The old console's conditions (ui.ts lecturePeek).
  const canRetry = l.has_audio && (l.status === "error" || (l.status === "processing" && !l.job_state));
  const canCompact = l.has_audio && l.status === "done" && !l.compacted && l.audio_compact_state !== "skipped" && l.audio_in_uploads && !l.job_state;

  const runRetry = async () => {
    try {
      await retry.mutateAsync(l.id);
      showToast({ title: "재시도를 시작했습니다." });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) showToast({ title: "이미 처리 중입니다.", tone: "info" });
      else toastError("재시도하지 못했습니다.", err);
    }
  };
  const runCompact = async () => {
    try {
      const r = await compact.mutateAsync(l.id);
      showToast({
        title: r.queued > 0 ? `압축 대기열에 넣었습니다. 예상 절약 약 ${formatBytes(r.estimatedSavedBytes)}.` : "압축 대상이 아닙니다. 이미 압축되었거나 아직 완료되지 않은 녹음입니다.",
        tone: r.queued > 0 ? undefined : "info",
      });
    } catch (err) {
      toastError("압축하지 못했습니다.", err);
    }
  };
  const runDropAudio = async () => {
    setAsking(null);
    try {
      const r = await dropAudio.mutateAsync(l.id);
      showToast({ title: `오디오를 삭제했습니다. ${formatBytes(r.reclaimedBytes)} 확보.` });
    } catch (err) {
      toastError("오디오를 삭제하지 못했습니다.", err);
    }
  };
  const runDrop = async () => {
    setAsking(null);
    try {
      await drop.mutateAsync(l.id);
      showToast({ title: "녹음을 삭제했습니다." });
      void navigate({ to: "/admin/recordings" });
    } catch (err) {
      toastError("녹음을 삭제하지 못했습니다.", err);
    }
  };

  return (
    <>
      <BackLink />
      <header className={s.header}>
        <h1 className={s.title}>{title}</h1>
        <LectureStatusBadge lecture={l} />
        <div className={s.headerActions}>
          {canRetry && (
            <Button onPress={runRetry} isDisabled={busy}>
              {retry.isPending ? "실행 중…" : "재시도"}
            </Button>
          )}
          {canCompact && (
            <Button onPress={runCompact} isDisabled={busy}>
              {compact.isPending ? "실행 중…" : "지금 압축"}
            </Button>
          )}
          {l.has_audio && (
            <Button variant="dangerText" onPress={() => setAsking("audio")} isDisabled={busy}>
              {dropAudio.isPending ? "실행 중…" : "오디오 삭제"}
            </Button>
          )}
          <Button variant="dangerText" onPress={() => setAsking("lecture")} isDisabled={busy}>
            {drop.isPending ? "실행 중…" : "녹음 삭제"}
          </Button>
        </div>
      </header>
      <JobBox lectureId={l.id} busy={l.job_state !== null || l.status === "processing"} />
      {l.error_message && (
        <div className={s.callout} role="note" aria-label="오류 메시지">
          <Icon name="alert" size={16} />
          <span>{l.error_message}</span>
        </div>
      )}
      <dl className={s.facts}>
        <Fact label="단계">
          {lectureStageLabel(l.stage, l.status)}
          {l.stage_message && l.stage_message !== l.error_message && <span className={s.muted}> · {l.stage_message}</span>}
        </Fact>
        <Fact label="소유자">
          {owner ? (
            <Link to="/admin/users/$userId" params={{ userId: owner.id }} className={s.link}>
              {l.owner_email || owner.email}
            </Link>
          ) : (
            l.owner_email || "—"
          )}
        </Fact>
        <Fact label="과목">{[l.course, l.date_label].filter(Boolean).join(" · ") || "—"}</Fact>
        <Fact label="길이">{formatSeconds(l.duration_sec)}</Fact>
        <Fact label="오디오">
          {l.has_audio ? (
            <span className={s.badges}>
              {formatBytes(l.audio_size)}
              {l.audio_ext && <Badge>{l.audio_ext.replace(/^\./, "").toUpperCase()}</Badge>}
              {l.compacted && <Badge tone="success">압축됨</Badge>}
            </span>
          ) : (
            <span className={s.muted}>삭제됨</span>
          )}
        </Fact>
        {saved > 0 && (
          <Fact label="압축 전">
            {formatBytes(l.audio_original_size)}
            <span className={s.muted}>
              {" "}
              · {formatBytes(saved)} 줄임({Math.round((saved / l.audio_original_size) * 100)}%)
            </span>
          </Fact>
        )}
        {l.audio_compact_state === "skipped" && <Fact label="압축">이미 충분히 작아 원본을 그대로 둡니다</Fact>}
        {l.compacted && l.audio_compacted_at && <Fact label="압축 시각">{formatDateTime(l.audio_compacted_at, now)}</Fact>}
        {l.has_audio && !l.audio_in_uploads && <Fact label="보관 위치">강의 보관함(압축·보존 정책에서 빠짐)</Fact>}
        {l.source_client && (
          <Fact label="올린 곳">
            <span className={s.code}>{l.source_client}</span>
          </Fact>
        )}
        {l.model_used && (
          <Fact label="모델">
            <span className={s.code}>{l.model_used}</span>
            {l.model_requested && l.model_requested !== l.model_used && <span className={s.muted}> · 요청 {l.model_requested}</span>}
          </Fact>
        )}
        <Fact label="노트">
          {l.markdown_chars ? `${formatCount(l.markdown_chars)}자` : "없음"}
          {l.archived && <span className={s.muted}> · 보관함에도 저장</span>}
        </Fact>
        <Fact label="공개">{l.is_public ? "공개 링크 켜짐" : "비공개"}</Fact>
        <Fact label="만든 시각">{formatDateTime(l.created_at, now)}</Fact>
        {l.updated_at && <Fact label="고친 시각">{formatDateTime(l.updated_at, now)}</Fact>}
        <Fact label="ID">
          <span className={s.code}>{l.id}</span>
        </Fact>
      </dl>
      {l.status === "done" && l.excerpt && (
        <>
          <h2 className={s.subheading}>요약</h2>
          <p className={s.excerpt}>{l.excerpt}</p>
        </>
      )}

      <ModalDialog
        isOpen={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={asking === "audio" ? "오디오 삭제" : "녹음 삭제"}
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setAsking(null)} autoFocus>
              취소
            </Button>
            <Button variant="danger" onPress={asking === "audio" ? runDropAudio : runDrop}>
              {asking === "audio" ? "오디오 삭제" : "녹음 삭제"}
            </Button>
          </>
        }
      >
        {asking === "audio" ? (
          <p>
            {title}의 오디오 원본({formatBytes(l.audio_size)})을 영구 삭제합니다. 노트는 남지만 다시 듣거나 다시 분석할 수 없습니다.
          </p>
        ) : (
          <p>{title}의 노트와 오디오가 모두 영구 삭제됩니다. 되돌릴 수 없습니다.</p>
        )}
      </ModalDialog>
    </>
  );
}

/** The lecture's job in the v1 queue (running first), like the old console's peek. */
function JobBox({ lectureId, busy }: { lectureId: string; busy: boolean }) {
  const ops = useAdminOps({ pollMs: busy ? 5_000 : undefined }).data;
  if (!ops) return null;
  const job: OpsJob | undefined = [...ops.jobs.running, ...ops.jobs.queued].find((j) => j.lectureId === lectureId);
  if (!job) return null;
  const now = new Date();
  const running = job.state === "running";
  const p = Math.max(0, Math.min(100, job.progress));
  return (
    <section className={s.jobBox} aria-label="진행 중 작업">
      <strong>
        {opsKindLabel(job.kind)} · {running ? "실행 중" : "대기열"}
      </strong>
      <span className={s.muted}>
        {running
          ? `${lectureStageLabel(job.stage, "processing")}${job.kind === "distill" ? ` · ${p}%` : ""} · ${formatRelative(job.startedAt ?? job.enqueuedAt, now)} 시작`
          : `${formatRelative(job.enqueuedAt, now)} 대기열에 추가됨`}
      </span>
      {running && job.kind === "distill" && (
        <span className={s.stageBar} aria-hidden="true">
          <span className={s.stageFill} ref={(el) => el?.style.setProperty("width", `${p}%`)} />
        </span>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/admin/recordings" className={s.link}>
      ← 녹음 목록
    </Link>
  );
}
