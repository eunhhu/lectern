// Boot check for a freshly checked-out release, run by the CD webhook (ops.ts) before the
// live server is restarted onto it. The deploy runner points LECTERN_DATA_DIR, the lecture
// archive and HOME at throwaway directories, so this loads the complete server module
// graph (schema migrations included) and answers a few requests in-process without
// touching production data. A non-zero exit aborts the deploy and rolls the checkout back
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
  ...[...PAGE_SCRIPTS.keys()].map((name): [string, number] => [`/assets/${name}`, 200]),
];

const failures: string[] = [];
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
