// Disk almost full (P7-01, CONTRACTS D-P7-1). A plain sandbox server (no job runs, no AI) keeps
// its data on --volume, a small dedicated volume the operator mounted, and takes 2-minute uploads
// (different content each) until one fails or 60 went in. Then it records whether the server is
// still up, whether every upload it answered as done is listed (nothing lost after "success"),
// and whether it takes a small upload again once the last upload session is dropped.
//
//   bun scripts/load/disk-full.ts --volume <mount point> [--out <file>]
//
// The volume must exist, be empty (dot entries and lost+found aside), hold no lectern.sqlite and
// be at most 1 GiB. Its contents are left in place: throw the volume away afterwards.
// stdout: the JSON summary. Exit 0 when ok, 1 otherwise, 2 on bad arguments or a refused volume.

import { existsSync, mkdtempSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthAudio } from "./lib/audio.ts";
import { abortUpload, countRecordings, health, signIn, uploadFile } from "./lib/client.ts";
import { assertSandboxDir } from "./lib/guard.ts";
import { startSandbox } from "./lib/server.ts";
import { finish, hostInfo, type LoadSummary, parseArgs, progress } from "./lib/summary.ts";

const MAX_UPLOADS = 60;
const MAX_VOLUME_BYTES = 1024 ** 3;
const UPLOAD_SECONDS = 120;

const args = parseArgs(process.argv.slice(2), { volume: { default: "" }, out: { default: "" } });
const volumeArg = args.volume as string;
if (!volumeArg) {
  process.stderr.write("--volume <mount point> is required\nusage: bun scripts/load/disk-full.ts --volume <dir> [--out <file>]\n");
  process.exit(2);
}

/** Refusals print one line and exit 2 before anything is made. */
let volume: string;
try {
  // The data-directory rules first (nothing is made), then the volume itself.
  volume = assertSandboxDir(volumeArg, process.env, { create: false });
  if (!existsSync(volume)) throw new Error(`load: refused — ${volumeArg} does not exist; mount a small dedicated volume there first`);
  const st = statfsSync(volume);
  if (st.blocks * st.bsize > MAX_VOLUME_BYTES) throw new Error("load: refused — the volume is larger than 1 GiB; use a small dedicated volume");
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}

const started = Date.now();
// The audio is made on the OS temp disk, never on the volume under test.
const work = mkdtempSync(join(tmpdir(), "lectern-load-audio-"));
const summary: LoadSummary = {
  scenario: "disk-full",
  started_at: new Date(started).toISOString(),
  duration_ms: 0,
  host: hostInfo(),
  server: { mode: "", processing: "", max_rss_bytes: 0, alive_at_end: false },
  uploads: [],
  processing: [],
  failures: [],
  ok: false,
  notes: [],
};
let sandbox: Awaited<ReturnType<typeof startSandbox>> | null = null;
try {
  const st = statfsSync(volume);
  summary.notes.push(`volume: ${st.blocks * st.bsize} bytes, ${st.bavail * st.bsize} free at start`);
  sandbox = await startSandbox({ processing: false, dataRoot: volume });
  summary.server.mode = sandbox.mode;
  summary.server.processing = sandbox.processing;
  progress(`server ${sandbox.baseUrl} (data on ${volume})`);
  const session = await signIn(sandbox.baseUrl);

  let refused = null as (typeof summary.uploads)[number] | null;
  for (let i = 1; i <= MAX_UPLOADS; i++) {
    const audio = await synthAudio(work, `fill-${i}`, UPLOAD_SECONDS, 1000 + i);
    const outcome = await uploadFile(session, audio.path, `load-disk-${started}-${i}`);
    rmSync(audio.path, { force: true });
    summary.uploads.push(outcome);
    if (!outcome.ok) {
      refused = outcome;
      break;
    }
    if (i % 10 === 0) progress(`${i} uploads in`);
  }

  const accepted = summary.uploads.filter((u) => u.ok).length;
  const free = statfsSync(volume);
  summary.notes.push(`accepted ${accepted} uploads; ${free.bavail * free.bsize} bytes free after`);
  if (!refused) {
    summary.failures.push("the volume never filled up");
  } else {
    summary.notes.push(`upload ${summary.uploads.length} failed at ${refused.stage} (${refused.status ?? "network"}): ${refused.error}`);
    const healthStatus = await health(sandbox.baseUrl);
    summary.notes.push(`GET /api/health after the failure: ${healthStatus ?? "no answer"}`);

    // Nothing lost after "success": every upload answered as done is listed.
    try {
      const listed = await countRecordings(session);
      summary.notes.push(`recordings listed: ${listed} (uploads answered as done: ${accepted})`);
      if (listed !== accepted) summary.failures.push(`the server answered ${accepted} uploads as done but lists ${listed} recordings`);
    } catch (err) {
      summary.failures.push(`could not list recordings: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Room again: drop the newest upload session, then try a one-second upload.
    const latest = [...summary.uploads].reverse().find((u) => u.uploadId)?.uploadId;
    if (latest) summary.notes.push(`DELETE /api/v2/uploads/${latest}: ${await abortUpload(session, latest)}`);
    const small = await synthAudio(work, "small", 1, 9999);
    const retry = await uploadFile(session, small.path, `load-disk-${started}-small`);
    summary.notes.push(
      retry.ok ? "a 1-second upload went in after dropping the session" : `a 1-second upload still failed at ${retry.stage} (${retry.status ?? "network"}): ${retry.error}`,
    );
  }
  summary.server.alive_at_end = sandbox.alive() && (await health(sandbox.baseUrl)) === 200;
  if (!summary.server.alive_at_end) summary.failures.push("the server is not answering /api/health at the end");
} catch (err) {
  summary.failures.push(err instanceof Error ? err.message : String(err));
} finally {
  summary.server.max_rss_bytes = sandbox?.maxRssBytes() ?? 0;
  await sandbox?.stop();
  rmSync(work, { recursive: true, force: true });
}
// A refused upload on a full disk is the expected outcome, not a failure.
summary.ok = summary.failures.length === 0 && summary.server.alive_at_end;
summary.duration_ms = Date.now() - started;
finish(summary, (args.out as string) || undefined);
