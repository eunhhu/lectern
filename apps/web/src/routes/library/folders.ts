// Folder tree helpers and smart views (saved filters). Smart views live in the client
// until the domain has a saved-view resource (README "domain 요청").

import type { Folder, RecordingListItem } from "../../api/types.ts";

export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  depth: number;
}

export function folderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) byParent.set(f.parent_id, [...(byParent.get(f.parent_id) ?? []), f]);
  const build = (parent: string | null, depth: number): FolderNode[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0))
      .map((folder) => ({ folder, depth, children: build(folder.id, depth + 1) }));
  return build(null, 0);
}

/** "2026년 2학기 / 운영체제" */
export function folderPath(folders: Folder[], id: string | null): string | null {
  if (!id) return null;
  const parts: string[] = [];
  let cur = folders.find((f) => f.id === id);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? folders.find((f) => f.id === cur!.parent_id) : undefined;
  }
  return parts.join(" / ");
}

/** Options for folder pickers, in tree order with full paths. */
export function folderOptions(folders: Folder[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: FolderNode[]) =>
    nodes.forEach((n) => {
      out.push({ id: n.folder.id, label: folderPath(folders, n.folder.id)! });
      walk(n.children);
    });
  walk(folderTree(folders));
  return out;
}

/** Ids of a folder and all its descendants. */
export function folderAndDescendants(folders: Folder[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

export interface SmartView {
  id: string;
  name: string;
  description: string;
  matches: (rec: RecordingListItem, now: Date) => boolean;
}

const BUSY = new Set(["uploading", "queued", "processing"]);

export const SMART_VIEWS: SmartView[] = [
  {
    id: "recent",
    name: "최근 7일",
    description: "지난 7일 동안 녹음한 것",
    matches: (r, now) => now.getTime() - new Date(r.recorded_at).getTime() <= 7 * 86_400_000,
  },
  { id: "processing", name: "처리 중", description: "올리는 중이거나 처리 중인 녹음", matches: (r) => BUSY.has(r.status) },
  { id: "attention", name: "확인 필요", description: "일부만 처리됐거나 실패한 녹음", matches: (r) => r.status === "partial" || r.status === "failed" },
  { id: "lectures", name: "강의·세미나", description: "강의와 세미나", matches: (r) => r.domain === "lecture" || r.domain === "seminar" },
  {
    id: "meetings",
    name: "회의·대화",
    description: "회의, 인터뷰, 면담, 통화",
    matches: (r) => ["meeting", "interview", "one_on_one", "call"].includes(r.domain),
  },
];
