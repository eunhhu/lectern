// Editing a document (D-P2-2). A legacy note (no body) is Markdown with a live preview; a
// structured document offers the text of each block only, so sources, order and gaps stay.
// Saving is a new version with If-Match on the version the edit started from; a 412 opens
// the conflict dialog. ⌘S/Ctrl+S saves, Esc closes (asking first when something changed),
// and leaving the page with unsaved changes asks too. Neither shortcut fires while a Korean
// IME is composing.

import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input, Label, TextArea, TextField } from "react-aria-components";
import { ApiClientError } from "../../../api/client.ts";
import { errorMessage } from "../../../api/errors.ts";
import { queryKeys, useSaveDocument } from "../../../api/queries.ts";
import type { DocumentWithVersion } from "../../../api/types.ts";
import { isImeComposing } from "../../../lib/keyboard.ts";
import { Badge, Button, ModalDialog, uiStyles } from "../../../ui/controls.tsx";
import { Icon } from "../../../ui/Icon.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { LegacyDocument } from "../LegacyDocument.tsx";
import { ConflictDialog } from "./ConflictDialog.tsx";
import { applyFields, editableFields } from "./edit-model.ts";
import e from "./edit.module.css";

export function DocumentEditor({ doc, recordingId, onClose }: { doc: DocumentWithVersion; recordingId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useSaveDocument(doc.document.id, recordingId);
  const body = doc.version.body;
  const baseVersion = doc.version.version;
  const fields = useMemo(() => (body ? editableFields(body) : []), [body]);
  const initialValues = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.value])), [fields]);
  const [markdown, setMarkdown] = useState(doc.version.rendered_md);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const dirty = body ? fields.some((f) => values[f.key] !== f.value) : markdown !== doc.version.rendered_md;
  const saving = save.isPending;
  // Leaving the page (a link, back) with unsaved changes asks first; so does closing the tab.
  const blocker = useBlocker({ shouldBlockFn: () => dirty && !saving, enableBeforeUnload: () => dirty, withResolver: true });

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("textarea, input")?.focus();
  }, []);

  const yourText = () => (body ? fields.map((f) => values[f.key] ?? "").join("\n\n") : markdown);

  const submit = async () => {
    if (saving || !dirty) return;
    if (body && fields.some((f) => !(values[f.key] ?? "").trim())) return setError("비어 있는 칸이 있습니다.");
    if (!body && !markdown.trim()) return setError("본문이 비어 있습니다.");
    setError(null);
    try {
      const version = await save.mutateAsync(body ? { body: applyFields(body, values), baseVersion } : { markdown, baseVersion });
      showToast({ title: `저장했습니다. 버전 ${version.version}` });
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 412) setConflict(true);
      else setError(errorMessage(err, "저장하지 못했습니다. 잠시 뒤 다시 시도하세요."));
    }
  };

  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event.nativeEvent)) return;
    // The dialogs below are portals but still React children: their keys bubble here.
    if (conflict || confirmDiscard || blocker.status === "blocked") return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      requestClose();
    }
  };

  const reload = async () => {
    setConflict(false);
    await qc.invalidateQueries({ queryKey: queryKeys.document(doc.document.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.recording(recordingId) });
    showToast({ title: "최신 버전을 불러왔습니다." });
    onClose();
  };

  const sections = body?.sections ?? [];
  return (
    <div ref={rootRef} className={e.editor} data-legacy={body ? undefined : ""} onKeyDown={onKeyDown}>
      <div className={e.toolbar}>
        <h2 className={e.title}>문서 편집</h2>
        <Badge>버전 {baseVersion} 기준</Badge>
        <Button variant="primary" onPress={() => void submit()} isDisabled={!dirty || saving}>
          {saving ? "저장하는 중…" : "저장"}
        </Button>
        <Button onPress={requestClose}>취소</Button>
      </div>
      <p className={uiStyles.hint}>⌘S(Windows는 Ctrl+S)로 저장, Esc로 닫기</p>
      {error && (
        <p className={e.error} role="alert">
          <Icon name="alert" /> {error}
        </p>
      )}

      {body ? (
        <div className={e.fields}>
          <p className={e.lead}>블록의 글자만 고칠 수 있습니다. 출처 표시와 순서는 그대로 유지됩니다.</p>
          {sections.map((section) => {
            const own = fields.filter((f) => f.sectionKey === section.key);
            if (!own.length) return null;
            return (
              <section key={section.key} className={e.fields} aria-labelledby={`edit-sec-${section.key}`}>
                <h3 id={`edit-sec-${section.key}`} className={e.sectionTitle}>
                  {section.title}
                </h3>
                {own.map((field) => (
                  <TextField
                    key={field.key}
                    className={uiStyles.field}
                    value={values[field.key] ?? ""}
                    onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                  >
                    <Label className={uiStyles.label}>{field.label}</Label>
                    {field.multiline ? <TextArea className={e.textarea} rows={3} /> : <Input className={uiStyles.input} />}
                  </TextField>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className={e.legacyGrid}>
          <TextField className={uiStyles.field} value={markdown} onChange={setMarkdown} aria-label="Markdown 본문">
            <TextArea className={`${e.textarea} ${e.markdown}`} spellCheck={false} />
          </TextField>
          <section className={e.preview} aria-label="미리보기">
            <p className={e.previewTitle} aria-hidden="true">
              미리보기
            </p>
            <LegacyDocument markdown={markdown} />
          </section>
        </div>
      )}

      <ConflictDialog isOpen={conflict} text={yourText()} onReload={() => void reload()} onClose={() => setConflict(false)} />
      <ModalDialog
        isOpen={confirmDiscard}
        onOpenChange={(open) => !open && setConfirmDiscard(false)}
        title="저장하지 않은 수정이 있습니다"
        role="alertdialog"
        footer={
          <>
            <Button onPress={() => setConfirmDiscard(false)}>계속 수정</Button>
            <Button
              variant="danger"
              onPress={() => {
                setConfirmDiscard(false);
                onClose();
              }}
            >
              수정 버리기
            </Button>
          </>
        }
      >
        <p>지금 나가면 고친 내용이 사라집니다.</p>
      </ModalDialog>
      <ModalDialog
        isOpen={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title="저장하지 않은 수정이 있습니다"
        role="alertdialog"
        footer={
          <>
            <Button onPress={() => blocker.reset?.()}>계속 수정</Button>
            <Button variant="danger" onPress={() => blocker.proceed?.()}>
              나가기
            </Button>
          </>
        }
      >
        <p>지금 나가면 고친 내용이 사라집니다.</p>
      </ModalDialog>
    </div>
  );
}
