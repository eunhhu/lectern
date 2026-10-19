// Migrations and ORM access for the v2 tables (see schema.ts for the v1/v2 boundary).

import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema.ts";

export { schema };

export const MIGRATIONS_DIR = join(import.meta.dir, "../migrations");
const PRE_MIGRATE_RE = /^pre-migrate-\d{8}-\d{6}\.sqlite$/;
const PRE_MIGRATE_KEEP = 3;

export function orm(sqlite: Database) {
  return drizzle(sqlite, { schema });
}

export interface MigrationInfo {
  tag: string;
  createdAt: number;
}

/** Migrations in MIGRATIONS_DIR that this database has not applied yet. */
export function pendingMigrations(sqlite: Database): MigrationInfo[] {
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string; when: number }> };
  const tableExists = sqlite
    .query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`)
    .get();
  const lastApplied = tableExists
    ? ((
        sqlite.query(`SELECT MAX(created_at) AS last FROM __drizzle_migrations`).get() as {
          last: number | null;
        }
      ).last ?? 0)
    : 0;
  return files
    .filter((m) => m.folderMillis > Number(lastApplied))
    .map((m) => ({
      tag: journal.entries.find((e) => e.when === m.folderMillis)?.tag ?? String(m.folderMillis),
      createdAt: m.folderMillis,
    }));
}

function stamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

function hasUserData(sqlite: Database): boolean {
  const users = sqlite
    .query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get();
  return Boolean(users && sqlite.query(`SELECT 1 FROM users LIMIT 1`).get());
}

/**
 * Applies pending migrations. When there is something to apply and the database already
 * holds data, a `pre-migrate-*.sqlite` snapshot is written to `backupDir` first (newest
 * PRE_MIGRATE_KEEP kept), so a bad migration can be rolled back by restoring it.
 */
export function runMigrations(
  sqlite: Database,
  options: { backupDir: string; now?: Date }
): { applied: string[]; backup: string | null } {
  const pending = pendingMigrations(sqlite);
  if (pending.length === 0) return { applied: [], backup: null };

  let backup: string | null = null;
  if (hasUserData(sqlite)) {
    // Owner-only, like the rest of the data dir: a snapshot holds every account and note.
    mkdirSync(options.backupDir, { recursive: true, mode: 0o700 });
    backup = join(options.backupDir, `pre-migrate-${stamp(options.now ?? new Date())}.sqlite`);
    if (!existsSync(backup)) {
      sqlite.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      chmodSync(backup, 0o600);
    }
    const old = readdirSync(options.backupDir)
      .filter((f) => PRE_MIGRATE_RE.test(f))
      .sort()
      .reverse()
      .slice(PRE_MIGRATE_KEEP);
    for (const f of old) {
      try {
        unlinkSync(join(options.backupDir, f));
      } catch {
        // ignore
      }
    }
  }

  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });
  return { applied: pending.map((p) => p.tag), backup };
}

export * from "./ids.ts";
export * from "./legacy.ts";
