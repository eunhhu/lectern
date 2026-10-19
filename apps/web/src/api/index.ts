// The one module that picks the ApiClient implementation, at build time
// (scripts/build.ts defines LECTERN_WEB_API): `http` is the real /api/v2 client (cookie
// auth, same origin) and the default of `bun run web:build`; `fixture` is the in-memory
// data set for `bun run web:dev`, the fixture e2e suite and unit tests (where the
// variable is unset). The bundler drops the branch that is not taken, so a production
// bundle carries no fixture data.

import type { ApiClient } from "./client.ts";
import { createFixtureClient } from "./fixture/client.ts";
import { createHttpClient } from "./http/client.ts";

export type ApiMode = "fixture" | "http";

// The condition is spelled out in both places so the bundler can fold it to a constant.
export const API_MODE: ApiMode = process.env.LECTERN_WEB_API === "http" ? "http" : "fixture";

export function createApiClient(): ApiClient {
  return process.env.LECTERN_WEB_API === "http" ? createHttpClient() : createFixtureClient();
}
