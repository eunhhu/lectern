// Per-client and per-email attempt limits for sign-in, sign-up codes, password resets and
// native sign-in (moved out of index.ts in P5-03 so API v2 routes share the same counters).

import { config } from "@lectern/config";
import { logger } from "./log.ts";

// The server only listens on 127.0.0.1 behind a reverse proxy, and each trusted proxy
// appends the address it accepted the connection from to X-Forwarded-For. Entries to the
// left of those are whatever the client sent and cannot be trusted.
const TRUSTED_PROXY_HOPS = config().trustedProxyHops;

let warnedMissingForwardedFor = false;

/**
 * The client address reported by the trusted proxy, or null when there is none. Callers
 * then skip per-IP limits (per-email limits still apply) rather than lumping every client
 * into one shared bucket that a single abuser could exhaust for everyone.
 */
export function getClientIp(req: Request): string | null {
  if (TRUSTED_PROXY_HOPS === 0) return null;
  const hops = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length > 0) {
    return hops[Math.max(0, hops.length - TRUSTED_PROXY_HOPS)];
  }
  if (!warnedMissingForwardedFor) {
    warnedMissingForwardedFor = true;
    logger.warn(
      "no X-Forwarded-For on an auth request: per-IP rate limits are inactive until the proxy sets it"
    );
  }
  return null;
}

/** In-memory fixed-window counter; fine for this single-process server. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private static readonly MAX_KEYS = 50_000;

  constructor(readonly limit: number, readonly windowMs: number) {}

  /** Seconds until `key` may try again, or 0 when it is under the limit. */
  retryAfterSec(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now || w.count < this.limit) return 0;
    return Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  }

  hit(key: string, now = Date.now()): void {
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= RateLimiter.MAX_KEYS) this.prune(now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
  }

  clear(): void {
    this.windows.clear();
  }

  private prune(now: number): void {
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(key);
    }
    // Still full of live windows: drop the oldest so memory stays bounded.
    for (const key of this.windows.keys()) {
      if (this.windows.size < RateLimiter.MAX_KEYS) break;
      this.windows.delete(key);
    }
  }
}

const MINUTE_MS = 60_000;
export const authRateLimits = {
  // Failed password attempts only, so normal sign-ins on many devices never trip it.
  loginEmail: new RateLimiter(10, 15 * MINUTE_MS),
  loginIp: new RateLimiter(30, 15 * MINUTE_MS),
  // Every send-code request: each one mails a code.
  sendCodeEmail: new RateLimiter(5, 15 * MINUTE_MS),
  sendCodeIp: new RateLimiter(20, 60 * MINUTE_MS),
  resetEmail: new RateLimiter(10, 15 * MINUTE_MS),
  resetIp: new RateLimiter(30, 15 * MINUTE_MS),
  // Native app password sign-in (P5-03): the same numbers as the web login.
  nativeEmail: new RateLimiter(10, 15 * MINUTE_MS),
  nativeIp: new RateLimiter(30, 15 * MINUTE_MS),
  // Accepting a workspace invitation (P5-06), per signed-in user: tokens are not guessable,
  // and this keeps anyone from trying.
  inviteAcceptUser: new RateLimiter(10, 15 * MINUTE_MS),
};

export function resetAuthRateLimits(): void {
  for (const limiter of Object.values(authRateLimits)) limiter.clear();
}

// A null key (no known client IP) is skipped.
export type RateLimitCheck = [RateLimiter, string | null];

export function firstRateLimitWait(checks: RateLimitCheck[]): number {
  for (const [limiter, key] of checks) {
    if (key === null) continue;
    const wait = limiter.retryAfterSec(key);
    if (wait > 0) return wait;
  }
  return 0;
}

export function recordRateLimitHits(checks: RateLimitCheck[]): void {
  for (const [limiter, key] of checks) {
    if (key !== null) limiter.hit(key);
  }
}

/** The 429 text shown to people: how many minutes to wait. */
export function tooManyRequestsMessage(retryAfterSec: number): string {
  return `요청이 너무 많습니다. ${Math.ceil(retryAfterSec / 60)}분 후 다시 시도해주세요.`;
}
