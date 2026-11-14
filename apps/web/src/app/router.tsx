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
import { ResetPage } from "../routes/account/ResetPage.tsx";
import { SignupPage } from "../routes/account/SignupPage.tsx";
import { NotFoundPage, SessionErrorPage } from "../routes/placeholders.tsx";
import { SettingsPage } from "../routes/settings/SettingsPage.tsx";
import { InvitePage, type InviteSearch } from "../routes/invite/InvitePage.tsx";
import { AdminUserRole, AdminUserStatus, AUDIT_PREFIXES, LectureStatus } from "../api/admin.ts";
import { AuditPage, type AdminAuditSearch } from "../routes/admin/AuditPage.tsx";
import { AdminLayout } from "../routes/admin/AdminLayout.tsx";
import { JobDetailPage } from "../routes/admin/JobDetailPage.tsx";
import { JobsPage, type AdminJobsSearch } from "../routes/admin/JobsPage.tsx";
import { OverviewPage } from "../routes/admin/OverviewPage.tsx";
import { OpsPage, type AdminOpsSearch } from "../routes/admin/OpsPage.tsx";
import { RecordingDetailPage } from "../routes/admin/RecordingDetailPage.tsx";
import { RecordingsPage, type AdminRecordingsSearch } from "../routes/admin/RecordingsPage.tsx";
import { SettingsPage as AdminSettingsPage } from "../routes/admin/SettingsPage.tsx";
import { StoragePage, type AdminStorageSearch } from "../routes/admin/StoragePage.tsx";
import { UserDetailPage } from "../routes/admin/UserDetailPage.tsx";
import { UsagePage, type AdminUsageSearch } from "../routes/admin/UsagePage.tsx";
import { UsersPage, type AdminUsersSearch } from "../routes/admin/UsersPage.tsx";
import { JobKind as JobKindSchema, JobState as JobStateSchema } from "@lectern/domain";
import { AskPage, type AskSearch } from "../routes/ask/AskPage.tsx";
import { SearchPage, type SearchPageSearch } from "../routes/search/SearchPage.tsx";

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

export interface RecordingSearch {
  /** Start playback here (ms of the original audio). */
  t?: number;
  /** Ask this question in the note panel at once. */
  ask?: string;
  /** Open this PDF page in the files panel: `<asset id>:<page>`. */
  pdf?: string;
}

/** `<asset id>:<page>` of the `pdf` search parameter. */
const PDF_TARGET = /^[A-Za-z0-9_-]{1,64}:\d{1,5}$/;

const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);

/** The signed-in user, asked once and then kept until a 401 or a sign-out clears it. */
function ensureSession({ api, queryClient }: RouterContext) {
  return queryClient.ensureQueryData({ queryKey: queryKeys.session, queryFn: () => api.getSession(), staleTime: Infinity });
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet, notFoundComponent: NotFoundPage });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({ next: str(search.next), error: str(search.error) }),
  beforeLoad: async ({ context, search }) => {
    if (await ensureSession(context)) throw redirect({ href: safeNext(search.next) });
  },
  component: LoginPage,
});

// Sign-up and password reset are for visitors: someone already signed in goes home.
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  beforeLoad: async ({ context }) => {
    if (await ensureSession(context)) throw redirect({ href: "/" });
  },
  component: SignupPage,
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset",
  beforeLoad: async ({ context }) => {
    if (await ensureSession(context)) throw redirect({ href: "/" });
  },
  component: ResetPage,
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
  validateSearch: (search: Record<string, unknown>): RecordingSearch => {
    const t = Number(search.t);
    const ask = str(search.ask);
    const pdf = typeof search.pdf === "string" && PDF_TARGET.test(search.pdf) ? search.pdf : undefined;
    return { ...(Number.isFinite(t) && t >= 0 ? { t } : {}), ...(ask ? { ask } : {}), ...(pdf ? { pdf } : {}) };
  },
  component: RecordingPage,
});

const searchRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>): SearchPageSearch => ({
    q: str(search.q),
    kind: search.kind === "transcript" || search.kind === "document" || search.kind === "pdf_page" ? search.kind : undefined,
  }),
  component: SearchPage,
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
// The invitation mail's link (P5-11). Signed out, authedRoute sends it through /login and back.
const inviteRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/invite",
  validateSearch: (search: Record<string, unknown>): InviteSearch => ({
    token: typeof search.token === "string" && search.token.length > 0 && search.token.length <= 256 ? search.token : undefined,
  }),
  component: InvitePage,
});

// The admin console (P5-12, P5-16, P5-13). AdminLayout draws "not found" for anyone who is not an operator.
const searchText = (v: unknown, max = 200) => (typeof v === "string" && v.trim() && v.length <= max ? v : undefined);
const adminRoute = createRoute({ getParentRoute: () => authedRoute, path: "/admin", component: AdminLayout });
const adminOverviewRoute = createRoute({ getParentRoute: () => adminRoute, path: "/", component: OverviewPage });
const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/users",
  validateSearch: (search: Record<string, unknown>): AdminUsersSearch => ({
    role: AdminUserRole.safeParse(search.role).data,
    status: AdminUserStatus.safeParse(search.status).data,
    q: searchText(search.q),
    new: search.new === 1 || search.new === "1" || search.new === true ? 1 : undefined,
  }),
  component: UsersPage,
});
const adminUserRoute = createRoute({ getParentRoute: () => adminRoute, path: "/users/$userId", component: UserDetailPage });
const adminRecordingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/recordings",
  validateSearch: (search: Record<string, unknown>): AdminRecordingsSearch => ({
    status: LectureStatus.safeParse(search.status).data,
    q: searchText(search.q),
    owner: searchText(search.owner, 100),
  }),
  component: RecordingsPage,
});
const adminRecordingRoute = createRoute({ getParentRoute: () => adminRoute, path: "/recordings/$lectureId", component: RecordingDetailPage });
const adminJobsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/jobs",
  validateSearch: (search: Record<string, unknown>): AdminJobsSearch => ({
    state: JobStateSchema.safeParse(search.state).data,
    kind: JobKindSchema.safeParse(search.kind).data,
  }),
  component: JobsPage,
});
const adminJobRoute = createRoute({ getParentRoute: () => adminRoute, path: "/jobs/$jobId", component: JobDetailPage });
const adminUsageRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/usage",
  validateSearch: (search: Record<string, unknown>): AdminUsageSearch => ({
    period: typeof search.period === "string" && /^\d{4}-\d{2}$/.test(search.period) ? search.period : undefined,
  }),
  component: UsagePage,
});
const adminStorageRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/storage",
  validateSearch: (search: Record<string, unknown>): AdminStorageSearch => ({
    run: search.run === "compact" || search.run === "gc" || search.run === "retention" ? search.run : undefined,
  }),
  component: StoragePage,
});
const adminOpsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/ops",
  validateSearch: (search: Record<string, unknown>): AdminOpsSearch => ({ run: search.run === "maintenance" ? "maintenance" : undefined }),
  component: OpsPage,
});
const adminSettingsRoute = createRoute({ getParentRoute: () => adminRoute, path: "/settings", component: AdminSettingsPage });
const adminAuditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/audit",
  validateSearch: (search: Record<string, unknown>): AdminAuditSearch => ({
    action: AUDIT_PREFIXES.find((p) => p === search.action),
    q: searchText(search.q),
  }),
  component: AuditPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  resetRoute,
  authedRoute.addChildren([inboxRoute, libraryRoute, recordingRoute, searchRoute, askRoute, calendarRoute, settingsRoute, inviteRoute,
    adminRoute.addChildren([
      adminOverviewRoute,
      adminUsersRoute,
      adminUserRoute,
      adminRecordingsRoute,
      adminRecordingRoute,
      adminJobsRoute,
      adminJobRoute,
      adminUsageRoute,
      adminStorageRoute,
      adminOpsRoute,
      adminSettingsRoute,
      adminAuditRoute,
    ]),
  ]),
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({ routeTree, basepath: "/app", defaultPreload: false, context });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
