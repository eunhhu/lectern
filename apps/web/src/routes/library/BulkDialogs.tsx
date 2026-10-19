// Move, tag and delete for one or many recordings (DESIGN.md §4.4, §4.5). Moving and
// tagging are reversible: they run at once and the toast offers 실행 취소. Deleting is
// irreversible and cascades, so the dialog shows the count and asks for it to be typed.

import { useState } from "react";
import { Input, Label, TextField } from "react-aria-components";
import { useBulkDelete, useBulkUpdate, useFolders, useRecordings, useTags } from "../../api/queries.ts";
import type { RecordingListItem } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatDuration } from "../../lib/format.ts";
import { Button, CheckboxField, ModalDialog, SelectField, uiStyles } from "../../ui/controls.tsx";
import { announce, showToast } from "../../ui/toast.tsx";
import { folderOptions, folderPath } from "./folders.ts";
import s from "./library.module.css";

export type BulkAction = { kind: "move" | "tag" | "delete"; ids: string[] } | null;

export function useBulkMove() {
  const { workspaceId } = useWorkspace();
  const folders = useFolders(workspaceId).data ?? [];
  const recordings = useRecordings(workspaceId).data ?? [];
  const update = useBulkUpdate(workspaceId);
  return async (ids: string[], folderId: string | null, onFailed?: (ids: string[]) => void) => {
    const before = new Map(recordings.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.folder_id]));
    const result = await update.mutateAsync({ ids, patch: () => ({ folder_id: folderId }) });
    const name = folderId ? (folders.find((f) => f.id === folderId)?.name ?? "폴더") : null;
    const where = name ? `‘${name}’ 폴더로` : "폴더 밖으로";
    if (result.failed.length) {
      showToast({
        title: `${result.succeeded.length}개를 옮겼고 ${result.failed.length}개는 옮기지 못했습니다.`,
        description: result.failed[0]!.message,
        tone: "danger",
      });
      onFailed?.(result.failed.map((f) => f.id));
      return;
    }
    showToast({
      title: `녹음 ${ids.length}개를 ${where} 옮겼습니다.`,
      action: {
        label: "실행 취소",
        onAction: () => {
          for (const [id, prev] of before) void update.mutateAsync({ ids: [id], patch: () => ({ folder_id: prev }) });
          announce("이동을 취소했습니다.");
        },
      },
    });
  };
}

export function BulkDialogs({ action, onClose, onFailed }: { action: BulkAction; onClose: () => void; onFailed: (ids: string[]) => void }) {
  return (
    <>
      <MoveDialog ids={action?.kind === "move" ? action.ids : null} onClose={onClose} onFailed={onFailed} />
      <TagDialog ids={action?.kind === "tag" ? action.ids : null} onClose={onClose} onFailed={onFailed} />
      <DeleteDialog ids={action?.kind === "delete" ? action.ids : null} onClose={onClose} onFailed={onFailed} />
    </>
  );
}

function MoveDialog({ ids, onClose, onFailed }: { ids: string[] | null; onClose: () => void; onFailed: (ids: string[]) => void }) {
  const { workspaceId } = useWorkspace();
  const folders = useFolders(workspaceId).data ?? [];
  const recordings = useRecordings(workspaceId).data ?? [];
  const move = useBulkMove();
  const [target, setTarget] = useState<string | null>(null);
  const isOpen = ids !== null;
  const single = ids?.length === 1 ? recordings.find((r) => r.id === ids[0]) : undefined;
  const current = target ?? (single?.folder_id ?? "none");

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setTarget(null);
          onClose();
        }
      }}
      title={single ? "폴더로 이동" : `녹음 ${ids?.length ?? 0}개를 폴더로 이동`}
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            onPress={async () => {
              const list = ids ?? [];
              setTarget(null);
              onClose();
              await move(list, current === "none" ? null : current, onFailed);
            }}
          >
            이동
          </Button>
        </>
      }
    >
      <div className={s.dialogStack}>
        {single && <p>‘{single.title}’ 녹음을 옮길 폴더를 고르세요.</p>}
        <SelectField
          label="폴더"
          items={[{ id: "none", label: "폴더 없음" }, ...folderOptions(folders)]}
          selectedKey={current}
          onSelectionChange={setTarget}
        />
        <p className={uiStyles.hint}>목록에서 녹음을 폴더 위로 끌어다 놓아도 옮길 수 있습니다.</p>
      </div>
    </ModalDialog>
  );
}

function TagDialog({ ids, onClose, onFailed }: { ids: string[] | null; onClose: () => void; onFailed: (ids: string[]) => void }) {
  const { workspaceId } = useWorkspace();
  const tags = useTags(workspaceId).data ?? [];
  const recordings = useRecordings(workspaceId).data ?? [];
  const update = useBulkUpdate(workspaceId);
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const targets = recordings.filter((r) => ids?.includes(r.id));

  const stateOf = (tagId: string) => {
    if (tagId in changes) return { selected: changes[tagId]!, indeterminate: false };
    const n = targets.filter((r) => r.tag_ids.includes(tagId)).length;
    return { selected: n > 0 && n === targets.length, indeterminate: n > 0 && n < targets.length };
  };

  const close = () => {
    setChanges({});
    onClose();
  };

  const apply = async () => {
    const before = new Map(targets.map((r) => [r.id, r.tag_ids]));
    const next = (rec: RecordingListItem | undefined) => {
      const set = new Set(rec?.tag_ids ?? []);
      for (const [tagId, on] of Object.entries(changes)) on ? set.add(tagId) : set.delete(tagId);
      return { tag_ids: [...set] };
    };
    const list = ids ?? [];
    close();
    if (!Object.keys(changes).length) return;
    const result = await update.mutateAsync({ ids: list, patch: next });
    if (result.failed.length) {
      showToast({ title: `${result.succeeded.length}개에 적용했고 ${result.failed.length}개는 적용하지 못했습니다.`, description: result.failed[0]!.message, tone: "danger" });
      onFailed(result.failed.map((f) => f.id));
      return;
    }
    showToast({
      title: `녹음 ${list.length}개의 태그를 바꿨습니다.`,
      action: {
        label: "실행 취소",
        onAction: () => {
          for (const [id, prev] of before) void update.mutateAsync({ ids: [id], patch: () => ({ tag_ids: prev }) });
          announce("태그 변경을 취소했습니다.");
        },
      },
    });
  };

  return (
    <ModalDialog
      isOpen={ids !== null}
      onOpenChange={(open) => !open && close()}
      title={targets.length === 1 ? "태그" : `녹음 ${targets.length}개의 태그`}
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={close}>
            취소
          </Button>
          <Button variant="primary" onPress={apply}>
            적용
          </Button>
        </>
      }
    >
      <fieldset className={s.fieldset}>
        <legend className={uiStyles.label}>붙일 태그</legend>
        {tags.map((tag) => {
          const st = stateOf(tag.id);
          return (
            <CheckboxField
              key={tag.id}
              isSelected={st.selected}
              isIndeterminate={st.indeterminate}
              onChange={(on) => setChanges((prev) => ({ ...prev, [tag.id]: on }))}
            >
              <span className={s.tagDot} data-color={tag.color} aria-hidden="true" />
              {tag.name}
            </CheckboxField>
          );
        })}
      </fieldset>
      {targets.length > 1 && <p className={uiStyles.hint}>일부에만 붙은 태그는 가운데 줄로 표시됩니다. 누르면 모두에 붙이거나 모두에서 뗍니다.</p>}
    </ModalDialog>
  );
}

function DeleteDialog({ ids, onClose, onFailed }: { ids: string[] | null; onClose: () => void; onFailed: (ids: string[]) => void }) {
  const { workspaceId } = useWorkspace();
  const recordings = useRecordings(workspaceId).data ?? [];
  const folders = useFolders(workspaceId).data ?? [];
  const remove = useBulkDelete(workspaceId);
  const [typed, setTyped] = useState("");
  const targets = recordings.filter((r) => ids?.includes(r.id));
  const count = targets.length;
  const total = targets.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
  const expected = String(count);
  const single = count === 1 ? targets[0] : undefined;

  const close = () => {
    setTyped("");
    onClose();
  };

  const run = async () => {
    const list = ids ?? [];
    close();
    const result = await remove.mutateAsync(list);
    if (result.failed.length) {
      showToast({
        title: `${result.succeeded.length}개를 삭제했고 ${result.failed.length}개는 삭제하지 못했습니다.`,
        description: result.failed[0]!.message,
        tone: "danger",
      });
      onFailed(result.failed.map((f) => f.id));
    } else {
      showToast({ title: `녹음 ${list.length}개를 삭제했습니다.` });
    }
  };

  const where = single ? folderPath(folders, single.folder_id) : null;

  return (
    <ModalDialog
      isOpen={ids !== null}
      onOpenChange={(open) => !open && close()}
      title={single ? "녹음 삭제" : `녹음 ${count}개 삭제`}
      role="alertdialog"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={close} autoFocus>
            취소
          </Button>
          <Button variant="danger" onPress={run} isDisabled={typed.trim() !== expected}>
            {single ? "영구 삭제" : `${count}개 영구 삭제`}
          </Button>
        </>
      }
    >
      <div className={s.dialogStack}>
        <p>
          {single ? `‘${single.title}’${where ? ` (${where})` : ""}` : `녹음 ${count}개 (모두 ${formatDuration(total)})`}의 오디오, 전사, 문서가 영구히 삭제됩니다.
          되돌릴 수 없습니다.
        </p>
        <TextField className={uiStyles.field} value={typed} onChange={setTyped} autoComplete="off">
          <Label className={uiStyles.label}>확인하려면 삭제할 녹음 개수를 입력하세요: {expected}</Label>
          <Input className={uiStyles.input} inputMode="numeric" />
        </TextField>
      </div>
    </ModalDialog>
  );
}
