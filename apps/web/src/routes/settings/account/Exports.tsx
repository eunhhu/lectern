// 설정 › 데이터 내보내기 (P5-10, D-P5-8): a zip of the current workspace's recordings and
// notes, made in the background. While one is being made the list is read again every 10 s
// (useExports); a ready zip downloads from the server for 7 days.

import { useState } from "react";
import { isNotReady } from "../../../api/errors.ts";
import { useApi, useCreateExport, useExports, useWorkspaces } from "../../../api/queries.ts";
import type { DataExport } from "../../../api/types.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { formatBytes, formatDate, formatRelative } from "../../../lib/format.ts";
import { Badge, Button, CheckboxField } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import s from "../settings.module.css";
import a from "./account.module.css";
import { NOT_READY_TEXT } from "./Tokens.tsx";

export function Exports() {
  const api = useApi();
  const { workspaceId } = useWorkspace();
  const workspaces = useWorkspaces().data ?? [];
  const exports = useExports();
  const create = useCreateExport();
  const [includeAudio, setIncludeAudio] = useState(false);
  const now = new Date();
  const nameOf = (ws: string) => workspaces.find((w) => w.workspace.id === ws)?.workspace.name ?? "워크스페이스";

  const make = async () => {
    try {
      await create.mutateAsync({ workspace_id: workspaceId, include_audio: includeAudio });
      showToast({ title: "내보내기를 만들고 있습니다. 준비되면 여기에서 내려받을 수 있습니다." });
    } catch (err) {
      toastError("내보내기를 만들지 못했습니다.", err);
    }
  };

  const state = (e: DataExport) => {
    switch (e.state) {
      case "queued":
      case "running":
        return <Badge tone="info">만드는 중</Badge>;
      case "ready":
        return (
          <>
            <a className={a.download} href={api.exportContentUrl(e.id)} download aria-label={`내려받기: ${nameOf(e.workspace_id)} ${formatDate(e.requested_at, now)}`}>
              내려받기
            </a>
            <span className={s.muted}>
              {e.bytes !== null ? `${formatBytes(e.bytes)} · ` : ""}
              {e.expires_at ? `${formatDate(e.expires_at, now)}까지` : ""}
            </span>
          </>
        );
      case "failed":
        return (
          <>
            <Badge tone="danger">실패</Badge>
            {e.error && <span className={a.danger}>{e.error}</span>}
          </>
        );
      case "expired":
        return <Badge tone="neutral">만료됨</Badge>;
    }
  };

  let list;
  if (isNotReady(exports.error)) {
    list = null;
  } else if (!exports.data) {
    list = <p className={s.muted}>{exports.isPending ? "불러오는 중…" : "내보내기 목록을 불러오지 못했습니다."}</p>;
  } else if (exports.data.length > 0) {
    list = (
      <ul className={s.members} role="list" aria-label="내보내기 목록">
        {exports.data.map((e) => (
          <li key={e.id} className={s.member}>
            <span className={s.memberText}>
              <span className={s.memberName}>
                {nameOf(e.workspace_id)}
                {e.include_audio && <span className={s.muted}>오디오·PDF 포함</span>}
              </span>
              <span className={s.muted}>{formatRelative(e.requested_at, now)}에 요청</span>
            </span>
            <span className={s.cardActions}>{state(e)}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section id="exports" className={s.section} aria-labelledby="set-exports">
      <h2 id="set-exports" className={s.heading}>
        데이터 내보내기
      </h2>
      {isNotReady(exports.error) ? (
        <p className={s.muted}>{NOT_READY_TEXT}</p>
      ) : (
        <>
          <p className={s.muted}>워크스페이스의 녹음과 노트를 zip 파일로 받습니다. 파일은 7일 동안 내려받을 수 있습니다.</p>
          <p className={s.muted}>‘{nameOf(workspaceId)}’ 워크스페이스를 내보냅니다.</p>
          <CheckboxField isSelected={includeAudio} onChange={setIncludeAudio}>
            오디오와 PDF 원본 포함(용량이 커집니다)
          </CheckboxField>
          <div className={s.cardActions}>
            <Button size="sm" variant="primary" onPress={make} isDisabled={create.isPending}>
              내보내기 만들기
            </Button>
          </div>
          {list}
        </>
      )}
    </section>
  );
}
