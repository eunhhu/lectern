// 관리 › 녹음 (P5-16): every account's v1 lectures, the old console's 강의 view
// (`GET /api/admin/lectures`): a status filter with the server's counts, a search (title,
// course, owner e-mail, id), an owner filter (from a user's page), all kept in the address,
// fifty at a time with "더 보기". A row opens the lecture.

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { AdminLecture } from "../../api/admin.ts";
import { errorMessage } from "../../api/errors.ts";
import { useAdminLectures, useAdminOverview } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { formatBytes, formatCount, formatDateTime } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ErrorBox, SelectField } from "../../ui/controls.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import { formatSeconds, LECTURE_STATUS_LABEL } from "./format.ts";
import { SearchBox } from "./SearchBox.tsx";
import s from "./admin.module.css";

export interface AdminRecordingsSearch {
  status?: AdminLecture["status"];
  q?: string;
  owner?: string;
}

export const LECTURE_TONE = { processing: "info", done: "success", error: "danger" } as const;

/** "완료", "처리 중 40%", "압축 대기" … for a lecture row. */
export function LectureStatusBadge({ lecture }: { lecture: Pick<AdminLecture, "status" | "progress" | "job_state" | "job_kind"> }) {
  const label = LECTURE_STATUS_LABEL[lecture.status] + (lecture.status === "processing" && lecture.progress > 0 ? ` ${lecture.progress}%` : "");
  return (
    <span className={s.badges}>
      <Badge tone={LECTURE_TONE[lecture.status]}>{label}</Badge>
      {lecture.job_kind === "compact" && lecture.job_state && <Badge tone="info">{lecture.job_state === "running" ? "압축 중" : "압축 대기"}</Badge>}
    </span>
  );
}

export function RecordingsPage() {
  usePageTitle("관리 · 녹음");
  const search = useSearch({ from: "/_authed/admin/recordings" });
  const navigate = useNavigate();
  const lectures = useAdminLectures({ status: search.status, q: search.q, owner: search.owner });
  const users = useAdminOverview().data?.users ?? [];
  const now = new Date();
  const pages = lectures.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.lectures);
  const first = pages[0];
  const total = first?.total ?? 0;
  const owner = search.owner ? users.find((u) => u.id === search.owner) : undefined;
  const ownerName = owner ? owner.display_name || owner.email : search.owner;

  const setFilter = (next: AdminRecordingsSearch) => void navigate({ to: "/admin/recordings", search: { ...search, ...next }, replace: true });

  const columns: Column<AdminLecture>[] = [
    { key: "status", header: "상태", sortValue: (l) => LECTURE_STATUS_LABEL[l.status], cell: (l) => <LectureStatusBadge lecture={l} /> },
    {
      key: "title",
      header: "제목",
      sortValue: (l) => l.title,
      cell: (l) => (
        <span className={s.person}>
          <Link to="/admin/recordings/$lectureId" params={{ lectureId: l.id }} className={s.link}>
            {l.title || "제목 없음"}
          </Link>
          {l.course && <span className={s.muted}>{l.course}</span>}
        </span>
      ),
    },
    { key: "owner", header: "소유자", sortValue: (l) => l.owner_email, cell: (l) => l.owner_email || "—" },
    { key: "duration", header: "길이", align: "right", sortValue: (l) => l.duration_sec, cell: (l) => formatSeconds(l.duration_sec) },
    {
      key: "audio",
      header: "오디오",
      align: "right",
      sortValue: (l) => (l.has_audio ? l.audio_size : null),
      cell: (l) =>
        l.has_audio ? (
          <span className={s.badges}>
            {l.compacted && <Badge tone="success">압축됨</Badge>}
            {formatBytes(l.audio_size)}
          </span>
        ) : (
          <span className={s.muted}>오디오 없음</span>
        ),
    },
    { key: "created", header: "만든 시각", sortValue: (l) => Date.parse(l.created_at), cell: (l) => formatDateTime(l.created_at, now) },
  ];

  const count = (k: "all" | "processing" | "error" | "done") => (first ? ` (${formatCount(first.counts[k])})` : "");

  return (
    <>
      <header className={s.header}>
        <h1 className={s.title}>녹음</h1>
        {first && <span className={s.muted}>{formatCount(total)}개</span>}
      </header>
      <div className={s.filters}>
        <SelectField
          label="상태"
          items={[
            { id: "all", label: `전체${count("all")}` },
            { id: "processing", label: `처리 중${count("processing")}` },
            { id: "error", label: `오류${count("error")}` },
            { id: "done", label: `완료${count("done")}` },
          ]}
          selectedKey={search.status ?? "all"}
          onSelectionChange={(v) => setFilter({ status: v === "all" ? undefined : (v as AdminLecture["status"]) })}
        />
        <SearchBox label="검색" placeholder="제목, 과목, 소유자 이메일" value={search.q} onCommit={(q) => setFilter({ q })} />
        {search.owner && (
          <div className={s.chipField}>
            <span className={s.chipLabel}>소유자</span>
            <Button size="sm" aria-label={`소유자 필터 해제: ${ownerName}`} onPress={() => setFilter({ owner: undefined })}>
              {ownerName}
              <Icon name="close" size={12} />
            </Button>
          </div>
        )}
      </div>
      {lectures.isError ? (
        <ErrorBox title={errorMessage(lectures.error, "녹음을 불러오지 못했습니다.")} onRetry={() => void lectures.refetch()} />
      ) : (
        <DataTable
          caption="녹음"
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          empty={lectures.isPending ? "불러오는 중…" : search.status || search.q || search.owner ? "조건에 맞는 녹음이 없습니다." : "아직 녹음이 없습니다."}
          onRowClick={(l) => void navigate({ to: "/admin/recordings/$lectureId", params: { lectureId: l.id } })}
        />
      )}
      {lectures.hasNextPage && (
        <div className={s.more}>
          <Button onPress={() => void lectures.fetchNextPage()} isDisabled={lectures.isFetchingNextPage}>
            {lectures.isFetchingNextPage ? "불러오는 중…" : `더 보기 (${formatCount(total - rows.length)}개 남음)`}
          </Button>
        </div>
      )}
    </>
  );
}
