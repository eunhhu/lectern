import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractResultSchema, templateOutputSchema, type RecordingDomain } from "@lectern/domain";
import { loadTemplate, TEMPLATE_IDS, TEMPLATES_DIR, templateForDomain, type TemplateKey } from "../src/templates.ts";

const scratch = mkdtempSync(join(tmpdir(), "lectern-templates-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const keys = (id: string) => loadTemplate(id).def.sections.map((s) => s.key);
const trueFlags = (id: string) =>
  Object.entries(loadTemplate(id).def.extract)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .sort();

describe("note templates", () => {
  test("every shipped template parses", () => {
    for (const id of TEMPLATE_IDS) {
      const t = loadTemplate(id);
      expect(String(t.def.id)).toBe(id);
      expect(t.def.version).toBe(1);
    }
  });

  test("section keys and order match the contract", () => {
    expect(keys("lecture")).toEqual(["summary", "exam_points", "topics", "quotes", "glossary", "events"]);
    expect(keys("meeting")).toEqual(["summary", "decisions", "action_items", "topics", "open_issues", "next_events"]);
    expect(keys("seminar")).toEqual(["summary", "claims", "qa", "references", "glossary"]);
    expect(keys("interview")).toEqual(["context", "answers", "quotes", "follow_ups"]);
    expect(keys("general")).toEqual(["summary", "topics", "action_items", "events"]);
  });

  test("required sections", () => {
    const required = (id: string) => loadTemplate(id).def.sections.filter((s) => s.required).map((s) => s.key);
    expect(required("lecture")).toEqual(["summary", "topics"]);
    expect(required("meeting")).toEqual(["summary", "topics"]);
    expect(required("seminar")).toEqual(["summary", "claims"]);
    expect(required("interview")).toEqual(["context", "answers"]);
    expect(required("general")).toEqual(["summary", "topics"]);
  });

  test("questions are off everywhere", () => {
    for (const id of TEMPLATE_IDS) {
      const { def } = loadTemplate(id);
      expect(def.extract.questions).toBe(false);
      expect(def.question_kinds).toEqual([]);
    }
  });

  test("extract flags", () => {
    expect(trueFlags("lecture")).toEqual(["events", "glossary"]);
    expect(trueFlags("meeting")).toEqual(["action_items", "decisions", "events"]);
    expect(trueFlags("seminar")).toEqual(["glossary"]);
    expect(trueFlags("interview")).toEqual([]);
    expect(trueFlags("general")).toEqual(["action_items", "events"]);
    for (const id of TEMPLATE_IDS) expect(Object.keys(loadTemplate(id).def.extract)).toHaveLength(5);
  });

  test("output and extract schemas build", () => {
    for (const id of TEMPLATE_IDS) {
      const { def } = loadTemplate(id);
      expect(() => templateOutputSchema(def)).not.toThrow();
      expect(() => extractResultSchema(def)).not.toThrow();
    }
    expect(extractResultSchema(loadTemplate("interview").def).parse({})).toEqual({});
  });

  test("template output schema accepts a minimal lecture", () => {
    const schema = templateOutputSchema(loadTemplate("lecture").def);
    const result = schema.safeParse({
      sections: [
        { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "요약", sources: ["#1"], pdf_pages: [] }] },
        { key: "topics", blocks: [] },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("template output schema rejects a missing required section", () => {
    expect(templateOutputSchema(loadTemplate("lecture").def).safeParse({ sections: [] }).success).toBe(false);
  });

  test("prompts carry the rules", () => {
    for (const id of TEMPLATE_IDS) {
      const t = loadTemplate(id);
      expect(t.structurePrompt).toContain("지어내");
      expect(t.structurePrompt).toContain("#12");
      expect(t.structurePrompt).toContain("출력 언어");
      if (id !== "interview") expect(t.extractPrompt).toContain("raw_expression");
    }
  });

  test("templateForDomain table", () => {
    const table: Array<[RecordingDomain, TemplateKey]> = [
      ["lecture", "lecture"],
      ["meeting", "meeting"],
      ["one_on_one", "meeting"],
      ["call", "meeting"],
      ["seminar", "seminar"],
      ["interview", "interview"],
      ["other", "general"],
    ];
    for (const [domain, template] of table) expect(templateForDomain(domain)).toBe(template);
  });

  test("low confidence falls back to general", () => {
    expect(templateForDomain("lecture", 0.49)).toBe("general");
    expect(templateForDomain("lecture", 0.5)).toBe("lecture");
  });

  test("hash changes with any of the three files", () => {
    const dir = join(scratch, "copy");
    cpSync(fileURLToPath(TEMPLATES_DIR), dir, { recursive: true });
    const original = loadTemplate("lecture", dir).hash;
    for (const file of ["prompt.extract.md", "prompt.structure.md", "template.json"]) {
      const path = join(dir, "lecture", file);
      const before = readFileSync(path, "utf8");
      appendFileSync(path, file === "template.json" ? " " : "x");
      expect(loadTemplate("lecture", dir).hash).not.toBe(original);
      writeFileSync(path, before);
      expect(loadTemplate("lecture", dir).hash).toBe(original);
    }
  });

  test("same files give the same hash", () => {
    const a = loadTemplate("lecture").hash;
    expect(loadTemplate("lecture").hash).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("unknown id", () => {
    expect(() => loadTemplate("nope")).toThrow("unknown template");
  });
});
