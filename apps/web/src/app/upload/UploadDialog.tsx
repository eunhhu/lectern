// Upload dialog (ARCHITECTURE §7 업로드 UX): drop audio and PDFs together, review the
// automatic pairing (lib/pairing.ts), fix it if needed, then upload each recording as one
// resumable upload session. Everything works by keyboard: "파일 선택" opens the file
// picker, every pairing has a menu, and Esc closes (asking first if files are chosen).

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DropZone, FileTrigger, Input, isFileDropItem, Label, TextField, type DropZoneProps } from "react-aria-components";

type DropEvent = Parameters<NonNullable<DropZoneProps["onDrop"]>>[0];
import { useApi, useFolders, queryKeys } from "../../api/queries.ts";
import type { RecordingDomain } from "../../api/types.ts";
import { formatBytes, formatDateTime } from "../../lib/format.ts";
import { assignPdf, pairFiles, type PairingResult, type PairReason, type UploadGroup } from "../../lib/pairing.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ModalDialog, Progress, SelectField, uiStyles } from "../../ui/controls.tsx";
import { announce, showToast } from "../../ui/toast.tsx";
import { DOMAIN_LABEL } from "../labels.ts";
import { useOverlay } from "../overlays.ts";
import { useWorkspace } from "../workspace.tsx";
import { folderOptions } from "../../routes/library/folders.ts";
import { uploadGroup } from "./upload.ts";
import s from "./upload.module.css";

const REASON_LABEL: Record<PairReason, string> = {
  name: "이름이 비슷함",
  number: "번호가 같음",
  date: "날짜가 같음",
  time: "수정 시각이 가까움",
  only_recording: "녹음이 하나뿐",
};

const ACCEPTED = ["audio/*", ".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".flac", ".caf", ".amr", "application/pdf", ".pdf"];

type GroupState = { status: "idle" } | { status: "uploading"; sent: number; total: number } | { status: "done" } | { status: "failed"; message: string };

export function UploadDialog() {
  const [isOpen, setOpen] = useOverlay("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFiles([]);
    setConfirmDiscard(false);
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) return setOpen(true);
        if (busy) return;
        if (files.length && !confirmDiscard) return setConfirmDiscard(true);
        reset();
        setOpen(false);
      }}
      title="녹음 올리기"
      size="wide"
      isDismissable={!busy}
    >
      {isOpen && (
        <UploadBody
          files={files}
          setFiles={setFiles}
          busy={busy}
          setBusy={setBusy}
          confirmDiscard={confirmDiscard}
          onKeep={() => setConfirmDiscard(false)}
          onClose={() => {
            reset();
            setOpen(false);
          }}
        />
      )}
    </ModalDialog>
  );
}

function UploadBody({
  files,
  setFiles,
  busy,
  setBusy,
  confirmDiscard,
  onKeep,
  onClose,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  confirmDiscard: boolean;
  onKeep: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const folders = useFolders(workspaceId).data ?? [];
  const search = useSearch({ strict: false }) as { folder?: string };
  const [folderId, setFolderId] = useState<string>(search.folder && search.folder !== "none" ? search.folder : "none");
  const [domain, setDomain] = useState<string>("auto");
  const [overrides, setOverrides] = useState<{ file: File; groupId: string | null }[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, GroupState>>({});

  const pairing: PairingResult<File> = useMemo(() => {
    let result = pairFiles(files);
    for (const o of overrides) result = assignPdf(result, o.file, o.groupId);
    return result;
  }, [files, overrides]);

  const addFiles = (incoming: File[]) => {
    const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
    const known = new Set(files.map(key));
    const next = [...files, ...incoming.filter((f) => !known.has(key(f)))];
    setFiles(next);
    const groups = pairFiles(next).groups.length;
    announce(`파일 ${next.length}개를 골랐습니다. 녹음 ${groups}개로 묶었습니다.`);
  };

  const onDrop = async (e: DropEvent) => {
    const dropped = await Promise.all(e.items.filter(isFileDropItem).map((item) => item.getFile()));
    addFiles(dropped);
  };

  const groupOptions = [
    ...pairing.groups.map((g, i) => ({ id: g.id, label: `녹음 ${i + 1}: ${titleOf(g, titles)}` })),
    { id: "none", label: "올리지 않음" },
  ];

  const start = async () => {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const group of pairing.groups) {
      if (states[group.id]?.status === "done") continue;
      setStates((prev) => ({ ...prev, [group.id]: { status: "uploading", sent: 0, total: 1 } }));
      try {
        await uploadGroup(
          api,
          group,
          {
            workspaceId,
            title: (titles[group.id] ?? group.title ?? "").trim() || null,
            folderId: folderId === "none" ? null : folderId,
            domain: domain === "auto" ? null : (domain as RecordingDomain),
          },
          (sent, total) => setStates((prev) => ({ ...prev, [group.id]: { status: "uploading", sent, total } })),
        );
        ok++;
        setStates((prev) => ({ ...prev, [group.id]: { status: "done" } }));
      } catch (err) {
        failed.push(group.id);
        const message = err instanceof Error ? err.message : "녹음을 올리지 못했습니다.";
        setStates((prev) => ({ ...prev, [group.id]: { status: "failed", message } }));
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: queryKeys.recordings(workspaceId) });
    if (failed.length === 0) {
      showToast({
        title: `녹음 ${ok}개를 올렸습니다.`,
        description: "처리 상태는 홈에서 확인할 수 있습니다.",
        action: { label: "홈에서 보기", onAction: () => void navigate({ to: "/" }) },
      });
      onClose();
    } else {
      showToast({ title: `${ok}개를 올렸고 ${failed.length}개는 올리지 못했습니다.`, description: "실패한 녹음은 다시 올릴 수 있습니다.", tone: "danger" });
    }
  };

  if (confirmDiscard) {
    return (
      <div className={s.confirm} role="group" aria-labelledby="discard-title">
        <p id="discard-title" className={s.confirmTitle}>
          고른 파일 {files.length}개를 버리고 닫을까요?
        </p>
        <p>아직 올리지 않았습니다. 닫으면 다시 골라야 합니다.</p>
        <div className={s.confirmActions}>
          <Button onPress={onKeep} autoFocus>
            계속 고르기
          </Button>
          <Button variant="dangerText" onPress={onClose}>
            버리고 닫기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.body}>
      <DropZone className={s.dropzone} onDrop={onDrop} data-compact={files.length > 0 || undefined} aria-label="파일 놓기 영역">
        <Icon name="upload" size={20} />
        <div className={s.dropText}>
          <p className={s.dropTitle}>{files.length ? "파일을 더 끌어다 놓을 수 있습니다." : "오디오와 PDF를 여기에 끌어다 놓으세요."}</p>
          {!files.length && <p className={uiStyles.hint}>같은 강의의 파일은 이름과 날짜를 보고 자동으로 짝을 짓습니다.</p>}
        </div>
        <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED} onSelect={(list) => list && addFiles([...list])}>
          <Button variant={files.length ? "secondary" : "primary"} icon="folderOpen" isDisabled={busy}>
            파일 선택
          </Button>
        </FileTrigger>
      </DropZone>

      {pairing.groups.length > 0 && (
        <section aria-labelledby="up-groups" className={s.section}>
          <h3 id="up-groups" className={s.sectionTitle}>
            녹음 {pairing.groups.length}개
          </h3>
          <ol className={s.groups} role="list">
            {pairing.groups.map((group, i) => (
              <li key={group.id} className={s.group}>
                <div className={s.groupHead}>
                  <span className={s.groupIndex}>녹음 {i + 1}</span>
                  <GroupStatus state={states[group.id]} />
                </div>
                <TextField
                  className={uiStyles.field}
                  value={titles[group.id] ?? group.title ?? ""}
                  onChange={(v) => setTitles((prev) => ({ ...prev, [group.id]: v }))}
                  isDisabled={busy}
                >
                  <Label className={uiStyles.label}>제목</Label>
                  <Input className={uiStyles.input} placeholder="비워 두면 처리 후 자동으로 정합니다" />
                </TextField>
                <ul className={s.files} role="list">
                  {group.audio.map((f, part) => (
                    <li key={f.name} className={s.file}>
                      <Icon name="audio" />
                      <span className={s.fileName}>{f.name.normalize("NFC")}</span>
                      {group.audio.length > 1 && <Badge>{part + 1}부</Badge>}
                      <span className={s.fileSize}>{formatBytes(f.size)}</span>
                    </li>
                  ))}
                  {group.pdfs.map((p) => (
                    <li key={p.file.name} className={s.file}>
                      <Icon name="pdf" />
                      <span className={s.fileName}>{p.file.name.normalize("NFC")}</span>
                      {p.reasons.length > 0 ? (
                        <Badge tone="accent">{p.reasons.map((r) => REASON_LABEL[r]).join(" · ")}</Badge>
                      ) : (
                        <Badge>직접 연결</Badge>
                      )}
                      <span className={s.fileSize}>{formatBytes(p.file.size)}</span>
                      <PdfTarget
                        name={p.file.name}
                        value={group.id}
                        options={groupOptions}
                        onChange={(target) => setOverrides((prev) => [...prev, { file: p.file, groupId: target === "none" ? null : target }])}
                        isDisabled={busy}
                      />
                    </li>
                  ))}
                </ul>
                {group.recordedAt && <p className={uiStyles.hint}>녹음 시작: {formatDateTime(group.recordedAt, new Date())} (파일 이름에서 읽음)</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {pairing.unmatched.length > 0 && (
        <section aria-labelledby="up-unmatched" className={s.section}>
          <h3 id="up-unmatched" className={s.sectionTitle}>
            짝을 찾지 못한 PDF {pairing.unmatched.length}개
          </h3>
          <p className={uiStyles.hint}>연결할 녹음을 고르세요. 고르지 않은 PDF는 올리지 않습니다.</p>
          <ul className={s.files} role="list">
            {pairing.unmatched.map((f) => (
              <li key={f.name} className={s.file}>
                <Icon name="pdf" />
                <span className={s.fileName}>{f.name.normalize("NFC")}</span>
                <span className={s.fileSize}>{formatBytes(f.size)}</span>
                <PdfTarget
                  name={f.name}
                  value="none"
                  options={groupOptions}
                  onChange={(target) => setOverrides((prev) => [...prev, { file: f, groupId: target === "none" ? null : target }])}
                  isDisabled={busy || pairing.groups.length === 0}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {pairing.rejected.length > 0 && (
        <section aria-labelledby="up-rejected" className={s.section}>
          <h3 id="up-rejected" className={s.sectionTitle}>
            올릴 수 없는 파일 {pairing.rejected.length}개
          </h3>
          <ul className={s.files} role="list">
            {pairing.rejected.map(({ file, reason }) => (
              <li key={file.name} className={s.file}>
                <Icon name="alert" />
                <span className={s.fileName}>{file.name.normalize("NFC")}</span>
                <span className={s.reject}>
                  {reason === "empty" ? "빈 파일입니다." : "지원하지 않는 형식입니다. 오디오나 PDF만 올릴 수 있습니다."}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {files.length > 0 && (
        <div className={s.options}>
          <SelectField
            label="폴더"
            items={[{ id: "none", label: "폴더 없음" }, ...folderOptions(folders)]}
            selectedKey={folderId}
            onSelectionChange={setFolderId}
          />
          <SelectField
            label="종류"
            items={[
              { id: "auto", label: "자동 분류" },
              ...Object.entries(DOMAIN_LABEL).map(([id, label]) => ({ id, label })),
            ]}
            selectedKey={domain}
            onSelectionChange={setDomain}
          />
        </div>
      )}

      <div className={s.footer}>
        <Button variant="ghost" onPress={onClose} isDisabled={busy}>
          취소
        </Button>
        <Button variant="primary" icon="upload" onPress={start} isDisabled={busy || pairing.groups.length === 0}>
          {busy ? "올리는 중…" : pairing.groups.length ? `녹음 ${pairing.groups.length}개 올리기` : "올리기"}
        </Button>
      </div>
    </div>
  );
}

function titleOf(group: UploadGroup<File>, titles: Record<string, string>) {
  return (titles[group.id] ?? group.title) || group.audio[0]!.name.normalize("NFC");
}

function PdfTarget({
  name,
  value,
  options,
  onChange,
  isDisabled,
}: {
  name: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  isDisabled?: boolean;
}) {
  if (isDisabled) return null;
  return (
    <span className={s.target}>
      <SelectField label={`${name.normalize("NFC")} 연결 대상`} hideLabel items={options} selectedKey={value} onSelectionChange={(id) => id !== value && onChange(id)} />
    </span>
  );
}

function GroupStatus({ state }: { state: GroupState | undefined }) {
  if (!state || state.status === "idle") return null;
  if (state.status === "uploading") {
    const ratio = state.total ? state.sent / state.total : 0;
    return <Progress value={ratio} label="올리기 진행률" valueLabel={`올리는 중 · ${Math.round(ratio * 100)}%`} />;
  }
  if (state.status === "done") return <Badge tone="success">올림</Badge>;
  return <span className={s.reject}>{state.message}</span>;
}
