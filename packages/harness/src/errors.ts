// Failure classes (AI_HARNESS §4.5; @lectern/domain FailureClass, plus "canceled", which the
// domain models as a StageRunState). The runner decides what to do from the class alone:
//
// | kind              | e.g.                                          | runner                               |
// |-------------------|-----------------------------------------------|--------------------------------------|
// | transient         | network, timeout, 408, 429, 5xx               | backoff + jitter, retry-after, max N |
// | input             | corrupt/silent audio, unsupported format, 4xx | fail now, tell the user              |
// | output_validation | schema violation, missing evidence            | repair attempt(s), then fail         |
// | config            | missing key, 401/403, quota                   | fail now (admin problem)             |
// | budget            | job budget spent                              | stop remaining stages                |
// | canceled          | user cancel, subject deleted                  | stop, no retry                       |

import type { FailureClass } from "@lectern/domain";

export type ErrorKind = FailureClass | "canceled";

export class HarnessError extends Error {
  readonly kind: ErrorKind;
  /** Provider-requested delay before the next attempt (429 retry-after). */
  readonly retryAfterMs?: number;

  constructor(kind: ErrorKind, message: string, options: { cause?: unknown; retryAfterMs?: number } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HarnessError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Class of an HTTP status from a provider. */
export function classifyHttpStatus(status: number): ErrorKind {
  if (status === 408 || status === 429 || status >= 500) return "transient";
  if (status === 401 || status === 403) return "config";
  return "input";
}

function messageOf(err: unknown): string {
  return String((err as { message?: unknown })?.message ?? err ?? "");
}

/**
 * Default classifier for errors a stage throws. Keeps the original message (users see it)
 * and attaches the original error as `cause`. Unknown errors count as transient: network
 * failures surface as plain TypeErrors and are worth another attempt.
 */
export function classifyError(err: unknown): HarnessError {
  if (err instanceof HarnessError) return err;
  const message = messageOf(err);
  const name = (err as { name?: unknown })?.name;
  if (name === "AbortError") return new HarnessError("canceled", message, { cause: err });
  if (name === "TimeoutError") return new HarnessError("transient", message, { cause: err });
  if (name === "ZodError") return new HarnessError("output_validation", message, { cause: err });
  if ((err as { code?: unknown })?.code === "ENOENT") return new HarnessError("input", message, { cause: err });
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400) {
    return new HarnessError(classifyHttpStatus(status), message, { cause: err });
  }
  return new HarnessError("transient", message, { cause: err });
}
