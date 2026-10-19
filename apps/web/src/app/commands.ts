// Commands shared by the command palette and the shortcut sheet, so every on-screen
// action can be found in ⌘K (DESIGN.md §1.2) and every shortcut is listed in one place.

import type { IconName } from "../ui/Icon.tsx";

export interface ShortcutInfo {
  keys: string[];
  label: string;
  group: "이동" | "명령" | "목록" | "폴더·태그" | "녹음 상세" | "복습";
}

export const SHORTCUTS: ShortcutInfo[] = [
  { keys: ["⌘K"], label: "명령 팔레트 열기 (Windows·Linux: Ctrl+K)", group: "명령" },
  { keys: ["U"], label: "녹음 올리기", group: "명령" },
  { keys: ["?"], label: "단축키 보기", group: "명령" },
  { keys: ["G", "H"], label: "홈으로 이동", group: "이동" },
  { keys: ["G", "L"], label: "라이브러리로 이동", group: "이동" },
  { keys: ["G", "R"], label: "복습으로 이동", group: "이동" },
  { keys: ["G", "C"], label: "일정으로 이동", group: "이동" },
  { keys: ["G", "S"], label: "설정으로 이동", group: "이동" },
  { keys: ["↑", "↓"], label: "항목 사이 이동", group: "목록" },
  { keys: ["Enter"], label: "열기", group: "목록" },
  { keys: ["Space"], label: "선택하거나 선택 해제", group: "목록" },
  { keys: ["⌘A"], label: "모두 선택", group: "목록" },
  { keys: ["Esc"], label: "선택 해제, 닫기", group: "목록" },
  { keys: ["F2"], label: "폴더 이름 바꾸기", group: "폴더·태그" },
  { keys: ["Delete"], label: "폴더 삭제", group: "폴더·태그" },
  { keys: ["⇧F10"], label: "폴더 메뉴 열기 (오른쪽 클릭과 같음)", group: "폴더·태그" },
  { keys: ["Space"], label: "재생, 일시정지 (본문에 포커스가 있을 때)", group: "녹음 상세" },
  { keys: ["←", "→"], label: "5초 뒤로, 앞으로", group: "녹음 상세" },
  { keys: ["⇧←", "⇧→"], label: "30초 뒤로, 앞으로", group: "녹음 상세" },
  { keys: ["[", "]"], label: "재생 속도 낮추기, 높이기", group: "녹음 상세" },
  { keys: ["Enter"], label: "전사 구간으로 이동", group: "녹음 상세" },
  { keys: ["Space"], label: "정답 보기", group: "복습" },
  { keys: ["1"], label: "다시 볼래요", group: "복습" },
  { keys: ["2"], label: "알았어요", group: "복습" },
  { keys: ["←", "→"], label: "이전 카드, 다음 카드", group: "복습" },
];

export const GO_KEYS: Record<string, "/" | "/library" | "/review" | "/calendar" | "/settings"> = {
  h: "/",
  l: "/library",
  r: "/review",
  c: "/calendar",
  s: "/settings",
};

/** Sidebar order is fixed (WCAG 3.2.3). */
export const NAV_ITEMS: { to: "/" | "/library" | "/review" | "/calendar" | "/settings"; label: string; icon: IconName; key: string }[] = [
  { to: "/", label: "홈", icon: "inbox", key: "H" },
  { to: "/library", label: "라이브러리", icon: "library", key: "L" },
  { to: "/review", label: "복습", icon: "review", key: "R" },
  { to: "/calendar", label: "일정", icon: "calendar", key: "C" },
  { to: "/settings", label: "설정", icon: "settings", key: "S" },
];

export interface PaletteCommand {
  id: string;
  label: string;
  icon: IconName;
  /** English aliases for search (DESIGN.md §3.7). */
  aliases: string[];
  keys?: string[];
  detail?: string;
}
