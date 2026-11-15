// PDF labels in the notes stages (P3-04, D-P3-4, §1.3, §1.8): structure and extract see the
// PDF pages after the transcript, verify turns `pdf_pages` labels into `pdf_page` sources and
// removes numbers outside the context. Without a PDF nothing changes: the prompts and memo
// keys are the P1 ones byte for byte. Scripted model, no network.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TemplateOutput } from "@lectern/domain";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { canonicalJson, sha256Hex } from "../src/hash.ts";
import { extractStage } from "../src/notes/extract.ts";
import { runNotesPipeline } from "../src/notes/pipeline.ts";
import { structureStage } from "../src/notes/structure.ts";
import { verifyDocument, type VerifyInput, type VerifySegment } from "../src/notes/verify.ts";
import type { PdfContext } from "../src/pdf/context.ts";
import type { LlmRequest } from "../src/providers.ts";
import { loadRouting } from "../src/routing.ts";
import { loadTemplate } from "../src/templates.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";
import { answerFor, extractOut, fixtureTranscript, kindOf, pipelineInput, RECORDED_AT_MS, structureOut } from "./notes-helpers.ts";

// sha256 of canonical { system, context, instruction } of the structure and extract requests,
// and their stage keys, for notes-helpers' fixture transcript and the lecture template, taken
// from the P1 code before P3-04. A PDF-less run must keep them; a deliberate prompt or
// template change updates them.
const P1_STRUCTURE_REQUEST = "26a406a3683b527f2c0eb98cce8f3e5466ac4c03aaa889764736a84297a47063";
const P1_EXTRACT_REQUEST = "249ce9cdb08559a8cb0df1988248fdc45e7ade0f2b255ed0e5ac7993cb5c9d26";
const P1_STRUCTURE_KEY = "d5225f2084c6b8749a34ced4c9ffb1e5644c1d907f50f4f3d907feb1b2b81ec7";
const P1_EXTRACT_KEY = "66978b6c595bf19b2810e05e05c5d79e8f537563a41979a9327938ec58837323";

const segments: VerifySegment[] = Array.from({ length: 4 }, (_, idx) => ({
  idx,
  start_ms: idx * 60000,
  end_ms: idx * 60000 + 55000,
  speaker: "S1",
  text: `내용 ${idx} 에 대한 설명`,
}));

const para = (text: string, sources: string[], pdf_pages: number[] = []) => ({ type: "paragraph", heading: null, text, sources, pdf_pages });
const structureWith = (block: unknown): TemplateOutput =>
  ({
    sections: [
      { key: "summary", blocks: [para("요약", ["#1"])] },
      { key: "topics", blocks: [block] },
    ],
  }) as TemplateOutput;

const verifyInput = (over: Partial<VerifyInput> = {}): VerifyInput => ({
  template: loadTemplate("lecture"),
  structure: structureWith(para("주제", ["#2"])),
  extract: {},
  transcript: { segments, gaps: [] },
  recordedAtMs: RECORDED_AT_MS,
  recordedAtSource: "client",
  tz: "Asia/Seoul",
  language: "ko",
  ...over,
});

const topicsBlock = (out: Awaited<ReturnType<typeof verifyDocument>>) => out.body.sections.find((s) => s.key === "topics")!.blocks[0]! as any;
const topicsReport = (out: Awaited<ReturnType<typeof verifyDocument>>) => out.report.items.find((i) => i.ref === "topics#1")!;

const PDF: PdfContext = {
  text: "[PDF 1] (자료 1, 3쪽)\n운영 모드 ECB CBC\n\n[PDF 2] (자료 1, 7쪽)\n초기화 벡터 IV",
  labels: [
    { label: 1, asset_id: "ast_a", page_no: 3 },
    { label: 2, asset_id: "ast_a", page_no: 7 },
  ],
};

describe("verify: pdf_pages labels", () => {
  test("label becomes pdf_page source", async () => {
    const out = await verifyDocument(
      verifyInput({ structure: structureWith(para("주제", ["#2"], [2, 2])), pdfLabels: [{ label: 2, asset_id: "ast_a", page_no: 7 }] }),
      null
    );
    const block = topicsBlock(out);
    expect(block.sources[0]).toMatchObject({ kind: "transcript", start_idx: 2, end_idx: 2 });
    expect(block.sources.filter((s: any) => s.kind === "pdf_page")).toEqual([{ kind: "pdf_page", asset_id: "ast_a", page: 7 }]);
    expect(topicsReport(out)).toMatchObject({ outcome: "ok", reasons: [] });
  });

  test("label outside the set is dropped", async () => {
    const out = await verifyDocument(verifyInput({ structure: structureWith(para("주제", ["#2"], [5, 1])), pdfLabels: PDF.labels }), null);
    const block = topicsBlock(out);
    expect(block.sources.filter((s: any) => s.kind === "pdf_page")).toEqual([{ kind: "pdf_page", asset_id: "ast_a", page: 3 }]);
    expect(topicsReport(out)).toMatchObject({ outcome: "fixed", reasons: ["pdf_page_out_of_set"] });
  });

  test("no pdf context drops all labels", async () => {
    const out = await verifyDocument(verifyInput({ structure: structureWith(para("주제", ["#2"], [1])) }), null);
    expect(topicsBlock(out).sources.some((s: any) => s.kind === "pdf_page")).toBe(false);
    expect(topicsReport(out).reasons).toContain("pdf_page_out_of_set");
  });

  test("list items map their own labels", async () => {
    const list = {
      type: "list",
      heading: null,
      style: "bullet",
      sources: [],
      pdf_pages: [],
      items: [
        { text: "가", sources: ["#1"], pdf_pages: [1] },
        { text: "나", sources: [], pdf_pages: [2] },
        { text: "다", sources: [], pdf_pages: [9] },
      ],
    };
    const out = await verifyDocument(verifyInput({ structure: structureWith(list), pdfLabels: PDF.labels }), null);
    const block = topicsBlock(out);
    expect(block.items.map((i: any) => i.text)).toEqual(["가", "나"]);
    expect(block.items[1].sources).toEqual([{ kind: "pdf_page", asset_id: "ast_a", page: 7 }]);
    expect(topicsReport(out).reasons).toEqual(expect.arrayContaining(["pdf_page_out_of_set", "item_dropped_no_source"]));
  });

  test("transcript sources unchanged", async () => {
    const without = await verifyDocument(verifyInput(), null);
    const withLabels = await verifyDocument(verifyInput({ pdfLabels: PDF.labels }), null);
    expect(withLabels).toEqual(without);
    expect(topicsBlock(without).sources).toEqual([{ kind: "transcript", start_idx: 2, end_idx: 2 }]);
  });
});

describe("notes prompts with and without a PDF", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = testEnv();
    env.job("j");
  });
  afterEach(() => env.close());

  const compact = () => fixtureTranscript().segments.map((s) => ({ idx: s.idx, start_ms: s.start_ms, speaker: s.speaker, text: s.text }));
  const requestHash = (req: LlmRequest<unknown>) => sha256Hex(canonicalJson({ system: req.system, context: req.context, instruction: req.instruction }));

  async function runBoth(pdf?: PdfContext) {
    const llm = ScriptedLlmProvider.fromList([structureOut, extractOut]);
    const run = env.harness().job({ jobId: "j", scope: "ws" });
    const template = loadTemplate("lecture");
    const segs = compact();
    await run.run(structureStage(llm, loadRouting()), { template, segments: segs, language: "ko", ...(pdf ? { pdf } : {}) });
    await run.run(extractStage(llm, loadRouting()), {
      template,
      segments: segs,
      language: "ko",
      recordedAtMs: RECORDED_AT_MS,
      tz: "Asia/Seoul",
      ...(pdf ? { pdf } : {}),
    });
    const keys = Object.fromEntries(
      rows<{ stage: string; stage_key: string }>(env.db, "SELECT stage, stage_key FROM stage_run").map((r) => [r.stage, r.stage_key])
    );
    return { structure: llm.calls[0]!.req, extract: llm.calls[1]!.req, keys };
  }

  test("prompts unchanged without pdf", async () => {
    const { structure, extract, keys } = await runBoth();
    expect(structure.context).toHaveLength(1);
    expect(requestHash(structure)).toBe(P1_STRUCTURE_REQUEST);
    expect(requestHash(extract)).toBe(P1_EXTRACT_REQUEST);
    expect(keys).toEqual({ structure: P1_STRUCTURE_KEY, extract: P1_EXTRACT_KEY });
  });

  test("an empty pdf context is the same as none", async () => {
    const { structure, extract, keys } = await runBoth({ text: "", labels: [] });
    expect(requestHash(structure)).toBe(P1_STRUCTURE_REQUEST);
    expect(requestHash(extract)).toBe(P1_EXTRACT_REQUEST);
    expect(keys).toEqual({ structure: P1_STRUCTURE_KEY, extract: P1_EXTRACT_KEY });
  });

  test("pdf context sits after transcript", async () => {
    const { structure, extract, keys } = await runBoth(PDF);
    const [transcript, pdf] = structure.context as Array<{ type: "text"; text: string }>;
    expect(transcript!.text.startsWith("전사:\n#0 ")).toBe(true);
    expect(pdf!.text).toBe(`자료(PDF) 관련 쪽:\n${PDF.text}`);
    expect(structure.instruction).toContain("pdf_pages에 위 [PDF 번호]만");
    expect(structure.instruction.startsWith("위 전사로 노트를 만든다.")).toBe(true);
    // structure and extract share the system text, transcript and PDF parts (prefix cache).
    expect(extract.system).toBe(structure.system);
    expect(extract.context).toEqual(structure.context);
    expect(keys.structure).not.toBe(P1_STRUCTURE_KEY);
    expect(keys.extract).not.toBe(P1_EXTRACT_KEY);
  });

  test("pipeline maps the labels it showed", async () => {
    const llm = new ScriptedLlmProvider((req) => {
      if (kindOf(req) !== "structure") return answerFor(req);
      return {
        sections: [
          { key: "summary", blocks: [para("운영 모드를 다룬다", ["#1"], [1])] },
          { key: "topics", blocks: [para("IV가 필요하다", ["#3"], [2, 4])] },
        ],
      };
    });
    const result = await runNotesPipeline(env.harness().job({ jobId: "j", scope: "ws" }), pipelineInput({ pdf: PDF }), {
      llm,
      routing: loadRouting(),
    });
    const blocks = result.body.sections.flatMap((s) => s.blocks) as any[];
    const pdfRefs = blocks.flatMap((b) => (b.sources ?? []).filter((s: any) => s.kind === "pdf_page"));
    expect(pdfRefs).toEqual([
      { kind: "pdf_page", asset_id: "ast_a", page: 3 },
      { kind: "pdf_page", asset_id: "ast_a", page: 7 },
    ]);
    expect(result.report.items.find((i) => i.ref === "topics#1")!.reasons).toContain("pdf_page_out_of_set");
  });
});
