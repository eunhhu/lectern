// A scripted LlmProvider for tests and offline evals: answers come from a function or a
// list, are validated against the request schema like a real provider's, and usage is
// derived deterministically from the request and answer sizes.

import { HarnessError } from "../errors.ts";
import type { LlmProvider, LlmRequest, ProviderCallResult } from "../providers.ts";

export const SCRIPTED_LLM_PROVIDER_ID = "scripted-llm";

export type ScriptedAnswer = (req: LlmRequest<unknown>, callIndex: number) => unknown | Promise<unknown>;

export class ScriptedLlmProvider implements LlmProvider {
  readonly id = SCRIPTED_LLM_PROVIDER_ID;
  readonly calls: Array<{ callIndex: number; req: LlmRequest<unknown> }> = [];

  constructor(private readonly answer: ScriptedAnswer) {}

  /** Call n returns values[n]; a call past the end is a config error. */
  static fromList(values: unknown[]): ScriptedLlmProvider {
    return new ScriptedLlmProvider((_req, callIndex) => {
      if (callIndex >= values.length) {
        throw new HarnessError("config", `scripted llm: no answer for call ${callIndex}`);
      }
      return values[callIndex];
    });
  }

  async generate<T>(req: LlmRequest<T>): Promise<{ value: T; raw: unknown } & ProviderCallResult> {
    const callIndex = this.calls.length;
    this.calls.push({ callIndex, req: req as LlmRequest<unknown> });
    const raw = await this.answer(req as LlmRequest<unknown>, callIndex);
    if (raw instanceof Error) throw raw;

    const promptChars =
      req.system.length +
      req.context.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0) +
      req.instruction.length;
    const billed: ProviderCallResult = {
      usage: {
        inputTokens: Math.ceil(promptChars / 3),
        cachedTokens: 0,
        outputTokens: Math.ceil((JSON.stringify(raw) ?? "").length / 3),
      },
      model: req.model,
      requestId: null,
    };
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new HarnessError(
        "output_validation",
        `scripted llm call ${callIndex}: answer does not match the schema: ${parsed.error.message.slice(0, 200)}`,
        { code: "schema", billed }
      );
    }
    return { value: parsed.data, raw, ...billed };
  }
}
