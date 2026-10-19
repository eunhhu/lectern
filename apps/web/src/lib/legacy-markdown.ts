// Legacy (v1) lecture notes are Markdown with `[MM:SS]` time marks and no structured
// body (`legacy-markdown` documents, DocumentVersion.body null). This parses the subset
// the v1 renderer understands (packages/core renderMarkdownToHtml) into a small tree that
// the document pane renders with React elements: no HTML string ever reaches the DOM, so
// a note cannot inject markup. Time marks become times the player can jump to.
//
// Blocks: # headings (1–4), paragraphs, - * + and 1. lists (nested by indent), > quotes,
// ``` code, | tables |, --- rules. Inline: `code`, **bold**, *italic*, [text](https://…),
// [MM:SS] / [H:MM:SS] / [MM:SS ~ MM:SS] times, and the v1 filter notes
// [쉬는 시간 생략: …] and [수업 종료 후 녹음 절단: …].

export type MdInline =
  | { t: "text"; v: string }
  | { t: "strong"; c: MdInline[] }
  | { t: "em"; c: MdInline[] }
  | { t: "code"; v: string }
  | { t: "time"; ms: number; label: string }
  | { t: "link"; href: string; c: MdInline[] }
  | { t: "note"; kind: "break" | "cut"; v: string };

export interface MdListItem {
  c: MdInline[];
  children: MdBlock[];
}

export type MdBlock =
  | { t: "heading"; level: 1 | 2 | 3 | 4; c: MdInline[]; text: string }
  | { t: "p"; c: MdInline[] }
  | { t: "list"; ordered: boolean; items: MdListItem[] }
  | { t: "quote"; lines: MdInline[][] }
  | { t: "code"; lang: string; v: string }
  | { t: "table"; head: MdInline[][]; rows: MdInline[][][] }
  | { t: "hr" };

/** `12:03` → 723000, `1:02:40` → 3760000. */
export function parseClock(value: string): number {
  const parts = value.split(":").map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  const [a, b, c] = parts;
  return (parts.length === 3 ? a! * 3600 + b! * 60 + c! : a! * 60 + b!) * 1000;
}

const CLOCK = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const INLINE = new RegExp(
  [
    String.raw`\[(${CLOCK})(?:\s*[~-]\s*(${CLOCK}))?\]`, // 1, 2: time
    String.raw`\[(쉬는 시간 생략|수업 종료 후 녹음 절단):\s*([^\]]+)\]`, // 3, 4: filter note
    String.raw`\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)`, // 5, 6: link
    String.raw`\*\*([^*]+)\*\*`, // 7: bold
    String.raw`\*([^*\s][^*]*)\*`, // 8: italic
  ].join("|"),
  "g",
);

function noteKind(label: string): "break" | "cut" {
  return label.startsWith("쉬는") ? "break" : "cut";
}

function parseSpans(text: string): MdInline[] {
  const out: MdInline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > at) out.push({ t: "text", v: text.slice(at, m.index) });
    if (m[1]) out.push({ t: "time", ms: parseClock(m[1]), label: m[2] ? `${m[1]}–${m[2]}` : m[1] });
    else if (m[3]) out.push({ t: "note", kind: noteKind(m[3]), v: `${m[3]}: ${m[4]!.trim()}` });
    else if (m[5]) out.push({ t: "link", href: m[6]!, c: parseSpans(m[5]) });
    else if (m[7]) out.push({ t: "strong", c: parseSpans(m[7]) });
    else if (m[8]) out.push({ t: "em", c: parseSpans(m[8]) });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ t: "text", v: text.slice(at) });
  return out;
}

/** Inline Markdown of one line. Code spans are taken first, so nothing inside them is parsed. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let at = 0;
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    if (m.index! > at) out.push(...parseSpans(text.slice(at, m.index)));
    const code = m[1]!.trim();
    const note = /^\[(쉬는 시간 생략|수업 종료 후 녹음 절단):\s*([^\]]+)\]$/.exec(code);
    out.push(note ? { t: "note", kind: noteKind(note[1]!), v: `${note[1]}: ${note[2]!.trim()}` } : { t: "code", v: m[1]! });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(...parseSpans(text.slice(at)));
  return out;
}

/** Plain text of inline nodes (headings' names, tests). */
export function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((n) => (n.t === "text" || n.t === "code" || n.t === "note" ? n.v : n.t === "time" ? n.label : "c" in n ? inlineText(n.c) : ""))
    .join("");
}

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/;

export function parseLegacyMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ t: "p", c: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();

    if (line.startsWith("```")) {
      flushParagraph();
      const lang = line.slice(3).trim();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i]!);
      blocks.push({ t: "code", lang, v: code.join("\n") });
      continue;
    }
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      blocks.push({ t: "hr" });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const c = parseInline(heading[2]!.trim());
      blocks.push({ t: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4, c, text: inlineText(c) });
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      flushParagraph();
      const cells = (row: string) =>
        row
          .trim()
          .slice(1, -1)
          .split("|")
          .map((cell) => parseInline(cell.trim()));
      const head = cells(line);
      const rows: MdInline[][][] = [];
      while (i + 1 < lines.length && /^\|.*\|$/.test(lines[i + 1]!.trim())) {
        const next = lines[++i]!.trim();
        if (/^\|[\s|:-]+\|$/.test(next)) continue; // separator row
        rows.push(cells(next));
      }
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (line.startsWith(">")) {
      flushParagraph();
      const quote: MdInline[][] = [parseInline(line.replace(/^>\s?/, ""))];
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith(">")) quote.push(parseInline(lines[++i]!.trim().replace(/^>\s?/, "")));
      blocks.push({ t: "quote", lines: quote });
      continue;
    }
    if (LIST_ITEM.test(raw)) {
      flushParagraph();
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      for (; i < lines.length; i++) {
        const m = LIST_ITEM.exec(lines[i]!);
        const indent = m ? m[1]!.replace(/\t/g, "  ").length : 0;
        // `-` turning into `1.` (or back) at the top level starts another list.
        if (m && items.length && indent <= items[0]!.indent && (m[3] !== undefined) !== items[0]!.ordered) break;
        if (m) items.push({ indent, ordered: m[3] !== undefined, text: m[4]! });
        else if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length) items.at(-1)!.text += ` ${lines[i]!.trim()}`;
        else break;
      }
      i--;
      blocks.push(buildList(items));
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Nests list items by indent (a deeper item belongs to the item above it). */
function buildList(items: { indent: number; ordered: boolean; text: string }[]): MdBlock {
  const root: Extract<MdBlock, { t: "list" }> = { t: "list", ordered: items[0]!.ordered, items: [] };
  const stack: { indent: number; list: Extract<MdBlock, { t: "list" }> }[] = [{ indent: items[0]!.indent, list: root }];
  for (const item of items) {
    while (stack.length > 1 && item.indent < stack.at(-1)!.indent) stack.pop();
    let top = stack.at(-1)!;
    if (item.indent > top.indent && top.list.items.length) {
      const parent = top.list.items.at(-1)!;
      const nested: Extract<MdBlock, { t: "list" }> = { t: "list", ordered: item.ordered, items: [] };
      parent.children.push(nested);
      top = { indent: item.indent, list: nested };
      stack.push(top);
    }
    top.list.items.push({ c: parseInline(item.text), children: [] });
  }
  return root;
}
