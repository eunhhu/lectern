// What a structured document edit may touch (D-P2-2): the text of each block, nothing else.
// Blocks, sections, ids, sources and gaps stay as they are; the server marks the blocks
// whose text changed as `edited` when the new version is saved.

import type { DocumentBlock, DocumentBody } from "../../../api/types.ts";

export interface EditableField {
  /** `${blockId}:${path}`, path one of text | items.<i> | term | definition | expression | explanation. */
  key: string;
  label: string;
  value: string;
  multiline: boolean;
  /** The section the field belongs to (for grouping under its title). */
  sectionKey: string;
}

export const BLOCK_LABEL: Record<string, string> = {
  paragraph: "단락",
  list: "목록",
  quote: "인용",
  term: "용어",
  formula: "수식",
  callout: "강조",
};

interface RawField {
  path: string;
  name: string;
  value: string;
  multiline: boolean;
}

/** The text fields of one block, in reading order. Gaps and unknown blocks have none. */
function blockFields(block: DocumentBlock): RawField[] {
  switch (block.type) {
    case "paragraph":
    case "quote":
    case "callout":
      return [{ path: "text", name: BLOCK_LABEL[block.type]!, value: block.text, multiline: true }];
    case "list":
      return block.items.map((item, i) => ({ path: `items.${i}`, name: `목록 ${i + 1}번째 항목`, value: item.text, multiline: true }));
    case "term":
      return [
        { path: "term", name: "용어", value: block.term, multiline: false },
        { path: "definition", name: "용어 설명", value: block.definition, multiline: true },
      ];
    case "formula": {
      const fields: RawField[] = [{ path: "expression", name: "수식", value: block.expression, multiline: false }];
      if (block.explanation !== null) fields.push({ path: "explanation", name: "수식 설명", value: block.explanation, multiline: true });
      return fields;
    }
    default:
      return [];
  }
}

/** Text fields of the body in reading order. Same labels in one section get a number. */
export function editableFields(body: DocumentBody): EditableField[] {
  const out: EditableField[] = [];
  for (const section of body.sections) {
    const seen = new Map<string, number>();
    for (const block of section.blocks) {
      for (const field of blockFields(block)) {
        const base = `${section.title} · ${field.name}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        out.push({
          key: `${block.id}:${field.path}`,
          label: n === 1 ? base : `${base} ${n}`,
          value: field.value,
          multiline: field.multiline,
          sectionKey: section.key,
        });
      }
    }
  }
  return out;
}

function applyToBlock(block: DocumentBlock, values: Record<string, string>): DocumentBlock {
  const value = (path: string) => values[`${block.id}:${path}`];
  switch (block.type) {
    case "paragraph":
    case "quote":
    case "callout": {
      const text = value("text");
      return text === undefined ? block : { ...block, text };
    }
    case "list":
      return { ...block, items: block.items.map((item, i) => (value(`items.${i}`) === undefined ? item : { ...item, text: value(`items.${i}`)! })) };
    case "term":
      return { ...block, term: value("term") ?? block.term, definition: value("definition") ?? block.definition };
    case "formula":
      return {
        ...block,
        expression: value("expression") ?? block.expression,
        explanation: block.explanation === null ? null : (value("explanation") ?? block.explanation),
      };
    default:
      return block;
  }
}

/** A copy of the body with the values applied. Unknown keys are ignored. */
export function applyFields(body: DocumentBody, values: Record<string, string>): DocumentBody {
  const copy = structuredClone(body);
  return { ...copy, sections: copy.sections.map((section) => ({ ...section, blocks: section.blocks.map((block) => applyToBlock(block, values)) })) };
}
