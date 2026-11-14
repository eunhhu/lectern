// Google Calendar API v3 calls (P4-02 creates the dedicated "Lectern" calendar; P4-03 adds
// the event calls). Plain fetch with the integration's access token. Errors carry the HTTP
// status, never the response body.

import { GoogleAuthError } from "./oauth.ts";

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Sends one Calendar API request; 401 is a GoogleAuthError, other failures a GoogleApiError. */
export async function calendarRequest(accessToken: string, method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GoogleApiError(0, `Google Calendar ${method} unreachable`);
  }
  if (res.status === 401) {
    await res.body?.cancel();
    throw new GoogleAuthError("unauthorized", "Google Calendar rejected the access token");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new GoogleApiError(res.status, `Google Calendar ${method} answered ${res.status}`);
  }
  return res;
}

/** Creates the dedicated calendar and returns its id. */
export async function createCalendar(accessToken: string, timeZone: string): Promise<string> {
  const res = await calendarRequest(accessToken, "POST", "/calendars", { summary: "Lectern", timeZone });
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new GoogleApiError(res.status, "Google Calendar returned no calendar id");
  return body.id;
}

/** True for a failure the queue should retry: network (status 0), 429 and 5xx. */
export function isTransientGoogleError(err: unknown): boolean {
  if (err instanceof GoogleAuthError) return err.code === "transient";
  return err instanceof GoogleApiError && (err.status === 0 || err.status === 429 || err.status >= 500);
}

// ---------------------------------------------------------------------------
// Events (P4-03, D-P4-4): one Google event per event candidate, found again by the private
// extended property `lectern_event_id`.
// ---------------------------------------------------------------------------

export interface SyncableEvent {
  id: string;
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  tz: string;
  recordingTitle: string | null;
}

const HOUR_MS = 3_600_000;

/** `YYYY-MM-DD` of `ms` in `tz` (UTC when the zone is unknown), `days` later. */
function dateIn(ms: number, tz: string, days = 0): string {
  let ymd: string;
  try {
    ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  } catch {
    ymd = new Date(ms).toISOString().slice(0, 10);
  }
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Google event resource for an event candidate. */
export function eventResource(e: SyncableEvent): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    summary: e.title,
    extendedProperties: { private: { lectern_event_id: e.id } },
  };
  if (e.recordingTitle) resource.description = `녹음: ${e.recordingTitle}`;
  if (e.allDay) {
    // An all-day end date is exclusive: the day after the last day.
    resource.start = { date: dateIn(e.startAt, e.tz) };
    resource.end = { date: dateIn(e.endAt ?? e.startAt, e.tz, 1) };
  } else {
    resource.start = { dateTime: new Date(e.startAt).toISOString(), timeZone: e.tz };
    resource.end = { dateTime: new Date(e.endAt ?? e.startAt + HOUR_MS).toISOString(), timeZone: e.tz };
  }
  return resource;
}

const eventsPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;

async function idAndEtag(res: Response): Promise<{ id: string; etag: string }> {
  const body = (await res.json()) as { id?: unknown; etag?: unknown };
  if (typeof body.id !== "string") throw new GoogleApiError(res.status, "Google Calendar returned no event id");
  return { id: body.id, etag: typeof body.etag === "string" ? body.etag : "" };
}

export async function findEventByLecternId(token: string, calendarId: string, lecternId: string): Promise<{ id: string; etag: string } | null> {
  const query = new URLSearchParams({ privateExtendedProperty: `lectern_event_id=${lecternId}`, maxResults: "2", showDeleted: "false" });
  const res = await calendarRequest(token, "GET", `${eventsPath(calendarId)}?${query}`);
  const body = (await res.json()) as { items?: Array<{ id?: unknown; etag?: unknown }> };
  const first = body.items?.find((i) => typeof i.id === "string");
  return first ? { id: first.id as string, etag: typeof first.etag === "string" ? first.etag : "" } : null;
}

export async function insertEvent(token: string, calendarId: string, resource: unknown): Promise<{ id: string; etag: string }> {
  return idAndEtag(await calendarRequest(token, "POST", eventsPath(calendarId), resource));
}

export async function patchEvent(token: string, calendarId: string, eventId: string, resource: unknown): Promise<{ id: string; etag: string }> {
  return idAndEtag(await calendarRequest(token, "PATCH", `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`, resource));
}

/** Deletes an event; one that is already gone (404, 410) counts as deleted. */
export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    const res = await calendarRequest(token, "DELETE", `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`);
    await res.body?.cancel();
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}
