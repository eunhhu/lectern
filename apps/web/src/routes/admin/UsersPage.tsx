// 관리 › 사용자 (P5-12): every account, from the old console's overview, with the old
// console's actions sent the same way (`PATCH`/`DELETE /api/admin/users/:id`): approve a
// pending sign-up, suspend and restore, change the service role, delete. The server's rules
// are mirrored so impossible actions are off: nobody changes their own role or status or
// deletes themselves, only an owner touches an owner or makes one, owners are not deleted.
// Deleting is permanent, so the dialog asks for the account's e-mail again.

import { useState } from "react";
import { Input, Label, TextField } from "react-aria-components";
import type { AdminUser } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminOverview, useDeleteAdminUser, useMe, useUpdateAdminUser } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatDate, formatRelative } from "../../lib/format.ts";
import { ROLE_LABEL } from "../../lib/roles.ts";
import { Badge, Button, ErrorBox, ModalDialog, SelectField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { DataTable, type Column } from "./DataTable.tsx";
import { USER_STATUS_LABEL } from "./format.ts";
import s from "./admin.module.css";

const STATUS_TONE = { active: "success", pending: "attention", suspended: "danger" } as const;

export function UsersPage() {
  usePageTitle("관리 · 사용자");
  const overview = useAdminOverview();
  const me = useMe().data;
  const update = useUpdateAdminUser();
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const now = new Date();
  const iAmOwner = me?.system_role === "owner";

  const patch = async (user: AdminUser, body: Parameters<typeof update.mutateAsync>[0]["patch"], done: string) => {
    try {
      await update.mutateAsync({ id: user.id, patch: body });
      showToast({ title: done });
    } catch (err) {
      toastError("사용자를 바꾸지 못했습니다.", err);
    }
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "user",
      header: "사용자",
      sortValue: (u) => u.display_name,
      cell: (u) => (
        <span className={s.person}>
          {u.display_name}
          <span className={s.muted}>{u.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "역할",
      sortValue: (u) => u.role,
      cell: (u) => {
        const self = u.id === me?.id;
        const editable = !self && (iAmOwner || u.role !== "owner");
        const roles = (iAmOwner ? (["owner", "admin", "member", "viewer"] as const) : (["admin", "member", "viewer"] as const)).map((r) => ({ id: r, label: ROLE_LABEL[r] }));
        const items = editable ? roles : [{ id: u.role, label: ROLE_LABEL[u.role] }];
        return (
          <SelectField
            label={`역할: ${u.email}`}
            hideLabel
            items={items}
            selectedKey={u.role}
            isDisabled={!editable || update.isPending}
            onSelectionChange={(role) => {
              if (role !== u.role) void patch(u, { role: role as AdminUser["role"] }, `${u.email}의 역할을 ${ROLE_LABEL[role as AdminUser["role"]]}(으)로 바꿨습니다.`);
            }}
          />
        );
      },
    },
    { key: "status", header: "상태", sortValue: (u) => u.status, cell: (u) => <Badge tone={STATUS_TONE[u.status]}>{USER_STATUS_LABEL[u.status]}</Badge> },
    { key: "created", header: "가입일", sortValue: (u) => Date.parse(u.created_at), cell: (u) => formatDate(u.created_at, now) },
    {
      key: "login",
      header: "마지막 로그인",
      sortValue: (u) => (u.last_login_at ? Date.parse(u.last_login_at) : null),
      cell: (u) => (u.last_login_at ? formatRelative(u.last_login_at, now) : "없음"),
    },
    { key: "lectures", header: "녹음", align: "right", sortValue: (u) => u.lecture_count, cell: (u) => formatCount(u.lecture_count) },
    { key: "audio", header: "오디오", align: "right", sortValue: (u) => u.audio_bytes, cell: (u) => formatBytes(u.audio_bytes) },
    {
      key: "actions",
      header: "동작",
      cell: (u) => {
        const self = u.id === me?.id;
        const locked = self || (u.role === "owner" && !iAmOwner);
        return (
          <span className={s.headerActions}>
            {u.status === "pending" && (
              <Button size="sm" variant="primary" aria-label={`승인: ${u.email}`} isDisabled={locked} onPress={() => patch(u, { status: "active" }, `${u.email} 가입을 승인했습니다.`)}>
                승인
              </Button>
            )}
            {u.status === "active" && (
              <Button size="sm" aria-label={`정지: ${u.email}`} isDisabled={locked} onPress={() => patch(u, { status: "suspended" }, `${u.email} 계정을 정지했습니다.`)}>
                정지
              </Button>
            )}
            {u.status === "suspended" && (
              <Button size="sm" aria-label={`정지 해제: ${u.email}`} isDisabled={locked} onPress={() => patch(u, { status: "active" }, `${u.email} 계정의 정지를 풀었습니다.`)}>
                정지 해제
              </Button>
            )}
            <Button size="sm" variant="dangerText" aria-label={`삭제: ${u.email}`} isDisabled={self || u.role === "owner"} onPress={() => setDeleting(u)}>
              삭제
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>사용자</h1>
        {overview.data && <span className={s.muted}>{formatCount(overview.data.users.length)}명</span>}
      </header>
      {overview.isError ? (
        <ErrorBox title={errorMessage(overview.error, "사용자를 불러오지 못했습니다.")} onRetry={() => void overview.refetch()} />
      ) : (
        <DataTable caption="사용자" columns={columns} rows={overview.data?.users ?? []} rowKey={(u) => u.id} empty={overview.isPending ? "불러오는 중…" : "사용자가 없습니다."} />
      )}
      {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function DeleteUserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const remove = useDeleteAdminUser();
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();
  const run = async () => {
    if (!matches || remove.isPending) return;
    try {
      await remove.mutateAsync(user.id);
      showToast({ title: `${user.email} 계정을 삭제했습니다.` });
      onClose();
    } catch (err) {
      toastError("사용자를 삭제하지 못했습니다.", err);
    }
  };
  return (
    <ModalDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="사용자 삭제"
      role="alertdialog"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose} autoFocus>
            취소
          </Button>
          <Button variant="danger" onPress={run} isDisabled={!matches || remove.isPending}>
            영구 삭제
          </Button>
        </>
      }
    >
      <div className={s.field}>
        <p>
          {user.email} 계정과 이 사용자가 가진 녹음 {formatCount(user.lecture_count)}개, 오디오 {formatBytes(user.audio_bytes)}가 영구 삭제됩니다. 되돌릴 수
          없습니다.
        </p>
        <TextField className={uiStyles.field} value={typed} onChange={setTyped} autoComplete="off">
          <Label className={uiStyles.label}>확인을 위해 이메일을 입력하세요</Label>
          <Input className={uiStyles.input} spellCheck={false} />
        </TextField>
      </div>
    </ModalDialog>
  );
}
