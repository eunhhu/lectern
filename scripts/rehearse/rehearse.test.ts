// Tests of the restore rehearsal (P7-02). The digest tests use small databases made here;
// the end-to-end tests restore a backup of the test sandbox's server database (the root
// bunfig preload points LECTERN_DATA_DIR at a temp directory before db.ts loads).

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWorkDir, BLANKED_SECRETS, compareDigests, digestDatabase, integrity, REPO_ROOT, restoreEnv } from "./lib.ts";

const temp = () => mkdtempSync(join(tmpdir(), "lectern-rehearse-test-"));

/** Two tables, a few rows, a BLOB column and a 64-bit integer. */
function smallDb(path: string): void {
  const db = new Database(path);
  db.exec(`CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT, photo BLOB, big INTEGER)`);
  db.exec(`CREATE TABLE note (id TEXT PRIMARY KEY, person_id INTEGER REFERENCES person(id), body TEXT) WITHOUT ROWID`);
  const insert = db.query(`INSERT INTO person (name, photo, big) VALUES (?, ?, ?)`);
  insert.run("a", new Uint8Array([0, 255, 7]), 9007199254740993n);
  insert.run("b", null, -1);
  insert.run("c", new Uint8Array([1]), 0);
  db.query(`INSERT INTO note VALUES (?, ?, ?)`).run("n1", 1, "첫 메모");
  db.query(`INSERT INTO note VALUES (?, ?, ?)`).run("n2", 2, "둘째 메모");
  db.close();
}

describe("assertWorkDir", () => {
  const backup = join(tmpdir(), "elsewhere", "lectern-x.sqlite");

  test("refuses the repository data dir", () => {
    expect(() => assertWorkDir(join(REPO_ROOT, "data", "x"), backup, {})).toThrow("rehearse: refused");
  });

  test("refuses the configured data dir", () => {
    const root = temp();
    const configured = join(root, "a", "b");
    for (const dir of [configured, join(configured, "c"), join(root, "a")]) {
      expect(() => assertWorkDir(dir, backup, { LECTERN_DATA_DIR: configured })).toThrow("rehearse: refused");
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses the backup's own data dir", () => {
    const root = temp();
    const source = join(root, "X");
    mkdirSync(join(source, "backups"), { recursive: true });
    const file = join(source, "backups", "a.sqlite");
    writeFileSync(file, "");
    for (const dir of [source, join(source, "restore")]) {
      expect(() => assertWorkDir(dir, file, {})).toThrow("the data directory the backup came from");
    }
    expect(existsSync(join(source, "restore"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses a dir that has a database", () => {
    const root = temp();
    writeFileSync(join(root, "lectern.sqlite"), "");
    expect(() => assertWorkDir(root, backup, {})).toThrow("lectern.sqlite");
    expect(() => assertWorkDir(join(root, "inner"), backup, {})).toThrow("lectern.sqlite");
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses a non-empty dir, home and root", () => {
    const root = temp();
    writeFileSync(join(root, "something.txt"), "x");
    expect(() => assertWorkDir(root, backup, {})).toThrow("not empty");
    // Hidden entries count: restore.ts empties the work directory afterwards.
    const hidden = temp();
    writeFileSync(join(hidden, ".keep"), "mine");
    expect(() => assertWorkDir(hidden, backup, {})).toThrow("not empty");
    expect(readFileSync(join(hidden, ".keep"), "utf8")).toBe("mine");
    rmSync(hidden, { recursive: true, force: true });
    expect(() => assertWorkDir("/", backup, {})).toThrow("rehearse: refused");
    expect(() => assertWorkDir(REPO_ROOT, backup, {})).toThrow("rehearse: refused");
    rmSync(root, { recursive: true, force: true });
  });

  test("accepts a fresh dir", () => {
    const root = temp();
    const dir = assertWorkDir(join(root, "fresh"), backup, {});
    expect(dir.endsWith("/fresh")).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("digests", () => {
  test("digest is stable", () => {
    const root = temp();
    smallDb(join(root, "a.sqlite"));
    const one = digestDatabase(join(root, "a.sqlite"));
    expect(one.map((t) => [t.table, t.rows])).toEqual([
      ["note", 2],
      ["person", 3],
    ]);
    expect(digestDatabase(join(root, "a.sqlite"))).toEqual(one);
    rmSync(root, { recursive: true, force: true });
  });

  test("digest sees a changed row", () => {
    const root = temp();
    smallDb(join(root, "a.sqlite"));
    copyFileSync(join(root, "a.sqlite"), join(root, "b.sqlite"));
    const db = new Database(join(root, "b.sqlite"));
    db.query(`UPDATE person SET name = 'changed' WHERE id = 2`).run();
    db.close();
    const a = digestDatabase(join(root, "a.sqlite"));
    const b = digestDatabase(join(root, "b.sqlite"));
    expect(a.find((t) => t.table === "note")!.sha256).toBe(b.find((t) => t.table === "note")!.sha256);
    expect(compareDigests(a, b)).toEqual(["table person: checksum differs"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("digest sees a missing row", () => {
    const root = temp();
    smallDb(join(root, "a.sqlite"));
    copyFileSync(join(root, "a.sqlite"), join(root, "b.sqlite"));
    const db = new Database(join(root, "b.sqlite"));
    db.query(`DELETE FROM note WHERE id = 'n2'`).run();
    db.close();
    expect(compareDigests(digestDatabase(join(root, "a.sqlite")), digestDatabase(join(root, "b.sqlite")))).toEqual(["table note: rows 2 != 1"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("digest handles blobs and bigints", () => {
    const root = temp();
    smallDb(join(root, "a.sqlite"));
    copyFileSync(join(root, "a.sqlite"), join(root, "b.sqlite"));
    // 2^53 + 1 and 2^53 differ only past double precision: the digest still tells them apart.
    const db = new Database(join(root, "b.sqlite"), { safeIntegers: true });
    db.query(`UPDATE person SET big = 9007199254740992 WHERE id = 1`).run();
    db.close();
    expect(compareDigests(digestDatabase(join(root, "a.sqlite")), digestDatabase(join(root, "b.sqlite")))).toEqual(["table person: checksum differs"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("digest does not write", () => {
    const root = temp();
    const file = join(root, "a.sqlite");
    smallDb(file);
    chmodSync(file, 0o444);
    const mtime = statSync(file).mtimeMs;
    const bytes = readFileSync(file);
    expect(digestDatabase(file).length).toBe(2);
    expect(integrity(file).integrity).toBe("ok");
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(Buffer.compare(readFileSync(file), bytes)).toBe(0);
    expect(readdirSync(root)).toEqual(["a.sqlite"]); // no -wal, -shm or -journal beside it
    chmodSync(file, 0o644);
    rmSync(root, { recursive: true, force: true });
  });

  test("integrity reports ok", () => {
    const root = temp();
    smallDb(join(root, "a.sqlite"));
    expect(integrity(join(root, "a.sqlite"))).toEqual({ integrity: "ok", foreignKeyViolations: 0 });
    rmSync(root, { recursive: true, force: true });
  });
});

test("the rehearsal server's environment carries no secret from the parent", () => {
  const env = restoreEnv("/tmp/lectern-restore-x", 4999);
  for (const key of BLANKED_SECRETS) expect(env[key]).toBe("");
  expect(env).toMatchObject({ LECTERN_WORKER_MODE: "external", LECTERN_PREFLIGHT: "1", LECTERN_DATA_DIR: "/tmp/lectern-restore-x/data" });
  expect(Object.keys(env).filter((k) => !k.startsWith("LECTERN_") && !BLANKED_SECRETS.includes(k)).sort()).toEqual(["HOME", "PATH", "PORT"]);
});

describe("restore.ts", () => {
  const run = (args: string[]) =>
    Bun.spawnSync(["bun", join(import.meta.dir, "restore.ts"), ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", env: process.env });

  test(
    "restore end to end",
    async () => {
      // A database the server made in the test sandbox: one account and a lecture with audio.
      const { createPendingLecture, createUser, DATA_DIR, db, generateId } = await import("../../apps/server/src/db.ts");
      const owner = createUser({ email: `${generateId("restore")}@example.com`, displayName: "복원 리허설", password: "correct_password_1" });
      const uploads = join(DATA_DIR, "uploads");
      mkdirSync(uploads, { recursive: true });
      const audioPath = join(uploads, `${generateId("aud")}.m4a`);
      writeFileSync(audioPath, "audio bytes");
      const audioBefore = { mtime: statSync(audioPath).mtimeMs, bytes: readFileSync(audioPath) };
      createPendingLecture({
        id: generateId("lec"),
        ownerId: owner.id,
        title: "",
        course: "정보보호",
        audioPath,
        audioMime: "audio/mp4",
        audioSize: 11,
        modelRequested: "gemini-3.8-flash",
        sourceClient: "bun-test",
      });
      const root = temp();
      const backup = join(root, "lectern-20261115-000000.sqlite");
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      const work = join(root, "work");

      const result = run(["--backup", backup, "--work", work, "--uploads", uploads, "--out", join(root, "summary.json")]);
      const stdout = new TextDecoder().decode(result.stdout);
      expect(new TextDecoder().decode(result.stderr)).toBe("");
      const summary = JSON.parse(stdout);
      expect(result.exitCode).toBe(0);
      expect(summary).toMatchObject({ ok: true, digest_equal: true, integrity: "ok", foreign_key_violations: 0, shrunk_tables: [] });
      expect(summary.server).toMatchObject({ started: true, health: "ok" });
      expect(summary.audio.referenced).toBeGreaterThan(0);
      expect(summary.audio.missing).not.toContain(audioPath.split("/").pop());
      expect(JSON.parse(readFileSync(join(root, "summary.json"), "utf8"))).toEqual(summary);
      // Counts and hashes only: no email or row text in the output.
      expect(stdout).not.toContain("@example.com");
      expect(stdout).not.toContain("정보보호");
      expect(existsSync(work)).toBe(false); // removed without --keep
      // The live audio the copy points at is untouched.
      expect(statSync(audioPath).mtimeMs).toBe(audioBefore.mtime);
      expect(Buffer.compare(readFileSync(audioPath), audioBefore.bytes)).toBe(0);
      rmSync(root, { recursive: true, force: true });
    },
    120_000
  );

  test("restore refuses the live dir", async () => {
    const { DATA_DIR } = await import("../../apps/server/src/db.ts");
    const live = join(DATA_DIR, "lectern.sqlite");
    const mtime = statSync(live).mtimeMs;
    const entries = readdirSync(DATA_DIR).sort();
    const root = temp();
    const backup = join(root, "lectern-x.sqlite");
    smallDb(backup);
    const result = run(["--backup", backup, "--work", DATA_DIR]);
    expect(result.exitCode).toBe(2);
    expect(new TextDecoder().decode(result.stderr)).toContain("rehearse: refused");
    expect(statSync(live).mtimeMs).toBe(mtime);
    expect(readdirSync(DATA_DIR).sort()).toEqual(entries);
    rmSync(root, { recursive: true, force: true });
  });

  test("an existing empty work dir is kept, emptied, after the run", () => {
    const root = temp();
    const backup = join(root, "lectern-x.sqlite");
    smallDb(backup);
    const work = join(root, "given");
    mkdirSync(work);
    const result = run(["--backup", backup, "--work", work]);
    // The server migrates even this foreign database (its own tables stay as they were).
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(result.stdout))).toMatchObject({ digest_equal: true, integrity: "ok", shrunk_tables: [], ok: true });
    expect(existsSync(work)).toBe(true);
    expect(readdirSync(work)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  }, 120_000);

  test("a missing backup or an unknown option exits 2", () => {
    expect(run(["--backup", join(tmpdir(), "no-such-backup.sqlite")]).exitCode).toBe(2);
    const unknown = run(["--bogus"]);
    expect(unknown.exitCode).toBe(2);
    expect(new TextDecoder().decode(unknown.stderr)).toContain("unknown option: --bogus");
  });
});
