// 관리 › 설정 (P5-13): the old console's settings form (ui.ts RENDER.settings,
// readSettingsForm): sign-up policy, storage (auto compaction and its bitrate) and the
// three retention policies, each a switch and a number of days (0 = off, as the server
// stores it). The values are the overview's `settings` read strictly (there is no GET
// route), and a save sends the whole form like the old console (`PATCH
// /api/admin/settings`). 저장 is on only when something changed, 되돌리기 shows then, ⌘↵
// saves, and leaving the page (a link, back, closing the tab) with changes asks first.
// Nothing here is a secret.

import { useBlocker } from "@tanstack/react-router";
import { useState, type KeyboardEvent } from "react";
import { Input, Label, TextField } from "react-aria-components";
import type { AdminSettings } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminOps, useAdminSettings, useAdminStorage, useSaveAdminSettings } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ErrorBox, ModalDialog, SelectField, SwitchField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { bitrateHint } from "./StoragePage.tsx";
import s from "./admin.module.css";

const BITRATES = [24, 32, 40, 48, 64, 96];
/** Days a policy starts with when its switch is turned on (the old console's RET_DEFAULTS). */
const RETENTION_DEFAULTS = { audio: 180, failed: 30, audit: 365 } as const;
type Policy = keyof typeof RETENTION_DEFAULTS;

interface Form {
  signup: boolean;
  approval: boolean;
  role: AdminSettings["default_user_role"];
  serverKey: boolean;
  quota: string;
  compact: boolean;
  bitrate: number;
  on: Record<Policy, boolean>;
  days: Record<Policy, string>;
}

const KEYS: Record<Policy, "audio_retention_days" | "failed_audio_retention_days" | "audit_retention_days"> = {
  audio: "audio_retention_days",
  failed: "failed_audio_retention_days",
  audit: "audit_retention_days",
};

function toForm(v: AdminSettings): Form {
  const days = (n: number) => (n > 0 ? String(n) : "");
  return {
    signup: v.allow_public_signup,
    approval: v.default_require_approval,
    role: v.default_user_role,
    serverKey: v.default_can_use_server_key,
    quota: String(v.default_quota_mb),
    compact: v.storage_auto_compact,
    bitrate: v.storage_compact_bitrate_kbps,
    on: { audio: v.audio_retention_days > 0, failed: v.failed_audio_retention_days > 0, audit: v.audit_retention_days > 0 },
    days: { audio: days(v.audio_retention_days), failed: days(v.failed_audio_retention_days), audit: days(v.audit_retention_days) },
  };
}

/** What a save sends: every key, like the old console's readSettingsForm. */
export function fromForm(f: Form): AdminSettings {
  const days = (p: Policy) => (f.on[p] ? Math.max(1, Math.round(Number(f.days[p]) || 0)) : 0);
  return {
    allow_public_signup: f.signup,
    default_require_approval: f.approval,
    default_user_role: f.role,
    default_can_use_server_key: f.serverKey,
    default_quota_mb: Math.max(0, Math.round(Number(f.quota) || 0)),
    storage_auto_compact: f.compact,
    storage_compact_bitrate_kbps: f.bitrate,
    audio_retention_days: days("audio"),
    failed_audio_retention_days: days("failed"),
    audit_retention_days: days("audit"),
  };
}

const same = (a: AdminSettings, b: AdminSettings) => (Object.keys(a) as (keyof AdminSettings)[]).every((k) => a[k] === b[k]);

export function SettingsPage() {
  usePageTitle("관리 · 설정");
  const settings = useAdminSettings();
  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>설정</h1>
      </header>
      {settings.isError ? (
        <ErrorBox title={errorMessage(settings.error, "설정을 읽지 못했습니다.")} onRetry={() => void settings.refetch()}>
          값을 모두 읽지 못하면 폼을 열지 않습니다. 빠진 값이 기본값으로 저장되지 않게 하기 위해서입니다.
        </ErrorBox>
      ) : settings.data ? (
        <SettingsForm base={settings.data} />
      ) : null}
    </>
  );
}

function SettingsForm({ base }: { base: AdminSettings }) {
  const [form, setForm] = useState<Form>(() => toForm(base));
  const save = useSaveAdminSettings();
  const ops = useAdminOps();
  const storage = useAdminStorage();
  const next = fromForm(form);
  const dirty = !same(next, base);
  const ffMissing = ops.data?.server.ffmpegAvailable === false || storage.data?.compaction.ffmpegAvailable === false;
  const retention = storage.data?.reclaimable.retention;

  const blocker = useBlocker({ shouldBlockFn: () => dirty && !save.isPending, enableBeforeUnload: () => dirty, withResolver: true });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setOn = (p: Policy, on: boolean) =>
    setForm((f) => ({ ...f, on: { ...f.on, [p]: on }, days: { ...f.days, [p]: on && !f.days[p] ? String(RETENTION_DEFAULTS[p]) : f.days[p] } }));
  const setDays = (p: Policy, days: string) => setForm((f) => ({ ...f, days: { ...f.days, [p]: days } }));

  const submit = async () => {
    if (!dirty || save.isPending) return;
    try {
      const saved = await save.mutateAsync(next);
      setForm(toForm(saved));
      showToast({ title: "설정을 저장했습니다." });
    } catch (err) {
      showToast({ title: errorMessage(err, "설정을 저장하지 못했습니다."), tone: "danger" });
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  const daysRow = (p: Policy, title: string, desc: React.ReactNode) => (
    <div className={s.settingRow}>
      <div className={s.settingText}>
        <span id={`ret-${p}`}>{title}</span>
        <span className={s.muted} id={`ret-${p}-desc`}>
          {desc}
        </span>
      </div>
      <div className={s.settingControl}>
        <SwitchField isSelected={form.on[p]} onChange={(on) => setOn(p, on)} aria-describedby={`ret-${p}-desc`}>
          <span className={s.srOnly}>{title} </span>
          {form.on[p] ? "사용" : "끄기"}
        </SwitchField>
        <TextField className={s.days} value={form.on[p] ? form.days[p] : ""} onChange={(v) => setDays(p, v)} inputMode="numeric" isDisabled={!form.on[p]} aria-label={`${title} 보존 일수`}>
          <Input className={uiStyles.input} placeholder="—" />
        </TextField>
        <span className={s.muted}>일</span>
      </div>
    </div>
  );

  return (
    <form
      className={s.form}
      aria-label="관리 설정"
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section aria-labelledby="set-signup">
        <h2 id="set-signup" className={s.subheading}>
          가입 정책
        </h2>
        <p className={s.muted}>새 사용자가 가입하는 방식과 기본 권한을 정합니다.</p>
        <div className={s.settingRow}>
          <SwitchField isSelected={form.signup} onChange={(v) => set("signup", v)} aria-describedby="set-signup-desc">
            공개 회원가입 허용
          </SwitchField>
          <span className={s.muted} id="set-signup-desc">
            끄면 로그인 화면의 가입이 막히고 관리자만 사용자를 추가할 수 있습니다.
          </span>
        </div>
        <div className={s.settingRow}>
          <SwitchField isSelected={form.approval} onChange={(v) => set("approval", v)} aria-describedby="set-approval-desc">
            가입 시 관리자 승인 필요
          </SwitchField>
          <span className={s.muted} id="set-approval-desc">
            새 가입자는 승인 대기 상태로 시작하며 승인 후 이용할 수 있습니다.
          </span>
        </div>
        <div className={s.settingRow}>
          <SelectField
            label="기본 역할"
            items={[
              { id: "member", label: "멤버" },
              { id: "viewer", label: "보기 전용" },
            ]}
            selectedKey={form.role}
            onSelectionChange={(v) => set("role", v === "viewer" ? "viewer" : "member")}
            description="멤버는 녹음·노트 만들기·공유를 할 수 있고, 보기 전용은 열람만 합니다."
          />
        </div>
        <div className={s.settingRow}>
          <SwitchField isSelected={form.serverKey} onChange={(v) => set("serverKey", v)} aria-describedby="set-serverkey-desc">
            서버 AI 키로 노트 만들기 기본 허용
          </SwitchField>
          <span className={s.muted} id="set-serverkey-desc">
            새 사용자가 서버의 AI 키로 노트를 만들 수 있습니다.
          </span>
        </div>
        <div className={s.settingRow}>
          <TextField className={uiStyles.field} value={form.quota} onChange={(v) => set("quota", v)} inputMode="numeric">
            <Label className={uiStyles.label}>기본 오디오 한도(MB)</Label>
            <Input className={uiStyles.input} />
          </TextField>
          <span className={s.muted}>새 사용자의 오디오 저장 한도입니다. 0이면 무제한입니다.</span>
        </div>
      </section>

      <section aria-labelledby="set-storage">
        <h2 id="set-storage" className={s.subheading}>
          스토리지
        </h2>
        <p className={s.muted}>완료된 강의의 오디오를 음성에 맞춘 모노 AAC(.m4a)로 다시 인코딩해 공간을 줄입니다.</p>
        <div className={s.settingRow}>
          <SwitchField isSelected={form.compact} onChange={(v) => set("compact", v)} aria-describedby="set-compact-desc">
            자동 압축
          </SwitchField>
          <span className={s.muted} id="set-compact-desc">
            노트 만들기가 끝난 녹음을 백그라운드에서 압축합니다.
            {ffMissing && " 서버에 ffmpeg가 없어 지금은 동작하지 않습니다."}
          </span>
        </div>
        <div className={s.settingRow}>
          <SelectField
            label="압축 비트레이트"
            items={(BITRATES.includes(form.bitrate) ? BITRATES : [...BITRATES, form.bitrate].sort((a, b) => a - b)).map((k) => ({ id: String(k), label: `${k} kbps` }))}
            selectedKey={String(form.bitrate)}
            onSelectionChange={(v) => set("bitrate", Number(v))}
            description={`${bitrateHint(form.bitrate)} · 낮을수록 작지만 음질이 떨어집니다.`}
          />
        </div>
      </section>

      <section aria-labelledby="set-retention">
        <h2 id="set-retention" className={s.subheading}>
          보존 정책
        </h2>
        <p className={s.muted}>기간이 지난 데이터를 유지보수 때 자동으로 정리합니다. 끄면 정리하지 않습니다.</p>
        <div className={s.warn} role="note">
          <Icon name="alert" size={16} />
          <span>
            보존 정책으로 지운 데이터는 복구할 수 없습니다. 완료된 강의는 오디오만 삭제되고 노트는 남지만 다시 듣거나 재분석할 수 없습니다. 실패한 강의는 노트가 없으므로 강의째 삭제됩니다.
          </span>
        </div>
        {daysRow(
          "audio",
          "완료된 강의의 오디오",
          <>
            완료 후 지정한 기간이 지나면 오디오를 영구 삭제합니다. 노트는 그대로 유지됩니다.
            {retention && retention.days > 0 && ` 지금 기준 ${formatCount(retention.count)}개 · ${formatBytes(retention.bytes)} 대상.`}
          </>,
        )}
        {daysRow("failed", "실패한 강의", "노트가 없는 실패한 강의를 지정한 기간 동안 변경이 없으면 오디오와 함께 삭제합니다.")}
        {daysRow("audit", "감사 로그", "기간이 지난 감사 로그를 삭제합니다. 끄면 모든 기록을 보관합니다.")}
      </section>

      <div className={s.dirtyBar}>
        {dirty && <span className={s.muted}>저장하지 않은 변경이 있습니다.</span>}
        {dirty && (
          <Button variant="ghost" onPress={() => setForm(toForm(base))} isDisabled={save.isPending}>
            되돌리기
          </Button>
        )}
        <Button type="submit" variant="primary" isDisabled={!dirty || save.isPending}>
          {save.isPending ? "실행 중…" : "저장"}
        </Button>
      </div>

      <ModalDialog
        isOpen={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title="저장하지 않은 변경"
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button onPress={() => blocker.reset?.()} autoFocus>
              계속 수정
            </Button>
            <Button variant="danger" onPress={() => blocker.proceed?.()}>
              버리고 떠나기
            </Button>
          </>
        }
      >
        <p>설정에 저장하지 않은 변경이 있습니다. 떠나면 변경이 사라집니다.</p>
      </ModalDialog>
    </form>
  );
}
