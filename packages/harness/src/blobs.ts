// Content-addressed blob store for stage artifacts (AI_HARNESS §4.3 step 1).
//
// Layout under the root (production: DATA_DIR/blobs):
//   sha256/<first 2 hex>/<sha256>   final blobs, never modified once renamed into place
//   tmp/<uuid>                      writes in progress
//
// A write goes to tmp/, is fsynced, hashed, and renamed to its final key, so a crash leaves
// either nothing or a complete blob (plus, at worst, a stray tmp file). Equal content is
// stored once. Permissions follow apps/server/src/fsperm.ts: directories 0700 and files
// 0600, because blobs hold user content (transcripts, notes). Directories are created on
// the first write, not at import: the CD preflight loads this module in a sandbox.

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "./hash.ts";

export const BLOB_DIR_MODE = 0o700;
export const BLOB_FILE_MODE = 0o600;

const SHA256_RE = /^[0-9a-f]{64}$/;

export interface BlobRef {
  sha256: string;
  /** Path relative to the store root; what `artifact.blob_key` holds. */
  blobKey: string;
  bytes: number;
}

export class BlobStore {
  private readonly madeDirs = new Set<string>();

  constructor(readonly root: string) {}

  static keyFor(sha256: string): string {
    if (!SHA256_RE.test(sha256)) throw new Error(`not a sha256 hex digest: ${sha256}`);
    return `sha256/${sha256.slice(0, 2)}/${sha256}`;
  }

  /** Absolute path of a blob (it may not exist). */
  path(sha256: string): string {
    return join(this.root, BlobStore.keyFor(sha256));
  }

  has(sha256: string): boolean {
    return existsSync(this.path(sha256));
  }

  read(sha256: string): Buffer {
    return readFileSync(this.path(sha256));
  }

  readText(sha256: string): string {
    return readFileSync(this.path(sha256), "utf8");
  }

  async putBytes(data: string | Uint8Array): Promise<BlobRef> {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const sha256 = sha256Hex(bytes);
    const ref = { sha256, blobKey: BlobStore.keyFor(sha256), bytes: bytes.byteLength };
    if (this.touch(sha256)) return ref;
    const tmp = this.tmpPath();
    const fd = openSync(tmp, "wx", BLOB_FILE_MODE);
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.commit(tmp, sha256);
    return ref;
  }

  /** Copies a file into the store, hashing it as it streams. */
  async putFile(source: string): Promise<BlobRef> {
    const tmp = this.tmpPath();
    const hash = createHash("sha256");
    let bytes = 0;
    const fd = openSync(tmp, "wx", BLOB_FILE_MODE);
    try {
      for await (const chunk of Bun.file(source).stream()) {
        hash.update(chunk);
        writeSync(fd, chunk);
        bytes += chunk.byteLength;
      }
      fsyncSync(fd);
    } catch (err) {
      closeSync(fd);
      unlinkQuietly(tmp);
      throw err;
    }
    closeSync(fd);
    const sha256 = hash.digest("hex");
    if (this.touch(sha256)) unlinkQuietly(tmp);
    else this.commit(tmp, sha256);
    return { sha256, blobKey: BlobStore.keyFor(sha256), bytes };
  }

  /** Removes a blob. Callers check that no artifact row references it any more. */
  delete(sha256: string): boolean {
    try {
      unlinkSync(this.path(sha256));
      return true;
    } catch {
      return false;
    }
  }

  /** Size on disk, or null when the blob is missing. */
  size(sha256: string): number | null {
    try {
      return statSync(this.path(sha256)).size;
    } catch {
      return null;
    }
  }

  /**
   * True when the blob already exists, after bumping its mtime: a stage that reuses an
   * existing blob records it only when it finishes, and the maintenance sweep spares
   * unreferenced blobs younger than its grace period (retention.ts).
   */
  private touch(sha256: string): boolean {
    try {
      const now = new Date();
      utimesSync(this.path(sha256), now, now);
      return true;
    } catch {
      return false;
    }
  }

  private tmpPath(): string {
    const dir = join(this.root, "tmp");
    this.ensureDir(dir);
    return join(dir, randomUUID());
  }

  private commit(tmp: string, sha256: string): void {
    const final = this.path(sha256);
    this.ensureDir(dirname(final));
    chmodSync(tmp, BLOB_FILE_MODE); // openSync's mode is subject to the umask
    renameSync(tmp, final);
  }

  private ensureDir(dir: string): void {
    if (this.madeDirs.has(dir)) return;
    mkdirSync(dir, { recursive: true, mode: BLOB_DIR_MODE });
    // mkdir's mode is subject to the umask, and the root may predate this code.
    for (let d = dir; d.startsWith(this.root); d = dirname(d)) {
      chmodSync(d, BLOB_DIR_MODE);
      if (d === this.root) break;
    }
    this.madeDirs.add(dir);
  }
}

function unlinkQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}
