// The notes pipeline in its own process, SIGKILLing itself on the first provider call of
// one stage, for notes-pipeline.test.ts:
//   bun notes-crash.ts <dbPath> <blobDir> <jobId> <markerFile> <crashOn>
// crashOn is none|classify|structure|extract. Every provider call appends its kind's first
// letter (c/s/e) to <markerFile> before the crash check. Without a crash it prints the stage
// events and the result summary as JSON.

import { Database } from "bun:sqlite";
import { appendFileSync } from "node:fs";
import { Harness, loadRouting, runNotesPipeline, ScriptedLlmProvider, type NotesStageEvent } from "../../src/index.ts";
import { answerFor, kindOf, pipelineInput } from "../notes-helpers.ts";

const [dbPath, blobDir, jobId, markerFile, crashOn] = process.argv.slice(2) as string[];

const db = new Database(dbPath!);
db.exec(`PRAGMA busy_timeout = 5000;`);
const llm = new ScriptedLlmProvider((req) => {
  const kind = kindOf(req);
  appendFileSync(markerFile!, kind[0]!);
  if (kind === crashOn) process.kill(process.pid, "SIGKILL");
  return answerFor(req);
});
const harness = new Harness({ db, blobDir: blobDir!, sleep: async () => {} });
const stages: Array<Pick<NotesStageEvent, "stage" | "cacheHit" | "resumed">> = [];
const result = await runNotesPipeline(harness.job({ jobId: jobId!, scope: "ws" }), pipelineInput(), {
  llm,
  routing: loadRouting(),
  onStage: ({ stage, cacheHit, resumed }) => stages.push({ stage, cacheHit, resumed }),
});
process.stdout.write(JSON.stringify({ stages, template: result.template, partial: result.partial }));
