// 설정 › 사용량 (P5-11, D-P5-7): this month's recording time, AI cost and storage of the
// current workspace, against the limits an operator set. Every member sees it. A row near
// or at its limit says so in words, not colour alone.

import { isNotReady } from "../../../api/errors.ts";
import { useWorkspaceUsage } from "../../../api/queries.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { formatPeriod, usageNote, usageRows } from "../../../lib/usage.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { Progress, uiStyles } from "../../../ui/controls.tsx";
import { NOT_READY_TEXT } from "../account/Tokens.tsx";
import s from "../settings.module.css";
import w from "./workspace.module.css";

export function Usage() {
  const { workspaceId } = useWorkspace();
  const usage = useWorkspaceUsage(workspaceId);

  let body;
  if (isNotReady(usage.error)) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (!usage.data) {
    body = <p className={s.muted}>{usage.isPending ? "불러오는 중…" : "사용량을 불러오지 못했습니다."}</p>;
  } else {
    body = (
      <>
        <ul className={w.usageList} role="list">
          {usageRows(usage.data).map((row) => {
            const note = usageNote(row.ratio);
            const amount = row.max ? `${row.used} / ${row.max}` : row.used;
            return (
              <li key={row.label} className={w.usageRow}>
                <span className={s.memberName}>{row.label}</span>
                {/* With a limit the bar carries "<사용> / <한도>"; without one, the amount alone. */}
                {row.ratio !== null ? <Progress value={row.ratio} label={row.label} valueLabel={amount} /> : <span className={s.muted}>{amount}</span>}
                {note && (
                  <span className={row.ratio !== null && row.ratio >= 1 ? w.usageFull : w.usageNear}>
                    <Icon name="alert" size={14} /> {note}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className={s.muted}>기간: {formatPeriod(usage.data.period)}</p>
        <p className={uiStyles.hint}>한도는 운영자가 설정합니다.</p>
      </>
    );
  }

  return (
    <section id="usage" className={s.section} aria-labelledby="set-usage">
      <h2 id="set-usage" className={s.heading}>
        사용량
      </h2>
      {body}
    </section>
  );
}
