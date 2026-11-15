// 오디오만 삭제 (D-P2-4): removes the recording's audio files on the server after a
// confirmation. The transcript and documents stay; playback and a full reprocess do not.

import { useDeleteAudio } from "../../api/queries.ts";
import type { Recording } from "../../api/types.ts";
import { Button, ModalDialog } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";

export function DeleteAudioDialog({ recording, isOpen, onOpenChange }: { recording: Recording; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const remove = useDeleteAudio(recording.id, recording.workspace_id);

  const confirm = async () => {
    try {
      await remove.mutateAsync();
      onOpenChange(false);
      showToast({ title: "오디오를 삭제했습니다." });
    } catch (err) {
      onOpenChange(false);
      toastError("오디오를 삭제하지 못했습니다.", err);
    }
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="오디오만 삭제할까요?"
      role="alertdialog"
      footer={
        <>
          <Button onPress={() => onOpenChange(false)}>취소</Button>
          <Button variant="danger" onPress={() => void confirm()} isDisabled={remove.isPending}>
            오디오 삭제
          </Button>
        </>
      }
    >
      <p>녹음 파일만 서버에서 지웁니다. 전사와 문서는 남지만 오디오를 다시 들을 수 없고, 전체 다시 처리도 할 수 없습니다. 되돌릴 수 없습니다.</p>
    </ModalDialog>
  );
}
