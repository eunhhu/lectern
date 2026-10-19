// Routes (ARCHITECTURE §7 정보 구조). The app lives under /app; every path below is
// relative to that base, and the server answers unknown /app/* paths with index.html.

import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { RootLayout } from "./RootLayout.tsx";
import { InboxPage } from "../routes/inbox/InboxPage.tsx";
import { LibraryPage } from "../routes/library/LibraryPage.tsx";
import { RecordingPage } from "../routes/recording/RecordingPage.tsx";
import { CalendarPage } from "../routes/calendar/CalendarPage.tsx";
import { NotFoundPage } from "../routes/placeholders.tsx";
import { ReviewPage } from "../routes/review/ReviewPage.tsx";
import { SettingsPage } from "../routes/settings/SettingsPage.tsx";

export interface LibrarySearch {
  /** Folder id, or "none" for recordings outside any folder. */
  folder?: string;
  tag?: string;
  /** Smart view id (lib/smart-views.ts). */
  view?: string;
  q?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage });

const inboxRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: InboxPage });

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
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
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId",
  validateSearch: (search: Record<string, unknown>): { t?: number } => {
    const t = Number(search.t);
    return Number.isFinite(t) && t >= 0 ? { t } : {};
  },
  component: RecordingPage,
});

const reviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/review", component: ReviewPage });
const calendarRoute = createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: CalendarPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([inboxRoute, libraryRoute, recordingRoute, reviewRoute, calendarRoute, settingsRoute]);

export function createAppRouter() {
  return createRouter({ routeTree, basepath: "/app", defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
