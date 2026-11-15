// The pdf_ingest stage (P3-03, D-P3-2, D-P3-3) with a fake extractor: field mapping, the
// per-workspace memo on file content, PdfError as an input failure without retry, and a
// missing file.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../src/errors.ts";
import { pdfIngestStage, type PdfExtractor } from "../src/pdf/ingest.ts";
import { testEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
});
afterEach(() => env.close());

const TWO_PAGES = {
  pageCount: 2,
  scanned: false,
  pages: [
    { pageNo: 1, text: "가나다", charCount: 3, hasTextLayer: false },
    { pageNo: 2, text: "abc defghij klmnop qrstuvwxyz", charCount: 25, hasTextLayer: true },
  ],
};

/** A fake extractor that counts its calls. */
function counting(impl: () => Promise<Awaited<ReturnType<PdfExtractor>>> = async () => TWO_PAGES) {
  const calls: string[] = [];
  const extract: PdfExtractor = async (path) => {
    calls.push(path);
    return impl();
  };
  return { extract, calls };
}

function pdfFile(name: string, content = "%PDF-fake"): string {
  const path = join(env.dir, name);
  writeFileSync(path, content);
  return path;
}

const jobRun = (jobId: string, scope = "ws") => env.harness().job({ jobId: env.job(jobId), scope });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err
  );
}

describe("pdf_ingest stage", () => {
  test("runs the extractor once and maps fields", async () => {
    const { extract, calls } = counting();
    const res = await jobRun("j1").run(pdfIngestStage(extract), { path: pdfFile("a.pdf") });
    expect(res.value.page_count).toBe(2);
    expect(res.value.scanned).toBe(false);
    expect(res.value.pages[0]).toEqual({ page_no: 1, text: "가나다", char_count: 3, has_text_layer: false });
    expect(res.value.pages[1]!.has_text_layer).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("same file content hits the memo", async () => {
    const { extract, calls } = counting();
    const stage = pdfIngestStage(extract);
    const first = await jobRun("j1").run(stage, { path: pdfFile("a.pdf") });
    const second = await jobRun("j2").run(stage, { path: pdfFile("b.pdf") });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(calls).toHaveLength(1);
  });

  test("other workspace does not share the memo", async () => {
    const { extract, calls } = counting();
    const stage = pdfIngestStage(extract);
    await jobRun("j1", "ws-a").run(stage, { path: pdfFile("a.pdf") });
    const other = await jobRun("j2", "ws-b").run(stage, { path: pdfFile("b.pdf") });
    expect(other.cacheHit).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test("extractor PdfError becomes input error", async () => {
    const { extract, calls } = counting(async () => {
      throw Object.assign(new Error("x"), { name: "PdfError", code: "encrypted" });
    });
    const err = await rejection(jobRun("j1").run(pdfIngestStage(extract), { path: pdfFile("a.pdf") }));
    expect(err).toBeInstanceOf(HarnessError);
    expect((err as HarnessError).kind).toBe("input");
    expect((err as HarnessError).code).toBe("encrypted");
    expect(calls).toHaveLength(1);
  });

  test("missing file is input error", async () => {
    const { extract, calls } = counting();
    const err = await rejection(jobRun("j1").run(pdfIngestStage(extract), { path: join(env.dir, "nope.pdf") }));
    expect(err).toBeInstanceOf(HarnessError);
    expect((err as HarnessError).kind).toBe("input");
    expect(calls).toHaveLength(0);
  });
});
