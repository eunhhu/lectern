// 공유 (D-P2-3): a new link for this recording (what it includes, expiry, an optional
// password), its address shown once right after it is made, and the recording's existing
// links with 회수. The address lives only in this component's state: closing the dialog
// unmounts the body and it is gone (never in storage, the query cache or the URL).

import { useEffect, useRef, useState } from "react";
import { Input, Label, Text, TextField } from "react-aria-components";
import { errorMessage } from "../../api/errors.ts";
import { useCreateShareLink, useShareLinks } from "../../api/queries.ts";
import type { Recording } from "../../api/types.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, CheckboxField, ModalDialog, SelectField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { ShareLinkRow } from "./ShareLinkRow.tsx";
import s from "./share.module.css";

const EXPIRY = [
  { id: "none", label: "만료 없음" },
  { id: "1", label: "1일 뒤" },
  { id: "7", label: "7일 뒤" },
  { id: "30", label: "30일 뒤" },
];
const MIN_PASSWORD = 8;

export function ShareDialog({ recording, isOpen, onOpenChange }: { recording: Recording; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ModalDialog isOpen={isOpen} onOpenChange={onOpenChange} title="공유" size="form">
      <ShareBody recording={recording} />
    </ModalDialog>
  );
}

function ShareBody({ recording }: { recording: Recording }) {
  const ws = recording.workspace_id;
  const links = useShareLinks(ws, recording.id);
  const create = useCreateShareLink(ws);
  const [transcript, setTranscript] = useState(false);
  const [audio, setAudio] = useState(false);
  const [expiry, setExpiry] = useState("none");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!url) return;
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [url]);

  const submit = async () => {
    if (create.isPending) return;
    if (password && password.length < MIN_PASSWORD) return setError("비밀번호는 8자 이상이어야 합니다.");
    setError(null);
    const days = expiry === "none" ? 0 : Number(expiry);
    try {
      const created = await create.mutateAsync({
        target_type: "recording",
        target_id: recording.id,
        scope: { transcript, audio },
        expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
        password: password || null,
      });
      setPassword("");
      setUrl(created.url);
    } catch (err) {
      setError(errorMessage(err, "링크를 만들지 못했습니다. 잠시 뒤 다시 시도하세요."));
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast({ title: "링크를 복사했습니다." });
    } catch {
      showToast({ title: "복사하지 못했습니다. 링크를 직접 선택해 복사하세요.", tone: "danger" });
    }
  };

  return (
    <>
      <section className={s.section} aria-labelledby="share-new">
        <h3 id="share-new" className={s.heading}>
          새 공유 링크
        </h3>
        {url ? (
          <div className={s.created} role="status">
            <p>이 링크는 지금만 볼 수 있습니다. 닫으면 다시 확인할 수 없으니 지금 복사하세요.</p>
            <div className={s.urlRow}>
              <TextField className={uiStyles.field} value={url} isReadOnly>
                <Label className={uiStyles.label}>공유 링크</Label>
                <Input ref={urlRef} className={uiStyles.input} spellCheck={false} />
              </TextField>
              <Button icon="copy" onPress={() => void copy()}>
                링크 복사
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className={s.muted}>링크를 아는 사람은 로그인 없이 문서를 볼 수 있습니다.</p>
            <CheckboxField isSelected={transcript} onChange={setTranscript}>
              전사 포함
            </CheckboxField>
            <CheckboxField isSelected={audio} onChange={setAudio}>
              오디오 포함
            </CheckboxField>
            <SelectField label="만료" items={EXPIRY} selectedKey={expiry} onSelectionChange={setExpiry} />
            <TextField className={uiStyles.field} value={password} onChange={setPassword} type="password" autoComplete="new-password">
              <Label className={uiStyles.label}>비밀번호 (선택)</Label>
              <Input className={uiStyles.input} />
              <Text slot="description" className={uiStyles.hint}>
                8자 이상. 비워 두면 링크만 알면 열립니다.
              </Text>
            </TextField>
            {error && (
              <p className={s.error} role="alert">
                <Icon name="alert" /> {error}
              </p>
            )}
            <div>
              <Button variant="primary" onPress={() => void submit()} isDisabled={create.isPending}>
                {create.isPending ? "만드는 중…" : "링크 만들기"}
              </Button>
            </div>
          </>
        )}
      </section>
      <section className={s.section} aria-labelledby="share-existing">
        <h3 id="share-existing" className={s.heading}>
          만든 링크
        </h3>
        {links.data && links.data.length > 0 ? (
          <ul className={s.list}>
            {links.data.map((link) => (
              <ShareLinkRow key={link.id} link={link} ws={ws} />
            ))}
          </ul>
        ) : (
          <p className={s.muted}>{links.isPending ? "불러오는 중…" : "이 녹음의 공유 링크가 없습니다."}</p>
        )}
        <p className={uiStyles.hint}>이미 만든 링크의 주소는 다시 볼 수 없습니다. 필요하면 회수하고 새로 만드세요.</p>
      </section>
    </>
  );
}
