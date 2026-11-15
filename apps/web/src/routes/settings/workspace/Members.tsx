// 설정 › 멤버 (P5-11, D-P5-6): who is in the current team workspace, and for owners and
// admins, changing roles and removing people. What a role cannot do is switched off here,
// not left to the server's 403: an admin cannot touch owners or other admins, nor make
// anyone owner or admin. The only owner cannot step down or leave.

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiClientError } from "../../../api/client.ts";
import { errorMessage, isNotReady } from "../../../api/errors.ts";
import { useMe, useMembers, useRemoveMember, useUpdateMember } from "../../../api/queries.ts";
import type { MembershipRole, WorkspaceMember } from "../../../api/types.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { ROLE_LABEL } from "../../../lib/roles.ts";
import { Avatar } from "../../../ui/Avatar.tsx";
import { Button, ModalDialog, SelectField } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import { NOT_READY_TEXT } from "../account/Tokens.tsx";
import s from "../settings.module.css";
import w from "./workspace.module.css";

const ALL_ROLES: MembershipRole[] = ["owner", "admin", "member", "viewer"];
export const LAST_OWNER_TEXT = "소유자가 한 명은 있어야 합니다.";

const canManage = (role: MembershipRole | undefined) => role === "owner" || role === "admin";

/** Whether `me` may change or remove `target` (the server's rule, D-P5-6). */
function mayEdit(me: MembershipRole | undefined, target: MembershipRole): boolean {
  if (me === "owner") return true;
  if (me === "admin") return target === "member" || target === "viewer";
  return false;
}

export function Members() {
  const { current, workspaceId, workspaces, switchTo } = useWorkspace();
  const me = useMe().data;
  const members = useMembers(workspaceId);
  const update = useUpdateMember(workspaceId);
  const remove = useRemoveMember(workspaceId);
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const myRole = current?.role;

  const report = (title: string, err: unknown) => {
    // 409 is the last-owner rule: the server's words, as they are.
    if (err instanceof ApiClientError && err.status === 409) showToast({ title: errorMessage(err), tone: "danger" });
    else if (isNotReady(err)) showToast({ title: NOT_READY_TEXT, tone: "info" });
    else toastError(title, err);
  };

  const changeRole = async (member: WorkspaceMember, role: MembershipRole) => {
    if (role === member.role) return;
    try {
      await update.mutateAsync({ userId: member.user_id, role });
      showToast({ title: `${member.display_name}님의 역할을 ${ROLE_LABEL[role]}(으)로 바꿨습니다.` });
    } catch (err) {
      report("역할을 바꾸지 못했습니다.", err);
    }
  };

  const runRemove = async () => {
    const member = removing;
    setRemoving(null);
    if (!member) return;
    const leaving = member.user_id === me?.id;
    try {
      await remove.mutateAsync(member.user_id);
      if (leaving) {
        const personal = workspaces.find((x) => x.workspace.kind === "personal")?.workspace.id ?? me?.personal_workspace_id;
        showToast({ title: `‘${current?.workspace.name ?? "워크스페이스"}’에서 나왔습니다.` });
        if (personal) switchTo(personal);
        await navigate({ to: "/" });
      } else {
        showToast({ title: `${member.display_name}님을 내보냈습니다.` });
      }
    } catch (err) {
      report(leaving ? "워크스페이스에서 나가지 못했습니다." : "멤버를 내보내지 못했습니다.", err);
    }
  };

  let body;
  if (current?.workspace.kind === "personal") {
    body = <p className={s.muted}>개인 워크스페이스에는 다른 멤버가 없습니다.</p>;
  } else if (isNotReady(members.error)) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (!members.data) {
    body = <p className={s.muted}>{members.isPending ? "불러오는 중…" : "멤버를 불러오지 못했습니다."}</p>;
  } else {
    const owners = members.data.filter((m) => m.role === "owner").length;
    body = (
      <div className={w.tableWrap}>
        <table className={w.table}>
          <caption className={w.caption}>멤버 {members.data.length}명</caption>
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">이메일</th>
              <th scope="col">역할</th>
              <th scope="col">동작</th>
            </tr>
          </thead>
          <tbody>
            {members.data.map((m) => {
              const mine = m.user_id === me?.id;
              const soleOwner = m.role === "owner" && owners <= 1;
              const editable = mayEdit(myRole, m.role) && !soleOwner;
              // An admin may only hand out member and viewer.
              const choices = (myRole === "owner" ? ALL_ROLES : ALL_ROLES.filter((r) => r === "member" || r === "viewer")).map((r) => ({
                id: r,
                label: ROLE_LABEL[r],
              }));
              const items = editable ? choices : [{ id: m.role, label: ROLE_LABEL[m.role] }];
              return (
                <tr key={m.user_id}>
                  <th scope="row" className={w.nameCell}>
                    <span className={w.person}>
                      <Avatar id={m.user_id} name={m.display_name} />
                      <span>
                        {m.display_name}
                        {mine && <span className={w.meMark}> 나</span>}
                      </span>
                    </span>
                  </th>
                  <td className={s.muted}>{m.email}</td>
                  <td className={w.roleCell}>
                    <SelectField
                      label={`역할: ${m.display_name}`}
                      hideLabel
                      items={items}
                      selectedKey={m.role}
                      isDisabled={!editable || update.isPending}
                      onSelectionChange={(key) => void changeRole(m, key as MembershipRole)}
                    />
                    {soleOwner && (mine || canManage(myRole)) && <p className={w.cellHint}>{LAST_OWNER_TEXT}</p>}
                  </td>
                  <td className={w.actionCell}>
                    {mine ? (
                      <Button size="sm" variant="dangerText" isDisabled={soleOwner} onPress={() => setRemoving(m)}>
                        나가기
                      </Button>
                    ) : (
                      canManage(myRole) && (
                        <Button
                          size="sm"
                          variant="dangerText"
                          aria-label={`내보내기: ${m.display_name}`}
                          isDisabled={!mayEdit(myRole, m.role) || soleOwner}
                          onPress={() => setRemoving(m)}
                        >
                          내보내기
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const leaving = removing !== null && removing.user_id === me?.id;
  return (
    <section id="members" className={s.section} aria-labelledby="set-members">
      <h2 id="set-members" className={s.heading}>
        멤버
      </h2>
      {body}
      <ModalDialog
        isOpen={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={leaving ? "워크스페이스 나가기" : "멤버 내보내기"}
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setRemoving(null)} autoFocus>
              취소
            </Button>
            <Button variant="danger" onPress={runRemove}>
              {leaving ? "나가기" : "내보내기"}
            </Button>
          </>
        }
      >
        <p>
          {leaving
            ? "이 워크스페이스에서 나갈까요?"
            : `${removing?.display_name ?? ""}님을 워크스페이스에서 내보낼까요? 이 사람이 올린 녹음은 워크스페이스에 남습니다.`}
        </p>
      </ModalDialog>
    </section>
  );
}
