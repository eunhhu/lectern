// 관리 (P5-13): the old console's heavy runs, shared by 저장소, 개요 and the command palette
// (ui.ts compactAllFlow, gcFlow, retentionFlow, maintFlow). Compaction, the orphan clean-up
// and the retention policies first send a preview (`dryRun: true`) and show what it found
// in a confirmation; only the confirmation sends the real request, once. Nothing found →
// a toast and no dialog. Maintenance asks with the list of its steps and ends in a result
// dialog. While a run (or its preview) is out, every trigger is off and the one that runs
// says "실행 중…".

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import type { AdminStorage, CompactResult, GcResult, MaintenanceResult, RetentionResult } from "../../api/admin.ts";
import { ApiClientError } from "../../api/client.ts";
import { queryKeys, useApi, useRefreshAdmin } from "../../api/queries.ts";
import { formatBytes, formatCount } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ModalDialog } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { formatElapsed } from "./format.ts";
import s from "./admin.module.css";

export type FlowKind = "compact" | "gc" | "retention" | "maintenance";
export const FLOW_KINDS: readonly FlowKind[] = ["compact", "gc", "retention", "maintenance"];

type Asking =
  | { kind: "compact"; preview: CompactResult }
  | { kind: "gc"; preview: GcResult }
  | { kind: "retention"; preview: RetentionResult }
  | { kind: "maintenance" };

/** A label and a value per row: the old console's statsTable. */
export function StatTable({ label, rows }: { label: string; rows: [string, ReactNode][] }) {
  return (
    <table className={s.statTable} aria-label={label}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const countBytes = (c: { count: number; bytes: number }) => `${formatCount(c.count)}개 · ${formatBytes(c.bytes)}`;

export function MaintenanceResultTable({ result }: { result: MaintenanceResult }) {
  const took = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
  return (
    <>
      <StatTable
        label="유지보수 결과"
        rows={[
          ["만료 세션", `${formatCount(result.expiredSessions)}개`],
          ["만료 인증 코드", `${formatCount(result.expiredCodes)}개`],
          ["감사 로그 정리", `${formatCount(result.prunedAuditLogs)}건`],
          ["고아 파일 → 휴지통", countBytes(result.orphanFiles)],
          ["임시 파일", countBytes(result.tempFiles)],
          ["오디오 보존 정책", countBytes(result.retention)],
          ["실패한 강의 정리", countBytes(result.failedRetention)],
          [
            "백업",
            result.backup ? (
              <>
                <span className={s.code}>{result.backup.file}</span> · {formatBytes(result.backup.sizeBytes)}
              </>
            ) : (
              <span className={s.muted}>없음</span>
            ),
          ],
          ["WAL 체크포인트", result.walCheckpointed ? "완료" : <span className={s.muted}>건너뜀</span>],
          ["걸린 시간", Number.isFinite(took) ? formatElapsed(took) : "—"],
        ]}
      />
      {result.errors.length > 0 && (
        <div className={s.callout} role="note" aria-label="유지보수 오류">
          <Icon name="alert" size={16} />
          <div>
            {result.errors.map((e) => (
              <p key={e} className={s.pre}>
                {e}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function useAdminFlows() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = useRefreshAdmin();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [result, setResult] = useState<MaintenanceResult | null>(null);
  const [busy, setBusy] = useState<FlowKind | null>(null);
  // One request at a time, also across a double press before the state lands.
  const inFlight = useRef(false);
  const storage = () => qc.getQueryData<AdminStorage>(queryKeys.adminStorage);

  const guarded = async (kind: FlowKind, fn: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const start = (kind: FlowKind) =>
    guarded(kind, async () => {
      try {
        if (kind === "maintenance") return setAsking({ kind });
        if (kind === "compact") {
          if (storage()?.compaction.ffmpegAvailable === false) return showToast({ title: "서버에 ffmpeg가 없어 압축할 수 없습니다.", tone: "danger" });
          const preview = await api.admin.compactAll(true);
          if (!preview.candidates) return showToast({ title: "압축할 녹음이 없습니다.", tone: "info" });
          return setAsking({ kind, preview });
        }
        if (kind === "gc") {
          const preview = await api.admin.gcStorage(true);
          if (!preview.orphans.count) return showToast({ title: "정리할 고아 파일이 없습니다.", tone: "info" });
          return setAsking({ kind, preview });
        }
        const preview = await api.admin.applyRetention(true);
        if (!preview.retention.count && !preview.failedRetention.count) {
          const off = !preview.retention.days && !preview.failedRetention.days;
          return showToast({ title: off ? "보존 정책이 꺼져 있습니다. 설정에서 기간을 지정하세요." : "보존 기간이 지난 항목이 없습니다.", tone: "info" });
        }
        setAsking({ kind, preview });
      } catch (err) {
        toastError(FAILED[kind], err);
      }
    });

  const confirm = () => {
    const now = asking;
    if (!now) return;
    return guarded(now.kind, async () => {
      try {
        if (now.kind === "compact") {
          const r = await api.admin.compactAll(false);
          showToast({ title: `${formatCount(r.queued)}개 녹음을 압축 대기열에 추가했습니다.` });
        } else if (now.kind === "gc") {
          const r = await api.admin.gcStorage(false);
          showToast({ title: `고아 파일 ${formatCount(r.movedToTrash)}개를 휴지통으로 옮겼습니다.` });
        } else if (now.kind === "retention") {
          const r = await api.admin.applyRetention(false);
          showToast({ title: `보존 정책을 적용했습니다. ${formatCount(r.retention.count + r.failedRetention.count)}개 정리, ${formatBytes(r.retention.bytes + r.failedRetention.bytes)} 확보.` });
        } else {
          setResult(await api.admin.runMaintenance());
        }
      } catch (err) {
        if (now.kind === "maintenance" && err instanceof ApiClientError && err.status === 409) showToast({ title: "유지보수가 이미 실행 중입니다.", tone: "info" });
        else toastError(FAILED[now.kind], err);
      } finally {
        setAsking(null);
        void refresh();
      }
    });
  };

  const kbps = storage()?.compaction.bitrateKbps;
  const trashDays = storage()?.trash.retentionDays || 7;
  const running = busy !== null;
  const close = () => !running && setAsking(null);

  let dialog: ReactNode = null;
  if (asking?.kind === "compact") {
    const p = asking.preview;
    dialog = (
      <>
        <p>완료된 강의 중 아직 압축하지 않은 녹음을 {kbps ? `${kbps} kbps ` : ""}모노 AAC로 다시 인코딩합니다. 노트는 바뀌지 않으며, 결과가 원본보다 크면 원본을 유지합니다.</p>
        <StatTable
          label="압축 대상"
          rows={[
            ["대상", `${formatCount(p.candidates)}개`],
            ["현재 용량", formatBytes(p.candidateBytes)],
            ["예상 절약", `약 ${formatBytes(p.estimatedSavedBytes)}`],
          ]}
        />
      </>
    );
  } else if (asking?.kind === "gc") {
    const o = asking.preview.orphans;
    const files = o.files.slice(0, 10);
    dialog = (
      <>
        <p>어떤 강의도 참조하지 않는 업로드 파일입니다. 휴지통으로 옮긴 뒤 {formatCount(trashDays)}일이 지나면 자동으로 삭제됩니다.</p>
        <StatTable
          label="고아 파일"
          rows={[
            ["파일", `${formatCount(o.count)}개`],
            ["용량", formatBytes(o.bytes)],
          ]}
        />
        {files.length > 0 && (
          <ul className={s.fileList} aria-label="파일 이름">
            {files.map((f) => (
              <li key={f} className={s.code}>
                {f}
              </li>
            ))}
            {o.count > files.length && <li className={s.muted}>외 {formatCount(o.count - files.length)}개</li>}
          </ul>
        )}
      </>
    );
  } else if (asking?.kind === "retention") {
    const { retention: a, failedRetention: f } = asking.preview;
    dialog = (
      <>
        <p>아래 항목을 지금 영구 삭제합니다. 되돌릴 수 없습니다.</p>
        <StatTable
          label="보존 정책 대상"
          rows={[
            ["완료된 강의 오디오", a.days ? `${countBytes(a)} · ${formatCount(a.days)}일 경과, 노트는 유지` : "정책 꺼짐"],
            ["실패한 강의", f.days ? `${countBytes(f)} · ${formatCount(f.days)}일 동안 변경 없음, 강의째 삭제` : "정책 꺼짐"],
          ]}
        />
      </>
    );
  } else if (asking?.kind === "maintenance") {
    dialog = (
      <>
        <p>다음 작업을 지금 실행합니다.</p>
        <ul className={s.steps}>
          <li>만료된 세션과 인증 코드 정리</li>
          <li>고아 파일을 휴지통으로 이동하고 기간이 지난 휴지통 비우기</li>
          <li>보존 정책 적용 (설정된 경우, 영구 삭제)</li>
          <li>데이터베이스 백업과 WAL 체크포인트</li>
        </ul>
      </>
    );
  }

  const dialogs = (
    <>
      <ModalDialog
        isOpen={asking !== null}
        onOpenChange={(open) => !open && close()}
        isDismissable={!running}
        title={asking ? TITLE[asking.kind] : ""}
        role={asking?.kind === "retention" ? "alertdialog" : "dialog"}
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={close} isDisabled={running} autoFocus>
              취소
            </Button>
            <Button variant={asking?.kind === "retention" ? "danger" : "primary"} onPress={() => void confirm()} isDisabled={running}>
              {running ? "실행 중…" : asking ? CONFIRM[asking.kind] : ""}
            </Button>
          </>
        }
      >
        {dialog}
      </ModalDialog>
      <ModalDialog
        isOpen={result !== null}
        onOpenChange={(open) => !open && setResult(null)}
        title={result && result.errors.length ? "유지보수 완료 (오류 있음)" : "유지보수 완료"}
        size="form"
        footer={
          <Button variant="primary" onPress={() => setResult(null)} autoFocus>
            닫기
          </Button>
        }
      >
        {result && <MaintenanceResultTable result={result} />}
      </ModalDialog>
    </>
  );

  return { start, busy, dialogs };
}

const TITLE: Record<FlowKind, string> = {
  compact: "전체 압축",
  gc: "고아 파일을 휴지통으로 이동",
  retention: "보존 정책 적용",
  maintenance: "유지보수 실행",
};
const CONFIRM: Record<FlowKind, string> = {
  compact: "압축 시작",
  gc: "휴지통으로 이동",
  retention: "영구 삭제",
  maintenance: "실행",
};
const FAILED: Record<FlowKind, string> = {
  compact: "압축하지 못했습니다.",
  gc: "고아 파일을 정리하지 못했습니다.",
  retention: "보존 정책을 적용하지 못했습니다.",
  maintenance: "유지보수를 실행하지 못했습니다.",
};
