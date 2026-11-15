import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentBody } from "@lectern/domain";
import { HarnessError } from "../src/errors.ts";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { runNotesPipeline, type NotesPipelineInput, type NotesStageEvent } from "../src/notes/pipeline.ts";
import { NotesResult } from "../src/notes/schemas.ts";
import type { LlmRequest } from "../src/providers.ts";
import { loadRouting } from "../src/routing.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";
import { answerFor, classifyOut, kindOf, pipelineInput, structureOut, type CallKind } from "./notes-helpers.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "notes-crash.ts");

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
  env.job("job-1");
});
afterEach(() => env.close());

type Override = Partial<Record<CallKind, (req: LlmRequest<unknown>, nth: number) => unknown>>;

function provider(override: Override = {}) {
  const seen: Record<CallKind, number> = { classify: 0, structure: 0, extract: 0, repair: 0 };
  const llm = new ScriptedLlmProvider((req) => {
    const kind = kindOf(req);
    const nth = seen[kind]++;
    const answer = override[kind];
    return answer ? answer(req, nth) : answerFor(req);
  });
  const calls = (kind: CallKind) => llm.calls.filter((c) => kindOf(c.req) === kind).length;
  return { llm, calls };
}

async function pipeline(
  llm: ScriptedLlmProvider,
  over: Partial<NotesPipelineInput> = {},
  opts: { jobId?: string; signal?: AbortSignal; onStage?: (e: NotesStageEvent, events: NotesStageEvent[]) => void } = {}
) {
  const events: NotesStageEvent[] = [];
  const run = env.harness().job({ jobId: opts.jobId ?? "job-1", scope: "ws", signal: opts.signal });
  const result = await runNotesPipeline(run, pipelineInput(over), {
    llm,
    routing: loadRouting(),
    onStage: (e) => {
      events.push(e);
      opts.onStage?.(e, events);
    },
  });
  return { result, events, run };
}

const rejection = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(HarnessError);
  return err as HarnessError;
};

const transient = () => {
  throw new HarnessError("transient", "503");
};
const firstTransient = (req: LlmRequest<unknown>, nth: number) => (nth === 0 ? transient() : answerFor(req));

describe("runNotesPipeline", () => {
  test("normal path", async () => {
    const { llm, calls } = provider();
    const { result, events } = await pipeline(llm);
    expect(result.template).toEqual({ id: "lecture", version: 1 });
    expect(result.partial).toBe(false);
    expect([calls("classify"), calls("structure"), calls("extract"), calls("repair")]).toEqual([1, 1, 1, 0]);
    expect(result.body.sections.map((s) => s.key)).toEqual(["summary", "topics", "glossary", "events"]);
    expect(result.events[0]!.start_at).toBe(Date.parse("2026-10-27T00:00:00+09:00"));
    expect(result.markdown.startsWith("# 암호 운영 모드\n\n## 핵심 요약")).toBe(true);
    expect(result.report.repaired).toBe(false);
    expect(events.map((e) => e.stage)).toEqual(["classify", "structure", "extract", "verify", "render"]);
  });

  test("ledger records one row per model call", async () => {
    const { llm } = provider();
    await pipeline(llm);
    const ledger = rows<{ stage: string; model: string }>(
      env.db,
      `SELECT s.stage AS stage, a.model AS model FROM ai_call a JOIN stage_run s ON s.id = a.stage_run_id ORDER BY s.stage`
    );
    expect(ledger).toEqual([
      { stage: "classify", model: "gemini-3.5-flash-lite" },
      { stage: "extract", model: "gemini-3.8-flash" },
      { stage: "structure", model: "gemini-3.8-flash" },
    ]);
  });

  test("resume: second call is all memo hits", async () => {
    const { llm } = provider();
    const first = await pipeline(llm);
    const second = await pipeline(llm);
    for (const e of second.events.filter((e) => e.stage !== "render")) expect(e.resumed).toBe(true);
    expect(llm.calls).toHaveLength(3);
    expect(second.result).toEqual(first.result);
  });

  test("shared memo across jobs", async () => {
    const { llm } = provider();
    await pipeline(llm);
    env.job("job-2");
    const second = await pipeline(llm, {}, { jobId: "job-2" });
    for (const e of second.events.filter((e) => e.stage !== "render")) expect(e.cacheHit).toBe(true);
    expect(llm.calls).toHaveLength(3);
  });

  test("low classify confidence picks general", async () => {
    const { llm } = provider({ classify: () => ({ ...classifyOut, confidence: 0.3 }) });
    const { result } = await pipeline(llm);
    expect(result.template.id).toBe("general");
    const extract = llm.calls.find((c) => kindOf(c.req) === "extract")!;
    expect(extract.req.instruction).toContain("action_items");
  });

  test("meeting domain", async () => {
    const { llm } = provider({
      classify: () => ({ ...classifyOut, domain: "meeting" }),
      extract: () => ({ events: [], action_items: [], decisions: [] }),
    });
    const { result } = await pipeline(llm);
    expect(result.template.id).toBe("meeting");
  });

  test("interview skips extract", async () => {
    const { llm, calls } = provider({
      classify: () => ({ ...classifyOut, domain: "interview" }),
      structure: () => ({
        sections: [
          { key: "context", blocks: structureOut.sections[0]!.blocks },
          { key: "answers", blocks: structureOut.sections[1]!.blocks },
        ],
      }),
    });
    const { result } = await pipeline(llm);
    expect(result.template.id).toBe("interview");
    expect(calls("extract")).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.partial).toBe(false);
  });

  for (const kind of ["classify", "structure", "extract"] as const) {
    test(`fault: one 503 in ${kind} is retried`, async () => {
      const { llm, calls } = provider({ [kind]: firstTransient });
      const { result } = await pipeline(llm);
      expect(result.partial).toBe(false);
      expect(calls(kind)).toBe(2);
    });
  }

  test("fault: timeout error is retried", async () => {
    const { llm, calls } = provider({
      structure: (req, nth) => {
        if (nth === 0) throw Object.assign(new Error("deadline"), { name: "TimeoutError" });
        return answerFor(req);
      },
    });
    await pipeline(llm);
    expect(calls("structure")).toBe(2);
  });

  test("fault: classify keeps failing", async () => {
    const { llm, calls } = provider({ classify: transient });
    const { result } = await pipeline(llm);
    expect(calls("classify")).toBe(3);
    expect(result.classification.confidence).toBe(0);
    expect(result.classification.domain).toBe("other");
    expect(result.classification.title).toBe("lec");
    expect(result.template.id).toBe("general");
  });

  test("fault: classify fails but hint domain given", async () => {
    const { llm } = provider({
      classify: transient,
      extract: () => ({ events: [], action_items: [], decisions: [] }),
    });
    const { result } = await pipeline(llm, { hint: { domain: "meeting", folder_id: null } });
    expect(result.template.id).toBe("meeting");
    expect(result.classification.domain).toBe("meeting");
  });

  test("fault: structure keeps failing", async () => {
    const { llm, calls } = provider({ structure: transient });
    const err = await rejection(pipeline(llm));
    expect(err.kind).toBe("transient");
    expect(calls("extract")).toBe(0);
  });

  test("fault: extract keeps failing", async () => {
    const { llm, calls } = provider({ extract: transient });
    const { result } = await pipeline(llm);
    expect(result.partial).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.action_items).toEqual([]);
    expect(result.body.sections.map((s) => s.key)).toEqual(["summary", "topics"]);
    expect(calls("extract")).toBe(3);
  });

  test("fault: invalid extract answers", async () => {
    const { llm } = provider({ extract: () => ({}) });
    const { result } = await pipeline(llm);
    expect(result.partial).toBe(true);
  });

  test("fault: repair call keeps failing", async () => {
    const broken = structuredClone(structureOut);
    broken.sections[1]!.blocks[0]!.sources = ["#99"];
    const { llm, calls } = provider({ structure: () => broken, repair: transient });
    const { result } = await pipeline(llm);
    expect(result.partial).toBe(true);
    expect(calls("repair")).toBeLessThanOrEqual(3);
    expect(calls("repair")).toBeGreaterThan(0);
  });

  test("fault: config error is fatal", async () => {
    const { llm } = provider({
      extract: () => {
        throw new HarnessError("config", "no key");
      },
    });
    const err = await rejection(pipeline(llm));
    expect(err.kind).toBe("config");
  });

  test("budget: exhausted after structure", async () => {
    env.job("job-b", { budgetMicrousd: 5 });
    const { llm, calls } = provider();
    const { result } = await pipeline(
      llm,
      {},
      {
        jobId: "job-b",
        onStage: (e) => {
          if (e.stage === "structure") env.db.query(`UPDATE job SET spent_microusd = 10 WHERE id = 'job-b'`).run();
        },
      }
    );
    expect(result.partial).toBe(true);
    expect(calls("extract")).toBe(0);
    expect(result.body.sections.map((s) => s.key)).toContain("topics");
    expect(result.events).toEqual([]);
  });

  test("budget: exhausted before structure", async () => {
    env.job("job-b", { budgetMicrousd: 5 });
    const { llm, calls } = provider();
    const err = await rejection(
      pipeline(
        llm,
        {},
        {
          jobId: "job-b",
          onStage: (e) => {
            if (e.stage === "classify") env.db.query(`UPDATE job SET spent_microusd = 10 WHERE id = 'job-b'`).run();
          },
        }
      )
    );
    expect(err.kind).toBe("budget");
    expect(calls("structure")).toBe(0);
  });

  test("cancel between stages", async () => {
    const controller = new AbortController();
    const { llm, calls } = provider();
    const err = await rejection(
      pipeline(
        llm,
        {},
        {
          signal: controller.signal,
          onStage: (e) => {
            if (e.stage === "classify") controller.abort();
          },
        }
      )
    );
    expect(err.kind).toBe("canceled");
    expect(calls("structure")).toBe(0);
  });

  test("result is a valid NotesResult", async () => {
    const { llm } = provider();
    const { result } = await pipeline(llm);
    expect(() => NotesResult.parse(result)).not.toThrow();
    expect(() => DocumentBody.parse(result.body)).not.toThrow();
  });
});

describe("runNotesPipeline in a killed process", () => {
  const spawn = async (jobId: string, marker: string, crashOn: string) => {
    const proc = Bun.spawn(["bun", FIXTURE, env.dbPath, env.blobDir, jobId, marker, crashOn], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    return { stdout, stderr, signal: proc.signalCode };
  };
  const markerText = (marker: string) => (existsSync(marker) ? readFileSync(marker, "utf8") : "");
  const states = (jobId: string) =>
    Object.fromEntries(
      rows<{ stage: string; state: string }>(env.db, `SELECT stage, state FROM stage_run WHERE job_id = ?`, jobId).map((r) => [
        r.stage,
        r.state,
      ])
    );

  test("crash and resume (SIGKILL)", async () => {
    env.job("job-crash");
    const marker = join(env.dir, "marker-extract");
    const crashed = await spawn("job-crash", marker, "extract");
    expect(crashed.signal).toBe("SIGKILL");
    expect(markerText(marker)).toBe("cse");
    expect(states("job-crash")).toMatchObject({ classify: "succeeded", structure: "succeeded", extract: "running" });

    const again = await spawn("job-crash", marker, "none");
    expect(again.signal).toBeNull();
    const out = JSON.parse(again.stdout) as { stages: NotesStageEvent[]; partial: boolean };
    const byStage = Object.fromEntries(out.stages.map((s) => [s.stage, s]));
    expect(byStage.classify!.resumed).toBe(true);
    expect(byStage.structure!.resumed).toBe(true);
    expect(byStage.extract!.resumed).toBe(false);
    expect(byStage.extract!.cacheHit).toBe(false);
    expect(markerText(marker)).toBe("csee");
    expect(states("job-crash").extract).toBe("succeeded");
    expect(out.partial).toBe(false);
  }, 30_000);

  test("crash during structure", async () => {
    env.job("job-crash-s");
    const marker = join(env.dir, "marker-structure");
    const crashed = await spawn("job-crash-s", marker, "structure");
    expect(crashed.signal).toBe("SIGKILL");
    expect(markerText(marker)).toBe("cs");
    const again = await spawn("job-crash-s", marker, "none");
    const out = JSON.parse(again.stdout) as { stages: NotesStageEvent[] };
    const byStage = Object.fromEntries(out.stages.map((s) => [s.stage, s]));
    expect(byStage.classify!.resumed).toBe(true);
    expect(byStage.structure!.resumed).toBe(false);
    expect(markerText(marker)).toBe("csse");
  }, 30_000);
});
