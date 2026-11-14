// 관리 (P5-12, D-P5-10): the admin console inside the web app, `/app/admin/*`. For anyone
// who is not an operator it is the app's ordinary "페이지를 찾을 수 없습니다." screen: no
// tabs, no title, nothing that says an admin console exists. The old console (`/admin`)
// stays as it is.
//
// P5-13: the tabs carry the old console's sidebar counts and dots (ui.ts navCounts): users
// and a dot while someone waits for approval, recordings and a dot while one has failed,
// v1 jobs in flight on 운영, a dot on 저장소 while the disk is low. The numbers are drawn
// for the eye and said as the link's description, so a tab's name stays its label. They
// are read only after the operator check, so nobody else asks the admin routes anything.
// `새로고침` under the tabs reads every admin answer again (the old console's header button),
// except the settings form's, which may be in the middle of an edit.

import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { useAdminOps, useAdminOverview, useIsOperator, useRefreshAdmin } from "../../api/queries.ts";
import { formatCount } from "../../lib/format.ts";
import { Button } from "../../ui/controls.tsx";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { showToast } from "../../ui/toast.tsx";
import { NotFoundPage } from "../placeholders.tsx";
import s from "./admin.module.css";

type TabPath =
  | "/admin"
  | "/admin/users"
  | "/admin/recordings"
  | "/admin/jobs"
  | "/admin/usage"
  | "/admin/storage"
  | "/admin/ops"
  | "/admin/settings"
  | "/admin/audit";

export const ADMIN_TABS: { to: TabPath; label: string; icon: IconName }[] = [
  { to: "/admin", label: "개요", icon: "home" },
  { to: "/admin/users", label: "사용자", icon: "users" },
  { to: "/admin/recordings", label: "녹음", icon: "audio" },
  { to: "/admin/jobs", label: "작업", icon: "clock" },
  { to: "/admin/usage", label: "사용량", icon: "target" },
  { to: "/admin/storage", label: "저장소", icon: "folder" },
  { to: "/admin/ops", label: "운영", icon: "shield" },
  { to: "/admin/settings", label: "설정", icon: "settings" },
  { to: "/admin/audit", label: "감사 로그", icon: "book" },
];

interface TabBadge {
  count?: number;
  dot?: "attention" | "danger" | "info";
  /** What the count and dot say, for the link's description. */
  says: string;
}

export function AdminLayout() {
  const operator = useIsOperator();
  if (operator === undefined) return null; // the session's user is still loading (well under 300 ms)
  if (!operator) return <NotFoundPage />;
  return <OperatorConsole />;
}

function OperatorConsole() {
  const badges = useTabBadges();
  const refresh = useRefreshAdmin();
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
    showToast({ title: "새로고침했습니다." });
  };
  return (
    <div className={s.layout}>
      <nav className={s.tabs} aria-label="관리 메뉴">
        <p className={s.tabsTitle}>관리</p>
        {ADMIN_TABS.map((tab) => {
          const badge = badges[tab.to];
          const id = `admin-tab-${tab.to.replace(/\W+/g, "-")}`;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={s.tab}
              activeOptions={{ exact: tab.to === "/admin", includeSearch: false }}
              aria-describedby={badge ? id : undefined}
            >
              <Icon name={tab.icon} />
              {tab.label}
              {badge && (
                <>
                  {badge.dot && <span className={s.tabDot} data-tone={badge.dot} aria-hidden="true" />}
                  {badge.count !== undefined && (
                    <span className={s.tabCount} aria-hidden="true">
                      {formatCount(badge.count)}
                    </span>
                  )}
                  {/* Hidden, so it is not read into the link's name; aria-describedby still reads it. */}
                  <span id={id} hidden>
                    {badge.says}
                  </span>
                </>
              )}
            </Link>
          );
        })}
        <Button variant="ghost" size="sm" className={s.refresh} onPress={() => void refreshAll()} isDisabled={refreshing}>
          {refreshing ? "읽는 중…" : "새로고침"}
        </Button>
      </nav>
      <div className={s.content}>
        <Outlet />
      </div>
    </div>
  );
}

function useTabBadges(): Partial<Record<TabPath, TabBadge>> {
  const overview = useAdminOverview().data;
  const ops = useAdminOps().data;
  const out: Partial<Record<TabPath, TabBadge>> = {};
  if (overview) {
    const m = overview.metrics;
    out["/admin/users"] = {
      count: overview.users.length,
      dot: m.pendingUsers ? "attention" : undefined,
      says: `${formatCount(overview.users.length)}명${m.pendingUsers ? `, 승인 대기 ${formatCount(m.pendingUsers)}명` : ""}`,
    };
    out["/admin/recordings"] = {
      count: m.totalLectures,
      dot: m.errorLectures ? "danger" : undefined,
      says: `${formatCount(m.totalLectures)}개${m.errorLectures ? `, 오류 ${formatCount(m.errorLectures)}개` : ""}`,
    };
  }
  if (ops) {
    const active = ops.jobs.running.length + ops.jobs.queued.length;
    if (active) out["/admin/ops"] = { count: active, dot: "info", says: `v1 작업 ${formatCount(active)}개 진행 중` };
    if (ops.disk?.low) out["/admin/storage"] = { dot: "danger", says: "디스크 여유 공간 부족" };
  }
  return out;
}
