// 관리 › 사용자 (P5-12, P5-16): every account, from the old console's overview, with the old
// console's actions sent the same way (`POST`/`PATCH`/`DELETE /api/admin/users`): approve a
// pending sign-up, suspend and restore, change the service role, delete, and make a new
// account. Role, status and a search (name, e-mail, memo) filter the list and stay in the
// address. The server's rules are mirrored so impossible actions are off: nobody changes
// their own role or status or deletes themselves, only an owner touches an owner or makes
// one, owners are not deleted. Deleting is permanent, so the dialog asks for the e-mail again.
// The full edit form is the user's own page (UserDetailPage).

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Input, Label, TextArea, TextField } from "react-aria-components";
import type { AdminNewUser, AdminOverview, AdminUser } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminOverview, useCreateAdminUser, useDeleteAdminUser, useMe, useUpdateAdminUser } from "../../api/queries.ts";
import { insideDialog } from "../../app/GlobalShortcuts.tsx";
import { currentOverlay } from "../../app/overlays.ts";
import { getPreferences } from "../../app/preferences.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { isImeComposing, isTypingTarget } from "../../lib/keyboard.ts";
import { formatBytes, formatCount, formatDate, formatRelative } from "../../lib/format.ts";
import { ROLE_LABEL } from "../../lib/roles.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox, ModalDialog, SelectField, SwitchField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { DataTable, type Column } from "./DataTable.tsx";
import { USER_STATUS_LABEL } from "./format.ts";
import { SearchBox } from "./SearchBox.tsx";
import s from "./admin.module.css";

export interface AdminUsersSearch {
  role?: AdminUser["role"];
  status?: AdminUser["status"];
  q?: string;
  /** `?new=1` (the command palette's 새 사용자) opens the new-user dialog on arrival. */
  new?: 1;
}

export const STATUS_TONE = { active: "success", pending: "attention", suspended: "danger" } as const;
const ROLES = ["owner", "admin", "member", "viewer"] as const;
const STATUSES = ["active", "pending", "suspended"] as const;

/** The roles I may give: only an owner makes owners. */
export function grantableRoles(iAmOwner: boolean) {
  return (iAmOwner ? ROLES : ROLES.filter((r) => r !== "owner")).map((r) => ({ id: r, label: ROLE_LABEL[r] }));
}

function matches(u: AdminUser, f: AdminUsersSearch) {
  if (f.role && u.role !== f.role) return false;
  if (f.status && u.status !== f.status) return false;
  const q = f.q?.trim().toLowerCase();
  return !q || [u.display_name, u.email, u.memo].join(" ").toLowerCase().includes(q);
}

export function UsersPage() {
  usePageTitle("관리 · 사용자");
  const search = useSearch({ from: "/_authed/admin/users" });
  const navigate = useNavigate();
  const overview = useAdminOverview();
  const me = useMe().data;
  const update = useUpdateAdminUser();
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const now = new Date();
  const iAmOwner = me?.system_role === "owner";
  const all = overview.data?.users ?? [];
  const rows = all.filter((u) => matches(u, search));

  const setFilter = (next: AdminUsersSearch) => void navigate({ to: "/admin/users", search: { ...search, ...next }, replace: true });
  const ready = Boolean(overview.data);

  // ?new=1 from the palette, once the defaults are in.
  useEffect(() => {
    if (!search.new || !ready) return;
    setCreating(true);
    void navigate({ to: "/admin/users", search: { ...search, new: undefined }, replace: true });
  }, [search, ready, navigate]);

  // The old console's C: a new user, with the app's single-key rules (DESIGN.md §1.2).
  // "G then C" is the app's 일정, not this.
  useEffect(() => {
    let lastG = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g") lastG = Date.now();
      if (e.key.toLowerCase() !== "c" || Date.now() - lastG < 1_200) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isImeComposing(e)) return;
      if (!ready || !getPreferences().singleKeyShortcuts || currentOverlay() || insideDialog(e.target) || isTypingTarget(e.target)) return;
      e.preventDefault();
      setCreating(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ready]);

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
          <Link to="/admin/users/$userId" params={{ userId: u.id }} className={s.link}>
            {u.display_name}
          </Link>
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
        const items = editable ? grantableRoles(iAmOwner) : [{ id: u.role, label: ROLE_LABEL[u.role] }];
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

  const countBy = <K extends "role" | "status">(key: K, value: AdminUser[K]) => all.filter((u) => u[key] === value).length;

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>사용자</h1>
        {overview.data && <span className={s.muted}>{rows.length === all.length ? `${formatCount(all.length)}명` : `${formatCount(rows.length)}명 / ${formatCount(all.length)}명`}</span>}
        <div className={s.headerActions}>
          <Button variant="primary" icon="plus" onPress={() => setCreating(true)} isDisabled={!overview.data}>
            새 사용자
          </Button>
        </div>
      </header>
      <div className={s.filters}>
        <SelectField
          label="역할"
          items={[{ id: "all", label: "전체" }, ...ROLES.map((r) => ({ id: r, label: `${ROLE_LABEL[r]} (${formatCount(countBy("role", r))})` }))]}
          selectedKey={search.role ?? "all"}
          onSelectionChange={(v) => setFilter({ role: v === "all" ? undefined : (v as AdminUser["role"]) })}
        />
        <SelectField
          label="상태"
          items={[{ id: "all", label: "전체" }, ...STATUSES.map((st) => ({ id: st, label: `${USER_STATUS_LABEL[st]} (${formatCount(countBy("status", st))})` }))]}
          selectedKey={search.status ?? "all"}
          onSelectionChange={(v) => setFilter({ status: v === "all" ? undefined : (v as AdminUser["status"]) })}
        />
        <SearchBox label="검색" placeholder="이름, 이메일, 메모" value={search.q} onCommit={(q) => setFilter({ q })} />
      </div>
      {overview.isError ? (
        <ErrorBox title={errorMessage(overview.error, "사용자를 불러오지 못했습니다.")} onRetry={() => void overview.refetch()} />
      ) : (
        <DataTable
          caption="사용자"
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          empty={overview.isPending ? "불러오는 중…" : all.length ? "조건에 맞는 사용자가 없습니다." : "사용자가 없습니다."}
          onRowClick={(u) => void navigate({ to: "/admin/users/$userId", params: { userId: u.id } })}
        />
      )}
      {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />}
      {creating && overview.data && (
        <NewUserDialog
          defaults={overview.data.settings}
          iAmOwner={iAmOwner}
          onClose={() => setCreating(false)}
          onCreated={(id) => void navigate({ to: "/admin/users/$userId", params: { userId: id } })}
        />
      )}
    </>
  );
}

export function DeleteUserDialog({ user, onClose, onDeleted }: { user: AdminUser; onClose: () => void; onDeleted?: () => void }) {
  const remove = useDeleteAdminUser();
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();
  const run = async () => {
    if (!matches || remove.isPending) return;
    try {
      await remove.mutateAsync(user.id);
      showToast({ title: `${user.email} 계정을 삭제했습니다.` });
      onClose();
      onDeleted?.();
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
            {remove.isPending ? "실행 중…" : "영구 삭제"}
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

/** "새 사용자": the old console's new-member form, with the service's defaults filled in. */
function NewUserDialog({
  defaults,
  iAmOwner,
  onClose,
  onCreated,
}: {
  defaults: AdminOverview["settings"];
  iAmOwner: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateAdminUser();
  const [form, setForm] = useState<AdminNewUser>({
    email: "",
    displayName: "",
    password: "",
    role: defaults.default_user_role,
    status: "active",
    canIngest: true,
    canShare: true,
    canUseServerKey: defaults.default_can_use_server_key,
    quotaMb: defaults.default_quota_mb,
    memo: "",
  });
  const [quota, setQuota] = useState(String(defaults.default_quota_mb));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<AdminNewUser>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (create.isPending) return;
    if (!form.email.trim()) return setError("아이디 또는 이메일을 입력하세요.");
    if (form.password.length < 6) return setError("초기 비밀번호는 6자 이상이어야 합니다.");
    setError(null);
    try {
      const id = await create.mutateAsync({ ...form, email: form.email.trim(), displayName: form.displayName.trim(), memo: form.memo.trim(), quotaMb: Math.max(0, Math.round(Number(quota) || 0)) });
      showToast({ title: "새 사용자를 만들었습니다." });
      onClose();
      onCreated(id);
    } catch (err) {
      setError(errorMessage(err, "사용자를 만들지 못했습니다."));
    }
  };

  return (
    <ModalDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title="새 사용자"
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            취소
          </Button>
          <Button variant="primary" onPress={submit} isDisabled={create.isPending}>
            {create.isPending ? "실행 중…" : "사용자 만들기"}
          </Button>
        </>
      }
    >
      <div className={s.field}>
        <TextField className={uiStyles.field} value={form.email} onChange={(email) => set({ email })} autoComplete="off" autoFocus isRequired>
          <Label className={uiStyles.label}>아이디 또는 이메일</Label>
          <Input className={uiStyles.input} spellCheck={false} placeholder="student@example.com" />
        </TextField>
        <TextField className={uiStyles.field} value={form.displayName} onChange={(displayName) => set({ displayName })} maxLength={80}>
          <Label className={uiStyles.label}>표시 이름</Label>
          <Input className={uiStyles.input} placeholder="비우면 이메일 앞부분" />
        </TextField>
        <TextField className={uiStyles.field} value={form.password} onChange={(password) => set({ password })} type="password" autoComplete="new-password" isRequired>
          <Label className={uiStyles.label}>초기 비밀번호</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <p className={uiStyles.hint}>6자 이상. 처음 로그인한 뒤 본인이 바꿀 수 있습니다.</p>
        <div className={s.formRow}>
          <SelectField label="역할" items={grantableRoles(iAmOwner)} selectedKey={form.role} onSelectionChange={(role) => set({ role: role as AdminUser["role"] })} />
          <SelectField
            label="상태"
            items={[
              { id: "active", label: USER_STATUS_LABEL.active },
              { id: "pending", label: USER_STATUS_LABEL.pending },
            ]}
            selectedKey={form.status}
            onSelectionChange={(status) => set({ status: status as AdminNewUser["status"] })}
          />
        </div>
        <SwitchField isSelected={form.canIngest} onChange={(canIngest) => set({ canIngest })}>
          녹음·업로드 허용
        </SwitchField>
        <SwitchField isSelected={form.canShare} onChange={(canShare) => set({ canShare })}>
          공개 공유 링크 허용
        </SwitchField>
        <SwitchField isSelected={form.canUseServerKey} onChange={(canUseServerKey) => set({ canUseServerKey })}>
          서버 AI 키로 노트 만들기
        </SwitchField>
        <TextField className={uiStyles.field} value={quota} onChange={setQuota} inputMode="numeric">
          <Label className={uiStyles.label}>오디오 저장 한도(MB)</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <p className={uiStyles.hint}>0이면 무제한입니다.</p>
        <TextField className={uiStyles.field} value={form.memo} onChange={(memo) => set({ memo })} maxLength={500}>
          <Label className={uiStyles.label}>메모</Label>
          <TextArea className={`${uiStyles.input} ${s.textarea}`} rows={2} placeholder="소속, 학과, 운영 메모" />
        </TextField>
        {error && (
          <p className={s.error} role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
