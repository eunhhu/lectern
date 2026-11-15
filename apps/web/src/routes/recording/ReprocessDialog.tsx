// 다시 처리 / 문서만 다시 만들기 (D-P2-4, D-P1-4): the dialog asks the server for a dry-run
// estimate first and only enables the confirm button once that estimate is in and within
// the AI quota, so no real reprocess request can leave without the reader seeing its cost.

import { errorMessage } from "../../api/errors.ts";
import { useReprocess, useReprocessEstimate } from "../../api/queries.ts";
import type { Recording } from "../../api/types.ts";
import { formatDuration } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ModalDialog } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import s from "./recording-actions.module.css";

export type ReprocessMode = "full" | "document";

const COPY: Record<ReprocessMode, { title: string; body: string; confirm: string }> = {
  full: {
    title: "다시 처리",
    body: "원본 오디오로 전사부터 모든 단계를 다시 실행합니다. 지금 문서는 버전 이력에 남습니다.",
    confirm: "다시 처리",
  },
  document: {
    title: "문서만 다시 만들기",
    body: "저장된 전사로 문서만 다시 만듭니다. 전사는 바뀌지 않고, 지금 문서는 버전 이력에 남습니다.",
    confirm: "문서 다시 만들기",
  },
};

/** `$0.00`, `$0.01 미만` below a cent, `무료` at zero. */
export function formatCost(microusd: number): string {
  if (microusd <= 0) return "무료";
  const usd = microusd / 1_000_000;
  if (usd < 0.01) return "$0.01 미만";
  return `$${usd.toFixed(2)}`;
}

export function ReprocessDialog({
  recording,
  mode,
  isOpen,
  onOpenChange,
}: {
  recording: Recording;
  mode: ReprocessMode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = COPY[mode];
  const estimate = useReprocessEstimate(recording.id, mode, isOpen);
  const reprocess = useReprocess(recording.id, recording.workspace_id);
  const result = estimate.data?.estimate;
  const ready = estimate.isSuccess && result?.within_quota === true;

  const confirm = async () => {
    // Without a confirmed estimate the request never leaves.
    if (!estimate.data?.estimate.within_quota) return;
    try {
      await reprocess.mutateAsync(mode);
      onOpenChange(false);
      showToast({ title: "다시 처리를 시작했습니다.", description: "끝나면 이 화면에 바로 표시됩니다." });
    } catch (err) {
      toastError("다시 처리를 시작하지 못했습니다.", err);
    }
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={copy.title}
      size="form"
      footer={
        <>
          <Button onPress={() => onOpenChange(false)}>취소</Button>
          <Button variant="primary" onPress={() => void confirm()} isDisabled={!ready || reprocess.isPending}>
            {reprocess.isPending ? "요청하는 중…" : copy.confirm}
          </Button>
        </>
      }
    >
      <p>{copy.body}</p>
      <div className={s.estimate} aria-busy={estimate.isPending}>
        {estimate.isPending && <p className={s.muted}>예상 비용을 계산하는 중…</p>}
        {result && (
          <dl className={s.facts}>
            <div>
              <dt>예상 비용</dt>
              <dd>{formatCost(result.estimated_microusd)}</dd>
            </div>
            {mode === "full" && (
              <div>
                <dt>처리할 오디오</dt>
                <dd>{formatDuration(result.audio_ms)}</dd>
              </div>
            )}
          </dl>
        )}
        {result && !result.within_quota && (
          <p className={s.error} role="alert">
            <Icon name="alert" /> AI 사용 한도를 넘어 지금은 실행할 수 없습니다.
          </p>
        )}
        {estimate.isError && (
          <p className={s.error} role="alert">
            <Icon name="alert" /> {errorMessage(estimate.error)}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
