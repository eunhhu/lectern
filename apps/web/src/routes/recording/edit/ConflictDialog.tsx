// The 412 of a document save: someone saved first. The edit is not lost silently: copy it,
// or load the newer version (which closes the editor).

import { Button, ModalDialog } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";

export function ConflictDialog({ isOpen, text, onReload, onClose }: { isOpen: boolean; text: string; onReload: () => void; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ title: "내 글을 복사했습니다." });
    } catch {
      showToast({ title: "복사하지 못했습니다. 글을 직접 선택해 복사하세요.", tone: "danger" });
    }
  };
  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="다른 곳에서 바뀌었습니다"
      role="alertdialog"
      footer={
        <>
          <Button onPress={() => void copy()}>내 글 복사</Button>
          <Button variant="primary" onPress={onReload}>
            다시 불러오기
          </Button>
        </>
      }
    >
      <p>이 문서가 다른 곳에서 먼저 저장되었습니다. 지금 쓴 글은 아직 저장되지 않았습니다.</p>
    </ModalDialog>
  );
}
