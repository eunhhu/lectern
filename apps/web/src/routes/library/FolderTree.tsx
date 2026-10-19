// The folder tree with editing (ARCHITECTURE §7 라이브러리): new folder, rename in place,
// move under another folder, delete. Every action is in the row menu (the … button, a
// right click, Shift+F10 or the context-menu key), F2 renames and Delete asks to delete.
// Recordings and folders can be dragged onto a folder; "다른 폴더로 옮기기…" and
// "폴더로 이동…" do the same without dragging (WCAG 2.5.7).

import { useNavigate } from "@tanstack/react-router";
import { useState, type KeyboardEvent } from "react";
import {
  Button as AriaButton,
  isTextDropItem,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop,
  type Key,
} from "react-aria-components";
import { useFolderActions, useFolders } from "../../api/queries.ts";
import { asId, type Folder, type FolderId, type RecordingListItem } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { josa } from "../../lib/josa.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, uiStyles } from "../../ui/controls.tsx";
import { InlineName } from "../../ui/InlineName.tsx";
import { announce, showToast } from "../../ui/toast.tsx";
import { useBulkMove } from "./BulkDialogs.tsx";
import { folderAndDescendants, folderTree, type FolderNode } from "./folders.ts";
import { DRAG_TYPE, FOLDER_DRAG_TYPE, toastError, uniqueName, type OrganiseDialog, type Renaming } from "./organise.ts";
import s from "./library.module.css";

export function useFolderEditing() {
  const { workspaceId } = useWorkspace();
  const folders = useFolders(workspaceId).data ?? [];
  const actions = useFolderActions(workspaceId);

  const create = async (parentId: FolderId | null): Promise<Folder | null> => {
    const siblings = folders.filter((f) => f.parent_id === parentId).map((f) => f.name);
    try {
      return await actions.create.mutateAsync({ name: uniqueName("새 폴더", siblings), parent_id: parentId });
    } catch (err) {
      toastError("폴더를 만들지 못했습니다.", err);
      return null;
    }
  };

  const rename = async (folder: Folder, name: string) => {
    try {
      await actions.update.mutateAsync({ id: folder.id, body: { name } });
      announce(`폴더 이름을 ${josa(name, "으로/로") ?? `‘${name}’(으)로`} 바꿨습니다.`);
    } catch (err) {
      toastError("폴더 이름을 바꾸지 못했습니다.", err);
    }
  };

  const move = async (folder: Folder, parentId: FolderId | null, { undo = true } = {}) => {
    if (folder.parent_id === parentId) return;
    const before = folder.parent_id;
    try {
      await actions.update.mutateAsync({ id: folder.id, body: { parent_id: parentId } });
      const target = parentId ? folders.find((f) => f.id === parentId)?.name : null;
      showToast({
        title: target ? `‘${folder.name}’ 폴더를 ‘${target}’ 안으로 옮겼습니다.` : `‘${folder.name}’ 폴더를 맨 위로 옮겼습니다.`,
        action: undo ? { label: "실행 취소", onAction: () => void move({ ...folder, parent_id: parentId }, before, { undo: false }) } : undefined,
      });
    } catch (err) {
      toastError("폴더를 옮기지 못했습니다.", err);
    }
  };

  return { folders, create, rename, move, remove: actions.remove };
}

export function FolderTree({
  all,
  selectedFolder,
  renaming,
  setRenaming,
  openDialog,
}: {
  all: RecordingListItem[];
  selectedFolder: string | null;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  openDialog: (d: OrganiseDialog) => void;
}) {
  const navigate = useNavigate();
  const { folders, create, rename, move } = useFolderEditing();
  const moveRecordings = useBulkMove();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<Key> | null>(null);
  const parents = folders.filter((f) => folders.some((c) => c.parent_id === f.id)).map((f) => f.id);
  const expandedKeys = expanded ?? new Set<Key>(parents);
  const tree = folderTree(folders);
  const byId = new Map<string, Folder>(folders.map((f) => [f.id, f]));

  const countIn = (id: string) => {
    const ids = folderAndDescendants(folders, id);
    return all.filter((r) => r.folder_id !== null && ids.has(r.folder_id)).length;
  };
  const unfiled = all.filter((r) => r.folder_id === null).length;

  const newFolder = async (parentId: FolderId | null) => {
    const folder = await create(parentId);
    if (!folder) return;
    if (parentId) setExpanded(new Set([...expandedKeys, parentId]));
    setRenaming({ kind: "folder", id: folder.id });
  };

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys]
        .filter((key) => byId.has(String(key)))
        .map((key) => ({ [FOLDER_DRAG_TYPE]: String(key), "text/plain": byId.get(String(key))!.name })),
    acceptedDragTypes: [DRAG_TYPE, FOLDER_DRAG_TYPE],
    getDropOperation: (target) => (target.type === "item" && target.dropPosition === "on" ? "move" : "cancel"),
    onItemDrop: async (e) => {
      const target = String(e.target.key);
      const parentId = target === "none" ? null : asId<FolderId>(target);
      const items = e.items.filter(isTextDropItem);
      const recordings = await Promise.all(items.filter((i) => i.types.has(DRAG_TYPE)).map((i) => i.getText(DRAG_TYPE)));
      const moved = await Promise.all(items.filter((i) => i.types.has(FOLDER_DRAG_TYPE)).map((i) => i.getText(FOLDER_DRAG_TYPE)));
      if (recordings.length) await moveRecordings(recordings, parentId);
      for (const id of moved) {
        const folder = byId.get(id);
        if (folder && id !== target) await move(folder, parentId);
      }
    },
  });

  // F2 renames, Delete asks to delete, Shift+F10 / the context-menu key opens the row menu.
  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming) return;
    const key = (e.target as HTMLElement).closest<HTMLElement>('[role="row"][data-key]')?.dataset.key;
    if (!key || !byId.has(key)) return;
    if (e.key === "F2") {
      e.preventDefault();
      setRenaming({ kind: "folder", id: key });
    } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) {
      e.preventDefault();
      openDialog({ kind: "folder-delete", folder: byId.get(key)! });
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      setMenuFor(key);
    }
  };

  const renderNode = (node: FolderNode) => {
    const f = node.folder;
    const isRenaming = renaming?.kind === "folder" && renaming.id === f.id;
    return (
      <TreeItem
        key={f.id}
        id={f.id}
        textValue={f.name}
        className={s.treeItem}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuFor(f.id);
        }}
      >
        <TreeItemContent>
          {({ hasChildItems, isExpanded }) => (
            <span className={s.treeRow} data-depth={node.depth}>
              {hasChildItems ? (
                <AriaButton slot="chevron" className={s.chevron} aria-label={isExpanded ? "접기" : "펼치기"}>
                  <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={14} />
                </AriaButton>
              ) : (
                <span className={s.chevronSpacer} />
              )}
              <Icon name={isExpanded && hasChildItems ? "folderOpen" : "folder"} />
              {isRenaming ? (
                <InlineName
                  initial={f.name}
                  label="폴더 이름"
                  onCommit={(name) => {
                    setRenaming(null);
                    void rename(f, name);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <>
                  <span className={s.treeLabel}>{f.name}</span>
                  <span className={s.navCount}>{countIn(f.id)}</span>
                  <MenuTrigger isOpen={menuFor === f.id} onOpenChange={(open) => setMenuFor(open ? f.id : null)}>
                    <AriaButton className={s.rowMenu} aria-label={`${f.name} 폴더 작업`}>
                      <Icon name="more" />
                    </AriaButton>
                    <Popover className={uiStyles.popover} placement="bottom end">
                      <Menu
                        className={uiStyles.menu}
                        onAction={(key) => {
                          if (key === "rename") setRenaming({ kind: "folder", id: f.id });
                          else if (key === "child") void newFolder(f.id);
                          else if (key === "move") openDialog({ kind: "folder-move", folder: f });
                          else if (key === "delete") openDialog({ kind: "folder-delete", folder: f });
                        }}
                      >
                        <MenuItem id="rename" className={uiStyles.menuItem} textValue="이름 바꾸기">
                          <Icon name="pencil" /> 이름 바꾸기 <kbd className={s.menuKey}>F2</kbd>
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
                </>
              )}
            </span>
          )}
        </TreeItemContent>
        {node.children.map(renderNode)}
      </TreeItem>
    );
  };

  return (
    <div className={s.filterGroup}>
      <div className={s.filterHead}>
        <h2 className={s.filterHeading} id="folders-heading">
          폴더
        </h2>
        <Button size="sm" variant="ghost" icon="plus" iconOnly aria-label="새 폴더" onPress={() => void newFolder(null)} />
      </div>
      {/* Keyboard shortcuts for the focused row; React Aria handles arrows and selection. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onKeyDown={onKeyDown}>
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
                <span className={s.rowMenuSpacer} aria-hidden="true" />
              </span>
            </TreeItemContent>
          </TreeItem>
        </Tree>
      </div>
    </div>
  );
}
