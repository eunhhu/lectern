// A `legacy-markdown` document (a v1 lecture note): the Markdown parsed by
// lib/legacy-markdown.ts and drawn with React elements, so nothing from the note is ever
// inserted as HTML. `[MM:SS]` marks are buttons that move the player and the transcript
// there (the v1 notes' way of citing the recording).

import { Fragment, useMemo, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { formatSpokenTime } from "../../lib/format.ts";
import { parseLegacyMarkdown, type MdBlock, type MdInline } from "../../lib/legacy-markdown.ts";
import { Badge } from "../../ui/controls.tsx";
import { usePlayback } from "./playback.tsx";
import s from "./recording.module.css";

export function LegacyDocument({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => {
    const all = parseLegacyMarkdown(markdown);
    // The note starts with its title as `# …`; the page heading already says it.
    return all[0]?.t === "heading" && all[0].level === 1 ? all.slice(1) : all;
  }, [markdown]);
  return (
    <div className={s.legacyDoc}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.t) {
    case "heading": {
      // # and ## are the note's sections (h2 under the page's h1), ### and #### below them.
      const content = <Inline nodes={block.c} />;
      if (block.level <= 2) return <h2 className={s.docH2}>{content}</h2>;
      if (block.level === 3) return <h3 className={s.docH3}>{content}</h3>;
      return <h4 className={s.docH4}>{content}</h4>;
    }
    case "p":
      return (
        <p className={s.docP}>
          <Inline nodes={block.c} />
        </p>
      );
    case "list":
      return <List block={block} />;
    case "quote":
      return (
        <blockquote className={s.docQuote}>
          {block.lines.map((line, i) => (
            <p key={i}>
              <Inline nodes={line} />
            </p>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre className={s.docCode} data-lang={block.lang || undefined}>
          <code>{block.v}</code>
        </pre>
      );
    case "table":
      return (
        <div className={s.docTableWrap}>
          <table className={s.docTable}>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col">
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i}>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className={s.docHr} />;
    default:
      return null;
  }
}

function List({ block }: { block: Extract<MdBlock, { t: "list" }> }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag className={s.docList}>
      {block.items.map((item, i) => (
        <li key={i}>
          <Inline nodes={item.c} />
          {item.children.map((child, j) => (
            <Block key={j} block={child} />
          ))}
        </li>
      ))}
    </Tag>
  );
}

function Inline({ nodes }: { nodes: MdInline[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return <Fragment key={i}>{node.v}</Fragment>;
      case "strong":
        return (
          <strong key={i}>
            <Inline nodes={node.c} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <Inline nodes={node.c} />
          </em>
        );
      case "code":
        return <code key={i}>{node.v}</code>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            <Inline nodes={node.c} />
          </a>
        );
      case "note":
        return (
          <Badge key={i} tone="info">
            {node.v}
          </Badge>
        );
      case "time":
        return <TimeMark key={i} ms={node.ms} label={node.label} />;
      default:
        return null;
    }
  });
}

function TimeMark({ ms, label }: { ms: number; label: string }) {
  const { jumpToTime } = usePlayback();
  return (
    <AriaButton className={s.timeMark} aria-label={`${label}로 이동 (${formatSpokenTime(ms)})`} onPress={() => jumpToTime(ms)}>
      {label}
    </AriaButton>
  );
}
