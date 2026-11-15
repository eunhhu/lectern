// One long recording (P7-01, CONTRACTS D-P7-1): a synthetic WAV of --hours (3 by default, about
// 345 MB, written to disk a second at a time), uploaded through the v2 part upload to a sandbox
// server, then processed by start.ts's fake Gemini unless --no-processing.
//
//   bun scripts/load/long-recording.ts [--hours 3] [--timeout-min 120] [--no-processing] [--out <file>]
//
// stdout: the JSON summary. Exit 0 when ok, 1 otherwise, 2 on bad arguments.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthAudio } from "./lib/audio.ts";
import { signIn, uploadFile, waitForRecording } from "./lib/client.ts";
import { startSandbox } from "./lib/server.ts";
import { finish, hostInfo, type LoadSummary, parseArgs, progress, uploadsOk } from "./lib/summary.ts";
import { UNAVAILABLE_NOTE } from "./uploads.ts";

const args = parseArgs(process.argv.slice(2), {
  hours: { default: 3 },
  "timeout-min": { default: 120 },
  "no-processing": { default: false },
  out: { default: "" },
});
const seconds = Math.round((args.hours as number) * 3600);
const started = Date.now();
const work = mkdtempSync(join(tmpdir(), "lectern-load-audio-"));
const summary: LoadSummary = {
  scenario: "long-recording",
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
  progress(`making ${args.hours} h of audio`);
  const audio = await synthAudio(work, "long", seconds, 1);
  sandbox = await startSandbox({ processing: !args["no-processing"] });
  summary.server.mode = sandbox.mode;
  summary.server.processing = sandbox.processing;
  progress(`server ${sandbox.baseUrl} (${sandbox.mode}, processing ${sandbox.processing})`);
  const session = await signIn(sandbox.baseUrl);

  const upload = await uploadFile(session, audio.path, `load-long-${started}`);
  summary.uploads = [upload];
  summary.notes.push(`audio: ${audio.seconds} s, ${audio.bytes} bytes, ${upload.parts} parts, uploaded in ${upload.uploadMs} ms`);
  if (!upload.ok) summary.failures.push(`upload failed at ${upload.stage} (${upload.status ?? "network"}): ${upload.error}`);

  if (upload.ok && sandbox.processing === "on") {
    progress("waiting for processing");
    const { status, ms, lastSeen } = await waitForRecording(session, upload.recordingId!, (args["timeout-min"] as number) * 60_000);
    const result = { status, ms };
    if (status === "timeout") summary.notes.push(`recording ${upload.recordingId} timed out; last seen ${lastSeen}`);
    summary.processing = [{ recording_id: upload.recordingId!, ...result }];
    if (result.status !== "ready" && result.status !== "partial") summary.failures.push(`recording ${upload.recordingId} ended ${result.status}`);
  } else if (sandbox.processing === "unavailable") {
    summary.notes.push(UNAVAILABLE_NOTE);
  }
  summary.server.alive_at_end = sandbox.alive();
  if (!summary.server.alive_at_end) summary.failures.push("the server process died");
} catch (err) {
  summary.failures.push(err instanceof Error ? err.message : String(err));
} finally {
  summary.server.max_rss_bytes = sandbox?.maxRssBytes() ?? 0;
  await sandbox?.stop();
  rmSync(work, { recursive: true, force: true });
}
summary.ok = summary.failures.length === 0 && uploadsOk(summary);
summary.duration_ms = Date.now() - started;
finish(summary, (args.out as string) || undefined);
