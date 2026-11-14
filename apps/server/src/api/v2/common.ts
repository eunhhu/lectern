// Plumbing shared by the /api/v2 resource routers. Every route is mounted from its
// packages/domain RouteDef, so method, path, request schemas and response schemas live in
// one place (packages/domain/src/api/routes.ts). A request goes through, in order:
//   authentication (401) -> operator check for admin routes (403)
//   -> params/query/headers/body validation (400, or 428 for a missing If-Match)
//   -> the handler, whose JSON is parsed with the route's response schema before it is sent.

import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import {
  ApiError,
  HEADER,
  DEFAULT_PAGE_LIMIT,
  ROUTES_BY_OPERATION,
  toHonoPath,
  type ErrorCode,
  type RouteDef,
  type ValidationErrorDetails,
} from "@lectern/domain";
import type { PatRow } from "../../access-tokens.ts";
import { isAdminUser } from "../../auth.ts";
import type { UserRecord } from "../../db.ts";
import { authenticateV2 } from "./authn.ts";

export type V2Env = { Variables: { requestId: string; user: UserRecord | null } };
export type V2Context = Context<V2Env>;

/** A validated request. Values are the parsed (coerced, stripped) schema outputs. */
export interface V2Request {
  c: V2Context;
  route: RouteDef;
  user: UserRecord | null;
  /** Set when the request came with a personal access token (P5-02): its workspace and scopes bind the request. */
  pat?: PatRow;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  /** Parsed JSON body; undefined for routes without a JSON body. */
  body: unknown;
}

export type Handler = (req: V2Request) => Response | Promise<Response>;

export function apiError(
  c: Context,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): Response {
  const body = ApiError.parse({ error: { code, message, ...(details ? { details } : {}) } });
  return c.json(body, status as ContentfulStatusCode);
}

/** Answers with the route's response schema for `status` (default: its only 2xx). */
export function ok(
  req: V2Request,
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  const status = init.status ?? defaultSuccessStatus(req.route);
  const schema = req.route.responses[status]?.schema;
  if (!schema) throw new Error(`${req.route.operationId}: no JSON schema for status ${status}`);
  return req.c.json(schema.parse(data), status as ContentfulStatusCode, init.headers);
}

function defaultSuccessStatus(route: RouteDef): number {
  const statuses = Object.keys(route.responses).map(Number).filter((s) => s >= 200 && s < 300);
  return Math.min(...statuses);
}

/** P0 stub for every write and upload route (packages/domain README "Errors"). */
export const notImplemented: Handler = (req) =>
  apiError(req.c, 501, "not_implemented", "아직 제공하지 않는 API입니다.", {
    operation_id: req.route.operationId,
  });

export function notFound(req: V2Request, what: string): Response {
  return apiError(req.c, 404, "not_found", `${what}을(를) 찾을 수 없습니다.`);
}

export function forbidden(req: V2Request): Response {
  return apiError(req.c, 403, "forbidden", "이 워크스페이스에 접근할 권한이 없습니다.");
}

// ---------------------------------------------------------------------------
// Cursor pagination over an in-memory list
// ---------------------------------------------------------------------------

function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString("base64url");
}

function decodeCursor(cursor: string): number | null {
  const match = /^o:(\d{1,9})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match ? Number(match[1]) : null;
}

/** `{ items, next_cursor }` for one page of `items`, or an error response for a bad cursor. */
export function page<T>(req: V2Request, items: readonly T[]): { items: T[]; next_cursor: string | null } | Response {
  const { cursor, limit } = req.query as { cursor?: string; limit?: number };
  const offset = cursor === undefined ? 0 : decodeCursor(cursor);
  if (offset === null) return apiError(req.c, 400, "bad_request", "cursor 값이 올바르지 않습니다.");
  const end = offset + (limit ?? DEFAULT_PAGE_LIMIT); // PageQuery already caps limit
  return { items: items.slice(offset, end), next_cursor: end < items.length ? encodeCursor(end) : null };
}

/** The offset and size of the requested page, or the 400 response for a bad cursor. */
export function pageBounds(req: V2Request): { offset: number; limit: number } | Response {
  const { cursor, limit } = req.query as { cursor?: string; limit?: number };
  const offset = cursor === undefined ? 0 : decodeCursor(cursor);
  if (offset === null) return apiError(req.c, 400, "bad_request", "cursor 값이 올바르지 않습니다.");
  return { offset, limit: limit ?? DEFAULT_PAGE_LIMIT };
}

/** A page from rows fetched with `LIMIT limit + 1 OFFSET offset` (the extra row means "more"). */
export function pageFrom<T>(rows: readonly T[], bounds: { offset: number; limit: number }): { items: T[]; next_cursor: string | null } {
  const more = rows.length > bounds.limit;
  return { items: rows.slice(0, bounds.limit), next_cursor: more ? encodeCursor(bounds.offset + bounds.limit) : null };
}

/** `page()` answered with the route's response schema. */
export function okPage<T>(req: V2Request, items: readonly T[]): Response {
  const result = page(req, items);
  return result instanceof Response ? result : ok(req, result);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Issue = ValidationErrorDetails["issues"][number];

function validate(
  schema: z.ZodType | undefined,
  value: unknown,
  where: string,
  issues: Issue[]
): Record<string, unknown> {
  if (!schema) return {};
  const result = schema.safeParse(value);
  if (result.success) return result.data as Record<string, unknown>;
  for (const issue of result.error.issues) {
    issues.push({
      path: [where, ...issue.path.map((key) => (typeof key === "number" ? key : String(key)))],
      message: issue.message,
    });
  }
  return {};
}

async function parseRequest(c: V2Context, route: RouteDef): Promise<Omit<V2Request, "c" | "route" | "user" | "pat"> | Response> {
  const issues: Issue[] = [];
  const params = validate(route.params, c.req.param(), "params", issues);
  const query = validate(route.query, c.req.query(), "query", issues);

  let headers: Record<string, unknown> = {};
  if (route.headers) {
    const raw: Record<string, string> = {};
    for (const name of Object.keys(route.headers.shape)) {
      const value = c.req.header(name);
      if (value !== undefined) raw[name] = value;
    }
    const ifMatch = route.headers.shape[HEADER.ifMatch] as z.ZodType | undefined;
    if (ifMatch && raw[HEADER.ifMatch] === undefined && !ifMatch.safeParse(undefined).success) {
      return apiError(c, 428, "precondition_required", "If-Match 헤더에 문서 버전을 보내야 합니다.");
    }
    headers = validate(route.headers, raw, "headers", issues);
  }

  let body: unknown;
  if (route.body && "schema" in route.body) {
    // Requiring the JSON media type also keeps cross-site HTML forms (text/plain,
    // urlencoded) from reaching cookie-authenticated mutations.
    const contentType = (c.req.header("content-type") || "").split(";")[0]!.trim().toLowerCase();
    if (contentType !== "application/json") {
      return apiError(c, 400, "bad_request", "요청 본문은 application/json이어야 합니다.");
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "bad_request", "요청 본문이 올바른 JSON이 아닙니다.");
    }
    body = validate(route.body.schema, json, "body", issues);
  }

  if (issues.length) {
    return apiError(c, 400, "validation_failed", "요청 값이 올바르지 않습니다.", { issues });
  }
  return { params, query, headers, body };
}

// ---------------------------------------------------------------------------
// Personal access tokens (P5-02, D-P5-3)
// ---------------------------------------------------------------------------

// Account, sign-in and operator routes, and the ones that hand data or access to others,
// stay with the signed-in user: a token made for a script cannot reach them.
const PAT_CLOSED_TAGS = new Set(["me", "admin", "auth"]);
const PAT_OPEN_IN_CLOSED_TAGS = new Set(["getMe"]);
const PAT_CLOSED_OPERATIONS = new Set(["createShareLink", "updateShareLink", "revokeShareLink", "startGoogleIntegration", "disconnectIntegration"]);

/** Why a personal access token may not make this call, or null when it may. */
function patDenial(route: RouteDef, method: string, pat: PatRow): string | null {
  const closed = (PAT_CLOSED_TAGS.has(route.tag) && !PAT_OPEN_IN_CLOSED_TAGS.has(route.operationId)) || PAT_CLOSED_OPERATIONS.has(route.operationId);
  if (closed) return "개인 액세스 토큰으로는 이 작업을 할 수 없습니다.";
  const needed = method === "GET" || method === "HEAD" ? "recordings:read" : "recordings:write";
  if (!pat.scopes.includes(needed)) return "이 토큰에는 필요한 권한이 없습니다.";
  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * A Hono router serving the given operations, each at its RouteDef's method and path
 * (relative to /api/v2). Mount it with `app.route("/", router)`.
 */
export function defineRouter(handlers: Record<string, Handler>): Hono<V2Env> {
  const router = new Hono<V2Env>();
  for (const [operationId, handler] of Object.entries(handlers)) {
    const route = ROUTES_BY_OPERATION[operationId];
    if (!route) throw new Error(`unknown API v2 operation: ${operationId}`);
    router.on(route.method.toUpperCase(), toHonoPath(route.path), async (c) => {
      const auth = authenticateV2(c.req.raw);
      const user = auth?.user ?? null;
      if (!user && !route.public) return apiError(c, 401, "unauthorized", "로그인이 필요합니다.");
      const pat = auth?.pat;
      if (pat) {
        const denial = patDenial(route, c.req.method.toUpperCase(), pat);
        if (denial) return apiError(c, 403, "forbidden", denial);
      }
      if (route.tag === "admin" && !isAdminUser(user)) {
        return apiError(c, 403, "forbidden", "운영자만 사용할 수 있습니다.");
      }
      c.set("user", user);
      const input = await parseRequest(c, route);
      if (input instanceof Response) return input;
      return handler({ c, route, user, ...(pat ? { pat } : {}), ...input });
    });
  }
  return router;
}
