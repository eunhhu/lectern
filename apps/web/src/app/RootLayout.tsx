// App frame: skip link, sidebar (홈 · 라이브러리 · 물어보기 · 일정 · 설정), workspace
// switcher, and the app-wide overlays. Landmarks: <nav> in the sidebar, one <main>.

import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  Button as AriaButton,
  Dialog,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Header,
  Separator,
} from "react-aria-components";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../api/errors.ts";
import { queryKeys, useApi, useMe, useRecordings, useSuggestions } from "../api/queries.ts";
import { asId, type WorkspaceId } from "../api/types.ts";
import { Icon } from "../ui/Icon.tsx";
import { Button, Kbd, uiStyles } from "../ui/controls.tsx";
import { LiveRegion, showToast, Toasts } from "../ui/toast.tsx";
import { Avatar } from "../ui/Avatar.tsx";
import { formatShortcut } from "../lib/keyboard.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { NAV_ITEMS } from "./commands.ts";
import { GlobalShortcuts } from "./GlobalShortcuts.tsx";
import { ShortcutSheet } from "./ShortcutSheet.tsx";
import { UploadDialog } from "./upload/UploadDialog.tsx";
import { openOverlay, useOverlay } from "./overlays.ts";
import { cycleTheme } from "./preferences.ts";
import { useWorkspace, WorkspaceProvider } from "./workspace.tsx";
import s from "./layout.module.css";


export function RootLayout() {
  return (
    <WorkspaceProvider>
      <Frame />
    </WorkspaceProvider>
  );
}

function Frame() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const fill = /\/recordings\//.test(pathname);
  const [navOpen, setNavOpen] = useOverlay("nav");
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page on navigation so keyboard and screen reader users start at the top.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    if (!window.location.hash) mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  return (
    <>
      <a className={uiStyles.skip} href="#main">
        본문 바로가기
      </a>
      <div className={s.app}>
        <div className={s.topbar}>
          <Button variant="ghost" icon="menu" iconOnly aria-label="메뉴 열기" onPress={() => setNavOpen(true)} />
          <span className={s.topbarTitle}>Lectern</span>
          <Button variant="ghost" icon="search" iconOnly aria-label="검색 및 명령" onPress={() => openOverlay("palette")} />
        </div>
        <Sidebar />
        <main id="main" ref={mainRef} tabIndex={-1} className={s.main} data-fill={fill || undefined}>
          <Outlet />
        </main>
      </div>
      <ModalOverlay className={s.drawerScrim} isOpen={navOpen} onOpenChange={setNavOpen} isDismissable>
        <Modal className={s.drawer}>
          <Dialog className={s.drawerDialog} aria-label="메뉴">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </Dialog>
        </Modal>
      </ModalOverlay>
      <CommandPalette />
      <UploadDialog />
      <ShortcutSheet />
      <GlobalShortcuts />
      <Toasts />
      <LiveRegion />
    </>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const api = useApi();
  const { workspaceId } = useWorkspace();
  const recordings = useRecordings(workspaceId);
  const suggestions = useSuggestions(workspaceId);
  const busy = (recordings.data ?? []).filter((r) => r.status === "uploading" || r.status === "queued" || r.status === "processing").length;
  const pending = (suggestions.data?.length ?? 0) + busy;

  return (
    <div className={s.sidebar}>
      <WorkspaceSwitcher />
      <div className={s.quick}>
        <AriaButton className={s.quickButton} onPress={() => openOverlay("palette")} aria-keyshortcuts="Meta+K Control+K">
          <Icon name="search" />
          <span className={s.quickLabel}>검색 및 명령</span>
          <Kbd keys={[formatShortcut("k", { mod: true })]} />
        </AriaButton>
        <AriaButton className={s.quickButton} onPress={() => openOverlay("upload")} aria-keyshortcuts="U">
          <Icon name="upload" />
          <span className={s.quickLabel}>녹음 올리기</span>
          <Kbd keys={["U"]} />
        </AriaButton>
      </div>
      <nav className={s.nav} aria-label="주 메뉴">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={s.navLink}
            activeOptions={{ exact: item.to === "/", includeSearch: false }}
            aria-keyshortcuts={`G ${item.key}`}
            onClick={onNavigate}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.to === "/" && pending > 0 && (
              <span className={s.navCount} aria-label={`확인할 항목 ${pending}개`}>
                {pending}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className={s.sidebarFooter}>
        {api.mode === "fixture" && (
          <p className={s.previewNote}>
            <Icon name="info" />
            <span>
              <strong>미리보기 데이터</strong>
              <br />
              합성 데이터로 동작합니다. 새로고침하면 처음 상태로 돌아갑니다.
            </span>
          </p>
        )}
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function WorkspaceSwitcher() {
  const { current, workspaces, workspaceId, switchTo } = useWorkspace();
  const navigate = useNavigate();
  const name = current?.workspace.name ?? "워크스페이스";
  return (
    <MenuTrigger>
      <AriaButton className={s.workspaceButton} aria-label={`워크스페이스: ${name}, 바꾸기`}>
        <span className={s.workspaceMark} aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span className={s.workspaceName}>
          {name}
          <span className={s.workspaceKind}> · {current?.workspace.kind === "team" ? "팀" : "개인"}</span>
        </span>
        <Icon name="chevronDown" size={14} />
      </AriaButton>
      <Popover className={uiStyles.popover} placement="bottom start">
        <Menu className={uiStyles.menu} onAction={(key) => key === "settings" && void navigate({ to: "/settings" })}>
          <MenuSection
            selectionMode="single"
            selectedKeys={[workspaceId]}
            onSelectionChange={(keys) => {
              const [key] = keys === "all" ? [] : [...keys];
              if (key !== undefined && key !== workspaceId) {
                switchTo(asId<WorkspaceId>(String(key)));
                void navigate({ to: "/" });
              }
            }}
          >
            <Header className={uiStyles.menuHeader}>워크스페이스</Header>
            {workspaces.map((w) => (
              <MenuItem key={w.workspace.id} id={w.workspace.id} className={uiStyles.menuItem} textValue={w.workspace.name}>
                {({ isSelected }) => (
                  <>
                    <Icon name="workspace" />
                    {w.workspace.name}
                    <span className={s.workspaceKind}>{w.workspace.kind === "team" ? "팀" : "개인"}</span>
                    {isSelected && (
                      <span className={uiStyles.optionCheck}>
                        <Icon name="check" size={14} />
                      </span>
                    )}
                  </>
                )}
              </MenuItem>
            ))}
          </MenuSection>
          <Separator className={uiStyles.menuSeparator} />
          <MenuItem id="settings" className={uiStyles.menuItem}>
            <Icon name="settings" />
            워크스페이스 설정
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** `<title>` per view (DESIGN.md §5.1.8): "라이브러리 · Lectern". */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Lectern` : "Lectern";
  }, [title]);
}

function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe().data;
  const api = useApi();
  const { current } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = async () => {
    try {
      await api.logout();
    } catch (err) {
      showToast({ title: "로그아웃하지 못했습니다.", description: errorMessage(err), tone: "danger" });
      return;
    }
    // Leave the signed-in screens first, then drop everything of this account from memory.
    queryClient.setQueryData(queryKeys.session, null);
    await navigate({ to: "/login", replace: true });
    queryClient.clear();
    queryClient.setQueryData(queryKeys.session, null);
  };
  if (!me) return null;
  return (
    <MenuTrigger>
      <AriaButton className={s.userButton}>
        <Avatar id={me.id} name={me.display_name} />
        <span className={s.userText}>
          <span className={s.userName}>{me.display_name}</span>
          <span className={s.userMeta}>{current?.workspace.name} · {current?.role === "owner" ? "Owner" : current?.role === "admin" ? "Admin" : current?.role === "viewer" ? "Viewer" : "Member"}</span>
        </span>
        <Icon name="more" />
      </AriaButton>
      <Popover className={uiStyles.popover} placement="top start">
        <Menu
          className={uiStyles.menu}
          onAction={(key) => {
            onNavigate?.();
            if (key === "profile") void navigate({ to: "/settings", hash: "account" });
            else if (key === "settings") void navigate({ to: "/settings" });
            else if (key === "shortcuts") openOverlay("shortcuts");
            else if (key === "theme") cycleTheme();
            else if (key === "logout") void logout();
          }}
        >
          <MenuSection>
            <Header className={uiStyles.menuHeader}>{me.email}</Header>
            <MenuItem id="profile" className={uiStyles.menuItem} textValue="프로필과 계정">
              <Icon name="user" /> 프로필과 계정
            </MenuItem>
            <MenuItem id="settings" className={uiStyles.menuItem} textValue="설정">
              <Icon name="settings" /> 설정
            </MenuItem>
            <MenuItem id="shortcuts" className={uiStyles.menuItem} textValue="단축키">
              <Icon name="keyboard" /> 단축키 <kbd className={s.menuKey}>?</kbd>
            </MenuItem>
            <MenuItem id="theme" className={uiStyles.menuItem} textValue="테마 전환">
              <Icon name="sun" /> 테마 전환
            </MenuItem>
          </MenuSection>
          <Separator className={uiStyles.menuSeparator} />
          <MenuItem id="logout" className={uiStyles.menuItem} textValue="로그아웃">
            <Icon name="logout" /> 로그아웃
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
