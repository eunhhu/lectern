// 설정 › 알림 (P4-07, D-P4-1/7): e-mail reminders and calendar auto-add, both workspace
// settings that only owners and admins change. The section id is `reminders`: reminder
// mails link to /app/settings#reminders. Each change is saved at once.

import { useUpdateWorkspaceSettings } from "../../api/queries.ts";
import type { WorkspaceSettings } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { CheckboxField, SelectField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import s from "./settings.module.css";

const LEADS = [
  { id: "1440", label: "하루 전" },
  { id: "180", label: "3시간 전" },
  { id: "60", label: "1시간 전" },
  { id: "1440,60", label: "하루 전과 1시간 전" },
];
const DEFAULT_LEAD = "1440";
const AUTO_ADD_MIN_CONFIDENCE = 0.8;

/** The option for stored lead minutes; anything else shows the default. */
function leadKey(minutes: readonly number[] | undefined): string {
  const key = [...(minutes ?? [])].sort((a, b) => b - a).join(",");
  return LEADS.some((l) => l.id === key) ? key : DEFAULT_LEAD;
}

const leadMinutes = (key: string) => key.split(",").map(Number);

export function Reminders() {
  const { workspaceId, current } = useWorkspace();
  const update = useUpdateWorkspaceSettings(workspaceId);
  const canEdit = current?.role === "owner" || current?.role === "admin";
  // While a change is saving, show it already (the saved settings arrive with the answer).
  const pending = update.isPending ? update.variables : undefined;
  const settings: WorkspaceSettings = { ...(current?.workspace.settings ?? {}), ...pending };
  const email = settings.reminders?.email ?? false;
  const lead = leadKey(settings.reminders?.lead_minutes);
  const autoAdd = settings.calendar_auto_add?.enabled ?? false;

  const save = async (patch: Partial<WorkspaceSettings>) => {
    try {
      await update.mutateAsync(patch);
      showToast({ title: "알림 설정을 저장했습니다." });
    } catch (err) {
      toastError("알림 설정을 저장하지 못했습니다.", err);
    }
  };

  return (
    <section id="reminders" className={s.section} aria-labelledby="set-reminders">
      <h2 id="set-reminders" className={s.heading}>
        알림
      </h2>
      {!canEdit && <p className={s.muted}>워크스페이스 관리자만 바꿀 수 있습니다.</p>}
      <div className={s.options}>
        <CheckboxField
          isSelected={canEdit && email}
          isDisabled={!canEdit || update.isPending}
          onChange={(on) => void save({ reminders: { email: on, lead_minutes: leadMinutes(lead) } })}
        >
          일정과 할 일 마감을 이메일로 알려 주기
        </CheckboxField>
        {canEdit && email && (
          <SelectField
            label="알림 시각"
            items={LEADS}
            selectedKey={lead}
            isDisabled={update.isPending}
            onSelectionChange={(key) => key !== lead && void save({ reminders: { email: true, lead_minutes: leadMinutes(key) } })}
          />
        )}
        <div className={uiStyles.field}>
          <CheckboxField
            isSelected={canEdit && autoAdd}
            isDisabled={!canEdit || update.isPending}
            aria-describedby="auto-add-help"
            onChange={(on) =>
              void save({
                calendar_auto_add: { enabled: on, min_confidence: settings.calendar_auto_add?.min_confidence ?? AUTO_ADD_MIN_CONFIDENCE },
              })
            }
          >
            날짜가 분명한 일정은 자동으로 수락하기
          </CheckboxField>
          <p id="auto-add-help" className={uiStyles.hint}>
            녹음에서 날짜가 정확히 읽힌 일정만 자동으로 수락합니다. 나머지는 제안으로 남습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
