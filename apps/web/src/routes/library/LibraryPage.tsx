// Library (ARCHITECTURE §7): folder tree, tags and smart views on the left; the
// recording list with multi-select and bulk move/tag/delete on the right. Dragging
// recordings onto a folder moves them; "폴더로 이동…" does the same by keyboard
// (WCAG 2.5.7).

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button as AriaButton,
  GridList,
  GridListItem,
  Input,
  isTextDropItem,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  SearchField,
  Toolbar,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop,
  type Key,
  type Selection,
} from "react-aria-components";
import { useFolders, useRecordings, useTags } from "../../api/queries.ts";
import type { Folder, RecordingListItem } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { DOMAIN_LABEL, STATUS, TAG_TONE } from "../../app/labels.ts";
import { openOverlay } from "../../app/overlays.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import type { LibrarySearch } from "../../app/router.tsx";
import { formatCount, formatDate, formatDateTime, formatDuration } from "../../lib/format.ts";
import { matchScore } from "../../lib/hangul.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, CheckboxField, Dot, EmptyState, uiStyles } from "../../ui/controls.tsx";
import { announce } from "../../ui/toast.tsx";
import layout from "../../app/layout.module.css";
import { BulkDialogs, useBulkMove, type BulkAction } from "./BulkDialogs.tsx";
import { folderAndDescendants, folderPath, folderTree, SMART_VIEWS, type FolderNode } from "./folders.ts";
import s from "./library.module.css";

const DRAG_TYPE = "application/x-lectern-recording";

export function LibraryPage() {
  const search = useSearch({ from: "/library" });
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const recordings = useRecordings(workspaceId);
  const folders = useFolders(workspaceId).data ?? [];
  const tags = useTags(workspaceId).data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>(null);
  const [query, setQuery] = useState(search.q ?? "");
  const now = useMemo(() => new Date(), []);

  useEffect(() => setQuery(search.q ?? ""), [search.q]);

  const all = recordings.data ?? [];
  const view = SMART_VIEWS.find((v) => v.id === search.view);
  const tag = tags.find((t) => t.id === search.tag);
  const folder = folders.find((f) => f.id === search.folder);
  const title = view?.name ?? tag?.name ?? (search.folder === "none" ? "폴더 없음" : folder?.name) ?? "모든 녹음";
  usePageTitle(title === "모든 녹음" ? "라이브러리" : `${title} · 라이브러리`);

  const visible = useMemo(() => {
    const inFolder = folder ? folderAndDescendants(folders, folder.id) : null;
    return all.filter(
      (r) =>
        (!view || view.matches(r, now)) &&
        (!tag || r.tag_ids.includes(tag.id)) &&
        (search.folder !== "none" || r.folder_id === null) &&
        (!inFolder || (r.folder_id !== null && inFolder.has(r.folder_id))) &&
        (!query.trim() || matchScore(r.title, query) !== null),
    );
  }, [all, view, tag, folder, folders, search.folder, query, now]);

  // Keep the selection to rows that are still shown.
  const visibleIds = new Set(visible.map((r) => r.id));
  const selection = [...selected].filter((id) => visibleIds.has(id));

  const setSelection = (keys: Selection) => {
    const next = keys === "all" ? new Set(visible.map((r) => r.id)) : new Set([...keys].map(String));
    setSelected(next);
    announce(next.size ? `${next.size}개 선택됨` : "선택을 해제했습니다.");
  };

  const filtered = Boolean(view || tag || search.folder || query.trim());
  const clearFilters = () => {
    setQuery("");
    void navigate({ to: "/library", search: {} });
  };

  return (
    <div className={s.layout}>
      <FilterPane search={search} all={all} now={now} />
      <section className={s.listPane} aria-labelledby="library-title">
        <header className={layout.pageHeader}>
          <div className={s.titleBlock}>
            <h1 id="library-title" className={layout.pageTitle}>
              {title}
            </h1>
            <p className={s.count}>
              녹음 {formatCount(visible.length)}개
              {folder && folderPath(folders, folder.id) !== folder.name && ` · ${folderPath(folders, folder.id)}`}
              {view && ` · ${view.description}`}
            </p>
          </div>
          <div className={layout.pageActions}>
            <SearchField
              className={s.search}
              aria-label="제목으로 찾기"
              value={query}
              onChange={setQuery}
              onSubmit={(v) => void navigate({ to: "/library", search: { ...search, q: v || undefined } })}
            >
              <Icon name="search" />
              <Input className={s.searchInput} placeholder="제목으로 찾기" />
            </SearchField>
            <Button variant="primary" icon="upload" onPress={() => openOverlay("upload")}>
              녹음 올리기
            </Button>
          </div>
        </header>

        {selection.length > 0 && (
          <Toolbar className={s.bulkBar} aria-label="선택한 녹음 작업">
            <span className={s.bulkCount}>{selection.length}개 선택됨</span>
            <Button size="sm" icon="folder" onPress={() => setAction({ kind: "move", ids: selection })}>
              폴더로 이동…
            </Button>
            <Button size="sm" icon="tag" onPress={() => setAction({ kind: "tag", ids: selection })}>
              태그…
            </Button>
            <Button size="sm" variant="dangerText" icon="trash" onPress={() => setAction({ kind: "delete", ids: selection })}>
              삭제…
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setSelection(new Set())}>
              선택 해제
            </Button>
          </Toolbar>
        )}

        <RecordingList
          items={visible}
          selection={selection}
          onSelectionChange={setSelection}
          onRowAction={(kind, id) => setAction({ kind, ids: [id] })}
          showFolder={!folder}
          folders={folders}
          empty={
            filtered ? (
              <EmptyState icon="search" title="조건에 맞는 녹음이 없습니다." action={<Button onPress={clearFilters}>필터 지우기</Button>} />
            ) : (
              <EmptyState
                icon="audio"
                title="아직 녹음이 없습니다."
                action={
                  <Button variant="primary" icon="upload" onPress={() => openOverlay("upload")}>
                    녹음 올리기
                  </Button>
                }
              >
                파일을 끌어다 놓거나 ‘녹음 올리기’를 누르세요.
              </EmptyState>
            )
          }
          now={now}
        />
      </section>
      <BulkDialogs action={action} onClose={() => setAction(null)} onFailed={(ids) => setSelected(new Set(ids))} />
    </div>
  );
}

function FilterPane({
  search,
  all,
  now,
}: {
  search: LibrarySearch;
  all: RecordingListItem[];
  now: Date;
}) {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const folders = useFolders(workspaceId).data ?? [];
  const tags = useTags(workspaceId).data ?? [];
  const move = useBulkMove();
  const tree = folderTree(folders);
  // Parents start expanded once the folders have loaded; the viewer can collapse them.
  const [expanded, setExpanded] = useState<Set<Key> | null>(null);
  const parents = folders.filter((f) => folders.some((c) => c.parent_id === f.id)).map((f) => f.id);
  const expandedKeys = expanded ?? new Set<Key>(parents);

  const countIn = (id: string) => {
    const ids = folderAndDescendants(folders, id);
    return all.filter((r) => r.folder_id !== null && ids.has(r.folder_id)).length;
  };
  const unfiled = all.filter((r) => r.folder_id === null).length;

  const { dragAndDropHooks } = useDragAndDrop({
    acceptedDragTypes: [DRAG_TYPE],
    getDropOperation: (target) => (target.type === "item" && target.dropPosition === "on" ? "move" : "cancel"),
    onItemDrop: async (e) => {
      const ids = await Promise.all(e.items.filter(isTextDropItem).map((item) => item.getText(DRAG_TYPE)));
      const key = String(e.target.key);
      await move(ids, key === "none" ? null : key);
    },
  });

  const selectedFolder = search.view || search.tag ? null : (search.folder ?? null);

  const renderNode = (node: FolderNode) => (
    <TreeItem key={node.folder.id} id={node.folder.id} textValue={node.folder.name} className={s.treeItem}>
      <TreeItemContent>
        {({ hasChildItems, isExpanded }) => (
          <span className={s.treeRow} data-depth={node.depth}>
            {hasChildItems ? (
              <AriaButton slot="chevron" className={s.chevron} aria-label={isExpanded ? "접기" : "펼치기"}>
                <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={12} />
              </AriaButton>
            ) : (
              <span className={s.chevronSpacer} />
            )}
            <Icon name="folder" />
            <span className={s.treeLabel}>{node.folder.name}</span>
            <span className={s.navCount}>{countIn(node.folder.id)}</span>
          </span>
        )}
      </TreeItemContent>
      {node.children.map(renderNode)}
    </TreeItem>
  );

  return (
    <aside className={s.filters} aria-label="라이브러리 필터">
      <nav aria-label="보기" className={s.filterGroup}>
        <h2 className={s.filterHeading}>보기</h2>
        <Link to="/library" search={{}} className={s.filterLink} activeOptions={{ includeSearch: true, exact: true }}>
          <Icon name="library" />
          <span className={s.treeLabel}>모든 녹음</span>
          <span className={s.navCount}>{all.length}</span>
        </Link>
        {SMART_VIEWS.map((v) => (
          <Link key={v.id} to="/library" search={{ view: v.id }} className={s.filterLink} activeOptions={{ includeSearch: true }} title={v.description}>
            <Icon name="target" />
            <span className={s.treeLabel}>{v.name}</span>
            <span className={s.navCount}>{all.filter((r) => v.matches(r, now)).length}</span>
          </Link>
        ))}
      </nav>

      <div className={s.filterGroup}>
        <h2 className={s.filterHeading} id="folders-heading">
          폴더
        </h2>
        <Tree
          aria-labelledby="folders-heading"
          className={s.tree}
          selectionMode="single"
          selectionBehavior="replace"
          selectedKeys={selectedFolder ? [selectedFolder] : []}
          onSelectionChange={(keys) => {
            const [key] = keys === "all" ? [] : [...keys];
            if (key !== undefined) void navigate({ to: "/library", search: { folder: String(key) } });
          }}
          expandedKeys={expandedKeys}
          onExpandedChange={(keys) => setExpanded(new Set(keys))}
          dragAndDropHooks={dragAndDropHooks}
        >
          {tree.map(renderNode)}
          <TreeItem id="none" textValue="폴더 없음" className={s.treeItem}>
            <TreeItemContent>
              <span className={s.treeRow} data-depth={0}>
                <span className={s.chevronSpacer} />
                <Icon name="inbox" />
                <span className={s.treeLabel}>폴더 없음</span>
                <span className={s.navCount}>{unfiled}</span>
              </span>
            </TreeItemContent>
          </TreeItem>
        </Tree>
      </div>

      <nav aria-label="태그" className={s.filterGroup}>
        <h2 className={s.filterHeading}>태그</h2>
        {tags.map((t) => (
          <Link key={t.id} to="/library" search={{ tag: t.id }} className={s.filterLink} activeOptions={{ includeSearch: true }}>
            <span className={s.tagDot} data-color={t.color} aria-hidden="true" />
            <span className={s.treeLabel}>{t.name}</span>
            <span className={s.navCount}>{all.filter((r) => r.tag_ids.includes(t.id)).length}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function RecordingList({
  items,
  selection,
  onSelectionChange,
  onRowAction,
  showFolder,
  folders,
  empty,
  now,
}: {
  items: RecordingListItem[];
  selection: string[];
  onSelectionChange: (keys: Selection) => void;
  onRowAction: (kind: "move" | "tag" | "delete", id: string) => void;
  showFolder: boolean;
  folders: Folder[];
  empty: ReactNode;
  now: Date;
}) {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const tags = useTags(workspaceId).data ?? [];
  const tagById = new Map(tags.map((t) => [t.id, t]));

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => ({ [DRAG_TYPE]: String(key), "text/plain": items.find((r) => r.id === key)?.title ?? String(key) })),
  });

  return (
    <GridList
      aria-label="녹음 목록"
      className={s.list}
      items={items}
      selectionMode="multiple"
      selectionBehavior="toggle"
      selectedKeys={selection}
      onSelectionChange={onSelectionChange}
      onAction={(key) => void navigate({ to: "/recordings/$recordingId", params: { recordingId: String(key) } })}
      dragAndDropHooks={dragAndDropHooks}
      renderEmptyState={() => empty}
    >
      {(rec) => {
        const status = STATUS[rec.status];
        const path = showFolder ? folderPath(folders, rec.folder_id) : null;
        return (
          <GridListItem id={rec.id} textValue={rec.title} className={s.row}>
            <CheckboxField slot="selection" />
            <span className={s.rowMain}>
              <span className={s.rowTitle}>{rec.title}</span>
              <span className={s.rowMeta}>
                {DOMAIN_LABEL[rec.domain]}
                {path && ` · ${path}`}
              </span>
            </span>
            <span className={s.rowTags}>
              {rec.tag_ids.slice(0, 3).map((id) => {
                const t = tagById.get(id);
                return t ? (
                  <Badge key={id} tone={TAG_TONE[t.color] ?? "neutral"} dot>
                    {t.name}
                  </Badge>
                ) : null;
              })}
            </span>
            <span className={s.rowStatus}>
              <Dot tone={status.tone} live={status.busy} />
              {status.label}
            </span>
            <span className={s.rowDuration}>{rec.duration_ms ? formatDuration(rec.duration_ms) : "—"}</span>
            <span className={s.rowDate} title={formatDateTime(rec.recorded_at, now)}>
              {formatDate(rec.recorded_at, now)}
            </span>
            <MenuTrigger>
              <Button size="sm" variant="ghost" icon="more" iconOnly aria-label={`${rec.title} 작업`} />
              <Popover className={uiStyles.popover} placement="bottom end">
                <Menu
                  className={uiStyles.menu}
                  onAction={(key) =>
                    key === "open"
                      ? void navigate({ to: "/recordings/$recordingId", params: { recordingId: rec.id } })
                      : onRowAction(key as "move" | "tag" | "delete", rec.id)
                  }
                >
                  <MenuItem id="open" className={uiStyles.menuItem}>
                    <Icon name="chevronRight" /> 열기
                  </MenuItem>
                  <MenuItem id="move" className={uiStyles.menuItem}>
                    <Icon name="folder" /> 폴더로 이동…
                  </MenuItem>
                  <MenuItem id="tag" className={uiStyles.menuItem}>
                    <Icon name="tag" /> 태그…
                  </MenuItem>
                  <MenuItem id="delete" className={uiStyles.menuItem} data-danger>
                    <Icon name="trash" /> 삭제…
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
          </GridListItem>
        );
      }}
    </GridList>
  );
}
