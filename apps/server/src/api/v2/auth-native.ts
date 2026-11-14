// Native app sign-in (P5-03, CONTRACTS D-P5-4): access/refresh token pairs for the Apple,
// Android and Windows apps. Both routes are public (no session). A password sign-in counts
// against the same kind of limits as the web login and refuses the same accounts.

import { randomBytes } from "node:crypto";
import { config } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import type { NativeTokenRequest, RevokeNativeTokenRequest } from "@lectern/domain";
import { getUserByEmail, getUserById, hashPassword, touchUserLastLogin, verifyPassword, type UserRecord } from "../../db.ts";
import { issueNativePair, revokeNativeFamilyByRefresh, rotateNativePair, type NativePair } from "../../native-auth.ts";
import { authRateLimits, firstRateLimitWait, getClientIp, recordRateLimitHits, tooManyRequestsMessage, type RateLimitCheck } from "../../rate-limit.ts";
import { apiError, defineRouter, ok, type V2Request } from "./common.ts";
import { meDto } from "./rows.ts";

// Compared against when the account does not exist, so an unknown email takes as long as a
// wrong password (as in the web login).
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString("hex"));
const BAD_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다.";
const SIGN_IN_AGAIN = "다시 로그인해 주세요.";

/** Why an existing account may not sign in, as the web login words it; null when it may. */
function refusal(user: UserRecord): string | null {
  if (user.status === "suspended") return "이용이 정지된 계정입니다. 관리자에게 문의하세요.";
  if (user.status === "pending") return "관리자 가입 승인 대기 중인 계정입니다.";
  return null;
}

function pairResponse(req: V2Request, pair: NativePair, user: UserRecord): Response {
  return ok(req, {
    token_type: "Bearer",
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    expires_in: pair.expiresIn,
    user: meDto(user, personalWorkspaceId(user.id)),
  });
}

function passwordGrant(req: V2Request, body: Extract<NativeTokenRequest, { grant_type: "password" }>): Response {
  let email = body.email.trim().toLowerCase();
  const { aliases: ownerAliases, email: ownerEmail } = config().owner;
  if (ownerEmail && ownerAliases.includes(email)) email = ownerEmail;
  const checks: RateLimitCheck[] = [
    [authRateLimits.nativeIp, getClientIp(req.c.req.raw)],
    [authRateLimits.nativeEmail, email],
  ];
  const wait = firstRateLimitWait(checks);
  if (wait) {
    const res = apiError(req.c, 429, "rate_limited", tooManyRequestsMessage(wait));
    res.headers.set("Retry-After", String(wait));
    return res;
  }

  const user = getUserByEmail(email);
  const passwordOk = verifyPassword(body.password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    recordRateLimitHits(checks);
    return apiError(req.c, 401, "unauthorized", BAD_CREDENTIALS);
  }
  const refused = refusal(user);
  if (refused) return apiError(req.c, 403, "forbidden", refused);

  touchUserLastLogin(user.id);
  const pair = issueNativePair({ userId: user.id, deviceName: body.device_name, platform: body.platform });
  return pairResponse(req, pair, getUserById(user.id) ?? user);
}

function refreshGrant(req: V2Request, refreshToken: string): Response {
  // Which of unknown, reused or expired is not told: each is "sign in again".
  const rotated = rotateNativePair(refreshToken);
  if ("error" in rotated) return apiError(req.c, 401, "unauthorized", SIGN_IN_AGAIN);
  const user = getUserById(rotated.userId);
  if (!user || refusal(user)) {
    revokeNativeFamilyByRefresh(rotated.pair.refreshToken);
    return apiError(req.c, 401, "unauthorized", SIGN_IN_AGAIN);
  }
  return pairResponse(req, rotated.pair, user);
}

export const authNativeRouter = defineRouter({
  issueNativeToken: (req) => {
    const body = req.body as NativeTokenRequest;
    return body.grant_type === "password" ? passwordGrant(req, body) : refreshGrant(req, body.refresh_token);
  },
  // Always 204, known token or not.
  revokeNativeToken: (req) => {
    revokeNativeFamilyByRefresh((req.body as RevokeNativeTokenRequest).refresh_token);
    return req.c.body(null, 204);
  },
});
