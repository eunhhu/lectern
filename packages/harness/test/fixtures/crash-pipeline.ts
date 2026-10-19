// Two-stage pipeline that SIGKILLs its own process at a chosen point, for crash.test.ts.
//   bun crash-pipeline.ts <dbPath> <blobDir> <jobId> <markerDir> <crashAt>
// crashAt: "none" | "in-run" (inside the second stage) | "after-blob" (output blob renamed
// into place, artifact row and stage_run transition not yet written).
// Each stage appends one byte to <markerDir>/<stage> per execution.

import { Database } from "bun:sqlite";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BlobStore, defineStage, Harness } from "../../src/index.ts";

const [dbPath, blobDir, jobId, markerDir, crashAt] = process.argv.slice(2) as [string, string, string, string, string];

function die(): never {
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable");
}

const db = new Database(dbPath);
db.exec(`PRAGMA busy_timeout = 5000;`);

let armed = false;
class CrashingBlobStore extends BlobStore {
  override async putBytes(data: string | Uint8Array) {
    const ref = await super.putBytes(data);
    if (armed) die();
    return ref;
  }
}

const Num = z.object({ n: z.number() });
const double = defineStage({
  name: "double",
  version: 1,
  output: Num,
  key: (input: { n: number }) => ({ config: input }),
  async run(input) {
    appendFileSync(join(markerDir, "double"), "x");
    return { n: input.n * 2 };
  },
});
const square = defineStage({
  name: "square",
  version: 1,
  output: Num,
  key: (input: { n: number }) => ({ config: input }),
  async run(input) {
    appendFileSync(join(markerDir, "square"), "x");
    if (crashAt === "in-run") die();
    if (crashAt === "after-blob") armed = true;
    return { n: input.n * input.n };
  },
});

const harness = new Harness({ db, blobs: new CrashingBlobStore(blobDir) });
const run = harness.job({ jobId, scope: "crash-test" });
const a = await run.run(double, { n: 3 });
const b = await run.run(square, { n: a.value.n });
process.stdout.write(JSON.stringify(b.value));
