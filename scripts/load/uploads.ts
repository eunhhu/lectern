// N uploads at once (P7-01, CONTRACTS D-P7-1). A sandbox server (start.ts with its fake Gemini
// unless --no-processing), N synthetic WAVs of --minutes each (different content), uploaded in
// parallel through the v2 part upload, then each recording polled until it settles.
//
//   bun scripts/load/uploads.ts [--n 3] [--minutes 10] [--timeout-min 30] [--no-processing] [--out <file>]
//
// stdout: the JSON summary (lib/summary.ts). Exit 0 when ok, 1 otherwise, 2 on bad arguments.
// Progress goes to stderr. Nothing touches a real data directory or a real AI provider.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthAudio } from "./lib/audio.ts";
import { signIn, uploadFile, waitForRecording } from "./lib/client.ts";
import { startSandbox } from "./lib/server.ts";
import { finish, hostInfo, type LoadSummary, parseArgs, percentile, progress, uploadsOk } from "./lib/summary.ts";

export const UNAVAILABLE_NOTE = "processing was not run: the e2e server has no /__e2e/pipeline (P1-16)";

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2), {
    n: { default: 3 },
    minutes: { default: 10 },
    "timeout-min": { default: 30 },
    "no-processing": { default: false },
    out: { default: "" },
  });
  const n = Math.floor(args.n as number);
  const seconds = Math.round((args.minutes as number) * 60);
  const started = Date.now();
  const work = mkdtempSync(join(tmpdir(), "lectern-load-audio-"));
  const summary: LoadSummary = {
    scenario: "uploads",
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
    progress(`making ${n} × ${args.minutes} min of audio`);
    const files = await Promise.all(Array.from({ length: n }, (_, i) => synthAudio(work, `load-${i + 1}`, seconds, i + 1)));
    sandbox = await startSandbox({ processing: !args["no-processing"] });
    summary.server.mode = sandbox.mode;
    summary.server.processing = sandbox.processing;
    progress(`server ${sandbox.baseUrl} (${sandbox.mode}, processing ${sandbox.processing})`);
    const session = await signIn(sandbox.baseUrl);

    summary.uploads = await Promise.all(files.map((f, i) => uploadFile(session, f.path, `load-${started}-${i + 1}`)));
    for (const u of summary.uploads) if (!u.ok) summary.failures.push(`upload failed at ${u.stage} (${u.status ?? "network"}): ${u.error}`);
    const times = summary.uploads.filter((u) => u.ok).map((u) => u.uploadMs);
    summary.notes.push(`audio: ${n} × ${files[0]?.bytes ?? 0} bytes, ${summary.uploads[0]?.parts ?? 0} parts each`);
    summary.notes.push(`upload ms: p50 ${percentile(times, 50)}, p95 ${percentile(times, 95)}, max ${Math.max(0, ...times)}`);

    if (sandbox.processing === "on") {
      progress("waiting for processing");
      const timeoutMs = (args["timeout-min"] as number) * 60_000;
      summary.processing = await Promise.all(
        summary.uploads
          .filter((u) => u.ok && u.recordingId)
          .map(async (u) => {
            const { status, ms, lastSeen } = await waitForRecording(session, u.recordingId!, timeoutMs);
            if (status === "timeout") summary.notes.push(`recording ${u.recordingId} timed out; last seen ${lastSeen}`);
            return { recording_id: u.recordingId!, status, ms };
          }),
      );
      for (const p of summary.processing) if (p.status !== "ready" && p.status !== "partial") summary.failures.push(`recording ${p.recording_id} ended ${p.status}`);
      const ms = summary.processing.map((p) => p.ms);
      summary.notes.push(`processing ms: p50 ${percentile(ms, 50)}, p95 ${percentile(ms, 95)}, max ${Math.max(0, ...ms)}`);
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
}
