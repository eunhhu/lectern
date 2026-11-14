// The admin console's API (P5-12): the v1 `/api/admin/*` routes the old console uses and
// the v2 `admin`-tagged routes. The v1 shapes below are read from the server, not made up:
// `GET /api/admin/overview` in apps/server/src/index.ts and `listUsersCrmSummary` (UserCrmRow)
// in db.ts. Only the fields the screens use are listed. v1 has no `GET /api/admin/users`:
// the user list is the overview's `users`. Cookie auth, like the old console; it sends no
// other header.

import { z } from "zod";
import type { JobDetail, JobKind, JobPage, JobState, UsageLedgerPage, WorkspaceQuota } from "./types.ts";

export const AdminUserRole = z.enum(["owner", "admin", "member", "viewer"]);
export const AdminUserStatus = z.enum(["active", "pending", "suspended"]);

const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  is_admin: z.boolean(),
  role: AdminUserRole,
  status: AdminUserStatus,
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
  users: z.array(AdminUserSchema),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

/** The parts of `PATCH /api/admin/users/:id` (v1, camelCase) this console sends. */
export interface AdminUserPatch {
  role?: AdminUser["role"];
  status?: AdminUser["status"];
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
}

/** What the HTTP client lends the admin API: its v2 `call` and a v1 JSON request. */
export interface AdminTransport {
  call<T>(operationId: string, input?: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }): Promise<T>;
  /** A v1 request; resolves to the JSON body, throws ApiClientError on a non-2xx answer. */
  v1(method: "GET" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown>;
}

export function createAdminApi(t: AdminTransport): AdminApi {
  const overview = async () => AdminOverviewSchema.parse(await t.v1("GET", "/api/admin/overview"));
  return {
    overview,
    users: async () => (await overview()).users,
    updateUser: async (id, patch) => {
      await t.v1("PATCH", `/api/admin/users/${encodeURIComponent(id)}`, patch);
    },
    deleteUser: async (id) => {
      await t.v1("DELETE", `/api/admin/users/${encodeURIComponent(id)}`);
    },
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
  };
}
