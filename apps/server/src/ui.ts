import { escapeHtml, renderMarkdownToHtml } from "@lectern/core";
import type { LectureRecord } from "./db.ts";

/**
 * Elysium Design System v1.0 — Official Token & Typography Registry
 * Source: Elysium Design Library (2026-09-30, Section 3, 4, 5, 8, 12.1)
 * Neutral Policy: CoolNeutral single neutral family + Blue/40 (#5650FF) Action Primary
 */
export const ELYSIUM_TOKENS_CSS = `
:root,
[data-elysium-theme="Light"],
[data-theme="light"] {
  --elysium-font-sans: "Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --elysium-font-mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;

  /* Spacing Scale (Section 5.1) */
  --elysium-space-0: 0px;
  --elysium-space-2: 2px;
  --elysium-space-4: 4px;
  --elysium-space-8: 8px;
  --elysium-space-12: 12px;
  --elysium-space-16: 16px;
  --elysium-space-20: 20px;
  --elysium-space-24: 24px;
  --elysium-space-32: 32px;
  --elysium-space-40: 40px;
  --elysium-space-48: 48px;
  --elysium-space-64: 64px;

  /* Radius Scale (Section 5.3) */
  --elysium-radius-4: 4px;
  --elysium-radius-8: 8px;
  --elysium-radius-12: 12px;
  --elysium-radius-16: 16px;
  --elysium-radius-24: 24px;
  --elysium-radius-pill: 999px;

  /* Control & Layout Metrics (Section 5.2) */
  --elysium-size-control-sm: 32px;
  --elysium-size-control-md: 40px;
  --elysium-size-control-lg: 48px;
  --elysium-size-touch-min: 48px;
  --elysium-size-button-mobile: 56px;
  --elysium-size-container-max: 1200px;

  /* Semantic Color Tokens — Light Mode (Neutral Surface + Subtle Borders) */
  --elysium-surface-canvas: #F8F9FA;
  --elysium-surface-default: #FFFFFF;
  --elysium-surface-subtle: #F2F4F7;
  --elysium-surface-elevated: #FFFFFF;
  --elysium-surface-inverse: #111827;

  --elysium-text-primary: #111827;
  --elysium-text-secondary: #4B5563;
  --elysium-text-tertiary: #6B7280;
  --elysium-text-disabled: #9CA3AF;
  --elysium-text-on-action: #FFFFFF;
  --elysium-text-brand: #4F46E5;

  --elysium-border-subtle: #EAECF0;
  --elysium-border-control: #DFE3E8;
  --elysium-border-focus: #4F46E5;

  --elysium-action-primary: #4F46E5;
  --elysium-action-primary-hover: #4338CA;
  --elysium-action-primary-pressed: #3730A3;
  --elysium-action-subtle: #EEF2FF;
  --elysium-action-subtle-hover: #E0E7FF;
  --elysium-action-subtle-pressed: #C7D2FE;
  --elysium-action-disabled: #EAECF0;

  --elysium-status-success-text: #15803D;
  --elysium-status-success-surface: #DCFCE7;
  --elysium-status-success-icon: #16A34A;
  --elysium-status-warning-text: #B45309;
  --elysium-status-warning-surface: #FEF3C7;
  --elysium-status-warning-icon: #D97706;
  --elysium-status-danger-text: #B91C1C;
  --elysium-status-danger-surface: #FEE2E2;
  --elysium-status-danger-icon: #DC2626;
  --elysium-status-danger-action: #DC2626;
  --elysium-status-info-text: #1D4ED8;
  --elysium-status-info-surface: #DBEAFE;
  --elysium-status-info-icon: #2563EB;

  --elysium-shadow-sm: 0 1px 3px rgba(17, 24, 39, 0.04);
  --elysium-shadow-md: 0 6px 18px rgba(17, 24, 39, 0.07);
  --elysium-shadow-lg: 0 20px 44px rgba(17, 24, 39, 0.12);

  /* Compatibility aliases */
  --surface-canvas: var(--elysium-surface-canvas);
  --surface-default: var(--elysium-surface-default);
  --surface-subtle: var(--elysium-surface-subtle);
  --surface-elevated: var(--elysium-surface-elevated);
  --text-primary: var(--elysium-text-primary);
  --text-secondary: var(--elysium-text-secondary);
  --text-tertiary: var(--elysium-text-tertiary);
  --action-primary: var(--elysium-action-primary);
  --border-subtle: var(--elysium-border-subtle);
  --border-control: var(--elysium-border-control);
  --border-focus: var(--elysium-border-focus);
}

[data-elysium-theme="Dark"],
[data-theme="dark"] {
  /* Semantic Color Tokens — Dark Mode (Neutral Dark Surface + Subtle Borders) */
  --elysium-surface-canvas: #111214;
  --elysium-surface-default: #17181C;
  --elysium-surface-subtle: #212329;
  --elysium-surface-elevated: #1D1F25;
  --elysium-surface-inverse: #F3F4F6;

  --elysium-text-primary: #F3F4F6;
  --elysium-text-secondary: #9CA3AF;
  --elysium-text-tertiary: #6B7280;
  --elysium-text-disabled: #4B5563;
  --elysium-text-on-action: #FFFFFF;
  --elysium-text-brand: #818CF8;

  --elysium-border-subtle: #252830;
  --elysium-border-control: #2E323C;
  --elysium-border-focus: #6366F1;

  --elysium-action-primary: #4F46E5;
  --elysium-action-primary-hover: #6366F1;
  --elysium-action-primary-pressed: #4338CA;
  --elysium-action-subtle: rgba(79, 70, 229, 0.16);
  --elysium-action-subtle-hover: rgba(99, 102, 241, 0.24);
  --elysium-action-subtle-pressed: rgba(99, 102, 241, 0.32);
  --elysium-action-disabled: #252830;

  --elysium-status-success-text: #B0F4B2;
  --elysium-status-success-surface: #053C01;
  --elysium-status-success-icon: #69E572;
  --elysium-status-warning-text: #FFDDA5;
  --elysium-status-warning-surface: #470E00;
  --elysium-status-warning-icon: #FFBE5B;
  --elysium-status-danger-text: #FECACA;
  --elysium-status-danger-surface: #7F1D1D;
  --elysium-status-danger-icon: #FCA5A5;
  --elysium-status-danger-action: #DC2626;
  --elysium-status-info-text: #C0E1FF;
  --elysium-status-info-surface: #072D53;
  --elysium-status-info-icon: #8CCBFF;

  --elysium-shadow-sm: 0 2px 10px rgba(0, 0, 0, 0.32);
  --elysium-shadow-md: 0 10px 28px rgba(0, 0, 0, 0.45);
  --elysium-shadow-lg: 0 24px 56px rgba(0, 0, 0, 0.62);
}

*, *::before, *::after {
  box-sizing: border-box;
}

/* Official Elysium Typography Scale (Section 4.1 & 12.1) */
.elysium-title-large { font: 700 40px/52px var(--elysium-font-sans); letter-spacing: -0.015em; }
.elysium-title-medium { font: 700 32px/44px var(--elysium-font-sans); letter-spacing: -0.01em; }
.elysium-title-small { font: 700 28px/38px var(--elysium-font-sans); letter-spacing: -0.01em; }
.elysium-heading-large { font: 700 24px/34px var(--elysium-font-sans); letter-spacing: -0.005em; }
.elysium-heading-medium { font: 600 20px/30px var(--elysium-font-sans); letter-spacing: -0.003em; }
.elysium-heading-small { font: 600 18px/28px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-body-large { font: 400 18px/28px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-body-medium { font: 400 16px/24px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-body-small { font: 400 14px/22px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-reading-large { font: 400 18px/30px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-reading-medium { font: 400 16px/28px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-label-large { font: 600 16px/24px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-label-medium { font: 600 14px/20px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-label-small { font: 600 13px/20px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-caption { font: 400 12px/18px var(--elysium-font-sans); letter-spacing: 0; }
.elysium-code { font: 500 14px/20px var(--elysium-font-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; }
`;

export function renderSharePageHtml(lecture: LectureRecord): string {
  const rendered = renderMarkdownToHtml(lecture.markdown || "");
  const title = escapeHtml(lecture.title);
  const course = escapeHtml(lecture.course);
  const hasAudio = Boolean(lecture.audio_path);

  return `<!DOCTYPE html>
<html lang="ko" data-elysium-theme="Light" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${title} — ${course} | Lectern</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    ${ELYSIUM_TOKENS_CSS}
    html, body {
      margin: 0;
      padding: 0;
      background: var(--elysium-surface-canvas);
      color: var(--elysium-text-primary);
      font-family: var(--elysium-font-sans);
      font-size: 16px;
      line-height: 24px;
      -webkit-font-smoothing: antialiased;
    }
    .share-topbar {
      position: sticky;
      top: 0;
      z-index: 30;
      height: 72px;
      padding: 0 var(--elysium-space-48);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--elysium-surface-default);
      border-bottom: 1px solid var(--elysium-border-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-12);
      font: 700 20px/30px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      text-decoration: none;
    }
    .brand-mark {
      width: 12px;
      height: 12px;
      border-radius: var(--elysium-radius-pill);
      background: var(--elysium-action-primary);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-12);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--elysium-space-8);
      height: var(--elysium-size-control-md);
      padding: 0 var(--elysium-space-16);
      border-radius: var(--elysium-radius-12);
      border: 1px solid var(--elysium-border-control);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      font: 600 14px/20px var(--elysium-font-sans);
      cursor: pointer;
      text-decoration: none;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .btn:hover { background: var(--elysium-surface-subtle); }
    .btn-primary {
      background: var(--elysium-action-primary);
      border-color: var(--elysium-action-primary);
      color: var(--elysium-text-on-action);
      font: 600 16px/24px var(--elysium-font-sans);
    }
    .btn-primary:hover {
      background: var(--elysium-action-primary-hover);
      border-color: var(--elysium-action-primary-hover);
    }
    .container {
      max-width: 920px;
      margin: 0 auto;
      padding: var(--elysium-space-48) var(--elysium-space-48) var(--elysium-space-64);
    }
    .article-card {
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-24);
      padding: var(--elysium-space-48);
      box-shadow: var(--elysium-shadow-sm);
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--elysium-space-12);
      align-items: center;
      margin-bottom: var(--elysium-space-24);
    }
    .badge {
      padding: 6px 14px;
      border-radius: var(--elysium-radius-pill);
      font: 600 13px/20px var(--elysium-font-sans);
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
      font-variant-numeric: tabular-nums;
    }
    .badge-muted {
      background: var(--elysium-surface-subtle);
      color: var(--elysium-text-secondary);
    }
    .audio-bar {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-16);
      padding: var(--elysium-space-20) var(--elysium-space-24);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      margin-bottom: var(--elysium-space-32);
    }
    .audio-bar audio { flex: 1; height: 40px; }
    .md-body h1, .md-body h2, .md-body h3, .md-body h4 {
      word-break: keep-all;
      overflow-wrap: break-word;
      color: var(--elysium-text-primary);
    }
    .md-body h1 {
      font: 700 32px/44px var(--elysium-font-sans);
      letter-spacing: -0.01em;
      margin: 0 0 var(--elysium-space-32);
      padding-bottom: var(--elysium-space-24);
      border-bottom: 1px solid var(--elysium-border-subtle);
    }
    .md-body h2 {
      font: 700 24px/34px var(--elysium-font-sans);
      letter-spacing: -0.005em;
      margin: var(--elysium-space-40) 0 var(--elysium-space-16);
    }
    .md-body h3 {
      font: 600 20px/30px var(--elysium-font-sans);
      letter-spacing: -0.003em;
      margin: var(--elysium-space-32) 0 var(--elysium-space-12);
    }
    .md-body p, .md-body li {
      font: 400 16px/28px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
    }
    .md-body p { margin: 0 0 var(--elysium-space-16); }
    .md-body ul, .md-body ol { padding-left: 24px; margin: var(--elysium-space-16) 0; }
    .md-body li { margin: 10px 0; }
    .md-body strong { color: var(--elysium-text-primary); font-weight: 700; }
    .md-body code {
      font-family: var(--elysium-font-mono);
      font-size: 14px;
      padding: 2px 8px;
      border-radius: var(--elysium-radius-4);
      background: var(--elysium-surface-subtle);
      color: var(--elysium-text-brand);
    }
    .md-code {
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-radius: var(--elysium-radius-12);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      overflow-x: auto;
      margin: var(--elysium-space-20) 0;
    }
    .md-code code { background: none; padding: 0; color: var(--elysium-text-primary); }
    .md-quote {
      margin: var(--elysium-space-24) 0;
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-left: 4px solid var(--elysium-action-primary);
      background: var(--elysium-action-subtle);
      border-radius: 0 var(--elysium-radius-12) var(--elysium-radius-12) 0;
      word-break: keep-all;
    }
    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      margin: 0 4px 0 0;
      border-radius: var(--elysium-radius-8);
      border: 1px solid var(--elysium-border-subtle);
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
      font: 600 13px/20px var(--elysium-font-mono);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .filter-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: var(--elysium-radius-pill);
      font: 600 13px/20px var(--elysium-font-sans);
      font-variant-numeric: tabular-nums;
    }
    .filter-break { background: var(--elysium-status-warning-surface); color: var(--elysium-status-warning-text); }
    .filter-cut { background: var(--elysium-status-success-surface); color: var(--elysium-status-success-text); }
    @media (max-width: 768px) {
      .share-topbar { padding: 0 var(--elysium-space-20); }
      .container { padding: var(--elysium-space-24) var(--elysium-space-20); }
      .article-card { padding: var(--elysium-space-24); }
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
    <div class="article-card">
      <div class="meta-bar">
        <span class="badge">${course}</span>
        <span class="badge badge-muted">${escapeHtml(lecture.date_label)}</span>
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
    </div>
  </main>
  <script>
    const savedTheme = localStorage.getItem('lectern_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-elysium-theme', savedTheme === 'dark' ? 'Dark' : 'Light');
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      document.documentElement.setAttribute('data-elysium-theme', cur === 'dark' ? 'Dark' : 'Light');
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
<html lang="ko" data-elysium-theme="Light" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="theme-color" content="#F8F6FF" />
  <title>Lectern — 강의 녹음 증류 & 마크다운 리더</title>
  <link rel="manifest" href="/manifest.json" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    ${ELYSIUM_TOKENS_CSS}

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--elysium-surface-canvas);
      color: var(--elysium-text-primary);
      font-family: var(--elysium-font-sans);
      font-size: 16px;
      line-height: 24px;
      letter-spacing: 0;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }

    /* App Shell: 400px Library Sidebar + Spacious Reader Canvas */
    .app-shell {
      display: grid;
      grid-template-columns: 400px 1fr;
      height: 100vh;
      width: 100vw;
      background: var(--elysium-surface-canvas);
    }

    /* Sidebar — Elysium Surface/Default + Space/24 Rhythm */
    .sidebar {
      display: flex;
      flex-direction: column;
      background: var(--elysium-surface-default);
      border-right: 1px solid var(--elysium-border-subtle);
      height: 100vh;
      overflow: hidden;
    }

    .sidebar-top {
      padding: var(--elysium-space-24) var(--elysium-space-24) var(--elysium-space-20);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-20);
      border-bottom: 1px solid var(--elysium-border-subtle);
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-12);
      font: 700 22px/30px var(--elysium-font-sans);
      letter-spacing: -0.01em;
      color: var(--elysium-text-primary);
    }
    .brand-mark {
      width: 12px;
      height: 12px;
      border-radius: var(--elysium-radius-pill);
      background: var(--elysium-action-primary);
      box-shadow: 0 0 0 4px var(--elysium-action-subtle);
    }
    .brand-sub {
      font: 600 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-brand);
      background: var(--elysium-action-subtle);
      padding: 2px 10px;
      border-radius: var(--elysium-radius-pill);
      font-variant-numeric: tabular-nums;
    }

    /* Elysium/Desktop/Button (8186:3842) — PC H40 / Mobile H56, Radius 12, Padding 0 16, Gap 8 */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--elysium-space-8);
      height: var(--elysium-size-control-md);
      padding: 0 var(--elysium-space-16);
      border-radius: var(--elysium-radius-12);
      border: 1px solid var(--elysium-border-control);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      font: 600 14px/20px var(--elysium-font-sans);
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      white-space: nowrap;
      text-decoration: none;
    }
    .btn:hover {
      background: var(--elysium-surface-subtle);
    }
    .btn:focus-visible {
      outline: 2px solid var(--elysium-border-focus);
      outline-offset: 2px;
    }
    .btn-primary {
      background: var(--elysium-action-primary);
      border-color: var(--elysium-action-primary);
      color: var(--elysium-text-on-action);
      font: 600 16px/24px var(--elysium-font-sans);
    }
    .btn-primary:hover {
      background: var(--elysium-action-primary-hover);
      border-color: var(--elysium-action-primary-hover);
    }
    .btn-primary:active {
      background: var(--elysium-action-primary-pressed);
      border-color: var(--elysium-action-primary-pressed);
    }
    .btn-lg {
      height: var(--elysium-size-control-lg);
      padding: 0 var(--elysium-space-20);
      font: 600 16px/24px var(--elysium-font-sans);
    }
    .btn-subtle {
      background: var(--elysium-surface-subtle);
      border-color: var(--elysium-border-subtle);
      color: var(--elysium-text-primary);
    }
    .btn-subtle:hover {
      background: var(--elysium-action-subtle);
      border-color: var(--elysium-border-focus);
      color: var(--elysium-text-brand);
    }
    .btn-danger {
      background: var(--elysium-status-danger-surface);
      border-color: var(--elysium-status-danger-text);
      color: var(--elysium-status-danger-text);
    }
    .btn-icon {
      width: var(--elysium-size-control-md);
      padding: 0;
    }
    .icon-svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      stroke-width: 1.85;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
      flex-shrink: 0;
    }

    /* Elysium/Desktop/TextField (8186:3894) — External Label + H40 Input + Radius 8 + Border/Control */
    .field-group {
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-8);
    }
    .field-label {
      display: block;
      font: 600 14px/20px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
    }
    .field-input, .search-input {
      width: 100%;
      height: var(--elysium-size-control-md);
      padding: 8px 14px;
      border-radius: var(--elysium-radius-8);
      border: 1px solid var(--elysium-border-control);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      font: 400 16px/24px var(--elysium-font-sans);
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    .field-input::placeholder, .search-input::placeholder {
      color: var(--elysium-text-disabled);
    }
    .field-input:focus, .search-input:focus {
      border-color: var(--elysium-border-focus);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.14);
    }

    /* Elysium/Desktop/Chip (8186:4067) — Filter Chip H40, Radius 999, Padding 0 16, Gap 8 */
    .course-pills {
      display: flex;
      gap: var(--elysium-space-8);
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 2px;
    }
    .course-pills::-webkit-scrollbar { display: none; }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: var(--elysium-size-control-md);
      padding: 0 var(--elysium-space-16);
      border-radius: var(--elysium-radius-pill);
      font: 600 14px/20px var(--elysium-font-sans);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      border: 1px solid var(--elysium-border-control);
      cursor: pointer;
      white-space: nowrap;
      transition: all 150ms ease;
    }
    .pill:hover {
      background: var(--elysium-surface-subtle);
    }
    .pill.active {
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
      border-color: var(--elysium-border-focus);
    }

    /* Elysium/Desktop/ListRow (8186:4263) & Card (8186:4226) — Spacious Lecture List */
    .lecture-list {
      flex: 1;
      overflow-y: auto;
      padding: var(--elysium-space-20) var(--elysium-space-24);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-12);
      background: var(--elysium-surface-canvas);
    }

    .lecture-card {
      padding: var(--elysium-space-20);
      border-radius: var(--elysium-radius-16);
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-8);
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }
    .lecture-card:hover {
      border-color: var(--elysium-border-control);
      box-shadow: var(--elysium-shadow-sm);
    }
    .lecture-card.active {
      background: var(--elysium-action-subtle);
      border: 1.5px solid var(--elysium-border-focus);
      padding: 19.5px;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--elysium-space-8);
    }
    .card-course {
      font: 600 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-brand);
    }
    .card-date {
      font: 400 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .card-title {
      font: 600 16px/24px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-excerpt {
      font: 400 14px/22px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-progress {
      margin-top: var(--elysium-space-4);
      height: 6px;
      background: var(--elysium-surface-subtle);
      border-radius: var(--elysium-radius-pill);
      overflow: hidden;
    }
    .card-progress-bar {
      height: 100%;
      background: var(--elysium-action-primary);
      transition: width 250ms ease;
    }

    /* Sidebar Footer — Clean Profile & Workspace Bar */
    .sidebar-footer {
      padding: var(--elysium-space-16) var(--elysium-space-24);
      border-top: 1px solid var(--elysium-border-subtle);
      background: var(--elysium-surface-default);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-12);
    }
    .user-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--elysium-space-8);
    }
    .user-name {
      font: 600 14px/20px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .footer-actions {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--elysium-space-8);
    }
    .footer-actions .btn {
      padding: 0 var(--elysium-space-12);
      font: 600 13px/20px var(--elysium-font-sans);
    }

    /* Main Reader Pane */
    .main-pane {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--elysium-surface-canvas);
    }

    /* Reader Topbar — Height 76px, Desktop Horizontal Padding 48px */
    .reader-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--elysium-space-24);
      height: 76px;
      padding: 0 var(--elysium-space-48);
      border-bottom: 1px solid var(--elysium-border-subtle);
      background: var(--elysium-surface-default);
      flex-shrink: 0;
    }
    .toolbar-meta {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-12);
      overflow: hidden;
    }
    .meta-pill {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 14px;
      border-radius: var(--elysium-radius-pill);
      font: 600 13px/20px var(--elysium-font-sans);
      background: var(--elysium-surface-subtle);
      color: var(--elysium-text-secondary);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .meta-pill.course {
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-12);
    }

    /* Reader Scroll Area — Elysium Desktop Margin 48px, Column Gap 48px */
    .reader-scroll {
      flex: 1;
      overflow-y: auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: var(--elysium-space-48);
      padding: var(--elysium-space-48) var(--elysium-space-48) 96px;
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
    }

    /* Audio Player Card (Elysium/Desktop/Card 8186:4226 — Padding 24, Radius 16) */
    .audio-bar {
      display: none;
      align-items: center;
      gap: var(--elysium-space-16);
      padding: var(--elysium-space-20) var(--elysium-space-24);
      margin-bottom: var(--elysium-space-32);
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      box-shadow: var(--elysium-shadow-sm);
    }
    .audio-bar.visible { display: flex; }
    .audio-bar audio { flex: 1; height: 40px; }
    .speed-select {
      height: var(--elysium-size-control-md);
      padding: 0 14px;
      border-radius: var(--elysium-radius-8);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      border: 1px solid var(--elysium-border-control);
      font: 600 14px/20px var(--elysium-font-sans);
      font-variant-numeric: tabular-nums;
    }

    /* Lecture Document Surface Card — Spacious Reading Sheet */
    .document-sheet {
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-24);
      padding: var(--elysium-space-48);
      box-shadow: var(--elysium-shadow-sm);
      min-width: 0;
    }

    /* Markdown Article Typography (Elysium Section 4.1 Type Scale) */
    .md-article {
      min-width: 0;
      color: var(--elysium-text-primary);
    }
    .md-article h1, .md-article h2, .md-article h3, .md-article h4 {
      color: var(--elysium-text-primary);
      word-break: keep-all;
      overflow-wrap: break-word;
    }
    .md-article h1 {
      font: 700 32px/44px var(--elysium-font-sans);
      letter-spacing: -0.01em;
      margin: 0 0 var(--elysium-space-32);
      padding-bottom: var(--elysium-space-24);
      border-bottom: 1px solid var(--elysium-border-subtle);
    }
    .md-article h2 {
      font: 700 24px/34px var(--elysium-font-sans);
      letter-spacing: -0.005em;
      margin: var(--elysium-space-48) 0 var(--elysium-space-16);
      scroll-margin-top: 24px;
    }
    .md-article h3 {
      font: 600 20px/30px var(--elysium-font-sans);
      letter-spacing: -0.003em;
      margin: var(--elysium-space-32) 0 var(--elysium-space-12);
      scroll-margin-top: 24px;
    }
    .md-article h4 {
      font: 600 18px/28px var(--elysium-font-sans);
      margin: var(--elysium-space-24) 0 var(--elysium-space-8);
    }
    .md-article p, .md-article li {
      font: 400 16px/28px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
    }
    .md-article p {
      margin: 0 0 var(--elysium-space-16);
    }
    .md-article ul, .md-article ol {
      padding-left: 24px;
      margin: var(--elysium-space-12) 0 var(--elysium-space-24);
    }
    .md-article li { margin: 10px 0; }
    .md-article strong { color: var(--elysium-text-primary); font-weight: 700; }
    .md-article code {
      font-family: var(--elysium-font-mono);
      font-size: 14px;
      padding: 2px 8px;
      border-radius: var(--elysium-radius-4);
      background: var(--elysium-surface-subtle);
      color: var(--elysium-text-brand);
    }
    .md-code {
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-radius: var(--elysium-radius-12);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      overflow-x: auto;
      margin: var(--elysium-space-24) 0;
    }
    .md-code code { background: none; padding: 0; color: var(--elysium-text-primary); }
    .md-quote {
      margin: var(--elysium-space-24) 0;
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-left: 4px solid var(--elysium-action-primary);
      background: var(--elysium-action-subtle);
      border-radius: 0 var(--elysium-radius-12) var(--elysium-radius-12) 0;
      word-break: keep-all;
    }
    .md-quote p { margin: 6px 0; color: var(--elysium-text-primary); }
    .md-hr {
      border: 0;
      border-top: 1px solid var(--elysium-border-subtle);
      margin: var(--elysium-space-40) 0;
    }
    .md-table-wrap {
      overflow-x: auto;
      margin: var(--elysium-space-24) 0;
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-12);
    }
    .md-table {
      width: 100%;
      border-collapse: collapse;
      font: 400 14px/22px var(--elysium-font-sans);
    }
    .md-table th, .md-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--elysium-border-subtle);
      text-align: left;
    }
    .md-table th {
      background: var(--elysium-surface-subtle);
      color: var(--elysium-text-primary);
      font-weight: 600;
    }

    /* Interactive Timestamp Chips & Filter Callout Badges */
    .ts-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      margin: 0 6px 0 0;
      border-radius: var(--elysium-radius-8);
      border: 1px solid var(--elysium-border-subtle);
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
      font: 600 13px/20px var(--elysium-font-mono);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .ts-chip:hover {
      background: var(--elysium-action-subtle-hover);
      border-color: var(--elysium-border-focus);
    }
    .filter-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: var(--elysium-radius-pill);
      font: 600 13px/20px var(--elysium-font-sans);
      font-variant-numeric: tabular-nums;
      margin: 6px 0;
    }
    .filter-break { background: var(--elysium-status-warning-surface); color: var(--elysium-status-warning-text); }
    .filter-cut { background: var(--elysium-status-success-surface); color: var(--elysium-status-success-text); }

    /* Right Table of Contents Rail */
    .toc-rail {
      position: sticky;
      top: 0;
      align-self: start;
      padding: var(--elysium-space-24);
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      max-height: calc(100vh - 160px);
      overflow-y: auto;
    }
    .toc-title {
      font: 600 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-brand);
      margin-bottom: var(--elysium-space-16);
    }
    .toc-link {
      display: block;
      font: 400 14px/22px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      text-decoration: none;
      padding: 6px 0;
      line-height: 1.45;
      transition: color 150ms ease;
    }
    .toc-link:hover { color: var(--elysium-text-brand); }
    .toc-link.lvl-3 { padding-left: var(--elysium-space-16); font-size: 13px; }

    /* Markdown Editor View */
    .editor-pane {
      display: none;
      flex-direction: column;
      gap: var(--elysium-space-20);
    }
    .editor-pane.visible { display: flex; }
    .editor-textarea {
      width: 100%;
      min-height: 520px;
      padding: var(--elysium-space-20);
      border-radius: var(--elysium-radius-12);
      border: 1px solid var(--elysium-border-control);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      font: 400 15px/26px var(--elysium-font-mono);
      resize: vertical;
      outline: none;
    }
    .editor-textarea:focus {
      border-color: var(--elysium-border-focus);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.14);
    }

    /* Elysium/Desktop/Overlay (8186:4412) — PC W480~560, Radius 16, Padding 24, Gap 16 */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(25, 24, 30, 0.52);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--elysium-space-24);
    }
    .modal-backdrop.open { display: flex; }
    .modal-card {
      width: 100%;
      max-width: 520px;
      background: var(--elysium-surface-elevated);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      padding: var(--elysium-space-32);
      box-shadow: var(--elysium-shadow-lg);
      max-height: 90vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-20);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-title {
      font: 700 20px/30px var(--elysium-font-sans);
      letter-spacing: -0.003em;
      color: var(--elysium-text-primary);
    }

    /* Recorder Visualizer */
    .rec-visualizer-wrap {
      position: relative;
      height: 104px;
      border-radius: var(--elysium-radius-16);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .rec-canvas { width: 100%; height: 100%; display: block; }
    .rec-timer {
      position: absolute;
      right: 16px;
      top: 12px;
      font: 600 14px/20px var(--elysium-font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--elysium-status-danger-text);
      background: var(--elysium-status-danger-surface);
      padding: 4px 10px;
      border-radius: var(--elysium-radius-8);
    }

    .dropzone {
      border: 1.5px dashed var(--elysium-border-control);
      border-radius: var(--elysium-radius-16);
      padding: var(--elysium-space-24);
      text-align: center;
      color: var(--elysium-text-secondary);
      background: var(--elysium-surface-subtle);
      cursor: pointer;
      transition: all 150ms ease;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--elysium-border-focus);
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
    }

    /* Native Clients Grid */
    .client-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--elysium-space-16);
    }
    .client-box {
      padding: var(--elysium-space-24);
      border-radius: var(--elysium-radius-16);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-12);
    }
    .client-box h4 {
      margin: 0;
      font: 600 16px/24px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      word-break: keep-all;
    }
    .client-box p {
      margin: 0;
      font: 400 14px/22px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      word-break: keep-all;
      flex: 1;
    }

    /* Elysium/Desktop/Alert & Toast (8186:4167) — Padding 16, Gap 12, Radius 12 */
    .toast {
      position: fixed;
      bottom: var(--elysium-space-32);
      right: var(--elysium-space-32);
      z-index: 100;
      padding: var(--elysium-space-16) var(--elysium-space-20);
      border-radius: var(--elysium-radius-12);
      background: var(--elysium-surface-inverse);
      color: var(--elysium-surface-default);
      font: 600 14px/20px var(--elysium-font-sans);
      box-shadow: var(--elysium-shadow-md);
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
      transition: all 220ms ease;
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    /* Elysium/Mobile/Navigation (8186:3625) — Mobile Bottom Bar H64 + safe-area */
    .mobile-tabbar {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: calc(64px + env(safe-area-inset-bottom));
      background: var(--elysium-surface-default);
      border-top: 1px solid var(--elysium-border-subtle);
      z-index: 45;
      justify-content: space-around;
      align-items: center;
      padding: 0 var(--elysium-space-16) env(safe-area-inset-bottom);
    }
    .tab-btn {
      background: transparent;
      border: none;
      border-radius: var(--elysium-radius-12);
      color: var(--elysium-text-secondary);
      font: 600 12px/18px var(--elysium-font-sans);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
      min-width: 72px;
      height: 48px;
      padding: 4px 12px;
    }
    .tab-btn.active {
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
    }

    @media (max-width: 1024px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed;
        inset: 0 0 64px 0;
        z-index: 35;
        display: none;
      }
      .sidebar.mobile-open { display: flex; }
      .reader-toolbar {
        padding: 0 var(--elysium-space-20);
        height: 64px;
      }
      .reader-scroll {
        grid-template-columns: 1fr;
        padding: var(--elysium-space-20) var(--elysium-space-20) 104px;
        gap: var(--elysium-space-24);
      }
      .document-sheet {
        padding: var(--elysium-space-24);
        border-radius: var(--elysium-radius-16);
      }
      .toc-rail { display: none; }
      .mobile-tabbar { display: flex; }
      .client-grid { grid-template-columns: 1fr; }
      .btn { height: var(--elysium-size-touch-min); }
      .field-input, .search-input { height: var(--elysium-size-touch-min); }
    }

    /* Auth Gate — Elysium Card Spec (Padding 32, Radius 24, Gap 20) */
    .auth-gate {
      position: fixed;
      inset: 0;
      z-index: 90;
      background: var(--elysium-surface-canvas);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--elysium-space-24);
    }
    .auth-gate.hidden { display: none; }
    .auth-card {
      width: 100%;
      max-width: 440px;
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-24);
      padding: var(--elysium-space-40) var(--elysium-space-32);
      box-shadow: var(--elysium-shadow-lg);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-24);
    }
    .auth-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      border-bottom: 1px solid var(--elysium-border-subtle);
    }
    .auth-tab {
      height: var(--elysium-size-control-md);
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--elysium-text-secondary);
      font: 600 14px/20px var(--elysium-font-sans);
      cursor: pointer;
    }
    .auth-tab.active {
      color: var(--elysium-text-brand);
      border-bottom-color: var(--elysium-action-primary);
    }

    @media print {
      html, body { height: auto; overflow: visible; background: #fff !important; color: #19181E !important; }
      .sidebar, .reader-toolbar, .audio-bar, .toc-rail, .mobile-tabbar, .modal-backdrop { display: none !important; }
      .app-shell, .main-pane, .reader-scroll, .document-sheet { display: block; height: auto; overflow: visible; padding: 0; margin: 0; border: none; box-shadow: none; }
    }
  </style>
</head>
<body>
  <!-- Account Authentication Gate -->
  <div class="auth-gate" id="auth-gate">
    <div class="auth-card">
      <div>
        <div class="brand" style="margin-bottom:8px;">
          <span class="brand-mark"></span>
          <span>Lectern</span>
          <span class="brand-sub">Workspace</span>
        </div>
        <p style="margin:0;color:var(--elysium-text-secondary);font:400 15px/22px var(--elysium-font-sans);word-break:keep-all;">
          개인 강의 녹음과 마크다운 노트는 계정별로 안전하게 분리·보호됩니다.
        </p>
      </div>

      <div class="auth-tabs" role="tablist">
        <button type="button" class="auth-tab active" id="tab-login-btn" onclick="switchAuthMode('login')">로그인</button>
        <button type="button" class="auth-tab" id="tab-reg-btn" onclick="switchAuthMode('register')">회원가입</button>
        <button type="button" class="auth-tab" id="tab-reset-btn" onclick="switchAuthMode('reset')">비번 재설정</button>
      </div>

      <form id="auth-form" onsubmit="submitAuthForm(event)" style="display:flex;flex-direction:column;gap:var(--elysium-space-16);">
        <div id="auth-name-wrap" class="field-group" style="display:none;">
          <label class="field-label" for="auth-name">이름 (닉네임)</label>
          <input type="text" id="auth-name" class="field-input" placeholder="표시할 이름 입력" autocomplete="name" />
        </div>
        <div class="field-group">
          <label class="field-label" for="auth-email" id="auth-email-label">아이디 또는 이메일</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="auth-email" class="field-input" style="flex:1;" placeholder="아이디 또는 이메일 주소" autocomplete="username" required />
            <button type="button" class="btn" id="btn-send-code" style="display:none;flex-shrink:0;" onclick="sendEmailVerificationCode()">인증번호 발송</button>
          </div>
        </div>
        <div id="auth-code-wrap" class="field-group" style="display:none;">
          <label class="field-label" for="auth-code">이메일 인증번호 (6자리)</label>
          <input type="text" id="auth-code" class="field-input" placeholder="이메일로 받은 6자리 숫자 입력" maxlength="6" inputmode="numeric" />
        </div>
        <div class="field-group">
          <label class="field-label" for="auth-password" id="auth-password-label">비밀번호</label>
          <input type="password" id="auth-password" class="field-input" placeholder="비밀번호 입력" autocomplete="current-password" required />
        </div>
        <div id="auth-error" style="display:none;padding:12px 16px;border-radius:var(--elysium-radius-12);background:var(--elysium-status-danger-surface);color:var(--elysium-status-danger-text);font:600 14px/20px var(--elysium-font-sans);"></div>
        <button type="submit" class="btn btn-primary btn-lg" id="auth-submit-btn" style="width:100%;margin-top:4px;">내 워크스페이스 열기</button>
      </form>
    </div>
  </div>

  <div class="app-shell">
    <!-- Left Library Sidebar (400px, Space/24 Padding) -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-top">
        <div class="sidebar-header">
          <div class="brand">
            <span class="brand-mark"></span>
            <span>Lectern</span>
            <span class="brand-sub">Library</span>
          </div>
          <button class="btn btn-icon" onclick="toggleTheme()" title="라이트/다크 테마 전환" aria-label="테마 전환">
            <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          </button>
        </div>

        <!-- Single Primary Action in Sidebar Area (Elysium Principle: One Primary Action per Region) -->
        <button class="btn btn-primary btn-lg" style="width:100%;" onclick="openRecorderModal()">
          <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          <span>새 강의 녹음 · 파일 업로드</span>
        </button>

        <!-- Elysium TextField with Explicit Label -->
        <div class="field-group">
          <label class="field-label" for="search-input">강의 노트 검색</label>
          <input type="search" id="search-input" class="search-input" placeholder="과목명, 제목, 핵심 이론 검색 (⌘K)" />
        </div>

        <!-- Elysium Filter Chips (H40, Radius 999) -->
        <div class="course-pills" id="course-pills" aria-label="과목 필터"></div>
      </div>

      <div class="lecture-list" id="lecture-list"></div>

      <div class="sidebar-footer">
        <div class="user-bar">
          <span class="user-name" id="user-badge">로그인됨</span>
          <div style="display:flex;gap:6px;align-items:center;">
            <a href="/admin" class="btn" id="admin-nav-btn" style="display:none;height:32px;padding:0 10px;font-size:12.5px;color:var(--elysium-text-brand);border-color:var(--elysium-border-focus);background:var(--elysium-action-subtle);">어드민·CRM</a>
            <button class="btn" style="height:32px;padding:0 10px;font-size:12.5px;" onclick="logoutAccount()">로그아웃</button>
          </div>
        </div>
        <div class="footer-actions">
          <button class="btn btn-subtle" onclick="openCleanupModal()">기록·용량</button>
          <button class="btn btn-subtle" onclick="openClientsModal()">기기 연동</button>
          <button class="btn btn-subtle" onclick="openSettingsModal()">계정·비번</button>
        </div>
      </div>
    </aside>

    <!-- Main Reader Area -->
    <main class="main-pane">
      <header class="reader-toolbar">
        <div class="toolbar-meta" id="toolbar-meta">
          <span class="meta-pill course" id="cur-course">강의 선택</span>
          <span class="meta-pill" id="cur-date" title="녹음 일시 (KST)">—</span>
          <span class="meta-pill" id="cur-duration" style="display:none;" title="실제 녹음 길이">—</span>
          <span class="meta-pill" id="cur-uuid" style="display:none;font-family:var(--elysium-font-mono);font-size:12px;" title="고유 노트 UUID">—</span>
          <span class="meta-pill" id="sse-status-pill" style="color:var(--elysium-status-success-text);background:var(--elysium-status-success-surface);">실시간 동기화</span>
        </div>
        <div class="toolbar-actions">
          <button class="btn" id="btn-visibility" onclick="toggleCurrentVisibility()" title="공유 링크 공개/비공개 전환">비공개</button>
          <button class="btn" id="btn-edit" onclick="toggleEditor()">노트 편집</button>
          <button class="btn" id="btn-md" onclick="downloadCurrentMarkdown()">MD 저장</button>
          <button class="btn" id="btn-pdf" onclick="window.print()">PDF 인쇄</button>
          <button class="btn" id="btn-cleanup" onclick="openCleanupModal()" title="기록 정리, 과목 이동, 오디오 관리 및 삭제">관리·삭제</button>
          <button class="btn btn-primary" id="btn-share" onclick="shareCurrentLecture()">공유 링크 복사</button>
        </div>
      </header>

      <div class="reader-scroll" id="reader-scroll">
        <div style="min-width:0;">
          <div class="audio-bar" id="audio-bar">
            <span style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);white-space:nowrap;">원본 강의 오디오</span>
            <audio id="lecture-audio" controls preload="metadata"></audio>
            <select class="speed-select" id="audio-speed" aria-label="재생 배속" onchange="changeAudioSpeed(this.value)">
              <option value="1">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="1.75">1.75x</option>
              <option value="2">2.0x</option>
            </select>
            <button class="btn" onclick="downloadCurrentRawAudio()">원본 저장</button>
          </div>

          <div class="document-sheet">
            <article class="md-article" id="md-article">
              <div style="padding:var(--elysium-space-32) 0;text-align:center;">
                <h2 style="font:600 20px/30px var(--elysium-font-sans);color:var(--elysium-text-primary);margin:0 0 8px;">선택된 강의 노트가 없습니다</h2>
                <p style="font:400 16px/24px var(--elysium-font-sans);color:var(--elysium-text-secondary);margin:0 0 24px;">왼쪽 라이브러리에서 강의를 선택하거나 새 강의를 녹음해 보세요.</p>
                <button class="btn btn-primary" onclick="openRecorderModal()">새 강의 녹음 시작</button>
              </div>
            </article>

            <div class="editor-pane" id="editor-pane">
              <div class="field-group">
                <label class="field-label" for="edit-title">강의 제목</label>
                <input type="text" id="edit-title" class="field-input" placeholder="강의 제목을 입력하세요" />
              </div>
              <div class="field-group">
                <label class="field-label" for="edit-course">과목명</label>
                <input type="text" id="edit-course" class="field-input" placeholder="과목명을 입력하세요" />
              </div>
              <div class="field-group">
                <label class="field-label" for="edit-markdown">마크다운 본문</label>
                <textarea id="edit-markdown" class="editor-textarea"></textarea>
              </div>
              <div style="display:flex;gap:12px;justify-content:flex-end;">
                <button class="btn" onclick="toggleEditor(false)">취소</button>
                <button class="btn btn-primary" onclick="saveMarkdownEdit()">변경사항 저장</button>
              </div>
            </div>
          </div>
        </div>

        <nav class="toc-rail" id="toc-rail" aria-label="문서 목차">
          <div class="toc-title">목차 (On this page)</div>
          <div id="toc-list"></div>
        </nav>
      </div>
    </main>
  </div>

  <!-- Elysium Mobile Bottom Navigation (H64 + Safe Area) -->
  <nav class="mobile-tabbar" aria-label="하단 내비게이션">
    <button class="tab-btn" id="tab-list" onclick="switchMobileTab('list')">
      <svg class="icon-svg" viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
      <span>라이브러리</span>
    </button>
    <button class="tab-btn active" id="tab-reader" onclick="switchMobileTab('reader')">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      <span>노트 리더</span>
    </button>
    <button class="tab-btn" onclick="openRecorderModal()">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
      <span>녹음·업로드</span>
    </button>
  </nav>

  <!-- Recorder & Upload Modal (Elysium/Desktop/Overlay) -->
  <div class="modal-backdrop" id="recorder-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">실시간 강의 녹음 및 오디오 증류</div>
        <button class="btn btn-icon" onclick="closeModal('recorder-modal')" aria-label="닫기">✕</button>
      </div>

      <div class="field-group">
        <label class="field-label" for="rec-course">과목명 (Course)</label>
        <input type="text" id="rec-course" class="field-input" placeholder="예: 정보보호개론, 자바프로그래밍, 영어읽기와토론" value="정보보호개론" />
        <div id="quick-course-chips" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;"></div>
      </div>

      <div class="rec-visualizer-wrap">
        <canvas id="rec-canvas" class="rec-canvas" width="460" height="104"></canvas>
        <div class="rec-timer" id="rec-timer">00:00</div>
      </div>

      <div style="display:flex;gap:12px;">
        <button class="btn btn-primary btn-lg" id="btn-rec-start" style="flex:1;" onclick="toggleMicRecording()">마이크 녹음 시작</button>
        <button class="btn btn-lg" id="btn-rec-pause" style="display:none;" onclick="pauseResumeRecording()">일시정지</button>
      </div>

      <label style="display:flex;align-items:center;gap:12px;font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-secondary);cursor:pointer;">
        <input type="checkbox" id="chk-local-save" style="width:20px;height:20px;accent-color:var(--elysium-action-primary);" checked onchange="localStorage.setItem('lectern_autosave_local', this.checked ? '1' : '0')" />
        <span>녹음 종료 시 내 기기에 원본 오디오 파일 즉시 백업 + 브라우저 금고(IndexedDB) 이중 보호</span>
      </label>

      <div id="local-vault-box" style="display:none;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-status-warning-surface);border:1px solid var(--elysium-status-warning-text);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-status-warning-text);" id="local-vault-title">미전송 로컬 녹음 보관함 (네트워크 장애 보호됨)</span>
          <button class="btn" style="height:32px;padding:0 12px;font-size:13px;" onclick="retryAllPendingLocalUploads()">전체 재업로드</button>
        </div>
        <div id="local-vault-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>

      <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()">
        <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">오디오 파일 드래그 앤 드롭 또는 클릭하여 선택</div>
        <div style="font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-secondary);">지원 포맷: .m4a (음성메모), .mp3, .webm, .wav, .ogg (최대 200MB)</div>
        <input type="file" id="file-input" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" style="display:none" onchange="handleFileSelect(this.files)" />
      </div>

      <div id="ingest-status" style="padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-action-subtle);color:var(--elysium-text-brand);font:600 14px/20px var(--elysium-font-sans);display:none;"></div>
    </div>
  </div>

  <!-- Native Clients & Shortcuts Modal -->
  <div class="modal-backdrop" id="clients-modal">
    <div class="modal-card" style="max-width:680px;">
      <div class="modal-header">
        <div class="modal-title">멀티플랫폼 네이티브 앱 & 퀵액션 연동</div>
        <button class="btn btn-icon" onclick="closeModal('clients-modal')" aria-label="닫기">✕</button>
      </div>
      <p style="margin:0;color:var(--elysium-text-secondary);font:400 16px/24px var(--elysium-font-sans);">
        어느 기기에서 녹음하든 쉬는시간·방치녹음이 자동 제거된 뒤 이 리더 화면에 즉시 동기화됩니다.
      </p>
      <div class="client-grid">
        <div class="client-box">
          <h4>macOS 상단 메뉴바 앱</h4>
          <p>상단 메뉴바에 상주하며 <code>⌥Space</code> 글로벌 단축키로 즉시 녹음하고 마크다운 노트를 열람합니다.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/Lectern-macOS-arm64.zip" target="_blank">Lectern.app 다운로드</a>
          </div>
        </div>
        <div class="client-box">
          <h4>iOS 단축어 / 액션 버튼</h4>
          <p>음성 메모 공유 시트 또는 아이폰 액션 버튼으로 녹음본을 즉시 전송하고 노트를 엽니다.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="/api/clients/ios-shortcut" download="lectern-ios-shortcut.json">단축어 파일 다운로드</a>
          </div>
        </div>
        <div class="client-box">
          <h4>Android 앱 & 상단 퀵세팅 타일</h4>
          <p>모바일 강의 노트 리더·녹음기와 상단 퀵세팅 패널 원탭 녹음 타일을 제공합니다.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/Lectern-android-universal.apk" target="_blank">APK 다운로드</a>
          </div>
        </div>
        <div class="client-box">
          <h4>Windows 시스템 트레이 앱</h4>
          <p>시스템 트레이에 상주하며 <code>Alt+Shift+R</code> 단축키로 즉시 녹음하고 노트를 확인합니다.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="https://github.com/eunhhu/lectern/releases/latest/download/LecternTray-win-x64.exe" target="_blank">Windows EXE 다운로드</a>
          </div>
        </div>
      </div>
      <div style="padding:20px;border-radius:var(--elysium-radius-16);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);">내 계정 전용 API 토큰 (네이티브 앱 / iOS 단축어 연동용)</span>
          <button class="btn" style="height:32px;padding:0 12px;font-size:13px;" onclick="copyApiToken()">토큰 복사</button>
        </div>
        <code id="my-api-token-code" style="display:block;margin-bottom:16px;padding:10px 14px;background:var(--elysium-surface-default);border:1px solid var(--elysium-border-subtle);border-radius:var(--elysium-radius-8);font:500 14px/20px var(--elysium-font-mono);color:var(--elysium-text-brand);">lct_...</code>
        <div style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:8px;">원클릭 HTTP Ingest API (cURL / 단축어 연동)</div>
        <code id="my-curl-snippet" style="display:block;white-space:pre-wrap;font:500 13px/20px var(--elysium-font-mono);color:var(--elysium-text-secondary);">curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\
  -H "X-Lectern-Token: <내_API_토큰>" \\
  -H "X-Course: 정보보호개론" \\
  -F "audio=@20261014_lecture.m4a"</code>
      </div>
    </div>
  </div>

  <!-- Account & Password Security Modal -->
  <div class="modal-backdrop" id="settings-modal">
    <div class="modal-card" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title">내 계정 및 보안 설정</div>
        <button class="btn btn-icon" onclick="closeModal('settings-modal')" aria-label="닫기">✕</button>
      </div>

      <!-- Admin Console Banner (visible for Owner/Admin) -->
      <div id="settings-admin-banner" style="display:none;padding:16px 20px;border-radius:var(--elysium-radius-12);background:var(--elysium-action-subtle);border:1px solid var(--elysium-border-focus);align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-brand);">관리자(Owner/Admin) 권한 활성화됨</div>
          <div style="font:400 13px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">회원 CRM, 가입 정책, 역할·세부 권한, 용량 쿼터를 관리할 수 있습니다.</div>
        </div>
        <a href="/admin" class="btn btn-primary" style="white-space:nowrap;">어드민·CRM 콘솔 열기</a>
      </div>

      <!-- Profile & Role Info -->
      <div style="padding:20px;border-radius:var(--elysium-radius-16);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);">내 프로필 및 권한 상태</div>
          <span id="account-role-badges" style="display:flex;gap:6px;flex-wrap:wrap;"></span>
        </div>
        <div class="field-group">
          <label class="field-label" for="prof-display-name">표시 이름 (닉네임)</label>
          <div style="display:flex;gap:10px;">
            <input type="text" id="prof-display-name" class="field-input" style="flex:1;" placeholder="표시할 이름" />
            <button type="button" class="btn" onclick="saveProfileDisplayName()">이름 변경</button>
          </div>
        </div>
      </div>

      <!-- Self-Service Password Change -->
      <form onsubmit="submitPasswordChange(event)" style="padding:20px;border-radius:var(--elysium-radius-16);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);display:flex;flex-direction:column;gap:14px;">
        <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);">비밀번호 변경</div>
        <div class="field-group">
          <label class="field-label" for="pw-current">현재 비밀번호</label>
          <input type="password" id="pw-current" class="field-input" placeholder="현재 비밀번호 입력" autocomplete="current-password" required />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="field-group">
            <label class="field-label" for="pw-new">새 비밀번호 (6자 이상)</label>
            <input type="password" id="pw-new" class="field-input" placeholder="새 비밀번호" autocomplete="new-password" required />
          </div>
          <div class="field-group">
            <label class="field-label" for="pw-confirm">새 비밀번호 확인</label>
            <input type="password" id="pw-confirm" class="field-input" placeholder="새 비밀번호 다시 입력" autocomplete="new-password" required />
          </div>
        </div>
        <div id="pw-change-msg" style="display:none;padding:10px 14px;border-radius:var(--elysium-radius-8);font:600 13px/20px var(--elysium-font-sans);"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <button type="button" class="btn" onclick="rotateMyApiToken()">기기 연동 API 토큰 재발급</button>
          <div style="display:flex;gap:10px;">
            <button type="button" class="btn" onclick="closeModal('settings-modal')">닫기</button>
            <button type="submit" class="btn btn-primary">비밀번호 변경 저장</button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <!-- Cleanup, Visibility & Record Management Modal -->
  <div class="modal-backdrop" id="cleanup-modal">
    <div class="modal-card" style="max-width:560px;">
      <div class="modal-header">
        <div class="modal-title">기록 정리 · 삭제 · 공개 설정</div>
        <button class="btn btn-icon" onclick="closeModal('cleanup-modal')" aria-label="닫기">✕</button>
      </div>

      <div id="cleanup-current-box" style="padding:20px;border-radius:var(--elysium-radius-16);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);display:flex;flex-direction:column;gap:16px;">
        <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);" id="cleanup-cur-title">현재 선택된 강의 노트</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" id="cleanup-vis-btn" onclick="toggleCurrentVisibility()">공개/비공개 전환</button>
          <button class="btn" onclick="rotateCurrentShareToken()">공유 링크 재발급 (기존 링크 차단)</button>
        </div>
        <div class="field-group">
          <label class="field-label" for="cleanup-move-course">과목 이동</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input type="text" id="cleanup-move-course" class="field-input" style="flex:1;" placeholder="변경할 과목명 입력" />
            <button class="btn" onclick="moveCurrentLectureCourse()">과목 변경</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" id="cleanup-audio-btn" onclick="deleteCurrentAudioOnly()">원본 오디오만 삭제 (노트 보존)</button>
          <button class="btn btn-danger" onclick="deleteCurrentLecture()">이 강의 노트 영구 삭제</button>
        </div>
      </div>

      <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);">워크스페이스 일괄 기록 정리</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
          <div>
            <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">실패·중단된 분석 기록 정리</div>
            <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">오류 상태이거나 15분 이상 멈춘 미완료 기록과 임시 파일을 삭제합니다.</div>
          </div>
          <button class="btn" onclick="runWorkspaceCleanup('failed')">일괄 정리</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
          <div>
            <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">짧은 테스트·단편 녹음(15초 미만) 정리</div>
            <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">실수로 눌렸거나 테스트로 녹음된 짧은 단편 노트를 일괄 삭제합니다.</div>
          </div>
          <button class="btn" onclick="runWorkspaceCleanup('short_fragments')">단편 삭제</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
          <div>
            <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">완료된 모든 노트의 원본 음성파일 비우기</div>
            <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">마크다운 강의 노트는 영구 보존하고 대용량 원본 오디오만 정리합니다.</div>
          </div>
          <button class="btn" onclick="runWorkspaceCleanup('audio_only_all')">오디오 비우기</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
    let lectures = [];
    let currentLecture = null;
    let activeCourse = 'ALL';
    let searchQuery = '';
    let currentUser = null;
    let authMode = 'login';
    let sseSource = null;

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
            '<div style="padding:32px 0;text-align:center;"><h2 style="font:600 20px/30px var(--elysium-font-sans);color:var(--elysium-text-primary);margin:0 0 8px;">선택된 강의 노트가 없습니다</h2><p style="font:400 16px/24px var(--elysium-font-sans);color:var(--elysium-text-secondary);margin:0;">왼쪽 라이브러리에서 강의를 선택하거나 새 강의를 녹음해 보세요.</p></div>';
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
          badge.style.color = 'var(--elysium-status-success-text)';
          badge.style.background = 'var(--elysium-status-success-surface)';
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
          '<div style="font:700 20px/30px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:12px;">' +
            escapeClientHtml(lec.stage_message || '강의 오디오 증류 중...') +
          ' (' + pct + '%)</div>' +
          '<div class="card-progress" style="height:8px;margin-bottom:16px;"><div class="card-progress-bar" style="width:' + pct + '%"></div></div>' +
          '<div style="color:var(--elysium-text-secondary);font:400 16px/24px var(--elysium-font-sans);word-break:keep-all;">쉬는 시간과 불필요한 잡담을 걸러내고 핵심 이론을 구조화하고 있습니다. 완료되면 새로고침 없이 즉시 노트가 열립니다.</div>' +
        '</div>';
    }

    // Theme setup (Elysium 1.0 Light Default + Dark Mode Support)
    const savedTheme = localStorage.getItem('lectern_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-elysium-theme', savedTheme === 'dark' ? 'Dark' : 'Light');
    function toggleTheme() {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.setAttribute('data-elysium-theme', next === 'dark' ? 'Dark' : 'Light');
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
      document.getElementById('tab-reset-btn').classList.toggle('active', mode === 'reset');
      document.getElementById('auth-name-wrap').style.display = mode === 'register' ? 'flex' : 'none';
      const needsCode = mode === 'register' || mode === 'reset';
      document.getElementById('btn-send-code').style.display = needsCode ? 'inline-flex' : 'none';
      document.getElementById('auth-code-wrap').style.display = needsCode ? 'flex' : 'none';
      document.getElementById('auth-email-label').textContent = needsCode ? '이메일 주소 (인증번호 수신)' : '아이디 또는 이메일';
      document.getElementById('auth-email').placeholder = needsCode ? '이메일 주소 입력 (예: user@domain.com)' : '아이디 또는 이메일 주소';
      document.getElementById('auth-password-label').textContent = mode === 'reset' ? '새 비밀번호 (6자 이상)' : '비밀번호';
      document.getElementById('auth-submit-btn').textContent =
        mode === 'register' ? '이메일 인증 완료 및 가입' :
        mode === 'reset' ? '비밀번호 재설정 완료' :
        '내 워크스페이스 열기';
      document.getElementById('auth-error').style.display = 'none';
    }

    async function sendEmailVerificationCode() {
      const email = document.getElementById('auth-email').value.trim();
      const errEl = document.getElementById('auth-error');
      const btn = document.getElementById('btn-send-code');
      if (!email || !email.includes('@')) {
        errEl.style.background = 'var(--elysium-status-danger-surface)';
        errEl.style.color = 'var(--elysium-status-danger-text)';
        errEl.textContent = '인증번호를 받을 유효한 이메일 주소를 입력해주세요.';
        errEl.style.display = 'block';
        return;
      }
      btn.disabled = true;
      btn.textContent = '발송 중...';
      try {
        const purpose = authMode === 'reset' ? 'reset' : 'signup';
        const res = await fetch('/api/auth/send-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, purpose })
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.style.background = 'var(--elysium-status-danger-surface)';
          errEl.style.color = 'var(--elysium-status-danger-text)';
          errEl.textContent = data.error || '인증번호 발송에 실패했습니다.';
          errEl.style.display = 'block';
          return;
        }
        errEl.style.background = 'var(--elysium-status-success-surface)';
        errEl.style.color = 'var(--elysium-status-success-text)';
        errEl.textContent = data.message || '이메일로 6자리 인증번호가 발송되었습니다.';
        errEl.style.display = 'block';
        document.getElementById('auth-code').focus();
      } finally {
        btn.disabled = false;
        btn.textContent = '인증번호 재발송';
      }
    }

    async function submitAuthForm(ev) {
      ev.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const displayName = document.getElementById('auth-name').value.trim();
      const verificationCode = document.getElementById('auth-code').value.trim();
      const errEl = document.getElementById('auth-error');
      errEl.style.display = 'none';

      if (authMode === 'reset') {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, verificationCode, newPassword: password })
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.style.background = 'var(--elysium-status-danger-surface)';
          errEl.style.color = 'var(--elysium-status-danger-text)';
          errEl.textContent = data.error || '비밀번호 재설정에 실패했습니다.';
          errEl.style.display = 'block';
          return;
        }
        switchAuthMode('login');
        errEl.style.background = 'var(--elysium-status-success-surface)';
        errEl.style.color = 'var(--elysium-status-success-text)';
        errEl.textContent = data.message || '비밀번호가 재설정되었습니다. 로그인해주세요.';
        errEl.style.display = 'block';
        return;
      }

      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName, verificationCode })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.style.background = 'var(--elysium-status-danger-surface)';
        errEl.style.color = 'var(--elysium-status-danger-text)';
        errEl.textContent = data.error || '인증에 실패했습니다.';
        errEl.style.display = 'block';
        return;
      }
      if (data.pendingApproval) {
        errEl.style.background = 'var(--elysium-status-warning-surface)';
        errEl.style.color = 'var(--elysium-status-warning-text)';
        errEl.textContent = data.message || '가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.';
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
      const roleLabel = (user.role || (user.isAdmin ? 'owner' : 'member')).toUpperCase();
      document.getElementById('user-badge').textContent = user.displayName + ' · ' + roleLabel;
      const adminBtn = document.getElementById('admin-nav-btn');
      const adminBanner = document.getElementById('settings-admin-banner');
      if (adminBtn) adminBtn.style.display = user.isAdmin ? 'inline-flex' : 'none';
      if (adminBanner) adminBanner.style.display = user.isAdmin ? 'flex' : 'none';

      const profNameInput = document.getElementById('prof-display-name');
      if (profNameInput) profNameInput.value = user.displayName || '';

      const badgesEl = document.getElementById('account-role-badges');
      if (badgesEl) {
        const quotaLabel = user.quotaMb === 0 ? '용량 무제한' : ('쿼터 ' + (user.quotaMb || 2048) + 'MB');
        badgesEl.innerHTML =
          '<span class="meta-pill course">' + escapeClientHtml(roleLabel) + '</span>' +
          '<span class="meta-pill">' + (user.canIngest !== false ? '녹음·업로드 허용' : '뷰어 전용') + '</span>' +
          '<span class="meta-pill">' + (user.canShare !== false ? '외부 공유 허용' : '공유 제한') + '</span>' +
          '<span class="meta-pill">' + escapeClientHtml(quotaLabel) + '</span>';
      }

      const tokEl = document.getElementById('my-api-token-code');
      if (tokEl && user.apiToken) tokEl.textContent = user.apiToken;
      const curlEl = document.getElementById('my-curl-snippet');
      if (curlEl && user.apiToken) {
        curlEl.textContent = 'curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\\n  -H "X-Lectern-Token: ' + user.apiToken + '" \\\n  -H "X-Course: 정보보호개론" \\\n  -F "audio=@20261014_lecture.m4a"';
      }
      connectRealtimeSSE();
    }

    async function saveProfileDisplayName() {
      const displayName = document.getElementById('prof-display-name').value.trim();
      if (!displayName) {
        showToast('표시할 이름을 입력해주세요.');
        return;
      }
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ displayName })
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '이름 변경 실패');
        return;
      }
      applyAuthenticatedUser(data.user);
      showToast('표시 이름이 변경되었습니다.');
    }

    async function submitPasswordChange(ev) {
      ev.preventDefault();
      const currentPassword = document.getElementById('pw-current').value;
      const newPassword = document.getElementById('pw-new').value;
      const confirmPassword = document.getElementById('pw-confirm').value;
      const msgEl = document.getElementById('pw-change-msg');
      msgEl.style.display = 'block';

      if (newPassword !== confirmPassword) {
        msgEl.style.background = 'var(--elysium-status-danger-surface)';
        msgEl.style.color = 'var(--elysium-status-danger-text)';
        msgEl.textContent = '새 비밀번호와 확인 비밀번호가 일치하지 않습니다.';
        return;
      }
      if (newPassword.length < 6) {
        msgEl.style.background = 'var(--elysium-status-danger-surface)';
        msgEl.style.color = 'var(--elysium-status-danger-text)';
        msgEl.textContent = '새 비밀번호는 최소 6자 이상이어야 합니다.';
        return;
      }

      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.style.background = 'var(--elysium-status-danger-surface)';
        msgEl.style.color = 'var(--elysium-status-danger-text)';
        msgEl.textContent = data.error || '비밀번호 변경에 실패했습니다.';
        return;
      }

      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
      msgEl.style.background = 'var(--elysium-status-success-surface)';
      msgEl.style.color = 'var(--elysium-status-success-text)';
      msgEl.textContent = data.message || '비밀번호가 안전하게 변경되었습니다.';
      showToast('비밀번호가 변경되었습니다.');
    }

    async function rotateMyApiToken() {
      if (!confirm('기기 연동용 API 토큰을 새로 발급할까요? (기존 API 토큰은 즉시 무효화됩니다)')) return;
      const res = await fetch('/api/auth/rotate-token', {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (res.ok && data.apiToken) {
        currentUser.apiToken = data.apiToken;
        applyAuthenticatedUser(currentUser);
        showToast('새 API 토큰이 발급되었습니다.');
      }
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
        const isAct = c === activeCourse;
        const cls = isAct ? 'pill active' : 'pill';
        const check = isAct ? '<span aria-hidden="true">✓</span>' : '';
        return '<button class="' + cls + '" aria-pressed="' + isAct + '" onclick="setCourseFilter(\\'' + c.replace(/'/g, "\\\\'") + '\\')">' + check + '<span>' + escapeClientHtml(label) + '</span></button>';
      }).join('');

      const quickWrap = document.getElementById('quick-course-chips');
      if (quickWrap) {
        quickWrap.innerHTML = courses.map(c =>
          '<button type="button" class="pill" style="height:36px;padding:0 14px;" onclick="document.getElementById(\\'rec-course\\').value=\\'' + c.replace(/'/g, "\\\\'") + '\\'">' + escapeClientHtml(c) + '</button>'
        ).join('');
      }
    }

    function setCourseFilter(c) {
      activeCourse = c;
      fetchLectures();
    }

    function formatDurationBadge(sec) {
      const s = Number(sec || 0);
      if (!s || s <= 0) return '';
      const m = Math.floor(s / 60);
      const rem = Math.floor(s % 60);
      const h = Math.floor(m / 60);
      if (h > 0) {
        return h + '시간 ' + String(m % 60).padStart(2, '0') + '분 ' + String(rem).padStart(2, '0') + '초';
      }
      return String(m).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
    }

    function shortUuidBadge(id) {
      const clean = String(id || '').replace(/^[a-z]+_/i, '');
      return clean.slice(0, 8);
    }

    function renderLectureList() {
      const listEl = document.getElementById('lecture-list');
      if (!lectures.length) {
        listEl.innerHTML =
          '<div style="padding:var(--elysium-space-24);text-align:center;background:var(--elysium-surface-default);border:1px solid var(--elysium-border-subtle);border-radius:var(--elysium-radius-16);">' +
            '<div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:8px;">조건에 맞는 강의 노트가 없습니다</div>' +
            '<div style="font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-secondary);">새 강의를 녹음하거나 다른 과목 필터를 선택해 보세요.</div>' +
          '</div>';
        return;
      }
      listEl.innerHTML = lectures.map(item => {
        const isAct = currentLecture && currentLecture.id === item.id;
        const visBadge = item.is_public
          ? '<span style="font:600 12px/18px var(--elysium-font-sans);padding:2px 8px;border-radius:999px;background:var(--elysium-status-success-surface);color:var(--elysium-status-success-text);">공개</span>'
          : '<span style="font:600 12px/18px var(--elysium-font-sans);padding:2px 8px;border-radius:999px;background:var(--elysium-surface-subtle);color:var(--elysium-text-secondary);">비공개</span>';
        const durLabel = formatDurationBadge(item.duration_sec);
        const durBadge = durLabel
          ? '<span style="font:600 12px/18px var(--elysium-font-mono);padding:2px 7px;border-radius:999px;background:var(--elysium-surface-subtle);color:var(--elysium-text-primary);">⏱ ' + escapeClientHtml(durLabel) + '</span>'
          : '';
        const uuidShort = shortUuidBadge(item.id);
        const uuidBadge = uuidShort
          ? '<span style="font:500 11px/16px var(--elysium-font-mono);color:var(--elysium-text-tertiary);" title="UUID: ' + escapeClientHtml(item.id) + '">#' + escapeClientHtml(uuidShort) + '</span>'
          : '';
        const progHtml = item.status === 'processing'
          ? '<div class="card-progress"><div class="card-progress-bar" style="width:' + (item.progress || 15) + '%"></div></div><div style="font:600 13px/20px var(--elysium-font-sans);color:var(--elysium-text-brand);margin-top:4px;">' + escapeClientHtml(item.stage_message || '분석 중...') + ' (' + (item.progress || 15) + '%)</div>'
          : item.status === 'error'
          ? '<div style="font:600 13px/20px var(--elysium-font-sans);color:var(--elysium-status-danger-text);margin-top:4px;">분석 실패 · 원본 재분석 가능</div>'
          : '';
        return '<div class="lecture-card ' + (isAct ? 'active' : '') + '" onclick="selectLecture(\\'' + item.id + '\\', true)">' +
          '<div class="card-top">' +
            '<span class="card-course">' + escapeClientHtml(item.course) + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' + durBadge + visBadge + uuidBadge + '</span>' +
          '</div>' +
          '<div class="card-title">' + escapeClientHtml(item.title) + '</div>' +
          '<div style="font:500 12px/18px var(--elysium-font-mono);color:var(--elysium-text-secondary);margin-top:-2px;">녹음 일시: ' + escapeClientHtml(item.date_label) + '</div>' +
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
      document.getElementById('cur-date').textContent = '녹음 ' + (currentLecture.date_label || '');
      const curDurEl = document.getElementById('cur-duration');
      if (curDurEl) {
        const durTxt = formatDurationBadge(currentLecture.duration_sec);
        if (durTxt) {
          curDurEl.style.display = 'inline-flex';
          curDurEl.textContent = '길이 ' + durTxt;
        } else {
          curDurEl.style.display = 'none';
        }
      }
      const curUuidEl = document.getElementById('cur-uuid');
      if (curUuidEl) {
        curUuidEl.style.display = 'inline-flex';
        curUuidEl.textContent = 'UUID · ' + shortUuidBadge(currentLecture.id);
        curUuidEl.title = '노트 고유 UUID: ' + currentLecture.id;
      }
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
          '<div style="padding:32px;border-radius:var(--elysium-radius-16);background:var(--elysium-status-danger-surface);border:1px solid var(--elysium-status-danger-text);max-width:600px;margin:24px auto;">' +
            '<div style="font:700 20px/30px var(--elysium-font-sans);color:var(--elysium-status-danger-text);margin-bottom:8px;">분석 중 일시적 장애가 발생했습니다</div>' +
            '<div style="font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:16px;word-break:break-all;">' + escapeClientHtml(currentLecture.error_message || '알 수 없는 오류') + '</div>' +
            '<div style="font:400 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:24px;">서버 디스크에 원본 음성 파일이 안전하게 보존되어 있습니다. 아래 버튼으로 즉시 재분석하거나 원본 음성을 다운로드할 수 있습니다.</div>' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
              '<button class="btn btn-primary" onclick="retryLectureDistillation(\\'' + currentLecture.id + '\\')">보존된 원본 오디오로 재분석</button>' +
              '<button class="btn" onclick="downloadCurrentRawAudio()">원본 오디오 다운로드</button>' +
              '<button class="btn btn-danger" onclick="deleteCurrentLecture()">기록 삭제</button>' +
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
      if (closeMobileList && window.innerWidth <= 1024) {
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
        btn.textContent = isPub ? '✓ 공개중' : '비공개';
        btn.style.color = isPub ? 'var(--elysium-status-success-text)' : 'var(--elysium-text-primary)';
        btn.style.background = isPub ? 'var(--elysium-status-success-surface)' : 'var(--elysium-surface-default)';
        btn.style.borderColor = isPub ? 'var(--elysium-status-success-text)' : 'var(--elysium-border-control)';
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
        const ok = confirm('현재 이 강의 노트는 [비공개] 상태입니다.\\n외부에서 공유 링크로 열람할 수 있도록 [공개]로 전환하고 링크를 복사할까요?');
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

    function openRecorderModal() { document.getElementById('recorder-modal').classList.add('open'); }
    function openClientsModal() { document.getElementById('clients-modal').classList.add('open'); }
    function openSettingsModal() { document.getElementById('settings-modal').classList.add('open'); }
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }

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
      vaultDbPromise = new Promise((resolve) => {
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
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-default);border:1px solid var(--elysium-border-subtle);">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">[' + escapeClientHtml(item.course) + '] ' + escapeClientHtml(item.fileName) + ' (' + mb + ' MB)</div>' +
            '<div style="font:400 13px/20px var(--elysium-font-sans);color:var(--elysium-status-danger-text);">' + escapeClientHtml(item.lastError || '업로드 대기 중') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-shrink:0;">' +
            '<button class="btn btn-primary" style="height:32px;padding:0 12px;font-size:13px;" onclick="retrySingleVaultUpload(\\'' + item.localId + '\\')">재업로드</button>' +
            '<button class="btn" style="height:32px;padding:0 12px;font-size:13px;" onclick="downloadVaultItem(\\'' + item.localId + '\\')">원본 저장</button>' +
            '<button class="btn btn-danger" style="height:32px;padding:0 12px;font-size:13px;" onclick="removePendingUploadFromVault(\\'' + item.localId + '\\')">삭제</button>' +
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
          const recUuid = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : ('rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
          const kstDate = new Date(Date.now() + 9 * 3600 * 1000);
          const stamp = kstDate.toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const safeCourse = courseNow.replace(/[\\\\/:*?"<>|\\s]+/g, '_');
          const fileName = safeCourse + '_' + stamp + '_' + recUuid.slice(0, 8) + '.' + ext;
          const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          const localId = recUuid;

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

          const autoSaveChk = document.getElementById('chk-local-save');
          if (!autoSaveChk || autoSaveChk.checked) {
            triggerLocalBlobDownload(blob, fileName);
          }

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
          const h = Math.max(4, v * (canvas.height - 16));
          ctx.fillStyle = v > 0.6 ? '#4C36F5' : '#5650FF';
          ctx.fillRect(x, (canvas.height - h) / 2, barW - 2, h);
          x += barW;
        }
      }
      render();
    }

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
      const localId = existingLocalId || (
        (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('upl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10))
      );

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
          form.append('source', sourceClient);
          form.append('idempotency_key', localId);

          const headers = authHeaders({ 'X-Idempotency-Key': localId });

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

export function renderAdminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko" data-theme="light" data-elysium-theme="Light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lectern Admin — CRM & 권한 관리 콘솔</title>
  <link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    :root, [data-theme="light"], [data-elysium-theme="Light"] {
      --elysium-surface-canvas: #F8F9FA;
      --elysium-surface-default: #FFFFFF;
      --elysium-surface-elevated: #FFFFFF;
      --elysium-surface-subtle: #F2F4F7;
      --elysium-surface-interactive: #EAECF0;
      --elysium-text-primary: #111827;
      --elysium-text-secondary: #4B5563;
      --elysium-text-tertiary: #6B7280;
      --elysium-text-brand: #4F46E5;
      --elysium-action-primary: #4F46E5;
      --elysium-action-primary-hover: #4338CA;
      --elysium-action-subtle: #EEF2FF;
      --elysium-border-subtle: #EAECF0;
      --elysium-border-control: #DFE3E8;
      --elysium-border-focus: #4F46E5;
      --elysium-status-success-surface: #DCFCE7;
      --elysium-status-success-text: #15803D;
      --elysium-status-warning-surface: #FEF3C7;
      --elysium-status-warning-text: #B45309;
      --elysium-status-danger-surface: #FEE2E2;
      --elysium-status-danger-text: #B91C1C;
      --elysium-status-danger-action: #DC2626;
      --elysium-font-sans: "Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --elysium-font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
      --elysium-shadow-sm: 0 1px 3px rgba(17, 24, 39, 0.04);
      --elysium-shadow-lg: 0 20px 44px rgba(17, 24, 39, 0.12);
    }
    [data-theme="dark"], [data-elysium-theme="Dark"] {
      --elysium-surface-canvas: #111214;
      --elysium-surface-default: #17181C;
      --elysium-surface-elevated: #1D1F25;
      --elysium-surface-subtle: #212329;
      --elysium-surface-interactive: #2B2E37;
      --elysium-text-primary: #F3F4F6;
      --elysium-text-secondary: #9CA3AF;
      --elysium-text-tertiary: #6B7280;
      --elysium-text-brand: #818CF8;
      --elysium-action-primary: #4F46E5;
      --elysium-action-primary-hover: #6366F1;
      --elysium-action-subtle: rgba(79, 70, 229, 0.16);
      --elysium-border-subtle: #252830;
      --elysium-border-control: #2E323C;
      --elysium-border-focus: #6366F1;
      --elysium-status-success-surface: #053C01;
      --elysium-status-success-text: #B0F4B2;
      --elysium-status-warning-surface: #470E00;
      --elysium-status-warning-text: #FFDDA5;
      --elysium-status-danger-surface: #7F1D1D;
      --elysium-status-danger-text: #FECACA;
      --elysium-status-danger-action: #DC2626;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--elysium-surface-canvas);
      color: var(--elysium-text-primary);
      font-family: var(--elysium-font-sans);
      -webkit-font-smoothing: antialiased;
    }
    .admin-header {
      position: sticky;
      top: 0;
      z-index: 30;
      height: 72px;
      background: var(--elysium-surface-default);
      border-bottom: 1px solid var(--elysium-border-subtle);
      padding: 0 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font: 700 20px/28px var(--elysium-font-sans);
    }
    .brand-dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--elysium-action-primary);
      box-shadow: 0 0 0 4px var(--elysium-action-subtle);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      font: 600 12px/18px var(--elysium-font-sans);
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
    }
    .badge.ok { background: var(--elysium-status-success-surface); color: var(--elysium-status-success-text); }
    .badge.warn { background: var(--elysium-status-warning-surface); color: var(--elysium-status-warning-text); }
    .badge.danger { background: var(--elysium-status-danger-surface); color: var(--elysium-status-danger-text); }
    .badge.neutral { background: var(--elysium-surface-subtle); color: var(--elysium-text-secondary); }
    .container {
      max-width: 1360px;
      margin: 0 auto;
      padding: 32px 40px 64px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
    }
    .kpi-card {
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: 16px;
      padding: 24px;
      box-shadow: var(--elysium-shadow-sm);
    }
    .kpi-label {
      font: 600 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      margin-bottom: 8px;
    }
    .kpi-val {
      font: 700 28px/38px var(--elysium-font-sans);
      font-variant-numeric: tabular-nums;
      color: var(--elysium-text-primary);
    }
    .kpi-sub {
      font: 400 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-tertiary);
      margin-top: 6px;
    }
    .section-card {
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: 20px;
      padding: 28px 32px;
      box-shadow: var(--elysium-shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .section-title {
      font: 700 20px/30px var(--elysium-font-sans);
      margin: 0;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 40px;
      padding: 0 16px;
      border-radius: 12px;
      border: 1px solid var(--elysium-border-control);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      font: 600 14px/20px var(--elysium-font-sans);
      text-decoration: none;
      cursor: pointer;
    }
    .btn:hover { background: var(--elysium-surface-subtle); }
    .btn-primary {
      background: var(--elysium-action-primary);
      border-color: var(--elysium-action-primary);
      color: #fff;
    }
    .btn-primary:hover { background: var(--elysium-action-primary-hover); }
    .btn-danger {
      background: var(--elysium-status-danger-surface);
      border-color: var(--elysium-status-danger-text);
      color: var(--elysium-status-danger-text);
    }
    .btn-sm { height: 34px; padding: 0 12px; font-size: 13px; border-radius: 8px; }
    .field-input, .field-select {
      height: 40px;
      padding: 0 12px;
      border-radius: 8px;
      border: 1px solid var(--elysium-border-control);
      background: var(--elysium-surface-default);
      color: var(--elysium-text-primary);
      font: 400 14px/20px var(--elysium-font-sans);
      outline: none;
    }
    .field-input:focus, .field-select:focus {
      border-color: var(--elysium-border-focus);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.14);
    }
    .crm-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--elysium-border-subtle);
      border-radius: 14px;
    }
    .crm-table {
      width: 100%;
      border-collapse: collapse;
      font: 400 14px/20px var(--elysium-font-sans);
    }
    .crm-table th, .crm-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--elysium-border-subtle);
      text-align: left;
      vertical-align: middle;
    }
    .crm-table th {
      background: var(--elysium-surface-subtle);
      font-weight: 600;
      color: var(--elysium-text-secondary);
      white-space: nowrap;
    }
    .crm-table tr:last-child td { border-bottom: none; }
    .policy-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .policy-item {
      padding: 18px 20px;
      border-radius: 14px;
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(25, 24, 30, 0.52);
      backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal-backdrop.open { display: flex; }
    .modal-card {
      width: 100%;
      max-width: 540px;
      background: var(--elysium-surface-elevated);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: 16px;
      padding: 28px 32px;
      box-shadow: var(--elysium-shadow-lg);
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .toast {
      position: fixed;
      bottom: 32px;
      right: 32px;
      z-index: 100;
      padding: 14px 20px;
      border-radius: 12px;
      background: var(--elysium-text-primary);
      color: var(--elysium-surface-default);
      font: 600 14px/20px var(--elysium-font-sans);
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms ease;
    }
    .toast.show { opacity: 1; }
    @media (max-width: 1024px) {
      .kpi-grid { grid-template-columns: 1fr 1fr; }
      .container { padding: 20px; }
      .admin-header { padding: 0 20px; }
    }
  </style>
</head>
<body>
  <header class="admin-header">
    <div class="brand">
      <span class="brand-dot"></span>
      <span>Lectern Admin</span>
      <span class="badge">CRM & RBAC Console</span>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <button class="btn btn-sm" onclick="toggleTheme()">라이트/다크 전환</button>
      <button class="btn btn-sm" onclick="loadOverview()">새로고침</button>
      <a href="/" class="btn btn-primary btn-sm">← 워크스페이스로 돌아가기</a>
    </div>
  </header>

  <main class="container">
    <div id="admin-auth-warning" style="display:none;padding:24px;border-radius:16px;background:var(--elysium-status-danger-surface);color:var(--elysium-status-danger-text);font:600 16px/24px var(--elysium-font-sans);">
      관리자(Owner/Admin) 권한이 있는 계정으로 로그인해야 접근할 수 있습니다. <a href="/" style="color:inherit;text-decoration:underline;margin-left:8px;">로그인 페이지로 이동</a>
    </div>

    <!-- 1. KPI Summary -->
    <section class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">전체 회원 (CRM)</div>
        <div class="kpi-val" id="kpi-users">—</div>
        <div class="kpi-sub" id="kpi-users-sub">활성 / 승인대기 / 정지</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">누적 강의 노트</div>
        <div class="kpi-val" id="kpi-lectures">—</div>
        <div class="kpi-sub" id="kpi-lectures-sub">외부 공개 공유 노트 포함</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">분석 오류 · 점검 필요</div>
        <div class="kpi-val" id="kpi-errors">—</div>
        <div class="kpi-sub">원본 오디오 보존됨 (즉시 재분석 가능)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">오디오 스토리지 사용량</div>
        <div class="kpi-val" id="kpi-storage">—</div>
        <div class="kpi-sub">서버 원본 음성 아카이브 합계</div>
      </div>
    </section>

    <!-- 2. Global Permission & Signup Policies -->
    <section class="section-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">가입 및 기본 권한 정책 설정 (Global Access Policy)</h2>
          <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);margin-top:4px;">
            신규 회원 가입 허용 여부, 관리자 승인제, 신규 회원의 기본 역할과 서버 AI 키 사용 권한을 제어합니다.
          </div>
        </div>
        <button class="btn btn-primary" onclick="savePolicySettings()">권한 정책 저장</button>
      </div>

      <div class="policy-grid">
        <label class="policy-item" style="cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;">공개 회원가입 허용</span>
            <input type="checkbox" id="pol-allow-signup" style="width:20px;height:20px;accent-color:var(--elysium-action-primary);" />
          </div>
          <span style="font-size:13px;color:var(--elysium-text-secondary);">체크 해제 시 로그인 화면에서 자유 가입이 차단되며 관리자만 회원을 생성할 수 있습니다.</span>
        </label>

        <label class="policy-item" style="cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;">신규 가입 시 관리자 승인 필수</span>
            <input type="checkbox" id="pol-require-approval" style="width:20px;height:20px;accent-color:var(--elysium-action-primary);" />
          </div>
          <span style="font-size:13px;color:var(--elysium-text-secondary);">활성화 시 신규 가입자가 '승인 대기(Pending)' 상태로 생성되며 승인 후 이용할 수 있습니다.</span>
        </label>

        <div class="policy-item">
          <span style="font-weight:600;">신규 가입자 기본 역할 (Role)</span>
          <select id="pol-default-role" class="field-select">
            <option value="member">Member (녹음·노트 생성·공유 가능)</option>
            <option value="viewer">Viewer (열람 전용 · 업로드 제한)</option>
          </select>
        </div>

        <label class="policy-item" style="cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;">노트 자동 정리 엔진 기본 허용</span>
            <input type="checkbox" id="pol-server-key" style="width:20px;height:20px;accent-color:var(--elysium-action-primary);" />
          </div>
          <span style="font-size:13px;color:var(--elysium-text-secondary);">신규 가입 계정에 강의 음성 자동 분석 및 마크다운 정리 권한을 부여합니다.</span>
        </label>

        <div class="policy-item">
          <span style="font-weight:600;">신규 회원 기본 오디오 쿼터 (MB)</span>
          <input type="number" id="pol-default-quota" class="field-input" min="0" step="256" value="2048" />
          <span style="font-size:13px;color:var(--elysium-text-secondary);">0 입력 시 무제한 (기본 2048MB = 2GB)</span>
        </div>
      </div>
    </section>

    <!-- 3. User CRM & Role/Permission Matrix -->
    <section class="section-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">회원 CRM 및 계정별 권한 관리</h2>
          <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);margin-top:4px;">
            회원별 역할(Owner/Admin/Member/Viewer), 상태(활성/대기/정지), 녹음·공유 권한, 용량 한도, 비밀번호 재설정 및 CRM 메모를 관리합니다.
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input type="search" id="crm-search" class="field-input" placeholder="이름, 이메일, 메모 검색..." oninput="renderUsersTable()" />
          <select id="crm-role-filter" class="field-select" onchange="renderUsersTable()">
            <option value="ALL">전체 역할·상태</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
            <option value="pending">승인 대기 (Pending)</option>
            <option value="suspended">정지됨 (Suspended)</option>
          </select>
          <button class="btn btn-primary" onclick="openCreateUserModal()">+ 신규 회원 추가</button>
        </div>
      </div>

      <div class="crm-table-wrap">
        <table class="crm-table">
          <thead>
            <tr>
              <th>회원 (이름 / 아이디·이메일)</th>
              <th>역할 (Role)</th>
              <th>상태</th>
              <th>세부 권한 (녹음 / 공유 / 자동분석)</th>
              <th>강의 / 공개 / 오류</th>
              <th>오디오 사용량 / 쿼터</th>
              <th>최근 로그인 / 메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody id="crm-users-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- 4. All Lectures & Audit Log -->
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:24px;">
      <section class="section-card">
        <div class="section-head">
          <h2 class="section-title">전체 강의 노트 운영 현황</h2>
        </div>
        <div class="crm-table-wrap">
          <table class="crm-table">
            <thead>
              <tr>
                <th>소유자</th>
                <th>과목 · 제목</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody id="admin-lectures-tbody"></tbody>
          </table>
        </div>
      </section>

      <section class="section-card">
        <div class="section-head">
          <h2 class="section-title">보안 · 권한 감사 로그 (Audit Log)</h2>
        </div>
        <div class="crm-table-wrap">
          <table class="crm-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>계정</th>
                <th>작업 / 상세</th>
              </tr>
            </thead>
            <tbody id="admin-audit-tbody"></tbody>
          </table>
        </div>
      </section>
    </div>
  </main>

  <!-- Edit User CRM & Permissions Modal -->
  <div class="modal-backdrop" id="edit-user-modal">
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font:700 20px/28px var(--elysium-font-sans);" id="eu-modal-title">회원 권한 및 CRM 설정</div>
        <button class="btn btn-sm" onclick="closeAdminModal('edit-user-modal')">✕</button>
      </div>
      <input type="hidden" id="eu-id" />
      <div>
        <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">표시 이름</label>
        <input type="text" id="eu-name" class="field-input" style="width:100%;" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">역할 (Role)</label>
          <select id="eu-role" class="field-select" style="width:100%;">
            <option value="owner">Owner (최고 관리자)</option>
            <option value="admin">Admin (운영 관리자)</option>
            <option value="member">Member (일반 사용자)</option>
            <option value="viewer">Viewer (열람 전용)</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">계정 상태 (Status)</label>
          <select id="eu-status" class="field-select" style="width:100%;">
            <option value="active">Active (정상 이용)</option>
            <option value="pending">Pending (승인 대기)</option>
            <option value="suspended">Suspended (이용 정지)</option>
          </select>
        </div>
      </div>

      <div style="padding:14px 16px;border-radius:12px;background:var(--elysium-surface-subtle);display:flex;flex-direction:column;gap:10px;">
        <div style="font-weight:600;font-size:13px;">세부 기능 권한 (Granular Permissions)</div>
        <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">
          <input type="checkbox" id="eu-can-ingest" style="width:18px;height:18px;accent-color:var(--elysium-action-primary);" />
          <span>오디오 녹음 · 파일 업로드 허용 (<code>can_ingest</code>)</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">
          <input type="checkbox" id="eu-can-share" style="width:18px;height:18px;accent-color:var(--elysium-action-primary);" />
          <span>외부 공개 공유 링크(<code>/s/:token</code>) 전환 허용 (<code>can_share</code>)</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">
          <input type="checkbox" id="eu-can-server-key" style="width:18px;height:18px;accent-color:var(--elysium-action-primary);" />
          <span>노트 자동 정리 엔진 사용 허용</span>
        </label>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">오디오 저장 한도 (MB, 0=무제한)</label>
          <input type="number" id="eu-quota" class="field-input" style="width:100%;" min="0" step="256" />
        </div>
        <div>
          <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">비밀번호 강제 재설정 (선택)</label>
          <input type="password" id="eu-password" class="field-input" style="width:100%;" placeholder="비워두면 유지 (6자 이상)" />
        </div>
      </div>

      <div>
        <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">CRM 메모 (소속 / 학과 / 운영 비고)</label>
        <input type="text" id="eu-memo" class="field-input" style="width:100%;" placeholder="예: 스마트융합보안학과 1학년 / 베타 테스터" />
      </div>

      <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--elysium-text-secondary);cursor:pointer;">
        <input type="checkbox" id="eu-revoke-sessions" style="width:18px;height:18px;accent-color:var(--elysium-action-primary);" />
        <span>저장 시 이 회원의 모든 로그인 기기 세션 강제 만료</span>
      </label>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <button class="btn btn-danger btn-sm" onclick="deleteTargetUser()">계정 및 데이터 삭제</button>
        <div style="display:flex;gap:10px;">
          <button class="btn" onclick="closeAdminModal('edit-user-modal')">취소</button>
          <button class="btn btn-primary" onclick="saveTargetUser()">변경사항 저장</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Create New User Modal -->
  <div class="modal-backdrop" id="create-user-modal">
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font:700 20px/28px var(--elysium-font-sans);">신규 회원 계정 직접 생성</div>
        <button class="btn btn-sm" onclick="closeAdminModal('create-user-modal')">✕</button>
      </div>
      <div>
        <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">아이디 또는 이메일</label>
        <input type="text" id="cu-email" class="field-input" style="width:100%;" placeholder="아이디 또는 이메일 주소" />
      </div>
      <div>
        <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">이름 (닉네임)</label>
        <input type="text" id="cu-name" class="field-input" style="width:100%;" placeholder="예: 홍길동" />
      </div>
      <div>
        <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">초기 비밀번호 (6자 이상)</label>
        <input type="password" id="cu-password" class="field-input" style="width:100%;" placeholder="초기 비밀번호 입력" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">역할 (Role)</label>
          <select id="cu-role" class="field-select" style="width:100%;">
            <option value="member">Member (일반 사용자)</option>
            <option value="viewer">Viewer (열람 전용)</option>
            <option value="admin">Admin (운영 관리자)</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">오디오 쿼터 (MB)</label>
          <input type="number" id="cu-quota" class="field-input" style="width:100%;" value="2048" />
        </div>
      </div>
      <div>
        <label style="display:block;font-weight:600;font-size:13px;margin-bottom:6px;">CRM 메모</label>
        <input type="text" id="cu-memo" class="field-input" style="width:100%;" placeholder="소속/비고 메모" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button class="btn" onclick="closeAdminModal('create-user-modal')">취소</button>
        <button class="btn btn-primary" onclick="submitCreateUser()">회원 생성</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let allUsers = [];
    let recentLectures = [];
    let auditLogs = [];

    const savedTheme = localStorage.getItem('lectern_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-elysium-theme', savedTheme === 'dark' ? 'Dark' : 'Light');
    function toggleTheme() {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.setAttribute('data-elysium-theme', next === 'dark' ? 'Dark' : 'Light');
      localStorage.setItem('lectern_theme', next);
    }

    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const tok = localStorage.getItem('lectern_token');
      if (tok) h['X-Lectern-Token'] = tok;
      return h;
    }

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    function esc(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function loadOverview() {
      const res = await fetch('/api/admin/overview', { headers: authHeaders() });
      if (!res.ok) {
        document.getElementById('admin-auth-warning').style.display = 'block';
        return;
      }
      document.getElementById('admin-auth-warning').style.display = 'none';
      const data = await res.json();
      const m = data.metrics || {};
      allUsers = data.users || [];
      recentLectures = data.recentLectures || [];
      auditLogs = data.auditLogs || [];

      document.getElementById('kpi-users').textContent = m.totalUsers + '명';
      document.getElementById('kpi-users-sub').textContent =
        '활성 ' + m.activeUsers + ' · 대기 ' + m.pendingUsers + ' · 정지 ' + m.suspendedUsers;
      document.getElementById('kpi-lectures').textContent = m.totalLectures + '건';
      document.getElementById('kpi-lectures-sub').textContent =
        '외부 공개 공유 노트 ' + m.publicLectures + '건';
      document.getElementById('kpi-errors').textContent = m.errorLectures + '건';
      document.getElementById('kpi-storage').textContent =
        ((m.totalAudioBytes || 0) / 1048576).toFixed(1) + ' MB';

      const s = data.settings || {};
      document.getElementById('pol-allow-signup').checked = Boolean(s.allow_public_signup);
      document.getElementById('pol-require-approval').checked = Boolean(s.default_require_approval);
      document.getElementById('pol-default-role').value = s.default_user_role || 'member';
      document.getElementById('pol-server-key').checked = Boolean(s.default_can_use_server_key);
      document.getElementById('pol-default-quota').value = s.default_quota_mb ?? 2048;

      renderUsersTable();
      renderLecturesTable();
      renderAuditTable();
    }

    function renderUsersTable() {
      const q = (document.getElementById('crm-search').value || '').trim().toLowerCase();
      const rf = document.getElementById('crm-role-filter').value;
      const filtered = allUsers.filter(u => {
        if (rf !== 'ALL') {
          if (rf === 'pending' || rf === 'suspended') {
            if (u.status !== rf) return false;
          } else if (u.role !== rf) {
            return false;
          }
        }
        if (!q) return true;
        return (
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.memo || '').toLowerCase().includes(q)
        );
      });

      const tbody = document.getElementById('crm-users-tbody');
      tbody.innerHTML = filtered.map(u => {
        const roleCls = u.role === 'owner' || u.role === 'admin' ? '' : 'neutral';
        const statusCls = u.status === 'active' ? 'ok' : u.status === 'pending' ? 'warn' : 'danger';
        const usedMb = ((u.audio_bytes || 0) / 1048576).toFixed(1);
        const quotaLabel = u.quota_mb === 0 ? '무제한' : (u.quota_mb + ' MB');
        const lastLogin = u.last_login_at ? u.last_login_at.slice(0, 16).replace('T', ' ') : '기록 없음';
        const perms = [
          u.can_ingest ? '<span class="badge ok">녹음</span>' : '<span class="badge danger">녹음제한</span>',
          u.can_share ? '<span class="badge ok">공유</span>' : '<span class="badge warn">공유제한</span>',
          u.can_use_server_key ? '<span class="badge neutral">자동분석</span>' : '<span class="badge warn">분석제한</span>'
        ].join(' ');
        const approveBtn = u.status === 'pending'
          ? '<button class="btn btn-primary btn-sm" style="margin-right:6px;" onclick="quickApproveUser(\\'' + u.id + '\\')">승인</button>'
          : '';
        return '<tr>' +
          '<td><div style="font-weight:600;">' + esc(u.display_name) + '</div><div style="font-size:12.5px;color:var(--elysium-text-secondary);font-family:var(--elysium-font-mono);">' + esc(u.email) + '</div></td>' +
          '<td><span class="badge ' + roleCls + '">' + esc(u.role.toUpperCase()) + '</span></td>' +
          '<td><span class="badge ' + statusCls + '">' + esc(u.status.toUpperCase()) + '</span></td>' +
          '<td style="display:flex;gap:4px;flex-wrap:wrap;">' + perms + '</td>' +
          '<td>' + u.lecture_count + '건 <span style="color:var(--elysium-text-tertiary);font-size:12.5px;">(공개 ' + u.public_count + ' / 오류 ' + u.error_count + ')</span></td>' +
          '<td style="font-family:var(--elysium-font-mono);font-size:13px;">' + usedMb + ' MB / ' + quotaLabel + '</td>' +
          '<td><div style="font-size:12.5px;color:var(--elysium-text-secondary);">' + esc(lastLogin) + '</div><div style="font-size:12.5px;color:var(--elysium-text-brand);">' + esc(u.memo || '—') + '</div></td>' +
          '<td style="white-space:nowrap;">' + approveBtn + '<button class="btn btn-sm" onclick="openEditUserModal(\\'' + u.id + '\\')">권한·비번·메모</button></td>' +
        '</tr>';
      }).join('');
    }

    function renderLecturesTable() {
      const tbody = document.getElementById('admin-lectures-tbody');
      if (!recentLectures.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--elysium-text-secondary);">등록된 강의 노트가 없습니다.</td></tr>';
        return;
      }
      tbody.innerHTML = recentLectures.slice(0, 25).map(l => {
        const stBadge = l.status === 'done'
          ? '<span class="badge ok">완료</span>'
          : l.status === 'processing'
          ? '<span class="badge warn">분석중</span>'
          : '<span class="badge danger">오류</span>';
        const retryBtn = l.status === 'error'
          ? '<button class="btn btn-primary btn-sm" onclick="adminRetryLecture(\\'' + l.id + '\\')">재분석</button> '
          : '';
        return '<tr>' +
          '<td><div style="font-weight:600;font-size:13px;">' + esc(l.owner_name || '—') + '</div><div style="font-size:12px;color:var(--elysium-text-secondary);">' + esc(l.owner_email || '') + '</div></td>' +
          '<td><div style="font-weight:600;">[' + esc(l.course) + '] ' + esc(l.title) + '</div><div style="font-size:12px;color:var(--elysium-text-tertiary);">' + esc(l.date_label) + ' · ' + (l.is_public ? '공개' : '비공개') + '</div></td>' +
          '<td>' + stBadge + '</td>' +
          '<td style="white-space:nowrap;">' + retryBtn + '<a class="btn btn-sm" href="/?lecture=' + encodeURIComponent(l.id) + '">열람</a></td>' +
        '</tr>';
      }).join('');
    }

    function renderAuditTable() {
      const tbody = document.getElementById('admin-audit-tbody');
      if (!auditLogs.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--elysium-text-secondary);">감사 로그가 없습니다.</td></tr>';
        return;
      }
      tbody.innerHTML = auditLogs.slice(0, 25).map(a => {
        const ts = (a.created_at || '').slice(5, 19).replace('T', ' ');
        return '<tr>' +
          '<td style="font-family:var(--elysium-font-mono);font-size:12px;color:var(--elysium-text-secondary);white-space:nowrap;">' + esc(ts) + '</td>' +
          '<td style="font-size:13px;font-weight:600;">' + esc(a.actor_email) + '</td>' +
          '<td><div style="font-weight:600;font-size:12.5px;color:var(--elysium-text-brand);">' + esc(a.action) + '</div><div style="font-size:12.5px;color:var(--elysium-text-secondary);">' + esc(a.detail) + '</div></td>' +
        '</tr>';
      }).join('');
    }

    async function savePolicySettings() {
      const body = {
        allow_public_signup: document.getElementById('pol-allow-signup').checked,
        default_require_approval: document.getElementById('pol-require-approval').checked,
        default_user_role: document.getElementById('pol-default-role').value,
        default_can_use_server_key: document.getElementById('pol-server-key').checked,
        default_quota_mb: Number(document.getElementById('pol-default-quota').value || 2048)
      };
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast('가입 및 기본 권한 정책이 저장되었습니다.');
        await loadOverview();
      } else {
        showToast('정책 저장에 실패했습니다.');
      }
    }

    async function quickApproveUser(userId) {
      const res = await fetch('/api/admin/users/' + encodeURIComponent(userId), {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'active' })
      });
      if (res.ok) {
        showToast('회원 가입이 승인되었습니다.');
        await loadOverview();
      }
    }

    function openEditUserModal(userId) {
      const u = allUsers.find(item => item.id === userId);
      if (!u) return;
      document.getElementById('eu-id').value = u.id;
      document.getElementById('eu-modal-title').textContent = u.display_name + ' (' + u.email + ') 관리';
      document.getElementById('eu-name').value = u.display_name || '';
      document.getElementById('eu-role').value = u.role || 'member';
      document.getElementById('eu-status').value = u.status || 'active';
      document.getElementById('eu-can-ingest').checked = Boolean(u.can_ingest);
      document.getElementById('eu-can-share').checked = Boolean(u.can_share);
      document.getElementById('eu-can-server-key').checked = Boolean(u.can_use_server_key);
      document.getElementById('eu-quota').value = u.quota_mb ?? 2048;
      document.getElementById('eu-password').value = '';
      document.getElementById('eu-memo').value = u.memo || '';
      document.getElementById('eu-revoke-sessions').checked = false;
      document.getElementById('edit-user-modal').classList.add('open');
    }

    async function saveTargetUser() {
      const id = document.getElementById('eu-id').value;
      const body = {
        displayName: document.getElementById('eu-name').value.trim(),
        role: document.getElementById('eu-role').value,
        status: document.getElementById('eu-status').value,
        canIngest: document.getElementById('eu-can-ingest').checked,
        canShare: document.getElementById('eu-can-share').checked,
        canUseServerKey: document.getElementById('eu-can-server-key').checked,
        quotaMb: Number(document.getElementById('eu-quota').value || 0),
        memo: document.getElementById('eu-memo').value.trim(),
        revokeSessions: document.getElementById('eu-revoke-sessions').checked
      };
      const newPw = document.getElementById('eu-password').value;
      if (newPw) body.newPassword = newPw;

      const res = await fetch('/api/admin/users/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '수정에 실패했습니다.');
        return;
      }
      closeAdminModal('edit-user-modal');
      showToast('회원 권한 및 CRM 정보가 업데이트되었습니다.');
      await loadOverview();
    }

    async function deleteTargetUser() {
      const id = document.getElementById('eu-id').value;
      const u = allUsers.find(item => item.id === id);
      if (!u) return;
      if (!confirm('정말 [' + u.display_name + ' (' + u.email + ')] 계정과 소유한 모든 강의 노트를 삭제할까요?')) return;
      const res = await fetch('/api/admin/users/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '삭제 실패');
        return;
      }
      closeAdminModal('edit-user-modal');
      showToast('회원 계정이 삭제되었습니다.');
      await loadOverview();
    }

    function openCreateUserModal() {
      document.getElementById('cu-email').value = '';
      document.getElementById('cu-name').value = '';
      document.getElementById('cu-password').value = '';
      document.getElementById('cu-role').value = 'member';
      document.getElementById('cu-quota').value = '2048';
      document.getElementById('cu-memo').value = '';
      document.getElementById('create-user-modal').classList.add('open');
    }

    async function submitCreateUser() {
      const body = {
        email: document.getElementById('cu-email').value.trim(),
        displayName: document.getElementById('cu-name').value.trim(),
        password: document.getElementById('cu-password').value,
        role: document.getElementById('cu-role').value,
        quotaMb: Number(document.getElementById('cu-quota').value || 2048),
        memo: document.getElementById('cu-memo').value.trim()
      };
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '회원 생성 실패');
        return;
      }
      closeAdminModal('create-user-modal');
      showToast('신규 회원이 생성되었습니다.');
      await loadOverview();
    }

    async function adminRetryLecture(id) {
      const res = await fetch('/api/lectures/' + encodeURIComponent(id) + '/retry', {
        method: 'POST',
        headers: authHeaders()
      });
      if (res.ok) {
        showToast('원본 오디오로 재분석이 시작되었습니다.');
        await loadOverview();
      }
    }

    function closeAdminModal(id) {
      document.getElementById(id).classList.remove('open');
    }

    loadOverview();
  </script>
</body>
</html>`;
}
