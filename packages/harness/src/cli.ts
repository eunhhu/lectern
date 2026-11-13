// `bun run harness <command>`: developer tools for the AI harness.
//
//   bun run harness eval [--set example|<dir>] [--provider scripted|gemini] [--model <id>]
//                        [--noise <0..1>] [--drift <rate>] [--fail-chunks 1,2] [--chunk-target <s>]
//                        [--out <dir>] [--cache <dir>] [--baseline <run.json>] [--label <name>] [--yes]
//   bun run harness eval --notes [--set …] [--provider scripted|gemini] [--model <id>]
//                        [--drop-rate <0..1>] [--wrong-date-rate <0..1>] [--extra-rate <0..1>] [...]
//
// The default is the bundled synthetic set with the scripted provider: no recordings, no
// cost. `--provider gemini` calls Gemini (cost): the estimate is printed first and the run
// stops unless `--yes` is given (AI_HARNESS §8). `--notes` runs the notes pipeline on the
// reference transcripts and scores it against annotations.csv instead of transcribing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runNotesEval, type NotesEvalRun } from "./eval/notes-run.ts";
import { formatEstimate, formatNotesReport, formatReport } from "./eval/report.ts";
import { runEval, type CostEstimate, type EvalProviderName, type EvalRun } from "./eval/run.ts";
import { EXAMPLE_SET_DIR, loadEvalSet } from "./eval/set.ts";

const USAGE = `usage: bun run harness eval [--set example|<dir>] [--provider scripted|gemini] [--model <id>]
         [--noise <0..1>] [--drift <rate>] [--fail-chunks 1,2] [--chunk-target <seconds>]
         [--out <dir>] [--cache <dir>] [--baseline <run.json>] [--label <name>] [--yes]
       bun run harness eval --notes [--set example|<dir>] [--provider scripted|gemini] [--model <id>]
         [--drop-rate <0..1>] [--wrong-date-rate <0..1>] [--extra-rate <0..1>]
         [--out <dir>] [--cache <dir>] [--baseline <run.json>] [--label <name>] [--yes]`;

/** harness-eval/sets/<name> keeps runs and the cache beside sets/ (§8); any other set dir keeps them inside. */
function evalRoot(setDir: string): string {
  return basename(dirname(setDir)) === "sets" ? dirname(dirname(setDir)) : setDir;
}

function nextFree(dir: string, name: string): string {
  let path = join(dir, `${name}.json`);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${name}-${i}.json`);
  return path;
}

async function evalCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      set: { type: "string", default: "example" },
      provider: { type: "string", default: "scripted" },
      model: { type: "string" },
      noise: { type: "string" },
      drift: { type: "string" },
      "fail-chunks": { type: "string" },
      "chunk-target": { type: "string" },
      out: { type: "string" },
      cache: { type: "string" },
      baseline: { type: "string" },
      label: { type: "string" },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      notes: { type: "boolean", default: false },
      "drop-rate": { type: "string" },
      "wrong-date-rate": { type: "string" },
      "extra-rate": { type: "string" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const provider = values.provider as EvalProviderName;
  if (provider !== "scripted" && provider !== "gemini") {
    console.error(`unknown provider ${values.provider}\n${USAGE}`);
    return 2;
  }
  const example = values.set === "example";
  const setDir = example ? EXAMPLE_SET_DIR : resolve(values.set!);
  const set = loadEvalSet(setDir);
  const scratch = join(tmpdir(), "lectern-eval", set.id);
  const root = example ? scratch : evalRoot(setDir);
  const cacheDir = values.cache ? resolve(values.cache) : join(root, ".cache", example ? "" : set.id);
  const outDir = values.out ? resolve(values.out) : join(root, "runs");
  const number = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const confirm = (estimate: CostEstimate) => {
    console.error(formatEstimate(estimate));
    if (!values.yes) console.error("실제 호출은 비용이 듭니다. 진행하려면 --yes를 붙여 다시 실행하세요.");
    return values.yes === true;
  };

  if (values.notes) {
    const notesRun: NotesEvalRun | null = await runNotesEval({
      set,
      provider,
      model: values.model,
      oracle:
        provider === "scripted"
          ? { dropRate: number(values["drop-rate"]), wrongDateRate: number(values["wrong-date-rate"]), extraRate: number(values["extra-rate"]) }
          : undefined,
      cacheDir,
      label: values.label,
      log: (line) => console.error(line),
      confirm,
    }).catch((err) => {
      console.error(String(err?.message ?? err));
      return null;
    });
    if (!notesRun) return 2;
    mkdirSync(outDir, { recursive: true });
    const file = nextFree(outDir, `${notesRun.created_at.slice(0, 10)}-notes-${notesRun.label.replace(/[^\w.-]+/g, "_")}`);
    writeFileSync(file, JSON.stringify(notesRun, null, 2) + "\n");
    const baseline = values.baseline ? (JSON.parse(readFileSync(values.baseline, "utf8")) as NotesEvalRun) : undefined;
    try {
      console.log(formatNotesReport(notesRun, baseline));
    } catch (err) {
      console.error(String((err as Error).message));
      return 2;
    }
    console.log(`\n결과: ${file}`);
    return notesRun.items.some((i) => i.status === "failed") ? 1 : 0;
  }

  const run: EvalRun = await runEval({
    set,
    provider,
    model: values.model,
    scripted:
      provider === "scripted"
        ? {
            charErrorRate: number(values.noise) ?? 0.03,
            driftRate: number(values.drift) ?? 0,
            failChunks: values["fail-chunks"]?.split(",").map(Number),
          }
        : undefined,
    chunk: values["chunk-target"] ? { targetMs: Number(values["chunk-target"]) * 1000 } : undefined,
    cacheDir,
    label: values.label,
    log: (line) => console.error(line),
    confirm: (estimate) => {
      console.error(formatEstimate(estimate));
      if (!values.yes) console.error("실제 호출은 비용이 듭니다. 진행하려면 --yes를 붙여 다시 실행하세요.");
      return values.yes === true;
    },
  }).catch((err) => {
    console.error(String(err?.message ?? err));
    return null as unknown as EvalRun;
  });
  if (!run) return 2;

  mkdirSync(outDir, { recursive: true });
  const date = run.created_at.slice(0, 10);
  const file = nextFree(outDir, `${date}-${run.label.replace(/[^\w.-]+/g, "_")}`);
  writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
  const baseline = values.baseline ? (JSON.parse(readFileSync(values.baseline, "utf8")) as EvalRun) : undefined;
  console.log(formatReport(run, baseline));
  console.log(`\n결과: ${file}`);
  return run.items.some((i) => i.status === "failed") ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "eval") {
  process.exit(await evalCommand(rest));
} else {
  console.error(USAGE);
  process.exit(command === undefined || command === "help" || command === "--help" ? 0 : 2);
}
