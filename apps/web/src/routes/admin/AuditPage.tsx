// 관리 › 감사 로그 (P5-13): the old console's audit view (`GET /api/admin/audit`): a filter by
// action prefix with the server's counts, a search (actor, action, detail, target), both
// kept in the address, fifty rows at a time with "더 보기" (the cursor). A row opens its
// details (time, action, actor, target — a user or a lecture links to its page — id and
// the full detail).

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { AUDIT_PREFIXES, type AdminAuditLog, type AuditPrefix } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminAudit, useAdminOverview } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatCount, formatDateTime, formatRelative } from "../../lib/format.ts";
import { Button, ErrorBox, ModalDialog, SelectField } from "../../ui/controls.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import { StatTable } from "./flows.tsx";
import { SearchBox } from "./SearchBox.tsx";
import s from "./admin.module.css";

export interface AdminAuditSearch {
  action?: AuditPrefix;
  q?: string;
}

export const AUDIT_PREFIX_LABEL: Record<AuditPrefix, string> = {
  auth: "인증",
  account: "계정",
  admin: "관리",
  storage: "저장소",
  ops: "운영",
};

/** Where an audit row's target points: a user or a lecture this console knows, else nothing. */
export function useAuditTarget() {
  const overview = useAdminOverview().data;
  return (id: string): { kind: "user"; id: string; label: string } | { kind: "lecture"; id: string; label: string } | null => {
    if (!id || !overview) return null;
    const user = overview.users.find((u) => u.id === id);
    if (user) return { kind: "user", id, label: user.email };
    const lecture = overview.recentLectures.find((l) => l.id === id);
    if (lecture) return { kind: "lecture", id, label: lecture.title || id };
    return null;
  };
}

export function AuditTarget({ id }: { id: string }) {
  const target = useAuditTarget()(id);
  if (!id) return <>—</>;
  if (target?.kind === "user") {
    return (
      <Link to="/admin/users/$userId" params={{ userId: id }} className={s.link}>
        {target.label}
      </Link>
    );
  }
  if (target?.kind === "lecture") {
    return (
      <Link to="/admin/recordings/$lectureId" params={{ lectureId: id }} className={s.link}>
        {target.label}
      </Link>
    );
  }
  return <span className={s.code}>{id}</span>;
}

export function AuditDetailDialog({ log, onClose }: { log: AdminAuditLog | null; onClose: () => void }) {
  const now = new Date();
  return (
    <ModalDialog
      isOpen={log !== null}
      onOpenChange={(open) => !open && onClose()}
      title="감사 로그"
      size="form"
      footer={
        <Button variant="primary" onPress={onClose} autoFocus>
          닫기
        </Button>
      }
    >
      {log && (
        <>
          <StatTable
            label="감사 로그 항목"
            rows={[
              ["시각", `${formatDateTime(log.created_at, now)} (${formatRelative(log.created_at, now)})`],
              ["동작", <span className={s.code}>{log.action}</span>],
              ["수행자", log.actor_email || "—"],
              ["대상", <AuditTarget id={log.target_id} />],
              ["ID", <span className={s.code}>{log.id}</span>],
            ]}
          />
          <h3 className={s.panelTitle}>상세</h3>
          <p className={s.pre}>{log.detail || "—"}</p>
        </>
      )}
    </ModalDialog>
  );
}

export function AuditPage() {
  usePageTitle("관리 · 감사 로그");
  const search = useSearch({ from: "/_authed/admin/audit" });
  const navigate = useNavigate();
  const audit = useAdminAudit({ action: search.action, q: search.q });
  const [open, setOpen] = useState<AdminAuditLog | null>(null);
  const now = new Date();
  const pages = audit.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.logs);
  const first = pages[0];
  const total = first?.total ?? 0;

  const setFilter = (next: AdminAuditSearch) => void navigate({ to: "/admin/audit", search: { ...search, ...next }, replace: true });
  const count = (k: "all" | AuditPrefix) => (first ? ` (${formatCount(first.counts[k])})` : "");

  const columns: Column<AdminAuditLog>[] = [
    {
      key: "time",
      header: "시각",
      sortValue: (a) => Date.parse(a.created_at),
      cell: (a) => (
        <Button variant="ghost" size="sm" aria-label={`자세히: ${a.action}, ${formatDateTime(a.created_at, now)}`} onPress={() => setOpen(a)}>
          {formatDateTime(a.created_at, now)}
        </Button>
      ),
    },
    { key: "actor", header: "행위자", sortValue: (a) => a.actor_email, cell: (a) => a.actor_email || "—" },
    { key: "action", header: "동작", sortValue: (a) => a.action, cell: (a) => <span className={s.code}>{a.action}</span> },
    { key: "target", header: "대상", cell: (a) => <AuditTarget id={a.target_id} /> },
    { key: "detail", header: "상세", cell: (a) => a.detail || "—" },
  ];

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>감사 로그</h1>
        {first && <span className={s.muted}>{formatCount(total)}건</span>}
      </header>
      <div className={s.filters}>
        <SelectField
          label="분류"
          items={[{ id: "all", label: `전체${count("all")}` }, ...AUDIT_PREFIXES.map((p) => ({ id: p, label: `${AUDIT_PREFIX_LABEL[p]}${count(p)}` }))]}
          selectedKey={search.action ?? "all"}
          onSelectionChange={(v) => setFilter({ action: v === "all" ? undefined : (v as AuditPrefix) })}
        />
        <SearchBox label="검색" placeholder="행위자, 동작, 상세" value={search.q} onCommit={(q) => setFilter({ q })} />
      </div>
      {audit.isError ? (
        <ErrorBox title={errorMessage(audit.error, "감사 로그를 불러오지 못했습니다.")} onRetry={() => void audit.refetch()} />
      ) : (
        <DataTable
          caption="감사 로그"
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          empty={audit.isPending ? "불러오는 중…" : search.action || search.q ? "조건에 맞는 기록이 없습니다." : "기록된 감사 로그가 없습니다."}
          onRowClick={setOpen}
        />
      )}
      {audit.hasNextPage ? (
        <div className={s.more}>
          <Button onPress={() => void audit.fetchNextPage()} isDisabled={audit.isFetchingNextPage}>
            {audit.isFetchingNextPage ? "불러오는 중…" : `더 보기 (${formatCount(Math.max(0, total - rows.length))}건 남음)`}
          </Button>
        </div>
      ) : (
        rows.length > 20 && <p className={`${s.muted} ${s.more}`}>모든 기록을 표시했습니다.</p>
      )}
      <AuditDetailDialog log={open} onClose={() => setOpen(null)} />
    </>
  );
}
