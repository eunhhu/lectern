// Hashing helpers shared by the memo key (stage.ts) and the blob store (blobs.ts).

import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of a file's bytes, streamed (recordings run to hundreds of MB). */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * JSON with object keys sorted at every level, so equal values always serialize (and
 * hash) the same regardless of property order. `undefined` members are dropped, as in
 * JSON.stringify.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );
}
