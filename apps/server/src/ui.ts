import { escapeHtml, renderMarkdownToHtml } from "../../../packages/core/src/index.ts";
import type { LectureRecord } from "./db.ts";

export function renderSharePageHtml(lecture: LectureRecord): string {
  const rendered = renderMarkdownToHtml(lecture.markdown || "");
  const title = escapeHtml(lecture.title);
  const course = escapeHtml(lecture.course);
  const excerpt = escapeHtml(lecture.excerpt);
  const hasAudio = Boolean(lecture.audio_path);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Lectern</title>
  <meta property="og:title" content="${title} (${course})" />
  <meta property="og:description" content="${excerpt}" />
  <meta property="og:type" content="article" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    :root {
      --bg: #0b0c0e;
      --surface: #121418;
      --surface-2: #181b20;
      --border: rgba(255, 255, 255, 0.08);
      --text: #f2f4f8;
      --text-muted: #949ba6;
      --accent: #3b82f6;
      --accent-soft: rgba(59, 130, 246, 0.14);
      --amber: #f59e0b;
      --emerald: #10b981;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
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
      padding: 12px 24px;
      background: rgba(11, 12, 14, 0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent);
    }
    .actions { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      cursor: pointer;
      text-decoration: none;
    }
    .btn:hover { border-color: rgba(255,255,255,0.2); background: #20242c; }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .container {
      max-width: 860px;
      margin: 0 auto;
      padding: 36px 24px 80px;
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 20px;
    }
    .badge {
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      background: var(--accent-soft);
      color: #60a5fa;
    }
    .badge-muted {
      background: var(--surface-2);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .audio-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 28px;
    }
    .audio-bar audio { flex: 1; height: 36px; }
    .md-body h1 { font-size: 28px; letter-spacing: -0.025em; margin: 0 0 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
    .md-body h2 { font-size: 20px; margin: 34px 0 14px; color: #fff; letter-spacing: -0.015em; }
    .md-body h3 { font-size: 16.5px; margin: 24px 0 10px; color: #dbeafe; }
    .md-body p, .md-body li { font-size: 15px; color: #d6dae2; }
    .md-body ul, .md-body ol { padding-left: 22px; margin: 10px 0; }
    .md-body li { margin: 6px 0; }
    .md-body strong { color: #fff; font-weight: 650; }
    .md-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13.5px;
      padding: 2px 6px;
      border-radius: 5px;
      background: rgba(255,255,255,0.07);
      color: #93c5fd;
    }
    .md-code {
      padding: 16px;
      border-radius: 10px;
      background: #0d0f13;
      border: 1px solid var(--border);
      overflow-x: auto;
    }
    .md-code code { background: none; padding: 0; color: #e2e8f0; }
    .md-quote {
      margin: 14px 0;
      padding: 12px 16px;
      border-left: 3px solid var(--accent);
      background: rgba(59, 130, 246, 0.06);
      border-radius: 0 8px 8px 0;
    }
    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 7px;
      margin: 0 2px;
      border-radius: 5px;
      border: 1px solid rgba(59, 130, 246, 0.32);
      background: rgba(59, 130, 246, 0.12);
      color: #60a5fa;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      cursor: pointer;
    }
    .ts-chip:hover { background: rgba(59, 130, 246, 0.25); }
    .filter-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 9px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 600;
    }
    .filter-break { background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .filter-cut { background: rgba(16, 185, 129, 0.14); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    @media print {
      body { background: #fff; color: #111; }
      .share-topbar, .audio-bar { display: none !important; }
      .container { max-width: 100%; padding: 0; }
      .md-body h1, .md-body h2, .md-body h3, .md-body strong { color: #000; }
      .md-body p, .md-body li { color: #222; }
      .ts-chip { border-color: #999; color: #333; background: #f3f4f6; }
    }
  </style>
</head>
<body>
  <header class="share-topbar">
    <a class="brand" href="/">
      <span class="brand-dot"></span>
      <span>LECTERN</span>
    </a>
    <div class="actions">
      <a class="btn" href="/api/lectures/${encodeURIComponent(lecture.id)}/markdown" download>⬇️ MD 다운로드</a>
      <button class="btn btn-primary" onclick="window.print()">📄 PDF 저장 / 인쇄</button>
    </div>
  </header>
  <main class="container">
    <div class="meta-bar">
      <span class="badge">${course}</span>
      <span class="badge badge-muted">📅 ${escapeHtml(lecture.date_label)}</span>
      <span class="badge badge-muted">⚡ ${escapeHtml(lecture.model_used)}</span>
    </div>
    ${
      hasAudio
        ? `<div class="audio-bar">
            <audio id="share-audio" controls preload="metadata" src="/api/lectures/${encodeURIComponent(
              lecture.id
            )}/audio"></audio>
          </div>`
        : ""
    }
    <article class="md-body" id="md-root">
      ${rendered.html}
    </article>
  </main>
  <script>
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
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="theme-color" content="#0b0c0e" />
  <title>Lectern — Academic Audio Distillation & Markdown Reader</title>
  <link rel="manifest" href="/manifest.json" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    :root {
      --bg: #0b0c0e;
      --sidebar: #101216;
      --surface: #15181e;
      --surface-hover: #1b1f27;
      --surface-active: #202632;
      --border: rgba(255, 255, 255, 0.075);
      --border-strong: rgba(255, 255, 255, 0.14);
      --text: #f3f5f8;
      --text-secondary: #c5cad3;
      --text-muted: #858d99;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --accent-soft: rgba(59, 130, 246, 0.14);
      --danger: #ef4444;
      --emerald: #10b981;
      --amber: #f59e0b;
      --radius: 11px;
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }

    /* App Layout */
    .app-shell {
      display: grid;
      grid-template-columns: 330px 1fr;
      height: 100vh;
      width: 100vw;
    }

    /* Sidebar */
    .sidebar {
      display: flex;
      flex-direction: column;
      background: var(--sidebar);
      border-right: 1px solid var(--border);
      height: 100vh;
      overflow: hidden;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 12px;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
      font-weight: 750;
      font-size: 15.5px;
      letter-spacing: -0.02em;
    }
    .brand-mark {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 12px var(--accent);
    }
    .brand-sub {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      margin-left: 2px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.14s ease;
      white-space: nowrap;
      text-decoration: none;
    }
    .btn:hover { background: var(--surface-hover); border-color: var(--border-strong); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .btn-danger { background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.35); color: #fca5a5; }

    .search-box {
      padding: 10px 14px 6px;
    }
    .search-input {
      width: 100%;
      padding: 8px 11px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0b0d10;
      color: var(--text);
      font-size: 13px;
      outline: none;
    }
    .search-input:focus { border-color: var(--accent); }

    .course-pills {
      display: flex;
      gap: 6px;
      padding: 6px 14px 10px;
      overflow-x: auto;
      scrollbar-width: none;
      border-bottom: 1px solid var(--border);
    }
    .course-pills::-webkit-scrollbar { display: none; }
    .pill {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--surface);
      color: var(--text-muted);
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
    }
    .pill.active {
      background: var(--accent-soft);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.35);
    }

    .lecture-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .lecture-card {
      padding: 12px 13px;
      border-radius: 10px;
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .lecture-card:hover {
      background: var(--surface);
      border-color: var(--border);
    }
    .lecture-card.active {
      background: var(--surface-active);
      border-color: rgba(59, 130, 246, 0.4);
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 5px;
    }
    .card-course {
      font-size: 11px;
      font-weight: 650;
      padding: 2px 7px;
      border-radius: 5px;
      background: var(--accent-soft);
      color: #60a5fa;
    }
    .card-date {
      font-size: 11.5px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .card-title {
      font-weight: 650;
      font-size: 13.5px;
      color: var(--text);
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-excerpt {
      font-size: 12px;
      color: var(--text-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.45;
    }
    .card-progress {
      margin-top: 8px;
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 4px;
      overflow: hidden;
    }
    .card-progress-bar {
      height: 100%;
      background: var(--accent);
      transition: width 0.3s ease;
    }

    .sidebar-footer {
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 6px;
    }
    .sidebar-footer .btn { flex: 1; font-size: 12px; padding: 7px 8px; }

    /* Main Reader Pane */
    .main-pane {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--bg);
    }

    .reader-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      background: rgba(11, 12, 14, 0.85);
      backdrop-filter: blur(12px);
      min-height: 57px;
    }
    .toolbar-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
    }
    .meta-pill {
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      background: var(--surface);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .meta-pill.course {
      background: var(--accent-soft);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.3);
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Audio Player Bar */
    .audio-bar {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 8px 24px;
      background: #11141a;
      border-bottom: 1px solid var(--border);
    }
    .audio-bar.visible { display: flex; }
    .audio-bar audio { flex: 1; height: 34px; }
    .speed-select {
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      font-size: 12px;
      font-weight: 600;
    }

    /* Reader Scroll Area */
    .reader-scroll {
      flex: 1;
      overflow-y: auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 230px;
      gap: 32px;
      padding: 32px 36px 96px;
      max-width: 1220px;
      width: 100%;
      margin: 0 auto;
    }

    /* Markdown Typography */
    .md-article {
      min-width: 0;
      line-height: 1.72;
    }
    .md-article h1 {
      font-size: 26px;
      font-weight: 750;
      letter-spacing: -0.025em;
      margin: 0 0 20px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
      color: #fff;
    }
    .md-article h2 {
      font-size: 19.5px;
      font-weight: 700;
      letter-spacing: -0.015em;
      margin: 34px 0 12px;
      color: #f8fafc;
      scroll-margin-top: 20px;
    }
    .md-article h3 {
      font-size: 16px;
      font-weight: 650;
      margin: 24px 0 8px;
      color: #bfdbfe;
      scroll-margin-top: 20px;
    }
    .md-article h4 {
      font-size: 14.5px;
      font-weight: 650;
      margin: 18px 0 6px;
      color: #e2e8f0;
    }
    .md-article p, .md-article li {
      font-size: 14.8px;
      color: #d5dae2;
    }
    .md-article ul, .md-article ol {
      padding-left: 22px;
      margin: 8px 0 14px;
    }
    .md-article li { margin: 5px 0; }
    .md-article strong { color: #fff; font-weight: 650; }
    .md-article code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.075);
      color: #93c5fd;
    }
    .md-code {
      padding: 15px 18px;
      border-radius: 10px;
      background: #0d0f14;
      border: 1px solid var(--border);
      overflow-x: auto;
      margin: 14px 0;
    }
    .md-code code { background: none; padding: 0; color: #e2e8f0; }
    .md-quote {
      margin: 14px 0;
      padding: 11px 16px;
      border-left: 3px solid var(--accent);
      background: rgba(59, 130, 246, 0.06);
      border-radius: 0 8px 8px 0;
    }
    .md-quote p { margin: 4px 0; color: #e2e8f0; }
    .md-hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 26px 0;
    }
    .md-table-wrap { overflow-x: auto; margin: 14px 0; }
    .md-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13.5px;
    }
    .md-table th, .md-table td {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
    }
    .md-table th { background: var(--surface); color: #fff; }

    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 7px;
      margin: 0 2px;
      border-radius: 5px;
      border: 1px solid rgba(59, 130, 246, 0.32);
      background: rgba(59, 130, 246, 0.12);
      color: #60a5fa;
      font-size: 11.8px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      cursor: pointer;
      vertical-align: baseline;
    }
    .ts-chip:hover { background: rgba(59, 130, 246, 0.25); }

    .filter-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .filter-break { background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .filter-cut { background: rgba(16, 185, 129, 0.14); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }

    /* Right TOC Sidebar */
    .toc-rail {
      position: sticky;
      top: 0;
      align-self: start;
      border-left: 1px solid var(--border);
      padding-left: 16px;
      max-height: calc(100vh - 140px);
      overflow-y: auto;
    }
    .toc-title {
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 10px;
    }
    .toc-link {
      display: block;
      font-size: 12.5px;
      color: var(--text-muted);
      text-decoration: none;
      padding: 4px 0;
      line-height: 1.4;
      transition: color 0.12s;
    }
    .toc-link:hover { color: var(--text); }
    .toc-link.lvl-3 { padding-left: 10px; font-size: 12px; }

    /* Markdown Editor View */
    .editor-pane {
      display: none;
      flex-direction: column;
      gap: 10px;
    }
    .editor-pane.visible { display: flex; }
    .editor-textarea {
      width: 100%;
      min-height: 62vh;
      padding: 16px;
      border-radius: 10px;
      border: 1px solid var(--border-strong);
      background: #0d0f13;
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13.5px;
      line-height: 1.6;
      resize: vertical;
      outline: none;
    }

    /* Modals */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(0, 0, 0, 0.68);
      backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-backdrop.open { display: flex; }
    .modal-card {
      width: 100%;
      max-width: 560px;
      background: #14171d;
      border: 1px solid var(--border-strong);
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .modal-title { font-size: 17px; font-weight: 700; }

    /* Recorder Box */
    .rec-visualizer-wrap {
      position: relative;
      height: 86px;
      border-radius: 10px;
      background: #0b0d11;
      border: 1px solid var(--border);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
    }
    .rec-canvas { width: 100%; height: 100%; display: block; }
    .rec-timer {
      position: absolute;
      right: 12px;
      top: 10px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #f87171;
      background: rgba(0,0,0,0.6);
      padding: 2px 8px;
      border-radius: 6px;
    }
    .field-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .field-input {
      width: 100%;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0b0d11;
      color: var(--text);
      font-size: 13.5px;
      margin-bottom: 12px;
      outline: none;
    }
    .field-input:focus { border-color: var(--accent); }

    .dropzone {
      border: 1.5px dashed var(--border-strong);
      border-radius: 10px;
      padding: 18px;
      text-align: center;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
      margin-top: 10px;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--text);
    }

    /* Native Clients Grid */
    .client-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    .client-box {
      padding: 13px;
      border-radius: 10px;
      background: #0d1015;
      border: 1px solid var(--border);
    }
    .client-box h4 { margin: 0 0 6px; font-size: 13.5px; color: #fff; }
    .client-box p { margin: 0 0 8px; font-size: 12px; color: var(--text-muted); line-height: 1.45; }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
      padding: 10px 16px;
      border-radius: 9px;
      background: #1e293b;
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
      transition: all 0.2s ease;
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    /* Mobile Bottom Tab Bar */
    .mobile-tabbar {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 60px;
      background: rgba(16, 18, 22, 0.94);
      backdrop-filter: blur(16px);
      border-top: 1px solid var(--border);
      z-index: 45;
      justify-content: space-around;
      align-items: center;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      cursor: pointer;
    }
    .tab-btn.active { color: #60a5fa; }

    @media (max-width: 960px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed;
        inset: 0 0 60px 0;
        z-index: 35;
        display: none;
      }
      .sidebar.mobile-open { display: flex; }
      .reader-scroll {
        grid-template-columns: 1fr;
        padding: 20px 18px 90px;
      }
      .toc-rail { display: none; }
      .mobile-tabbar { display: flex; }
      .client-grid { grid-template-columns: 1fr; }
    }

    @media print {
      html, body { height: auto; overflow: visible; background: #fff; color: #000; }
      .sidebar, .reader-toolbar, .audio-bar, .toc-rail, .mobile-tabbar, .modal-backdrop { display: none !important; }
      .app-shell, .main-pane, .reader-scroll { display: block; height: auto; overflow: visible; padding: 0; margin: 0; }
      .md-article h1, .md-article h2, .md-article h3, .md-article strong { color: #000; }
      .md-article p, .md-article li { color: #222; }
      .ts-chip { border-color: #888; color: #222; background: #f3f4f6; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <!-- Left Sidebar -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="brand">
          <span class="brand-mark"></span>
          <span>LECTERN</span>
          <span class="brand-sub">v1.0</span>
        </div>
        <button class="btn btn-primary" onclick="openRecorderModal()">🎙️ 새 강의 녹음</button>
      </div>

      <div class="search-box">
        <input type="search" id="search-input" class="search-input" placeholder="강의 제목, 과목, 핵심 이론 검색 (⌘K)" />
      </div>

      <div class="course-pills" id="course-pills"></div>

      <div class="lecture-list" id="lecture-list"></div>

      <div class="sidebar-footer">
        <button class="btn" onclick="openClientsModal()">📱 네이티브·단축어</button>
        <button class="btn" onclick="openSettingsModal()">🔑 API 설정</button>
      </div>
    </aside>

    <!-- Main Reader Area -->
    <main class="main-pane">
      <header class="reader-toolbar">
        <div class="toolbar-meta" id="toolbar-meta">
          <span class="meta-pill course" id="cur-course">강의 선택</span>
          <span class="meta-pill" id="cur-date">—</span>
          <span class="meta-pill" id="cur-model">gemini-flash-latest</span>
        </div>
        <div class="toolbar-actions">
          <button class="btn" id="btn-edit" onclick="toggleEditor()">✏️ 편집</button>
          <button class="btn" id="btn-md" onclick="downloadCurrentMarkdown()">⬇️ MD</button>
          <button class="btn" id="btn-pdf" onclick="window.print()">📄 PDF</button>
          <button class="btn btn-primary" id="btn-share" onclick="shareCurrentLecture()">🔗 공유</button>
        </div>
      </header>

      <div class="audio-bar" id="audio-bar">
        <span style="font-size:12px;font-weight:650;color:var(--text-secondary);">🎧 원본 오디오</span>
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
            <p style="color:var(--text-muted);">왼쪽 목록에서 강의 노트를 선택하거나 새 강의를 녹음/업로드하세요.</p>
          </article>
          <div class="editor-pane" id="editor-pane">
            <input type="text" id="edit-title" class="field-input" placeholder="강의 제목" />
            <input type="text" id="edit-course" class="field-input" placeholder="과목명" />
            <textarea id="edit-markdown" class="editor-textarea"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button class="btn" onclick="toggleEditor(false)">취소</button>
              <button class="btn btn-primary" onclick="saveMarkdownEdit()">💾 저장</button>
            </div>
          </div>
        </div>
        <nav class="toc-rail" id="toc-rail">
          <div class="toc-title">목차 (On this page)</div>
          <div id="toc-list"></div>
        </nav>
      </div>
    </main>
  </div>

  <!-- Mobile Bottom Tab Bar -->
  <nav class="mobile-tabbar">
    <button class="tab-btn" id="tab-list" onclick="switchMobileTab('list')">
      <span>📚</span><span>목록</span>
    </button>
    <button class="tab-btn active" id="tab-reader" onclick="switchMobileTab('reader')">
      <span>📖</span><span>노트 리더</span>
    </button>
    <button class="tab-btn" onclick="openRecorderModal()">
      <span>🎙️</span><span>녹음/업로드</span>
    </button>
    <button class="tab-btn" onclick="openClientsModal()">
      <span>📱</span><span>기기 연동</span>
    </button>
  </nav>

  <!-- Recorder & Upload Modal -->
  <div class="modal-backdrop" id="recorder-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">🎙️ 실시간 강의 녹음 & 오디오 증류</div>
        <button class="btn" onclick="closeModal('recorder-modal')">✕</button>
      </div>

      <label class="field-label">과목명 (Course)</label>
      <input type="text" id="rec-course" class="field-input" placeholder="예: 정보보호개론, 자바프로그래밍, 영어읽기와토론" value="정보보호개론" />
      <div id="quick-course-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"></div>

      <div class="rec-visualizer-wrap">
        <canvas id="rec-canvas" class="rec-canvas" width="480" height="86"></canvas>
        <div class="rec-timer" id="rec-timer">00:00</div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <button class="btn btn-primary" id="btn-rec-start" style="flex:1;padding:10px;" onclick="toggleMicRecording()">🔴 마이크 녹음 시작</button>
        <button class="btn" id="btn-rec-pause" style="display:none;" onclick="pauseResumeRecording()">⏸ 일시정지</button>
      </div>

      <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()">
        <div style="font-weight:650;margin-bottom:4px;">📂 또는 녹음 파일 드래그 앤 드롭 / 클릭하여 선택</div>
        <div style="font-size:12px;">지원 포맷: .m4a (아이폰/맥 음성메모), .mp3, .webm, .wav, .ogg (최대 200MB)</div>
        <input type="file" id="file-input" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" style="display:none" onchange="handleFileSelect(this.files)" />
      </div>

      <div id="ingest-status" style="margin-top:12px;font-size:12.5px;color:#60a5fa;display:none;"></div>
    </div>
  </div>

  <!-- Native Clients & Shortcuts Modal -->
  <div class="modal-backdrop" id="clients-modal">
    <div class="modal-card" style="max-width:640px;">
      <div class="modal-header">
        <div class="modal-title">📱 멀티플랫폼 네이티브 & 퀵액션 연동</div>
        <button class="btn" onclick="closeModal('clients-modal')">✕</button>
      </div>
      <p style="margin:0 0 12px;color:var(--text-muted);font-size:13px;">
        어느 기기에서 녹음하든 쉬는시간·방치녹음이 자동 제거된 뒤 이 리더 화면에 즉시 동기화됩니다.
      </p>
      <div class="client-grid">
        <div class="client-box">
          <h4> macOS 상단 메뉴바 앱 (Native SwiftUI/AppKit)</h4>
          <p><code>NSStatusItem</code> 상단바 상주 · <code>⌥Space</code> 글로벌 핫키 무오버헤드 HE-AAC 녹음 및 네이티브 마크다운 리더 팝오버.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/Lectern-macOS-arm64.zip" target="_blank">⬇️ Lectern.app 다운로드</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/macos" target="_blank">소스 ↗</a>
          </div>
        </div>
        <div class="client-box">
          <h4>📱 iOS 단축어 / 뒷면 탭 / 액션 버튼</h4>
          <p>음성 메모 공유 시트 또는 액션 버튼으로 <code>POST /api/ingest/shortcut</code> 즉시 전송 후 노트 자동 오픈.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="/api/clients/ios-shortcut" download="lectern-ios-shortcut.json">⬇️ 단축어 레시피</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/ios" target="_blank">SwiftUI 소스 ↗</a>
          </div>
        </div>
        <div class="client-box">
          <h4>🤖 Android Jetpack Compose + 퀵세팅 타일</h4>
          <p>100% 네이티브 Compose 마크다운 리더·녹음기 + 상단 퀵세팅 패널 타일(<code>LecternTileService</code>) 원탭 녹음.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/Lectern-android-universal.apk" target="_blank">⬇️ APK 다운로드</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/android" target="_blank">소스 ↗</a>
          </div>
        </div>
        <div class="client-box">
          <h4>🪟 Windows 시스템 트레이 & 네이티브 리더 (.NET 8)</h4>
          <p>시스템 트레이 상주 + 글로벌 핫키(<code>Alt+Shift+R</code>) 즉시 녹음 & 네이티브 다크모드 마크다운 리더.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/LecternTray-win-x64.exe" target="_blank">⬇️ Windows EXE 다운로드</a>
            <a class="btn" href="https://github.com/eunhhu/lectern/tree/main/apps/windows" target="_blank">소스 ↗</a>
          </div>
        </div>
      </div>
      <div style="margin-top:14px;padding:12px;border-radius:9px;background:#0b0d11;border:1px solid var(--border);font-size:12px;">
        <div style="font-weight:650;color:#fff;margin-bottom:4px;">⚡ 원클릭 HTTP Ingest API (cURL / 단축어 / 서드파티 연동)</div>
        <code style="display:block;white-space:pre-wrap;color:#93c5fd;">curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\
  -H "X-Course: 정보보호개론" \\
  -F "audio=@20261014_lecture.m4a"</code>
      </div>
    </div>
  </div>

  <!-- Settings (BYOK) Modal -->
  <div class="modal-backdrop" id="settings-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">🔑 Gemini API & 모델 설정</div>
        <button class="btn" onclick="closeModal('settings-modal')">✕</button>
      </div>
      <label class="field-label">요약 모델 (기본: gemini-flash-latest → 최신 Flash 자동 매핑)</label>
      <input type="text" id="cfg-model" class="field-input" value="gemini-flash-latest" />
      <label class="field-label">개인 Gemini API Key (선택 · 비워두면 서버 기본 키 사용)</label>
      <input type="password" id="cfg-apikey" class="field-input" placeholder="AIzaSy... (브라우저 로컬 스토리지에만 저장됨)" />
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-primary" onclick="saveSettings()">저장</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let lectures = [];
    let currentLecture = null;
    let activeCourse = 'ALL';
    let searchQuery = '';

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
      const res = await fetch('/api/lectures?' + params.toString());
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
        listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">조건에 맞는 강의 노트가 없습니다.</div>';
        return;
      }
      listEl.innerHTML = lectures.map(item => {
        const isAct = currentLecture && currentLecture.id === item.id;
        const progHtml = item.status === 'processing'
          ? '<div class="card-progress"><div class="card-progress-bar" style="width:' + (item.progress || 15) + '%"></div></div><div style="font-size:11px;color:#60a5fa;margin-top:4px;">⚡ ' + (item.stage_message || '분석 중...') + '</div>'
          : '';
        return '<div class="lecture-card ' + (isAct ? 'active' : '') + '" onclick="selectLecture(\\'' + item.id + '\\', true)">' +
          '<div class="card-top">' +
            '<span class="card-course">' + escapeClientHtml(item.course) + '</span>' +
            '<span class="card-date">' + escapeClientHtml(item.date_label) + '</span>' +
          '</div>' +
          '<div class="card-title">' + escapeClientHtml(item.title) + '</div>' +
          '<div class="card-excerpt">' + escapeClientHtml(item.excerpt || '') + '</div>' +
          progHtml +
        '</div>';
      }).join('');
    }

    function escapeClientHtml(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function selectLecture(id, closeMobileList) {
      const res = await fetch('/api/lectures/' + encodeURIComponent(id));
      if (!res.ok) return;
      const data = await res.json();
      currentLecture = data.lecture;
      renderLectureList();

      document.getElementById('cur-course').textContent = currentLecture.course;
      document.getElementById('cur-date').textContent = currentLecture.date_label;
      document.getElementById('cur-model').textContent = currentLecture.model_used || 'gemini-flash-latest';

      const audioBar = document.getElementById('audio-bar');
      const audioEl = document.getElementById('lecture-audio');
      if (currentLecture.has_audio) {
        audioBar.classList.add('visible');
        const targetSrc = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/audio';
        if (!audioEl.src.endsWith(targetSrc)) {
          audioEl.src = targetSrc;
        }
      } else {
        audioBar.classList.remove('visible');
        audioEl.removeAttribute('src');
      }

      const art = document.getElementById('md-article');
      if (currentLecture.status === 'processing') {
        art.innerHTML = '<div style="padding:48px 20px;text-align:center;">' +
          '<div style="font-size:18px;font-weight:700;margin-bottom:8px;">⚡ ' + escapeClientHtml(currentLecture.stage_message || '강의 오디오 증류 중...') + '</div>' +
          '<div style="color:var(--text-muted);font-size:13.5px;">쉬는 시간과 불필요한 잡담을 걸러내고 핵심 이론을 구조화하고 있습니다. 완료되면 자동으로 표시됩니다.</div>' +
        '</div>';
        pollProcessingLecture(currentLecture.id);
      } else if (currentLecture.status === 'error') {
        art.innerHTML = '<div style="padding:36px;color:#fca5a5;">❌ 분석 오류: ' + escapeClientHtml(currentLecture.error_message || '알 수 없는 오류') + '</div>';
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

    function pollProcessingLecture(id) {
      clearTimeout(window.__pollTimer);
      window.__pollTimer = setTimeout(async () => {
        await fetchLectures(id);
      }, 2200);
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
        showToast('⏱ 오디오 ' + chip.textContent.replace('⏱', '').trim() + ' 지점으로 이동');
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, course, markdown })
      });
      if (res.ok) {
        showToast('✅ 강의 노트가 저장되었습니다.');
        await fetchLectures(currentLecture.id);
      }
    }

    function downloadCurrentMarkdown() {
      if (!currentLecture) return;
      window.location.href = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/markdown';
    }

    async function shareCurrentLecture() {
      if (!currentLecture) return;
      const shareUrl = location.origin + '/s/' + currentLecture.share_token;
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('🔗 공유 링크 복사 완료! (' + shareUrl + ')');
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
      showToast('🔑 설정이 저장되었습니다.');
    }

    function switchMobileTab(tab) {
      const sb = document.getElementById('sidebar');
      document.getElementById('tab-list').classList.toggle('active', tab === 'list');
      document.getElementById('tab-reader').classList.toggle('active', tab === 'reader');
      sb.classList.toggle('mobile-open', tab === 'list');
    }

    // Live Web Microphone Recorder with Waveform & WakeLock
    let mediaRecorder = null;
    let recChunks = [];
    let recStartTime = 0;
    let recTimerInterval = null;
    let audioCtx = null;
    let analyser = null;
    let animFrame = null;
    let wakeLock = null;

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
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) recChunks.push(ev.data);
        };
        mediaRecorder.onstop = async () => {
          cancelAnimationFrame(animFrame);
          clearInterval(recTimerInterval);
          stream.getTracks().forEach(t => t.stop());
          if (wakeLock) { try { await wakeLock.release(); } catch {} wakeLock = null; }

          document.getElementById('btn-rec-start').textContent = '🔴 마이크 녹음 시작';
          document.getElementById('btn-rec-start').classList.remove('btn-danger');
          document.getElementById('btn-rec-pause').style.display = 'none';

          const ext = (mediaRecorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
          const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          const file = new File([blob], 'lecture_' + Date.now() + '.' + ext, { type: blob.type });
          await uploadAndDistillFile(file, 'web-mic');
        };

        mediaRecorder.start(1000);
        recStartTime = Date.now();
        document.getElementById('btn-rec-start').textContent = '⏹ 녹음 종료 및 노트 요약 시작';
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
        btn.textContent = '▶️ 재개';
      } else if (mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        btn.textContent = '⏸ 일시정지';
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
        ctx.fillStyle = '#0b0d11';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const barW = (canvas.width / bufLen) * 1.6;
        let x = 0;
        for (let i = 0; i < bufLen; i++) {
          const v = data[i] / 255;
          const h = Math.max(4, v * (canvas.height - 12));
          ctx.fillStyle = v > 0.6 ? '#60a5fa' : '#3b82f6';
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

    async function uploadAndDistillFile(file, sourceClient) {
      const course = document.getElementById('rec-course').value.trim() || '대학교 전공 강의';
      const model = localStorage.getItem('lectern_model') || 'gemini-flash-latest';
      const apiKey = localStorage.getItem('lectern_apikey') || '';

      const statusEl = document.getElementById('ingest-status');
      statusEl.style.display = 'block';
      statusEl.textContent = '🚀 오디오 업로드 중 (' + (file.size / 1048576).toFixed(1) + ' MB)...';

      const form = new FormData();
      form.append('audio', file);
      form.append('course', course);
      form.append('model', model);
      form.append('source', sourceClient);

      const headers = {};
      if (apiKey) headers['X-Gemini-Key'] = apiKey;

      const res = await fetch('/api/lectures/ingest', {
        method: 'POST',
        headers,
        body: form
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = '❌ 오류: ' + (data.error || '업로드 실패');
        return;
      }

      statusEl.style.display = 'none';
      closeModal('recorder-modal');
      showToast('⚡ 강의 오디오 증류가 시작되었습니다!');
      await fetchLectures(data.lecture.id);
    }

    fetchLectures();
  </script>
</body>
</html>`;
}
