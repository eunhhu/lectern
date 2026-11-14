// Test PDFs built in the test run (nothing downloaded). English pages come from pdf-lib's
// standard Helvetica; it cannot encode Hangul, so a Korean page is a hand-written minimal
// PDF whose Type0 font maps glyph ids to Unicode through a ToUnicode CMap (no font file:
// pdf.js reads the text without drawing it).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** One page per string; "\n" starts a new line 14 units lower. An empty string is a blank page. */
export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    if (!text) continue;
    text.split("\n").forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 14, size: 12, font }));
  }
  return doc.save();
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** A one-page PDF showing `text` (any BMP characters) through an Identity-H font and ToUnicode. */
export function makeKoreanPdf(text: string): Uint8Array {
  const chars = [...text];
  const cids = new Map<string, number>();
  for (const ch of chars) if (!cids.has(ch)) cids.set(ch, cids.size + 1);
  const shown = chars.map((ch) => hex4(cids.get(ch)!)).join("");
  const content = `BT /F1 12 Tf 50 700 Td <${shown}> Tj ET`;
  const bfchar = [...cids].map(([ch, cid]) => `<${hex4(cid)}> <${hex4(ch.codePointAt(0)!)}>`).join("\n");
  const cmap = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    `${cids.size} beginbfchar`,
    bfchar,
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /TestKorean /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestKorean /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 >>",
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    "<< /Type /FontDescriptor /FontName /TestKorean /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
  ];
  // Everything above is ASCII, so string length equals byte length for the xref offsets.
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) body += `${String(at).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const dirs: string[] = [];

/** Writes `bytes` to `name` in a fresh temporary directory; removeTemp() deletes them all. */
export async function writeTemp(bytes: Uint8Array, name: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "lectern-pdf-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

export function removeTemp(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
