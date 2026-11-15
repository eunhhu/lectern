// Page text extraction (P3-02, D-P3-1..3): page order, Korean and English text, line
// order, pages without a text layer and the scan rule, the pure line joiner, and the
// classified errors. Every PDF is made in the test run.

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { classifyPdfError, cleanPageText, extractPdfPages, MAX_PDF_PAGES, PdfError, type PdfErrorCode } from "../src/index.ts";
import { makeKoreanPdf, makePdf, removeTemp, writeTemp } from "./make-pdf.ts";

const KOREAN = "안녕하세요 이것은 한국어 문장입니다";
/** KOREAN has 16 characters besides spaces, under MIN_TEXT_CHARS; this one has enough. */
const KOREAN_LONG = "블록 암호의 운영 모드에서 초기화 벡터는 예측할 수 없어야 합니다";
const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });

async function extract(pages: string[], options?: { maxPages?: number }) {
  return extractPdfPages(await writeTemp(await makePdf(pages), "doc.pdf"), options);
}

async function failure(promise: Promise<unknown>): Promise<PdfError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PdfError);
  return err as PdfError;
}

afterAll(() => removeTemp());

describe("extractPdfPages", () => {
  test("english pages in order", async () => {
    const sentences = [
      "Page one has plenty of readable words here",
      "Second page talks about block ciphers and keys",
      "Third page ends the sample document today",
    ];
    const pdf = await extract(sentences);
    expect(pdf.pageCount).toBe(3);
    expect(pdf.pages.map((p) => p.pageNo)).toEqual([1, 2, 3]);
    expect(pdf.pages.map((p) => p.text)).toEqual(sentences);
    expect(pdf.pages.every((p) => p.hasTextLayer)).toBe(true);
    expect(pdf.scanned).toBe(false);
  });

  test("korean page text", async () => {
    const pdf = await extractPdfPages(await writeTemp(makeKoreanPdf(KOREAN), "korean.pdf"));
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pages[0]!.text).toBe(KOREAN);
    // 16 characters besides spaces: under the 20-character rule (D-P3-3).
    expect(pdf.pages[0]).toMatchObject({ charCount: 16, hasTextLayer: false });
    const long = await extractPdfPages(await writeTemp(makeKoreanPdf(KOREAN_LONG), "korean-long.pdf"));
    expect(long.pages[0]!.text).toBe(KOREAN_LONG);
    expect(long.pages[0]!.hasTextLayer).toBe(true);
  });

  test("mixed korean and english", async () => {
    const korean = await extractPdfPages(await writeTemp(makeKoreanPdf(KOREAN_LONG), "korean.pdf"));
    const english = await extract(["English lecture slide with enough text"]);
    expect(korean.pages[0]!.text).toBe(KOREAN_LONG);
    expect(english.pages[0]!.text).toBe("English lecture slide with enough text");
    expect([korean.scanned, english.scanned]).toEqual([false, false]);
  });

  test("line order and spacing", async () => {
    const pdf = await extract(["Alpha line one\nBeta line two\nGamma line three"]);
    expect(pdf.pages[0]!.text).toBe("Alpha line one\nBeta line two\nGamma line three");
  });

  test("empty page has no text layer", async () => {
    const pdf = await extract(["This first page has enough words in it", "", "Last page also has enough words in it"]);
    expect(pdf.pages[1]).toMatchObject({ pageNo: 2, text: "", charCount: 0, hasTextLayer: false });
    expect([pdf.pages[0]!.hasTextLayer, pdf.pages[2]!.hasTextLayer]).toEqual([true, true]);
    expect(pdf.scanned).toBe(false);
  });

  test("short page below 20 chars", async () => {
    const pdf = await extract(["Too short"]);
    expect(pdf.pages[0]).toMatchObject({ charCount: 8, hasTextLayer: false });
    expect(pdf.scanned).toBe(true);
  });

  test("scanned when half or more lack text", async () => {
    expect((await extract(["", "Enough words here to count as text ok"])).scanned).toBe(true);
  });

  test("not scanned below half", async () => {
    expect((await extract(["", "Enough words here to count as text ok", "More than twenty chars of text on page"])).scanned).toBe(false);
  });

  test("corrupt file", async () => {
    const err = await failure(extractPdfPages(await writeTemp(new TextEncoder().encode("not a pdf at all"), "bad.pdf")));
    expect(err.code).toBe("corrupt");
  });

  test("truncated pdf", async () => {
    const whole = await makePdf(["Page one has plenty of readable words here", "Second page has words too"]);
    const err = await failure(extractPdfPages(await writeTemp(whole.slice(0, Math.floor(whole.length * 0.4)), "cut.pdf")));
    expect(["corrupt", "unreadable"]).toContain(err.code);
  });

  test("missing file", async () => {
    const err = await failure(extractPdfPages(join(import.meta.dir, "no-such-file.pdf")));
    expect(err.code).toBe("unreadable");
  });

  test("page limit", async () => {
    const err = await failure(extract(["Page one words here", "Page two words here", "Page three words here"], { maxPages: 2 }));
    expect(err.code).toBe("too_many_pages");
  });

  test("default limit constant", () => {
    expect(MAX_PDF_PAGES).toBe(500);
  });
});

describe("cleanPageText", () => {
  test("cleanPageText sorts by y then x", () => {
    expect(cleanPageText([item("world", 60, 700), item("hello ", 10, 700), item("top", 10, 720)])).toBe("top\nhello world");
  });

  test("cleanPageText collapses spaces", () => {
    expect(cleanPageText([item("a   b\t c", 0, 0)])).toBe("a b c");
  });

  test("cleanPageText NFC", () => {
    const decomposed = "한".normalize("NFD");
    expect(decomposed).not.toBe("한");
    expect(cleanPageText([item(decomposed, 0, 0)])).toBe("한");
  });
});

describe("classifyPdfError", () => {
  test("encrypted pdf is classified from pdf.js's exception name", () => {
    const table: Array<[string, PdfErrorCode]> = [
      ["PasswordException", "encrypted"],
      ["InvalidPDFException", "corrupt"],
      ["FormatError", "corrupt"],
      ["Error", "unreadable"],
    ];
    for (const [name, code] of table) expect(classifyPdfError({ name })).toBe(code);
    expect(classifyPdfError("nothing")).toBe("unreadable");
  });
});
