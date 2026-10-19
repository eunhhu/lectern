// The structured document (DESIGN.md §3.12) with sources (§3.13) as small numbered marks
// that keep the prose readable, numbered through the whole document like footnotes. A
// transcript mark seeks the audio, highlights the cited segments and opens the transcript
// there; a PDF mark (p.4) opens that page in the files panel. Hovering or focusing a mark
// previews the time, speaker and quote in a non-modal popover. Blocks without sources say
// so instead of hiding it ("출처 확인 필요").

import { createContext, useContext, useMemo } from "react";
import { Button as AriaButton, Popover, PreviewTrigger } from "react-aria-components";
import type { AssetDto, DocumentBlock, DocumentWithVersion, SourceRef } from "../../api/types.ts";
import { formatTimestamp } from "../../lib/format.ts";
import { resolveSourceRange } from "../../lib/segments.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, uiStyles } from "../../ui/controls.tsx";
import { usePlayback } from "./playback.tsx";
import s from "./recording.module.css";

const TEMPLATE_NAME: Record<string, string> = { lecture: "강의 노트", meeting: "회의록", "legacy-markdown": "이전 문서" };
const CALLOUT: Record<string, { label: string; tone: "danger" | "severe" | "attention" | "info" }> = {
  exam: { label: "시험", tone: "danger" },
  assignment: { label: "과제", tone: "severe" },
  important: { label: "중요", tone: "attention" },
  note: { label: "참고", tone: "info" },
};
const GAP_LABEL: Record<string, string> = { break: "쉬는 시간", tail: "녹음 끝", missing_transcript: "전사하지 못한 구간" };

/** Footnote-style numbers for the transcript sources, in reading order. */
const SourceNumbers = createContext<Map<SourceRef, number>>(new Map());

function numberSources(body: DocumentWithVersion["version"]["body"]): Map<SourceRef, number> {
  const numbers = new Map<SourceRef, number>();
  const add = (refs: SourceRef[]) => {
    for (const ref of refs) if (ref.kind === "transcript") numbers.set(ref, numbers.size + 1);
  };
  for (const section of body?.sections ?? []) {
    for (const block of section.blocks) {
      if (block.type === "list") block.items.forEach((item) => add(item.sources));
      else if ("sources" in block && Array.isArray(block.sources)) add(block.sources as SourceRef[]);
    }
  }
  return numbers;
}

export function DocumentPane({ doc, pdfs, headingId }: { doc: DocumentWithVersion; pdfs: AssetDto[]; headingId: string }) {
  const body = doc.version.body;
  const numbers = useMemo(() => numberSources(body), [body]);
  return (
    <SourceNumbers.Provider value={numbers}>
      <article className={s.document} aria-labelledby={headingId}>
        <div className={s.docMeta}>
          <Badge>{TEMPLATE_NAME[doc.document.template_id] ?? doc.document.template_id}</Badge>
          {doc.document.user_edited ? <Badge tone="accent">직접 수정</Badge> : <Badge>AI 생성</Badge>}
          <span className={s.docVersion}>버전 {doc.version.version}</span>
        </div>
        {!body ? (
          <pre className={s.legacy}>{doc.version.rendered_md}</pre>
        ) : (
          body.sections.map((section) => (
            <section key={section.key} className={s.docSection} aria-labelledby={`sec-${section.key}`}>
              <h2 id={`sec-${section.key}`} className={s.docH2}>
                {section.title}
              </h2>
              {section.blocks.map((block) => (
                <Block key={block.id} block={block} pdfs={pdfs} />
              ))}
            </section>
          ))
        )}
      </article>
    </SourceNumbers.Provider>
  );
}

function Block({ block, pdfs }: { block: DocumentBlock; pdfs: AssetDto[] }) {
  const heading = "heading" in block && block.heading ? <h3 className={s.docH3}>{block.heading}</h3> : null;
  switch (block.type) {
    case "paragraph":
      return (
        <>
          {heading}
          <p className={s.docP}>
            {block.text} <Chips sources={block.sources} pdfs={pdfs} />
          </p>
        </>
      );
    case "list": {
      const List = block.style === "numbered" ? "ol" : "ul";
      return (
        <>
          {heading}
          <List className={s.docList}>
            {block.items.map((item, i) => (
              <li key={i}>
                {item.text} <Chips sources={item.sources} pdfs={pdfs} />
              </li>
            ))}
          </List>
        </>
      );
    }
    case "quote":
      return (
        <>
          {heading}
          <QuoteBlock text={block.text} speaker={block.speaker} sources={block.sources} pdfs={pdfs} />
        </>
      );
    case "term":
      return (
        <>
          {heading}
          <dl className={s.docTerm}>
            <dt>{block.term}</dt>
            <dd>
              {block.definition} <Chips sources={block.sources} pdfs={pdfs} />
            </dd>
          </dl>
        </>
      );
    case "formula":
      return (
        <>
          {heading}
          <figure className={s.docFormula}>
            <code lang="en">{block.expression}</code>
            {block.explanation && <figcaption>{block.explanation}</figcaption>}
            <Chips sources={block.sources} pdfs={pdfs} />
          </figure>
        </>
      );
    case "callout": {
      const tone = CALLOUT[block.tone] ?? CALLOUT.note!;
      return (
        <>
          {heading}
          <div className={s.callout} data-tone={tone.tone}>
            <Icon name="alert" />
            <p>
              <strong className={s.calloutLabel}>{tone.label}</strong> {block.text} <Chips sources={block.sources} pdfs={pdfs} />
            </p>
          </div>
        </>
      );
    }
    case "gap":
      return (
        <p className={s.docGap}>
          {GAP_LABEL[block.kind] ?? "구간 없음"} · {formatTimestamp(block.start_ms)}–{formatTimestamp(block.end_ms)}
        </p>
      );
    default:
      return null; // Unknown block types render as nothing (packages/domain: open union).
  }
}

function QuoteBlock({ text, speaker, sources, pdfs }: { text: string; speaker: string | null; sources: SourceRef[]; pdfs: AssetDto[] }) {
  const { segments, speakerNames } = usePlayback();
  const first = sources.find((x) => x.kind === "transcript");
  const range = first?.kind === "transcript" ? resolveSourceRange(segments, first) : null;
  const who = range ? speakerNames.get(segments[range.first]!.speaker_id ?? "") : speaker ? `화자 ${speaker.replace(/^S/, "")}` : null;
  return (
    <blockquote className={s.docQuote}>
      <p>{text}</p>
      <footer>
        {who && <cite>{who}</cite>} <Chips sources={sources} pdfs={pdfs} />
      </footer>
    </blockquote>
  );
}

function Chips({ sources, pdfs }: { sources: SourceRef[]; pdfs: AssetDto[] }) {
  const numbers = useContext(SourceNumbers);
  if (sources.length === 0) {
    return (
      <span className={s.chipWarn}>
        <Icon name="alert" size={12} />
        출처 확인 필요
      </span>
    );
  }
  return (
    <span className={s.marks}>
      {sources.map((ref, i) =>
        ref.kind === "transcript" ? (
          <TranscriptChip key={i} source={ref} n={numbers.get(ref) ?? i + 1} />
        ) : ref.kind === "pdf_page" ? (
          <PdfChip key={i} assetId={ref.asset_id} page={ref.page} pdfs={pdfs} />
        ) : null,
      )}
    </span>
  );
}

function TranscriptChip({ source, n }: { source: { start_idx: number; end_idx: number }; n: number }) {
  const { segments, speakerNames, jumpToRange } = usePlayback();
  const range = resolveSourceRange(segments, source);
  if (!range) {
    return (
      <span className={s.mark} data-state="missing">
        원본 없음
      </span>
    );
  }
  const ts = formatTimestamp(range.start_ms);
  const speaker = speakerNames.get(segments[range.first]!.speaker_id ?? "") ?? null;
  const quote = segments
    .slice(range.first, range.last + 1)
    .map((seg) => seg.text)
    .join(" ");
  return (
    <PreviewTrigger delay={500}>
      <AriaButton className={s.mark} aria-label={`출처 ${n}, ${ts}${speaker ? `, ${speaker}` : ""}`} onPress={() => jumpToRange(source)}>
        {n}
      </AriaButton>
      <Popover className={`${uiStyles.popover} ${s.preview}`} placement="top">
        <p className={s.previewMeta}>
          {ts}
          {speaker && ` · ${speaker}`}
        </p>
        <p className={s.previewQuote}>{quote.length > 180 ? `${quote.slice(0, 180)}…` : quote}</p>
        <p className={uiStyles.hint}>누르면 이 구간으로 이동합니다.</p>
      </Popover>
    </PreviewTrigger>
  );
}

function PdfChip({ assetId, page, pdfs }: { assetId: string; page: number; pdfs: AssetDto[] }) {
  const { showPdfPage } = usePlayback();
  const pdf = pdfs.find((p) => p.id === assetId);
  const name = typeof pdf?.meta.original_name === "string" ? pdf.meta.original_name : "PDF";
  return (
    <AriaButton className={s.mark} aria-label={`출처 p.${page}, ${name} ${page}쪽`} onPress={() => showPdfPage(assetId, page)}>
      p.{page}
    </AriaButton>
  );
}
