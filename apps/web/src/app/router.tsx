// Routes (ARCHITECTURE §7 정보 구조). The app lives under /app; every path below is
// relative to that base, and the server answers unknown /app/* paths with index.html.

import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { RootLayout } from "./RootLayout.tsx";
import { InboxPage } from "../routes/inbox/InboxPage.tsx";
import { LibraryPage } from "../routes/library/LibraryPage.tsx";
import { RecordingPage } from "../routes/recording/RecordingPage.tsx";
import { CalendarPage } from "../routes/calendar/CalendarPage.tsx";
import { NotFoundPage } from "../routes/placeholders.tsx";
import { SettingsPage } from "../routes/settings/SettingsPage.tsx";
import { AskPage, type AskSearch } from "../routes/ask/AskPage.tsx";

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
  validateSearch: (search: Record<string, unknown>): { t?: number; ask?: string } => {
    const t = Number(search.t);
    const ask = str(search.ask);
    return { ...(Number.isFinite(t) && t >= 0 ? { t } : {}), ...(ask ? { ask } : {}) };
  },
  component: RecordingPage,
});

const askRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ask",
  validateSearch: (search: Record<string, unknown>): AskSearch => {
    const scope = search.scope === "folder" || search.scope === "recording" || search.scope === "workspace" ? search.scope : undefined;
    return { q: str(search.q), scope, id: str(search.id), thread: str(search.thread) };
  },
  component: AskPage,
});
const calendarRoute = createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: CalendarPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([inboxRoute, libraryRoute, recordingRoute, askRoute, calendarRoute, settingsRoute]);

export function createAppRouter() {
  return createRouter({ routeTree, basepath: "/app", defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
