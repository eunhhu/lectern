import { describe, expect, test } from "bun:test";
import { assignPdf, classifyFile, pairFiles, parseFileName, type FileLike } from "../src/lib/pairing.ts";

const T = Date.UTC(2026, 9, 19, 5, 0); // 2026-10-19 14:00 KST
const HOUR = 3_600_000;

function file(name: string, opts: Partial<FileLike> = {}): FileLike {
  const ext = name.split(".").pop();
  const type = ext === "pdf" ? "application/pdf" : ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : "";
  return { name, size: 1024, type, lastModified: T, ...opts };
}

const names = (files: FileLike[]) => files.map((f) => f.name);

describe("classifyFile", () => {
  test("recognises audio by extension or MIME and PDFs", () => {
    expect(classifyFile(file("a.m4a"))).toBe("audio");
    expect(classifyFile({ name: "voice.WAV", type: "" })).toBe("audio");
    expect(classifyFile({ name: "clip.oga", type: "audio/ogg" })).toBe("audio");
    expect(classifyFile(file("slides.pdf"))).toBe("pdf");
    expect(classifyFile({ name: "notes.docx", type: "application/vnd.openxmlformats" })).toBeNull();
    expect(classifyFile({ name: "photo.png", type: "image/png" })).toBeNull();
  });
});

describe("parseFileName", () => {
  test("extracts dates, times, numbers and words, dropping filler", () => {
    const p = parseFileName("Recording_20261019_143005.m4a");
    expect(p.dayKey).toBe("10-19");
    expect(p.local).toEqual({ year: 2026, month: 10, day: 19, hour: 14, minute: 30 });
    expect(p.words).toEqual([]);
    expect(p.title).toBe("");

    const q = parseFileName("운영체제_7주차_스케줄링_강의자료.pdf");
    expect(q.words).toEqual(["운영체제", "주차", "스케줄링"]);
    expect(q.numbers).toEqual(["7"]);
    expect(q.dayKey).toBeNull();
  });

  test("normalises macOS NFD names to NFC", () => {
    const nfd = "운영체제 7주차.m4a".normalize("NFD");
    expect(parseFileName(nfd).words).toEqual(["운영체제", "주차"]);
    expect(parseFileName(nfd).title).toBe("운영체제 7주차");
  });

  test("reads Korean month-day dates and explicit part markers only", () => {
    expect(parseFileName("자료구조 10월 9일.pdf").dayKey).toBe("10-09");
    expect(parseFileName("자료구조 강의 2부.m4a").part).toBe(2);
    expect(parseFileName("lecture_part1.mp3").part).toBe(1);
    // A bare trailing number or a macOS duplicate suffix is not a part.
    expect(parseFileName("운영체제 7.m4a").part).toBeNull();
    expect(parseFileName("새로운 녹음 (1).m4a").part).toBeNull();
    // "부" inside a word is not a part marker.
    expect(parseFileName("3부서 회의.m4a").part).toBeNull();
  });
});

describe("pairFiles", () => {
  test("pairs by shared words and numbers", () => {
    const r = pairFiles([
      file("운영체제 7주차.m4a"),
      file("자료구조 5주차.m4a"),
      file("운영체제_7주차_스케줄링.pdf"),
      file("자료구조_05_힙.pdf"),
    ]);
    expect(r.groups.map((g) => [names(g.audio), g.pdfs.map((p) => p.file.name)])).toEqual([
      [["운영체제 7주차.m4a"], ["운영체제_7주차_스케줄링.pdf"]],
      [["자료구조 5주차.m4a"], ["자료구조_05_힙.pdf"]],
    ]);
    expect(r.groups[0]!.pdfs[0]!.reasons).toEqual(expect.arrayContaining(["name", "number"]));
    expect(r.unmatched).toEqual([]);
  });

  test("different numbers never pair, even with identical words", () => {
    const r = pairFiles([file("운영체제 6주차.m4a"), file("운영체제 8주차.m4a"), file("운영체제 7주차.pdf")]);
    expect(r.groups.every((g) => g.pdfs.length === 0)).toBe(true);
    expect(names(r.unmatched)).toEqual(["운영체제 7주차.pdf"]);
  });

  test("pairs device-named recordings with PDFs by date", () => {
    const r = pairFiles([
      file("Recording_20261019_143005.m4a", { lastModified: T + 5 * HOUR }),
      file("Recording_20261017_100000.m4a", { lastModified: T + 5 * HOUR }),
      file("강의자료_2026-10-19.pdf", { lastModified: T - 20 * HOUR }),
    ]);
    expect(r.groups[0]!.pdfs.map((p) => p.file.name)).toEqual(["강의자료_2026-10-19.pdf"]);
    expect(r.groups[0]!.pdfs[0]!.reasons).toContain("date");
    expect(r.groups[1]!.pdfs).toEqual([]);
  });

  test("conflicting dates never pair", () => {
    const r = pairFiles([
      file("세미나_20261019.m4a"),
      file("세미나 자료_20261012.pdf"),
      file("회의.m4a", { lastModified: T + 30 * HOUR }),
    ]);
    expect(names(r.unmatched)).toEqual(["세미나 자료_20261012.pdf"]);
  });

  test("falls back to modification time when the names say nothing", () => {
    const r = pairFiles([
      file("새로운 녹음 23.m4a", { lastModified: T }),
      file("새로운 녹음 24.m4a", { lastModified: T + 6 * HOUR }),
      file("handout.pdf", { lastModified: T + 6 * HOUR - 10 * 60_000 }),
    ]);
    // "23" vs no number in the PDF: no conflict, so the 10-minute gap decides.
    expect(r.groups[1]!.pdfs.map((p) => p.file.name)).toEqual(["handout.pdf"]);
    expect(r.groups[1]!.pdfs[0]!.reasons).toEqual(["time"]);
    // An hour apart is not enough on its own.
    const far = pairFiles([file("a.m4a"), file("b.m4a", { lastModified: T + 9 * HOUR }), file("c.pdf", { lastModified: T + HOUR })]);
    expect(names(far.unmatched)).toEqual(["c.pdf"]);
  });

  test("time alone does not choose between recordings that are about as close", () => {
    const r = pairFiles([
      file("새로운 녹음 23.m4a", { lastModified: T }),
      file("새로운 녹음 24.m4a", { lastModified: T + 60_000 }),
      file("handout.pdf", { lastModified: T + 30_000 }),
    ]);
    expect(names(r.unmatched)).toEqual(["handout.pdf"]);
  });

  test("a drop with one recording takes every PDF", () => {
    const r = pairFiles([file("녹음.m4a"), file("slides.pdf", { lastModified: T - 48 * HOUR }), file("reading.pdf")]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.pdfs.map((p) => p.file.name).sort()).toEqual(["reading.pdf", "slides.pdf"]);
    expect(r.groups[0]!.pdfs.find((p) => p.file.name === "slides.pdf")!.reasons).toEqual(["only_recording"]);
    expect(r.unmatched).toEqual([]);
  });

  test("one recording can take several matching PDFs", () => {
    const r = pairFiles([
      file("미시경제학 4주차.m4a"),
      file("운영체제 7주차.m4a"),
      file("미시경제학 4주차 슬라이드.pdf"),
      file("미시경제학 4주차 연습문제.pdf"),
    ]);
    expect(r.groups[0]!.pdfs).toHaveLength(2);
    expect(r.groups[1]!.pdfs).toHaveLength(0);
  });

  test("explicit parts become one recording, ordered by part number", () => {
    const r = pairFiles([file("자료구조 5주차 2부.m4a"), file("자료구조 5주차 1부.m4a"), file("자료구조 5주차.pdf")]);
    expect(r.groups).toHaveLength(1);
    expect(names(r.groups[0]!.audio)).toEqual(["자료구조 5주차 1부.m4a", "자료구조 5주차 2부.m4a"]);
    expect(r.groups[0]!.title).toBe("자료구조 5주차");
    expect(r.groups[0]!.pdfs).toHaveLength(1);
  });

  test("duplicate part numbers stay separate recordings", () => {
    const r = pairFiles([file("세미나 1부.m4a"), file("세미나 1부.mp3")]);
    expect(r.groups).toHaveLength(2);
  });

  test("titles come from the name; the start time from a dated name, in local time", () => {
    const r = pairFiles([file("운영체제_7주차.m4a"), file("Recording_20261019_143005.m4a")]);
    expect(r.groups[0]!.title).toBe("운영체제 7주차");
    expect(r.groups[0]!.recordedAt).toBeNull();
    expect(r.groups[1]!.title).toBeNull();
    expect(r.groups[1]!.recordedAt).toBe("2026-10-19T05:30:00.000Z"); // 14:30 KST
  });

  test("rejects unsupported and empty files, and PDFs alone form no recording", () => {
    const r = pairFiles([file("notes.docx"), file("empty.m4a", { size: 0 }), file("slides.pdf")]);
    expect(r.rejected.map((x) => [x.file.name, x.reason])).toEqual([
      ["notes.docx", "unsupported"],
      ["empty.m4a", "empty"],
    ]);
    expect(r.groups).toEqual([]);
    expect(names(r.unmatched)).toEqual(["slides.pdf"]);
  });

  test("is deterministic and keeps the drop order", () => {
    const files = [file("b 1주차.m4a"), file("a 2주차.m4a"), file("a 2주차.pdf"), file("b 1주차.pdf")];
    expect(pairFiles(files)).toEqual(pairFiles(files));
    expect(pairFiles(files).groups.map((g) => g.audio[0]!.name)).toEqual(["b 1주차.m4a", "a 2주차.m4a"]);
  });
});

describe("assignPdf", () => {
  test("moves a PDF between groups and out of them", () => {
    const pdf = file("handout.pdf");
    const r = pairFiles([file("a 1주차.m4a"), file("b 2주차.m4a"), pdf]);
    const toB = assignPdf(r, pdf, r.groups[1]!.id);
    expect(toB.groups[1]!.pdfs.map((p) => p.file)).toEqual([pdf]);
    expect(toB.unmatched).toEqual([]);
    const out = assignPdf(toB, pdf, null);
    expect(out.groups.every((g) => g.pdfs.length === 0)).toBe(true);
    expect(out.unmatched).toEqual([pdf]);
  });
});
