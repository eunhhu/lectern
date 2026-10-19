// The transcript pipeline in its own process, SIGKILLing itself at the Nth provider call,
// for transcript-crash.test.ts:
//   bun transcript-crash.ts <dbPath> <blobDir> <workDir> <jobId> <markerFile> <audioPath> <scriptJson> <crashAtCall>
// crashAtCall 0 runs to the end and prints the result summary as JSON. Every provider call
// appends one byte to <markerFile>, before the crash check.

import { Database } from "bun:sqlite";
import { appendFileSync, readFileSync } from "node:fs";
import { Harness, runTranscriptPipeline, ScriptedTranscriptionProvider, type ScriptLine } from "../../src/index.ts";

const [dbPath, blobDir, workDir, jobId, markerFile, audioPath, scriptJson, crashAt] = process.argv.slice(2) as string[];
const script = JSON.parse(readFileSync(scriptJson!, "utf8")) as ScriptLine[];

const db = new Database(dbPath!);
db.exec(`PRAGMA busy_timeout = 5000;`);
const provider = new ScriptedTranscriptionProvider(script, { chunkLocalLabels: true }, () => {
  appendFileSync(markerFile!, "x");
  if (provider.calls.length === Number(crashAt)) process.kill(process.pid, "SIGKILL");
});
const harness = new Harness({ db, blobDir: blobDir!, sleep: async () => {} });
const result = await runTranscriptPipeline(
  harness.job({ jobId: jobId!, scope: "crash-test" }),
  { audioPath: audioPath! },
  { provider, workDir: workDir!, concurrency: 1, chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 }, onStage: provider.observe },
);
process.stdout.write(
  JSON.stringify({
    stageRuns: result.stageRuns,
    texts: result.transcript.segments.map((s) => s.text),
    chunks: result.chunks.chunks.length,
  }),
);
