// Per-stage model routing for the notes pipeline (CONTRACTS §1.4, D-P1-6). Models change
// only through routing.json, never through an environment variable.

import { readFileSync } from "node:fs";
import { resolveGeminiModel } from "@lectern/core";
import { z } from "zod";

export type RoutingStage = "classify" | "structure" | "extract" | "repair" | "ocr";
export type Routing = Record<RoutingStage, { provider: "gemini"; model: string; maxOutputTokens: number }>;

export const ROUTING_STAGES: readonly RoutingStage[] = ["classify", "structure", "extract", "repair", "ocr"];

export const ROUTING_PATH = new URL("../routing.json", import.meta.url);

const RouteEntry = z.object({
  provider: z.literal("gemini"),
  model: z.string().min(1),
  maxOutputTokens: z.int().positive(),
});

const RoutingFile = z.object({
  classify: RouteEntry,
  structure: RouteEntry,
  extract: RouteEntry,
  repair: RouteEntry,
  ocr: RouteEntry,
});

/** Reads and checks routing.json. Not cached: tests pass other paths. */
export function loadRouting(path: URL | string = ROUTING_PATH): Routing {
  const parsed = RoutingFile.parse(JSON.parse(readFileSync(path, "utf8")));
  for (const stage of ROUTING_STAGES) {
    const model = parsed[stage].model;
    if (model.endsWith("-latest") || resolveGeminiModel(model) !== model) {
      throw new Error(`routing.${stage}: model ${model} is not in the Gemini allowlist`);
    }
  }
  return parsed;
}
