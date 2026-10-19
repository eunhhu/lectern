// Tags in the library sidebar, with editing: new tag, rename in place, colour, delete.
// Each tag is a link (filter) plus a … menu, which a right click also opens.

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button as AriaButton, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator } from "react-aria-components";
import { useTagActions, useTags } from "../../api/queries.ts";
import type { RecordingListItem, Tag } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { josa } from "../../lib/josa.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Button, uiStyles } from "../../ui/controls.tsx";
import { InlineName } from "../../ui/InlineName.tsx";
import { announce } from "../../ui/toast.tsx";
import { nextTagColor, TAG_COLORS, toastError, uniqueName, type OrganiseDialog, type Renaming } from "./organise.ts";
import s from "./library.module.css";

export function useTagEditing() {
  const { workspaceId } = useWorkspace();
  const tags = useTags(workspaceId).data ?? [];
  const actions = useTagActions(workspaceId);

  const create = async (name?: string): Promise<Tag | null> => {
    try {
      return await actions.create.mutateAsync({
        name: name ?? uniqueName("새 태그", tags.map((t) => t.name)),
        color: nextTagColor(tags),
      });
    } catch (err) {
      toastError("태그를 만들지 못했습니다.", err);
      return null;
    }
  };

  const rename = async (tag: Tag, name: string) => {
    try {
      await actions.update.mutateAsync({ id: tag.id, body: { name } });
      announce(`태그 이름을 ${josa(name, "으로/로") ?? `‘${name}’(으)로`} 바꿨습니다.`);
    } catch (err) {
      toastError("태그 이름을 바꾸지 못했습니다.", err);
    }
  };

  const recolor = async (tag: Tag, color: string) => {
    try {
      await actions.update.mutateAsync({ id: tag.id, body: { color } });
      announce(`‘${tag.name}’ 태그 색을 ${TAG_COLORS.find((c) => c.id === color)?.label ?? color}(으)로 바꿨습니다.`);
    } catch (err) {
      toastError("태그 색을 바꾸지 못했습니다.", err);
    }
  };

  return { tags, create, rename, recolor, remove: actions.remove };
}

/** The tag menu items, shared by the sidebar and the library header. */
export function TagMenuItems({ tag, onColor }: { tag: Tag; onColor: (color: string) => void }) {
  return (
    <>
      <MenuItem id="rename" className={uiStyles.menuItem} textValue="이름 바꾸기">
        <Icon name="pencil" /> 이름 바꾸기
      </MenuItem>
      <Separator className={uiStyles.menuSeparator} />
      <MenuSection
        selectionMode="single"
        selectedKeys={[`color:${tag.color}`]}
        onSelectionChange={(keys) => {
          const [key] = keys === "all" ? [] : [...keys];
          if (key !== undefined && key !== `color:${tag.color}`) onColor(String(key).slice("color:".length));
        }}
      >
        <Header className={uiStyles.menuHeader}>색</Header>
        {TAG_COLORS.map((c) => (
          <MenuItem key={c.id} id={`color:${c.id}`} className={uiStyles.menuItem} textValue={`색: ${c.label}`}>
            {({ isSelected }) => (
              <>
                <span className={s.tagDot} data-color={c.id} aria-hidden="true" />
                {c.label}
                {isSelected && (
                  <span className={uiStyles.optionCheck}>
                    <Icon name="check" size={14} />
                  </span>
                )}
              </>
            )}
          </MenuItem>
        ))}
      </MenuSection>
      <Separator className={uiStyles.menuSeparator} />
      <MenuItem id="delete" className={uiStyles.menuItem} data-danger textValue="삭제">
        <Icon name="trash" /> 삭제…
      </MenuItem>
    </>
  );
}

export function TagList({
  all,
  renaming,
  setRenaming,
  openDialog,
}: {
  all: RecordingListItem[];
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  openDialog: (d: OrganiseDialog) => void;
}) {
  const { tags, create, rename, recolor } = useTagEditing();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const onAction = (tag: Tag, key: string) => {
    if (key === "rename") setRenaming({ kind: "tag", id: tag.id });
    else if (key === "delete") openDialog({ kind: "tag-delete", tag });
  };

  return (
    <nav aria-labelledby="tags-heading" className={s.filterGroup}>
      <div className={s.filterHead}>
        <h2 className={s.filterHeading} id="tags-heading">
          태그
        </h2>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          iconOnly
          aria-label="새 태그"
          onPress={async () => {
            const tag = await create();
            if (tag) setRenaming({ kind: "tag", id: tag.id });
          }}
        />
      </div>
      <ul role="list" className={s.tagItems}>
        {tags.map((t) => (
          <li
            key={t.id}
            className={s.tagItem}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuFor(t.id);
            }}
          >
            {renaming?.kind === "tag" && renaming.id === t.id ? (
              <span className={s.filterLink}>
                <span className={s.tagDot} data-color={t.color} aria-hidden="true" />
                <InlineName
                  initial={t.name}
                  label="태그 이름"
                  onCommit={(name) => {
                    setRenaming(null);
                    void rename(t, name);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              </span>
            ) : (
              <>
                <Link to="/library" search={{ tag: t.id }} className={s.filterLink} activeOptions={{ includeSearch: true }}>
                  <span className={s.tagDot} data-color={t.color} aria-hidden="true" />
                  <span className={s.treeLabel}>{t.name}</span>
                  <span className={s.navCount}>{all.filter((r) => r.tag_ids.includes(t.id)).length}</span>
                </Link>
                <MenuTrigger isOpen={menuFor === t.id} onOpenChange={(open) => setMenuFor(open ? t.id : null)}>
                  <AriaButton className={s.rowMenu} aria-label={`${t.name} 태그 작업`}>
                    <Icon name="more" />
                  </AriaButton>
                  <Popover className={uiStyles.popover} placement="bottom end">
                    <Menu className={uiStyles.menu} onAction={(key) => onAction(t, String(key))}>
                      <TagMenuItems tag={t} onColor={(color) => void recolor(t, color)} />
                    </Menu>
                  </Popover>
                </MenuTrigger>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
