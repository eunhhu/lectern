import { denyUnlessMember } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

export const calendarRouter = defineRouter({
  listCalendarSuggestions: (req) => {
    const { workspace_id, status = "suggested" } = req.query as { workspace_id: string; status?: string };
    return (
      denyUnlessMember(req, workspace_id) ??
      okPage(req, F.eventCandidates.filter((e) => e.workspace_id === workspace_id && e.status === status))
    );
  },
  updateCalendarSuggestion: notImplemented,
  batchCalendarSuggestions: notImplemented,
});
