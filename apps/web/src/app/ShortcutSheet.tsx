import { Kbd, ModalDialog, uiStyles } from "../ui/controls.tsx";
import { isMacPlatform } from "../lib/keyboard.ts";
import { useIsOperator } from "../api/queries.ts";
import { SHORTCUTS } from "./commands.ts";
import { useOverlay } from "./overlays.ts";
import { setPreferences, usePreferences } from "./preferences.ts";
import { SwitchField } from "../ui/controls.tsx";
import s from "./sheet.module.css";

export function ShortcutSheet() {
  const [isOpen, setOpen] = useOverlay("shortcuts");
  const prefs = usePreferences();
  const mac = isMacPlatform();
  const operator = useIsOperator() === true;
  const shown = SHORTCUTS.filter((x) => !x.operator || operator);
  const groups = [...new Set(shown.map((x) => x.group))];
  return (
    <ModalDialog isOpen={isOpen} onOpenChange={setOpen} title="단축키" size="form">
      <div className={s.sheet}>
        {groups.map((group) => (
          <section key={group} aria-labelledby={`sc-${group}`}>
            <h3 id={`sc-${group}`} className={s.group}>
              {group}
            </h3>
            <dl className={s.list}>
              {shown.filter((x) => x.group === group).map((x) => (
                <div key={x.label} className={s.row}>
                  <dt className={s.label}>{x.label}</dt>
                  <dd>
                    <Kbd keys={x.keys.map((k) => (mac ? k : k.replace("⌘", "Ctrl+").replace("⇧", "Shift+")))} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <div className={uiStyles.field}>
          <SwitchField isSelected={prefs.singleKeyShortcuts} onChange={(on) => setPreferences({ singleKeyShortcuts: on })}>
            한 글자 단축키 사용
          </SwitchField>
          <p className={uiStyles.hint}>끄면 U, ?, G 조합 같은 한 글자 단축키가 동작하지 않습니다. ⌘K는 계속 쓸 수 있습니다.</p>
        </div>
      </div>
    </ModalDialog>
  );
}
