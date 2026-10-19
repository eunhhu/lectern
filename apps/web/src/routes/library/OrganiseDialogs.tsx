// Dialogs for moving and deleting folders and deleting tags (DESIGN.md §4.4: deleting a
// folder or tag keeps every recording, but cannot be undone, so it asks first).

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useRecordings } from "../../api/queries.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatCount } from "../../lib/format.ts";
import { Button, ModalDialog, SelectField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { useFolderEditing } from "./FolderTree.tsx";
import { folderAndDescendants, folderOptions, folderPath } from "./folders.ts";
import { toastError, type OrganiseDialog } from "./organise.ts";
import { useTagEditing } from "./TagList.tsx";
import s from "./library.module.css";

export function OrganiseDialogs({ dialog, onClose }: { dialog: OrganiseDialog; onClose: () => void }) {
  return (
    <>
      <FolderMoveDialog dialog={dialog?.kind === "folder-move" ? dialog : null} onClose={onClose} />
      <FolderDeleteDialog dialog={dialog?.kind === "folder-delete" ? dialog : null} onClose={onClose} />
      <TagDeleteDialog dialog={dialog?.kind === "tag-delete" ? dialog : null} onClose={onClose} />
    </>
  );
}

function FolderMoveDialog({ dialog, onClose }: { dialog: Extract<OrganiseDialog, { kind: "folder-move" }> | null; onClose: () => void }) {
  const { folders, move } = useFolderEditing();
  const [target, setTarget] = useState<string | null>(null);
  const folder = dialog?.folder;
  const blocked = folder ? folderAndDescendants(folders, folder.id) : new Set<string>();
  const options = [{ id: "root", label: "맨 위 (상위 폴더 없음)" }, ...folderOptions(folders).filter((o) => !blocked.has(o.id))];
  const current = target ?? folder?.parent_id ?? "root";
  const close = () => {
    setTarget(null);
    onClose();
  };
  return (
    <ModalDialog
      isOpen={Boolean(dialog)}
      onOpenChange={(open) => !open && close()}
      title="다른 폴더로 옮기기"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={close}>
            취소
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              if (folder) void move(folder, current === "root" ? null : current);
              close();
            }}
          >
            옮기기
          </Button>
        </>
      }
    >
      <div className={s.dialogStack}>
        <p>‘{folder?.name}’ 폴더와 그 안의 녹음, 하위 폴더를 함께 옮깁니다.</p>
        <SelectField label="옮길 위치" items={options} selectedKey={current} onSelectionChange={setTarget} />
        <p className={uiStyles.hint}>폴더 목록에서 폴더를 다른 폴더 위로 끌어다 놓아도 옮길 수 있습니다.</p>
      </div>
    </ModalDialog>
  );
}

function FolderDeleteDialog({ dialog, onClose }: { dialog: Extract<OrganiseDialog, { kind: "folder-delete" }> | null; onClose: () => void }) {
  const { workspaceId } = useWorkspace();
  const { folders, remove } = useFolderEditing();
  const recordings = useRecordings(workspaceId).data ?? [];
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { folder?: string };
  const folder = dialog?.folder;
  const inside = folder ? recordings.filter((r) => r.folder_id === folder.id).length : 0;
  const children = folder ? folders.filter((f) => f.parent_id === folder.id).length : 0;
  const parent = folder?.parent_id ? folderPath(folders, folder.parent_id) : null;
  const where = parent ? `‘${parent}’ 폴더로` : "‘폴더 없음’으로";

  const run = async () => {
    if (!folder) return;
    onClose();
    try {
      await remove.mutateAsync(folder.id);
      showToast({ title: `‘${folder.name}’ 폴더를 삭제했습니다.`, description: inside ? `녹음 ${formatCount(inside)}개는 ${where} 옮겼습니다.` : undefined });
      if (search.folder === folder.id) void navigate({ to: "/library", search: folder.parent_id ? { folder: folder.parent_id } : {} });
    } catch (err) {
      toastError("폴더를 삭제하지 못했습니다.", err);
    }
  };

  return (
    <ModalDialog
      isOpen={Boolean(dialog)}
      onOpenChange={(open) => !open && onClose()}
      title="폴더 삭제"
      role="alertdialog"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose} autoFocus>
            취소
          </Button>
          <Button variant="danger" onPress={run}>
            폴더 삭제
          </Button>
        </>
      }
    >
      <div className={s.dialogStack}>
        <p>
          ‘{folder?.name}’ 폴더를 삭제합니다. 녹음은 지워지지 않습니다.
          {inside > 0 && ` 안의 녹음 ${formatCount(inside)}개는 ${where} 옮겨집니다.`}
          {children > 0 && ` 하위 폴더 ${formatCount(children)}개는 한 단계 위로 올라갑니다.`}
        </p>
        <p>폴더 삭제는 되돌릴 수 없습니다.</p>
      </div>
    </ModalDialog>
  );
}

function TagDeleteDialog({ dialog, onClose }: { dialog: Extract<OrganiseDialog, { kind: "tag-delete" }> | null; onClose: () => void }) {
  const { workspaceId } = useWorkspace();
  const { remove } = useTagEditing();
  const recordings = useRecordings(workspaceId).data ?? [];
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tag?: string };
  const tag = dialog?.tag;
  const tagged = tag ? recordings.filter((r) => r.tag_ids.includes(tag.id)).length : 0;

  const run = async () => {
    if (!tag) return;
    onClose();
    try {
      await remove.mutateAsync(tag.id);
      showToast({ title: `‘${tag.name}’ 태그를 삭제했습니다.` });
      if (search.tag === tag.id) void navigate({ to: "/library", search: {} });
    } catch (err) {
      toastError("태그를 삭제하지 못했습니다.", err);
    }
  };

  return (
    <ModalDialog
      isOpen={Boolean(dialog)}
      onOpenChange={(open) => !open && onClose()}
      title="태그 삭제"
      role="alertdialog"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose} autoFocus>
            취소
          </Button>
          <Button variant="danger" onPress={run}>
            태그 삭제
          </Button>
        </>
      }
    >
      <div className={s.dialogStack}>
        <p>
          ‘{tag?.name}’ 태그를 삭제합니다.{tagged > 0 && ` 녹음 ${formatCount(tagged)}개에서 이 태그가 떨어집니다.`} 녹음은 그대로 남습니다.
        </p>
        <p>태그 삭제는 되돌릴 수 없습니다.</p>
      </div>
    </ModalDialog>
  );
}
