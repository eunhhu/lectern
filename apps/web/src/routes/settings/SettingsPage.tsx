// 설정 (ARCHITECTURE §7): profile, the current workspace and its members, signed-in
// devices, integrations, and the options that live in this browser (theme, single-key
// shortcuts: WCAG 2.1.4). Profile and devices go through the ApiClient (PATCH /me,
// DELETE /me/devices/{id}); integrations are a placeholder until P4.

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Form, Input, Label, Radio, RadioGroup, TextField } from "react-aria-components";
import { useDevices, useMe, useMembers, useRevokeDevice, useUpdateMe } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { setPreferences, usePreferences, type ThemeChoice } from "../../app/preferences.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatRelative } from "../../lib/format.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, SelectField, SwitchField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import layout from "../../app/layout.module.css";
import s from "./settings.module.css";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
const TIME_ZONES = [
  { id: "Asia/Seoul", label: "서울 (UTC+9)" },
  { id: "Asia/Tokyo", label: "도쿄 (UTC+9)" },
  { id: "UTC", label: "협정 세계시 (UTC)" },
  { id: "Europe/London", label: "런던" },
  { id: "America/Los_Angeles", label: "로스앤젤레스" },
];

const SECTIONS = [
  { id: "account", label: "프로필" },
  { id: "workspace", label: "워크스페이스" },
  { id: "devices", label: "기기" },
  { id: "integrations", label: "연동" },
  { id: "browser", label: "이 브라우저" },
];

export function SettingsPage() {
  usePageTitle("설정");
  // Honour /settings#account and friends after the page renders.
  const hash = useRouterState({ select: (st) => st.location.hash });
  useEffect(() => {
    if (!hash) return;
    const raf = requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(raf);
  }, [hash]);
  return (
    <div className={s.layout}>
      <nav className={s.toc} aria-label="설정 목차">
        {SECTIONS.map((sec) => (
          <a key={sec.id} href={`#${sec.id}`} className={s.tocLink}>
            {sec.label}
          </a>
        ))}
      </nav>
      <div className={s.content}>
        <header className={layout.pageHeader}>
          <h1 className={layout.pageTitle}>설정</h1>
        </header>
        <Profile />
        <WorkspaceSection />
        <Devices />
        <Integrations />
        <BrowserOptions />
      </div>
    </div>
  );
}

function Profile() {
  const me = useMe().data;
  const update = useUpdateMe();
  const [name, setName] = useState("");
  const [tz, setTz] = useState("");
  useEffect(() => {
    if (me) {
      setName(me.display_name);
      setTz(me.timezone);
    }
  }, [me]);
  if (!me) return null;
  const dirty = name.trim() !== me.display_name || tz !== me.timezone;
  return (
    <section id="account" className={s.section} aria-labelledby="set-account">
      <h2 id="set-account" className={s.heading}>
        프로필
      </h2>
      <div className={s.profileHead}>
        <Avatar id={me.id} name={name || me.display_name} size="lg" />
        <div>
          <p className={s.name}>{me.display_name}</p>
          <p className={s.muted}>
            {me.email} · 서비스 역할 {ROLE[me.system_role]}
          </p>
        </div>
      </div>
      <Form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await update.mutateAsync({ display_name: name.trim(), timezone: tz });
            showToast({ title: "프로필을 저장했습니다." });
          } catch (err) {
            toastError("프로필을 저장하지 못했습니다.", err);
          }
        }}
      >
        <TextField className={uiStyles.field} value={name} onChange={setName} isRequired maxLength={100} autoComplete="name">
          <Label className={uiStyles.label}>이름</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <TextField className={uiStyles.field} value={me.email} isReadOnly>
          <Label className={uiStyles.label}>이메일</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <SelectField
          label="시간대"
          items={TIME_ZONES}
          selectedKey={tz}
          onSelectionChange={setTz}
          description="상대 날짜(“다음 주 화요일”)를 계산하고 시각을 보여 줄 때 씁니다."
        />
        <div className={s.formActions}>
          <Button type="submit" variant="primary" isDisabled={!dirty || !name.trim()}>
            저장
          </Button>
        </div>
      </Form>
    </section>
  );
}

function WorkspaceSection() {
  const { current, workspaceId } = useWorkspace();
  const members = useMembers(workspaceId).data ?? [];
  const me = useMe().data;
  if (!current) return null;
  return (
    <section id="workspace" className={s.section} aria-labelledby="set-workspace">
      <h2 id="set-workspace" className={s.heading}>
        워크스페이스
      </h2>
      <dl className={s.facts}>
        <div>
          <dt>이름</dt>
          <dd>{current.workspace.name}</dd>
        </div>
        <div>
          <dt>종류</dt>
          <dd>{current.workspace.kind === "team" ? "팀" : "개인"}</dd>
        </div>
        <div>
          <dt>내 역할</dt>
          <dd>{ROLE[current.role]}</dd>
        </div>
        <div>
          <dt>요금제</dt>
          <dd>{current.workspace.plan}</dd>
        </div>
      </dl>
      <h3 className={s.subheading}>멤버 {members.length}명</h3>
      <ul className={s.members} role="list">
        {members.map((m) => (
          <li key={m.user_id} className={s.member}>
            <Avatar id={m.user_id} name={m.display_name} />
            <span className={s.memberText}>
              <span className={s.memberName}>
                {m.display_name}
                {m.user_id === me?.id && <span className={s.muted}> (나)</span>}
              </span>
              <span className={s.muted}>{m.email}</span>
            </span>
            <Badge tone={m.role === "owner" ? "accent" : m.role === "admin" ? "info" : "neutral"}>{ROLE[m.role]}</Badge>
          </li>
        ))}
      </ul>
      {current.workspace.kind === "team" && <p className={uiStyles.hint}>멤버 초대와 역할 변경은 팀 기능과 함께 추가됩니다.</p>}
    </section>
  );
}

function Devices() {
  const devices = useDevices().data ?? [];
  const revoke = useRevokeDevice();
  const now = new Date();
  return (
    <section id="devices" className={s.section} aria-labelledby="set-devices">
      <h2 id="set-devices" className={s.heading}>
        기기
      </h2>
      <ul className={s.members} role="list">
        {devices.map((d) => (
          <li key={d.id} className={s.member}>
            <span className={s.deviceIcon}>
              <Icon name={d.client === "web" ? "workspace" : "audio"} />
            </span>
            <span className={s.memberText}>
              <span className={s.memberName}>
                {d.device_name ?? (d.client === "web" ? "브라우저" : "앱")}
                {d.current && <Badge tone="success">지금 쓰는 기기</Badge>}
              </span>
              <span className={s.muted}>
                {d.client === "web" ? "웹" : "앱"} · 마지막 사용 {formatRelative(d.last_seen_at, now)}
              </span>
            </span>
            {!d.current && (
              <Button
                size="sm"
                variant="dangerText"
                aria-label={`로그아웃: ${d.device_name ?? "기기"}`}
                onPress={async () => {
                  try {
                    await revoke.mutateAsync(d.id);
                    showToast({ title: `${d.device_name ?? "기기"}에서 로그아웃했습니다.` });
                  } catch (err) {
                    toastError("로그아웃하지 못했습니다.", err);
                  }
                }}
              >
                로그아웃
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Integrations() {
  return (
    <section id="integrations" className={s.section} aria-labelledby="set-integrations">
      <h2 id="set-integrations" className={s.heading}>
        연동
      </h2>
      <div className={s.member}>
        <span className={s.deviceIcon}>
          <Icon name="calendar" />
        </span>
        <span className={s.memberText}>
          <span className={s.memberName}>Google 캘린더</span>
          <span className={s.muted}>연결하면 확정한 일정이 ‘Lectern’ 캘린더에 들어갑니다. 다른 일정은 읽지 않습니다.</span>
        </span>
        <Button
          size="sm"
          onPress={() => showToast({ title: "미리보기에서는 연결할 수 없습니다.", description: "실제 서버에 연결되면 Google 동의 화면으로 이동합니다.", tone: "info" })}
        >
          연결
        </Button>
      </div>
    </section>
  );
}

function BrowserOptions() {
  const prefs = usePreferences();
  return (
    <section id="browser" className={s.section} aria-labelledby="set-browser">
      <h2 id="set-browser" className={s.heading}>
        이 브라우저
      </h2>
      <RadioGroup className={s.radioGroup} value={prefs.theme} onChange={(v) => setPreferences({ theme: v as ThemeChoice })} orientation="horizontal">
        <Label className={uiStyles.label}>테마</Label>
        <div className={s.radios}>
          {(
            [
              ["system", "시스템 설정"],
              ["light", "라이트"],
              ["dark", "다크"],
            ] as const
          ).map(([value, label]) => (
            <Radio key={value} value={value} className={s.radio}>
              <span className={s.radioMark} aria-hidden="true" />
              {label}
            </Radio>
          ))}
        </div>
      </RadioGroup>
      <div className={uiStyles.field}>
        <SwitchField isSelected={prefs.singleKeyShortcuts} onChange={(on) => setPreferences({ singleKeyShortcuts: on })}>
          한 글자 단축키 사용
        </SwitchField>
        <p className={uiStyles.hint}>끄면 U, ?, G 조합 같은 한 글자 단축키가 동작하지 않습니다. ⌘K는 계속 쓸 수 있습니다.</p>
      </div>
    </section>
  );
}
