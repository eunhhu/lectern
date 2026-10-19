// What the screens say about a failed request. The server's message is already written
// for people (packages/domain ApiError); the client adds the cases it knows better:
// an endpoint that is not built yet (501 `not_implemented`, shown as "준비 중"), a lost
// connection, and a response that does not match the contract.

import { ApiClientError } from "./client.ts";

/** The server has the route but not the feature yet (API v2 stubs answer 501). */
export function isNotReady(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "not_implemented";
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 404;
}

/** A sentence for a toast or an error box. */
export function errorMessage(err: unknown, fallback = "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요."): string {
  if (isNotReady(err)) return "아직 준비 중인 기능입니다. 서버에 이 기능이 들어오면 바로 쓸 수 있습니다.";
  if (err instanceof ApiClientError) return err.message || fallback;
  return fallback;
}
