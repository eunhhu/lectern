// OCR of a scanned PDF (D-P3-3): the dialog asks the server for a dry-run estimate when it
// opens and shows it; only its "OCR 시작" button sends `dry_run: false`, and only once that
// estimate is on screen. No other path starts OCR.

import { useEffect } from "react";
import { ApiClientError } from "../../../api/client.ts";
import { errorMessage } from "../../../api/errors.ts";
import { useOcrAsset, useOcrEstimate } from "../../../api/queries.ts";
import { formatCostUsd } from "../../../lib/pdf-view.ts";
import { Button, ModalDialog } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import s from "./pdf.module.css";

export function OcrDialog({
  assetId,
  recordingId,
  isOpen,
  onOpenChange,
  onUnavailable,
}: {
  assetId: string;
  recordingId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server does not offer OCR (501): the caller hides the offer. */
  onUnavailable: () => void;
}) {
  const estimate = useOcrEstimate(assetId, isOpen);
  const ocr = useOcrAsset(assetId, recordingId);
  const result = estimate.data;
  const nothingLeft = result?.pages_to_ocr === 0;
  const notOffered = estimate.error instanceof ApiClientError && estimate.error.code === "not_implemented";

  useEffect(() => {
    if (isOpen && notOffered) onUnavailable();
  }, [isOpen, notOffered, onUnavailable]);

  const confirm = async () => {
    // Without an estimate on screen the request never leaves.
    if (!result || result.pages_to_ocr === 0) return;
    try {
      await ocr.mutateAsync();
      onOpenChange(false);
      showToast({ title: "글자 인식을 시작했습니다.", description: "끝나면 검색과 인용에 그 쪽들이 쓰입니다." });
    } catch (err) {
      toastError("글자 인식을 시작하지 못했습니다.", err);
    }
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="글자 인식(OCR)"
      size="form"
      footer={
        nothingLeft ? (
          <Button onPress={() => onOpenChange(false)}>닫기</Button>
        ) : (
          <>
            <Button onPress={() => onOpenChange(false)}>취소</Button>
            <Button variant="primary" onPress={() => void confirm()} isDisabled={!result || ocr.isPending}>
              {ocr.isPending ? "요청하는 중…" : "OCR 시작"}
            </Button>
          </>
        )
      }
    >
      <div aria-busy={estimate.isPending}>
        {estimate.isPending && <p className={s.status}>예상 비용을 계산하는 중…</p>}
        {result && !nothingLeft && (
          <p>
            {result.pages_to_ocr}쪽을 AI로 읽습니다. 예상 비용 약 {formatCostUsd(result.estimated_cost_microusd)}이며 실제 비용은 다를 수 있습니다.
          </p>
        )}
        {nothingLeft && <p>이미 모든 쪽의 글자를 읽었습니다.</p>}
        {estimate.isError && !notOffered && (
          <p className={s.error} role="alert">
            {errorMessage(estimate.error)}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
