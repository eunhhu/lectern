// ⌘K / Ctrl+K command palette (DESIGN.md §3.7): one entry point for moving around,
// running commands, opening recordings and folders, searching transcripts, documents and
// PDF pages (every result on the search screen), and asking the notes a question
// (물어보기: this note, this folder or all notes, listed first when the text reads like a
// question). Matching ignores spaces and case and accepts 초성 ("ㅇㅇㅊㅈ" → 운영체제).
// Service operators also find the admin console here once they type (P5-13, the old
// console's palette): its screens, its commands (유지보수 실행, 전체 압축, 고아 파일 정리,
// 보존 정책 적용 — each opens its preview and asks first — and 새 사용자), and every
// account's recordings by title. Nobody else asks the admin routes anything.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, type Key } from "react";
import {
  Autocomplete,
  Dialog,
  Header,
  Input,
  Keyboard,
  Menu,
  MenuItem,
  MenuSection,
  Modal,
  ModalOverlay,
  Text,
  TextField,
} from "react-aria-components";
import { queryKeys, useApi, useFolders, useIsOperator, useRecordings } from "../api/queries.ts";
import { ADMIN_TABS } from "../routes/admin/AdminLayout.tsx";
import type { RecordingDetail } from "../api/types.ts";
import { bestMatch, looksLikeQuestion } from "../lib/hangul.ts";
import { formatDate, formatTimestamp } from "../lib/format.ts";
import { useImeSafeQuery } from "../lib/ime-query.ts";
import { hitPdfTarget, hitText, hitTime } from "../lib/search-hits.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Kbd } from "../ui/controls.tsx";
import { DOMAIN_LABEL } from "./labels.ts";
import { closeOverlay, openOverlay, useOverlay } from "./overlays.ts";
import { cycleTheme } from "./preferences.ts";
import { NAV_ITEMS } from "./commands.ts";
import { useWorkspace } from "./workspace.tsx";
import s from "./palette.module.css";

interface Item {
  id: string;
  label: string;
  icon: IconName;
  detail?: string;
  keys?: string[];
  aliases?: string[];
  run: () => void;
}

interface Section {
  id: string;
  title: string;
  items: Item[];
}

const NAV_ALIASES: Record<string, string[]> = {
  "/": ["home", "inbox", "수신함"],
  "/library": ["library", "recordings", "녹음"],
  "/ask": ["ask", "agent", "rag", "ai", "질문", "에이전트"],
  "/calendar": ["calendar", "schedule", "events"],
  "/settings": ["settings", "preferences", "환경"],
};

const ADMIN_ALIASES: Record<string, string[]> = {
  "/admin": ["overview", "dashboard", "대시보드"],
  "/admin/users": ["users", "members", "멤버"],
  "/admin/recordings": ["lectures", "recordings", "강의"],
  "/admin/jobs": ["jobs", "queue"],
  "/admin/usage": ["usage", "quota", "한도"],
  "/admin/storage": ["storage", "disk", "스토리지", "디스크"],
  "/admin/ops": ["ops", "backup", "deploy", "server", "백업", "배포", "서버"],
  "/admin/settings": ["settings", "policy", "정책"],
  "/admin/audit": ["audit", "log", "기록"],
};

function rank(items: Item[], query: string, limit = 50): Item[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: bestMatch(item.label, item.aliases ?? [], query) }))
    .filter((x): x is { item: Item; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}

export function CommandPalette() {
  const [isOpen, setOpen] = useOverlay("palette");
  return (
    <ModalOverlay className={s.scrim} isOpen={isOpen} onOpenChange={setOpen} isDismissable>
      <Modal className={s.modal}>
        <Dialog className={s.dialog} aria-label="명령 팔레트">
          <PaletteBody />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function PaletteBody() {
  const api = useApi();
  const navigate = useNavigate();
  const { workspaceId, workspaces, switchTo } = useWorkspace();
  const recordings = useRecordings(workspaceId).data ?? [];
  const folders = useFolders(workspaceId).data ?? [];
  // `query` is what the field shows (the ranking follows it as typed); `q`, the content
  // search, waits for the text to rest and never sends half-typed Hangul.
  const ime = useImeSafeQuery("", 180);
  const query = ime.raw;
  const setQuery = ime.setRaw;
  const q = ime.committed;
  // Where the palette was opened, for "이 노트에 물어보기" and "이 폴더에 물어보기".
  const location = useRouterState({ select: (st) => ({ pathname: st.location.pathname, search: st.location.search as { folder?: string } }) });
  const here = /\/recordings\/([^/]+)$/.exec(location.pathname);
  // The open recording may belong to another workspace than the one in the sidebar.
  const hereRecordingId = here ? decodeURIComponent(here[1]!) : null;
  const openDetail = useQueryClient().getQueryData<RecordingDetail>(queryKeys.recording(hereRecordingId ?? ""));
  const hereRecording = hereRecordingId ? { id: hereRecordingId, title: openDetail?.recording.title ?? recordings.find((r) => r.id === hereRecordingId)?.title ?? "열려 있는 녹음" } : undefined;
  const hereFolder = location.pathname.endsWith("/library") && location.search.folder && location.search.folder !== "none" ? folders.find((f) => f.id === location.search.folder) : undefined;

  const operator = useIsOperator() === true;
  const adminLectures = useQuery({
    queryKey: ["admin", "palette-lectures", q],
    queryFn: () => api.admin.lectures({ q, limit: 5 }),
    enabled: operator && q.length >= 2,
    staleTime: 30_000,
  });

  const search = useQuery({
    queryKey: ["palette-search", workspaceId, q],
    queryFn: () => api.search({ workspace_id: workspaceId, q, limit: 8 }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });

  const now = new Date();
  const go = (fn: () => void) => () => {
    closeOverlay("palette");
    fn();
  };

  const sections: Section[] = useMemo(() => {
    const nav: Item[] = NAV_ITEMS.map((n) => ({
      id: `go:${n.to}`,
      label: n.label,
      icon: n.icon,
      detail: "이동",
      keys: ["G", n.key],
      aliases: NAV_ALIASES[n.to],
      run: go(() => void navigate({ to: n.to })),
    }));
    const commands: Item[] = [
      { id: "cmd:upload", label: "녹음 올리기", icon: "upload", keys: ["U"], aliases: ["upload", "add", "추가"], run: () => openOverlay("upload") },
      { id: "cmd:theme", label: "테마 전환", icon: "sun", aliases: ["theme", "dark", "light", "다크", "라이트"], run: go(cycleTheme) },
      { id: "cmd:shortcuts", label: "단축키 보기", icon: "keyboard", keys: ["?"], aliases: ["shortcuts", "keyboard", "help", "도움말"], run: () => openOverlay("shortcuts") },
      ...workspaces
        .filter((w) => w.workspace.id !== workspaceId)
        .map((w) => ({
          id: `ws:${w.workspace.id}`,
          label: `워크스페이스 전환: ${w.workspace.name}`,
          icon: "workspace" as IconName,
          aliases: ["workspace", "switch", "전환"],
          run: go(() => {
            switchTo(w.workspace.id);
            void navigate({ to: "/" });
          }),
        })),
    ];
    const recs: Item[] = recordings.map((r) => ({
      id: `rec:${r.id}`,
      label: r.title,
      icon: "audio",
      detail: `${DOMAIN_LABEL[r.domain]} · ${formatDate(r.recorded_at, now)}`,
      run: go(() => void navigate({ to: "/recordings/$recordingId", params: { recordingId: r.id } })),
    }));
    const flds: Item[] = folders.map((f) => ({
      id: `folder:${f.id}`,
      label: f.name,
      icon: "folder",
      detail: "폴더",
      aliases: ["folder"],
      run: go(() => void navigate({ to: "/library", search: { folder: f.id } })),
    }));
    // Title hits (`kind: "recording"`) are already in the recordings list above.
    const hits: Item[] = (q.length >= 2 ? (search.data?.items ?? []) : []).filter((h) => h.kind !== "recording").map((h, i) => {
      const text = hitText(h);
      const pdf = hitPdfTarget(h);
      const t = hitTime(h);
      const where = pdf ? ` · p.${pdf.page}` : t !== undefined ? ` · ${formatTimestamp(t)}` : "";
      const to = pdf ? { pdf: `${pdf.assetId}:${pdf.page}` } : t !== undefined ? { t } : {};
      return {
        id: `hit:${i}:${h.recording_id}`,
        label: text,
        icon: (h.kind === "transcript" ? "quote" : "pdf") as IconName,
        detail: `${h.recording_title}${where}`,
        aliases: [q],
        run: go(() => void navigate({ to: "/recordings/$recordingId", params: { recordingId: h.recording_id }, search: to })),
      };
    });
    const question = query.trim();
    const asks: Item[] =
      question.length >= 2
        ? [
            ...(hereRecording
              ? [
                  {
                    id: "ask:note",
                    label: `이 노트에 물어보기: ${question}`,
                    icon: "spark" as IconName,
                    detail: hereRecording.title,
                    run: go(() => void navigate({ to: "/recordings/$recordingId", params: { recordingId: hereRecording.id }, search: { ask: question } })),
                  },
                ]
              : []),
            ...(hereFolder
              ? [
                  {
                    id: "ask:folder",
                    label: `이 폴더에 물어보기: ${question}`,
                    icon: "spark" as IconName,
                    detail: `${hereFolder.name} 폴더`,
                    run: go(() => void navigate({ to: "/ask", search: { q: question, scope: "folder", id: hereFolder.id } })),
                  },
                ]
              : []),
            {
              id: "ask:all",
              label: `전체 노트에 물어보기: ${question}`,
              icon: "spark" as IconName,
              detail: "답에 출처를 붙입니다",
              run: go(() => void navigate({ to: "/ask", search: { q: question, scope: "workspace" } })),
            },
          ]
        : [];
    const askSection: Section = { id: "ask", title: "물어보기", items: asks };
    const admin: Item[] = operator
      ? [
          ...ADMIN_TABS.map((t) => ({
            id: `admin:go:${t.to}`,
            label: `관리 › ${t.label}`,
            icon: t.icon,
            detail: "이동",
            aliases: ["admin", ...(ADMIN_ALIASES[t.to] ?? [])],
            run: go(() => void navigate({ to: t.to })),
          })),
          { id: "admin:maintenance", label: "유지보수 실행", icon: "settings", detail: "관리", aliases: ["maintenance", "backup", "백업"], run: go(() => void navigate({ to: "/admin/ops", search: { run: "maintenance" } })) },
          { id: "admin:compact", label: "전체 압축 (미리보기)", icon: "folder", detail: "관리", aliases: ["compact", "compress", "압축"], run: go(() => void navigate({ to: "/admin/storage", search: { run: "compact" } })) },
          { id: "admin:gc", label: "고아 파일 정리 (미리보기)", icon: "trash", detail: "관리", aliases: ["gc", "orphan", "trash", "휴지통"], run: go(() => void navigate({ to: "/admin/storage", search: { run: "gc" } })) },
          { id: "admin:retention", label: "보존 정책 적용 (미리보기)", icon: "clock", detail: "관리", aliases: ["retention", "보존", "정리"], run: go(() => void navigate({ to: "/admin/storage", search: { run: "retention" } })) },
          { id: "admin:new-user", label: "새 사용자", icon: "plus", detail: "관리", keys: ["C"], aliases: ["new user", "create user", "add member", "새 멤버"], run: go(() => void navigate({ to: "/admin/users", search: { new: 1 } })) },
        ]
      : [];
    const adminRecs: Item[] = (adminLectures.data?.lectures ?? []).map((l) => ({
      id: `admin:rec:${l.id}`,
      label: l.title || "제목 없음",
      icon: "audio",
      detail: l.owner_email,
      run: go(() => void navigate({ to: "/admin/recordings/$lectureId", params: { lectureId: l.id } })),
    }));
    const out: Section[] = [
      ...(looksLikeQuestion(question) ? [askSection] : []),
      { id: "nav", title: "이동", items: rank(nav, query) },
      { id: "commands", title: "명령", items: rank(commands, query) },
      { id: "recordings", title: "녹음", items: rank(recs, query, query.trim() ? 8 : 5) },
      { id: "folders", title: "폴더", items: query.trim() ? rank(flds, query, 5) : [] },
      { id: "hits", title: "전사·문서", items: hits },
      ...(looksLikeQuestion(question) ? [] : [askSection]),
      // Operators only, once something is typed: the app's own results come first.
      { id: "admin", title: "관리", items: query.trim() ? rank(admin, query, 8) : [] },
      { id: "admin-recordings", title: "관리 · 모든 녹음", items: q.length >= 2 ? adminRecs : [] },
    ];
    if (query.trim()) {
      out.push({
        id: "all",
        title: "전체 검색",
        items: [
          {
            id: "search:all",
            label: `‘${query.trim()}’ 모든 결과 보기`,
            icon: "search",
            run: go(() => void navigate({ to: "/search", search: { q: query.trim() } })),
          },
        ],
      });
    }
    return out.filter((sec) => sec.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, q, recordings, folders, workspaces, workspaceId, search.data, hereRecording, hereFolder, operator, adminLectures.data]);

  const byId = new Map(sections.flatMap((sec) => sec.items.map((it) => [it.id, it] as const)));
  const nothing = query.trim() !== "" && sections.every((sec) => sec.id === "all");

  return (
    <Autocomplete inputValue={query} onInputChange={setQuery}>
      {/* A TextField, not a SearchField: Esc should close the palette at once instead of
          first clearing the query. */}
      <TextField className={s.search} aria-label="이동, 명령, 녹음 검색 또는 질문" autoFocus>
        <Icon name="search" />
        <Input className={s.input} placeholder="이동, 명령, 녹음 검색 또는 노트에 질문…" {...ime.inputProps} />
      </TextField>
      {nothing && <p className={s.none}>일치하는 항목이 없습니다.</p>}
      <Menu className={s.menu} aria-label="결과" onAction={(key: Key) => byId.get(String(key))?.run()}>
        {sections.map((sec) => (
          <MenuSection key={sec.id} id={sec.id} className={s.section}>
            <Header className={s.header}>{sec.title}</Header>
            {sec.items.map((item) => (
              <MenuItem key={item.id} id={item.id} textValue={item.label} className={s.item}>
                <Icon name={item.icon} />
                <span className={s.itemText}>
                  <Text slot="label" className={s.itemLabel}>
                    {item.label}
                  </Text>
                  {item.detail && (
                    <Text slot="description" className={s.itemDetail}>
                      {item.detail}
                    </Text>
                  )}
                </span>
                {item.keys && (
                  <Keyboard className={s.keys}>
                    <Kbd keys={item.keys} />
                  </Keyboard>
                )}
              </MenuItem>
            ))}
          </MenuSection>
        ))}
      </Menu>
      <div className={s.footer} aria-hidden="true">
        <span>
          <Kbd keys={["↑", "↓"]} /> 이동
        </span>
        <span>
          <Kbd keys={["↵"]} /> 실행
        </span>
        <span>
          <Kbd keys={["esc"]} /> 닫기
        </span>
        <span>질문을 쓰면 ‘물어보기’로 바로 답을 받습니다</span>
      </div>
    </Autocomplete>
  );
}
