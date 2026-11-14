// 관리 › 사용자 › 한 사람 (P5-16): what the old console's member panel showed and its edit
// form, sent the same way (`PATCH /api/admin/users/:id`, camelCase, the whole form at once;
// the server keeps a key that is not sent). A new password goes only when one was typed
// (six characters or more; the server would ignore a shorter one silently). The server's
// rules hold: my own role and status are fixed here, and an owner's account is changed by
// an owner only.

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Input, Label, TextArea, TextField } from "react-aria-components";
import type { AdminUser, AdminUserPatch } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminOverview, useMe, useUpdateAdminUser } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatDateTime, formatRelative } from "../../lib/format.ts";
import { ROLE_LABEL } from "../../lib/roles.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox, Progress, SelectField, SwitchField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { USER_STATUS_LABEL } from "./format.ts";
import { DeleteUserDialog, grantableRoles, STATUS_TONE } from "./UsersPage.tsx";
import s from "./admin.module.css";

const MIB = 1_048_576;

export function UserDetailPage() {
  const { userId } = useParams({ from: "/_authed/admin/users/$userId" });
  const overview = useAdminOverview();
  const user = overview.data?.users.find((u) => u.id === userId);
  usePageTitle(user ? `관리 · ${user.display_name}` : "관리 · 사용자");

  if (overview.isError) {
    return (
      <>
        <BackLink />
        <ErrorBox title={errorMessage(overview.error, "사용자를 불러오지 못했습니다.")} onRetry={() => void overview.refetch()} />
      </>
    );
  }
  if (!overview.data) return <BackLink />;
  if (!user) {
    return (
      <>
        <BackLink />
        <ErrorBox title="사용자를 찾을 수 없습니다." />
      </>
    );
  }
  // A fresh form for each account (a changed id, or a save that came back).
  return <UserDetail key={user.id} user={user} />;
}

function UserDetail({ user }: { user: AdminUser }) {
  const me = useMe().data;
  const navigate = useNavigate();
  const update = useUpdateAdminUser();
  const [deleting, setDeleting] = useState(false);
  const now = new Date();
  const self = user.id === me?.id;
  const iAmOwner = me?.system_role === "owner";
  const locked = user.role === "owner" && !iAmOwner;
  const quotaBytes = user.quota_mb * MIB;

  const [name, setName] = useState(user.display_name);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [canIngest, setCanIngest] = useState(user.can_ingest);
  const [canShare, setCanShare] = useState(user.can_share);
  const [canUseServerKey, setCanUseServerKey] = useState(user.can_use_server_key);
  const [quota, setQuota] = useState(String(user.quota_mb));
  const [memo, setMemo] = useState(user.memo);
  const [password, setPassword] = useState("");
  const [revoke, setRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (update.isPending) return;
    if (password && password.length < 6) return setError("새 비밀번호는 6자 이상이어야 합니다.");
    setError(null);
    const patch: AdminUserPatch = {
      displayName: name.trim(),
      role,
      status,
      canIngest,
      canShare,
      canUseServerKey,
      quotaMb: Math.max(0, Math.round(Number(quota) || 0)),
      memo: memo.trim(),
      revokeSessions: revoke,
      ...(password ? { newPassword: password } : {}),
    };
    try {
      await update.mutateAsync({ id: user.id, patch });
      setPassword("");
      setRevoke(false);
      showToast({ title: "사용자 정보를 저장했습니다." });
    } catch (err) {
      setError(errorMessage(err, "사용자 정보를 저장하지 못했습니다."));
    }
  };

  const approve = async () => {
    try {
      await update.mutateAsync({ id: user.id, patch: { status: "active" } });
      setStatus("active");
      showToast({ title: `${user.email} 가입을 승인했습니다.` });
    } catch (err) {
      toastError("가입을 승인하지 못했습니다.", err);
    }
  };

  return (
    <>
      <BackLink />
      <header className={s.header}>
        <h1 className={s.title}>{user.display_name}</h1>
        <Badge tone={STATUS_TONE[user.status]}>{USER_STATUS_LABEL[user.status]}</Badge>
        <div className={s.headerActions}>
          <Link to="/admin/recordings" search={{ owner: user.id }} className={s.link}>
            이 사용자의 녹음
          </Link>
          {user.status === "pending" && (
            <Button variant="primary" onPress={approve} isDisabled={self || locked || update.isPending}>
              가입 승인
            </Button>
          )}
        </div>
      </header>
      <dl className={s.facts}>
        <div>
          <dt>이메일</dt>
          <dd className={s.code}>{user.email}</dd>
        </div>
        <div>
          <dt>역할</dt>
          <dd>
            {ROLE_LABEL[user.role]}
            {self && <span className={s.muted}> · 나</span>}
          </dd>
        </div>
        <div>
          <dt>녹음</dt>
          <dd>
            {formatCount(user.lecture_count)}개 · 공개 {formatCount(user.public_count)} · 오류 {formatCount(user.error_count)}
          </dd>
        </div>
        <div>
          <dt>세션</dt>
          <dd>{formatCount(user.session_count)}개 기기</dd>
        </div>
        <div>
          <dt>최근 로그인</dt>
          <dd>{user.last_login_at ? formatRelative(user.last_login_at, now) : "기록 없음"}</dd>
        </div>
        <div>
          <dt>가입</dt>
          <dd>{formatDateTime(user.created_at, now)}</dd>
        </div>
        <div>
          <dt>ID</dt>
          <dd className={s.code}>{user.id}</dd>
        </div>
      </dl>
      <div className={s.usage}>
        {quotaBytes > 0 ? (
          <Progress
            value={Math.min(1, user.audio_bytes / quotaBytes)}
            label="오디오 사용량"
            valueLabel={`${formatBytes(user.audio_bytes)} / ${formatBytes(quotaBytes)}`}
          />
        ) : (
          <p>
            오디오 사용량 {formatBytes(user.audio_bytes)} <span className={s.muted}>· 한도 없음</span>
          </p>
        )}
      </div>

      <form
        className={s.form}
        aria-label="프로필과 권한"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className={s.subheading}>프로필과 권한</h2>
        {locked && <p className={uiStyles.hint}>소유자 계정은 소유자만 바꿀 수 있습니다.</p>}
        <fieldset className={s.fieldset} disabled={locked}>
          <TextField className={uiStyles.field} value={name} onChange={setName} maxLength={80} isDisabled={locked}>
            <Label className={uiStyles.label}>표시 이름</Label>
            <Input className={uiStyles.input} />
          </TextField>
          <div className={s.formRow}>
            <SelectField
              label="역할"
              items={self || locked ? [{ id: user.role, label: ROLE_LABEL[user.role] }] : grantableRoles(iAmOwner)}
              selectedKey={role}
              isDisabled={self || locked}
              description={self ? "내 역할은 바꿀 수 없습니다." : undefined}
              onSelectionChange={(v) => setRole(v as AdminUser["role"])}
            />
            <SelectField
              label="상태"
              items={(["active", "pending", "suspended"] as const).map((st) => ({ id: st, label: USER_STATUS_LABEL[st] }))}
              selectedKey={status}
              isDisabled={self || locked}
              onSelectionChange={(v) => setStatus(v as AdminUser["status"])}
            />
          </div>
          <SwitchField isSelected={canIngest} onChange={setCanIngest} isDisabled={locked}>
            녹음·업로드 허용
          </SwitchField>
          <SwitchField isSelected={canShare} onChange={setCanShare} isDisabled={locked}>
            공개 공유 링크 허용
          </SwitchField>
          <SwitchField isSelected={canUseServerKey} onChange={setCanUseServerKey} isDisabled={locked}>
            서버 AI 키로 노트 만들기
          </SwitchField>
          <p className={uiStyles.hint}>보기 전용 역할은 이 설정과 관계없이 올리지 못합니다.</p>
          <TextField className={uiStyles.field} value={quota} onChange={setQuota} inputMode="numeric" isDisabled={locked}>
            <Label className={uiStyles.label}>오디오 저장 한도(MB)</Label>
            <Input className={uiStyles.input} />
          </TextField>
          <p className={uiStyles.hint}>0이면 무제한입니다. 지금 {formatBytes(user.audio_bytes)} 사용 중.</p>
          <TextField className={uiStyles.field} value={memo} onChange={setMemo} maxLength={500} isDisabled={locked}>
            <Label className={uiStyles.label}>메모</Label>
            <TextArea className={`${uiStyles.input} ${s.textarea}`} rows={2} placeholder="소속, 학과, 운영 메모" />
          </TextField>

          <h2 className={s.subheading}>보안</h2>
          <TextField className={uiStyles.field} value={password} onChange={setPassword} type="password" autoComplete="new-password" isDisabled={locked}>
            <Label className={uiStyles.label}>새 비밀번호</Label>
            <Input className={uiStyles.input} />
          </TextField>
          <p className={uiStyles.hint}>비워 두면 그대로입니다. 6자 이상.</p>
          <SwitchField isSelected={revoke} onChange={setRevoke} isDisabled={locked}>
            저장할 때 모든 세션 로그아웃
          </SwitchField>
          <p className={uiStyles.hint}>지금 {formatCount(user.session_count)}개 기기에서 로그인되어 있습니다.</p>
        </fieldset>
        {error && (
          <p className={s.error} role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
        <div className={s.formActions}>
          <Button variant="dangerText" onPress={() => setDeleting(true)} isDisabled={self || user.role === "owner"}>
            삭제
          </Button>
          <Button type="submit" variant="primary" isDisabled={locked || update.isPending}>
            {update.isPending ? "실행 중…" : "저장"}
          </Button>
        </div>
      </form>
      {deleting && <DeleteUserDialog user={user} onClose={() => setDeleting(false)} onDeleted={() => void navigate({ to: "/admin/users" })} />}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/admin/users" className={s.link}>
      ← 사용자 목록
    </Link>
  );
}
