// Owner-only permissions for DATA_DIR. The database, its backups, uploaded audio and the
// sealed-secret key hold user data and credentials, so nothing under it is readable by
// other local accounts: directories are 0700 and files 0600. The directory mode is the
// real guard (no one else can even traverse in); file modes are defense in depth and keep
// a file private if it is ever moved or copied out.
//
// Archived originals in the lecture archive are hard links to uploads/ files, so they
// share the upload's (now 0600) mode; the archive itself is left alone otherwise.

import { chmodSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./log.ts";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

function chmodQuietly(path: string, mode: number): boolean {
  try {
    chmodSync(path, mode);
    return true;
  } catch (err) {
    logger.warn("could not restrict permissions", { path, err });
    return false;
  }
}

/** Restricts a file this process just wrote to its owner (0600). */
export function makePrivate(path: string): void {
  chmodQuietly(path, PRIVATE_FILE_MODE);
}

/** Creates `dir` if needed and restricts it to its owner (0700). */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodQuietly(dir, PRIVATE_DIR_MODE);
}

/**
 * Brings an existing tree to owner-only permissions: `root` and every directory below it
 * 0700, every file 0600. Symlinks are never followed. Entries owned by another user keep
 * their mode (chmod would fail on them), though a directory's contents are still visited.
 * Entries that already have the right mode are not touched, so a second run changes nothing.
 */
export function hardenPrivateTree(root: string): { changed: number; failed: number } {
  const uid = process.getuid?.();
  let changed = 0;
  let failed = 0;
  const visit = (path: string) => {
    let st;
    try {
      st = lstatSync(path);
    } catch {
      return; // vanished meanwhile
    }
    if (st.isSymbolicLink()) return;
    const want = st.isDirectory() ? PRIVATE_DIR_MODE : PRIVATE_FILE_MODE;
    const ours = uid === undefined || st.uid === uid;
    if (ours && (st.mode & 0o777) !== want) {
      if (chmodQuietly(path, want)) changed++;
      else failed++;
    }
    if (st.isDirectory()) {
      let names: string[] = [];
      try {
        names = readdirSync(path);
      } catch {
        return; // unreadable directory owned by someone else
      }
      for (const name of names) visit(join(path, name));
    }
  };
  visit(root);
  return { changed, failed };
}
