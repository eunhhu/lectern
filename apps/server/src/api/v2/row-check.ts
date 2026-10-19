// Checks that every v2 row the API would serve parses with its packages/domain schema, so
// one odd migrated value (a timestamp with an offset, an over-long course name) is found
// by the rehearsal and the deploy preflight instead of turning a read into a 500. Takes a
// Database and imports no server module (no db.ts), so a script can run it on a copy of
// the production database.

import type { Database } from "bun:sqlite";
import { AssetDto, Document, DocumentVersion, Folder, Membership, Recording, ShareLinkDto, Tag, Workspace } from "@lectern/domain";
import type { z } from "zod";
import {
  assetDto,
  documentDto,
  documentVersionDto,
  folderDto,
  membershipDto,
  recordingDto,
  shareLinkDto,
  tagDto,
  workspaceDto,
  type AssetRow,
} from "./rows.ts";

/** A digest stand-in for assets still waiting for theirs (the shape is what is checked). */
const PENDING_DIGEST = "0".repeat(64);

export interface RowCheckReport {
  ok: boolean;
  checked: Record<string, number>;
  /** Rows that do not parse: table, id and the first issue (no values). At most 50. */
  failures: Array<{ table: string; id: string; path: string; message: string }>;
  failure_count: number;
  /** Assets whose digest is computed lazily (migrated audio). */
  pending_digests: number;
}

export function checkV2Rows(sqlite: Database): RowCheckReport {
  const failures: RowCheckReport["failures"] = [];
  const checked: Record<string, number> = {};
  let failureCount = 0;

  const check = <R>(table: string, sql: string, schema: z.ZodType, toDto: (row: R) => unknown, idOf: (row: R) => string) => {
    let n = 0;
    for (const row of sqlite.query(sql).iterate() as IterableIterator<R>) {
      n += 1;
      const parsed = schema.safeParse(toDto(row));
      if (!parsed.success) {
        failureCount += 1;
        const issue = parsed.error.issues[0]!;
        if (failures.length < 50) failures.push({ table, id: idOf(row), path: issue.path.join("."), message: issue.message });
      }
    }
    checked[table] = n;
  };

  const byId = (row: { id: string }) => row.id;
  check("workspace", `SELECT * FROM workspace`, Workspace, workspaceDto, byId);
  check("membership", `SELECT * FROM membership`, Membership, membershipDto, (m: { workspace_id: string; user_id: string }) => `${m.workspace_id}/${m.user_id}`);
  check("folder", `SELECT * FROM folder`, Folder, folderDto, byId);
  check("tag", `SELECT * FROM tag`, Tag, tagDto, byId);
  check("recording", `SELECT * FROM recording`, Recording, recordingDto, byId);
  check("asset", `SELECT * FROM asset`, AssetDto, (a: AssetRow) => assetDto({ ...a, sha256: a.sha256 ?? PENDING_DIGEST }), byId);
  check("document", `SELECT * FROM document`, Document, documentDto, byId);
  check("document_version", `SELECT * FROM document_version`, DocumentVersion, documentVersionDto, byId);
  check("share_link", `SELECT * FROM share_link`, ShareLinkDto, shareLinkDto, byId);

  const pending = (sqlite.query(`SELECT COUNT(*) AS n FROM asset WHERE sha256 IS NULL`).get() as { n: number }).n;
  return { ok: failureCount === 0, checked, failures, failure_count: failureCount, pending_digests: pending };
}
