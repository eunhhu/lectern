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
