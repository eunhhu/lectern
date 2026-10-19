import { HEADER } from "@lectern/domain";
import { denyUnlessMember } from "./access.ts";
import { defineRouter } from "./common.ts";
import * as F from "./fixtures.ts";

/** How long a browser EventSource waits before reconnecting after the stub closes. */
const RECONNECT_MS = 30_000;

// SSE stub with the real framing and replay rule, over the fixture event log:
//   - each message is `id: <event.id>`, `event: <event.type>`, `data: <ServerEvent JSON>`;
//   - with `Last-Event-ID`, only events after that id are sent; an id the log does not
//     hold (never issued, or aged out) replays the whole log, since the gap is unknown;
//   - the stream then ends, and `retry:` makes EventSource reconnect with the last id it
//     saw, so a reconnect gets nothing new. The real stream stays open and pushes.
export const eventsRouter = defineRouter({
  streamEvents: (req) => {
    const { workspace_id } = req.query;
    const denied = denyUnlessMember(req, workspace_id);
    if (denied) return denied;

    const lastEventId = req.headers[HEADER.lastEventId];
    const after = lastEventId === undefined ? -1 : F.serverEvents.findIndex((e) => e.id === lastEventId);
    const schema = req.route.responses[200]!.schema!;
    const messages = F.serverEvents
      .slice(after + 1)
      .filter((e) => e.workspace_id === workspace_id)
      .map((e) => {
        const event = schema.parse(e) as { id: string; type: string };
        return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      });

    return new Response(`retry: ${RECONNECT_MS}\n\n${messages.join("")}`, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
