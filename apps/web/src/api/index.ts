// The one module that picks the ApiClient implementation. Connecting the real API v2 means
// replacing this with an HTTP client that implements ApiClient against /api/v2 (cookie
// auth, same origin); nothing else in the app imports the fixture client.

import type { ApiClient } from "./client.ts";
import { createFixtureClient } from "./fixture/client.ts";

export function createApiClient(): ApiClient {
  return createFixtureClient();
}
