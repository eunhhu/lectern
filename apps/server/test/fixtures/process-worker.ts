// Entry point for process-job.test.ts: the real lectern-worker with the `process` handler
// registered on scripted providers instead of Gemini. Every transcription call appends one
// byte to LECTERN_TEST_CALLS; the call numbered LECTERN_TEST_CRASH_AT (0 = none) SIGKILLs
// this process first, so no finally block or cleanup runs. The speech the scripted
// provider "hears" is the JSON ScriptLine[] at LECTERN_TEST_SCRIPT.
import { appendFileSync, readFileSync } from "node:fs";
import { Harness, ScriptedLlmProvider, ScriptedTranscriptionProvider, type ScriptLine } from "@lectern/harness";
import { db, HARNESS_BLOB_DIR } from "../../src/db.ts";
import { registerProcessJobHandler } from "../../src/job-handlers.ts";
import { notesAnswer } from "./process-answers.ts";

const script = JSON.parse(readFileSync(process.env.LECTERN_TEST_SCRIPT!, "utf8")) as ScriptLine[];
const crashAt = Number(process.env.LECTERN_TEST_CRASH_AT || 0);

const transcription = new ScriptedTranscriptionProvider(script, {}, () => {
  appendFileSync(process.env.LECTERN_TEST_CALLS!, "x");
  if (transcription.calls.length === crashAt) process.kill(process.pid, "SIGKILL");
});

// job-handlers.ts registered the Gemini handler when it loaded; this replaces it.
registerProcessJobHandler({
  transcription,
  llm: new ScriptedLlmProvider(notesAnswer),
  harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
  pipeline: {
    concurrency: 1,
    chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 },
    onStage: transcription.observe,
  },
});

await import("../../../worker/src/index.ts");
