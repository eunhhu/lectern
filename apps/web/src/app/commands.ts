// Commands shared by the command palette and the shortcut sheet, so every on-screen
// action can be found in ⌘K (DESIGN.md §1.2) and every shortcut is listed in one place.

import type { IconName } from "../ui/Icon.tsx";

export interface ShortcutInfo {
  keys: string[];
  label: string;
  group: "이동" | "명령" | "목록" | "폴더·태그" | "녹음 상세" | "물어보기" | "관리";
  /** Shown to service operators only. */
  operator?: boolean;
}

export const SHORTCUTS: ShortcutInfo[] = [
  { keys: ["⌘K"], label: "명령 팔레트 열기 (Windows·Linux: Ctrl+K)", group: "명령" },
  { keys: ["U"], label: "녹음 올리기", group: "명령" },
  { keys: ["?"], label: "단축키 보기", group: "명령" },
  { keys: ["G", "H"], label: "홈으로 이동", group: "이동" },
  { keys: ["G", "L"], label: "라이브러리로 이동", group: "이동" },
  { keys: ["G", "A"], label: "물어보기로 이동", group: "이동" },
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
  { keys: ["Enter"], label: "전사 문단의 시각에서 그 시점으로 이동", group: "녹음 상세" },
  { keys: ["Enter"], label: "질문 보내기", group: "물어보기" },
  { keys: ["⇧Enter"], label: "줄 바꿈", group: "물어보기" },
  { keys: ["⌘K"], label: "팔레트에 질문을 쓰고 ‘물어보기’ 고르기", group: "물어보기" },
  { keys: ["G", "O"], label: "관리 개요로 이동", group: "관리", operator: true },
  { keys: ["G", "M"], label: "관리 사용자로 이동", group: "관리", operator: true },
  { keys: ["G", "J"], label: "관리 작업으로 이동", group: "관리", operator: true },
  { keys: ["G", ","], label: "관리 설정으로 이동", group: "관리", operator: true },
  { keys: ["C"], label: "새 사용자 (관리 › 사용자에서)", group: "관리", operator: true },
  { keys: ["⌘Enter"], label: "관리 설정 저장 (관리 › 설정에서)", group: "관리", operator: true },
];

/**
 * The old admin console's "G then a letter" moves that do not collide with the app's
 * (P5-13). Its G L, G S and G A would take the app's 라이브러리, 설정 and 물어보기.
 */
export const ADMIN_GO_KEYS: Record<string, "/admin" | "/admin/users" | "/admin/jobs" | "/admin/settings"> = {
  o: "/admin",
  m: "/admin/users",
  j: "/admin/jobs",
  ",": "/admin/settings",
};

export const GO_KEYS: Record<string, "/" | "/library" | "/ask" | "/calendar" | "/settings"> = {
  h: "/",
  l: "/library",
  a: "/ask",
  c: "/calendar",
  s: "/settings",
};

/** Sidebar order is fixed (WCAG 3.2.3). */
export const NAV_ITEMS: { to: "/" | "/library" | "/ask" | "/calendar" | "/settings"; label: string; icon: IconName; key: string }[] = [
  { to: "/", label: "홈", icon: "inbox", key: "H" },
  { to: "/library", label: "라이브러리", icon: "library", key: "L" },
  { to: "/ask", label: "물어보기", icon: "spark", key: "A" },
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
