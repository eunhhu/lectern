// 관리 › 사용량 (P5-12, D-P5-7): the usage ledger per workspace for a month (this month by
// default, or one of the six before it), and setting a workspace's limits. The ledger has
// no limits in it and there is no admin route that reads them, so the dialog fills in what
// it can (the workspace's own usage route, when the operator is a member) and otherwise
// says that empty fields mean no limit.

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Input, Label, TextField } from "react-aria-components";
import { errorMessage } from "../../api/errors.ts";
import { useAdminUsage, useApi, useSetQuota, useWorkspaces } from "../../api/queries.ts";
import type { UsageLedger, WorkspaceId, WorkspaceQuota } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatAudioTime, formatPeriod, formatStorage } from "../../lib/usage.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, ErrorBox, ModalDialog, SelectField, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import { DataTable, type Column } from "./DataTable.tsx";
import { formatUsd, recentPeriods } from "./format.ts";
import s from "./admin.module.css";

export interface AdminUsageSearch {
  period?: string;
}

const HOUR_MS = 3_600_000;
const GB = 1024 ** 3;

/** A limit field: "" is no limit; anything else a number ≥ 0 (comma decimals allowed). */
function parseField(text: string): number | null | "bad" {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

const show = (n: number) => String(Math.round(n * 100) / 100);

export function UsagePage() {
  usePageTitle("관리 · 사용량");
  const periods = recentPeriods();
  const search = useSearch({ from: "/_authed/admin/usage" });
  const navigate = useNavigate();
  const period = search.period && periods.includes(search.period) ? search.period : periods[0]!;
  const usage = useAdminUsage(period);
  const workspaces = useWorkspaces().data ?? [];
  const [editing, setEditing] = useState<UsageLedger | null>(null);
  const nameOf = (id: string) => workspaces.find((w) => w.workspace.id === id)?.workspace.name ?? null;

  const columns: Column<UsageLedger>[] = [
    {
      key: "workspace",
      header: "워크스페이스",
      sortValue: (r) => nameOf(r.workspace_id) ?? r.workspace_id,
      cell: (r) => {
        const name = nameOf(r.workspace_id);
        return name ? (
          <>
            {name} <span className={`${s.code} ${s.muted}`}>{r.workspace_id}</span>
          </>
        ) : (
          <span className={s.code}>{r.workspace_id}</span>
        );
      },
    },
    { key: "audio", header: "녹음 시간", align: "right", sortValue: (r) => r.audio_ms, cell: (r) => formatAudioTime(r.audio_ms) },
    { key: "ai", header: "AI 비용", align: "right", sortValue: (r) => r.ai_cost_microusd, cell: (r) => formatUsd(r.ai_cost_microusd) },
    { key: "storage", header: "저장 공간", align: "right", sortValue: (r) => r.storage_bytes, cell: (r) => formatStorage(r.storage_bytes) },
    {
      key: "actions",
      header: "동작",
      cell: (r) => (
        <Button size="sm" aria-label={`한도 설정: ${nameOf(r.workspace_id) ?? r.workspace_id}`} onPress={() => setEditing(r)}>
          한도 설정
        </Button>
      ),
    },
  ];

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>사용량</h1>
      </header>
      <div className={s.filters}>
        <SelectField
          label="기간"
          items={periods.map((p, i) => ({ id: p, label: i === 0 ? `${formatPeriod(p)} (이번 달)` : formatPeriod(p) }))}
          selectedKey={period}
          onSelectionChange={(p) => void navigate({ to: "/admin/usage", search: { period: p === periods[0] ? undefined : p }, replace: true })}
        />
      </div>
      {usage.isError ? (
        <ErrorBox title={errorMessage(usage.error, "사용량을 불러오지 못했습니다.")} onRetry={() => void usage.refetch()} />
      ) : (
        <DataTable
          caption={`${formatPeriod(period)} 사용량`}
          columns={columns}
          rows={usage.data?.items ?? []}
          rowKey={(r) => r.id}
          empty={usage.isPending ? "불러오는 중…" : "이 기간의 사용량 기록이 없습니다."}
        />
      )}
      {editing && <QuotaDialog row={editing} name={nameOf(editing.workspace_id) ?? editing.workspace_id} onClose={() => setEditing(null)} />}
    </>
  );
}

function QuotaDialog({ row, name, onClose }: { row: UsageLedger; name: string; onClose: () => void }) {
  const api = useApi();
  const save = useSetQuota();
  const [hours, setHours] = useState("");
  const [dollars, setDollars] = useState("");
  const [gb, setGb] = useState("");
  const [known, setKnown] = useState<"loading" | "yes" | "no">("loading");
  const [error, setError] = useState<string | null>(null);

  // Fill in the limits now in force, when the workspace's own usage route lets us read them.
  useEffect(() => {
    let live = true;
    api
      .getWorkspaceUsage(row.workspace_id as WorkspaceId)
      .then((u) => {
        if (!live) return;
        const q = u.quota;
        setHours(q?.audio_ms_month != null ? show(q.audio_ms_month / HOUR_MS) : "");
        setDollars(q?.ai_microusd_month != null ? show(q.ai_microusd_month / 1_000_000) : "");
        setGb(q?.storage_bytes != null ? show(q.storage_bytes / GB) : "");
        setKnown("yes");
      })
      .catch(() => live && setKnown("no"));
    return () => {
      live = false;
    };
  }, [api, row.workspace_id]);

  const submit = async () => {
    const h = parseField(hours);
    const d = parseField(dollars);
    const g = parseField(gb);
    if (h === "bad" || d === "bad" || g === "bad") {
      setError("한도는 0 이상의 숫자로 입력하세요. 비우면 제한 없음입니다.");
      return;
    }
    setError(null);
    const quota: WorkspaceQuota = {
      audio_ms_month: h === null ? null : Math.round(h * HOUR_MS),
      ai_microusd_month: d === null ? null : Math.round(d * 1_000_000),
      storage_bytes: g === null ? null : Math.round(g * GB),
    };
    try {
      await save.mutateAsync({ workspaceId: row.workspace_id, quota });
      showToast({ title: "한도를 저장했습니다." });
      onClose();
    } catch (err) {
      toastError("한도를 저장하지 못했습니다.", err);
    }
  };

  return (
    <ModalDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={`한도 설정: ${name}`}
      size="form"
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            취소
          </Button>
          <Button variant="primary" onPress={submit} isDisabled={save.isPending || known === "loading"}>
            저장
          </Button>
        </>
      }
    >
      <div className={s.field}>
        <TextField className={uiStyles.field} value={hours} onChange={setHours} inputMode="decimal" autoFocus>
          <Label className={uiStyles.label}>월 녹음 시간(시간)</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <TextField className={uiStyles.field} value={dollars} onChange={setDollars} inputMode="decimal">
          <Label className={uiStyles.label}>월 AI 비용(달러)</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <TextField className={uiStyles.field} value={gb} onChange={setGb} inputMode="decimal">
          <Label className={uiStyles.label}>저장 공간(GB)</Label>
          <Input className={uiStyles.input} />
        </TextField>
        <p className={uiStyles.hint}>
          비운 칸은 제한 없음입니다.
          {known === "no" && " 지금 한도를 읽을 수 없어 빈 칸으로 열었습니다. 저장하면 세 값이 모두 이대로 바뀝니다."}
        </p>
        {error && (
          <p className={s.error} role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
