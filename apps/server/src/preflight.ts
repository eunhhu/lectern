// Boot check for a freshly checked-out release, run by the CD webhook (ops.ts) before the
// live server is restarted onto it. The deploy runner points LECTERN_DATA_DIR, the lecture
// archive and HOME at throwaway directories (with a copy of the live database), so this
// loads the complete server module graph (schema migrations and the lectures -> v2
// migration included), checks the migrated rows, and answers a few requests in-process
// without touching production data. A non-zero exit aborts the deploy and rolls the checkout back
// while the old server keeps running.

if (process.env.LECTERN_PREFLIGHT !== "1") {
  console.error("preflight.ts is run by the deploy webhook with a sandboxed environment.");
  process.exit(2);
}

const { handleRequest } = await import("./index.ts");
const { PAGE_SCRIPTS } = await import("./ui.ts");

const checks: Array<[path: string, expectedStatus: number]> = [
  ["/api/health", 200],
  ["/", 200],
  ["/admin", 200],
  ["/s/preflight-missing-token", 404],
  ["/api/lectures", 401],
  ["/api/v2/me", 401],
  ["/api/v2/openapi.json", 200],
  ["/privacy", 200],
  ["/terms", 200],
  ...[...PAGE_SCRIPTS.keys()].map((name): [string, number] => [`/assets/${name}`, 200]),
];

const failures: string[] = [];

// The P2 migration on this copy of the live database (boot ran it): lectures and v2 rows
// must agree row for row, and every v2 row must parse with its domain schema
// (scripts/rehearse-v2-migration.ts does the same on a backup copy).
{
  const { db } = await import("./db.ts");
  const { verifyLegacy } = await import("@lectern/db");
  const { checkV2Rows } = await import("./api/v2/row-check.ts");
  const migration = verifyLegacy(db);
  if (!migration.ok) {
    failures.push(
      `v2 migration: ${migration.mismatch_count} lecture(s) disagree with their v2 rows (${JSON.stringify(migration.counts)}), e.g. ${JSON.stringify(migration.mismatches.slice(0, 5))}`
    );
  }
  const rows = checkV2Rows(db);
  if (!rows.ok) failures.push(`v2 rows: ${rows.failure_count} row(s) fail their domain schema, e.g. ${JSON.stringify(rows.failures.slice(0, 5))}`);
}

for (const [path, expected] of checks) {
  try {
    const res = await handleRequest(new Request(`http://localhost${path}`));
    if (res.status !== expected) failures.push(`${path} → ${res.status} (expected ${expected})`);
  } catch (err: any) {
    failures.push(`${path} → threw ${err?.message || err}`);
  }
}

if (failures.length) {
  console.error(`Preflight failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`Preflight passed (${checks.length} checks).`);
process.exit(0);

export {}; // a module, so top-level await is allowed
