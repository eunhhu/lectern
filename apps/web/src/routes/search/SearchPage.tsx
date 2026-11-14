// 검색 (D-P3-5): the hybrid GET /search of the workspace, grouped by what matched (a
// recording's title, its transcript, its document, a page of its PDF). A hit opens the
// recording there: transcripts and documents at their time, a PDF hit at its page in the
// files panel. Half-typed Hangul never searches (useImeSafeQuery); the query and the kind
// filter live in the URL, so the page can be linked and reloaded.

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Input, TextField, ToggleButton } from "react-aria-components";
import { errorMessage } from "../../api/errors.ts";
import { useSearchHits } from "../../api/queries.ts";
import type { SearchHit } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatTimestamp } from "../../lib/format.ts";
import { useImeSafeQuery } from "../../lib/ime-query.ts";
import { cleanSnippet, groupHits, hitPdfTarget, hitTime } from "../../lib/search-hits.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Button, EmptyState, ErrorBox, uiStyles } from "../../ui/controls.tsx";
import layout from "../../app/layout.module.css";
import s from "./search.module.css";

export interface SearchPageSearch {
  q?: string;
  kind?: "transcript" | "document" | "pdf_page";
}

const KINDS: Array<{ id: string; kind: SearchPageSearch["kind"]; label: string }> = [
  { id: "all", kind: undefined, label: "전체" },
  { id: "transcript", kind: "transcript", label: "전사" },
  { id: "document", kind: "document", label: "문서" },
  { id: "pdf_page", kind: "pdf_page", label: "PDF" },
];

const ICON: Record<string, IconName> = { recording: "audio", transcript: "quote", document: "book", pdf_page: "pdf" };

export function SearchPage() {
  usePageTitle("검색");
  const { workspaceId } = useWorkspace();
  const search = useSearch({ from: "/_authed/search" });
  const navigate = useNavigate();
  const query = useImeSafeQuery(search.q ?? "");
  const { committed, setRaw } = query;
  const kind = search.kind;

  // The URL follows the committed query; a q the page did not write (the palette's
  // "모든 결과 보기" while this page is open) replaces the field.
  const written = useRef(search.q ?? "");
  useEffect(() => {
    if (committed === written.current) return;
    written.current = committed;
    void navigate({ to: "/search", search: { q: committed || undefined, kind }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);
  useEffect(() => {
    const q = search.q ?? "";
    if (q === written.current) return;
    written.current = q;
    setRaw(q);
  }, [search.q, setRaw]);

  const hits = useSearchHits(workspaceId, committed, kind);
  const groups = groupHits(hits.data?.items ?? []);

  return (
    <div className={layout.page}>
      <header className={layout.pageHeader}>
        <h1 className={layout.pageTitle}>검색</h1>
      </header>
      <div className={s.controls}>
        <TextField className={s.field} aria-label="내용 검색" value={query.raw} onChange={setRaw} autoFocus>
          <Icon name="search" />
          <Input className={`${uiStyles.input} ${s.input}`} placeholder="전사, 문서, PDF에서 찾기" {...query.inputProps} />
        </TextField>
        <div className={s.kinds} role="group" aria-label="찾을 곳">
          {KINDS.map((k) => (
            <ToggleButton
              key={k.id}
              className={s.kind}
              isSelected={kind === k.kind}
              onChange={() => void navigate({ to: "/search", search: { q: committed || undefined, kind: k.kind }, replace: true })}
            >
              {k.label}
            </ToggleButton>
          ))}
        </div>
      </div>

      {committed.length < 2 ? (
        <p className={s.hint}>두 글자 이상 입력하면 전사, 문서, PDF에서 찾습니다.</p>
      ) : hits.isPending ? (
        <p className={s.hint} role="status">
          찾는 중…
        </p>
      ) : hits.isError ? (
        <ErrorBox title="검색하지 못했습니다." onRetry={() => void hits.refetch()}>
          {errorMessage(hits.error)}
        </ErrorBox>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="search"
          title={`‘${committed}’에 맞는 결과가 없습니다.`}
          action={
            <Button icon="spark" onPress={() => void navigate({ to: "/ask", search: { q: committed, scope: "workspace" } })}>
              물어보기
            </Button>
          }
        >
          다른 단어로 찾거나 물어보기를 써 보세요.
        </EmptyState>
      ) : (
        <div className={s.groups}>
          {groups.map((g) => (
            <section key={g.key} className={s.group} aria-label={`${g.label} 결과`}>
              <h2 className={s.groupTitle}>
                {g.label} <span className={s.count}>{g.hits.length}</span>
              </h2>
              <ul className={s.list} role="list">
                {g.hits.map((hit, i) => (
                  <li key={`${hit.recording_id}:${i}`}>
                    <HitLink hit={hit} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function HitLink({ hit }: { hit: SearchHit }) {
  const t = hitTime(hit);
  const pdf = hitPdfTarget(hit);
  const where = pdf ? `p.${pdf.page}` : t !== undefined ? formatTimestamp(t) : null;
  const search = pdf ? { pdf: `${pdf.assetId}:${pdf.page}` } : t !== undefined ? { t } : {};
  return (
    <Link className={s.hit} to="/recordings/$recordingId" params={{ recordingId: hit.recording_id }} search={search}>
      <Icon name={ICON[hit.kind] ?? "search"} />
      <span className={s.hitText}>
        <span className={s.snippet}>
          {cleanSnippet(hit.snippet).map((part, i) => (part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
        </span>
        <span className={s.meta}>
          {hit.recording_title}
          {where && ` · ${where}`}
        </span>
      </span>
    </Link>
  );
}
