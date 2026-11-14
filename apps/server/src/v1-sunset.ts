// Retiring API v1 (CONTRACTS D-P6-5): who still calls it, the Deprecation/Sunset headers
// once a date is set, and the 410 the operator may turn on after that date.
//
// - Counts go to `v1_usage` per Seoul day, route and client. Requests only add to a map in
//   memory; it is written every 30 seconds, past 500 keys, and at shutdown. A failed write
//   loses those counts and never touches a request.
// - Without LECTERN_V1_SUNSET the responses are byte for byte what they were.
// - /api/auth/ and /api/admin/ are never closed: the v2 web app and admin console use them.

import { config } from "@lectern/config";
import { db } from "./db.ts";
import { logger } from "./log.ts";

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 3600_000; // Asia/Seoul has no daylight saving time
const FLUSH_EVERY_MS = 30_000;
const MAX_PENDING_KEYS = 500;
const KEEP_DAYS = 400;
const MAX_ROUTE_LENGTH = 120;

/** API v1: under /api/ but not v2 and not the health check (which monitors poll). */
export function isV1ApiPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (pathname === "/api/v2" || pathname.startsWith("/api/v2/")) return false;
  return pathname !== "/api/health";
}

/** The v1 paths LECTERN_V1_BLOCK closes after the sunset date. */
export function isRetiredV1Path(pathname: string): boolean {
  const RETIRED = ["/api/lectures", "/api/ingest/", "/api/events", "/api/clients/"];
  return RETIRED.some((prefix) => (prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

const ID_LIKE = (segment: string) => segment.length >= 16 || /^\d+$/.test(segment) || /^[0-9a-f-]{8,}$/.test(segment);

/** `"<METHOD> <path>"` with id-like segments as `:id` and no query, at most 120 characters. */
export function normalizeV1Route(method: string, pathname: string): string {
  const path = pathname.split("?")[0]!;
  const normalized = path
    .split("/")
    .map((segment) => (segment && ID_LIKE(segment) ? ":id" : segment))
    .join("/");
  return `${method.toUpperCase()} ${normalized}`.slice(0, MAX_ROUTE_LENGTH);
}

/** Which kind of client sent a request: its X-Client, else a guess from the User-Agent. */
export function classifyV1Client(headers: Headers): string {
  const declared = headers.get("x-client")?.toLowerCase();
  if (declared && /^[a-z0-9-]{1,32}$/.test(declared)) return declared;
  const ua = headers.get("user-agent");
  if (ua === null) return "no-ua";
  if (ua.includes("LecternMenuBar")) return "macos";
  if (ua.includes("Shortcuts") || ua.includes("WorkflowKit")) return "shortcuts";
  if (ua.includes("Dalvik") || ua.includes("okhttp")) return "android";
  if (ua.includes("CFNetwork")) return "apple-other";
  if (ua.startsWith("Mozilla/")) return "browser";
  return "other";
}

/** `YYYY-MM-DD` in Asia/Seoul. */
export function seoulDay(now = Date.now()): string {
  return new Date(now + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

interface Pending {
  day: string;
  route: string;
  client: string;
  count: number;
}

const pending = new Map<string, Pending>();
let timer: ReturnType<typeof setInterval> | null = null;

type Writer = (rows: Pending[]) => void;

const writeRows: Writer = (rows) => {
  const upsert = db.query(
    `INSERT INTO v1_usage (day, route, client, count) VALUES (?, ?, ?, ?)
     ON CONFLICT (day, route, client) DO UPDATE SET count = count + excluded.count`
  );
  db.transaction(() => {
    for (const r of rows) upsert.run(r.day, r.route, r.client, r.count);
  })();
};
let writer: Writer = writeRows;

/** Tests: a writer that fails (null: the real one). */
export function setV1UsageWriterForTests(next: Writer | null): void {
  writer = next ?? writeRows;
}

/** One v1 call, counted in memory. Never throws. */
export function recordV1Usage(route: string, client: string, now = Date.now()): void {
  try {
    const day = seoulDay(now);
    const key = `${day}\u0000${route}\u0000${client}`;
    const entry = pending.get(key);
    if (entry) entry.count += 1;
    else pending.set(key, { day, route, client, count: 1 });
    if (pending.size > MAX_PENDING_KEYS) flushV1Usage();
    else if (!timer) {
      timer = setInterval(flushV1Usage, FLUSH_EVERY_MS);
      timer.unref?.();
    }
  } catch (err) {
    logger.warn("could not count a v1 call", { err });
  }
}

/** Writes the counts gathered so far in one transaction. Never throws. */
export function flushV1Usage(): void {
  if (pending.size === 0) return;
  const rows = [...pending.values()];
  pending.clear();
  try {
    writer(rows);
  } catch (err) {
    logger.warn("could not write v1 usage", { rows: rows.length, err });
  }
}

/** 00:00 Asia/Seoul of the sunset date, or null without one. */
function sunsetMs(): number | null {
  const sunset = config().v1.sunset;
  if (!sunset) return null;
  const [y, m, d] = sunset.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) - SEOUL_OFFSET_MS;
}

/** Deprecation, Sunset (RFC 8594, an HTTP date) and the successor link; {} without a date. */
export function v1Headers(_now = Date.now()): Record<string, string> {
  const at = sunsetMs();
  if (at === null) return {};
  return {
    Deprecation: "true",
    Sunset: new Date(at).toUTCString(),
    Link: '</api/v2/openapi.json>; rel="successor-version"',
  };
}

/** True once the operator closed the retired paths and the sunset date has come. */
export function v1Blocked(pathname: string, now = Date.now()): boolean {
  if (!config().v1.block) return false;
  const at = sunsetMs();
  return at !== null && now >= at && isRetiredV1Path(pathname);
}

/** Drops counts older than 400 days (maintenance). */
export function pruneV1Usage(now = Date.now()): number {
  return db.query(`DELETE FROM v1_usage WHERE day < ?`).run(seoulDay(now - KEEP_DAYS * DAY_MS)).changes;
}

export const V1_GONE_MESSAGE = "이 API는 종료되었습니다. 앱을 최신 버전으로 업데이트해 주세요.";

/**
 * The legacy router wrapped for v1: closed paths answer 410, the rest get the sunset
 * headers (when a date is set), and every call is counted. Streams pass through untouched.
 */
export async function serveV1(req: Request, legacy: (req: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(req.url);
  if (!isV1ApiPath(url.pathname)) return legacy(req);
  const count = () => recordV1Usage(normalizeV1Route(req.method, url.pathname), classifyV1Client(req.headers));
  if (v1Blocked(url.pathname)) {
    count();
    return new Response(JSON.stringify({ error: V1_GONE_MESSAGE, code: "v1_gone" }), {
      status: 410,
      headers: { "Content-Type": "application/json; charset=utf-8", ...v1Headers() },
    });
  }
  const res = await legacy(req);
  count();
  const headers = v1Headers();
  if (Object.keys(headers).length === 0) return res;
  try {
    for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
    return res;
  } catch {
    // Immutable headers (a fetched or redirect response): same body and status, new headers.
    const copy = new Headers(res.headers);
    for (const [name, value] of Object.entries(headers)) copy.set(name, value);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: copy });
  }
}
