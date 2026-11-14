import type { Document } from "../api/types.ts";

const LEGACY_TEMPLATE_ID = "legacy-markdown";

/**
 * The document a recording opens on (CONTRACTS D-P1-3): structured documents (any template
 * but `legacy-markdown`) come before the migrated or bridged Markdown; newest first within
 * each group (ties by id). The input is not changed.
 */
export function primaryDocument(docs: readonly Document[]): Document | undefined {
  const rank = (d: Document) => (d.template_id === LEGACY_TEMPLATE_ID ? 1 : 0);
  return [...docs].sort(
    (a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)
  )[0];
}
