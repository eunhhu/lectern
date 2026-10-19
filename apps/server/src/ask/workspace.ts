// The personal workspace id of a v1 user (docs/v2/ARCHITECTURE.md §12.4). The v2 id rules
// live in @lectern/db (ids.ts), which the P2 migration uses too; db.ts can import this
// module in its delete paths without an import cycle.

export { personalWorkspaceId } from "@lectern/db";
