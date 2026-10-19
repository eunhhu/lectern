import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "../src/db.ts";
import { hardenPrivateTree } from "../src/fsperm.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

describe("data dir permissions", () => {
  test("boot leaves the data dir, uploads and the database owner-only", () => {
    // preload.ts created DATA_DIR with the default umask (0755); db.ts fixed it at import.
    expect(mode(DATA_DIR)).toBe(0o700);
    expect(mode(join(DATA_DIR, "uploads"))).toBe(0o700);
    expect(mode(join(DATA_DIR, "lectern.sqlite"))).toBe(0o600);
    const wal = join(DATA_DIR, "lectern.sqlite-wal");
    if (existsSync(wal)) expect(mode(wal)).toBe(0o600);
  });

  test("hardenPrivateTree fixes an existing tree without following symlinks", () => {
    const root = mkdtempSync(join(tmpdir(), "lectern-perm-"));
    const outside = mkdtempSync(join(tmpdir(), "lectern-perm-outside-"));
    try {
      chmodSync(root, 0o755);
      mkdirSync(join(root, "backups"), { mode: 0o755 });
      writeFileSync(join(root, "lectern.sqlite"), "db", { mode: 0o644 });
      writeFileSync(join(root, "backups", "old.sqlite"), "snap", { mode: 0o644 });
      writeFileSync(join(outside, "notes.md"), "x", { mode: 0o644 });
      symlinkSync(join(outside, "notes.md"), join(root, "link.md"));

      expect(hardenPrivateTree(root)).toEqual({ changed: 4, failed: 0 });
      expect(mode(root)).toBe(0o700);
      expect(mode(join(root, "backups"))).toBe(0o700);
      expect(mode(join(root, "lectern.sqlite"))).toBe(0o600);
      expect(mode(join(root, "backups", "old.sqlite"))).toBe(0o600);
      expect(mode(join(outside, "notes.md"))).toBe(0o644); // the link target is not ours to change

      expect(hardenPrivateTree(root)).toEqual({ changed: 0, failed: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
