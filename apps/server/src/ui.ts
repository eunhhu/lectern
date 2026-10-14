import { escapeHtml, renderMarkdownToHtml } from "../../../packages/core/src/index.ts";
import type { LectureRecord } from "./db.ts";

const ELYSIUM_TOKENS_CSS = `
    :root {
      /* Elysium Design System v1.0 — Light Mode (CoolNeutral + Elysium Blue) */
      --surface-canvas: #F9FAFB;
      --surface-elevated: #FFFFFF;
      --surface-subtle: #F2F4F6;
      --surface-interactive: #E5E8EB;
      --surface-overlay: rgba(255, 255, 255, 0.82);
      --surface-code: #F2F4F6;

      --text-primary: #191F28;
      --text-secondary: #4E5968;
      --text-tertiary: #8B95A1;
      --text-disabled: #B0B8C1;
      --text-on-color: #FFFFFF;

      --action-primary: #3182F6;
      --action-primary-hover: #1B64DA;
      --action-primary-pressed: #1952B8;
      --action-primary-subtle: #E8F3FF;

      --border-subtle: #F2F4F6;
      --border-default: #E5E8EB;
      --border-strong: #D1D6DB;
      --border-focus: #3182F6;

      --status-success-fg: #00B578;
      --status-success-bg: #E8FAF0;
      --status-warning-fg: #D97706;
      --status-warning-bg: #FFF6E5;
      --status-danger-fg: #F04452;
      --status-danger-bg: #FFECEB;
      --status-info-fg: #3182F6;
      --status-info-bg: #E8F3FF;

      --shadow-xs: 0 1px 2px rgba(25, 31, 40, 0.04);
      --shadow-sm: 0 2px 8px rgba(25, 31, 40, 0.06), 0 1px 2px rgba(25, 31, 40, 0.04);
      --shadow-md: 0 8px 24px rgba(25, 31, 40, 0.08), 0 2px 6px rgba(25, 31, 40, 0.04);
      --shadow-lg: 0 20px 48px rgba(25, 31, 40, 0.14), 0 4px 12px rgba(25, 31, 40, 0.06);

      /* Typography */
      --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
      --font-mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;

      /* Spatial System (4px Base Grid) */
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
      --space-8: 32px;
      --space-10: 40px;
      --space-12: 48px;
      --space-16: 64px;

      /* Shape & Radius */
      --radius-xs: 6px;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 20px;
      --radius-full: 9999px;

      /* Motion */
      --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
      --ease-standard: cubic-bezier(0.2, 0, 0, 1);
      --duration-fast: 140ms;
      --duration-normal: 220ms;
      --duration-slow: 360ms;
    }

    [data-theme="dark"] {
      /* Elysium Design System v1.0 — Dark Mode (CoolNeutral 950..800 + Elysium Blue 450) */
      --surface-canvas: #0B0D11;
      --surface-elevated: #14171D;
      --surface-subtle: #1C2028;
      --surface-interactive: #262B35;
      --surface-overlay: rgba(20, 23, 29, 0.80);
      --surface-code: #0E1117;

      --text-primary: #F2F4F6;
      --text-secondary: #9EA6B2;
      --text-tertiary: #6B7684;
      --text-disabled: #4E5968;
      --text-on-color: #FFFFFF;

      --action-primary: #4593FC;
      --action-primary-hover: #64A8FF;
      --action-primary-pressed: #3182F6;
      --action-primary-subtle: rgba(69, 147, 252, 0.14);

      --border-subtle: rgba(255, 255, 255, 0.06);
      --border-default: rgba(255, 255, 255, 0.10);
      --border-strong: rgba(255, 255, 255, 0.18);
      --border-focus: #4593FC;

      --status-success-fg: #15C47E;
      --status-success-bg: rgba(21, 196, 126, 0.14);
      --status-warning-fg: #FFB020;
      --status-warning-bg: rgba(255, 176, 32, 0.14);
      --status-danger-fg: #F55864;
      --status-danger-bg: rgba(245, 88, 100, 0.14);
      --status-info-fg: #4593FC;
      --status-info-bg: rgba(69, 147, 252, 0.14);

      --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.28);
      --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.06);
      --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255, 255, 255, 0.08);
      --shadow-lg: 0 20px 48px rgba(0, 0, 0, 0.64), 0 0 0 1px rgba(255, 255, 255, 0.10);
    }

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    :focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }
`;

export function renderSharePageHtml(lecture: LectureRecord): string {
  const rendered = renderMarkdownToHtml(lecture.markdown || "");
  const title = escapeHtml(lecture.title);
  const course = escapeHtml(lecture.course);
  const excerpt = escapeHtml(lecture.excerpt);
  const hasAudio = Boolean(lecture.audio_path);

  return `<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Lectern</title>
  <meta property="og:title" content="${title} (${course})" />
  <meta property="og:description" content="${excerpt}" />
  <meta property="og:type" content="article" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    ${ELYSIUM_TOKENS_CSS}
    body {
      margin: 0;
      background: var(--surface-canvas);
      color: var(--text-primary);
      font-family: var(--font-sans);
      line-height: 1.68;
      -webkit-font-smoothing: antialiased;
    }
    .share-topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) var(--space-6);
      background: var(--surface-overlay);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid var(--border-default);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      text-decoration: none;
      color: var(--text-primary);
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.02em;
    }
    .brand-mark {
      width: 10px;
      height: 10px;
      border-radius: var(--radius-full);
      background: var(--action-primary);
    }
    .actions { display: flex; gap: var(--space-2); align-items: center; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 600;
      border: 1px solid var(--border-default);
      background: var(--surface-elevated);
      color: var(--text-primary);
      cursor: pointer;
      text-decoration: none;
      transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-out-expo);
    }
    .btn:hover { background: var(--surface-subtle); border-color: var(--border-strong); }
    .btn:active { transform: scale(0.98); }
    .btn-primary {
      background: var(--action-primary);
      border-color: var(--action-primary);
      color: var(--text-on-color);
    }
    .btn-primary:hover {
      background: var(--action-primary-hover);
      border-color: var(--action-primary-hover);
    }
    .container {
      max-width: 820px;
      margin: 0 auto;
      padding: var(--space-10) var(--space-6) var(--space-16);
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
      margin-bottom: var(--space-6);
    }
    .badge {
      padding: 4px 10px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 600;
      background: var(--status-info-bg);
      color: var(--status-info-fg);
      font-variant-numeric: tabular-nums;
    }
    .badge-muted {
      background: var(--surface-subtle);
      color: var(--text-secondary);
      border: 1px solid var(--border-default);
    }
    .audio-bar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--surface-elevated);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-8);
      box-shadow: var(--shadow-xs);
    }
    .audio-bar audio { flex: 1; height: 36px; }
    .md-body h1, .md-body h2, .md-body h3 {
      word-break: keep-all;
      overflow-wrap: break-word;
      color: var(--text-primary);
    }
    .md-body h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.022em;
      line-height: 1.3;
      margin: 0 0 var(--space-5);
      padding-bottom: var(--space-4);
      border-bottom: 1px solid var(--border-default);
    }
    .md-body h2 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.018em;
      line-height: 1.38;
      margin: var(--space-8) 0 var(--space-3);
    }
    .md-body h3 {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.014em;
      line-height: 1.42;
      margin: var(--space-6) 0 var(--space-2);
    }
    .md-body p, .md-body li {
      font-size: 15px;
      line-height: 1.65;
      letter-spacing: -0.008em;
      color: var(--text-secondary);
    }
    .md-body ul, .md-body ol { padding-left: 22px; margin: var(--space-3) 0; }
    .md-body li { margin: 6px 0; }
    .md-body strong { color: var(--text-primary); font-weight: 600; }
    .md-body code {
      font-family: var(--font-mono);
      font-size: 13.5px;
      padding: 2px 6px;
      border-radius: var(--radius-xs);
      background: var(--surface-subtle);
      color: var(--action-primary);
    }
    .md-code {
      padding: var(--space-4);
      border-radius: var(--radius-md);
      background: var(--surface-code);
      border: 1px solid var(--border-default);
      overflow-x: auto;
    }
    .md-code code { background: none; padding: 0; color: var(--text-primary); }
    .md-quote {
      margin: var(--space-4) 0;
      padding: var(--space-3) var(--space-4);
      border-left: 3px solid var(--action-primary);
      background: var(--action-primary-subtle);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      word-break: keep-all;
    }
    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin: 0 2px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-default);
      background: var(--status-info-bg);
      color: var(--status-info-fg);
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition: background var(--duration-fast) var(--ease-standard);
    }
    .ts-chip:hover { background: var(--surface-interactive); }
    .filter-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .filter-break { background: var(--status-warning-bg); color: var(--status-warning-fg); }
    .filter-cut { background: var(--status-success-bg); color: var(--status-success-fg); }
    @media print {
      body { background: #fff !important; color: #191F28 !important; }
      .share-topbar, .audio-bar { display: none !important; }
      .container { max-width: 100%; padding: 0; }
      .md-body h1, .md-body h2, .md-body h3, .md-body strong { color: #191F28 !important; }
      .md-body p, .md-body li { color: #4E5968 !important; }
    }
  </style>
</head>
<body>
  <header class="share-topbar">
    <a class="brand" href="/">
      <span class="brand-mark"></span>
      <span>Lectern</span>
    </a>
    <div class="actions">
      <button class="btn" onclick="toggleTheme()" id="theme-btn" aria-label="테마 전환">테마 전환</button>
      <a class="btn" href="/api/lectures/${encodeURIComponent(lecture.id)}/markdown?share=${encodeURIComponent(lecture.share_token)}" download>Markdown</a>
      <button class="btn btn-primary" onclick="window.print()">PDF 인쇄</button>
    </div>
  </header>
  <main class="container">
    <div class="meta-bar">
      <span class="badge">${course}</span>
      <span class="badge badge-muted">${escapeHtml(lecture.date_label)}</span>
      <span class="badge badge-muted">${escapeHtml(lecture.model_used)}</span>
    </div>
    ${
      hasAudio
        ? `<div class="audio-bar">
            <audio id="share-audio" controls preload="metadata" src="/api/lectures/${encodeURIComponent(
              lecture.id
            )}/audio?share=${encodeURIComponent(lecture.share_token)}"></audio>
          </div>`
        : ""
    }
    <article class="md-body" id="md-root">
      ${rendered.html}
    </article>
  </main>
  <script>
    const savedTheme = localStorage.getItem('lectern_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      localStorage.setItem('lectern_theme', cur);
    }
    document.getElementById('md-root')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.ts-chip');
      if (!btn) return;
      const sec = Number(btn.dataset.sec || 0);
      const audio = document.getElementById('share-audio');
      if (audio) {
        audio.currentTime = sec;
        audio.play().catch(() => {});
      }
    });
  </script>
</body>
</html>`;
}

export function renderAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="theme-color" content="#0B0D11" />
  <title>Lectern — Academic Audio Distillation & Markdown Reader</title>
  <link rel="manifest" href="/manifest.json" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    ${ELYSIUM_TOKENS_CSS}

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--surface-canvas);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 15px;
      line-height: 1.55;
      letter-spacing: -0.01em;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }

    /* App Shell (280px Sidebar + Fluid Reader Canvas) */
    .app-shell {
      display: grid;
      grid-template-columns: 320px 1fr;
      height: 100vh;
      width: 100vw;
      background: var(--surface-canvas);
    }

    /* Sidebar */
    .sidebar {
      display: flex;
      flex-direction: column;
      background: var(--surface-elevated);
      border-right: 1px solid var(--border-default);
      height: 100vh;
      overflow: hidden;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 60px;
      padding: 0 var(--space-4);
      border-bottom: 1px solid var(--border-subtle);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }
    .brand-mark {
      width: 10px;
      height: 10px;
      border-radius: var(--radius-full);
      background: var(--action-primary);
    }
    .brand-sub {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-tertiary);
      font-variant-numeric: tabular-nums;
    }

    /* Buttons (Elysium Component Spec: sm 32px, md 40px, radius-sm 8px / radius-md 12px) */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-default);
      background: var(--surface-elevated);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background var(--duration-fast) var(--ease-standard),
                  border-color var(--duration-fast) var(--ease-standard),
                  transform var(--duration-fast) var(--ease-out-expo);
      white-space: nowrap;
      text-decoration: none;
    }
    .btn:hover {
      background: var(--surface-subtle);
      border-color: var(--border-strong);
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-primary {
      background: var(--action-primary);
      border-color: var(--action-primary);
      color: var(--text-on-color);
    }
    .btn-primary:hover {
      background: var(--action-primary-hover);
      border-color: var(--action-primary-hover);
    }
    .btn-primary:active {
      background: var(--action-primary-pressed);
    }
    .btn-danger {
      background: var(--status-danger-bg);
      border-color: transparent;
      color: var(--status-danger-fg);
    }
    .btn-icon {
      width: 36px;
      padding: 0;
    }
    .icon-svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
      flex-shrink: 0;
    }

    /* Search & Filter */
    .search-box {
      padding: var(--space-3) var(--space-4) var(--space-2);
    }
    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-default);
      background: var(--surface-subtle);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13.5px;
      outline: none;
      transition: border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
    }
    .search-input::placeholder { color: var(--text-tertiary); }
    .search-input:focus {
      background: var(--surface-elevated);
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--action-primary-subtle);
    }

    .course-pills {
      display: flex;
      gap: 6px;
      padding: var(--space-1) var(--space-4) var(--space-3);
      overflow-x: auto;
      scrollbar-width: none;
      border-bottom: 1px solid var(--border-subtle);
    }
    .course-pills::-webkit-scrollbar { display: none; }
    .pill {
      padding: 5px 11px;
      border-radius: var(--radius-full);
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 600;
      background: var(--surface-subtle);
      color: var(--text-secondary);
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--duration-fast) var(--ease-standard);
    }
    .pill:hover { background: var(--surface-interactive); color: var(--text-primary); }
    .pill.active {
      background: var(--action-primary-subtle);
      color: var(--action-primary);
      border-color: transparent;
    }

    /* Lecture Cards List */
    .lecture-list {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-3);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .lecture-card {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
    }
    .lecture-card:hover {
      background: var(--surface-subtle);
    }
    .lecture-card.active {
      background: var(--action-primary-subtle);
      border-color: var(--border-focus);
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      margin-bottom: 6px;
    }
    .card-course {
      font-size: 11.5px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: var(--status-info-bg);
      color: var(--status-info-fg);
    }
    .card-date {
      font-size: 12px;
      color: var(--text-tertiary);
      font-variant-numeric: tabular-nums;
    }
    .card-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary);
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: -0.01em;
    }
    .card-excerpt {
      font-size: 12.5px;
      color: var(--text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.45;
    }
    .card-progress {
      margin-top: var(--space-2);
      height: 4px;
      background: var(--surface-interactive);
      border-radius: var(--radius-full);
      overflow: hidden;
    }
    .card-progress-bar {
      height: 100%;
      background: var(--action-primary);
      transition: width var(--duration-normal) var(--ease-out-expo);
    }

    .sidebar-footer {
      padding: var(--space-3) var(--space-4);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      gap: var(--space-2);
    }
    .sidebar-footer .btn { flex: 1; font-size: 12.5px; }

    /* Main Reader Pane */
    .main-pane {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--surface-canvas);
    }

    .reader-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      height: 60px;
      padding: 0 var(--space-6);
      border-bottom: 1px solid var(--border-default);
      background: var(--surface-overlay);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
    }
    .toolbar-meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      overflow: hidden;
    }
    .meta-pill {
      padding: 4px 10px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 600;
      background: var(--surface-subtle);
      color: var(--text-secondary);
      border: 1px solid var(--border-default);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .meta-pill.course {
      background: var(--status-info-bg);
      color: var(--status-info-fg);
      border-color: transparent;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    /* Audio Player Bar */
    .audio-bar {
      display: none;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-6);
      background: var(--surface-elevated);
      border-bottom: 1px solid var(--border-default);
    }
    .audio-bar.visible { display: flex; }
    .audio-bar audio { flex: 1; height: 34px; }
    .speed-select {
      height: 32px;
      padding: 0 10px;
      border-radius: var(--radius-xs);
      background: var(--surface-subtle);
      color: var(--text-primary);
      border: 1px solid var(--border-default);
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    /* Reader Scroll Area */
    .reader-scroll {
      flex: 1;
      overflow-y: auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: var(--space-10);
      padding: var(--space-8) var(--space-10) var(--space-16);
      max-width: 1180px;
      width: 100%;
      margin: 0 auto;
    }

    /* Markdown Article Typography (Elysium Type Scale & Korean Keep-All) */
    .md-article {
      min-width: 0;
      line-height: 1.7;
      color: var(--text-secondary);
    }
    .md-article h1, .md-article h2, .md-article h3, .md-article h4 {
      color: var(--text-primary);
      word-break: keep-all;
      overflow-wrap: break-word;
    }
    .md-article h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.022em;
      line-height: 1.3;
      margin: 0 0 var(--space-5);
      padding-bottom: var(--space-4);
      border-bottom: 1px solid var(--border-default);
    }
    .md-article h2 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.018em;
      line-height: 1.38;
      margin: var(--space-8) 0 var(--space-3);
      scroll-margin-top: 20px;
    }
    .md-article h3 {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.014em;
      line-height: 1.42;
      margin: var(--space-6) 0 var(--space-2);
      scroll-margin-top: 20px;
    }
    .md-article h4 {
      font-size: 15px;
      font-weight: 600;
      margin: var(--space-4) 0 var(--space-2);
    }
    .md-article p, .md-article li {
      font-size: 15px;
      line-height: 1.68;
      letter-spacing: -0.008em;
      color: var(--text-secondary);
    }
    .md-article ul, .md-article ol {
      padding-left: 22px;
      margin: var(--space-2) 0 var(--space-4);
    }
    .md-article li { margin: 6px 0; }
    .md-article strong { color: var(--text-primary); font-weight: 600; }
    .md-article code {
      font-family: var(--font-mono);
      font-size: 13px;
      padding: 2px 6px;
      border-radius: var(--radius-xs);
      background: var(--surface-subtle);
      color: var(--action-primary);
    }
    .md-code {
      padding: var(--space-4) var(--space-5);
      border-radius: var(--radius-md);
      background: var(--surface-code);
      border: 1px solid var(--border-default);
      overflow-x: auto;
      margin: var(--space-4) 0;
    }
    .md-code code { background: none; padding: 0; color: var(--text-primary); }
    .md-quote {
      margin: var(--space-4) 0;
      padding: var(--space-3) var(--space-4);
      border-left: 3px solid var(--action-primary);
      background: var(--action-primary-subtle);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      word-break: keep-all;
    }
    .md-quote p { margin: 4px 0; color: var(--text-primary); }
    .md-hr {
      border: 0;
      border-top: 1px solid var(--border-default);
      margin: var(--space-8) 0;
    }
    .md-table-wrap { overflow-x: auto; margin: var(--space-4) 0; }
    .md-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13.5px;
      font-variant-numeric: tabular-nums;
    }
    .md-table th, .md-table td {
      border-bottom: 1px solid var(--border-default);
      padding: 10px 12px;
      text-align: left;
    }
    .md-table th {
      background: var(--surface-subtle);
      color: var(--text-primary);
      font-weight: 600;
    }

    /* Interactive Timestamp & Filter Badges */
    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      margin: 0 2px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-default);
      background: var(--status-info-bg);
      color: var(--status-info-fg);
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      vertical-align: baseline;
      transition: background var(--duration-fast) var(--ease-standard);
    }
    .ts-chip:hover { background: var(--surface-interactive); }

    .filter-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .filter-break { background: var(--status-warning-bg); color: var(--status-warning-fg); }
    .filter-cut { background: var(--status-success-bg); color: var(--status-success-fg); }

    /* Right TOC Rail */
    .toc-rail {
      position: sticky;
      top: 0;
      align-self: start;
      border-left: 1px solid var(--border-default);
      padding-left: var(--space-4);
      max-height: calc(100vh - 140px);
      overflow-y: auto;
    }
    .toc-title {
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-tertiary);
      margin-bottom: var(--space-3);
    }
    .toc-link {
      display: block;
      font-size: 12.5px;
      color: var(--text-tertiary);
      text-decoration: none;
      padding: 5px 0;
      line-height: 1.4;
      transition: color var(--duration-fast) var(--ease-standard);
    }
    .toc-link:hover { color: var(--text-primary); }
    .toc-link.lvl-3 { padding-left: var(--space-3); font-size: 12px; }

    /* Markdown Editor View */
    .editor-pane {
      display: none;
      flex-direction: column;
      gap: var(--space-3);
    }
    .editor-pane.visible { display: flex; }
    .editor-textarea {
      width: 100%;
      min-height: 62vh;
      padding: var(--space-4);
      border-radius: var(--radius-md);
      border: 1px solid var(--border-default);
      background: var(--surface-elevated);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 13.5px;
      line-height: 1.65;
      resize: vertical;
      outline: none;
    }
    .editor-textarea:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--action-primary-subtle);
    }

    /* Modals / Dialogs (Elysium radius-xl 20px + shadow-lg) */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(11, 13, 17, 0.56);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--space-4);
    }
    .modal-backdrop.open { display: flex; }
    .modal-card {
      width: 100%;
      max-width: 540px;
      background: var(--surface-elevated);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      padding: var(--space-6);
      box-shadow: var(--shadow-lg);
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-4);
    }
    .modal-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.018em;
      color: var(--text-primary);
    }

    /* Recorder Visualizer */
    .rec-visualizer-wrap {
      position: relative;
      height: 88px;
      border-radius: var(--radius-md);
      background: var(--surface-subtle);
      border: 1px solid var(--border-default);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--space-4);
    }
    .rec-canvas { width: 100%; height: 100%; display: block; }
    .rec-timer {
      position: absolute;
      right: 12px;
      top: 10px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 13px;
      font-weight: 700;
      color: var(--status-danger-fg);
      background: var(--status-danger-bg);
      padding: 2px 8px;
      border-radius: var(--radius-xs);
    }
    .field-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .field-input {
      width: 100%;
      height: 42px;
      padding: 0 14px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border-default);
      background: var(--surface-subtle);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 14px;
      margin-bottom: var(--space-3);
      outline: none;
      transition: border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
    }
    .field-input:focus {
      background: var(--surface-elevated);
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--action-primary-subtle);
    }

    .dropzone {
      border: 1.5px dashed var(--border-strong);
      border-radius: var(--radius-md);
      padding: var(--space-5);
      text-align: center;
      color: var(--text-secondary);
      background: var(--surface-subtle);
      cursor: pointer;
      transition: all var(--duration-fast) var(--ease-standard);
      margin-top: var(--space-2);
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--action-primary);
      background: var(--action-primary-subtle);
      color: var(--text-primary);
    }

    /* Native Clients Grid */
    .client-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
      margin-top: var(--space-3);
    }
    .client-box {
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--surface-subtle);
      border: 1px solid var(--border-default);
    }
    .client-box h4 {
      margin: 0 0 6px;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
      word-break: keep-all;
    }
    .client-box p {
      margin: 0 0 12px;
      font-size: 12.5px;
      color: var(--text-secondary);
      line-height: 1.5;
      word-break: keep-all;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: var(--space-6);
      right: var(--space-6);
      z-index: 100;
      padding: 10px 16px;
      border-radius: var(--radius-md);
      background: var(--surface-elevated);
      border: 1px solid var(--border-strong);
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 600;
      box-shadow: var(--shadow-md);
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
      transition: all var(--duration-normal) var(--ease-out-expo);
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    /* Mobile Bottom Tab Bar (56px + safe-area) */
    .mobile-tabbar {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: calc(56px + env(safe-area-inset-bottom));
      background: var(--surface-overlay);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-top: 1px solid var(--border-default);
      z-index: 45;
      justify-content: space-around;
      align-items: center;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-tertiary);
      font-family: var(--font-sans);
      font-size: 11px;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      min-width: 64px;
      padding: 6px 0;
    }
    .tab-btn.active { color: var(--action-primary); }

    @media (max-width: 960px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed;
        inset: 0 0 56px 0;
        z-index: 35;
        display: none;
      }
      .sidebar.mobile-open { display: flex; }
      .reader-scroll {
        grid-template-columns: 1fr;
        padding: var(--space-5) var(--space-4) 96px;
      }
      .toc-rail { display: none; }
      .mobile-tabbar { display: flex; }
      .client-grid { grid-template-columns: 1fr; }
    }

    /* Auth Gate (Elysium Full-Viewport Account Isolation) */
    .auth-gate {
      position: fixed;
      inset: 0;
      z-index: 90;
      background: var(--surface-canvas);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-4);
    }
    .auth-gate.hidden { display: none; }
    .auth-card {
      width: 100%;
      max-width: 400px;
      background: var(--surface-elevated);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      padding: var(--space-8) var(--space-6);
      box-shadow: var(--shadow-lg);
    }
    .auth-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 4px;
      background: var(--surface-subtle);
      border-radius: var(--radius-sm);
      margin-bottom: var(--space-5);
    }
    .auth-tab {
      height: 34px;
      border: none;
      border-radius: var(--radius-xs);
      background: transparent;
      color: var(--text-secondary);
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .auth-tab.active {
      background: var(--surface-elevated);
      color: var(--text-primary);
      box-shadow: var(--shadow-xs);
    }
    .user-bar {
      padding: var(--space-2) var(--space-4);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--surface-subtle);
    }

    @media print {
      html, body { height: auto; overflow: visible; background: #fff !important; color: #191F28 !important; }
      .sidebar, .reader-toolbar, .audio-bar, .toc-rail, .mobile-tabbar, .modal-backdrop { display: none !important; }
      .app-shell, .main-pane, .reader-scroll { display: block; height: auto; overflow: visible; padding: 0; margin: 0; }
      .md-article h1, .md-article h2, .md-article h3, .md-article strong { color: #191F28 !important; }
      .md-article p, .md-article li { color: #4E5968 !important; }
    }
  </style>
</head>
<body>
  <!-- Elysium Account Authentication Gate -->
  <div class="auth-gate" id="auth-gate">
    <div class="auth-card">
      <div class="brand" style="margin-bottom:6px;font-size:19px;">
        <span class="brand-mark"></span>
        <span>Lectern</span>
      </div>
      <p style="margin:0 0 20px;color:var(--text-secondary);font-size:13.5px;word-break:keep-all;">
        개인 강의 녹음과 마크다운 노트는 계정별로 철저히 분리·보호됩니다.
      </p>

      <div class="auth-tabs">
        <button type="button" class="auth-tab active" id="tab-login-btn" onclick="switchAuthMode('login')">로그인</button>
        <button type="button" class="auth-tab" id="tab-reg-btn" onclick="switchAuthMode('register')">새 계정 만들기</button>
      </div>

      <form id="auth-form" onsubmit="submitAuthForm(event)">
        <div id="auth-name-wrap" style="display:none;">
          <label class="field-label">이름 (닉네임)</label>
          <input type="text" id="auth-name" class="field-input" placeholder="예: 문선우" autocomplete="name" />
        </div>
        <label class="field-label">아이디 또는 이메일</label>
        <input type="text" id="auth-email" class="field-input" placeholder="sunwoo 또는 이메일 주소" autocomplete="username" required />
        <label class="field-label">비밀번호</label>
        <input type="password" id="auth-password" class="field-input" placeholder="비밀번호 입력" autocomplete="current-password" required />
        <div id="auth-error" style="display:none;margin-bottom:12px;font-size:12.5px;font-weight:600;color:var(--status-danger-fg);"></div>
        <button type="submit" class="btn btn-primary" id="auth-submit-btn" style="width:100%;height:42px;font-size:14px;">내 워크스페이스 열기</button>
      </form>
    </div>
  </div>

  <div class="app-shell">
    <!-- Left Sidebar -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="brand">
          <span class="brand-mark"></span>
          <span>Lectern</span>
          <span class="brand-sub">v1.0</span>
        </div>
        <button class="btn btn-primary" onclick="openRecorderModal()">
          <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          <span>새 강의 녹음</span>
        </button>
      </div>

      <div class="search-box">
        <input type="search" id="search-input" class="search-input" placeholder="강의 제목, 과목, 핵심 이론 검색 (⌘K)" />
      </div>

      <div class="course-pills" id="course-pills"></div>

      <div class="lecture-list" id="lecture-list"></div>

      <div class="user-bar">
        <span id="user-badge" style="font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">로그인됨</span>
        <div style="display:flex;gap:4px;">
          <button class="btn" style="height:26px;padding:0 8px;font-size:11.5px;" onclick="openCleanupModal()">기록 정리</button>
          <button class="btn" style="height:26px;padding:0 8px;font-size:11.5px;" onclick="logoutAccount()">로그아웃</button>
        </div>
      </div>
      <div class="sidebar-footer">
        <button class="btn" onclick="openClientsModal()">네이티브 앱·단축어</button>
        <button class="btn" onclick="openSettingsModal()">모델·API 설정</button>
      </div>
    </aside>

    <!-- Main Reader Area -->
    <main class="main-pane">
      <header class="reader-toolbar">
        <div class="toolbar-meta" id="toolbar-meta">
          <span class="meta-pill course" id="cur-course">강의 선택</span>
          <span class="meta-pill" id="cur-date">—</span>
          <span class="meta-pill" id="cur-model">gemini-flash-latest</span>
          <span class="meta-pill" id="sse-status-pill" style="font-size:11px;color:var(--status-success-fg);background:var(--status-success-bg);">실시간 동기화</span>
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-icon" onclick="toggleTheme()" title="라이트/다크 테마 전환" aria-label="테마 전환">
            <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          </button>
          <button class="btn" id="btn-visibility" onclick="toggleCurrentVisibility()" title="공유 링크 공개/비공개 전환">비공개</button>
          <button class="btn" id="btn-edit" onclick="toggleEditor()">편집</button>
          <button class="btn" id="btn-md" onclick="downloadCurrentMarkdown()">MD</button>
          <button class="btn" id="btn-pdf" onclick="window.print()">PDF</button>
          <button class="btn" id="btn-cleanup" onclick="openCleanupModal()" title="기록 정리 및 오디오 용량 관리">정리</button>
          <button class="btn" id="btn-delete" style="color:var(--status-danger-fg);" onclick="deleteCurrentLecture()" title="현재 강의 노트 삭제">삭제</button>
          <button class="btn btn-primary" id="btn-share" onclick="shareCurrentLecture()">공유 링크</button>
        </div>
      </header>

      <div class="audio-bar" id="audio-bar">
        <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">원본 오디오</span>
        <audio id="lecture-audio" controls preload="metadata"></audio>
        <select class="speed-select" id="audio-speed" onchange="changeAudioSpeed(this.value)">
          <option value="1">1.0x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="1.75">1.75x</option>
          <option value="2">2.0x</option>
        </select>
      </div>

      <div class="reader-scroll" id="reader-scroll">
        <div>
          <article class="md-article" id="md-article">
            <p style="color:var(--text-tertiary);">왼쪽 목록에서 강의 노트를 선택하거나 새 강의를 녹음/업로드하세요.</p>
          </article>
          <div class="editor-pane" id="editor-pane">
            <input type="text" id="edit-title" class="field-input" placeholder="강의 제목" />
            <input type="text" id="edit-course" class="field-input" placeholder="과목명" />
            <textarea id="edit-markdown" class="editor-textarea"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button class="btn" onclick="toggleEditor(false)">취소</button>
              <button class="btn btn-primary" onclick="saveMarkdownEdit()">변경사항 저장</button>
            </div>
          </div>
        </div>
        <nav class="toc-rail" id="toc-rail">
          <div class="toc-title">On this page</div>
          <div id="toc-list"></div>
        </nav>
      </div>
    </main>
  </div>

  <!-- Mobile Bottom Tab Bar -->
  <nav class="mobile-tabbar">
    <button class="tab-btn" id="tab-list" onclick="switchMobileTab('list')">
      <svg class="icon-svg" viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
      <span>강의 목록</span>
    </button>
    <button class="tab-btn active" id="tab-reader" onclick="switchMobileTab('reader')">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      <span>노트 리더</span>
    </button>
    <button class="tab-btn" onclick="openRecorderModal()">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
      <span>녹음·업로드</span>
    </button>
    <button class="tab-btn" onclick="openClientsModal()">
      <svg class="icon-svg" viewBox="0 0 24 24"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
      <span>기기 연동</span>
    </button>
  </nav>

  <!-- Recorder & Upload Modal -->
  <div class="modal-backdrop" id="recorder-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">실시간 강의 녹음 및 오디오 증류</div>
        <button class="btn btn-icon" onclick="closeModal('recorder-modal')" aria-label="닫기">✕</button>
      </div>

      <label class="field-label">과목명 (Course)</label>
      <input type="text" id="rec-course" class="field-input" placeholder="예: 정보보호개론, 자바프로그래밍, 영어읽기와토론" value="정보보호개론" />
      <div id="quick-course-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;"></div>

      <div class="rec-visualizer-wrap">
        <canvas id="rec-canvas" class="rec-canvas" width="480" height="88"></canvas>
        <div class="rec-timer" id="rec-timer">00:00</div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button class="btn btn-primary" id="btn-rec-start" style="flex:1;height:42px;" onclick="toggleMicRecording()">마이크 녹음 시작</button>
        <button class="btn" id="btn-rec-pause" style="display:none;height:42px;" onclick="pauseResumeRecording()">일시정지</button>
      </div>

      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-secondary);margin-bottom:14px;cursor:pointer;">
        <input type="checkbox" id="chk-local-save" checked onchange="localStorage.setItem('lectern_autosave_local', this.checked ? '1' : '0')" />
        <span>녹음 종료 시 내 기기에 원본 오디오 파일 즉시 로컬 백업 + 브라우저 금고(IndexedDB) 이중 보호</span>
      </label>

      <div id="local-vault-box" style="display:none;padding:12px;border-radius:var(--radius-md);background:var(--surface-subtle);border:1px solid var(--status-warning-fg);margin-bottom:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:12.5px;font-weight:700;color:var(--status-warning-fg);" id="local-vault-title">미전송 로컬 녹음 보관함 (네트워크 장애 보호됨)</span>
          <button class="btn" style="height:26px;padding:0 8px;font-size:11.5px;" onclick="retryAllPendingLocalUploads()">전체 재업로드</button>
        </div>
        <div id="local-vault-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>

      <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">오디오 파일 드래그 앤 드롭 또는 클릭하여 선택</div>
        <div style="font-size:12px;color:var(--text-tertiary);">지원 포맷: .m4a (음성메모), .mp3, .webm, .wav, .ogg (최대 200MB)</div>
        <input type="file" id="file-input" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" style="display:none" onchange="handleFileSelect(this.files)" />
      </div>

      <div id="ingest-status" style="margin-top:12px;font-size:13px;font-weight:600;color:var(--action-primary);display:none;"></div>
    </div>
  </div>

  <!-- Native Clients & Shortcuts Modal -->
  <div class="modal-backdrop" id="clients-modal">
    <div class="modal-card" style="max-width:640px;">
      <div class="modal-header">
        <div class="modal-title">멀티플랫폼 네이티브 앱 & 퀵액션 연동</div>
        <button class="btn btn-icon" onclick="closeModal('clients-modal')" aria-label="닫기">✕</button>
      </div>
      <p style="margin:0 0 12px;color:var(--text-secondary);font-size:13.5px;">
        어느 기기에서 녹음하든 쉬는시간·방치녹음이 자동 제거된 뒤 이 리더 화면에 즉시 동기화됩니다.
      </p>
      <div class="client-grid">
        <div class="client-box">
          <h4>macOS 상단 메뉴바 앱 (SwiftUI/AppKit)</h4>
          <p><code>NSStatusItem</code> 상단바 상주 · <code>⌥Space</code> 글로벌 핫키 무오버헤드 HE-AAC 녹음 및 네이티브 마크다운 리더 팝오버.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/Lectern-macOS-arm64.zip" target="_blank">Lectern.app 다운로드</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/macos" target="_blank">소스</a>
          </div>
        </div>
        <div class="client-box">
          <h4>iOS 단축어 / 뒷면 탭 / 액션 버튼</h4>
          <p>음성 메모 공유 시트 또는 액션 버튼으로 <code>POST /api/ingest/shortcut</code> 즉시 전송 후 노트 자동 오픈.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="/api/clients/ios-shortcut" download="lectern-ios-shortcut.json">단축어 레시피</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/ios" target="_blank">SwiftUI 소스</a>
          </div>
        </div>
        <div class="client-box">
          <h4>Android Jetpack Compose + 퀵세팅 타일</h4>
          <p>네이티브 Compose 마크다운 리더·녹음기 + 상단 퀵세팅 패널 타일(<code>LecternTileService</code>) 원탭 녹음.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/Lectern-android-universal.apk" target="_blank">APK 다운로드</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/android" target="_blank">소스</a>
          </div>
        </div>
        <div class="client-box">
          <h4>Windows 시스템 트레이 & 네이티브 리더 (.NET 8)</h4>
          <p>시스템 트레이 상주 + 글로벌 핫키(<code>Alt+Shift+R</code>) 즉시 녹음 & 네이티브 마크다운 리더.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/LecternTray-win-x64.exe" target="_blank">Windows EXE 다운로드</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/windows" target="_blank">소스</a>
          </div>
        </div>
      </div>
      <div style="margin-top:14px;padding:14px;border-radius:var(--radius-md);background:var(--surface-code);border:1px solid var(--border-default);font-size:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-weight:600;color:var(--text-primary);">내 계정 전용 API 토큰 (네이티브 앱 / iOS 단축어 연동용)</span>
          <button class="btn" style="height:26px;padding:0 10px;font-size:11.5px;" onclick="copyApiToken()">토큰 복사</button>
        </div>
        <code id="my-api-token-code" style="display:block;margin-bottom:10px;padding:6px 8px;background:var(--surface-subtle);border-radius:var(--radius-xs);font-family:var(--font-mono);color:var(--action-primary);">lct_...</code>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">원클릭 HTTP Ingest API (cURL / 단축어 / 서드파티 연동)</div>
        <code id="my-curl-snippet" style="display:block;white-space:pre-wrap;font-family:var(--font-mono);color:var(--text-secondary);">curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\
  -H "X-Lectern-Token: <내_API_토큰>" \\
  -H "X-Course: 정보보호개론" \\
  -F "audio=@20261014_lecture.m4a"</code>
      </div>
    </div>
  </div>

  <!-- Settings (BYOK) Modal -->
  <div class="modal-backdrop" id="settings-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Gemini API & 요약 모델 설정</div>
        <button class="btn btn-icon" onclick="closeModal('settings-modal')" aria-label="닫기">✕</button>
      </div>
      <label class="field-label">요약 모델 (기본: gemini-flash-latest → 최신 Flash 자동 매핑)</label>
      <input type="text" id="cfg-model" class="field-input" value="gemini-flash-latest" />
      <label class="field-label">개인 Gemini API Key (선택 · 비워두면 서버 기본 키 사용)</label>
      <input type="password" id="cfg-apikey" class="field-input" placeholder="AIzaSy... (브라우저 로컬 스토리지에만 저장됨)" />
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-primary" onclick="saveSettings()">설정 저장</button>
      </div>
    </div>
  </div>

  <!-- Cleanup, Visibility & Record Management Modal -->
  <div class="modal-backdrop" id="cleanup-modal">
    <div class="modal-card" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title">기록 정리 · 삭제 · 공개 설정</div>
        <button class="btn btn-icon" onclick="closeModal('cleanup-modal')" aria-label="닫기">✕</button>
      </div>

      <div id="cleanup-current-box" style="padding:14px;border-radius:var(--radius-md);background:var(--surface-subtle);border:1px solid var(--border-default);margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px;" id="cleanup-cur-title">현재 선택된 강의 노트</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn" id="cleanup-vis-btn" onclick="toggleCurrentVisibility()">공개/비공개 전환</button>
          <button class="btn" onclick="rotateCurrentShareToken()">공유 링크 재발급 (기존 링크 차단)</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">
          <input type="text" id="cleanup-move-course" class="field-input" style="margin-bottom:0;flex:1;height:34px;" placeholder="변경할 과목명 입력" />
          <button class="btn" onclick="moveCurrentLectureCourse()">과목 이동</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" id="cleanup-audio-btn" onclick="deleteCurrentAudioOnly()">원본 오디오만 삭제 (노트 보존)</button>
          <button class="btn" style="color:var(--status-danger-fg);border-color:var(--status-danger-fg);" onclick="deleteCurrentLecture()">이 강의 노트 영구 삭제</button>
        </div>
      </div>

      <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">워크스페이스 일괄 기록 정리</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-sm);background:var(--surface-subtle);border:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">실패·중단된 분석 기록 정리</div>
            <div style="font-size:11.5px;color:var(--text-secondary);">오류 상태이거나 15분 이상 멈춘 미완료 기록과 임시 파일을 삭제합니다.</div>
          </div>
          <button class="btn" onclick="runWorkspaceCleanup('failed')">일괄 정리</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-sm);background:var(--surface-subtle);border:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">짧은 테스트·단편 녹음(15초 미만) 정리</div>
            <div style="font-size:11.5px;color:var(--text-secondary);">실수로 눌렸거나 테스트로 녹음된 짧은 단편 노트를 일괄 삭제합니다.</div>
          </div>
          <button class="btn" onclick="runWorkspaceCleanup('short_fragments')">단편 삭제</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-sm);background:var(--surface-subtle);border:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">완료된 모든 노트의 원본 음성파일 비우기</div>
            <div style="font-size:11.5px;color:var(--text-secondary);">마크다운 강의 노트는 영구 보존하고 대용량 원본 오디오만 정리합니다.</div>
          </div>
          <button class="btn" onclick="runWorkspaceCleanup('audio_only_all')">오디오 비우기</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let lectures = [];
    let currentLecture = null;
    let activeCourse = 'ALL';
    let searchQuery = '';
    let currentUser = null;
    let authMode = 'login';
    let sseSource = null;

    // Centralized Reactive State Helpers (SSE + Polling Unified)
    function upsertLectureSummaryInState(summary) {
      if (!summary || !summary.id) return;
      const idx = lectures.findIndex(item => item.id === summary.id);
      if (idx >= 0) {
        lectures[idx] = Object.assign({}, lectures[idx], summary);
      } else {
        if (activeCourse === 'ALL' || summary.course === activeCourse) {
          lectures.unshift(summary);
        }
      }
      renderLectureList();
    }

    function removeLectureIdsFromState(ids) {
      if (!Array.isArray(ids) || !ids.length) return;
      const rmSet = new Set(ids);
      lectures = lectures.filter(item => !rmSet.has(item.id));
      renderLectureList();
      if (currentLecture && rmSet.has(currentLecture.id)) {
        currentLecture = null;
        if (lectures.length > 0) {
          selectLecture(lectures[0].id, false);
        } else {
          document.getElementById('md-article').innerHTML =
            '<p style="color:var(--text-tertiary);">왼쪽 목록에서 강의 노트를 선택하거나 새 강의를 녹음/업로드하세요.</p>';
          document.getElementById('toc-list').innerHTML = '';
          document.getElementById('audio-bar').classList.remove('visible');
        }
      }
    }

    function connectRealtimeSSE() {
      if (sseSource) {
        try { sseSource.close(); } catch {}
        sseSource = null;
      }
      const tok = localStorage.getItem('lectern_token') || '';
      const url = '/api/events' + (tok ? '?token=' + encodeURIComponent(tok) : '');
      const es = new EventSource(url);
      sseSource = es;

      const badge = document.getElementById('sse-status-pill');
      es.addEventListener('connected', () => {
        if (badge) {
          badge.textContent = '실시간 동기화';
          badge.style.color = 'var(--status-success-fg)';
        }
      });

      es.addEventListener('lecture_update', async (ev) => {
        try {
          const payload = JSON.parse(ev.data || '{}');
          if (payload.type === 'created' && payload.lecture) {
            upsertLectureSummaryInState(payload.lecture);
            if (!currentLecture) {
              await selectLecture(payload.lecture.id, false);
            }
          } else if (payload.type === 'progress') {
            if (payload.lecture) {
              upsertLectureSummaryInState(payload.lecture);
            }
            if (currentLecture && currentLecture.id === payload.id) {
              currentLecture.status = 'processing';
              currentLecture.stage_message = payload.stage_message || '분석 중...';
              currentLecture.progress = payload.progress || 50;
              renderProcessingArticle(currentLecture);
            }
          } else if (payload.type === 'completed') {
            if (payload.lecture) {
              upsertLectureSummaryInState(payload.lecture);
            } else {
              await fetchLectures();
            }
            showToast('강의 오디오 증류가 완료되었습니다.');
            if (!currentLecture || currentLecture.id === payload.id) {
              await selectLecture(payload.id, false);
            }
          } else if (payload.type === 'error') {
            if (payload.lecture) {
              upsertLectureSummaryInState(payload.lecture);
            }
            if (currentLecture && currentLecture.id === payload.id) {
              await selectLecture(payload.id, false);
            }
          } else if (payload.type === 'updated' && payload.lecture) {
            upsertLectureSummaryInState(payload.lecture);
            if (currentLecture && currentLecture.id === payload.id) {
              await selectLecture(payload.id, false);
            }
          } else if (payload.type === 'deleted') {
            const ids = payload.ids || (payload.id ? [payload.id] : []);
            removeLectureIdsFromState(ids);
          }
        } catch (err) {
          console.error('SSE lecture_update parse error:', err);
        }
      });

      es.onerror = () => {
        if (badge) {
          badge.textContent = '재연결 중...';
        }
      };
    }

    function renderProcessingArticle(lec) {
      const art = document.getElementById('md-article');
      if (!art) return;
      const pct = Math.max(8, Math.min(99, Number(lec.progress || 20)));
      art.innerHTML =
        '<div style="padding:48px 24px;text-align:center;max-width:520px;margin:0 auto;">' +
          '<div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">' +
            escapeClientHtml(lec.stage_message || '강의 오디오 증류 중...') +
          ' (' + pct + '%)</div>' +
          '<div class="card-progress" style="height:8px;margin-bottom:14px;"><div class="card-progress-bar" style="width:' + pct + '%"></div></div>' +
          '<div style="color:var(--text-secondary);font-size:13.5px;word-break:keep-all;">쉬는 시간과 불필요한 잡담을 걸러내고 핵심 이론을 구조화하고 있습니다. 완료되면 새로고침 없이 즉시 노트가 열립니다.</div>' +
        '</div>';
    }

    // Theme setup (Elysium Light/Dark)
    const savedTheme = localStorage.getItem('lectern_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    function toggleTheme() {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('lectern_theme', next);
    }

    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const tok = localStorage.getItem('lectern_token');
      if (tok) h['X-Lectern-Token'] = tok;
      return h;
    }

    function switchAuthMode(mode) {
      authMode = mode;
      document.getElementById('tab-login-btn').classList.toggle('active', mode === 'login');
      document.getElementById('tab-reg-btn').classList.toggle('active', mode === 'register');
      document.getElementById('auth-name-wrap').style.display = mode === 'register' ? 'block' : 'none';
      document.getElementById('auth-submit-btn').textContent = mode === 'register' ? '새 계정 생성 및 시작' : '내 워크스페이스 열기';
      document.getElementById('auth-error').style.display = 'none';
    }

    async function submitAuthForm(ev) {
      ev.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const displayName = document.getElementById('auth-name').value.trim();
      const errEl = document.getElementById('auth-error');
      errEl.style.display = 'none';

      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || '인증에 실패했습니다.';
        errEl.style.display = 'block';
        return;
      }
      if (data.token) {
        localStorage.setItem('lectern_token', data.token);
      }
      applyAuthenticatedUser(data.user);
      await fetchLectures();
    }

    function applyAuthenticatedUser(user) {
      currentUser = user;
      document.getElementById('auth-gate').classList.add('hidden');
      document.getElementById('user-badge').textContent = user.displayName + ' (' + user.email + ')';
      const tokEl = document.getElementById('my-api-token-code');
      if (tokEl && user.apiToken) tokEl.textContent = user.apiToken;
      const curlEl = document.getElementById('my-curl-snippet');
      if (curlEl && user.apiToken) {
        curlEl.textContent = 'curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\\n  -H "X-Lectern-Token: ' + user.apiToken + '" \\\n  -H "X-Course: 정보보호개론" \\\n  -F "audio=@20261014_lecture.m4a"';
      }
      connectRealtimeSSE();
    }

    async function copyApiToken() {
      if (!currentUser || !currentUser.apiToken) return;
      try {
        await navigator.clipboard.writeText(currentUser.apiToken);
        showToast('API 토큰이 클립보드에 복사되었습니다.');
      } catch {
        prompt('내 API 토큰 복사:', currentUser.apiToken);
      }
    }

    async function logoutAccount() {
      if (sseSource) {
        try { sseSource.close(); } catch {}
        sseSource = null;
      }
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
      localStorage.removeItem('lectern_token');
      currentUser = null;
      lectures = [];
      currentLecture = null;
      document.getElementById('lecture-list').innerHTML = '';
      document.getElementById('md-article').innerHTML = '';
      document.getElementById('auth-gate').classList.remove('hidden');
    }

    async function bootstrapAuth() {
      const res = await fetch('/api/auth/me', { headers: authHeaders() });
      if (!res.ok) {
        document.getElementById('auth-gate').classList.remove('hidden');
        return;
      }
      const data = await res.json();
      applyAuthenticatedUser(data.user);
      await fetchLectures();
    }

    // Load saved settings
    const savedModel = localStorage.getItem('lectern_model') || 'gemini-flash-latest';
    const savedKey = localStorage.getItem('lectern_apikey') || '';
    document.getElementById('cfg-model').value = savedModel;
    document.getElementById('cfg-apikey').value = savedKey;

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    async function fetchLectures(selectId) {
      const params = new URLSearchParams();
      if (activeCourse !== 'ALL') params.set('course', activeCourse);
      if (searchQuery) params.set('q', searchQuery);
      const res = await fetch('/api/lectures?' + params.toString(), { headers: authHeaders() });
      if (res.status === 401) {
        document.getElementById('auth-gate').classList.remove('hidden');
        return;
      }
      const data = await res.json();
      lectures = data.lectures || [];
      renderCoursePills(data.courses || []);
      renderLectureList();

      const urlId = new URLSearchParams(location.search).get('lecture');
      const targetId = selectId || (currentLecture && currentLecture.id) || urlId || (lectures[0] && lectures[0].id);
      if (targetId) {
        await selectLecture(targetId, false);
      }
    }

    function renderCoursePills(courses) {
      const wrap = document.getElementById('course-pills');
      const all = ['ALL', ...courses];
      wrap.innerHTML = all.map(c => {
        const label = c === 'ALL' ? '전체' : c;
        const cls = c === activeCourse ? 'pill active' : 'pill';
        return '<button class="' + cls + '" onclick="setCourseFilter(\\'' + c.replace(/'/g, "\\\\'") + '\\')">' + label + '</button>';
      }).join('');

      const quickWrap = document.getElementById('quick-course-chips');
      if (quickWrap) {
        quickWrap.innerHTML = courses.map(c =>
          '<button type="button" class="pill" onclick="document.getElementById(\\'rec-course\\').value=\\'' + c.replace(/'/g, "\\\\'") + '\\'">' + c + '</button>'
        ).join('');
      }
    }

    function setCourseFilter(c) {
      activeCourse = c;
      fetchLectures();
    }

    function renderLectureList() {
      const listEl = document.getElementById('lecture-list');
      if (!lectures.length) {
        listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px;">조건에 맞는 강의 노트가 없습니다.</div>';
        return;
      }
      listEl.innerHTML = lectures.map(item => {
        const isAct = currentLecture && currentLecture.id === item.id;
        const visBadge = item.is_public
          ? '<span style="font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:999px;background:var(--status-success-bg);color:var(--status-success-fg);">공개</span>'
          : '<span style="font-size:10.5px;font-weight:500;padding:1px 6px;border-radius:999px;background:var(--surface-subtle);color:var(--text-tertiary);">비공개</span>';
        const progHtml = item.status === 'processing'
          ? '<div class="card-progress"><div class="card-progress-bar" style="width:' + (item.progress || 15) + '%"></div></div><div style="font-size:11.5px;color:var(--action-primary);margin-top:4px;font-weight:600;">' + escapeClientHtml(item.stage_message || '분석 중...') + ' (' + (item.progress || 15) + '%)</div>'
          : item.status === 'error'
          ? '<div style="font-size:11.5px;color:var(--status-danger-fg);margin-top:4px;font-weight:600;">분석 실패 · 정리 가능</div>'
          : '';
        return '<div class="lecture-card ' + (isAct ? 'active' : '') + '" onclick="selectLecture(\\'' + item.id + '\\', true)">' +
          '<div class="card-top">' +
            '<span class="card-course">' + escapeClientHtml(item.course) + '</span>' +
            '<span style="display:flex;align-items:center;gap:4px;">' + visBadge + '<span class="card-date">' + escapeClientHtml(item.date_label) + '</span></span>' +
          '</div>' +
          '<div class="card-title">' + escapeClientHtml(item.title) + '</div>' +
          '<div class="card-excerpt">' + escapeClientHtml(item.excerpt || '') + '</div>' +
          progHtml +
        '</div>';
      }).join('');

      ensureFallbackPolling();
    }

    function escapeClientHtml(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function selectLecture(id, closeMobileList) {
      const res = await fetch('/api/lectures/' + encodeURIComponent(id), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      currentLecture = data.lecture;
      renderLectureList();

      document.getElementById('cur-course').textContent = currentLecture.course;
      document.getElementById('cur-date').textContent = currentLecture.date_label;
      document.getElementById('cur-model').textContent = currentLecture.model_used || 'gemini-flash-latest';
      updateVisibilityButtonsUI();

      const audioBar = document.getElementById('audio-bar');
      const audioEl = document.getElementById('lecture-audio');
      if (currentLecture.has_audio) {
        audioBar.classList.add('visible');
        const tok = localStorage.getItem('lectern_token') || '';
        const targetSrc = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/audio' + (tok ? '?token=' + encodeURIComponent(tok) : '');
        if (!audioEl.src.endsWith(targetSrc)) {
          audioEl.src = targetSrc;
        }
      } else {
        audioBar.classList.remove('visible');
        audioEl.removeAttribute('src');
      }

      const art = document.getElementById('md-article');
      if (currentLecture.status === 'processing') {
        renderProcessingArticle(currentLecture);
        ensureFallbackPolling();
      } else if (currentLecture.status === 'error') {
        art.innerHTML =
          '<div style="padding:36px;border-radius:var(--radius-md);background:var(--surface-subtle);border:1px solid var(--border-default);max-width:560px;margin:24px auto;">' +
            '<div style="font-size:16px;font-weight:700;color:var(--status-danger-fg);margin-bottom:8px;">분석 중 일시적 장애가 발생했습니다</div>' +
            '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;word-break:break-all;">' + escapeClientHtml(currentLecture.error_message || '알 수 없는 오류') + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-primary);margin-bottom:16px;">서버 디스크에 원본 음성 파일이 안전하게 보존되어 있습니다. 아래 버튼으로 즉시 재분석하거나 원본 음성을 다운로드할 수 있습니다.</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="btn btn-primary" onclick="retryLectureDistillation(\\'' + currentLecture.id + '\\')">보존된 원본 오디오로 재분석</button>' +
              '<button class="btn" onclick="downloadCurrentRawAudio()">원본 오디오 다운로드</button>' +
              '<button class="btn" style="color:var(--status-danger-fg);" onclick="deleteCurrentLecture()">기록 삭제</button>' +
            '</div>' +
          '</div>';
      } else {
        art.innerHTML = data.rendered.html;
      }

      const tocList = document.getElementById('toc-list');
      tocList.innerHTML = (data.rendered?.toc || []).map(t =>
        '<a class="toc-link lvl-' + t.level + '" href="#' + t.id + '">' + escapeClientHtml(t.text) + '</a>'
      ).join('');

      toggleEditor(false);
      if (closeMobileList && window.innerWidth <= 960) {
        switchMobileTab('reader');
      }
    }

    function ensureFallbackPolling() {
      clearTimeout(window.__pollTimer);
      const hasProcessing = lectures.some(l => l.status === 'processing') || (currentLecture && currentLecture.status === 'processing');
      if (!hasProcessing) return;
      window.__pollTimer = setTimeout(async () => {
        const prevProcIds = new Set(lectures.filter(l => l.status === 'processing').map(l => l.id));
        const params = new URLSearchParams();
        if (activeCourse !== 'ALL') params.set('course', activeCourse);
        if (searchQuery) params.set('q', searchQuery);
        const res = await fetch('/api/lectures?' + params.toString(), { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          lectures = data.lectures || [];
          renderLectureList();
          if (currentLecture) {
            const updatedItem = lectures.find(l => l.id === currentLecture.id);
            if (updatedItem && (prevProcIds.has(currentLecture.id) || currentLecture.status === 'processing')) {
              await selectLecture(currentLecture.id, false);
            }
          }
        }
      }, 2400);
    }

    function updateVisibilityButtonsUI() {
      const btn = document.getElementById('btn-visibility');
      const modalBtn = document.getElementById('cleanup-vis-btn');
      const curTitle = document.getElementById('cleanup-cur-title');
      const moveInput = document.getElementById('cleanup-move-course');
      if (!currentLecture) {
        if (btn) btn.textContent = '비공개';
        return;
      }
      const isPub = Boolean(currentLecture.is_public);
      if (btn) {
        btn.textContent = isPub ? '공개중' : '비공개';
        btn.style.color = isPub ? 'var(--status-success-fg)' : 'var(--text-secondary)';
        btn.style.borderColor = isPub ? 'var(--status-success-fg)' : 'var(--border-default)';
      }
      if (modalBtn) {
        modalBtn.textContent = isPub ? '현재: 공개중 → 비공개로 전환' : '현재: 비공개 → 공개로 전환';
      }
      if (curTitle) {
        curTitle.textContent = '현재 노트: ' + currentLecture.title + (isPub ? ' (공유 링크 열림)' : ' (비공개)');
      }
      if (moveInput) {
        moveInput.value = currentLecture.course || '';
      }
    }

    async function toggleCurrentVisibility(forcePublic) {
      if (!currentLecture) return;
      const nextPublic = typeof forcePublic === 'boolean' ? forcePublic : !Boolean(currentLecture.is_public);
      const res = await fetch('/api/lectures/' + encodeURIComponent(currentLecture.id) + '/visibility', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ is_public: nextPublic })
      });
      if (!res.ok) {
        showToast('공개 상태 변경에 실패했습니다.');
        return;
      }
      const data = await res.json();
      currentLecture = data.lecture;
      upsertLectureSummaryInState(data.lecture);
      updateVisibilityButtonsUI();
      showToast(nextPublic ? '공유 링크 열람이 허용(공개)되었습니다.' : '비공개로 전환되어 외부 공유 링크 접근이 차단되었습니다.');
    }

    async function rotateCurrentShareToken() {
      if (!currentLecture) return;
      const res = await fetch('/api/lectures/' + encodeURIComponent(currentLecture.id) + '/visibility', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ is_public: Boolean(currentLecture.is_public), rotate_token: true })
      });
      if (res.ok) {
        const data = await res.json();
        currentLecture = data.lecture;
        upsertLectureSummaryInState(data.lecture);
        showToast('새 공유 토큰이 발급되어 기존 링크가 무효화되었습니다.');
      }
    }

    async function deleteCurrentLecture() {
      if (!currentLecture) return;
      if (!confirm('[' + currentLecture.title + '] 강의 노트와 원본 오디오를 삭제할까요?')) return;
      const targetId = currentLecture.id;
      const res = await fetch('/api/lectures/' + encodeURIComponent(targetId), {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        closeModal('cleanup-modal');
        removeLectureIdsFromState([targetId]);
        showToast('강의 노트가 삭제되었습니다.');
      } else {
        showToast('삭제에 실패했습니다.');
      }
    }

    async function deleteCurrentAudioOnly() {
      if (!currentLecture) return;
      if (!currentLecture.has_audio) {
        showToast('이 노트에는 삭제할 원본 오디오 파일이 없습니다.');
        return;
      }
      if (!confirm('마크다운 노트는 그대로 보존하고 원본 오디오 파일만 삭제할까요?')) return;
      const res = await fetch('/api/lectures/' + encodeURIComponent(currentLecture.id) + '/audio', {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        currentLecture.has_audio = false;
        if (data.lecture) upsertLectureSummaryInState(data.lecture);
        document.getElementById('audio-bar').classList.remove('visible');
        showToast('원본 오디오 파일이 정리되었습니다 (노트 본문 보존).');
      }
    }

    async function moveCurrentLectureCourse() {
      if (!currentLecture) return;
      const nextCourse = document.getElementById('cleanup-move-course').value.trim();
      if (!nextCourse) return;
      const res = await fetch('/api/lectures/' + encodeURIComponent(currentLecture.id), {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title: currentLecture.title,
          course: nextCourse,
          markdown: currentLecture.markdown
        })
      });
      if (res.ok) {
        showToast('과목이 [' + nextCourse + '](으)로 이동되었습니다.');
        await fetchLectures(currentLecture.id);
      }
    }

    async function runWorkspaceCleanup(mode) {
      const msgMap = {
        failed: '오류 또는 중단된 분석 기록을 모두 정리할까요?',
        short_fragments: '15초 미만의 짧은 테스트·단편 녹음 기록을 일괄 삭제할까요?',
        audio_only_all: '완료된 모든 강의 노트의 마크다운은 보존하고 원본 오디오만 비울까요?'
      };
      if (msgMap[mode] && !confirm(msgMap[mode])) return;
      const res = await fetch('/api/lectures/cleanup', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode })
      });
      if (res.ok) {
        const data = await res.json();
        const mb = (Number(data.reclaimedBytes || 0) / 1048576).toFixed(1);
        showToast('정리 완료: ' + data.affectedCount + '건 처리 (' + mb + ' MB 확보)');
        await fetchLectures();
      }
    }

    function openCleanupModal() {
      updateVisibilityButtonsUI();
      document.getElementById('cleanup-modal').classList.add('open');
    }

    // Clickable [MM:SS] timestamp chips seek the audio player
    document.getElementById('md-article').addEventListener('click', (e) => {
      const chip = e.target.closest('.ts-chip');
      if (!chip) return;
      const sec = Number(chip.dataset.sec || 0);
      const audioEl = document.getElementById('lecture-audio');
      if (currentLecture && currentLecture.has_audio && audioEl) {
        audioEl.currentTime = sec;
        audioEl.play().catch(() => {});
        showToast('오디오 ' + chip.textContent.replace('⏱', '').trim() + ' 지점으로 이동');
      } else {
        showToast('이 노트에는 연결된 원본 오디오 파일이 없습니다.');
      }
    });

    function changeAudioSpeed(val) {
      const audioEl = document.getElementById('lecture-audio');
      if (audioEl) audioEl.playbackRate = parseFloat(val) || 1.0;
    }

    function toggleEditor(force) {
      if (!currentLecture) return;
      const ed = document.getElementById('editor-pane');
      const art = document.getElementById('md-article');
      const show = typeof force === 'boolean' ? force : !ed.classList.contains('visible');
      if (show) {
        document.getElementById('edit-title').value = currentLecture.title;
        document.getElementById('edit-course').value = currentLecture.course;
        document.getElementById('edit-markdown').value = currentLecture.markdown;
        ed.classList.add('visible');
        art.style.display = 'none';
      } else {
        ed.classList.remove('visible');
        art.style.display = 'block';
      }
    }

    async function saveMarkdownEdit() {
      if (!currentLecture) return;
      const title = document.getElementById('edit-title').value.trim();
      const course = document.getElementById('edit-course').value.trim();
      const markdown = document.getElementById('edit-markdown').value;
      const res = await fetch('/api/lectures/' + encodeURIComponent(currentLecture.id), {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, course, markdown })
      });
      if (res.ok) {
        showToast('강의 노트가 저장되었습니다.');
        await fetchLectures(currentLecture.id);
      }
    }

    function downloadCurrentMarkdown() {
      if (!currentLecture) return;
      const tok = localStorage.getItem('lectern_token') || '';
      window.location.href = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/markdown' + (tok ? '?token=' + encodeURIComponent(tok) : '');
    }

    function downloadCurrentRawAudio() {
      if (!currentLecture || !currentLecture.has_audio) {
        showToast('원본 오디오 파일이 없습니다.');
        return;
      }
      const tok = localStorage.getItem('lectern_token') || '';
      const a = document.createElement('a');
      a.href = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/audio' + (tok ? '?token=' + encodeURIComponent(tok) : '');
      a.download = (currentLecture.course || 'lecture') + '_' + (currentLecture.date_label || 'audio') + '.m4a';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    async function retryLectureDistillation(id) {
      const targetId = id || (currentLecture && currentLecture.id);
      if (!targetId) return;
      const res = await fetch('/api/lectures/' + encodeURIComponent(targetId) + '/retry', {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '재분석 요청에 실패했습니다.');
        return;
      }
      showToast('보존된 원본 오디오로 재분석을 시작합니다.');
      if (data.lecture) {
        upsertLectureSummaryInState(data.lecture);
      }
      await selectLecture(targetId, false);
    }

    async function shareCurrentLecture() {
      if (!currentLecture) return;
      if (!currentLecture.is_public) {
        const ok = confirm('현재 이 강의 노트는 [비공개] 상태입니다.\n외부에서 공유 링크로 열람할 수 있도록 [공개]로 전환하고 링크를 복사할까요?');
        if (!ok) return;
        await toggleCurrentVisibility(true);
      }
      const shareUrl = location.origin + '/s/' + currentLecture.share_token;
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('공개 공유 링크가 클립보드에 복사되었습니다.');
      } catch {
        prompt('공유 링크를 복사하세요:', shareUrl);
      }
    }

    // Search shortcut Cmd/Ctrl + K
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      fetchLectures();
    });
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
      }
    });

    // Modals
    function openRecorderModal() { document.getElementById('recorder-modal').classList.add('open'); }
    function openClientsModal() { document.getElementById('clients-modal').classList.add('open'); }
    function openSettingsModal() { document.getElementById('settings-modal').classList.add('open'); }
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }

    function saveSettings() {
      const m = document.getElementById('cfg-model').value.trim() || 'gemini-flash-latest';
      const k = document.getElementById('cfg-apikey').value.trim();
      localStorage.setItem('lectern_model', m);
      localStorage.setItem('lectern_apikey', k);
      closeModal('settings-modal');
      showToast('설정이 저장되었습니다.');
    }

    function switchMobileTab(tab) {
      const sb = document.getElementById('sidebar');
      document.getElementById('tab-list').classList.toggle('active', tab === 'list');
      document.getElementById('tab-reader').classList.toggle('active', tab === 'reader');
      sb.classList.toggle('mobile-open', tab === 'list');
    }

    // Live Web Microphone Recorder with IndexedDB Local Vault, Auto-Checkpoint & Offline Upload Retry
    let mediaRecorder = null;
    let recChunks = [];
    let recStartTime = 0;
    let recTimerInterval = null;
    let audioCtx = null;
    let analyser = null;
    let animFrame = null;
    let wakeLock = null;
    let vaultDbPromise = null;

    function openVaultDb() {
      if (vaultDbPromise) return vaultDbPromise;
      vaultDbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return resolve(null);
        const req = indexedDB.open('lectern_audio_vault_v1', 1);
        req.onupgradeneeded = (e) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('checkpoints')) {
            idb.createObjectStore('checkpoints', { keyPath: 'id' });
          }
          if (!idb.objectStoreNames.contains('pending_uploads')) {
            idb.createObjectStore('pending_uploads', { keyPath: 'localId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      return vaultDbPromise;
    }

    async function saveRecordingCheckpoint(course, mimeType, chunks) {
      const idb = await openVaultDb();
      if (!idb || !chunks.length) return;
      try {
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        const tx = idb.transaction('checkpoints', 'readwrite');
        tx.objectStore('checkpoints').put({
          id: 'active_session',
          course: course || '대학교 전공 강의',
          mimeType: blob.type,
          startedAt: recStartTime || Date.now(),
          updatedAt: Date.now(),
          blob
        });
      } catch {}
    }

    async function clearRecordingCheckpoint() {
      const idb = await openVaultDb();
      if (!idb) return;
      try {
        const tx = idb.transaction('checkpoints', 'readwrite');
        tx.objectStore('checkpoints').delete('active_session');
      } catch {}
    }

    async function savePendingUploadToVault(entry) {
      const idb = await openVaultDb();
      if (!idb) return;
      await new Promise((resolve) => {
        const tx = idb.transaction('pending_uploads', 'readwrite');
        tx.objectStore('pending_uploads').put(entry);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
      await renderLocalVaultList();
    }

    async function removePendingUploadFromVault(localId) {
      const idb = await openVaultDb();
      if (!idb) return;
      await new Promise((resolve) => {
        const tx = idb.transaction('pending_uploads', 'readwrite');
        tx.objectStore('pending_uploads').delete(localId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
      await renderLocalVaultList();
    }

    async function listPendingUploadsFromVault() {
      const idb = await openVaultDb();
      if (!idb) return [];
      return new Promise((resolve) => {
        const tx = idb.transaction('pending_uploads', 'readonly');
        const req = tx.objectStore('pending_uploads').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }

    async function recoverInterruptedCheckpointOnLoad() {
      const idb = await openVaultDb();
      if (!idb) return;
      const cp = await new Promise((resolve) => {
        const tx = idb.transaction('checkpoints', 'readonly');
        const req = tx.objectStore('checkpoints').get('active_session');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (cp && cp.blob && cp.blob.size > 1024) {
        const ext = (cp.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        const localId = 'rec_' + (cp.startedAt || Date.now());
        await savePendingUploadToVault({
          localId,
          fileName: (cp.course || '강의') + '_' + new Date(cp.startedAt || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + ext,
          course: cp.course || '대학교 전공 강의',
          mimeType: cp.mimeType || 'audio/webm',
          size: cp.blob.size,
          createdAt: cp.updatedAt || Date.now(),
          sourceClient: 'web-mic-recovered',
          lastError: '이전 녹음 중 브라우저 종료로부터 자동 복구됨',
          blob: cp.blob
        });
        await clearRecordingCheckpoint();
        showToast('이전에 비정상 종료된 녹음 원본을 로컬 금고에서 복구했습니다!');
      }
      await renderLocalVaultList();
    }

    function triggerLocalBlobDownload(blob, fileName) {
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch {}
    }

    async function renderLocalVaultList() {
      const items = await listPendingUploadsFromVault();
      const box = document.getElementById('local-vault-box');
      const listEl = document.getElementById('local-vault-list');
      const titleEl = document.getElementById('local-vault-title');
      if (!box || !listEl) return;
      if (!items.length) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      titleEl.textContent = '미전송 로컬 녹음 보관함 (' + items.length + '건 안전 보관 중)';
      listEl.innerHTML = items.map(item => {
        const mb = ((item.size || 0) / 1048576).toFixed(1);
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:var(--radius-sm);background:var(--surface-elevated);border:1px solid var(--border-subtle);">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:12.5px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">[' + escapeClientHtml(item.course) + '] ' + escapeClientHtml(item.fileName) + ' (' + mb + ' MB)</div>' +
            '<div style="font-size:11px;color:var(--status-danger-fg);">' + escapeClientHtml(item.lastError || '업로드 대기 중') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:4px;flex-shrink:0;">' +
            '<button class="btn btn-primary" style="height:26px;padding:0 8px;font-size:11px;" onclick="retrySingleVaultUpload(\\'' + item.localId + '\\')">재업로드</button>' +
            '<button class="btn" style="height:26px;padding:0 8px;font-size:11px;" onclick="downloadVaultItem(\\'' + item.localId + '\\')">원본 저장</button>' +
            '<button class="btn" style="height:26px;padding:0 8px;font-size:11px;color:var(--status-danger-fg);" onclick="removePendingUploadFromVault(\\'' + item.localId + '\\')">삭제</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function downloadVaultItem(localId) {
      const items = await listPendingUploadsFromVault();
      const target = items.find(i => i.localId === localId);
      if (target && target.blob) {
        triggerLocalBlobDownload(target.blob, target.fileName || (localId + '.m4a'));
      }
    }

    async function retrySingleVaultUpload(localId) {
      const items = await listPendingUploadsFromVault();
      const target = items.find(i => i.localId === localId);
      if (!target || !target.blob) return;
      const file = new File([target.blob], target.fileName, { type: target.mimeType || 'audio/mp4' });
      await uploadAndDistillFile(file, target.sourceClient || 'web-vault-retry', target.localId, target.course);
    }

    async function retryAllPendingLocalUploads() {
      const items = await listPendingUploadsFromVault();
      for (const item of items) {
        await retrySingleVaultUpload(item.localId);
      }
    }

    window.addEventListener('online', () => {
      showToast('네트워크 연결 복구됨: 미전송 로컬 녹음 자동 업로드를 확인합니다.');
      retryAllPendingLocalUploads();
    });

    async function toggleMicRecording() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });
        if ('wakeLock' in navigator) {
          try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
        }

        const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : '';

        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recChunks = [];
        recStartTime = Date.now();
        const recCourseAtStart = document.getElementById('rec-course').value.trim() || '대학교 전공 강의';

        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            recChunks.push(ev.data);
            if (recChunks.length % 3 === 0) {
              saveRecordingCheckpoint(recCourseAtStart, mediaRecorder.mimeType, recChunks);
            }
          }
        };
        mediaRecorder.onstop = async () => {
          cancelAnimationFrame(animFrame);
          clearInterval(recTimerInterval);
          stream.getTracks().forEach(t => t.stop());
          if (wakeLock) { try { await wakeLock.release(); } catch {} wakeLock = null; }

          document.getElementById('btn-rec-start').textContent = '마이크 녹음 시작';
          document.getElementById('btn-rec-start').classList.remove('btn-danger');
          document.getElementById('btn-rec-pause').style.display = 'none';

          const courseNow = document.getElementById('rec-course').value.trim() || recCourseAtStart;
          const ext = (mediaRecorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          const safeCourse = courseNow.replace(/[\\/:*?"<>|\s]+/g, '_');
          const fileName = safeCourse + '_' + stamp + '.' + ext;
          const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          const localId = 'rec_' + recStartTime;

          // 1) Save to IndexedDB Pending Vault first (Zero-Data-Loss guarantee)
          await savePendingUploadToVault({
            localId,
            fileName,
            course: courseNow,
            mimeType: blob.type,
            size: blob.size,
            createdAt: Date.now(),
            sourceClient: 'web-mic',
            lastError: '업로드 진행 중...',
            blob
          });
          await clearRecordingCheckpoint();

          // 2) Auto-save raw audio file to user's local disk if checkbox is enabled
          const autoSaveChk = document.getElementById('chk-local-save');
          if (!autoSaveChk || autoSaveChk.checked) {
            triggerLocalBlobDownload(blob, fileName);
          }

          // 3) Upload with automatic retry + idempotency key
          const file = new File([blob], fileName, { type: blob.type });
          await uploadAndDistillFile(file, 'web-mic', localId, courseNow);
        };

        mediaRecorder.start(1000);
        document.getElementById('btn-rec-start').textContent = '녹음 종료 및 노트 요약 시작';
        document.getElementById('btn-rec-start').classList.add('btn-danger');
        document.getElementById('btn-rec-pause').style.display = 'inline-flex';

        recTimerInterval = setInterval(() => {
          const sec = Math.floor((Date.now() - recStartTime) / 1000);
          const m = String(Math.floor(sec / 60)).padStart(2, '0');
          const s = String(sec % 60).padStart(2, '0');
          document.getElementById('rec-timer').textContent = m + ':' + s;
        }, 500);

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        src.connect(analyser);
        drawWaveform();
      } catch (err) {
        alert('마이크 권한을 확인해주세요: ' + err.message);
      }
    }

    function pauseResumeRecording() {
      if (!mediaRecorder) return;
      const btn = document.getElementById('btn-rec-pause');
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        btn.textContent = '재개';
      } else if (mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        btn.textContent = '일시정지';
      }
    }

    function drawWaveform() {
      const canvas = document.getElementById('rec-canvas');
      const ctx = canvas.getContext('2d');
      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);

      function render() {
        animFrame = requestAnimationFrame(render);
        analyser.getByteFrequencyData(data);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barW = (canvas.width / bufLen) * 1.6;
        let x = 0;
        for (let i = 0; i < bufLen; i++) {
          const v = data[i] / 255;
          const h = Math.max(4, v * (canvas.height - 14));
          ctx.fillStyle = v > 0.6 ? '#4593FC' : '#3182F6';
          ctx.fillRect(x, (canvas.height - h) / 2, barW - 2, h);
          x += barW;
        }
      }
      render();
    }

    // Drag & Drop File Upload
    const dz = document.getElementById('dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFileSelect(e.dataTransfer.files);
      }
    });

    async function handleFileSelect(files) {
      if (!files || !files.length) return;
      await uploadAndDistillFile(files[0], 'web-upload');
    }

    async function uploadAndDistillFile(file, sourceClient, existingLocalId, overrideCourse) {
      const course = overrideCourse || document.getElementById('rec-course').value.trim() || '대학교 전공 강의';
      const model = localStorage.getItem('lectern_model') || 'gemini-flash-latest';
      const apiKey = localStorage.getItem('lectern_apikey') || '';
      const localId = existingLocalId || ('upl_' + file.name + '_' + file.size + '_' + file.lastModified);

      // Persist file in IndexedDB Pending Vault before upload so network failures never lose data
      if (!existingLocalId) {
        await savePendingUploadToVault({
          localId,
          fileName: file.name,
          course,
          mimeType: file.type || 'audio/mp4',
          size: file.size,
          createdAt: Date.now(),
          sourceClient: sourceClient || 'web-upload',
          lastError: '업로드 진행 중...',
          blob: file
        });
      }

      const statusEl = document.getElementById('ingest-status');
      statusEl.style.display = 'block';

      const maxAttempts = 3;
      let lastErrorMsg = '네트워크 연결 오류';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          statusEl.textContent =
            (attempt > 1 ? '[재시도 ' + attempt + '/' + maxAttempts + '] ' : '') +
            '오디오 업로드 중 (' + (file.size / 1048576).toFixed(1) + ' MB)...';

          const form = new FormData();
          form.append('audio', file);
          form.append('course', course);
          form.append('model', model);
          form.append('source', sourceClient);
          form.append('idempotency_key', localId);

          const headers = authHeaders({ 'X-Idempotency-Key': localId });
          if (apiKey) headers['X-Gemini-Key'] = apiKey;

          const res = await fetch('/api/lectures/ingest', {
            method: 'POST',
            headers,
            body: form
          });
          const data = await res.json();
          if (!res.ok) {
            lastErrorMsg = data.error || ('HTTP ' + res.status);
            if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
              break;
            }
            throw new Error(lastErrorMsg);
          }

          // Upload succeeded! Remove from Pending Vault
          await removePendingUploadFromVault(localId);
          statusEl.style.display = 'none';
          closeModal('recorder-modal');
          showToast('오디오 업로드 완료 · 실시간 증류가 시작되었습니다.');
          await fetchLectures(data.lecture.id);
          return;
        } catch (err) {
          lastErrorMsg = err.message || '네트워크 장애';
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
      }

      // If all attempts failed, update the entry in IndexedDB Pending Vault & alert user
      await savePendingUploadToVault({
        localId,
        fileName: file.name,
        course,
        mimeType: file.type || 'audio/mp4',
        size: file.size,
        createdAt: Date.now(),
        sourceClient: sourceClient || 'web-upload',
        lastError: '업로드 실패 (' + lastErrorMsg + ') · 로컬 금고에 안전 보관됨',
        blob: file
      });
      statusEl.textContent =
        '업로드 중 네트워크 장애가 발생했지만 원본 오디오가 브라우저 로컬 금고에 안전하게 보관되었습니다. 네트워크 복구 시 자동 재업로드되거나 위 보관함에서 즉시 재시도/다운로드할 수 있습니다.';
      showToast('업로드 지연: 원본 오디오가 로컬 보관함에 안전하게 보호되었습니다.');
    }

    const savedAutoSave = localStorage.getItem('lectern_autosave_local');
    if (savedAutoSave === '0') {
      const chk = document.getElementById('chk-local-save');
      if (chk) chk.checked = false;
    }
    recoverInterruptedCheckpointOnLoad();
    bootstrapAuth();
  </script>
</body>
</html>`;
}
