// Page text of a lecture PDF (docs/v2/pipeline/CONTRACTS.md D-P3-1..3). pdf.js's legacy
// build runs on the calling thread (no worker), reads each page's text items, and joins
// them into lines by position. A page with fewer than MIN_TEXT_CHARS characters has no
// usable text layer; when half or more of the pages are like that the PDF is a scan, and
// nothing here OCRs it (D-P3-3: OCR only after the user confirms its cost). This package
// knows nothing of the database, the server or any model.

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_PDF_PAGES = 500;
/** A page with fewer characters (whitespace not counted) has no usable text layer. */
export const MIN_TEXT_CHARS = 20;

export type PdfErrorCode = "encrypted" | "corrupt" | "too_many_pages" | "unreadable";

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfError";
  }
}

export interface ExtractedPage {
  /** From 1. */
  pageNo: number;
  text: string;
  charCount: number;
  hasTextLayer: boolean;
}

export interface ExtractedPdf {
  pageCount: number;
  pages: ExtractedPage[];
  scanned: boolean;
}

/** The part of a pdf.js text item this package reads; `transform[4]` is x, `transform[5]` is y. */
export interface TextItemLike {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

/** Items whose baselines are this close (in PDF units) are on the same line. */
const SAME_LINE = 2;

/** pdf.js exception names to error codes; anything else is `unreadable`. */
export function classifyPdfError(err: unknown): PdfErrorCode {
  const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "PasswordException") return "encrypted";
  if (name === "InvalidPDFException" || name === "FormatError" || name === "MissingPDFException") return "corrupt";
  return "unreadable";
}

/**
 * Text items of one page as lines, top to bottom: items within SAME_LINE of the previous
 * baseline join that line, ordered by x, with no separator (the PDF emits its own spaces).
 */
export function cleanPageText(items: readonly TextItemLike[]): string {
  const placed = items
    .filter((item) => item.str !== "")
    .map((item) => ({ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; parts: typeof placed }> = [];
  for (const item of placed) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= SAME_LINE) line.parts.push(item);
    else lines.push({ y: item.y, parts: [item] });
  }
  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join("")
        .normalize("NFC")
        .replace(/[ \t ]+/g, " ")
        .trim(),
    )
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

const charCountOf = (text: string) => [...text.replace(/\s/g, "")].length;

/** Reads every page's text; throws PdfError (encrypted, corrupt, too_many_pages, unreadable). */
export async function extractPdfPages(path: string, options: { maxPages?: number } = {}): Promise<ExtractedPdf> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new PdfError("unreadable", "PDF 파일을 읽을 수 없습니다.");
  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new PdfError("unreadable", "PDF 파일을 읽을 수 없습니다.");
  }

  // pdf.js 6 never evaluates code (the old `isEvalSupported` option is gone).
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, verbosity: 0 });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    throw toPdfError(err);
  }

  try {
    const limit = options.maxPages ?? MAX_PDF_PAGES;
    if (doc.numPages > limit) throw new PdfError("too_many_pages", `PDF는 ${MAX_PDF_PAGES}쪽까지 지원합니다.`);
    const pages: ExtractedPage[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        const items = content.items.filter((item): item is (typeof content.items)[number] & TextItemLike => "str" in item);
        const text = cleanPageText(items);
        const charCount = charCountOf(text);
        pages.push({ pageNo: n, text, charCount, hasTextLayer: charCount >= MIN_TEXT_CHARS });
      } finally {
        page.cleanup();
      }
    }
    const withoutText = pages.filter((p) => !p.hasTextLayer).length;
    return { pageCount: doc.numPages, pages, scanned: pages.length > 0 && withoutText * 2 >= pages.length };
  } catch (err) {
    throw toPdfError(err);
  } finally {
    await task.destroy();
  }
}

function toPdfError(err: unknown): PdfError {
  if (err instanceof PdfError) return err;
  const code = classifyPdfError(err);
  const message =
    code === "encrypted"
      ? "암호가 걸린 PDF는 읽을 수 없습니다."
      : code === "corrupt"
        ? "PDF 파일이 손상되었거나 PDF가 아닙니다."
        : "PDF 파일을 읽을 수 없습니다.";
  return new PdfError(code, message);
}
