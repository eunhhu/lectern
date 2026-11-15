// Reads a stored (method 0) zip in memory for the export tests: the central directory, each
// local header and data descriptor, and checks they agree. Not a general unzip.

import { crc32 } from "../src/export/zip.ts";

export interface ReadEntry {
  name: string;
  crc: number;
  size: number;
  flags: number;
  method: number;
  data: Uint8Array;
}

function fail(message: string): never {
  throw new Error(`bad zip: ${message}`);
}

export function readZip(buf: Uint8Array): ReadEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  if (end < 0 || v.getUint32(end, true) !== 0x06054b50) fail("no end record");
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdOffset = v.getUint32(end + 16, true);
  if (cdOffset + cdSize !== end) fail("central directory does not end at the end record");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const out: ReadEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) fail(`central header ${i}`);
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const compressed = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (compressed !== size) fail(`${name}: compressed size differs`);

    if (v.getUint32(offset, true) !== 0x04034b50) fail(`${name}: local header`);
    const localName = decoder.decode(buf.subarray(offset + 30, offset + 30 + v.getUint16(offset + 26, true)));
    if (localName !== name) fail(`${name}: local name ${localName}`);
    const dataStart = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    const data = buf.subarray(dataStart, dataStart + size);
    const d = dataStart + size;
    if (v.getUint32(d, true) !== 0x08074b50 || v.getUint32(d + 4, true) !== crc || v.getUint32(d + 12, true) !== size) {
      fail(`${name}: data descriptor`);
    }
    if (crc32(data) !== crc) fail(`${name}: CRC`);
    out.push({ name, crc, size, flags, method, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decoder = new TextDecoder();
export const textOf = (e: ReadEntry | undefined) => decoder.decode(e?.data);
export const jsonOf = (e: ReadEntry | undefined) => JSON.parse(textOf(e)) as unknown;
