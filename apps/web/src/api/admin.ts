// The admin console's API (P5-12, P5-16): the v1 `/api/admin/*` routes the old console uses,
// the v1 lecture routes it sends its lecture actions to (an operator counts as every
// lecture's owner there), and the v2 `admin`-tagged routes. The v1 shapes below are read
// from the server, not made up: `GET /api/admin/overview` and `/api/admin/lectures` in
// apps/server/src/index.ts, `listUsersCrmSummary` (UserCrmRow) and `SystemSettings` in db.ts,
// the DTOs in admin-api.ts. Only the fields the screens use are listed (a lecture's share
// token is dropped on parse). v1 has no `GET /api/admin/users`: the user list is the
// overview's `users`. Cookie auth, like the old console; it sends no other header.

import { z } from "zod";
import { ApiClientError } from "./client.ts";
import type { JobDetail, JobKind, JobPage, JobState, UsageLedgerPage, WorkspaceQuota } from "./types.ts";

export const AdminUserRole = z.enum(["owner", "admin", "member", "viewer"]);
export const AdminUserStatus = z.enum(["active", "pending", "suspended"]);

/** Old rows can hold NULL where the DTO type says string or number. */
const text = z.string().nullish().transform((v) => v ?? "");
const count = z.number().nullish().transform((v) => v ?? 0);

const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  is_admin: z.boolean(),
  role: AdminUserRole,
  status: AdminUserStatus,
  can_ingest: z.boolean(),
  can_share: z.boolean(),
  can_use_server_key: z.boolean(),
  memo: text,
  public_count: count,
  quota_mb: z.number(),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
  lecture_count: z.number(),
  error_count: z.number(),
  audio_bytes: z.number(),
  session_count: z.number(),
});

export const AdminOverviewSchema = z.object({
  metrics: z.object({
    totalUsers: z.number(),
    activeUsers: z.number(),
    pendingUsers: z.number(),
    suspendedUsers: z.number(),
    totalLectures: z.number(),
    publicLectures: z.number(),
    errorLectures: z.number(),
    totalAudioBytes: z.number(),
  }),
  /** SystemSettings; P5-16 reads the new-account defaults only. */
  settings: z
    .object({
      default_user_role: z.enum(["member", "viewer"]).catch("member"),
      default_can_use_server_key: z.boolean().catch(true),
      default_quota_mb: z.number().catch(2048),
    })
    .nullish()
    .transform((v) => v ?? { default_user_role: "member" as const, default_can_use_server_key: true, default_quota_mb: 2048 }),
  users: z.array(AdminUserSchema),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

/** `PATCH /api/admin/users/:id` (v1, camelCase): the server keeps every key not sent. */
export interface AdminUserPatch {
  displayName?: string;
  role?: AdminUser["role"];
  status?: AdminUser["status"];
  canIngest?: boolean;
  canShare?: boolean;
  canUseServerKey?: boolean;
  quotaMb?: number;
  memo?: string;
  /** Only when a new one was typed (6 characters or more). */
  newPassword?: string;
  revokeSessions?: boolean;
}

/** `POST /api/admin/users` (v1, camelCase). */
export interface AdminNewUser {
  email: string;
  displayName: string;
  password: string;
  role: AdminUser["role"];
  status: "active" | "pending";
  canIngest: boolean;
  canShare: boolean;
  canUseServerKey: boolean;
  quotaMb: number;
  memo: string;
}

export const LectureStatus = z.enum(["processing", "done", "error"]);

const AdminLectureSchema = z.object({
  id: z.string(),
  title: text,
  course: text,
  date_label: text,
  status: LectureStatus,
  stage: text,
  stage_message: text,
  progress: count,
  excerpt: text,
  duration_sec: count,
  audio_size: count,
  model_used: text,
  has_audio: z.boolean(),
  is_public: z.boolean(),
  created_at: z.string(),
  updated_at: text,
  owner_id: z.string(),
  owner_email: text,
  owner_name: text,
  audio_ext: text,
  compacted: z.boolean(),
  audio_original_size: count,
  error_message: z.string().nullish().transform((v) => v ?? null),
  source_client: text,
  job_state: z.enum(["queued", "running"]).nullish().transform((v) => v ?? null),
  // The server types this "distill" | "compact", but it is the queue's own kind, so any job
  // the lecture has comes through (a v2 "index" job, for one).
  job_kind: z.string().nullish().transform((v) => v ?? null),
});

export const AdminLecturePageSchema = z.object({
  total: z.number(),
  counts: z.object({ all: z.number(), processing: z.number(), error: z.number(), done: z.number() }),
  limit: z.number(),
  offset: z.number(),
  lectures: z.array(AdminLectureSchema),
});

const AdminLectureDetailSchema = AdminLectureSchema.extend({
  model_requested: text,
  audio_mime: z.string().nullish().transform((v) => v ?? null),
  audio_compact_state: z.enum(["compacted", "skipped"]).nullish().transform((v) => v ?? null),
  audio_compacted_at: z.string().nullish().transform((v) => v ?? null),
  markdown_chars: count,
  archived: z.boolean(),
  audio_in_uploads: z.boolean(),
});

export type AdminLecture = z.infer<typeof AdminLectureSchema>;
export type AdminLecturePage = z.infer<typeof AdminLecturePageSchema>;
export type AdminLectureDetail = z.infer<typeof AdminLectureDetailSchema>;

export interface AdminLecturesQuery {
  status?: z.infer<typeof LectureStatus>;
  q?: string;
  owner?: string;
  limit?: number;
  offset?: number;
}

export interface AdminJobsQuery {
  state?: JobState;
  kind?: JobKind;
  cursor?: string;
  limit?: number;
}

export interface AdminApi {
  /** GET /api/admin/overview */
  overview(): Promise<AdminOverview>;
  /** The overview's `users` (there is no GET /api/admin/users). */
  users(): Promise<AdminUser[]>;
  /** PATCH /api/admin/users/:id, as the old console sends it. */
  updateUser(id: string, patch: AdminUserPatch): Promise<void>;
  /** POST /api/admin/users; resolves to the new account's id. */
  createUser(body: AdminNewUser): Promise<string>;
  /** DELETE /api/admin/users/:id: the account and every lecture it owns. */
  deleteUser(id: string): Promise<void>;
  /** GET /api/v2/admin/jobs */
  jobs(q: AdminJobsQuery): Promise<JobPage>;
  /** GET /api/v2/admin/jobs/{id}: stage timeline and model calls. */
  job(id: string): Promise<JobDetail>;
  /** POST /api/v2/admin/jobs/{id}/retry */
  retryJob(id: string): Promise<void>;
  /** GET /api/v2/admin/usage */
  usage(period?: string): Promise<UsageLedgerPage>;
  /** PUT /api/v2/admin/workspaces/{id}/quota. Three nulls remove the limits. */
  setQuota(workspaceId: string, q: WorkspaceQuota): Promise<WorkspaceQuota>;
  /** GET /api/admin/lectures: every account's lectures, newest first. */
  lectures(q: AdminLecturesQuery): Promise<AdminLecturePage>;
  /** GET /api/admin/lectures/:id: everything but the note. */
  lecture(id: string): Promise<AdminLectureDetail>;
  /** POST /api/lectures/:id/retry (409: already being processed). */
  retryLecture(id: string): Promise<void>;
  /** POST /api/admin/storage/compact { ids }: queues the ones that can be compacted. */
  compactLectures(ids: string[]): Promise<{ queued: number; estimatedSavedBytes: number }>;
  /** DELETE /api/lectures/:id/audio: the audio only; the note stays. */
  deleteLectureAudio(id: string): Promise<{ reclaimedBytes: number }>;
  /** DELETE /api/lectures/:id: the note and the audio. */
  deleteLecture(id: string): Promise<void>;
}

/** What the HTTP client lends the admin API: its v2 `call` and a v1 JSON request. */
export interface AdminTransport {
  call<T>(operationId: string, input?: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }): Promise<T>;
  /** A v1 request; resolves to the JSON body, throws ApiClientError on a non-2xx answer. */
  v1(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown>;
}

/** A v1 answer that does not have the shape read from the server is an error like any other. */
function read<S extends z.ZodType>(schema: S, data: unknown, what: string): z.output<S> {
  const got = schema.safeParse(data);
  if (got.success) return got.data;
  throw new ApiClientError(200, "invalid_response", "서버 응답 형식이 올바르지 않습니다.", null, {
    what,
    issues: got.error.issues.slice(0, 5).map((i) => i.path.join(".")),
  });
}

export function createAdminApi(t: AdminTransport): AdminApi {
  const overview = async () => read(AdminOverviewSchema, await t.v1("GET", "/api/admin/overview"), "overview");
  return {
    overview,
    users: async () => (await overview()).users,
    updateUser: async (id, patch) => {
      await t.v1("PATCH", `/api/admin/users/${encodeURIComponent(id)}`, patch);
    },
    deleteUser: async (id) => {
      await t.v1("DELETE", `/api/admin/users/${encodeURIComponent(id)}`);
    },
    createUser: async (body) => read(z.object({ user: z.object({ id: z.string() }) }), await t.v1("POST", "/api/admin/users", body), "new user").user.id,
    jobs: (q) =>
      t.call("adminListJobs", {
        query: { state: q.state, kind: q.kind, cursor: q.cursor, limit: q.limit },
      }),
    job: (id) => t.call("adminGetJob", { params: { job_id: id } }),
    retryJob: async (id) => {
      await t.call("adminRetryJob", { params: { job_id: id } });
    },
    usage: (period) => t.call("adminListUsage", { query: { period } }),
    setQuota: (workspaceId, q) => t.call("adminSetQuota", { params: { workspace_id: workspaceId }, body: q }),
    lectures: async (q) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") qs.set(k, String(v));
      const query = qs.toString();
      return read(AdminLecturePageSchema, await t.v1("GET", `/api/admin/lectures${query ? `?${query}` : ""}`), "lectures");
    },
    lecture: async (id) => {
      const body = read(z.object({ lecture: AdminLectureDetailSchema }), await t.v1("GET", `/api/admin/lectures/${encodeURIComponent(id)}`), "lecture");
      return body.lecture;
    },
    retryLecture: async (id) => {
      await t.v1("POST", `/api/lectures/${encodeURIComponent(id)}/retry`);
    },
    compactLectures: async (ids) => {
      const body = read(z.object({ queued: count, estimatedSavedBytes: count }), await t.v1("POST", "/api/admin/storage/compact", { ids }), "compact");
      return body;
    },
    deleteLectureAudio: async (id) => {
      const body = read(z.object({ reclaimedBytes: count }), await t.v1("DELETE", `/api/lectures/${encodeURIComponent(id)}/audio`), "delete audio");
      return body;
    },
    deleteLecture: async (id) => {
      await t.v1("DELETE", `/api/lectures/${encodeURIComponent(id)}`);
    },
  };
}
