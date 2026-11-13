// Note templates (CONTRACTS §1.5, D-P1-7): one directory per template under templates/,
// holding the definition and the structure/extract prompts. The hash of the three files'
// raw bytes goes into the memo key, so editing any of them re-runs the stages that use it.

import { readFileSync } from "node:fs";
import { TemplateDefinition, type RecordingDomain } from "@lectern/domain";
import { sha256Hex } from "./hash.ts";

export const TEMPLATE_IDS = ["lecture", "meeting", "seminar", "interview", "general"] as const;
export type TemplateKey = (typeof TEMPLATE_IDS)[number];

export interface LoadedTemplate {
  def: TemplateDefinition;
  structurePrompt: string;
  extractPrompt: string;
  hash: string;
}

export const TEMPLATES_DIR = new URL("../templates/", import.meta.url);

function fileIn(dir: URL | string, id: string, name: string): URL | string {
  if (dir instanceof URL) return new URL(`${id}/${name}`, dir.href.endsWith("/") ? dir : new URL(`${dir.href}/`));
  return `${dir.replace(/\/+$/, "")}/${id}/${name}`;
}

/** Reads one template from disk. Not cached: tests load edited copies. */
export function loadTemplate(id: string, dir: URL | string = TEMPLATES_DIR): LoadedTemplate {
  if (!(TEMPLATE_IDS as readonly string[]).includes(id)) throw new Error(`unknown template: ${id}`);
  const templateJson = readFileSync(fileIn(dir, id, "template.json"), "utf8");
  const structurePrompt = readFileSync(fileIn(dir, id, "prompt.structure.md"), "utf8");
  const extractPrompt = readFileSync(fileIn(dir, id, "prompt.extract.md"), "utf8");
  const def = TemplateDefinition.parse(JSON.parse(templateJson));
  if (def.id !== id) throw new Error(`template ${id}: template.json has id ${def.id}`);
  return {
    def,
    structurePrompt,
    extractPrompt,
    hash: sha256Hex(`${templateJson}\u0000${structurePrompt}\u0000${extractPrompt}`),
  };
}

/** The default template for a domain; a classification under 0.5 confidence gets `general`. */
export function templateForDomain(domain: RecordingDomain, confidence?: number): TemplateKey {
  if (confidence !== undefined && confidence < 0.5) return "general";
  switch (domain) {
    case "lecture":
      return "lecture";
    case "meeting":
    case "one_on_one":
    case "call":
      return "meeting";
    case "seminar":
      return "seminar";
    case "interview":
      return "interview";
    case "other":
      return "general";
  }
  const unreachable: never = domain;
  throw new Error(`unknown domain: ${String(unreachable)}`);
}
