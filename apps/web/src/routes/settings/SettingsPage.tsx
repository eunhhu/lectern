// 설정 (ARCHITECTURE §7): profile and the account sections (signed-in devices, access
// tokens, linked sign-ins, data export, account deletion: account/, P5-10), the current
// workspace with its members, invitations and usage (workspace/, P5-11), integrations and
// reminders (Integrations.tsx, Reminders.tsx, P4-07), and the options that live in this
// browser (theme, single-key shortcuts: WCAG 2.1.4). Everything goes through the ApiClient.

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Form, Input, Label, Radio, RadioGroup, TextField } from "react-aria-components";
import { isNotReady } from "../../api/errors.ts";
import { useDevices, useMe, useRecordings, useRevokeDevice, useShareLinks, useUpdateMe } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { setPreferences, usePreferences, type ThemeChoice } from "../../app/preferences.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatRelative } from "../../lib/format.ts";
import { ROLE_LABEL } from "../../lib/roles.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, SelectField, SwitchField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { ShareLinkRow } from "../share/ShareLinkRow.tsx";
import { DeleteAccount } from "./account/DeleteAccount.tsx";
import { Exports } from "./account/Exports.tsx";
import { Identities } from "./account/Identities.tsx";
import { NOT_READY_TEXT, Tokens } from "./account/Tokens.tsx";
import { Integrations } from "./Integrations.tsx";
import { Invites } from "./workspace/Invites.tsx";
import { Members } from "./workspace/Members.tsx";
import { Usage } from "./workspace/Usage.tsx";
import { Reminders } from "./Reminders.tsx";
import layout from "../../app/layout.module.css";
import shareStyles from "../share/share.module.css";
import s from "./settings.module.css";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
const TIME_ZONES = [
  { id: "Asia/Seoul", label: "서울 (UTC+9)" },
  { id: "Asia/Tokyo", label: "도쿄 (UTC+9)" },
  { id: "UTC", label: "협정 세계시 (UTC)" },
  { id: "Europe/London", label: "런던" },
  { id: "America/Los_Angeles", label: "로스앤젤레스" },
];

// The account sections (P5-10) follow the profile: devices, tokens, sign-ins, export, deletion.
const SECTIONS = [
  { id: "account", label: "프로필" },
  { id: "devices", label: "기기" },
  { id: "tokens", label: "액세스 토큰" },
  { id: "identities", label: "연결된 로그인" },
  { id: "exports", label: "데이터 내보내기" },
  { id: "delete-account", label: "계정 삭제" },
  { id: "workspace", label: "워크스페이스" },
  { id: "members", label: "멤버" },
  { id: "invites", label: "초대", managers: true },
  { id: "usage", label: "사용량" },
  { id: "share-links", label: "공유 링크" },
  { id: "integrations", label: "연동" },
  { id: "reminders", label: "알림" },
  { id: "browser", label: "이 브라우저" },
];

export function SettingsPage() {
  usePageTitle("설정");
  // 초대 is drawn for owners and admins of a team workspace only (Invites.tsx).
  const { current } = useWorkspace();
  const canInvite = current?.workspace.kind === "team" && (current.role === "owner" || current.role === "admin");
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
        {SECTIONS.filter((sec) => !("managers" in sec) || canInvite).map((sec) => (
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
        <Devices />
        <Tokens />
        <Identities />
        <Exports />
        <DeleteAccount />
        <WorkspaceSection />
        <Members />
        <Invites />
        <Usage />
        <ShareLinks />
        <Integrations />
        <Reminders />
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
  const { current } = useWorkspace();
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
          <dd>{ROLE_LABEL[current.role]}</dd>
        </div>
        <div>
          <dt>요금제</dt>
          <dd>{current.workspace.plan}</dd>
        </div>
      </dl>
    </section>
  );
}

// Every live share link in the workspace (D-P2-3), with what it points at and 회수.
function ShareLinks() {
  const { workspaceId } = useWorkspace();
  const links = useShareLinks(workspaceId);
  const recordings = useRecordings(workspaceId).data ?? [];
  const titleOf = (targetType: string, targetId: string) =>
    targetType === "recording" ? (recordings.find((r) => r.id === targetId)?.title ?? "녹음") : "문서 링크";
  return (
    <section id="share-links" className={s.section} aria-labelledby="set-share-links">
      <h2 id="set-share-links" className={s.heading}>
        공유 링크
      </h2>
      <p className={s.muted}>링크 주소는 만든 직후에만 볼 수 있습니다.</p>
      {links.data && links.data.length > 0 ? (
        <ul className={shareStyles.list}>
          {links.data.map((link) => (
            <ShareLinkRow key={link.id} link={link} ws={workspaceId} title={titleOf(link.target_type, link.target_id)} />
          ))}
        </ul>
      ) : (
        <p className={s.muted}>{links.isPending ? "불러오는 중…" : "만든 공유 링크가 없습니다."}</p>
      )}
    </section>
  );
}

// Signed-in browsers and apps (D-P5-2). The current one cannot be signed out from here:
// that is the 로그아웃 in the account menu.
function Devices() {
  const devices = useDevices();
  const revoke = useRevokeDevice();
  const now = new Date();
  let body;
  if (isNotReady(devices.error)) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (!devices.data) {
    body = <p className={s.muted}>{devices.isPending ? "불러오는 중…" : "기기 목록을 불러오지 못했습니다."}</p>;
  } else {
    body = (
      <ul className={s.members} role="list">
        {devices.data.map((d) => {
          const name = d.device_name ?? "알 수 없는 기기";
          return (
            <li key={d.id} className={s.member}>
              <span className={s.deviceIcon}>
                <Icon name={d.client === "web" ? "workspace" : "audio"} />
              </span>
              <span className={s.memberText}>
                <span className={s.memberName}>
                  {name}
                  {d.current && <Badge tone="success">이 기기</Badge>}
                </span>
                <span className={s.muted}>
                  {d.client === "web" ? "웹" : "앱"} · 마지막 사용 {formatRelative(d.last_seen_at, now)}
                </span>
              </span>
              {!d.current && (
                <Button
                  size="sm"
                  variant="dangerText"
                  aria-label={`로그아웃시키기: ${name}`}
                  onPress={async () => {
                    try {
                      await revoke.mutateAsync(d.id);
                      showToast({ title: `${name}에서 로그아웃했습니다.` });
                    } catch (err) {
                      toastError("로그아웃시키지 못했습니다.", err);
                    }
                  }}
                >
                  로그아웃시키기
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <section id="devices" className={s.section} aria-labelledby="set-devices">
      <h2 id="set-devices" className={s.heading}>
        기기
      </h2>
      {body}
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
