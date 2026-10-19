// 복습 · 일정 · 설정: placeholder routes with the empty-state pattern (DESIGN.md §4.1).
// Settings already carries the per-viewer options the shell needs (theme, single-key
// shortcuts: WCAG 2.1.4).

import { useNavigate } from "@tanstack/react-router";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { usePageTitle } from "../app/RootLayout.tsx";
import { setPreferences, usePreferences, type ThemeChoice } from "../app/preferences.ts";
import { useWorkspace } from "../app/workspace.tsx";
import { Button, EmptyState, SwitchField, uiStyles } from "../ui/controls.tsx";
import layout from "../app/layout.module.css";
import s from "./placeholders.module.css";

export function ReviewPage() {
  usePageTitle("복습");
  const navigate = useNavigate();
  return (
    <div className={layout.page}>
      <header className={layout.pageHeader}>
        <h1 className={layout.pageTitle}>복습</h1>
      </header>
      <EmptyState
        icon="review"
        title="복습할 카드가 아직 없습니다."
        action={<Button onPress={() => void navigate({ to: "/library" })}>라이브러리 열기</Button>}
      >
        강의의 질문 카드와 회의 쟁점이 이곳에 모입니다. 지금은 녹음 상세의 ‘질문’ 탭에서 볼 수 있습니다.
      </EmptyState>
    </div>
  );
}

export function CalendarPage() {
  usePageTitle("일정");
  const navigate = useNavigate();
  return (
    <div className={layout.page}>
      <header className={layout.pageHeader}>
        <h1 className={layout.pageTitle}>일정</h1>
      </header>
      <EmptyState
        icon="calendar"
        title="확정한 일정이 아직 없습니다."
        action={<Button onPress={() => void navigate({ to: "/" })}>일정 제안 보기</Button>}
      >
        녹음에서 찾은 일정 제안을 홈에서 확인하면 이곳에 표시됩니다. 캘린더 연결은 설정에서 하게 됩니다.
      </EmptyState>
    </div>
  );
}

export function SettingsPage() {
  usePageTitle("설정");
  const prefs = usePreferences();
  const { current } = useWorkspace();
  return (
    <div className={layout.page}>
      <header className={layout.pageHeader}>
        <h1 className={layout.pageTitle}>설정</h1>
      </header>
      <section className={s.section} aria-labelledby="set-display">
        <h2 id="set-display" className={s.heading}>
          이 브라우저
        </h2>
        <RadioGroup
          className={s.radioGroup}
          value={prefs.theme}
          onChange={(v) => setPreferences({ theme: v as ThemeChoice })}
          orientation="horizontal"
        >
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
      <section className={s.section} aria-labelledby="set-account">
        <h2 id="set-account" className={s.heading}>
          계정과 워크스페이스
        </h2>
        <EmptyState icon="settings" title="계정 설정은 아직 준비 중입니다.">
          {current?.workspace.name} 워크스페이스의 멤버, 기기, 토큰, 연동, 사용량 한도 설정이 이곳에 들어옵니다.
        </EmptyState>
      </section>
    </div>
  );
}

export function NotFoundPage() {
  usePageTitle("찾을 수 없음");
  const navigate = useNavigate();
  return (
    <div className={layout.page}>
      <h1 className={layout.pageTitle}>페이지를 찾을 수 없습니다.</h1>
      <EmptyState icon="search" title="주소가 바뀌었거나 삭제된 페이지입니다." action={<Button onPress={() => void navigate({ to: "/" })}>홈으로</Button>} />
    </div>
  );
}
