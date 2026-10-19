// The personal workspace id of a v1 user (docs/v2/ARCHITECTURE.md §12.4). No imports, so
// db.ts can use it in its delete paths without an import cycle.

import { createHash } from "node:crypto";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `wsp_<user id>` (a v1 user id is `usr_<uuid>`), or a hash for ids that would not fit
 * the domain id pattern. The P2 migration creates each personal workspace with this id.
 */
export function personalWorkspaceId(userId: string): string {
  const direct = `wsp_${userId}`;
  return ID_PATTERN.test(direct) ? direct : `wsp_${createHash("sha256").update(userId).digest("hex").slice(0, 40)}`;
}
