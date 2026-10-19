// Library (ARCHITECTURE §7): views, folders and tags on the left (all editable), the
// recording list on the right. Rows show only the title and one quiet line of metadata;
// status appears only when it needs attention, and row controls (checkbox, menu) appear on
// hover, focus or while selecting. The list header holds 전체 선택 and, once something is
// selected, the bulk actions. Dragging recordings onto a folder moves them; "폴더로
// 이동…" does the same without dragging (WCAG 2.5.7).

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GridList,
  GridListItem,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  SearchField,
  Separator,
  Toolbar,
  useDragAndDrop,
  type Selection,
} from "react-aria-components";
import { useFolders, useRecordings, useTags } from "../../api/queries.ts";
import type { Folder, RecordingListItem, Tag } from "../../api/types.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { DOMAIN_LABEL, STATUS } from "../../app/labels.ts";
import { openOverlay } from "../../app/overlays.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatCount, formatDate, formatDateTime, formatDuration } from "../../lib/format.ts";
import { matchScore } from "../../lib/hangul.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Button, CheckboxField, Dot, EmptyState, uiStyles } from "../../ui/controls.tsx";
import { announce } from "../../ui/toast.tsx";
import layout from "../../app/layout.module.css";
import { BulkDialogs, type BulkAction } from "./BulkDialogs.tsx";
import { FolderTree, useFolderEditing } from "./FolderTree.tsx";
import { folderAndDescendants, folderPath, SMART_VIEWS } from "./folders.ts";
import { OrganiseDialogs } from "./OrganiseDialogs.tsx";
import { DRAG_TYPE, type OrganiseDialog, type Renaming } from "./organise.ts";
import { TagList, TagMenuItems, useTagEditing } from "./TagList.tsx";
import s from "./library.module.css";

const VIEW_ICON: Record<string, IconName> = { recent: "clock", processing: "spark", attention: "alert", lectures: "book", meetings: "users" };

export function LibraryPage() {
  const search = useSearch({ from: "/_authed/library" });
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const recordings = useRecordings(workspaceId);
  const folders = useFolders(workspaceId).data ?? [];
  const tags = useTags(workspaceId).data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [dialog, setDialog] = useState<OrganiseDialog>(null);
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

  // The selection only ever covers rows that are shown.
  const visibleIds = new Set<string>(visible.map((r) => r.id));
  const selection = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = visible.length > 0 && selection.length === visible.length;

  const setSelection = (keys: Selection) => {
    const next = keys === "all" ? new Set(visible.map((r) => r.id)) : new Set([...keys].map(String));
    setSelected(next);
    announce(next.size ? `${formatCount(next.size)}개 선택됨` : "선택을 해제했습니다.");
  };

  const filtered = Boolean(view || tag || search.folder || query.trim());
  const clearFilters = () => {
    setQuery("");
    void navigate({ to: "/library", search: {} });
  };
  const subtitle =
    folder && folderPath(folders, folder.id) !== folder.name ? folderPath(folders, folder.id) : view ? view.description : null;

  return (
    <div className={s.layout}>
      <section className={s.filters} aria-label="라이브러리 필터">
        <nav aria-labelledby="views-heading" className={s.filterGroup}>
          <h2 className={s.filterHeading} id="views-heading">
            보기
          </h2>
          <Link to="/library" search={{}} className={s.filterLink} activeOptions={{ includeSearch: true, exact: true }}>
            <Icon name="library" />
            <span className={s.treeLabel}>모든 녹음</span>
            <span className={s.navCount}>{all.length}</span>
          </Link>
          {SMART_VIEWS.map((v) => (
            <Link key={v.id} to="/library" search={{ view: v.id }} className={s.filterLink} activeOptions={{ includeSearch: true }}>
              <Icon name={VIEW_ICON[v.id] ?? "target"} />
              <span className={s.treeLabel}>{v.name}</span>
              <span className={s.navCount}>{all.filter((r) => v.matches(r, now)).length}</span>
            </Link>
          ))}
        </nav>
        <FolderTree
          all={all}
          selectedFolder={view || tag ? null : (search.folder ?? null)}
          renaming={renaming}
          setRenaming={setRenaming}
          openDialog={setDialog}
        />
        <TagList all={all} renaming={renaming} setRenaming={setRenaming} openDialog={setDialog} />
      </section>

      <section className={s.listPane} aria-labelledby="library-title">
        <header className={layout.pageHeader}>
          <div className={s.titleBlock}>
            <div className={s.titleRow}>
              <h1 id="library-title" className={layout.pageTitle}>
                {title}
              </h1>
              {folder && <FolderHeaderMenu folder={folder} setRenaming={setRenaming} openDialog={setDialog} />}
              {tag && <TagHeaderMenu tag={tag} setRenaming={setRenaming} openDialog={setDialog} />}
            </div>
            {subtitle && <p className={s.count}>{subtitle}</p>}
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

        <div className={s.listBar} data-selecting={selection.length > 0 || undefined}>
          <span className={s.selectAll}>
            <CheckboxField
              aria-label="모두 선택"
              isSelected={allSelected}
              isIndeterminate={selection.length > 0 && !allSelected}
              isDisabled={visible.length === 0}
              onChange={(on) => setSelection(on ? "all" : new Set())}
            />
          </span>
          {selection.length > 0 ? (
            <Toolbar className={s.bulkActions} aria-label="선택한 녹음 작업">
              <span className={s.bulkCount}>{formatCount(selection.length)}개 선택됨</span>
              <Button size="sm" variant="ghost" icon="folder" onPress={() => setAction({ kind: "move", ids: selection })}>
                폴더로 이동…
              </Button>
              <Button size="sm" variant="ghost" icon="tag" onPress={() => setAction({ kind: "tag", ids: selection })}>
                태그…
              </Button>
              <Button size="sm" variant="ghost" icon="trash" onPress={() => setAction({ kind: "delete", ids: selection })}>
                삭제…
              </Button>
              <Button size="sm" variant="ghost" onPress={() => setSelection(new Set())}>
                선택 해제
              </Button>
            </Toolbar>
          ) : (
            <span className={s.listCount}>{visible.length ? `녹음 ${formatCount(visible.length)}개` : "녹음 없음"}</span>
          )}
        </div>

        <RecordingList
          items={visible}
          selection={selection}
          onSelectionChange={setSelection}
          onRowAction={(kind, id) => setAction({ kind, ids: [id] })}
          showFolder={!folder}
          folders={folders}
          tags={tags}
          now={now}
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
        />
      </section>
      <BulkDialogs action={action} onClose={() => setAction(null)} onFailed={(ids) => setSelected(new Set(ids))} />
      <OrganiseDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function FolderHeaderMenu({ folder, setRenaming, openDialog }: { folder: Folder; setRenaming: (r: Renaming) => void; openDialog: (d: OrganiseDialog) => void }) {
  const { create } = useFolderEditing();
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="more" iconOnly aria-label={`${folder.name} 폴더 작업`} />
      <Popover className={uiStyles.popover} placement="bottom start">
        <Menu
          className={uiStyles.menu}
          onAction={async (key) => {
            if (key === "rename") setRenaming({ kind: "folder", id: folder.id });
            else if (key === "child") {
              const child = await create(folder.id);
              if (child) setRenaming({ kind: "folder", id: child.id });
            } else if (key === "move") openDialog({ kind: "folder-move", folder });
            else if (key === "delete") openDialog({ kind: "folder-delete", folder });
          }}
        >
          <MenuItem id="rename" className={uiStyles.menuItem} textValue="이름 바꾸기">
            <Icon name="pencil" /> 이름 바꾸기
          </MenuItem>
          <MenuItem id="child" className={uiStyles.menuItem} textValue="새 하위 폴더">
            <Icon name="plus" /> 새 하위 폴더
          </MenuItem>
          <MenuItem id="move" className={uiStyles.menuItem} textValue="다른 폴더로 옮기기">
            <Icon name="move" /> 다른 폴더로 옮기기…
          </MenuItem>
          <Separator className={uiStyles.menuSeparator} />
          <MenuItem id="delete" className={uiStyles.menuItem} data-danger textValue="삭제">
            <Icon name="trash" /> 삭제…
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function TagHeaderMenu({ tag, setRenaming, openDialog }: { tag: Tag; setRenaming: (r: Renaming) => void; openDialog: (d: OrganiseDialog) => void }) {
  const { recolor } = useTagEditing();
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="more" iconOnly aria-label={`${tag.name} 태그 작업`} />
      <Popover className={uiStyles.popover} placement="bottom start">
        <Menu
          className={uiStyles.menu}
          onAction={(key) => {
            if (key === "rename") setRenaming({ kind: "tag", id: tag.id });
            else if (key === "delete") openDialog({ kind: "tag-delete", tag });
          }}
        >
          <TagMenuItems tag={tag} onColor={(color) => void recolor(tag, color)} />
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function RecordingList({
  items,
  selection,
  onSelectionChange,
  onRowAction,
  showFolder,
  folders,
  tags,
  empty,
  now,
}: {
  items: RecordingListItem[];
  selection: string[];
  onSelectionChange: (keys: Selection) => void;
  onRowAction: (kind: "move" | "tag" | "delete", id: string) => void;
  showFolder: boolean;
  folders: Folder[];
  tags: Tag[];
  empty: ReactNode;
  now: Date;
}) {
  const navigate = useNavigate();
  const tagById = new Map(tags.map((t) => [t.id, t]));

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => ({ [DRAG_TYPE]: String(key), "text/plain": items.find((r) => r.id === key)?.title ?? String(key) })),
  });

  return (
    <GridList
      aria-label="녹음 목록"
      className={s.list}
      data-selecting={selection.length > 0 || undefined}
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
        const recTags = rec.tag_ids.map((id) => tagById.get(id)).filter((t): t is Tag => Boolean(t));
        const meta = [DOMAIN_LABEL[rec.domain], formatDate(rec.recorded_at, now), rec.duration_ms ? formatDuration(rec.duration_ms) : null, path]
          .filter(Boolean)
          .join(" · ");
        return (
          <GridListItem id={rec.id} textValue={rec.title} className={s.row}>
            <span className={s.rowCheck}>
              <CheckboxField slot="selection" />
            </span>
            <span className={s.rowMain}>
              <span className={s.rowTitle}>{rec.title}</span>
              <span className={s.rowMeta} title={formatDateTime(rec.recorded_at, now)}>
                {meta}
              </span>
            </span>
            {recTags.length > 0 && (
              <span className={s.rowTags}>
                {recTags.slice(0, 2).map((t) => (
                  <span key={t.id} className={s.rowTag}>
                    <span className={s.tagDot} data-color={t.color} aria-hidden="true" />
                    {t.name}
                  </span>
                ))}
                {recTags.length > 2 && <span className={s.rowTagMore}>+{recTags.length - 2}</span>}
              </span>
            )}
            {rec.status !== "ready" && (
              <span className={s.rowStatus}>
                <Dot tone={status.tone} live={status.busy} />
                {status.label}
              </span>
            )}
            <MenuTrigger>
              <Button size="sm" variant="ghost" icon="more" iconOnly aria-label={`${rec.title} 작업`} className={s.rowMenuButton} />
              <Popover className={uiStyles.popover} placement="bottom end">
                <Menu
                  className={uiStyles.menu}
                  onAction={(key) =>
                    key === "open"
                      ? void navigate({ to: "/recordings/$recordingId", params: { recordingId: rec.id } })
                      : onRowAction(key as "move" | "tag" | "delete", rec.id)
                  }
                >
                  <MenuItem id="open" className={uiStyles.menuItem} textValue="열기">
                    <Icon name="chevronRight" /> 열기
                  </MenuItem>
                  <MenuItem id="move" className={uiStyles.menuItem} textValue="폴더로 이동">
                    <Icon name="folder" /> 폴더로 이동…
                  </MenuItem>
                  <MenuItem id="tag" className={uiStyles.menuItem} textValue="태그">
                    <Icon name="tag" /> 태그…
                  </MenuItem>
                  <Separator className={uiStyles.menuSeparator} />
                  <MenuItem id="delete" className={uiStyles.menuItem} data-danger textValue="삭제">
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
