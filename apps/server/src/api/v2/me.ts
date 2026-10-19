import { isAdminUser } from "../../auth.ts";
import type { UserRecord } from "../../db.ts";
import { defineRouter, notImplemented, ok, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

/** The caller's v1 operator role, so /me agrees with what /admin/* lets them do. */
function systemRoleOf(user: UserRecord | null) {
  if (isAdminUser(user)) return user!.role === "owner" ? "owner" : "admin";
  return user?.role === "viewer" ? "viewer" : "member";
}

export const meRouter = defineRouter({
  getMe: (req) => ok(req, { ...F.me, system_role: systemRoleOf(req.user) }),
  updateMe: notImplemented,
  listDevices: (req) => okPage(req, F.devices),
  revokeDevice: notImplemented,
  listAccessTokens: (req) => okPage(req, F.accessTokens),
  createAccessToken: notImplemented,
  revokeAccessToken: notImplemented,
});
