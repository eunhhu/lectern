import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "@lectern/config";
import { crc32, writeZip, ZIP_TOO_LARGE, type ZipEntry } from "../src/export/zip.ts";
import { readZip, textOf } from "./zip-reader.ts";

// The export zip writer (P5-08): stored entries, CRC-32, data descriptors, UTF-8 names.

const dir = join(config().dataDir, "zip-test");
mkdirSync(dir, { recursive: true });
const encode = (s: string) => new TextEncoder().encode(s);
let n = 0;
const target = () => join(dir, `t${++n}.zip`);

const files: Array<{ name: string; content: string }> = [
  { name: "README.txt", content: "Lectern 데이터 내보내기\n" },
  { name: "recordings/0001-자료구조 3주차/document.md", content: "# 자료구조\n\n- 스택과 큐\n" },
  { name: "recordings/0001-자료구조 3주차/빈 파일.json", content: "" },
];
const entries = (): ZipEntry[] => files.map((f) => ({ name: f.name, size: encode(f.content).length, open: () => encode(f.content) }));

async function run(cmd: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

describe("export zip", () => {
  test("crc32 known value", () => {
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
    // Continuing from a seed is the same as one pass.
    expect(crc32(encode("6789"), crc32(encode("12345")))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test("round trip with the system unzip", async () => {
    const path = target();
    const result = await writeZip(path, entries());
    expect(result.files).toBe(3);
    expect(statSync(path).size).toBe(result.bytes);

    // Always: the central directory, headers and descriptors agree.
    const read = readZip(readFileSync(path));
    expect(read.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, e] of read.entries()) {
      expect(e.method).toBe(0);
      expect(e.flags).toBe(0x0808);
      expect(textOf(e)).toBe(files[i]!.content);
    }

    if (!Bun.which("unzip")) return; // the in-memory check above stands in
    const tested = await run(["unzip", "-t", path]);
    expect(tested.code).toBe(0);
    for (const f of files) {
      const out = await run(["unzip", "-p", path, f.name]);
      expect(out.code).toBe(0);
      expect(out.out).toBe(f.content);
    }
  });

  test("rejects unsafe names", async () => {
    for (const name of ["../x", "/abs", "a\\b", "a/../b", "a//b", "", "C:/x"]) {
      await expect(writeZip(target(), [{ name, size: 1, open: () => encode("x") }])).rejects.toThrow("unsafe zip entry name");
    }
  });

  test("streams large content", async () => {
    const chunk = new Uint8Array(64 * 1024);
    const chunks = 80; // 5 MiB
    let expectedCrc = 0;
    for (let i = 0; i < chunks; i++) {
      chunk.fill(i & 0xff);
      expectedCrc = crc32(chunk, expectedCrc);
    }
    async function* body() {
      for (let i = 0; i < chunks; i++) yield new Uint8Array(chunk.length).fill(i & 0xff);
    }
    const path = target();
    await writeZip(path, [{ name: "audio/0.m4a", size: chunk.length * chunks, open: body }]);
    const [entry] = readZip(readFileSync(path));
    expect(entry!.size).toBe(5 * 1024 * 1024);
    expect(entry!.crc).toBe(expectedCrc);
    expect(statSync(path).size).toBe(30 + "audio/0.m4a".length + 5 * 1024 * 1024 + 16 + 46 + "audio/0.m4a".length + 22);
  });

  test("files past the classic limits are refused, not written as ZIP64", async () => {
    await expect(writeZip(target(), [{ name: "big.m4a", size: 0xffffffff, open: () => new Uint8Array() }])).rejects.toThrow(ZIP_TOO_LARGE);
  });

  test("the file is private", async () => {
    const path = target();
    await writeZip(path, entries());
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
