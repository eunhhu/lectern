// 설정 › 초대 (P5-11, D-P5-6): owners and admins invite people to the current team
// workspace by e-mail and take open invitations back. The link exists only in the mail.
// Only an owner may invite someone as 관리자.

import { useState } from "react";
import { Form, Input, Label, TextField } from "react-aria-components";
import { isNotReady } from "../../../api/errors.ts";
import { useCreateInvite, useInvites, useRevokeInvite } from "../../../api/queries.ts";
import type { MembershipRole } from "../../../api/types.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { formatDate } from "../../../lib/format.ts";
import { ROLE_LABEL } from "../../../lib/roles.ts";
import { Button, SelectField, uiStyles } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import { NOT_READY_TEXT } from "../account/Tokens.tsx";
import s from "../settings.module.css";
import w from "./workspace.module.css";

type InviteRole = Exclude<MembershipRole, "owner">;

/** Drawn for owners and admins of a team workspace only. */
export function Invites() {
  const { current, workspaceId } = useWorkspace();
  const myRole = current?.role;
  const visible = current?.workspace.kind === "team" && (myRole === "owner" || myRole === "admin");
  if (!visible) return null;
  return <InvitesSection isOwner={myRole === "owner"} workspaceId={workspaceId} />;
}

function InvitesSection({ isOwner, workspaceId }: { isOwner: boolean; workspaceId: ReturnType<typeof useWorkspace>["workspaceId"] }) {
  const invites = useInvites(workspaceId);
  const create = useCreateInvite(workspaceId);
  const revoke = useRevokeInvite(workspaceId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const now = new Date();
  const roles = (isOwner ? (["member", "viewer", "admin"] as const) : (["member", "viewer"] as const)).map((r) => ({ id: r, label: ROLE_LABEL[r] }));

  const send = async () => {
    const to = email.trim();
    if (!to || create.isPending) return;
    try {
      await create.mutateAsync({ email: to, role });
      showToast({ title: `${to}(으)로 초대를 보냈습니다.` });
      setEmail("");
      setRole("member");
    } catch (err) {
      toastError("초대를 보내지 못했습니다.", err);
    }
  };

  const cancel = async (inviteId: string) => {
    try {
      await revoke.mutateAsync(inviteId);
      showToast({ title: "초대를 취소했습니다." });
    } catch (err) {
      toastError("초대를 취소하지 못했습니다.", err);
    }
  };

  let list;
  if (isNotReady(invites.error)) {
    list = null;
  } else if (!invites.data) {
    list = <p className={s.muted}>{invites.isPending ? "불러오는 중…" : "초대 목록을 불러오지 못했습니다."}</p>;
  } else if (invites.data.length === 0) {
    list = <p className={s.muted}>대기 중인 초대가 없습니다.</p>;
  } else {
    list = (
      <ul className={s.members} role="list" aria-label="대기 중인 초대">
        {invites.data.map((invite) => (
          <li key={invite.id} className={s.member}>
            <span className={s.memberText}>
              <span className={s.memberName}>{invite.email}</span>
              <span className={s.muted}>
                {ROLE_LABEL[invite.role]} · {formatDate(invite.expires_at, now)}에 만료
              </span>
            </span>
            <Button size="sm" variant="dangerText" aria-label={`초대 취소: ${invite.email}`} onPress={() => cancel(invite.id)} isDisabled={revoke.isPending}>
              초대 취소
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section id="invites" className={s.section} aria-labelledby="set-invites">
      <h2 id="set-invites" className={s.heading}>
        초대
      </h2>
      {isNotReady(invites.error) ? (
        <p className={s.muted}>{NOT_READY_TEXT}</p>
      ) : (
        <>
          <Form
            className={w.inviteForm}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <TextField className={uiStyles.field} value={email} onChange={setEmail} type="email" isRequired autoComplete="off">
              <Label className={uiStyles.label}>이메일</Label>
              <Input className={uiStyles.input} inputMode="email" spellCheck={false} />
            </TextField>
            <SelectField label="역할" items={roles} selectedKey={role} onSelectionChange={(key) => setRole(key as InviteRole)} />
            <Button type="submit" variant="primary" isDisabled={create.isPending || !email.trim()}>
              초대 보내기
            </Button>
          </Form>
          {list}
        </>
      )}
    </section>
  );
}
