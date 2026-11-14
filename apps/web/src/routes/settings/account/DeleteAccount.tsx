// 설정 › 계정 삭제 (P5-10, D-P5-9): ask for the account to be deleted in 7 days, or cancel
// that. The web cannot tell whether the account was made with Google/Apple only, so the
// password is an optional field; the server says when it was needed. Errors (wrong
// password, sign in again, sole owner of a team) show inside the dialog, in the server's
// words.

import { useState } from "react";
import { Input, Label, TextField } from "react-aria-components";
import { errorMessage, isNotReady } from "../../../api/errors.ts";
import { useAccountDeletion, useCancelAccountDeletion, useRequestAccountDeletion } from "../../../api/queries.ts";
import { formatDate } from "../../../lib/format.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { Button, ModalDialog, uiStyles } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import s from "../settings.module.css";
import a from "./account.module.css";
import { NOT_READY_TEXT } from "./Tokens.tsx";

export const CONFIRM_PHRASE = "삭제합니다";

export function DeleteAccount() {
  const deletion = useAccountDeletion();
  const cancel = useCancelAccountDeletion();
  const [asking, setAsking] = useState(false);
  const now = new Date();

  const runCancel = async () => {
    try {
      await cancel.mutateAsync();
      showToast({ title: "계정 삭제를 취소했습니다." });
    } catch (err) {
      toastError("계정 삭제를 취소하지 못했습니다.", err);
    }
  };

  let body;
  if (isNotReady(deletion.error)) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (!deletion.data) {
    body = <p className={s.muted}>{deletion.isPending ? "불러오는 중…" : "계정 삭제 상태를 불러오지 못했습니다."}</p>;
  } else if (deletion.data.state === "scheduled" && deletion.data.execute_after) {
    const overdue = Date.parse(deletion.data.execute_after) < now.getTime();
    body = (
      <>
        <p className={s.warning} role="status">
          <Icon name="alert" size={16} />
          {formatDate(deletion.data.execute_after, now)}에 계정이 삭제됩니다.
        </p>
        {/* A deletion held back (the user is a team's only owner) stays scheduled past its date. */}
        {overdue && <p className={s.muted}>예정일이 지났지만 아직 삭제되지 않았습니다. 팀 워크스페이스의 유일한 owner라면 다른 멤버를 owner로 지정해야 삭제됩니다.</p>}
        <div className={s.cardActions}>
          <Button size="sm" variant="primary" onPress={runCancel} isDisabled={cancel.isPending}>
            삭제 취소
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className={s.muted}>계정을 삭제하면 7일 뒤에 모든 녹음과 노트가 지워집니다. 7일 안에는 취소할 수 있습니다.</p>
        <div className={s.cardActions}>
          <Button size="sm" variant="danger" onPress={() => setAsking(true)}>
            계정 삭제 요청
          </Button>
        </div>
      </>
    );
  }

  return (
    <section id="delete-account" className={s.section} aria-labelledby="set-delete-account">
      <h2 id="set-delete-account" className={s.heading}>
        계정 삭제
      </h2>
      {body}
      {asking && <RequestDeletionDialog onClose={() => setAsking(false)} />}
    </section>
  );
}

/** Mounted only while open: the password typed here is gone when it closes. */
function RequestDeletionDialog({ onClose }: { onClose: () => void }) {
  const request = useRequestAccountDeletion();
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirmed = phrase.trim() === CONFIRM_PHRASE;

  const submit = async () => {
    if (!confirmed || request.isPending) return;
    setError(null);
    try {
      await request.mutateAsync(password ? password : undefined);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "계정 삭제를 요청하지 못했습니다. 잠시 뒤 다시 시도하세요."));
      setPassword("");
    }
  };

  return (
    <ModalDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="계정 삭제 요청"
      role="alertdialog"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose} autoFocus>
            취소
          </Button>
          <Button variant="danger" onPress={submit} isDisabled={!confirmed || request.isPending}>
            삭제 요청
          </Button>
        </>
      }
    >
      <div className={a.stack}>
        <p>7일 뒤에 이 계정과 모든 녹음, 노트, 파일이 지워집니다. 그 전에는 이 화면에서 취소할 수 있습니다.</p>
        <TextField className={uiStyles.field} value={password} onChange={setPassword} type="password" autoComplete="current-password">
          <Label className={uiStyles.label}>비밀번호(비밀번호로 가입한 경우)</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <TextField className={uiStyles.field} value={phrase} onChange={setPhrase} isRequired autoComplete="off">
          <Label className={uiStyles.label}>확인을 위해 ‘{CONFIRM_PHRASE}’를 입력하세요</Label>
          <Input className={uiStyles.input} spellCheck={false} />
        </TextField>
        {error && (
          <p className={a.error} role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
