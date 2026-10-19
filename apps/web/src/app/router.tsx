// Routes (ARCHITECTURE §7 정보 구조). The app lives under /app; every path below is
// relative to that base, and the server answers unknown /app/* paths with index.html.
//
// Everything but /login sits under the pathless `_authed` layout, whose beforeLoad asks
// the existing cookie auth (GET /api/auth/me) once per page load and sends a visitor
// without a session to /login?next=<where they were going>. A session that ends later
// (any 401) does the same through ApiClient.onUnauthorized (App.tsx).

import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import type { ApiClient } from "../api/client.ts";
import { queryKeys } from "../api/queries.ts";
import { RootLayout } from "./RootLayout.tsx";
import { InboxPage } from "../routes/inbox/InboxPage.tsx";
import { LibraryPage } from "../routes/library/LibraryPage.tsx";
import { RecordingPage } from "../routes/recording/RecordingPage.tsx";
import { CalendarPage } from "../routes/calendar/CalendarPage.tsx";
import { LoginPage, safeNext, type LoginSearch } from "../routes/login/LoginPage.tsx";
import { NotFoundPage, SessionErrorPage } from "../routes/placeholders.tsx";
import { SettingsPage } from "../routes/settings/SettingsPage.tsx";
import { AskPage, type AskSearch } from "../routes/ask/AskPage.tsx";

export interface RouterContext {
  api: ApiClient;
  queryClient: QueryClient;
}

export interface LibrarySearch {
  /** Folder id, or "none" for recordings outside any folder. */
  folder?: string;
  tag?: string;
  /** Smart view id (lib/smart-views.ts). */
  view?: string;
  q?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);

/** The signed-in user, asked once and then kept until a 401 or a sign-out clears it. */
function ensureSession({ api, queryClient }: RouterContext) {
  return queryClient.ensureQueryData({ queryKey: queryKeys.session, queryFn: () => api.getSession(), staleTime: Infinity });
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet, notFoundComponent: NotFoundPage });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({ next: str(search.next) }),
  beforeLoad: async ({ context, search }) => {
    if (await ensureSession(context)) throw redirect({ href: safeNext(search.next) });
  },
  component: LoginPage,
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authed",
  beforeLoad: async ({ context, location }) => {
    if (!(await ensureSession(context))) throw redirect({ to: "/login", search: { next: location.href } });
  },
  errorComponent: SessionErrorPage,
  component: RootLayout,
});

const inboxRoute = createRoute({ getParentRoute: () => authedRoute, path: "/", component: InboxPage });

const libraryRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/library",
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    folder: str(search.folder),
    tag: str(search.tag),
    view: str(search.view),
    q: str(search.q),
  }),
  component: LibraryPage,
});

const recordingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/recordings/$recordingId",
  validateSearch: (search: Record<string, unknown>): { t?: number; ask?: string } => {
    const t = Number(search.t);
    const ask = str(search.ask);
    return { ...(Number.isFinite(t) && t >= 0 ? { t } : {}), ...(ask ? { ask } : {}) };
  },
  component: RecordingPage,
});

const askRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/ask",
  validateSearch: (search: Record<string, unknown>): AskSearch => {
    const scope = search.scope === "folder" || search.scope === "recording" || search.scope === "workspace" ? search.scope : undefined;
    return { q: str(search.q), scope, id: str(search.id), thread: str(search.thread) };
  },
  component: AskPage,
});
const calendarRoute = createRoute({ getParentRoute: () => authedRoute, path: "/calendar", component: CalendarPage });
const settingsRoute = createRoute({ getParentRoute: () => authedRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([inboxRoute, libraryRoute, recordingRoute, askRoute, calendarRoute, settingsRoute]),
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({ routeTree, basepath: "/app", defaultPreload: false, context });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
