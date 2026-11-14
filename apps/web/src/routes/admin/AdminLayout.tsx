// 관리 (P5-12, D-P5-10): the admin console inside the web app, `/app/admin/*`. For anyone
// who is not an operator it is the app's ordinary "페이지를 찾을 수 없습니다." screen: no
// tabs, no title, nothing that says an admin console exists. The old console (`/admin`)
// stays as it is.

import { Link, Outlet } from "@tanstack/react-router";
import { useIsOperator } from "../../api/queries.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { NotFoundPage } from "../placeholders.tsx";
import s from "./admin.module.css";

const TABS: { to: "/admin" | "/admin/users" | "/admin/recordings" | "/admin/jobs" | "/admin/usage"; label: string; icon: IconName }[] = [
  { to: "/admin", label: "개요", icon: "home" },
  { to: "/admin/users", label: "사용자", icon: "users" },
  { to: "/admin/recordings", label: "녹음", icon: "audio" },
  { to: "/admin/jobs", label: "작업", icon: "clock" },
  { to: "/admin/usage", label: "사용량", icon: "target" },
];

export function AdminLayout() {
  const operator = useIsOperator();
  if (operator === undefined) return null; // the session's user is still loading (well under 300 ms)
  if (!operator) return <NotFoundPage />;
  return (
    <div className={s.layout}>
      <nav className={s.tabs} aria-label="관리 메뉴">
        <p className={s.tabsTitle}>관리</p>
        {TABS.map((tab) => (
          <Link key={tab.to} to={tab.to} className={s.tab} activeOptions={{ exact: tab.to === "/admin", includeSearch: false }}>
            <Icon name={tab.icon} />
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className={s.content}>
        <Outlet />
      </div>
    </div>
  );
}
