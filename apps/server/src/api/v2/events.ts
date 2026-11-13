import { HEADER } from "@lectern/domain";
import { lectureDocumentId, lectureRecordingId } from "@lectern/db";
import { db } from "../../db.ts";
import type { LectureEventPayload } from "../../events.ts";
import { logger } from "../../log.ts";
import { can, requireWorkspace, type Caller } from "./access.ts";
import { apiError, defineRouter } from "./common.ts";
import { iso, recordingDto, type RecordingRow } from "./rows.ts";
import { activeJobRow, stageNameOf } from "./store.ts";

// GET /api/v2/events (SSE, ARCHITECTURE §6). Every process that changes a lecture appends
// to `job_event` (events.ts), so tailing that table serves changes from the API and from an
// external worker alike. Rows hold v1 lecture payloads; they are translated into domain
// ServerEvents when sent, with the recording as it is at that moment.
//
//   - a message is `id: <row>` or `id: <row>-<n>` (one row can become several events),
//     `event: <type>`, `data: <ServerEvent JSON>`;
//   - without Last-Event-ID the stream starts at "now" (load the state over REST first);
//     with one, the events after it that are still in the log (a day) are sent first. An
//     id older than the log replays all of it, since what was missed is unknown;
//   - `: ping` every 15 s keeps proxies from closing an idle stream.

const RECONNECT_MS = 5_000;
const PING_MS = 15_000;
const POLL_MS = 1_000;

export interface EventRow {
  id: number;
  workspace_id: string | null;
  owner_id: string;
  subject_id: string | null;
  type: string;
  payload: string;
  created_at: number;
}

interface Message {
  id: string;
  type: string;
  data: unknown;
}

/** Whether a job_event row belongs to the workspace (v1 rows carry only the owner). */
function inWorkspace(row: EventRow, workspaceId: string, personalUserId: string | null): boolean {
  return row.workspace_id ? row.workspace_id === workspaceId : personalUserId !== null && row.owner_id === personalUserId;
}

function recordingOfLecture(lectureId: string): RecordingRow | null {
  return db.query(`SELECT * FROM recording WHERE lecture_id = ? OR id = ? LIMIT 1`).get(lectureId, lectureId) as RecordingRow | null;
}

/** The ServerEvents one job_event row stands for, for this caller (exported for tests). */
export function translate(row: EventRow, workspaceId: string, caller: Caller): Message[] {
  let payload: LectureEventPayload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return [];
  }
  const createdAt = iso(row.created_at);
  const out: Array<Omit<Message, "id">> = [];
  const envelope = (recordingId: string | null) => ({ workspace_id: workspaceId, recording_id: recordingId, created_at: createdAt });

  if (payload.type === "deleted") {
    const ids = payload.ids ?? (payload.id ? [payload.id] : []);
    for (const lectureId of ids) {
      const recordingId = lectureRecordingId(lectureId);
      out.push({ type: "recording.deleted", data: { ...envelope(recordingId), type: "recording.deleted", payload: { recording_id: recordingId } } });
    }
  } else if (payload.id) {
    const recording = recordingOfLecture(payload.id);
    if (!recording || recording.workspace_id !== workspaceId || !can(caller, "recording:read", recording)) return [];
    const recordingEvent = (type: "recording.created" | "recording.updated") => ({
      type,
      data: { ...envelope(recording.id), type, payload: { recording: recordingDto(recording) } },
    });
    if (payload.type === "created") out.push(recordingEvent("recording.created"));
    else if (payload.type === "progress") {
      const job = activeJobRow(recording);
      if (job) {
        out.push({
          type: "job.progress",
          data: {
            ...envelope(recording.id),
            type: "job.progress",
            payload: {
              job_id: job.id,
              stage: stageNameOf(payload.stage),
              state: job.state === "running" ? "running" : "pending",
              progress: typeof payload.progress === "number" ? Math.min(1, Math.max(0, payload.progress / 100)) : null,
              chunk_index: null,
              chunk_count: null,
            },
          },
        });
      }
      out.push(recordingEvent("recording.updated"));
    } else {
      out.push(recordingEvent("recording.updated"));
      if (payload.type === "completed" || payload.type === "updated") {
        const doc = db.query(`SELECT id, current_version FROM document WHERE id = ?`).get(lectureDocumentId(payload.id)) as
          | { id: string; current_version: number }
          | null;
        if (doc && payload.type === "completed") {
          out.push({
            type: "document.updated",
            data: { ...envelope(recording.id), type: "document.updated", payload: { document_id: doc.id, version: doc.current_version } },
          });
        }
      }
    }
  }
  return out.map((m, n) => {
    const id = n === 0 ? String(row.id) : `${row.id}-${n}`;
    return { id, type: m.type, data: { id, ...(m.data as object) } };
  });
}

// ---------------------------------------------------------------------------
// One poller for every open stream
// ---------------------------------------------------------------------------

interface Subscriber {
  workspaceId: string;
  personalUserId: string | null;
  caller: Caller;
  send: (rows: EventRow[]) => void;
}

const subscribers = new Set<Subscriber>();
let lastSeen = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function maxEventId(): number {
  return (db.query(`SELECT MAX(id) AS id FROM job_event`).get() as { id: number | null }).id ?? 0;
}

function poll(): void {
  try {
    const rows = db.query(`SELECT * FROM job_event WHERE id > ? ORDER BY id LIMIT 500`).all(lastSeen) as EventRow[];
    if (!rows.length) return;
    lastSeen = rows[rows.length - 1]!.id;
    for (const sub of subscribers) {
      const mine = rows.filter((r) => inWorkspace(r, sub.workspaceId, sub.personalUserId));
      if (mine.length) sub.send(mine);
    }
  } catch (err) {
    logger.error("event stream poll failed", { err });
  }
}

function subscribe(sub: Subscriber): () => void {
  if (!timer) {
    lastSeen = maxEventId();
    timer = setInterval(poll, POLL_MS);
    timer.unref?.();
  }
  subscribers.add(sub);
  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** `N` or `N-k` -> [row, sub-event index]. */
function parseEventId(value: string): [number, number] | null {
  const match = /^(\d{1,15})(?:-(\d{1,3}))?$/.exec(value);
  return match ? [Number(match[1]), match[2] ? Number(match[2]) : 0] : null;
}

const frame = (m: Message) => `id: ${m.id}\nevent: ${m.type}\ndata: ${JSON.stringify(m.data)}\n\n`;

export const eventsRouter = defineRouter({
  streamEvents: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const workspace = db.query(`SELECT personal_user_id FROM workspace WHERE id = ?`).get(workspace_id) as { personal_user_id: string | null } | null;
    const personalUserId = workspace?.personal_user_id ?? null;
    const schema = req.route.responses[200]!.schema!;

    const lastEventId = req.headers[HEADER.lastEventId] as string | undefined;
    const resume = lastEventId === undefined ? null : parseEventId(lastEventId);
    if (lastEventId !== undefined && !resume) return apiError(req.c, 400, "bad_request", "Last-Event-ID 형식이 올바르지 않습니다.");

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const signal = req.c.req.raw.signal;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const close = () => {
          if (!open) return;
          open = false;
          unsubscribe?.();
          if (ping) clearInterval(ping);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        const write = (text: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            close();
          }
        };
        const sendRows = (rows: EventRow[], skipThrough?: [number, number]) => {
          for (const row of rows) {
            for (const message of translate(row, workspace_id, caller)) {
              if (skipThrough && row.id === skipThrough[0]) {
                const sub = message.id.includes("-") ? Number(message.id.split("-")[1]) : 0;
                if (sub <= skipThrough[1]) continue;
              }
              const parsed = schema.safeParse(message.data);
              if (!parsed.success) {
                logger.warn("dropped an event that does not match the contract", { event_id: message.id, type: message.type });
                continue;
              }
              write(frame({ ...message, data: parsed.data }));
            }
          }
        };

        write(`retry: ${RECONNECT_MS}\n\n`);
        // Subscribe before replaying, so nothing written in between is lost; rows the
        // replay already sent are skipped by id.
        let replayedThrough = 0;
        unsubscribe = subscribe({
          workspaceId: workspace_id,
          personalUserId,
          caller,
          send: (rows) => sendRows(rows.filter((r) => r.id > replayedThrough)),
        });
        if (resume) {
          const oldest = (db.query(`SELECT MIN(id) AS id FROM job_event`).get() as { id: number | null }).id ?? 0;
          const from = resume[0] < oldest ? 0 : resume[0];
          const rows = (db.query(`SELECT * FROM job_event WHERE id >= ? AND id <= ? ORDER BY id`).all(from, lastSeen || maxEventId()) as EventRow[]).filter(
            (r) => inWorkspace(r, workspace_id, personalUserId)
          );
          replayedThrough = rows.length ? rows[rows.length - 1]!.id : 0;
          sendRows(rows, resume[0] < oldest ? undefined : resume);
        }
        ping = setInterval(() => write(`: ping\n\n`), PING_MS);
        ping.unref?.();
        signal.addEventListener("abort", close, { once: true });
      },
      cancel() {
        unsubscribe?.();
        if (ping) clearInterval(ping);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
