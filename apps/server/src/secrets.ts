// Short-lived secrets that must survive a process boundary (API → worker), e.g. a Gemini
// key a user sent with one upload. They are sealed with AES-256-GCM under a host key kept
// in DATA_DIR/secret.key (0600, created on first use) and cleared when the job ends.
//
// Database backups (VACUUM INTO) deliberately do not include the key file. Sealed values
// are per job and transient, so losing the key only orphans in-flight jobs that carried a
// user key: openSecret() returns null and the job fails with a clear message instead of
// silently falling back to the server's key.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

const KEY_PATH = join(DATA_DIR, "secret.key");
let hostKey: Buffer | null = null;

function key(): Buffer {
  if (hostKey) return hostKey;
  if (existsSync(KEY_PATH)) {
    hostKey = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
  } else {
    hostKey = randomBytes(32);
    writeFileSync(KEY_PATH, hostKey.toString("hex"), { mode: 0o600 });
  }
  try {
    chmodSync(KEY_PATH, 0o600);
  } catch {
    // best effort
  }
  if (hostKey.length !== 32) throw new Error(`${KEY_PATH} is not a 32-byte hex key`);
  return hostKey;
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

/** The plaintext, or null when the value is malformed or was sealed under another key. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed || !sealed.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
