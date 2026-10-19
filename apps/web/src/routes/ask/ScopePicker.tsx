// 범위 선택기: what an answer may draw on. On the 물어보기 screen: 전체 / 폴더 / 노트 with
// a folder or note picker; in a recording's panel: 이 노트 / 이 폴더 / 전체. A folder
// always includes its subfolders. A thread's scope is fixed, so choosing another scope
// starts a new conversation with the next question.

import { useFolders, useRecordings } from "../../api/queries.ts";
import { asId, type AskScope, type FolderId, type RecordingId, type WorkspaceId } from "../../api/types.ts";
import { Segmented, SelectField } from "../../ui/controls.tsx";
import { folderPath } from "../library/folders.ts";
import s from "./ask.module.css";

const PROCESSED = new Set(["ready", "partial"]);

export function ScopePicker({ workspaceId, value, onChange }: { workspaceId: WorkspaceId; value: AskScope; onChange: (scope: AskScope) => void }) {
  const folders = useFolders(workspaceId).data ?? [];
  const recordings = (useRecordings(workspaceId).data ?? []).filter((r) => PROCESSED.has(r.status));
  const folderItems = folders.map((f) => ({ id: f.id, label: folderPath(folders, f.id) || f.name }));
  const noteItems = recordings.map((r) => ({ id: r.id, label: r.title }));
  return (
    <div className={s.scope}>
      <Segmented
        label="물어볼 범위"
        size="sm"
        value={value.kind}
        onChange={(kind) => {
          if (kind === "workspace") onChange({ kind });
          else if (kind === "folder" && folderItems[0]) onChange({ kind, folder_id: asId<FolderId>(folderItems[0].id), include_subfolders: true });
          else if (kind === "recording" && noteItems[0]) onChange({ kind, recording_id: asId<RecordingId>(noteItems[0].id) });
        }}
        options={[
          { id: "workspace", label: "전체" },
          { id: "folder", label: "폴더" },
          { id: "recording", label: "노트" },
        ]}
      />
      {value.kind === "folder" && (
        <SelectField
          label="폴더"
          hideLabel
          items={folderItems}
          selectedKey={value.folder_id}
          onSelectionChange={(id) => onChange({ kind: "folder", folder_id: asId<FolderId>(id), include_subfolders: true })}
        />
      )}
      {value.kind === "recording" && (
        <SelectField
          label="노트"
          hideLabel
          items={noteItems}
          selectedKey={value.recording_id}
          onSelectionChange={(id) => onChange({ kind: "recording", recording_id: asId<RecordingId>(id) })}
        />
      )}
    </div>
  );
}

/** The panel's picker: this note, its folder, or everything. */
export function NoteScopePicker({
  recordingId,
  folderId,
  value,
  onChange,
}: {
  recordingId: RecordingId;
  folderId: FolderId | null;
  value: AskScope;
  onChange: (scope: AskScope) => void;
}) {
  const options: { id: AskScope["kind"]; label: string }[] = [{ id: "recording", label: "이 노트" }];
  if (folderId) options.push({ id: "folder", label: "이 폴더" });
  options.push({ id: "workspace", label: "전체" });
  return (
    <div className={s.scope}>
      <Segmented
        label="물어볼 범위"
        size="sm"
        value={value.kind}
        onChange={(kind) =>
          onChange(
            kind === "recording"
              ? { kind, recording_id: recordingId }
              : kind === "folder" && folderId
                ? { kind, folder_id: folderId, include_subfolders: true }
                : { kind: "workspace" },
          )
        }
        options={options}
      />
    </div>
  );
}
