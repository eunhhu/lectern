// Pure pieces of the deploy preflight (preflight.ts). Kept free of server imports so they
// can be tested without booting the server module graph.

export type PreflightCheck = [path: string, expectedStatus: number];

/** The `/` row depends on LECTERN_WEB_SHELL: 302 when the web shell redirects, else 200. */
export function buildPreflightChecks(webShell: boolean, pageScripts: string[]): PreflightCheck[] {
  return [
    ["/api/health", 200],
    ["/", webShell ? 302 : 200],
    ["/admin", 200],
    ["/s/preflight-missing-token", 404],
    ["/api/lectures", 401],
    ["/api/v2/me", 401],
    ["/api/v2/openapi.json", 200],
    ["/privacy", 200],
    ["/terms", 200],
    ...pageScripts.map((name): PreflightCheck => [`/assets/${name}`, 200]),
  ];
}

export interface PreflightResponse {
  status: number;
  location: string | null;
}

/**
 * Extra checks when the web shell is on: `/` must redirect into /app, `/?legacy=1` must
 * still serve the old page, and /app must answer once its build exists. Returns problems.
 */
export async function rootRedirectProblems(
  get: (path: string) => Promise<PreflightResponse>,
  opts: { distBuilt: boolean }
): Promise<string[]> {
  const problems: string[] = [];
  const root = await get("/");
  if (!root.location?.startsWith("/app")) {
    problems.push(`/ redirect Location is ${root.location ?? "(none)"} (expected /app...)`);
  }
  const legacyRoot = await get("/?legacy=1");
  if (legacyRoot.status !== 200) problems.push(`/?legacy=1 → ${legacyRoot.status} (expected 200)`);
  if (opts.distBuilt) {
    const app = await get("/app");
    if (app.status !== 200) problems.push(`/app → ${app.status} (expected 200)`);
  }
  return problems;
}
