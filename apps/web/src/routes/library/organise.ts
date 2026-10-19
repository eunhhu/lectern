// Shared state and helpers for editing folders and tags in the library.

import type { Folder, Tag } from "../../api/types.ts";
import { ApiClientError } from "../../api/client.ts";
import { showToast } from "../../ui/toast.tsx";

export const DRAG_TYPE = "application/x-lectern-recording";
export const FOLDER_DRAG_TYPE = "application/x-lectern-folder";

/** Tag colours are design-token names (packages/domain Tag.color). */
export const TAG_COLORS: { id: string; label: string }[] = [
  { id: "red", label: "빨강" },
  { id: "orange", label: "주황" },
  { id: "yellow", label: "노랑" },
  { id: "green", label: "초록" },
  { id: "blue", label: "파랑" },
  { id: "indigo", label: "남색" },
  { id: "gray", label: "회색" },
];

export type Renaming = { kind: "folder" | "tag"; id: string } | null;

export type OrganiseDialog =
  | { kind: "folder-move"; folder: Folder }
  | { kind: "folder-delete"; folder: Folder }
  | { kind: "tag-delete"; tag: Tag }
  | null;

/** "새 폴더", then "새 폴더 2", "새 폴더 3", … */
export function uniqueName(base: string, taken: readonly string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The first colour no tag uses yet, cycling when all are taken. */
export function nextTagColor(tags: readonly Tag[]): string {
  const used = new Set(tags.map((t) => t.color));
  return (TAG_COLORS.find((c) => !used.has(c.id)) ?? TAG_COLORS[tags.length % TAG_COLORS.length]!).id;
}

export function toastError(title: string, err: unknown) {
  showToast({ title, description: err instanceof ApiClientError ? err.message : "잠시 후 다시 시도하세요.", tone: "danger" });
}
