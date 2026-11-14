// A dependency-free zip writer for data exports (P5-08, D-P5-8). Entries are stored, not
// compressed (method 0): the audio is compressed already and the writer stays small. Each
// entry streams through in chunks with a running CRC-32, then a data descriptor carries the
// CRC and size (flag bit 3), so no file is ever held in memory. No ZIP64: a file, the archive
// or the entry count past the classic limits throws "export too large".

import { open } from "node:fs/promises";
import * as zlib from "node:zlib";

export interface ZipEntry {
  /** A relative path with `/` separators. */
  name: string;
  /** The expected size; checked against the zip limits before writing. */
  size: number;
  open(): AsyncIterable<Uint8Array> | Uint8Array;
}

export const ZIP_TOO_LARGE = "export too large";

const LIMIT_32 = 0xffffffff; // the ZIP64 sentinel: every size and offset must stay below it
const MAX_ENTRIES = 0xffff;
const FLAGS = 0x0808; // bit 3: sizes in a data descriptor; bit 11: UTF-8 names
const VERSION = 20;
const VERSION_MADE_BY = (3 << 8) | VERSION; // Unix, so the external attributes carry a mode
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const FILE_MODE = 0o100644;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const nativeCrc32 = (zlib as unknown as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;

/** CRC-32 (IEEE) of `chunk`, continuing from `seed` (the CRC of the bytes before it). */
export function crc32(chunk: Uint8Array, seed = 0): number {
  if (nativeCrc32) return nativeCrc32(chunk, seed) >>> 0;
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < chunk.length; i++) c = TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

/** The name as UTF-8 bytes; throws for anything but a plain relative path. */
function entryName(name: string): Uint8Array {
  const parts = name.split("/");
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[A-Za-z]:/.test(name) ||
    parts.some((p) => p === "" || p === "." || p === "..")
  ) {
    throw new Error(`unsafe zip entry name: ${JSON.stringify(name)}`);
  }
  const bytes = encoder.encode(name);
  if (bytes.length > 0xffff) throw new Error("zip entry name too long");
  return bytes;
}

function localHeader(name: Uint8Array): Uint8Array {
  const b = new Uint8Array(30 + name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, VERSION, true);
  v.setUint16(6, FLAGS, true);
  v.setUint16(8, 0, true); // stored
  v.setUint16(10, DOS_TIME, true);
  v.setUint16(12, DOS_DATE, true);
  // CRC and sizes (14..25) stay 0: they follow in the data descriptor.
  v.setUint16(26, name.length, true);
  v.setUint16(28, 0, true);
  b.set(name, 30);
  return b;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const b = new Uint8Array(16);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x08074b50, true);
  v.setUint32(4, crc, true);
  v.setUint32(8, size, true);
  v.setUint32(12, size, true);
  return b;
}

interface Written {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

function centralHeader(e: Written): Uint8Array {
  const b = new Uint8Array(46 + e.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, VERSION_MADE_BY, true);
  v.setUint16(6, VERSION, true);
  v.setUint16(8, FLAGS, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, DOS_TIME, true);
  v.setUint16(14, DOS_DATE, true);
  v.setUint32(16, e.crc, true);
  v.setUint32(20, e.size, true);
  v.setUint32(24, e.size, true);
  v.setUint16(28, e.name.length, true);
  // extra (30), comment (32), disk (34), internal attributes (36): 0
  v.setUint32(38, (FILE_MODE << 16) >>> 0, true);
  v.setUint32(42, e.offset, true);
  b.set(e.name, 46);
  return b;
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const b = new Uint8Array(22);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  return b;
}

const tooLarge = () => new Error(ZIP_TOO_LARGE);

/**
 * Writes `entries` to a new file at `path` (mode 0600, replaced if it exists). On an error
 * the partial file stays for the caller to delete.
 */
export async function writeZip(path: string, entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): Promise<{ bytes: number; files: number }> {
  // The mode applies when the file is created: it is never readable by others, not even briefly.
  const handle = await open(path, "w", 0o600);
  let offset = 0;
  const write = async (chunk: Uint8Array) => {
    let done = 0;
    while (done < chunk.length) {
      const { bytesWritten } = await handle.write(chunk, done, chunk.length - done);
      done += bytesWritten;
    }
    offset += chunk.length;
  };
  const written: Written[] = [];
  try {
    await handle.chmod(0o600);
    for await (const entry of entries) {
      if (written.length >= MAX_ENTRIES) throw tooLarge();
      if (entry.size >= LIMIT_32) throw tooLarge();
      const name = entryName(entry.name);
      const start = offset;
      await write(localHeader(name));
      let crc = 0;
      let size = 0;
      const body = entry.open();
      const chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> = body instanceof Uint8Array ? [body] : body;
      for await (const chunk of chunks) {
        if (chunk.length === 0) continue;
        crc = crc32(chunk, crc);
        size += chunk.length;
        if (size >= LIMIT_32) throw tooLarge();
        await write(chunk);
      }
      await write(dataDescriptor(crc, size));
      if (offset >= LIMIT_32) throw tooLarge();
      written.push({ name, crc, size, offset: start });
    }
    const cdOffset = offset;
    for (const e of written) await write(centralHeader(e));
    const cdSize = offset - cdOffset;
    if (offset >= LIMIT_32) throw tooLarge();
    await write(endRecord(written.length, cdSize, cdOffset));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { bytes: offset, files: written.length };
}
