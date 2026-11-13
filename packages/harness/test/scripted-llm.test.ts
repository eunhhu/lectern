import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { HarnessError } from "../src/errors.ts";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import type { LlmRequest } from "../src/providers.ts";

const schema = z.object({ a: z.string() });
const req = (): LlmRequest<{ a: string }> => ({
  schema,
  system: "규칙",
  context: [{ type: "text", text: "#0 [00:00] S1: 본문" }],
  instruction: "요약해라",
  model: "gemini-3.8-flash",
  maxOutputTokens: 100,
});

describe("ScriptedLlmProvider", () => {
  test("returns scripted values and records calls", async () => {
    const llm = ScriptedLlmProvider.fromList([{ a: "1" }, { a: "2" }]);
    expect((await llm.generate(req())).value).toEqual({ a: "1" });
    expect((await llm.generate(req())).value).toEqual({ a: "2" });
    expect(llm.calls.length).toBe(2);
    expect(llm.calls[1]!.callIndex).toBe(1);
  });

  test("validates against the request schema", async () => {
    const llm = ScriptedLlmProvider.fromList([{ b: 1 }]);
    const err = (await llm.generate(req()).catch((e) => e)) as HarnessError;
    expect(err).toBeInstanceOf(HarnessError);
    expect(err.kind).toBe("output_validation");
    expect(err.code).toBe("schema");
    expect(err.billed?.usage.inputTokens).toBeGreaterThan(0);
  });

  test("rethrows a thrown HarnessError", async () => {
    const thrown = new HarnessError("transient", "x");
    const llm = new ScriptedLlmProvider(() => {
      throw thrown;
    });
    expect(await llm.generate(req()).catch((e) => e)).toBe(thrown);
  });

  test("past the end", async () => {
    const err = (await ScriptedLlmProvider.fromList([]).generate(req()).catch((e) => e)) as HarnessError;
    expect(err.kind).toBe("config");
  });

  test("usage is deterministic", async () => {
    const llm = ScriptedLlmProvider.fromList([{ a: "같음" }, { a: "같음" }]);
    const first = await llm.generate(req());
    const second = await llm.generate(req());
    expect(first.usage).toEqual(second.usage);
    expect(first.usage.cachedTokens).toBe(0);
  });
});
