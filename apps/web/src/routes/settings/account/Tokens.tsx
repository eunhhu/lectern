// 설정 › 액세스 토큰 (P5-10, D-P5-3): personal access tokens for scripts and other apps.
// A token's secret is shown once, in the dialog that made it, and lives only in that
// dialog's state: closing it forgets the secret (not in the query cache, URL or storage).
// The v1 API token is listed as a row of its own and is not revoked here.

import { useState } from "react";
import { Input, Label, Radio, RadioGroup, TextField } from "react-aria-components";
import { isNotReady } from "../../../api/errors.ts";
import { useAccessTokens, useCreateAccessToken, useRevokeAccessToken } from "../../../api/queries.ts";
import type { AccessToken, AccessTokenScope } from "../../../api/types.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { formatDate, formatRelative } from "../../../lib/format.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { Button, ModalDialog, SelectField, uiStyles } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import s from "../settings.module.css";
import a from "./account.module.css";

export const NOT_READY_TEXT = "준비 중입니다.";

const SCOPES = {
  read: ["recordings:read"],
  write: ["recordings:read", "recordings:write"],
} satisfies Record<string, AccessTokenScope[]>;
type ScopeChoice = keyof typeof SCOPES;

const EXPIRY = [
  { id: "30", label: "30일" },
  { id: "90", label: "90일" },
  { id: "365", label: "1년" },
  { id: "never", label: "만료 없음" },
];

const DAY_MS = 86_400_000;

/** The v1 API token: listed, but rotated in the v1 settings, not revoked here. */
export const isV1Token = (t: AccessToken) => t.name === "API 토큰" && t.id.startsWith("tok_");

const scopeLabel = (t: AccessToken) => (t.scopes.includes("recordings:write") ? "읽기·쓰기" : "읽기");

export function Tokens() {
  const tokens = useAccessTokens();
  const revoke = useRevokeAccessToken();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AccessToken | null>(null);
  const now = new Date();

  const runRevoke = async () => {
    const token = revoking;
    setRevoking(null);
    if (!token) return;
    try {
      await revoke.mutateAsync(token.id);
      showToast({ title: `‘${token.name}’ 토큰을 회수했습니다.` });
    } catch (err) {
      toastError("토큰을 회수하지 못했습니다.", err);
    }
  };

  let body;
  if (isNotReady(tokens.error)) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (!tokens.data) {
    body = <p className={s.muted}>{tokens.isPending ? "불러오는 중…" : "토큰을 불러오지 못했습니다."}</p>;
  } else {
    body = (
      <>
        <ul className={s.members} role="list">
          {tokens.data.map((t) => (
            <li key={t.id} className={s.member}>
              <span className={s.memberText}>
                <span className={s.memberName}>{t.name}</span>
                <span className={s.muted}>
                  <code className={a.code}>{t.prefix}…</code> · {scopeLabel(t)} · {t.expires_at ? `${formatDate(t.expires_at, now)}에 만료` : "만료 없음"} ·{" "}
                  {t.last_used_at ? `마지막 사용 ${formatRelative(t.last_used_at, now)}` : "사용한 적 없음"}
                </span>
              </span>
              {!isV1Token(t) && (
                <Button size="sm" variant="dangerText" aria-label={`회수: ${t.name}`} onPress={() => setRevoking(t)}>
                  회수
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className={s.cardActions}>
          <Button size="sm" variant="primary" icon="plus" onPress={() => setCreating(true)}>
            새 토큰
          </Button>
        </div>
      </>
    );
  }

  return (
    <section id="tokens" className={s.section} aria-labelledby="set-tokens">
      <h2 id="set-tokens" className={s.heading}>
        액세스 토큰
      </h2>
      <p className={s.muted}>스크립트나 다른 앱에서 Lectern API를 쓸 때 사용하는 토큰입니다.</p>
      {body}
      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}
      <ModalDialog
        isOpen={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="토큰 회수"
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setRevoking(null)} autoFocus>
              취소
            </Button>
            <Button variant="danger" onPress={runRevoke}>
              회수
            </Button>
          </>
        }
      >
        <p>이 토큰을 회수할까요? 이 토큰을 쓰는 앱은 더 이상 접속할 수 없습니다.</p>
      </ModalDialog>
    </section>
  );
}

/** Mounted only while open, so the secret it holds is gone when it closes. */
function CreateTokenDialog({ onClose }: { onClose: () => void }) {
  const { current, workspaceId } = useWorkspace();
  const create = useCreateAccessToken();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ScopeChoice>("read");
  const [expiry, setExpiry] = useState("90");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (create.isPending) return;
    if (!name.trim()) {
      setError("토큰 이름을 입력해 주세요.");
      return;
    }
    setError(null);
    try {
      const made = await create.mutateAsync({
        workspace_id: workspaceId,
        name: name.trim(),
        scopes: SCOPES[scope],
        expires_at: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * DAY_MS).toISOString(),
      });
      setSecret(made.secret);
    } catch (err) {
      toastError("토큰을 만들지 못했습니다.", err);
    }
  };
  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      showToast({ title: "토큰을 복사했습니다." });
    } catch {
      showToast({ title: "토큰을 복사하지 못했습니다.", description: "토큰을 직접 선택해 복사하세요.", tone: "danger" });
    }
  };

  return (
    <ModalDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="새 토큰"
      size="form"
      isDismissable={secret === null}
      footer={
        secret === null ? (
          <>
            <Button variant="ghost" onPress={onClose}>
              취소
            </Button>
            <Button variant="primary" onPress={submit} isDisabled={create.isPending}>
              {create.isPending ? "만드는 중…" : "만들기"}
            </Button>
          </>
        ) : (
          <Button key="done" variant="primary" onPress={onClose}>
            완료
          </Button>
        )
      }
    >
      {secret === null ? (
        <div className={a.stack}>
          <TextField className={uiStyles.field} value={name} onChange={setName} isRequired maxLength={100} autoFocus>
            <Label className={uiStyles.label}>이름</Label>
            <Input className={uiStyles.input} />
          </TextField>
          <RadioGroup className={s.radioGroup} value={scope} onChange={(v) => setScope(v as ScopeChoice)} orientation="horizontal">
            <Label className={uiStyles.label}>권한</Label>
            <div className={s.radios}>
              <Radio value="read" className={s.radio}>
                <span className={s.radioMark} aria-hidden="true" />
                읽기 전용
              </Radio>
              <Radio value="write" className={s.radio}>
                <span className={s.radioMark} aria-hidden="true" />
                읽기·쓰기
              </Radio>
            </div>
          </RadioGroup>
          <SelectField label="만료" items={EXPIRY} selectedKey={expiry} onSelectionChange={setExpiry} />
          {current && <p className={uiStyles.hint}>‘{current.workspace.name}’ 워크스페이스에서만 쓸 수 있습니다.</p>}
          {error && (
            <p className={a.error} role="alert">
              <Icon name="alert" size={16} /> {error}
            </p>
          )}
        </div>
      ) : (
        <div className={a.stack}>
          <div className={s.urlRow}>
            <TextField className={uiStyles.field} value={secret} isReadOnly>
              <Label className={uiStyles.label}>토큰</Label>
              {/* Focus lands on the secret, ready to select or copy. */}
              <Input className={uiStyles.input} autoFocus spellCheck={false} autoComplete="off" />
            </TextField>
            <Button icon="copy" onPress={copy}>
              복사
            </Button>
          </div>
          <p className={s.warning} role="status">
            <Icon name="alert" size={16} />
            이 토큰은 지금만 볼 수 있습니다. 안전한 곳에 보관하세요.
          </p>
        </div>
      )}
    </ModalDialog>
  );
}
