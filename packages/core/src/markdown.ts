import type { RenderedMarkdown, TocItem } from "./types.ts";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseTimeToSeconds(ts: string): number {
  const parts = ts.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export function extractExcerpt(md: string, maxLen = 190): string {
  const lines = md.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("---")) continue;
    const clean = line
      .replace(/^[-*>+\d.]+\s*/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
    if (clean.length > 24) {
      return clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
    }
  }
  return "강의 오디오에서 쉬는시간과 잡담을 제거하고 핵심 이론만 구조화한 강의 노트입니다.";
}

function formatInline(text: string): string {
  // 1. Protect inline code spans
  const codeSpans: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    const trimmed = code.trim();
    if (trimmed.startsWith("[쉬는 시간 생략")) {
      const idx = codeSpans.push(
        `<span class="filter-badge filter-break">☕ ${escapeHtml(trimmed)}</span>`
      ) - 1;
      return `\u0000CODE${idx}\u0000`;
    }
    if (trimmed.startsWith("[수업 종료 후 녹음 절단")) {
      const idx = codeSpans.push(
        `<span class="filter-badge filter-cut">✂️ ${escapeHtml(trimmed)}</span>`
      ) - 1;
      return `\u0000CODE${idx}\u0000`;
    }
    const idx = codeSpans.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\u0000CODE${idx}\u0000`;
  });

  out = escapeHtml(out);

  // 2. Filter callout badges if not in backticks
  out = out.replace(
    /\[쉬는 시간 생략:\s*([^\]]+)\]/g,
    `<span class="filter-badge filter-break">☕ 쉬는 시간 생략: $1</span>`
  );
  out = out.replace(
    /\[수업 종료 후 녹음 절단:\s*([^\]]+)\]/g,
    `<span class="filter-badge filter-cut">✂️ 수업 종료 후 절단: $1</span>`
  );

  // 3. Interactive timestamp chips: [MM:SS] or [HH:MM:SS] or [MM:SS ~ MM:SS]
  out = out.replace(
    /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[~-]\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]/g,
    (_, startTs: string, endTs?: string) => {
      const sec = parseTimeToSeconds(startTs);
      const label = endTs ? `${startTs}–${endTs}` : startTs;
      return `<button type="button" class="ts-chip" data-sec="${sec}" title="오디오 ${startTs} 지점으로 이동">⏱ ${label}</button>`;
    }
  );

  // 4. Bold, Italic, Links
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`
  );

  // 5. Restore inline code spans
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeSpans[Number(idx)] || "");
  return out;
}

export function renderMarkdownToHtml(md: string): RenderedMarkdown {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const htmlParts: string[] = [];
  const toc: TocItem[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let codeBuffer: string[] = [];

  let listStack: ("ul" | "ol")[] = [];
  let inBlockquote = false;
  let inTable = false;
  let tableHeaderDone = false;

  const closeLists = () => {
    while (listStack.length > 0) {
      const tag = listStack.pop()!;
      htmlParts.push(`</${tag}>`);
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      htmlParts.push("</blockquote>");
      inBlockquote = false;
    }
  };

  const closeTable = () => {
    if (inTable) {
      htmlParts.push("</tbody></table></div>");
      inTable = false;
      tableHeaderDone = false;
    }
  };

  let slugCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Code block fences
    if (rawLine.trim().startsWith("```")) {
      closeLists();
      closeBlockquote();
      closeTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = rawLine.trim().slice(3).trim();
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : "";
        htmlParts.push(
          `<pre class="md-code"${langAttr}><code>${escapeHtml(
            codeBuffer.join("\n")
          )}</code></pre>`
        );
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    if (!trimmed) {
      closeLists();
      closeBlockquote();
      closeTable();
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeLists();
      closeBlockquote();
      closeTable();
      htmlParts.push("<hr class=\"md-hr\" />");
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeLists();
      closeBlockquote();
      closeTable();
      const level = headingMatch[1].length;
      const rawTitle = headingMatch[2].trim();
      const cleanText = rawTitle
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
      const id = `sec-${++slugCounter}`;
      if (level >= 2 && level <= 3) {
        toc.push({ id, level, text: cleanText });
      }
      htmlParts.push(`<h${level} id="${id}">${formatInline(rawTitle)}</h${level}>`);
      continue;
    }

    // Markdown table row
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeLists();
      closeBlockquote();
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableHeaderDone = false;
        htmlParts.push('<div class="md-table-wrap"><table class="md-table">');
      }
      if (!tableHeaderDone) {
        htmlParts.push(
          `<thead><tr>${cells
            .map((c) => `<th>${formatInline(c)}</th>`)
            .join("")}</tr></thead><tbody>`
        );
        tableHeaderDone = true;
      } else {
        htmlParts.push(
          `<tr>${cells.map((c) => `<td>${formatInline(c)}</td>`).join("")}</tr>`
        );
      }
      continue;
    } else {
      closeTable();
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      closeLists();
      if (!inBlockquote) {
        inBlockquote = true;
        htmlParts.push('<blockquote class="md-quote">');
      }
      const qContent = trimmed.replace(/^>\s?/, "");
      htmlParts.push(`<p>${formatInline(qContent)}</p>`);
      continue;
    } else {
      closeBlockquote();
    }

    // Unordered or Ordered list
    const ulMatch = rawLine.match(/^(\s*)[-*+]\s+(.+)$/);
    const olMatch = rawLine.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const indent = (ulMatch ? ulMatch[1] : olMatch![1]).length;
      const content = ulMatch ? ulMatch[2] : olMatch![2];
      const tag: "ul" | "ol" = ulMatch ? "ul" : "ol";
      const targetDepth = Math.min(3, Math.floor(indent / 2) + 1);

      while (listStack.length < targetDepth) {
        listStack.push(tag);
        htmlParts.push(`<${tag}>`);
      }
      while (listStack.length > targetDepth) {
        const closed = listStack.pop()!;
        htmlParts.push(`</${closed}>`);
      }
      if (listStack[listStack.length - 1] !== tag) {
        const closed = listStack.pop()!;
        htmlParts.push(`</${closed}>`);
        listStack.push(tag);
        htmlParts.push(`<${tag}>`);
      }
      htmlParts.push(`<li>${formatInline(content)}</li>`);
      continue;
    } else {
      closeLists();
    }

    // Standard paragraph
    htmlParts.push(`<p>${formatInline(trimmed)}</p>`);
  }

  closeLists();
  closeBlockquote();
  closeTable();

  return {
    html: htmlParts.join("\n"),
    toc,
    excerpt: extractExcerpt(md),
  };
}
