import { createHash } from "node:crypto";
import { escapeHtml, renderMarkdownToHtml } from "@lectern/core";
import { tokensCss } from "../../../packages/design-tokens/dist/tokens-css.ts";
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
      min-height: 72px;
      height: auto;
      padding: 12px var(--elysium-space-48);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--elysium-space-12);
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
      min-width: 0;
    }
    .brand-mark {
      width: 12px;
      height: 12px;
      border-radius: var(--elysium-radius-pill);
      background: var(--elysium-action-primary);
      flex-shrink: 0;
    }
    .actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--elysium-space-8);
      min-width: 0;
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
      width: 100%;
      margin: 0 auto;
      padding: var(--elysium-space-48) var(--elysium-space-48) var(--elysium-space-64);
      min-width: 0;
    }
    .article-card {
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-24);
      padding: var(--elysium-space-48);
      box-shadow: var(--elysium-shadow-sm);
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--elysium-space-12);
      align-items: center;
      margin-bottom: var(--elysium-space-24);
      min-width: 0;
    }
    .badge {
      padding: 6px 14px;
      border-radius: var(--elysium-radius-pill);
      font: 600 13px/20px var(--elysium-font-sans);
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
      font-variant-numeric: tabular-nums;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge-muted {
      background: var(--elysium-surface-subtle);
      color: var(--elysium-text-secondary);
    }
    .audio-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--elysium-space-16);
      padding: var(--elysium-space-20) var(--elysium-space-24);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      margin-bottom: var(--elysium-space-32);
      min-width: 0;
      max-width: 100%;
    }
    .audio-bar audio { flex: 1 1 200px; min-width: 0; max-width: 100%; height: 40px; }
    .md-body {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .md-body h1, .md-body h2, .md-body h3, .md-body h4 {
      word-break: keep-all;
      overflow-wrap: anywhere;
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
    .md-body p, .md-body li, .md-body td, .md-body th, .md-body a {
      font: 400 16px/28px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .md-code {
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-radius: var(--elysium-radius-12);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      overflow-x: auto;
      max-width: 100%;
      margin: var(--elysium-space-20) 0;
    }
    .md-code code {
      background: none;
      padding: 0;
      color: var(--elysium-text-primary);
      white-space: pre;
      overflow-wrap: normal;
      word-break: normal;
    }
    .md-quote {
      margin: var(--elysium-space-24) 0;
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-left: 4px solid var(--elysium-action-primary);
      background: var(--elysium-action-subtle);
      border-radius: 0 var(--elysium-radius-12) var(--elysium-radius-12) 0;
      word-break: keep-all;
      overflow-wrap: anywhere;
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
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .filter-break { background: var(--elysium-status-warning-surface); color: var(--elysium-status-warning-text); }
    .filter-cut { background: var(--elysium-status-success-surface); color: var(--elysium-status-success-text); }
    @media (max-width: 768px) {
      .share-topbar { padding: 12px var(--elysium-space-20); }
      .container { padding: var(--elysium-space-24) var(--elysium-space-16); }
      .article-card { padding: var(--elysium-space-24) var(--elysium-space-20); border-radius: var(--elysium-radius-16); }
      .md-body h1 { font-size: 24px; line-height: 34px; }
      .md-body h2 { font-size: 20px; line-height: 28px; }
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
      <button class="btn" id="theme-btn" aria-label="테마 전환">테마 전환</button>
      <a class="btn" href="/api/lectures/${encodeURIComponent(lecture.id)}/markdown?share=${encodeURIComponent(lecture.share_token)}" download>Markdown</a>
      <button class="btn btn-primary" id="print-btn">PDF 인쇄</button>
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
  ${pageScriptTag("share.js")}
</body>
</html>`;
}

// Served at /assets/share.js (see PAGE_SCRIPTS) so the page needs no inline script.
const SHARE_PAGE_SCRIPT = `
    const savedTheme = localStorage.getItem('lectern_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-elysium-theme', savedTheme === 'dark' ? 'Dark' : 'Light');
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      document.documentElement.setAttribute('data-elysium-theme', cur === 'dark' ? 'Dark' : 'Light');
      localStorage.setItem('lectern_theme', cur);
    }
    document.getElementById('theme-btn').addEventListener('click', toggleTheme);
    document.getElementById('print-btn').addEventListener('click', () => window.print());
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
`;

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
  <meta name="description" content="Lectern은 강의와 회의 녹음(과 강의 자료 PDF)을 AI로 전사해 구조화된 노트로 정리하고, 녹음에서 찾은 마감·시험·회의 일정을 Lectern 전용 Google 캘린더에 추가할 수 있게 해 주는 워크스페이스입니다." />
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
      grid-template-columns: 400px minmax(0, 1fr);
      height: 100vh;
      width: 100vw;
      max-width: 100vw;
      overflow: hidden;
      background: var(--elysium-surface-canvas);
    }

    /* Sidebar — Elysium Surface/Default + Space/24 Rhythm */
    .sidebar {
      display: flex;
      flex-direction: column;
      background: var(--elysium-surface-default);
      border-right: 1px solid var(--elysium-border-subtle);
      height: 100vh;
      min-width: 0;
      min-height: 0;
      max-width: 100%;
      overflow: hidden;
    }

    .sidebar-top {
      padding: var(--elysium-space-24) var(--elysium-space-24) var(--elysium-space-20);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-20);
      border-bottom: 1px solid var(--elysium-border-subtle);
      min-width: 0;
      flex-shrink: 0;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--elysium-space-8);
      min-width: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: var(--elysium-space-12);
      font: 700 22px/30px var(--elysium-font-sans);
      letter-spacing: -0.01em;
      color: var(--elysium-text-primary);
      min-width: 0;
    }
    .brand-mark {
      width: 12px;
      height: 12px;
      border-radius: var(--elysium-radius-pill);
      background: var(--elysium-action-primary);
      box-shadow: 0 0 0 4px var(--elysium-action-subtle);
      flex-shrink: 0;
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
      max-width: 240px;
      flex-shrink: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 150ms ease;
    }
    .pill span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
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
      flex: 1 1 0%;
      overflow-y: auto;
      overflow-x: hidden;
      padding: var(--elysium-space-20) var(--elysium-space-24);
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-12);
      background: var(--elysium-surface-canvas);
      min-width: 0;
      min-height: 0;
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
      min-width: 0;
      max-width: 100%;
      flex-shrink: 0;
      overflow: hidden;
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
      min-width: 0;
    }
    .card-course {
      font: 600 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-brand);
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-date {
      font: 400 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      font-variant-numeric: tabular-nums;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-title {
      font: 600 16px/24px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      min-width: 0;
      max-width: 100%;
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
      overflow-wrap: anywhere;
      word-break: break-word;
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
      min-width: 0;
      flex-shrink: 0;
    }
    .user-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--elysium-space-8);
      min-width: 0;
    }
    .user-name {
      font: 600 14px/20px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .footer-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--elysium-space-8);
      min-width: 0;
    }
    .footer-actions .btn {
      padding: 0 var(--elysium-space-8);
      font: 600 13px/20px var(--elysium-font-sans);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Main Reader Pane */
    .main-pane {
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      background: var(--elysium-surface-canvas);
    }

    /* Reader Topbar — Responsive Height & Wrapping, Desktop Horizontal Padding 48px */
    .reader-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--elysium-space-12) var(--elysium-space-20);
      min-height: 76px;
      height: auto;
      padding: 12px var(--elysium-space-48);
      border-bottom: 1px solid var(--elysium-border-subtle);
      background: var(--elysium-surface-default);
      flex-shrink: 0;
      min-width: 0;
    }
    .toolbar-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--elysium-space-8);
      min-width: 0;
      flex: 1 1 260px;
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
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta-pill.course {
      background: var(--elysium-action-subtle);
      color: var(--elysium-text-brand);
      max-width: min(260px, 60vw);
      display: inline-block;
      line-height: 32px;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--elysium-space-8);
      min-width: 0;
      max-width: 100%;
    }

    /* Reader Scroll Area — Elysium Desktop Margin 48px, Column Gap 48px */
    .reader-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: var(--elysium-space-48);
      padding: var(--elysium-space-48) var(--elysium-space-48) 96px;
      max-width: 1280px;
      width: 100%;
      min-width: 0;
      margin: 0 auto;
    }

    /* Audio Player Card (Elysium/Desktop/Card 8186:4226 — Padding 24, Radius 16) */
    .audio-bar {
      display: none;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--elysium-space-16);
      padding: var(--elysium-space-20) var(--elysium-space-24);
      margin-bottom: var(--elysium-space-32);
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      box-shadow: var(--elysium-shadow-sm);
      min-width: 0;
      max-width: 100%;
    }
    .audio-bar.visible { display: flex; }
    .audio-bar audio { flex: 1 1 200px; min-width: 0; max-width: 100%; height: 40px; }
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
      max-width: 100%;
      overflow: hidden;
    }

    /* Markdown Article Typography (Elysium Section 4.1 Type Scale) */
    .md-article {
      min-width: 0;
      max-width: 100%;
      color: var(--elysium-text-primary);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .md-article h1, .md-article h2, .md-article h3, .md-article h4 {
      color: var(--elysium-text-primary);
      word-break: keep-all;
      overflow-wrap: anywhere;
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
    .md-article p, .md-article li, .md-article td, .md-article th, .md-article a {
      font: 400 16px/28px var(--elysium-font-sans);
      color: var(--elysium-text-primary);
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .md-code {
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-radius: var(--elysium-radius-12);
      background: var(--elysium-surface-subtle);
      border: 1px solid var(--elysium-border-subtle);
      overflow-x: auto;
      max-width: 100%;
      margin: var(--elysium-space-24) 0;
    }
    .md-code code {
      background: none;
      padding: 0;
      color: var(--elysium-text-primary);
      white-space: pre;
      overflow-wrap: normal;
      word-break: normal;
    }
    .md-quote {
      margin: var(--elysium-space-24) 0;
      padding: var(--elysium-space-20) var(--elysium-space-24);
      border-left: 4px solid var(--elysium-action-primary);
      background: var(--elysium-action-subtle);
      border-radius: 0 var(--elysium-radius-12) var(--elysium-radius-12) 0;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    .md-quote p { margin: 6px 0; color: var(--elysium-text-primary); }
    .md-hr {
      border: 0;
      border-top: 1px solid var(--elysium-border-subtle);
      margin: var(--elysium-space-40) 0;
    }
    .md-table-wrap {
      overflow-x: auto;
      max-width: 100%;
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
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
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
      overflow-x: hidden;
      min-width: 0;
    }
    .toc-title {
      font: 600 13px/20px var(--elysium-font-sans);
      color: var(--elysium-text-brand);
      margin-bottom: var(--elysium-space-16);
    }
    .toc-link {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      overflow-wrap: anywhere;
      word-break: break-word;
      font: 400 14px/22px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
      text-decoration: none;
      margin: 6px 0;
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
      min-width: 0;
      background: var(--elysium-surface-elevated);
      border: 1px solid var(--elysium-border-subtle);
      border-radius: var(--elysium-radius-16);
      padding: var(--elysium-space-32);
      box-shadow: var(--elysium-shadow-lg);
      max-height: 90vh;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-20);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--elysium-space-12);
      min-width: 0;
    }
    .modal-title {
      font: 700 20px/30px var(--elysium-font-sans);
      letter-spacing: -0.003em;
      color: var(--elysium-text-primary);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
      max-width: calc(100vw - 32px);
      padding: var(--elysium-space-16) var(--elysium-space-20);
      border-radius: var(--elysium-radius-12);
      background: var(--elysium-surface-inverse);
      color: var(--elysium-surface-default);
      font: 600 14px/20px var(--elysium-font-sans);
      box-shadow: var(--elysium-shadow-md);
      overflow-wrap: anywhere;
      word-break: break-word;
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

    @media (max-width: 1280px) {
      .app-shell { grid-template-columns: 340px minmax(0, 1fr); }
      .reader-scroll {
        grid-template-columns: minmax(0, 1fr);
        padding: var(--elysium-space-32) var(--elysium-space-32) 96px;
      }
      .toc-rail { display: none; }
      .reader-toolbar { padding: 12px var(--elysium-space-32); }
    }

    @media (max-width: 1024px) {
      .app-shell { grid-template-columns: minmax(0, 1fr); }
      .sidebar {
        position: fixed;
        inset: 0 0 64px 0;
        z-index: 35;
        display: none;
      }
      .sidebar.mobile-open { display: flex; }
      .reader-toolbar {
        padding: 12px var(--elysium-space-20);
        min-height: 64px;
        height: auto;
      }
      .reader-scroll {
        grid-template-columns: minmax(0, 1fr);
        padding: var(--elysium-space-20) var(--elysium-space-20) 104px;
        gap: var(--elysium-space-24);
      }
      .document-sheet {
        padding: var(--elysium-space-24);
        border-radius: var(--elysium-radius-16);
      }
      .toc-rail { display: none; }
      .mobile-tabbar { display: flex; }
      .client-grid { grid-template-columns: minmax(0, 1fr); }
      .btn { height: var(--elysium-size-touch-min); }
      .field-input, .search-input { height: var(--elysium-size-touch-min); }
      .toast {
        left: 16px;
        right: 16px;
        bottom: calc(76px + env(safe-area-inset-bottom));
      }
    }

    @media (max-width: 640px) {
      .modal-backdrop { padding: var(--elysium-space-16); }
      .modal-card { padding: var(--elysium-space-20); }
      .document-sheet { padding: var(--elysium-space-20) var(--elysium-space-16); }
      .md-article h1 { font-size: 24px; line-height: 34px; }
      .md-article h2 { font-size: 20px; line-height: 28px; }
      .toolbar-actions { width: 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; padding-bottom: 2px; }
      .toolbar-actions::-webkit-scrollbar { display: none; }
      .toolbar-actions .btn { height: 38px; padding: 0 12px; font-size: 13px; flex-shrink: 0; }
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
      overflow-y: auto;
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

    /* Public intro beside the login card: the logged-out / doubles as the homepage that
       Google OAuth verification requires (what the app does + privacy/terms links).
       margin:auto centres the layout without clipping its top when the gate scrolls. */
    .auth-layout {
      margin: auto;
      width: 100%;
      max-width: 1000px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--elysium-space-48);
    }
    .auth-layout .auth-card { flex: 0 1 440px; }
    .auth-about {
      flex: 1 1 0;
      min-width: 0;
      max-width: 500px;
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-20);
      word-break: keep-all;
    }
    .auth-about-title {
      margin: 0;
      font: 700 30px/40px var(--elysium-font-sans);
      letter-spacing: -0.02em;
      color: var(--elysium-text-primary);
    }
    .auth-about-lead {
      margin: 0;
      font: 400 16px/26px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
    }
    .auth-about-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--elysium-space-12);
    }
    .auth-about-list li {
      padding: var(--elysium-space-16) var(--elysium-space-20);
      border-radius: var(--elysium-radius-16);
      background: var(--elysium-surface-default);
      border: 1px solid var(--elysium-border-subtle);
      font: 400 15px/23px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
    }
    .auth-about-list strong {
      display: block;
      margin-bottom: var(--elysium-space-4);
      font-weight: 600;
      color: var(--elysium-text-primary);
    }
    .auth-about-links {
      display: flex;
      flex-wrap: wrap;
      gap: var(--elysium-space-8) var(--elysium-space-20);
      font: 600 14px/20px var(--elysium-font-sans);
    }
    .auth-about-links a, .auth-about-contact a {
      color: var(--elysium-text-brand);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .auth-about-contact {
      margin: 0;
      font: 400 14px/22px var(--elysium-font-sans);
      color: var(--elysium-text-secondary);
    }
    @media (max-width: 900px) {
      .auth-layout {
        flex-direction: column;
        align-items: stretch;
        max-width: 440px;
        gap: var(--elysium-space-32);
      }
      .auth-layout .auth-card { flex: none; }
      .auth-about { max-width: none; gap: var(--elysium-space-16); }
      .auth-about-title { font-size: 24px; line-height: 32px; }
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
    <div class="auth-layout">
      <section class="auth-about" id="auth-about" aria-labelledby="auth-about-title">
        <h1 class="auth-about-title" id="auth-about-title">녹음을 전사와 정리된 노트로, Lectern</h1>
        <p class="auth-about-lead">Lectern은 강의와 회의 녹음을 AI로 전사하고 다시 보기 쉬운 노트로 정리해 주는 개인 워크스페이스입니다.</p>
        <ul class="auth-about-list">
          <li><strong>녹음 → 전사·노트</strong>녹음 파일을 올리면(강의 자료 PDF도 함께 올릴 수 있습니다) 전사본과 목차가 있는 구조화된 노트를 만듭니다.</li>
          <li><strong>일정 → Google 캘린더</strong>녹음에서 찾은 과제 마감, 시험, 회의 일정을 확인한 뒤 Lectern 전용 Google 캘린더에 추가할 수 있습니다. 캘린더 연결은 선택이며, Lectern은 직접 만든 "Lectern" 캘린더에만 일정을 쓰고 다른 캘린더는 읽지도 쓰지도 않습니다.</li>
        </ul>
        <nav class="auth-about-links" aria-label="정책 문서">
          <a href="/privacy">개인정보처리방침</a>
          <a href="/terms">이용약관</a>
        </nav>
        <p class="auth-about-contact">문의: <a href="/privacy#contact">개인정보처리방침의 문의처</a>로 이메일을 보내 주세요.</p>
      </section>
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
        <button type="button" class="auth-tab active" id="tab-login-btn" data-action="auth-mode" data-auth-mode="login">로그인</button>
        <button type="button" class="auth-tab" id="tab-reg-btn" data-action="auth-mode" data-auth-mode="register">회원가입</button>
        <button type="button" class="auth-tab" id="tab-reset-btn" data-action="auth-mode" data-auth-mode="reset">비번 재설정</button>
      </div>

      <form id="auth-form" style="display:flex;flex-direction:column;gap:var(--elysium-space-16);">
        <div id="auth-name-wrap" class="field-group" style="display:none;">
          <label class="field-label" for="auth-name">이름 (닉네임)</label>
          <input type="text" id="auth-name" class="field-input" placeholder="표시할 이름 입력" autocomplete="name" />
        </div>
        <div class="field-group">
          <label class="field-label" for="auth-email" id="auth-email-label">아이디 또는 이메일</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="auth-email" class="field-input" style="flex:1;" placeholder="아이디 또는 이메일 주소" autocomplete="username" required />
            <button type="button" class="btn" id="btn-send-code" style="display:none;flex-shrink:0;" data-action="send-code">인증번호 발송</button>
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
          <button class="btn btn-icon" data-action="toggle-theme" title="라이트/다크 테마 전환" aria-label="테마 전환">
            <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          </button>
        </div>

        <!-- Single Primary Action in Sidebar Area (Elysium Principle: One Primary Action per Region) -->
        <button class="btn btn-primary btn-lg" style="width:100%;" data-action="open-recorder">
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
            <button class="btn" style="height:32px;padding:0 10px;font-size:12.5px;" data-action="logout">로그아웃</button>
          </div>
        </div>
        <div class="footer-actions">
          <button class="btn btn-subtle" data-action="open-cleanup">기록·용량</button>
          <button class="btn btn-subtle" data-action="open-clients">기기 연동</button>
          <button class="btn btn-subtle" data-action="open-settings">계정·비번</button>
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
          <button class="btn" id="btn-visibility" data-action="toggle-visibility" title="공유 링크 공개/비공개 전환">비공개</button>
          <button class="btn" id="btn-edit" data-action="toggle-editor">노트 편집</button>
          <button class="btn" id="btn-md" data-action="download-markdown">MD 저장</button>
          <button class="btn" id="btn-pdf" data-action="print">PDF 인쇄</button>
          <button class="btn" id="btn-cleanup" data-action="open-cleanup" title="기록 정리, 과목 이동, 오디오 관리 및 삭제">관리·삭제</button>
          <button class="btn btn-primary" id="btn-share" data-action="share-lecture">공유 링크 복사</button>
        </div>
      </header>

      <div class="reader-scroll" id="reader-scroll">
        <div style="min-width:0;">
          <div class="audio-bar" id="audio-bar">
            <span style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);white-space:nowrap;">원본 강의 오디오</span>
            <audio id="lecture-audio" controls preload="metadata"></audio>
            <select class="speed-select" id="audio-speed" aria-label="재생 배속">
              <option value="1">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="1.75">1.75x</option>
              <option value="2">2.0x</option>
            </select>
            <button class="btn" data-action="download-audio">원본 저장</button>
          </div>

          <div class="document-sheet">
            <article class="md-article" id="md-article">
              <div style="padding:var(--elysium-space-32) 0;text-align:center;">
                <h2 style="font:600 20px/30px var(--elysium-font-sans);color:var(--elysium-text-primary);margin:0 0 8px;">선택된 강의 노트가 없습니다</h2>
                <p style="font:400 16px/24px var(--elysium-font-sans);color:var(--elysium-text-secondary);margin:0 0 24px;">왼쪽 라이브러리에서 강의를 선택하거나 새 강의를 녹음해 보세요.</p>
                <button class="btn btn-primary" data-action="open-recorder">새 강의 녹음 시작</button>
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
                <button class="btn" data-action="close-editor">취소</button>
                <button class="btn btn-primary" data-action="save-edit">변경사항 저장</button>
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
    <button class="tab-btn" id="tab-list" data-action="mobile-tab" data-tab="list">
      <svg class="icon-svg" viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
      <span>라이브러리</span>
    </button>
    <button class="tab-btn active" id="tab-reader" data-action="mobile-tab" data-tab="reader">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      <span>노트 리더</span>
    </button>
    <button class="tab-btn" data-action="open-recorder">
      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
      <span>녹음·업로드</span>
    </button>
  </nav>

  <!-- Recorder & Upload Modal (Elysium/Desktop/Overlay) -->
  <div class="modal-backdrop" id="recorder-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">실시간 강의 녹음 및 오디오 증류</div>
        <button class="btn btn-icon" data-action="close-modal" data-modal="recorder-modal" aria-label="닫기">✕</button>
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
        <button class="btn btn-primary btn-lg" id="btn-rec-start" style="flex:1;" data-action="toggle-mic">마이크 녹음 시작</button>
        <button class="btn btn-lg" id="btn-rec-pause" style="display:none;" data-action="pause-recording">일시정지</button>
      </div>

      <label style="display:flex;align-items:center;gap:12px;font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-secondary);cursor:pointer;">
        <input type="checkbox" id="chk-local-save" style="width:20px;height:20px;accent-color:var(--elysium-action-primary);" checked />
        <span>녹음 종료 시 내 기기에 원본 오디오 파일 즉시 백업 + 브라우저 금고(IndexedDB) 이중 보호</span>
      </label>

      <div id="local-vault-box" style="display:none;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-status-warning-surface);border:1px solid var(--elysium-status-warning-text);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-status-warning-text);" id="local-vault-title">미전송 로컬 녹음 보관함 (네트워크 장애 보호됨)</span>
          <button class="btn" style="height:32px;padding:0 12px;font-size:13px;" data-action="retry-all-uploads">전체 재업로드</button>
        </div>
        <div id="local-vault-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>

      <div class="dropzone" id="dropzone" data-action="pick-file">
        <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">오디오 파일 드래그 앤 드롭 또는 클릭하여 선택</div>
        <div style="font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-secondary);">지원 포맷: .m4a (음성메모), .mp3, .webm, .wav, .ogg (최대 200MB)</div>
        <input type="file" id="file-input" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" style="display:none" />
      </div>

      <div id="ingest-status" style="padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-action-subtle);color:var(--elysium-text-brand);font:600 14px/20px var(--elysium-font-sans);display:none;"></div>
    </div>
  </div>

  <!-- Native Clients & Shortcuts Modal -->
  <div class="modal-backdrop" id="clients-modal">
    <div class="modal-card" style="max-width:680px;">
      <div class="modal-header">
        <div class="modal-title">멀티플랫폼 네이티브 앱 & 퀵액션 연동</div>
        <button class="btn btn-icon" data-action="close-modal" data-modal="clients-modal" aria-label="닫기">✕</button>
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
          <button class="btn" style="height:32px;padding:0 12px;font-size:13px;" data-action="copy-api-token">토큰 복사</button>
        </div>
        <code id="my-api-token-code" style="display:block;margin-bottom:16px;padding:10px 14px;background:var(--elysium-surface-default);border:1px solid var(--elysium-border-subtle);border-radius:var(--elysium-radius-8);font:500 14px/20px var(--elysium-font-mono);color:var(--elysium-text-brand);overflow-x:auto;overflow-wrap:anywhere;word-break:break-all;max-width:100%;">lct_...</code>
        <div style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:8px;">원클릭 HTTP Ingest API (cURL / 단축어 연동)</div>
        <code id="my-curl-snippet" style="display:block;white-space:pre-wrap;font:500 13px/20px var(--elysium-font-mono);color:var(--elysium-text-secondary);overflow-x:auto;overflow-wrap:anywhere;word-break:break-all;max-width:100%;">curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\
  -H "X-Lectern-Token: &lt;내_API_토큰&gt;" \\
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
        <button class="btn btn-icon" data-action="close-modal" data-modal="settings-modal" aria-label="닫기">✕</button>
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
            <button type="button" class="btn" data-action="save-display-name">이름 변경</button>
          </div>
        </div>
      </div>

      <!-- Self-Service Password Change -->
      <form id="pw-change-form" style="padding:20px;border-radius:var(--elysium-radius-16);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);display:flex;flex-direction:column;gap:14px;">
        <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);">비밀번호 변경</div>
        <div class="field-group">
          <label class="field-label" for="pw-current">현재 비밀번호</label>
          <input type="password" id="pw-current" class="field-input" placeholder="현재 비밀번호 입력" autocomplete="current-password" required />
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
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
          <button type="button" class="btn" data-action="rotate-api-token">기기 연동 API 토큰 재발급</button>
          <div style="display:flex;gap:10px;">
            <button type="button" class="btn" data-action="close-modal" data-modal="settings-modal">닫기</button>
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
        <button class="btn btn-icon" data-action="close-modal" data-modal="cleanup-modal" aria-label="닫기">✕</button>
      </div>

      <div id="cleanup-current-box" style="padding:20px;border-radius:var(--elysium-radius-16);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);display:flex;flex-direction:column;gap:16px;min-width:0;">
        <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;" id="cleanup-cur-title">현재 선택된 강의 노트</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" id="cleanup-vis-btn" data-action="toggle-visibility">공개/비공개 전환</button>
          <button class="btn" data-action="rotate-share-token">공유 링크 재발급 (기존 링크 차단)</button>
        </div>
        <div class="field-group">
          <label class="field-label" for="cleanup-move-course">과목 이동</label>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="cleanup-move-course" class="field-input" style="flex:1 1 180px;min-width:0;" placeholder="변경할 과목명 입력" />
            <button class="btn" data-action="move-course">과목 변경</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" id="cleanup-audio-btn" data-action="delete-audio">원본 오디오만 삭제 (노트 보존)</button>
          <button class="btn btn-danger" data-action="delete-lecture">이 강의 노트 영구 삭제</button>
        </div>
      </div>

      <div style="font:600 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);">워크스페이스 일괄 기록 정리</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
          <div style="min-width:0;flex:1 1 220px;">
            <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">실패·중단된 분석 기록 정리</div>
            <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">오류 상태이거나 15분 이상 멈춘 미완료 기록과 임시 파일을 삭제합니다.</div>
          </div>
          <button class="btn" style="flex-shrink:0;" data-action="workspace-cleanup" data-cleanup-mode="failed">일괄 정리</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
          <div style="min-width:0;flex:1 1 220px;">
            <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">짧은 테스트·단편 녹음(15초 미만) 정리</div>
            <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">실수로 눌렸거나 테스트로 녹음된 짧은 단편 노트를 일괄 삭제합니다.</div>
          </div>
          <button class="btn" style="flex-shrink:0;" data-action="workspace-cleanup" data-cleanup-mode="short_fragments">단편 삭제</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-subtle);border:1px solid var(--elysium-border-subtle);">
          <div style="min-width:0;flex:1 1 220px;">
            <div style="font:600 15px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:4px;">완료된 모든 노트의 원본 음성파일 비우기</div>
            <div style="font:400 14px/20px var(--elysium-font-sans);color:var(--elysium-text-secondary);">마크다운 강의 노트는 영구 보존하고 대용량 원본 오디오만 정리합니다.</div>
          </div>
          <button class="btn" style="flex-shrink:0;" data-action="workspace-cleanup" data-cleanup-mode="audio_only_all">오디오 비우기</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  ${pageScriptTag("app.js")}
</body>
</html>`;
}

// Served at /assets/app.js (see PAGE_SCRIPTS) so the page needs no inline script.
const APP_PAGE_SCRIPT = `
    let lectures = [];
    let currentLecture = null;
    let activeCourse = 'ALL';
    let searchQuery = '';
    let currentUser = null;
    let authMode = 'login';
    let sseSource = null;
    let sseUserId = null;
    let sseNeedsResync = false;
    let sseReconnectTimer = null;
    let sseRetryDelay = 2000;
    let pollFailures = 0;
    let editorLectureId = null;
    let editorDirty = false;
    let editorBase = null;
    let editorConflictWarned = false;
    const PENDING_LOGOUT_KEY = 'lectern_pending_logout';

    // Same-origin requests (fetch, EventSource, <audio>, downloads) authenticate with the
    // HttpOnly lectern_session cookie, so the session token is never kept in JS-readable storage.
    try { localStorage.removeItem('lectern_token'); } catch {}

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
        closeEditor();
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

    function disconnectRealtimeSSE() {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
      if (sseSource) {
        try { sseSource.close(); } catch {}
        sseSource = null;
      }
      sseUserId = null;
    }

    function connectRealtimeSSE() {
      disconnectRealtimeSSE();
      const es = new EventSource('/api/events');
      sseSource = es;
      sseUserId = currentUser ? currentUser.id : null;

      const badge = document.getElementById('sse-status-pill');
      es.addEventListener('connected', () => {
        sseRetryDelay = 2000;
        if (badge) {
          badge.textContent = '실시간 동기화';
          badge.style.color = 'var(--elysium-status-success-text)';
          badge.style.background = 'var(--elysium-status-success-surface)';
        }
        // Events broadcast while the stream was down are not replayed, so catch up on reconnect.
        if (sseNeedsResync) {
          sseNeedsResync = false;
          fetchLectures().catch(err => console.error('Lecture resync after SSE reconnect failed:', err));
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
        if (sseSource !== es) return;
        sseNeedsResync = true;
        if (badge) {
          badge.textContent = '재연결 중...';
          badge.style.color = 'var(--elysium-status-warning-text)';
          badge.style.background = 'var(--elysium-status-warning-surface)';
        }
        // The browser retries on its own unless the stream was closed for good (e.g. an HTTP error).
        if (es.readyState === EventSource.CLOSED) {
          sseSource = null;
          clearTimeout(sseReconnectTimer);
          sseReconnectTimer = setTimeout(() => {
            if (currentUser) connectRealtimeSSE();
          }, sseRetryDelay);
          sseRetryDelay = Math.min(sseRetryDelay * 2, 60000);
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
      return Object.assign({}, extra || {});
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
      try { localStorage.removeItem(PENDING_LOGOUT_KEY); } catch {}
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
        curlEl.textContent = 'curl -X POST https://lectern.qucord.com/api/ingest/shortcut \\\\\\n  -H "X-Lectern-Token: ' + user.apiToken + '" \\\\\\n  -H "X-Course: 정보보호개론" \\\\\\n  -F "audio=@20261014_lecture.m4a"';
      }
      if (!sseSource || sseUserId !== user.id) {
        connectRealtimeSSE();
      }
      renderLocalVaultList();
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
      disconnectRealtimeSSE();
      try { localStorage.removeItem('lectern_token'); } catch {}
      let serverLoggedOut = false;
      try {
        const res = await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
        serverLoggedOut = res.ok;
      } catch {}
      // The HttpOnly session cookie can only be cleared by the server, so if this request
      // failed (e.g. offline) remember to finish the logout before the next auto-login.
      try {
        if (serverLoggedOut) localStorage.removeItem(PENDING_LOGOUT_KEY);
        else localStorage.setItem(PENDING_LOGOUT_KEY, '1');
      } catch {}
      currentUser = null;
      lectures = [];
      currentLecture = null;
      clearTimeout(window.__pollTimer);
      closeEditor();
      const audioEl = document.getElementById('lecture-audio');
      if (audioEl) {
        try { audioEl.pause(); } catch {}
        audioEl.removeAttribute('src');
      }
      document.getElementById('audio-bar').classList.remove('visible');
      document.getElementById('lecture-list').innerHTML = '';
      document.getElementById('md-article').innerHTML = '';
      document.getElementById('toc-list').innerHTML = '';
      document.getElementById('auth-gate').classList.remove('hidden');
      await renderLocalVaultList();
      if (!serverLoggedOut) {
        showToast('서버에 연결하지 못해 로그아웃을 완료하지 못했습니다. 다음 접속 시 자동으로 로그아웃됩니다.');
      }
    }

    async function bootstrapAuth() {
      const gate = document.getElementById('auth-gate');
      let pendingLogout = false;
      try { pendingLogout = localStorage.getItem(PENDING_LOGOUT_KEY) === '1'; } catch {}
      if (pendingLogout) {
        try {
          const out = await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
          if (out.ok) localStorage.removeItem(PENDING_LOGOUT_KEY);
        } catch {}
        gate.classList.remove('hidden');
        return;
      }
      let res;
      try {
        res = await fetch('/api/auth/me', { headers: authHeaders() });
      } catch (err) {
        console.error('Auth bootstrap failed:', err);
        gate.classList.remove('hidden');
        return;
      }
      if (!res.ok) {
        gate.classList.remove('hidden');
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
        return '<button type="button" class="' + cls + '" aria-pressed="' + isAct + '" title="' + escapeClientHtml(label) + '" data-course="' + escapeClientHtml(c) + '">' + check + '<span>' + escapeClientHtml(label) + '</span></button>';
      }).join('');

      const quickWrap = document.getElementById('quick-course-chips');
      if (quickWrap) {
        quickWrap.innerHTML = courses.map(c =>
          '<button type="button" class="pill" style="height:36px;padding:0 14px;" title="' + escapeClientHtml(c) + '" data-course="' + escapeClientHtml(c) + '"><span>' + escapeClientHtml(c) + '</span></button>'
        ).join('');
      }
    }

    document.getElementById('course-pills').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-course]');
      if (!btn) return;
      setCourseFilter(btn.dataset.course);
    });

    document.getElementById('quick-course-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-course]');
      if (!btn) return;
      document.getElementById('rec-course').value = btn.dataset.course;
    });

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
          ? '<div class="card-progress"><div class="card-progress-bar" style="width:' + (item.progress || 15) + '%"></div></div><div style="font:600 13px/20px var(--elysium-font-sans);color:var(--elysium-text-brand);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeClientHtml(item.stage_message || '분석 중...') + ' (' + (item.progress || 15) + '%)</div>'
          : item.status === 'error'
          ? '<div style="font:600 13px/20px var(--elysium-font-sans);color:var(--elysium-status-danger-text);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">분석 실패 · 원본 재분석 가능</div>'
          : '';
        return '<div class="lecture-card ' + (isAct ? 'active' : '') + '" data-lecture-id="' + escapeClientHtml(item.id) + '">' +
          '<div class="card-top">' +
            '<span class="card-course" title="' + escapeClientHtml(item.course) + '">' + escapeClientHtml(item.course) + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;flex-shrink:0;">' + durBadge + visBadge + uuidBadge + '</span>' +
          '</div>' +
          '<div class="card-title" title="' + escapeClientHtml(item.title) + '">' + escapeClientHtml(item.title) + '</div>' +
          '<div style="font:500 12px/18px var(--elysium-font-mono);color:var(--elysium-text-secondary);margin-top:-2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">녹음 일시: ' + escapeClientHtml(item.date_label) + '</div>' +
          '<div class="card-excerpt">' + escapeClientHtml(item.excerpt || '') + '</div>' +
          progHtml +
        '</div>';
      }).join('');

      ensureFallbackPolling();
    }

    function escapeClientHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    document.getElementById('lecture-list').addEventListener('click', (e) => {
      const card = e.target.closest('.lecture-card[data-lecture-id]');
      if (!card) return;
      selectLecture(card.dataset.lectureId, true, { userInitiated: true });
    });

    // Background refreshes (SSE, polling, search, post-upload) never discard unsaved editor
    // content; only a user-initiated switch to another lecture may, after confirmation.
    async function selectLecture(id, closeMobileList, opts) {
      const options = opts || {};
      if (hasUnsavedEdits() && editorLectureId !== id) {
        if (!options.userInitiated) return;
        if (!confirm('저장하지 않은 노트 편집 내용이 있습니다. 변경사항을 버리고 다른 강의로 이동할까요?')) return;
        closeEditor();
      }
      const res = await fetch('/api/lectures/' + encodeURIComponent(id), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (hasUnsavedEdits() && editorLectureId !== id) return;
      currentLecture = data.lecture;
      renderLectureList();

      document.getElementById('cur-course').textContent = currentLecture.course;
      document.getElementById('cur-course').title = currentLecture.course || '';
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
        renderProcessingArticle(currentLecture);
        ensureFallbackPolling();
      } else if (currentLecture.status === 'error') {
        art.innerHTML =
          '<div style="padding:32px;border-radius:var(--elysium-radius-16);background:var(--elysium-status-danger-surface);border:1px solid var(--elysium-status-danger-text);max-width:600px;margin:24px auto;">' +
            '<div style="font:700 20px/30px var(--elysium-font-sans);color:var(--elysium-status-danger-text);margin-bottom:8px;">분석 중 일시적 장애가 발생했습니다</div>' +
            '<div style="font:400 14px/22px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:16px;word-break:break-all;">' + escapeClientHtml(currentLecture.error_message || '알 수 없는 오류') + '</div>' +
            '<div style="font:400 16px/24px var(--elysium-font-sans);color:var(--elysium-text-primary);margin-bottom:24px;">서버 디스크에 원본 음성 파일이 안전하게 보존되어 있습니다. 아래 버튼으로 즉시 재분석하거나 원본 음성을 다운로드할 수 있습니다.</div>' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
              '<button class="btn btn-primary" data-action="retry-distillation">보존된 원본 오디오로 재분석</button>' +
              '<button class="btn" data-action="download-audio">원본 오디오 다운로드</button>' +
              '<button class="btn btn-danger" data-action="delete-lecture">기록 삭제</button>' +
            '</div>' +
          '</div>';
      } else {
        art.innerHTML = data.rendered.html;
      }

      const tocList = document.getElementById('toc-list');
      tocList.innerHTML = (data.rendered?.toc || []).map(t =>
        '<a class="toc-link lvl-' + escapeClientHtml(t.level) + '" href="#' + escapeClientHtml(t.id) + '" title="' + escapeClientHtml(t.text) + '">' + escapeClientHtml(t.text) + '</a>'
      ).join('');

      if (isEditorOpen() && editorLectureId === currentLecture.id) {
        if (!editorDirty) {
          fillEditorFields(currentLecture);
        } else if (editorBase && editorBase.markdown !== currentLecture.markdown && !editorConflictWarned) {
          editorConflictWarned = true;
          showToast('다른 곳에서 이 노트가 변경되었습니다. 저장하면 현재 편집 내용으로 덮어씁니다.');
        }
      } else {
        closeEditor();
      }
      if (closeMobileList && window.innerWidth <= 1024) {
        switchMobileTab('reader');
      }
    }

    function ensureFallbackPolling() {
      clearTimeout(window.__pollTimer);
      if (!currentUser) return;
      const hasProcessing = lectures.some(l => l.status === 'processing') || (currentLecture && currentLecture.status === 'processing');
      if (!hasProcessing) return;
      const delay = Math.min(2400 * Math.pow(2, pollFailures), 30000);
      window.__pollTimer = setTimeout(async () => {
        try {
          const prevProcIds = new Set(lectures.filter(l => l.status === 'processing').map(l => l.id));
          const params = new URLSearchParams();
          if (activeCourse !== 'ALL') params.set('course', activeCourse);
          if (searchQuery) params.set('q', searchQuery);
          const res = await fetch('/api/lectures?' + params.toString(), { headers: authHeaders() });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          pollFailures = 0;
          lectures = data.lectures || [];
          renderLectureList();
          if (currentLecture) {
            const updatedItem = lectures.find(l => l.id === currentLecture.id);
            if (updatedItem && (prevProcIds.has(currentLecture.id) || currentLecture.status === 'processing')) {
              await selectLecture(currentLecture.id, false);
            }
          }
        } catch (err) {
          pollFailures = Math.min(pollFailures + 1, 4);
          console.error('Fallback polling failed:', err);
        } finally {
          ensureFallbackPolling();
        }
      }, delay);
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
        const fullTitle = '현재 노트: ' + currentLecture.title + (isPub ? ' (공유 링크 열림)' : ' (비공개)');
        curTitle.textContent = fullTitle;
        curTitle.title = fullTitle;
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

    function isEditorOpen() {
      return document.getElementById('editor-pane').classList.contains('visible');
    }

    function hasUnsavedEdits() {
      return isEditorOpen() && editorDirty;
    }

    function fillEditorFields(lec) {
      editorBase = { title: lec.title || '', course: lec.course || '', markdown: lec.markdown || '' };
      document.getElementById('edit-title').value = editorBase.title;
      document.getElementById('edit-course').value = editorBase.course;
      document.getElementById('edit-markdown').value = editorBase.markdown;
      editorDirty = false;
      editorConflictWarned = false;
    }

    function closeEditor() {
      document.getElementById('editor-pane').classList.remove('visible');
      document.getElementById('md-article').style.display = 'block';
      editorLectureId = null;
      editorDirty = false;
      editorBase = null;
      editorConflictWarned = false;
    }

    ['edit-title', 'edit-course', 'edit-markdown'].forEach(fieldId => {
      document.getElementById(fieldId).addEventListener('input', () => {
        if (isEditorOpen()) editorDirty = true;
      });
    });

    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedEdits()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    function toggleEditor(force) {
      if (!currentLecture) return;
      const show = typeof force === 'boolean' ? force : !isEditorOpen();
      if (show) {
        if (!isEditorOpen() || editorLectureId !== currentLecture.id) {
          fillEditorFields(currentLecture);
        }
        editorLectureId = currentLecture.id;
        document.getElementById('editor-pane').classList.add('visible');
        document.getElementById('md-article').style.display = 'none';
      } else {
        if (hasUnsavedEdits() && !confirm('저장하지 않은 변경사항을 버릴까요?')) return;
        closeEditor();
      }
    }

    async function saveMarkdownEdit() {
      if (!currentLecture) return;
      const lectureId = editorLectureId || currentLecture.id;
      const title = document.getElementById('edit-title').value.trim();
      const course = document.getElementById('edit-course').value.trim();
      const markdown = document.getElementById('edit-markdown').value;
      let res;
      try {
        res = await fetch('/api/lectures/' + encodeURIComponent(lectureId), {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ title, course, markdown })
        });
      } catch {
        showToast('네트워크 오류로 저장하지 못했습니다. 편집 내용은 그대로 남아 있습니다.');
        return;
      }
      if (!res.ok) {
        let errMsg = '';
        try { errMsg = (await res.json()).error || ''; } catch {}
        showToast((errMsg || '저장에 실패했습니다.') + ' 편집 내용은 그대로 남아 있습니다.');
        return;
      }
      // Saved: close the editor so the refetch below renders the persisted note.
      closeEditor();
      showToast('강의 노트가 저장되었습니다.');
      await fetchLectures(lectureId);
    }

    function downloadCurrentMarkdown() {
      if (!currentLecture) return;
      window.location.href = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/markdown';
    }

    function downloadCurrentRawAudio() {
      if (!currentLecture || !currentLecture.has_audio) {
        showToast('원본 오디오 파일이 없습니다.');
        return;
      }
      const a = document.createElement('a');
      a.href = '/api/lectures/' + encodeURIComponent(currentLecture.id) + '/audio';
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
    let recStarting = false;
    let recStartTime = 0;
    let recTimerInterval = null;
    let audioCtx = null;
    let analyser = null;
    let animFrame = null;
    let wakeLock = null;
    let releaseRecordingTabLock = null;
    let vaultDbPromise = null;
    let retryAllRunning = false;
    const inFlightUploads = new Set();

    function newLocalId(prefix) {
      return (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : (prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    }

    function openVaultDb() {
      if (vaultDbPromise) return vaultDbPromise;
      vaultDbPromise = new Promise((resolve) => {
        if (!('indexedDB' in window)) return resolve(null);
        let req;
        try {
          req = indexedDB.open('lectern_audio_vault_v1', 1);
        } catch {
          return resolve(null);
        }
        // A stalled open must not hold up the upload that waits on the backup.
        setTimeout(() => resolve(null), 5000);
        req.onupgradeneeded = (e) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('checkpoints')) {
            idb.createObjectStore('checkpoints', { keyPath: 'id' });
          }
          if (!idb.objectStoreNames.contains('pending_uploads')) {
            idb.createObjectStore('pending_uploads', { keyPath: 'localId' });
          }
        };
        req.onsuccess = () => {
          const idb = req.result;
          idb.onclose = () => { vaultDbPromise = null; };
          resolve(idb);
        };
        req.onerror = () => resolve(null);
      }).then((idb) => {
        if (!idb) vaultDbPromise = null;
        return idb;
      });
      return vaultDbPromise;
    }

    // Runs one vault transaction. Resolves { ok, result } once it commits, or { ok: false } on
    // error/abort (quota exhaustion aborts the transaction), so callers never hang or throw.
    async function runVaultTx(storeName, mode, fn) {
      const idb = await openVaultDb();
      if (!idb) return { ok: false };
      return new Promise((resolve) => {
        try {
          const tx = idb.transaction(storeName, mode);
          const req = fn(tx.objectStore(storeName));
          tx.oncomplete = () => resolve({ ok: true, result: req ? req.result : undefined });
          tx.onerror = () => resolve({ ok: false });
          tx.onabort = () => resolve({ ok: false });
        } catch {
          resolve({ ok: false });
        }
      });
    }

    async function saveRecordingCheckpoint(course, mimeType, chunks, ownerId, startedAt) {
      if (!chunks.length) return;
      try {
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        await runVaultTx('checkpoints', 'readwrite', store => store.put({
          id: 'active_session',
          course: course || '대학교 전공 강의',
          mimeType: blob.type,
          ownerId: ownerId || null,
          startedAt: startedAt || Date.now(),
          updatedAt: Date.now(),
          blob
        }));
      } catch {}
    }

    async function clearRecordingCheckpoint() {
      await runVaultTx('checkpoints', 'readwrite', store => store.delete('active_session'));
    }

    // Resolves true only when the entry is durably committed to IndexedDB.
    async function savePendingUploadToVault(entry) {
      const r = await runVaultTx('pending_uploads', 'readwrite', store => store.put(entry));
      try { await renderLocalVaultList(); } catch {}
      return r.ok;
    }

    async function removePendingUploadFromVault(localId) {
      const r = await runVaultTx('pending_uploads', 'readwrite', store => store.delete(localId));
      try { await renderLocalVaultList(); } catch {}
      return r.ok;
    }

    async function getPendingUploadFromVault(localId) {
      const r = await runVaultTx('pending_uploads', 'readonly', store => store.get(localId));
      return r.ok ? (r.result || null) : null;
    }

    async function listPendingUploadsFromVault() {
      const r = await runVaultTx('pending_uploads', 'readonly', store => store.getAll());
      return r.ok ? (r.result || []) : [];
    }

    // Vault items are tagged with the recording user's id. Items saved before tagging existed
    // (no ownerId) stay visible but are never uploaded automatically.
    function isVaultItemVisible(item) {
      return Boolean(currentUser) && (!item.ownerId || item.ownerId === currentUser.id);
    }

    async function listMyPendingUploads() {
      const items = await listPendingUploadsFromVault();
      return items.filter(isVaultItemVisible);
    }

    async function isAnotherTabRecording() {
      if (!(navigator.locks && navigator.locks.query)) return false;
      try {
        const state = await navigator.locks.query();
        return (state.held || []).some(l => l.name === 'lectern-recording');
      } catch {
        return false;
      }
    }

    async function recoverInterruptedCheckpointOnLoad() {
      // An open tab that is still recording keeps updating this checkpoint; leave it alone.
      if (await isAnotherTabRecording()) return;
      const cp = (await runVaultTx('checkpoints', 'readonly', store => store.get('active_session'))).result;
      if (cp && cp.blob && cp.blob.size > 1024) {
        const ext = (cp.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        const localId = 'rec_' + (cp.startedAt || Date.now());
        const saved = await savePendingUploadToVault({
          localId,
          fileName: (cp.course || '강의') + '_' + new Date(cp.startedAt || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + ext,
          course: cp.course || '대학교 전공 강의',
          mimeType: cp.mimeType || 'audio/webm',
          size: cp.blob.size,
          createdAt: cp.updatedAt || Date.now(),
          sourceClient: 'web-mic-recovered',
          ownerId: cp.ownerId || null,
          lastError: '이전 녹음 중 브라우저 종료로부터 자동 복구됨',
          blob: cp.blob
        });
        if (saved) {
          await clearRecordingCheckpoint();
          showToast('이전에 비정상 종료된 녹음 원본을 로컬 금고에서 복구했습니다!');
        }
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
      const box = document.getElementById('local-vault-box');
      const listEl = document.getElementById('local-vault-list');
      const titleEl = document.getElementById('local-vault-title');
      if (!box || !listEl) return;
      const items = await listMyPendingUploads();
      if (!items.length) {
        box.style.display = 'none';
        listEl.innerHTML = '';
        return;
      }
      box.style.display = 'block';
      titleEl.textContent = '미전송 로컬 녹음 보관함 (' + items.length + '건 보관 중)';
      listEl.innerHTML = items.map(item => {
        const mb = ((item.size || 0) / 1048576).toFixed(1);
        const ownerNote = item.ownerId ? '' : ' · 계정 미지정 (이전 버전에서 저장됨)';
        const idAttr = ' data-local-id="' + escapeClientHtml(item.localId) + '"';
        const itemLabel = '[' + escapeClientHtml(item.course) + '] ' + escapeClientHtml(item.fileName) + ' (' + mb + ' MB)';
        return '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 16px;border-radius:var(--elysium-radius-12);background:var(--elysium-surface-default);border:1px solid var(--elysium-border-subtle);">' +
          '<div style="min-width:0;flex:1 1 180px;">' +
            '<div style="font:600 14px/20px var(--elysium-font-sans);color:var(--elysium-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + itemLabel + '">' + itemLabel + '</div>' +
            '<div style="font:400 13px/20px var(--elysium-font-sans);color:var(--elysium-status-danger-text);overflow-wrap:anywhere;word-break:break-word;">' + escapeClientHtml((item.lastError || '업로드 대기 중') + ownerNote) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">' +
            '<button type="button" class="btn btn-primary" style="height:32px;padding:0 12px;font-size:13px;" data-vault-action="retry"' + idAttr + '>재업로드</button>' +
            '<button type="button" class="btn" style="height:32px;padding:0 12px;font-size:13px;" data-vault-action="download"' + idAttr + '>원본 저장</button>' +
            '<button type="button" class="btn btn-danger" style="height:32px;padding:0 12px;font-size:13px;" data-vault-action="delete"' + idAttr + '>삭제</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    document.getElementById('local-vault-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-vault-action]');
      if (!btn) return;
      const localId = btn.dataset.localId;
      if (btn.dataset.vaultAction === 'retry') retrySingleVaultUpload(localId, false);
      else if (btn.dataset.vaultAction === 'download') downloadVaultItem(localId);
      else if (btn.dataset.vaultAction === 'delete') deleteVaultItem(localId);
    });

    async function downloadVaultItem(localId) {
      const target = await getPendingUploadFromVault(localId);
      if (target && target.blob && isVaultItemVisible(target)) {
        triggerLocalBlobDownload(target.blob, target.fileName || (localId + '.m4a'));
      }
    }

    async function deleteVaultItem(localId) {
      const target = await getPendingUploadFromVault(localId);
      if (!target || !isVaultItemVisible(target)) return;
      if (!confirm('[' + (target.fileName || localId) + '] 로컬 보관 녹음을 삭제할까요? 서버에 업로드되지 않은 원본은 복구할 수 없습니다.')) return;
      await removePendingUploadFromVault(localId);
    }

    async function retrySingleVaultUpload(localId, auto) {
      if (!currentUser) return 'skipped';
      const target = await getPendingUploadFromVault(localId);
      if (!target || !target.blob || !isVaultItemVisible(target)) return 'skipped';
      if (!target.ownerId) {
        if (auto) return 'skipped';
        if (!confirm('이 녹음에는 계정 정보가 없습니다 (이전 버전에서 저장됨). 현재 계정(' + currentUser.displayName + ')으로 업로드할까요?')) return 'skipped';
        target.ownerId = currentUser.id;
        await savePendingUploadToVault(target);
      }
      const file = new File([target.blob], target.fileName || (localId + '.m4a'), { type: target.mimeType || 'audio/mp4' });
      const result = await uploadAndDistillFile(file, target.sourceClient || 'web-vault-retry', target.localId, target.course, {
        ownerId: target.ownerId,
        requireVaultEntry: true
      });
      if (result === 'busy' && !auto) showToast('이 녹음은 이미 업로드 중입니다.');
      return result;
    }

    async function retryAllPendingLocalUploads(auto) {
      if (!currentUser) return;
      if (retryAllRunning) {
        if (!auto) showToast('이미 재업로드를 진행 중입니다.');
        return;
      }
      retryAllRunning = true;
      try {
        const userId = currentUser.id;
        const items = await listMyPendingUploads();
        const owned = items.filter(item => item.ownerId === userId);
        for (const item of owned) {
          if (!currentUser || currentUser.id !== userId) break;
          await retrySingleVaultUpload(item.localId, true);
        }
        const unowned = items.length - owned.length;
        if (unowned > 0 && !auto) {
          showToast('계정 정보가 없는 녹음 ' + unowned + '건은 각 항목의 재업로드 버튼으로 올려주세요.');
        }
      } finally {
        retryAllRunning = false;
      }
    }

    window.addEventListener('online', async () => {
      if (!currentUser) {
        try { await bootstrapAuth(); } catch {}
      }
      if (!currentUser) return;
      showToast('네트워크 연결 복구됨: 미전송 로컬 녹음 자동 업로드를 확인합니다.');
      retryAllPendingLocalUploads(true);
    });

    async function acquireWakeLock() {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      if (wakeLock && !wakeLock.released) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        wakeLock = lock;
        lock.addEventListener('release', () => {
          if (wakeLock === lock) wakeLock = null;
        });
      } catch {}
    }

    function releaseWakeLock() {
      const lock = wakeLock;
      wakeLock = null;
      if (lock) {
        try { lock.release().catch(() => {}); } catch {}
      }
    }

    function isRecordingActive() {
      return Boolean(mediaRecorder && mediaRecorder.state !== 'inactive');
    }

    // The browser drops screen wake locks whenever the page is hidden; take it back on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !isRecordingActive()) return;
      acquireWakeLock().then(() => {
        if (!isRecordingActive()) releaseWakeLock();
      });
    });

    // Best-effort marker for other tabs; never waits, and is released even if the
    // recording ends before the lock callback runs.
    function holdRecordingTabLock() {
      if (!(navigator.locks && navigator.locks.request)) return;
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      releaseRecordingTabLock = release;
      navigator.locks.request('lectern-recording', { ifAvailable: true }, (lock) => (lock ? held : undefined)).catch(() => {});
    }

    function dropRecordingTabLock() {
      if (releaseRecordingTabLock) {
        releaseRecordingTabLock();
        releaseRecordingTabLock = null;
      }
    }

    function releaseRecordingResources(stream) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
      clearInterval(recTimerInterval);
      recTimerInterval = null;
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
      }
      if (audioCtx) {
        const ctx = audioCtx;
        audioCtx = null;
        analyser = null;
        try { ctx.close().catch(() => {}); } catch {}
      }
      releaseWakeLock();
    }

    function resetRecorderControls() {
      const startBtn = document.getElementById('btn-rec-start');
      startBtn.textContent = '마이크 녹음 시작';
      startBtn.classList.remove('btn-danger');
      const pauseBtn = document.getElementById('btn-rec-pause');
      pauseBtn.style.display = 'none';
      pauseBtn.textContent = '일시정지';
    }

    async function toggleMicRecording() {
      if (recStarting) return;
      if (isRecordingActive()) {
        mediaRecorder.stop();
        return;
      }
      const startBtn = document.getElementById('btn-rec-start');
      recStarting = true;
      startBtn.disabled = true;
      let stream = null;
      let recorder = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });
        await acquireWakeLock();

        const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : '';

        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        // Each recording owns its chunk buffer, so a stale recorder can never mix into a new one.
        const chunks = [];
        const recStream = stream;
        const recOwnerId = currentUser ? currentUser.id : null;
        const recStartedAt = Date.now();
        const recCourseAtStart = document.getElementById('rec-course').value.trim() || '대학교 전공 강의';

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            chunks.push(ev.data);
            if (chunks.length % 3 === 0) {
              saveRecordingCheckpoint(recCourseAtStart, recorder.mimeType, chunks, recOwnerId, recStartedAt);
            }
          }
        };
        recorder.onerror = (ev) => {
          console.error('MediaRecorder error:', ev.error || ev);
          showToast('녹음 장치 오류로 녹음이 중단되었습니다. 지금까지 녹음된 내용을 저장합니다.');
        };
        recorder.onstop = async () => {
          releaseRecordingResources(recStream);
          resetRecorderControls();
          try {
            await finalizeRecording(recorder, chunks, recCourseAtStart, recOwnerId);
          } catch (err) {
            console.error('Finalizing recording failed:', err);
          } finally {
            dropRecordingTabLock();
          }
        };

        recorder.start(1000);
        mediaRecorder = recorder;
        recStartTime = recStartedAt;
        holdRecordingTabLock();
        startBtn.textContent = '녹음 종료 및 노트 요약 시작';
        startBtn.classList.add('btn-danger');
        document.getElementById('btn-rec-pause').style.display = 'inline-flex';

        recTimerInterval = setInterval(() => {
          const sec = Math.floor((Date.now() - recStartTime) / 1000);
          const m = String(Math.floor(sec / 60)).padStart(2, '0');
          const s = String(sec % 60).padStart(2, '0');
          document.getElementById('rec-timer').textContent = m + ':' + s;
        }, 500);

        // The level meter is cosmetic; a failure here must not abort a running recording.
        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const src = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          src.connect(analyser);
          drawWaveform();
        } catch (err) {
          console.error('Waveform setup failed:', err);
        }
      } catch (err) {
        if (!recorder || recorder.state === 'inactive') {
          releaseRecordingResources(stream);
          resetRecorderControls();
        }
        alert('마이크 권한을 확인해주세요: ' + ((err && err.message) || err));
      } finally {
        recStarting = false;
        startBtn.disabled = false;
      }
    }

    async function finalizeRecording(recorder, chunks, recCourseAtStart, recOwnerId) {
      const courseNow = document.getElementById('rec-course').value.trim() || recCourseAtStart;
      const blobType = recorder.mimeType || 'audio/webm';
      const ext = blobType.includes('mp4') ? 'm4a' : 'webm';
      const recUuid = newLocalId('rec');
      const kstDate = new Date(Date.now() + 9 * 3600 * 1000);
      const stamp = kstDate.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const safeCourse = courseNow.replace(/[\\\\/:*?"<>|\\s]+/g, '_');
      const fileName = safeCourse + '_' + stamp + '_' + recUuid.slice(0, 8) + '.' + ext;
      const blob = new Blob(chunks, { type: blobType });
      const localId = recUuid;
      if (!blob.size) {
        await clearRecordingCheckpoint();
        showToast('녹음된 오디오가 없어 업로드하지 않았습니다.');
        return;
      }

      // The local download, the vault backup and the upload are independent: none of them
      // waits on another one succeeding.
      const autoSaveChk = document.getElementById('chk-local-save');
      const downloaded = !autoSaveChk || autoSaveChk.checked;
      if (downloaded) {
        triggerLocalBlobDownload(blob, fileName);
      }

      const backedUp = await savePendingUploadToVault({
        localId,
        fileName,
        course: courseNow,
        mimeType: blob.type,
        size: blob.size,
        createdAt: Date.now(),
        sourceClient: 'web-mic',
        ownerId: recOwnerId,
        lastError: '업로드 진행 중...',
        blob
      });
      if (backedUp) {
        await clearRecordingCheckpoint();
      }

      const file = new File([blob], fileName, { type: blob.type });
      const result = await uploadAndDistillFile(file, 'web-mic', localId, courseNow, {
        ownerId: recOwnerId,
        inMemoryOnly: true,
        downloaded
      });
      if (result === 'uploaded' && !backedUp) {
        await clearRecordingCheckpoint();
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
      const meter = analyser;
      const bufLen = meter.frequencyBinCount;
      const data = new Uint8Array(bufLen);

      function render() {
        if (analyser !== meter) return;
        animFrame = requestAnimationFrame(render);
        meter.getByteFrequencyData(data);
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

    // Same-tab Set plus a cross-tab Web Lock, so the online event, "전체 재업로드" and other tabs
    // never POST the same vault item at once. Resolves false if another upload already holds it.
    async function withUploadLock(localId, fn) {
      if (inFlightUploads.has(localId)) return false;
      inFlightUploads.add(localId);
      try {
        if (navigator.locks && navigator.locks.request) {
          return await navigator.locks.request('lectern-upload:' + localId, { ifAvailable: true }, async (lock) => {
            if (!lock) return false;
            await fn();
            return true;
          });
        }
        await fn();
        return true;
      } finally {
        inFlightUploads.delete(localId);
      }
    }

    // POSTs the file, retrying only network errors, 5xx, 408 and 429. Never throws.
    async function postIngestWithRetry(file, course, sourceClient, localId, statusEl) {
      const maxAttempts = 3;
      let lastErrorMsg = '네트워크 연결 오류';
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt - 1)));
        }
        statusEl.textContent =
          (attempt > 1 ? '[재시도 ' + attempt + '/' + maxAttempts + '] ' : '') +
          '오디오 업로드 중 (' + (file.size / 1048576).toFixed(1) + ' MB)...';

        let res;
        try {
          const form = new FormData();
          form.append('audio', file);
          form.append('course', course);
          form.append('source', sourceClient);
          form.append('idempotency_key', localId);
          res = await fetch('/api/lectures/ingest', {
            method: 'POST',
            headers: authHeaders({ 'X-Idempotency-Key': localId }),
            body: form
          });
        } catch (err) {
          lastErrorMsg = (err && err.message) || '네트워크 장애';
          continue;
        }

        // Error pages from proxies (413, 502, ...) are HTML, so parse the body defensively
        // and only after the status has been checked.
        let data = null;
        try { data = JSON.parse(await res.text()); } catch {}
        if (res.ok) {
          return { ok: true, data };
        }
        lastErrorMsg = (data && data.error) || ('HTTP ' + res.status);
        const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        if (!retryable) {
          return { ok: false, permanent: true, message: lastErrorMsg };
        }
      }
      return { ok: false, permanent: false, message: lastErrorMsg };
    }

    // Returns 'uploaded' | 'failed' | 'busy' | 'skipped'. Never throws.
    async function uploadAndDistillFile(file, sourceClient, existingLocalId, overrideCourse, opts) {
      const options = opts || {};
      const course = overrideCourse || document.getElementById('rec-course').value.trim() || '대학교 전공 강의';
      const localId = existingLocalId || newLocalId('upl');
      const entryBase = {
        localId,
        fileName: file.name,
        course,
        mimeType: file.type || 'audio/mp4',
        size: file.size,
        createdAt: Date.now(),
        sourceClient: sourceClient || 'web-upload',
        ownerId: options.ownerId || (currentUser && currentUser.id) || null,
        blob: file
      };

      if (!existingLocalId) {
        await savePendingUploadToVault(Object.assign({}, entryBase, { lastError: '업로드 진행 중...' }));
      }

      const statusEl = document.getElementById('ingest-status');
      let outcome = null;
      const acquired = await withUploadLock(localId, async () => {
        // Another tab may have finished this item while we waited for the lock.
        if (options.requireVaultEntry && !(await getPendingUploadFromVault(localId))) return;
        statusEl.style.display = 'block';
        outcome = await postIngestWithRetry(file, course, sourceClient, localId, statusEl);
      });
      if (!acquired) return 'busy';
      if (!outcome) return 'skipped';

      if (outcome.ok) {
        await removePendingUploadFromVault(localId);
        statusEl.style.display = 'none';
        closeModal('recorder-modal');
        showToast('오디오 업로드 완료 · 실시간 증류가 시작되었습니다.');
        try {
          await fetchLectures(outcome.data && outcome.data.lecture ? outcome.data.lecture.id : undefined);
        } catch (err) {
          console.error('Refreshing lectures after upload failed:', err);
        }
        return 'uploaded';
      }

      const failLabel = outcome.permanent
        ? '서버가 업로드를 거부했습니다 (' + outcome.message + ')'
        : '업로드 실패 (' + outcome.message + ')';
      const existing = await getPendingUploadFromVault(localId);
      const resaved = await savePendingUploadToVault(Object.assign({}, existing || entryBase, {
        lastError: failLabel + ' · 로컬 금고에 보관됨'
      }));
      if (resaved || existing) {
        statusEl.textContent = outcome.permanent
          ? failLabel + '. 원본 오디오는 브라우저 로컬 금고에 보관되어 있으니 위 보관함에서 다시 시도하거나 다운로드할 수 있습니다.'
          : '업로드 중 네트워크 장애가 발생했지만 원본 오디오가 브라우저 로컬 금고에 보관되었습니다. 네트워크 복구 시 자동 재업로드되거나 위 보관함에서 즉시 재시도/다운로드할 수 있습니다.';
        showToast(outcome.permanent ? '업로드 실패: 원본은 로컬 보관함에 남아 있습니다.' : '업로드 지연: 원본 오디오가 로컬 보관함에 보관되었습니다.');
        return 'failed';
      }

      // No vault copy (IndexedDB unavailable, full or failing): the file is the only copy left.
      if (options.inMemoryOnly) {
        if (!options.downloaded) {
          triggerLocalBlobDownload(file, file.name);
        }
        statusEl.textContent = failLabel + '. 브라우저 로컬 금고에 저장할 수 없어 녹음 원본을 기기에 다운로드했습니다 (' + file.name + '). 이 파일을 아래 업로드 영역에 직접 올려주세요.';
        showToast('업로드 실패: 녹음 원본을 기기에 다운로드했습니다.');
      } else {
        statusEl.textContent = failLabel + '. 브라우저 로컬 금고를 사용할 수 없어 보관하지 못했습니다. 원본 파일을 다시 선택해 업로드해 주세요.';
        showToast('업로드 실패: 원본 파일을 다시 선택해 주세요.');
      }
      return 'failed';
    }

    // Markup carries data-action names instead of inline on* handlers so the page runs
    // under a script-src 'self' CSP. Markup rendered at runtime uses the same names.
    const CLICK_ACTIONS = {
      'toggle-theme': () => toggleTheme(),
      'print': () => window.print(),
      'auth-mode': (el) => switchAuthMode(el.dataset.authMode),
      'send-code': () => sendEmailVerificationCode(),
      'open-recorder': () => openRecorderModal(),
      'logout': () => logoutAccount(),
      'open-cleanup': () => openCleanupModal(),
      'open-clients': () => openClientsModal(),
      'open-settings': () => openSettingsModal(),
      'close-modal': (el) => closeModal(el.dataset.modal),
      'toggle-visibility': () => toggleCurrentVisibility(),
      'toggle-editor': () => toggleEditor(),
      'close-editor': () => toggleEditor(false),
      'save-edit': () => saveMarkdownEdit(),
      'download-markdown': () => downloadCurrentMarkdown(),
      'download-audio': () => downloadCurrentRawAudio(),
      'share-lecture': () => shareCurrentLecture(),
      'retry-distillation': () => retryLectureDistillation(),
      'mobile-tab': (el) => switchMobileTab(el.dataset.tab),
      'toggle-mic': () => toggleMicRecording(),
      'pause-recording': () => pauseResumeRecording(),
      'retry-all-uploads': () => retryAllPendingLocalUploads(),
      'pick-file': () => document.getElementById('file-input').click(),
      'copy-api-token': () => copyApiToken(),
      'save-display-name': () => saveProfileDisplayName(),
      'rotate-api-token': () => rotateMyApiToken(),
      'rotate-share-token': () => rotateCurrentShareToken(),
      'move-course': () => moveCurrentLectureCourse(),
      'delete-audio': () => deleteCurrentAudioOnly(),
      'delete-lecture': () => deleteCurrentLecture(),
      'workspace-cleanup': (el) => runWorkspaceCleanup(el.dataset.cleanupMode),
    };
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el && Object.prototype.hasOwnProperty.call(CLICK_ACTIONS, el.dataset.action)) CLICK_ACTIONS[el.dataset.action](el, e);
    });
    document.getElementById('auth-form').addEventListener('submit', submitAuthForm);
    document.getElementById('pw-change-form').addEventListener('submit', submitPasswordChange);
    document.getElementById('audio-speed').addEventListener('change', (e) => changeAudioSpeed(e.target.value));
    document.getElementById('file-input').addEventListener('change', (e) => handleFileSelect(e.target.files));
    document.getElementById('chk-local-save').addEventListener('change', (e) => {
      localStorage.setItem('lectern_autosave_local', e.target.checked ? '1' : '0');
    });

    const savedAutoSave = localStorage.getItem('lectern_autosave_local');
    if (savedAutoSave === '0') {
      const chk = document.getElementById('chk-local-save');
      if (chk) chk.checked = false;
    }
    recoverInterruptedCheckpointOnLoad();
    bootstrapAuth();
`;

// The admin console's colours, shadows and fonts come from the design tokens
// (packages/design-tokens/tokens.json → dist/tokens.css, light/dark by [data-theme]). The
// short names are the console's own variable names, kept as aliases so its selectors stay
// as they were; new rules should use the token names directly. See DESIGN.md.
const ADMIN_THEME_CSS = `${tokensCss}
    :root {
      --bg: var(--color-bg-canvas);
      --panel: var(--color-bg-panel);
      --raised: var(--color-bg-raised);
      --raised-2: var(--color-bg-raised-hover);
      --seg-on: var(--color-bg-control-selected);
      --border: var(--color-border-subtle);
      --border-strong: var(--color-border-default);
      --hover: var(--color-bg-hover);
      --active: var(--color-bg-active);
      --text: var(--color-text-primary);
      --text-2: var(--color-text-secondary);
      --text-3: var(--color-text-tertiary);
      --accent: var(--color-accent-solid);
      --accent-hover: var(--color-accent-solid-hover);
      --accent-soft: var(--color-bg-selected);
      --accent-text: var(--color-accent-fg);
      --green: var(--color-status-success-ui);
      --yellow: var(--color-status-attention-ui);
      --orange: var(--color-status-severe-ui);
      --red: var(--color-status-danger-ui);
      --blue: var(--color-status-info-ui);
      --green-text: var(--color-status-success-fg);
      --yellow-text: var(--color-status-attention-fg);
      --orange-text: var(--color-status-severe-fg);
      --red-text: var(--color-status-danger-fg);
      --blue-text: var(--color-status-info-fg);
      --red-soft: var(--color-status-danger-subtle);
      --yellow-soft: var(--color-status-attention-subtle);
      --input-bg: var(--color-bg-input);
      --overlay: var(--color-bg-scrim);
      --shadow: var(--shadow-lg);
      --font: var(--font-family-sans);
      --mono: var(--font-family-mono);
    }`;

export function renderAdminPageHtml(): string {
  // Linear-style operations console. Everything below is one static document: the
  // client script talks to /api/admin/* (contract in admin-api.ts) with the HttpOnly
  // session cookie. Client code avoids backticks, "${" and backslashes on purpose,
  // because it lives inside this template literal.
  return `<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <title>Lectern Admin</title>
  ${pageScriptTag("admin-theme.js")}
  <link rel="icon" href="data:," />
  <link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
${ADMIN_THEME_CSS}
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { height: 100%; }
    /* The console's sizes are written in px below. DESIGN.md 부록 C (v1.1) raised the type
       and control scale by about 15% (13px → 15px body); until the P5 React port, the whole
       console document is scaled by the same ratio. */
    html { zoom: 1.15; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 400 13px/1.45 var(--font);
      letter-spacing: -0.006em;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow: hidden;
    }
    button, input, select, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
    button { cursor: pointer; }
    a { color: inherit; text-decoration: none; }
    ::selection { background: var(--accent-soft); }
    :focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: 1px; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: var(--active); border-radius: 10px; border: 3px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-track { background: transparent; }
    .num { font-variant-numeric: tabular-nums; }
    .mono { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0; font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-2); }
    .faint { color: var(--text-3); }
    .strong { font-weight: 500; color: var(--text); }
    .small { font-size: 12px; }
    .ic { flex: none; display: block; }
    .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .min0 { min-width: 0; }
    .grow { flex: 1 1 auto; }
    .sp { flex: 1 1 auto; }
    .c-green { color: var(--green-text); }
    .c-yellow { color: var(--yellow-text); }
    .c-orange { color: var(--orange-text); }
    .c-red { color: var(--red-text); }
    .c-blue { color: var(--blue-text); }
    .c-accent { color: var(--accent-text); }

    .app { display: flex; height: 100%; } /* not 100vh: viewport units ignore the zoom above */

    /* Sidebar */
    .sidebar {
      width: 232px;
      flex: none;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 8px 8px;
      background: var(--bg);
      min-height: 0;
      overflow-y: auto;
    }
    .ws { display: flex; align-items: center; gap: 9px; height: 32px; padding: 0 8px; margin-bottom: 6px; }
    .ws-logo {
      width: 20px; height: 20px; border-radius: 5px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--accent); color: var(--color-text-on-solid); font-weight: 700; font-size: 11px;
    }
    .ws-name { font-weight: 600; font-size: 13.5px; letter-spacing: -0.012em; }
    .search-trigger {
      display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; margin: 0 0 10px;
      border: 1px solid var(--border); border-radius: 6px; background: var(--hover); color: var(--text-2);
      text-align: left; width: 100%;
    }
    .search-trigger:hover { background: var(--active); color: var(--text); }
    .search-trigger .lbl { flex: 1; }
    .nav { display: flex; flex-direction: column; gap: 1px; }
    .nav-item {
      display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 8px; border-radius: 6px;
      color: var(--text-2); font-weight: 500; position: relative;
    }
    .nav-item:hover { background: var(--hover); color: var(--text); }
    .nav-item.active { background: var(--active); color: var(--text); }
    .nav-item .nav-label { flex: 1; min-width: 0; }
    .nav-count { color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
    .nav-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
    .nav-dot.yellow { background: var(--yellow); }
    .nav-dot.red { background: var(--red); }
    .nav-dot.blue { background: var(--blue); }
    .nav-hint { display: none; gap: 2px; }
    .nav-item:hover .nav-hint { display: inline-flex; }
    .nav-item:hover .nav-count, .nav-item:hover .nav-dot { display: none; }
    .side-foot { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .me { display: flex; align-items: center; gap: 9px; padding: 4px 8px; min-width: 0; }
    .me .t { display: block; }
    .foot-actions { display: flex; align-items: center; gap: 2px; padding: 0 2px; }
    kbd, .kbd {
      display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 4px; border: 1px solid var(--border-strong); background: var(--hover);
      color: var(--text-2); font: 500 10.5px/1 var(--font); letter-spacing: 0;
    }
    .kbds { display: inline-flex; gap: 2px; }

    /* Main */
    .main {
      flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden;
      margin: 8px 8px 8px 0; background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    }
    .header {
      height: 48px; flex: none; display: flex; align-items: center; gap: 8px;
      padding: 0 10px 0 16px; border-bottom: 1px solid var(--border); min-width: 0;
    }
    .h-title { display: flex; align-items: center; gap: 8px; font-weight: 600; white-space: nowrap; min-width: 0; }
    .h-title .ic { color: var(--text-2); }
    .h-count { color: var(--text-3); font-weight: 500; font-variant-numeric: tabular-nums; }
    .menu-btn { display: none; }
    .live { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12px; white-space: nowrap; }
    .live i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    .search { position: relative; display: flex; align-items: center; width: 220px; min-width: 0; }
    .search .ic { position: absolute; left: 8px; color: var(--text-3); pointer-events: none; }
    .search input {
      width: 100%; height: 28px; padding: 0 28px 0 28px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--input-bg); color: var(--text); outline: none;
    }
    .search input::-webkit-search-cancel-button { display: none; }
    .search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .search kbd { position: absolute; right: 6px; pointer-events: none; }
    .search input:focus + kbd { display: none; }
    .subbar {
      height: 40px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 12px 0 16px;
      border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none;
    }
    .subbar::-webkit-scrollbar { display: none; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 6px; flex: none;
      border: 1px solid var(--border); background: transparent; color: var(--text-2); font-size: 12px; font-weight: 500; white-space: nowrap;
    }
    .chip:hover { background: var(--hover); color: var(--text); }
    .chip.on { background: var(--active); border-color: var(--border-strong); color: var(--text); }
    .chip-n { color: var(--text-3); font-variant-numeric: tabular-nums; }
    .chip .x { color: var(--text-3); margin-left: 2px; }
    .vsep { width: 1px; height: 16px; background: var(--border-strong); margin: 0 4px; flex: none; }
    .content { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; outline: none; position: relative; }

    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px;
      border-radius: 6px; border: 1px solid var(--border-strong); background: var(--raised); color: var(--text);
      font-size: 12.5px; font-weight: 500; white-space: nowrap; flex: none; transition: background 0.1s, border-color 0.1s;
    }
    .btn:hover { background: var(--raised-2); }
    .btn:disabled { opacity: 0.45; cursor: default; }
    .btn-primary { background: var(--accent); border-color: transparent; color: var(--color-text-on-solid); }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--color-status-danger-solid); border-color: transparent; color: var(--color-text-on-solid); }
    .btn-danger:hover { background: var(--color-status-danger-solid-hover); }
    .btn-ghost { background: transparent; border-color: transparent; color: var(--text-2); }
    .btn-ghost:hover { background: var(--hover); color: var(--text); }
    .btn.danger-text { color: var(--red-text); }
    .btn.danger-text:hover { background: var(--red-soft); color: var(--red-text); }
    .btn-sm { height: 24px; padding: 0 8px; font-size: 12px; border-radius: 5px; }
    .icon-btn { width: 28px; padding: 0; }
    .btn-sm.icon-btn { width: 24px; }
    .btn.is-busy { opacity: 0.6; pointer-events: none; }
    .link { background: none; border: 0; padding: 0; color: var(--text); text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; cursor: pointer; text-align: left; }
    .link:hover { text-decoration-color: var(--text-2); }

    /* Lists */
    .group-h {
      position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 16px 0 18px;
      background: var(--raised); border-bottom: 1px solid var(--border); color: var(--text-2); font-size: 12px; font-weight: 500;
    }
    .group-h .n { color: var(--text-3); font-variant-numeric: tabular-nums; }
    .row {
      position: relative; display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 4px 16px 4px 18px;
      border-bottom: 1px solid var(--border); cursor: default; min-width: 0; outline: none;
    }
    .row:hover { background: var(--hover); }
    .row.sel { background: var(--active); }
    .row.sel::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--color-border-focus); }
    .row.is-open { background: var(--accent-soft); }
    .c-main { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; }
    .c-main .t { flex: 0 1 auto; }
    .c-main .t.muted, .c-main .t.faint { flex: 0 4 auto; }
    .c-main .t.lo { flex: 0 12 auto; }
    .c-main .t.keep { flex: 0 0 auto; max-width: 100%; }
    .c-icon { width: 16px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--text-2); }
    .c-status { width: 92px; flex: none; }
    .c-num { width: 52px; flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 4px; color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
    .c-usage { width: 176px; flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 12px; }
    .c-time { width: 76px; flex: none; text-align: right; color: var(--text-2); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .c-owner { width: 180px; flex: none; color: var(--text-2); font-size: 12px; }
    .c-dur { width: 64px; flex: none; text-align: right; color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
    .c-size { width: 140px; flex: none; display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
    .c-stage { width: 112px; flex: none; text-align: right; color: var(--text-2); font-size: 12px; }
    .c-progress { width: 116px; flex: none; display: flex; align-items: center; gap: 8px; justify-content: flex-end; font-size: 12px; color: var(--text-2); }
    .c-action { width: 168px; flex: none; }
    .c-actor { width: 190px; flex: none; text-align: right; color: var(--text-2); font-size: 12px; }
    .c-btns { flex: none; display: flex; gap: 4px; }
    .row-empty, .row-note { display: flex; align-items: center; gap: 8px; padding: 12px 18px; color: var(--text-2); border-bottom: 1px solid var(--border); }
    .row-note { color: var(--text-3); font-size: 12px; }
    .row-empty .ic { color: var(--green); }
    .more { display: flex; justify-content: center; padding: 14px; }
    .att-ic { width: 16px; flex: none; display: flex; justify-content: center; }

    .av {
      width: 20px; height: 20px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center;
      color: var(--color-text-on-solid); font-size: 10px; font-weight: 600; letter-spacing: 0; user-select: none;
    }
    .av-lg { width: 36px; height: 36px; font-size: 15px; }
    .badge {
      display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 6px; border-radius: 4px; flex: none;
      border: 1px solid var(--border-strong); color: var(--text-2); font-size: 11px; font-weight: 500; white-space: nowrap; line-height: 1;
    }
    .badge.owner { color: var(--accent-text); border-color: var(--color-accent-border); background: var(--accent-soft); }
    .badge.admin { color: var(--blue-text); border-color: var(--color-status-info-border); }
    .badge.green { color: var(--green-text); border-color: var(--color-status-success-border); }
    .badge.red { color: var(--red-text); border-color: var(--color-status-danger-border); }
    .badge.yellow { color: var(--yellow-text); border-color: var(--color-status-attention-border); }
    .badge.blue { color: var(--blue-text); border-color: var(--color-status-info-border); }
    .sdot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; background: var(--text-3); }
    .sdot.green { background: var(--green); }
    .sdot.yellow { background: var(--yellow); }
    .sdot.red { background: var(--red); }
    .sdot.blue { background: var(--blue); }
    .sdot.orange { background: var(--orange); }
    .st-label { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 12px; white-space: nowrap; }
    .bar { position: relative; display: inline-block; width: 56px; height: 4px; border-radius: 2px; background: var(--active); overflow: hidden; flex: none; }
    .bar > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--accent); }
    .bar.wide { width: 100%; height: 6px; border-radius: 3px; }
    .bar.green > i { background: var(--green); }
    .bar.yellow > i { background: var(--yellow); }
    .bar.orange > i { background: var(--orange); }
    .bar.red > i { background: var(--red); }
    .bar.blue > i { background: var(--blue); }
    .act { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0; color: var(--text-2); }
    .act.auth { color: var(--blue-text); }
    .act.account { color: var(--green-text); }
    .act.admin { color: var(--accent-text); }
    .act.storage { color: var(--orange-text); }
    .act.ops { color: var(--yellow-text); }

    /* Overview */
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--border); }
    .kpi { padding: 14px 18px 16px; border-right: 1px solid var(--border); min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .kpi:last-child { border-right: 0; }
    .kpi-l { color: var(--text-2); font-size: 12px; font-weight: 500; }
    .kpi-v { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi-u { font-size: 12px; font-weight: 500; color: var(--text-2); margin-left: 4px; letter-spacing: 0; }
    .kpi-s { color: var(--text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi .bar { margin-top: 6px; }
    .section { border-bottom: 1px solid var(--border); }
    .section:last-child { border-bottom: 0; }
    .section-h { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px 0 18px; border-bottom: 1px solid var(--border); }
    .sec-t { font-weight: 600; font-size: 13px; }
    .count-pill { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--active); color: var(--text-2); font-size: 11px; font-variant-numeric: tabular-nums; }

    /* Cards (storage, jobs) */
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 16px; }
    .card { border: 1px solid var(--border); border-radius: 8px; background: var(--raised); min-width: 0; }
    .card.full { grid-column: 1 / -1; }
    .card-h { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 12px 6px 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .card-h .sec-t { flex: 1 1 auto; }
    .card-b { padding: 12px 14px; }
    .kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; font-size: 12.5px; }
    .kv dt { color: var(--text-2); min-width: 0; }
    .kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; min-width: 0; }
    .rec { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); min-width: 0; }
    .rec:last-child { border-bottom: 0; }
    .rec .ic { color: var(--text-2); }
    .hbars { display: flex; flex-direction: column; gap: 9px; }
    .hb { display: grid; grid-template-columns: minmax(0, 132px) minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 12px; min-width: 0; }
    .hb.click { cursor: pointer; border-radius: 4px; }
    .hb.click:hover .hb-l { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
    .hb-l { color: var(--text-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hb-v { text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .hb .bar { width: 100%; height: 6px; border-radius: 3px; }
    .gauge-row { display: flex; align-items: center; gap: 10px; }

    /* Settings */
    .settings { max-width: 780px; margin: 0 auto; padding: 24px 24px 72px; }
    .set-sec { margin-bottom: 28px; }
    .set-sec-h { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
    .set-sec-d { color: var(--text-2); margin: 0 0 12px; font-size: 12.5px; }
    .set-card { border: 1px solid var(--border); border-radius: 8px; background: var(--raised); }
    .set-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 16px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .set-row:last-child { border-bottom: 0; }
    .sr-text { flex: 1 1 280px; min-width: 0; }
    .sr-title { font-weight: 500; }
    .sr-desc { color: var(--text-2); font-size: 12px; margin-top: 2px; }
    .sr-ctl { flex: none; display: flex; align-items: center; gap: 8px; margin-left: auto; }
    .sr-ctl .input { width: auto; }
    .ret-days { width: 84px !important; text-align: right; }
    .ret-state { min-width: 28px; font-size: 12px; color: var(--text-2); }
    .ret-state.off { color: var(--text-3); }
    .save-hint { color: var(--yellow-text); font-size: 12px; white-space: nowrap; }

    /* Forms */
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; min-width: 0; }
    .field > .lbl { font-size: 12px; color: var(--text-2); font-weight: 500; }
    .hint { font-size: 11.5px; color: var(--text-3); }
    .grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 12px; }
    .input {
      height: 30px; width: 100%; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-strong);
      background: var(--input-bg); color: var(--text); outline: none; transition: border-color 0.12s, box-shadow 0.12s; min-width: 0;
    }
    select.input { padding-right: 6px; }
    textarea.input { height: auto; min-height: 58px; padding: 7px 10px; resize: vertical; line-height: 1.45; }
    .input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .input:disabled { opacity: 0.45; }
    .input.num { font-variant-numeric: tabular-nums; }
    .switch {
      appearance: none; -webkit-appearance: none; width: 28px; height: 16px; border-radius: 999px; margin: 0; flex: none;
      background: var(--active); border: 1px solid var(--border-strong); position: relative; cursor: pointer; transition: background 0.12s;
    }
    .switch::after {
      content: ""; position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%;
      background: var(--text-2); transition: transform 0.12s, background 0.12s;
    }
    .switch:checked { background: var(--accent); border-color: transparent; }
    .switch:checked::after { transform: translateX(12px); background: var(--color-text-on-solid); }
    .switch:disabled { opacity: 0.45; cursor: default; }
    .sw-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; }
    .sw-row .sw-text { flex: 1; min-width: 0; }
    .sw-list { border: 1px solid var(--border); border-radius: 8px; padding: 2px 12px; margin-bottom: 14px; background: var(--hover); }
    .sw-list .sw-row + .sw-row { border-top: 1px solid var(--border); }
    .seg { display: inline-flex; padding: 2px; border-radius: 7px; background: var(--active); gap: 2px; max-width: 100%; }
    .seg label { position: relative; display: inline-flex; }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg span { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 5px; color: var(--text-2); cursor: pointer; font-size: 12.5px; white-space: nowrap; }
    .seg input:checked + span { background: var(--seg-on); color: var(--text); box-shadow: var(--shadow-sm); }
    .seg input:focus-visible + span { outline: 2px solid var(--color-border-focus); }
    .form-err { color: var(--red-text); font-size: 12px; margin: 4px 0 10px; }
    .sec-title { font-size: 12px; font-weight: 600; color: var(--text-2); margin: 20px 0 10px; display: flex; align-items: center; gap: 8px; }
    .sec-title::after { content: ""; flex: 1; height: 1px; background: var(--border); }
    .callout { display: flex; gap: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--hover); font-size: 12.5px; color: var(--text-2); margin: 12px 0; }
    .callout .ic { margin-top: 2px; }
    .callout.red { border-color: var(--color-status-danger-border); background: var(--red-soft); color: var(--text); }
    .callout.red .ic { color: var(--red); }
    .callout.yellow { border-color: var(--color-status-attention-border); background: var(--yellow-soft); color: var(--text); }
    .callout.yellow .ic { color: var(--yellow); }
    .pre { white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 11.5px; letter-spacing: 0; color: var(--text-2); margin-top: 4px; }

    /* Peek panel */
    .peek {
      position: fixed; top: 8px; right: 8px; bottom: 8px; z-index: 40; width: 448px; max-width: calc(100% - 16px);
      display: flex; flex-direction: column; background: var(--raised); border: 1px solid var(--border-strong);
      border-radius: 8px; box-shadow: var(--shadow); transform: translateX(calc(100% + 24px)); visibility: hidden;
      transition: transform 0.16s ease, visibility 0s linear 0.16s;
    }
    .peek.open { transform: none; visibility: visible; transition: transform 0.16s ease; }
    .peek-h { height: 46px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--border); min-width: 0; }
    .peek-crumb { color: var(--text-2); white-space: nowrap; }
    .peek-b { flex: 1 1 auto; overflow-y: auto; padding: 16px; min-height: 0; }
    .peek-f { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--border); }
    .hero { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .hero-title { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.3; overflow-wrap: anywhere; }
    .props { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 9px 12px; margin: 16px 0; font-size: 12.5px; }
    .props dt { color: var(--text-2); }
    .props dd { margin: 0; min-width: 0; overflow-wrap: anywhere; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .inline-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .excerpt { color: var(--text-2); font-size: 12.5px; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
    .jobbox { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--hover); margin: 12px 0; }
    .jobbox .bar { margin-top: 8px; }

    /* Overlays: palette, dialog, sheet */
    .overlay { position: fixed; inset: 0; z-index: 60; background: var(--overlay); display: none; justify-content: center; align-items: flex-start; padding: 12vh 16px 16px; }
    .overlay.center { align-items: center; padding: 16px; }
    .overlay.open { display: flex; }
    .palette, .dialog, .sheet {
      width: 640px; max-width: 100%; background: var(--raised); border: 1px solid var(--border-strong); border-radius: 10px;
      box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column; animation: pop 0.12s ease;
    }
    @keyframes pop { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; } }
    .palette { max-height: min(560px, 76%); }
    .pal-in { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border-bottom: 1px solid var(--border); }
    .pal-in .ic { color: var(--text-3); }
    .pal-in input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 14px; color: var(--text); }
    .pal-list { overflow-y: auto; padding: 6px; flex: 1 1 auto; }
    .pal-g { padding: 8px 10px 4px; color: var(--text-3); font-size: 11.5px; font-weight: 500; }
    .pal-i { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border-radius: 6px; color: var(--text); cursor: pointer; min-width: 0; }
    .pal-i .ic { color: var(--text-2); }
    .pal-i.on { background: var(--active); }
    .pal-i .sub { color: var(--text-3); font-size: 12px; }
    .pal-empty { padding: 24px; text-align: center; color: var(--text-3); }
    .pal-foot { display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--border); color: var(--text-3); font-size: 11.5px; }
    .pal-foot span { display: inline-flex; align-items: center; gap: 4px; }
    .dialog { width: 440px; }
    .dlg-b { padding: 18px 18px 6px; }
    .dlg-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
    .dlg-body { color: var(--text-2); font-size: 12.5px; line-height: 1.55; }
    .dlg-body p { margin: 0 0 10px; }
    .dlg-body ul { margin: 0 0 10px; padding-left: 18px; }
    .dlg-req { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 8px; font-size: 12px; color: var(--text-2); }
    .dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px; }
    .dstats { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; margin: 8px 0 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--hover); }
    .dstats dt { color: var(--text-2); white-space: nowrap; }
    .dstats dd { margin: 0; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .file-list { max-height: 140px; overflow-y: auto; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; display: flex; flex-direction: column; gap: 3px; }
    .sheet { width: 520px; }
    .sheet-b { padding: 6px 18px 18px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 24px; }
    .sheet-h { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 8px 18px; }
    .sk { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); color: var(--text-2); }
    .sk .kbds { flex: none; }

    /* Toasts */
    .toasts { position: fixed; right: 16px; bottom: 16px; z-index: 80; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; }
    .toast {
      display: flex; align-items: center; gap: 9px; max-width: 380px; padding: 9px 12px; border-radius: 8px; pointer-events: auto;
      background: var(--raised); border: 1px solid var(--border-strong); box-shadow: var(--shadow); font-size: 12.5px; animation: toast-in 0.16s ease;
    }
    body.peek-open .toasts { right: 472px; }
    .toast .sdot { background: var(--text-3); }
    .toast.ok .sdot { background: var(--green); }
    .toast.error .sdot { background: var(--red); }
    .toast.out { opacity: 0; transform: translateY(4px); transition: opacity 0.18s, transform 0.18s; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    /* States */
    .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 64px 16px; color: var(--text-2); text-align: center; }
    .empty .ic { color: var(--text-3); }
    .empty .sub { color: var(--text-3); font-size: 12px; }
    .unavail { display: flex; align-items: center; gap: 10px; margin: 16px; padding: 12px 14px; border: 1px dashed var(--border-strong); border-radius: 8px; color: var(--text-2); font-size: 12.5px; }
    .unavail .ic { color: var(--text-3); }
    .unavail span { flex: 1; min-width: 0; }
    .spinner { width: 14px; height: 14px; border: 1.5px solid var(--border-strong); border-top-color: var(--text-2); border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .gate { position: fixed; inset: 0; z-index: 90; background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .gate-card { width: 380px; max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
    .gate-card .ws-logo { width: 36px; height: 36px; border-radius: 9px; font-size: 18px; }
    .gate-card h1 { font-size: 17px; font-weight: 600; margin: 6px 0 0; letter-spacing: -0.015em; }
    .gate-card p { color: var(--text-2); margin: 0 0 6px; line-height: 1.55; }
    .scrim { display: none; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; }
      .palette, .dialog, .sheet, .toast, .live i { animation: none !important; }
    }
    @media (max-width: 1180px) { .hide-md { display: none !important; } }
    @media (max-width: 900px) {
      .hide-sm { display: none !important; }
      .sidebar {
        position: fixed; left: 0; top: 0; bottom: 0; z-index: 50; width: 264px; max-width: 86%; padding-top: 12px;
        border-right: 1px solid var(--border); transform: translateX(-100%); transition: transform 0.16s ease; visibility: hidden;
      }
      .app.drawer-open .sidebar { transform: none; visibility: visible; }
      .app.drawer-open .scrim { display: block; position: fixed; inset: 0; z-index: 45; background: var(--overlay); }
      .main { margin: 0; border: 0; border-radius: 0; }
      .menu-btn { display: inline-flex; margin-left: -6px; }
      .header { padding: 0 10px 0 12px; }
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .kpi:nth-child(2n) { border-right: 0; }
      .kpi:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
      .cards { grid-template-columns: minmax(0, 1fr); padding: 12px; }
      .peek { top: 0; right: 0; bottom: 0; left: 0; width: auto; max-width: none; border-radius: 0; border: 0; }
      .settings { padding: 16px 12px 64px; }
      .nav-hint { display: none !important; }
      .nav-item:hover .nav-count, .nav-item:hover .nav-dot { display: inline-block; }
      body.peek-open .toasts { right: 16px; bottom: 60px; }
    }
    @media (max-width: 600px) {
      .hide-xs { display: none !important; }
      .row { padding-left: 14px; padding-right: 12px; }
      .group-h, .section-h { padding-left: 14px; }
      .search { width: auto; flex: 1 1 96px; }
      .search kbd { display: none; }
      .h-title .ic { display: none; }
      .btn .lbl { display: none; }
      .c-usage { width: auto; }
      .c-size { width: auto; }
      .c-time { width: 58px; }
      .c-action { width: 118px; }
      .kpi { padding: 12px 14px; }
      .kpi-v { font-size: 19px; }
      .grid2 { grid-template-columns: minmax(0, 1fr); }
      .hb { grid-template-columns: minmax(0, 92px) minmax(0, 1fr) auto; }
      .sheet-b { grid-template-columns: minmax(0, 1fr); }
      .toasts { left: 16px; align-items: stretch; }
      .toast { max-width: none; }
      .pal-foot { display: none; }
      .overlay { padding-top: 8vh; }
    }
  </style>
</head>
<body>
  <div class="app" id="app">
    <aside class="sidebar" id="sidebar" aria-label="관리자 메뉴">
      <div class="ws">
        <span class="ws-logo" aria-hidden="true">L</span>
        <span class="ws-name">Lectern Admin</span>
      </div>
      <button class="search-trigger" id="search-trigger" type="button" data-action="palette"></button>
      <nav class="nav" id="nav" aria-label="보기"></nav>
      <div class="sp"></div>
      <div class="side-foot" id="side-foot"></div>
    </aside>
    <div class="scrim" data-action="drawer-close"></div>
    <main class="main">
      <header class="header" id="header"></header>
      <div class="subbar" id="subbar" hidden></div>
      <div class="content" id="content" tabindex="-1"></div>
    </main>
    <aside class="peek" id="peek" aria-label="상세 정보"></aside>
  </div>

  <div class="overlay" id="pal-ov" data-overlay="palette">
    <div class="palette" role="dialog" aria-modal="true" aria-label="명령 팔레트">
      <div class="pal-in" id="pal-in"></div>
      <div class="pal-list" id="pal-list" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>↵</kbd> 실행</span><span><kbd>esc</kbd> 닫기</span></div>
    </div>
  </div>
  <div class="overlay center" id="dlg-ov" data-overlay="dialog"></div>
  <div class="overlay center" id="sheet-ov" data-overlay="sheet"></div>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <div class="gate" id="gate" hidden></div>

  ${pageScriptTag("admin.js")}
</body>
</html>`;
}

// Static client script for /admin. It must stay free of server-side interpolation so it
// can later be served as /assets/admin.js under a script-src 'self' CSP.
const ADMIN_PAGE_SCRIPT = `
    // Theme first so the page paints in the saved theme (shared with the main app).
    (function () {
      var theme = 'dark';
      try {
        var saved = localStorage.getItem('lectern_theme');
        if (saved === 'light' || saved === 'dark') theme = saved;
      } catch (e) {}
      document.documentElement.setAttribute('data-theme', theme);
    })();

    // Authenticated by the HttpOnly lectern_session cookie (same-origin).
    try { localStorage.removeItem('lectern_token'); } catch {}
    function authHeaders(extra) {
      return Object.assign({}, extra || {});
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function $(id) { return document.getElementById(id); }
    function arr(x) { return Array.isArray(x) ? x : []; }
    function obj(x) { return x && typeof x === 'object' ? x : {}; }
    var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    var MOD = IS_MAC ? '⌘' : 'Ctrl';

    // MARK: - Icons (inline SVG, 16px grid)
    var IC = {
      overview: '<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>',
      members: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c.6-2.2 2.3-3.5 4.5-3.5s3.9 1.3 4.5 3.5"/><path d="M10.5 3.1a2.5 2.5 0 0 1 0 4.8"/><path d="M12 10.2c1.2.5 2.1 1.6 2.5 3.3"/>',
      lectures: '<rect x="5.5" y="1.5" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0"/><path d="M8 12.5v2"/>',
      jobs: '<path d="M1.5 8h2.5l2-5 4 10 2-5h2.5"/>',
      storage: '<ellipse cx="8" cy="3.8" rx="5.5" ry="2"/><path d="M2.5 3.8v8.4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V3.8"/><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>',
      audit: '<path d="M8 1.5l5.5 2v4.2c0 3.1-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.7-5.5-6.8V3.5z"/><path d="M5.6 8l1.7 1.7 3.1-3.2"/>',
      settings: '<path d="M2 4.5h7"/><path d="M12 4.5h2"/><path d="M2 11.5h2"/><path d="M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
      search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
      plus: '<path d="M8 3v10"/><path d="M3 8h10"/>',
      close: '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/>',
      sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/>',
      moon: '<path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z"/>',
      logout: '<path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6"/><path d="M10.5 11l3-3-3-3"/><path d="M13.5 8H6"/>',
      external: '<path d="M6.5 3.5h-3v9h9v-3"/><path d="M9 2.5h4.5V7"/><path d="M13.5 2.5L7.5 8.5"/>',
      menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
      check: '<path d="M3.5 8.5l3 3 6-7"/>',
      retry: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/>',
      trash: '<path d="M2.5 4h11"/><path d="M6 4V2.5h4V4"/><path d="M3.8 4l.7 9.5h7l.7-9.5"/>',
      compress: '<path d="M8 1.5V6"/><path d="M5.8 3.8L8 6l2.2-2.2"/><path d="M8 14.5V10"/><path d="M5.8 12.2L8 10l2.2 2.2"/><path d="M2.5 8h11"/>',
      alert: '<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3"/><path d="M8 11.4v.1"/>',
      clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>',
      archive: '<rect x="2" y="2.5" width="12" height="3.5" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/><path d="M6.5 9h3"/>',
      tool: '<path d="M10.4 2.1a3.4 3.4 0 0 0-3 4.7l-4.8 4.8a1.3 1.3 0 0 0 1.8 1.8l4.8-4.8a3.4 3.4 0 0 0 4.7-3l-1.9 1.9-1.9-.4-.4-1.9z"/>',
      keyboard: '<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 6.8h.5M6.8 6.8h.5M9.5 6.8h.5M12 6.8h.2M5 9.4h6"/>',
      file: '<path d="M9 1.5H4.2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.3z"/><path d="M9 1.5v3.8h3.8"/>',
      chip: '<rect x="4" y="4" width="8" height="8" rx="1.2"/><path d="M6.3 1.8V4M9.7 1.8V4M6.3 12v2.2M9.7 12v2.2M1.8 6.3H4M1.8 9.7H4M12 6.3h2.2M12 9.7h2.2"/>',
      userplus: '<circle cx="6.5" cy="5.5" r="2.6"/><path d="M1.8 14c.6-2.5 2.4-4 4.7-4 1.9 0 3.4.9 4.2 2.4"/><path d="M12.5 7.5v4M10.5 9.5h4"/>',
      arrow: '<path d="M6 3.5L10.5 8 6 12.5"/>',
      lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
      play: '<path d="M5 3.5v9l7-4.5z"/>',
      db: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4"/>',
      server: '<rect x="2" y="2.5" width="12" height="4.5" rx="1"/><rect x="2" y="9" width="12" height="4.5" rx="1"/><path d="M4.5 4.8h.1M4.5 11.2h.1"/>'
    };
    function ic(name, size) {
      var s = size || 16;
      return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[name] || '') + '</svg>';
    }
    // Linear-style status glyphs (14px): queued, processing (pie = progress), done, error.
    function statusIcon(kind, pct) {
      var o = '<svg class="ic" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">';
      if (kind === 'done') return o + '<circle cx="7" cy="7" r="6" style="fill:var(--green)"/><path d="M4.4 7.2l1.8 1.8 3.5-3.7" style="fill:none;stroke:var(--raised);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"/></svg>';
      if (kind === 'error') return o + '<circle cx="7" cy="7" r="6" style="fill:var(--red)"/><path d="M7 4.2v3.3M7 9.7v.1" style="fill:none;stroke:var(--raised);stroke-width:1.6;stroke-linecap:round"/></svg>';
      if (kind === 'queued') return o + '<circle cx="7" cy="7" r="5.7" style="fill:none;stroke:var(--text-2);stroke-width:1.4;stroke-dasharray:2 2.2"/></svg>';
      var p = Math.max(6, Math.min(100, Number(pct) || 0));
      return o + '<circle cx="7" cy="7" r="6" style="fill:none;stroke:var(--yellow);stroke-width:1.4"/><circle cx="7" cy="7" r="2.5" pathLength="100" transform="rotate(-90 7 7)" style="fill:none;stroke:var(--yellow);stroke-width:5;stroke-dasharray:' + p + ' 100"/></svg>';
    }

    // MARK: - Formatting
    function num(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
    function fmtBytes(n) {
      n = Math.max(0, Number(n) || 0);
      if (n < 1024) return Math.round(n) + ' B';
      var units = ['KB', 'MB', 'GB', 'TB'];
      var v = n / 1024;
      var i = 0;
      while (v >= 1024 && i < units.length - 1) { v = v / 1024; i++; }
      return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + units[i];
    }
    function fmtDur(sec) {
      sec = Math.max(0, Math.round(Number(sec) || 0));
      if (!sec) return '—';
      var d = Math.floor(sec / 86400);
      var h = Math.floor((sec % 86400) / 3600);
      var m = Math.floor((sec % 3600) / 60);
      var s = sec % 60;
      if (d) return d + '일' + (h ? ' ' + h + '시간' : '');
      if (h) return h + '시간' + (m ? ' ' + m + '분' : '');
      if (m) return m + '분' + (s ? ' ' + s + '초' : '');
      return s + '초';
    }
    function fmtClock(sec) {
      sec = Math.max(0, Math.round(Number(sec) || 0));
      if (!sec) return '—';
      var h = Math.floor(sec / 3600);
      var m = Math.floor((sec % 3600) / 60);
      var s = sec % 60;
      function p(x) { return (x < 10 ? '0' : '') + x; }
      return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
    }
    function fmtMs(ms) {
      ms = Math.max(0, Number(ms) || 0);
      if (ms < 1000) return Math.round(ms) + 'ms';
      if (ms < 60000) return (Math.round(ms / 100) / 10) + '초';
      return fmtDur(ms / 1000);
    }
    function relTime(iso) {
      if (!iso) return '—';
      var t = Date.parse(iso);
      if (!isFinite(t)) return '—';
      var d = Math.max(0, (Date.now() - t) / 1000);
      if (d < 45) return '방금 전';
      if (d < 3600) return Math.max(1, Math.round(d / 60)) + '분 전';
      if (d < 86400) return Math.floor(d / 3600) + '시간 전';
      if (d < 86400 * 30) return Math.floor(d / 86400) + '일 전';
      if (d < 86400 * 365) return Math.floor(d / (86400 * 30)) + '개월 전';
      return Math.floor(d / (86400 * 365)) + '년 전';
    }
    function absTime(iso) {
      var t = Date.parse(iso || '');
      if (!isFinite(t)) return '';
      var d = new Date(t);
      function p(x) { return (x < 10 ? '0' : '') + x; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function timeEl(iso, cls) {
      return '<span class="' + (cls || '') + '" title="' + esc(absTime(iso)) + '">' + esc(relTime(iso)) + '</span>';
    }
    function pct(part, total) {
      var p = total > 0 ? (Number(part) || 0) / total * 100 : 0;
      return Math.max(0, Math.min(100, Math.round(p * 10) / 10));
    }
    function bar(p, cls) {
      return '<span class="bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, Number(p) || 0)) + '%"></i></span>';
    }
    function usageClass(p) { return p >= 90 ? 'red' : p >= 75 ? 'orange' : ''; }
    function cntBytes(x) { x = obj(x); return num(x.count) + '개 · ' + fmtBytes(x.bytes); }

    var ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
    var STATUS_LABEL = { active: '활성', pending: '승인 대기', suspended: '정지' };
    var STATUS_DOT = { active: 'green', pending: 'yellow', suspended: 'red' };
    var LEC_STATUS = { processing: '처리 중', done: '완료', error: '오류' };
    var STAGE_LABEL = { queued: '대기 중', preparing: '준비 중', uploading: '업로드 중', analyzing: '분석 중', writing: '노트 작성 중', retry: '재시도 대기', done: '완료', error: '오류', compacting: '압축 중' };
    var KIND_LABEL = { distill: '노트 생성', compact: '압축' };
    var AUDIT_PREFIXES = ['auth', 'account', 'admin', 'storage', 'ops'];

    function extLabel(ext) {
      var e = String(ext || '').trim();
      if (e.charAt(0) === '.') e = e.slice(1);
      return (e || '?').toUpperCase();
    }
    function roleBadge(role) {
      var cls = role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : '';
      return '<span class="badge ' + cls + '">' + esc(ROLE_LABEL[role] || role || '—') + '</span>';
    }
    function statusLabel(status) {
      return '<span class="st-label"><span class="sdot ' + (STATUS_DOT[status] || '') + '"></span>' + esc(STATUS_LABEL[status] || status || '—') + '</span>';
    }
    function stageText(l) {
      var st = STAGE_LABEL[l.stage] || l.stage || '';
      return st || LEC_STATUS[l.status] || '';
    }
    function lecKind(l) {
      if (l.status === 'processing') return l.job_state === 'queued' || l.stage === 'queued' ? 'queued' : 'processing';
      return l.status === 'done' ? 'done' : l.status === 'error' ? 'error' : 'queued';
    }
    function hashHue(s) {
      var h = 0;
      s = String(s || '');
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
      return h;
    }
    function initials(name, email) {
      var n = String(name || '').trim() || String(email || '').trim();
      if (!n) return '?';
      var parts = n.split(' ').filter(Boolean);
      if (parts.length > 1 && /^[A-Za-z]/.test(parts[0]) && /^[A-Za-z]/.test(parts[1])) return (parts[0][0] + parts[1][0]).toUpperCase();
      return Array.from(n)[0].toUpperCase();
    }
    function avatar(name, email, id, lg) {
      return '<span class="av' + (lg ? ' av-lg' : '') + '" style="background:oklch(52% 0.08 ' + hashHue(id || email) + ')" aria-hidden="true">' + esc(initials(name, email)) + '</span>';
    }

    // MARK: - API
    function defaultError(status) {
      if (status === 404) return '아직 지원되지 않는 기능입니다.';
      if (status === 409) return '이미 처리 중입니다.';
      if (status === 403) return '권한이 없습니다.';
      if (status === 401) return '로그인이 필요합니다.';
      if (status >= 500) return '서버 오류가 발생했습니다. (' + status + ')';
      return '요청에 실패했습니다. (' + status + ')';
    }
    async function api(method, path, body) {
      var opts = { method: method, credentials: 'same-origin', headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : undefined) };
      if (body !== undefined) opts.body = JSON.stringify(body);
      var res;
      try {
        res = await fetch(path, opts);
      } catch (e) {
        return { ok: false, status: 0, data: null, error: '서버에 연결할 수 없습니다.' };
      }
      var data = null;
      try { data = await res.json(); } catch (e) {}
      var error = res.ok ? null : ((data && typeof data.error === 'string' && data.error) || defaultError(res.status));
      if (res.status === 401 && S.me && !S.gated) showGate('signin');
      return { ok: res.ok, status: res.status, data: data, error: error };
    }
    function failToast(r, feature) {
      if (r.status === 404) toast(feature + ' 기능을 아직 사용할 수 없습니다.');
      else toast(r.error || '요청에 실패했습니다.', 'error');
    }

    // MARK: - State
    var VIEWS = [
      { id: 'overview', label: '개요', key: 'o', icon: 'overview' },
      { id: 'members', label: '멤버', key: 'm', icon: 'members' },
      { id: 'lectures', label: '강의', key: 'l', icon: 'lectures' },
      { id: 'jobs', label: '작업', key: 'j', icon: 'jobs' },
      { id: 'storage', label: '스토리지', key: 's', icon: 'storage' },
      { id: 'audit', label: '감사 로그', key: 'a', icon: 'audit' },
      { id: 'settings', label: '설정', key: ',', icon: 'settings' }
    ];
    function viewDef(id) { return VIEWS.filter(function (v) { return v.id === id; })[0] || null; }

    var S = {
      me: null,
      gated: false,
      view: 'overview',
      ov: null, ovErr: null, ovAt: 0,
      ops: null, opsErr: null,
      st: null, stErr: null, stAt: 0,
      lec: { items: [], total: 0, counts: null, status: '', q: '', owner: '', loading: false, loaded: false, fallback: false, err: null },
      lecExtra: {},
      mem: { role: '', status: '', q: '' },
      aud: { prefix: '', q: '', items: [], next: null, counts: null, total: 0, loading: false, loaded: false, fallback: false },
      selKey: '',
      peek: null
    };
    var inflight = {};

    function users() { return arr(S.ov && S.ov.users); }
    function userById(id) { return users().filter(function (u) { return u.id === id; })[0] || null; }
    function auditLogs() { return arr(S.ov && S.ov.auditLogs); }
    function settingsBase() { return (S.ov && S.ov.settings) || (S.st && S.st.settings) || null; }
    function jobsFor(lectureId) {
      if (!S.ops) return [];
      var J = obj(S.ops.jobs);
      return arr(J.running).concat(arr(J.queued)).filter(function (j) { return j.lectureId === lectureId; });
    }

    // Merge every partial copy of a lecture we hold (admin list, overview, single GET, storage, jobs).
    function findLecture(id) {
      var parts = [];
      var j = S.ops ? arr(obj(S.ops.jobs).running).concat(arr(obj(S.ops.jobs).queued), arr(obj(S.ops.jobs).recent)).filter(function (x) { return x.lectureId === id; })[0] : null;
      if (j) parts.push({ id: id, title: j.lectureTitle, owner_email: j.ownerEmail });
      var g = S.st ? arr(S.st.largest).filter(function (x) { return x.id === id; })[0] : null;
      if (g) parts.push({ id: id, title: g.title, course: g.course, owner_email: g.ownerEmail, audio_size: g.audioBytes, duration_sec: g.durationSec, audio_ext: g.ext, compacted: g.compacted, created_at: g.createdAt, has_audio: true });
      if (S.lecExtra[id]) parts.push(S.lecExtra[id]);
      var r = arr(S.ov && S.ov.recentLectures).filter(function (x) { return x.id === id; })[0];
      if (r) parts.push(r);
      var l = S.lec.items.filter(function (x) { return x.id === id; })[0];
      if (l) parts.push(l);
      if (!parts.length) return null;
      var out = {};
      parts.forEach(function (p) { Object.keys(p).forEach(function (k) { if (p[k] !== undefined) out[k] = p[k]; }); });
      if (!out.owner_email && out.owner_id) { var u = userById(out.owner_id); if (u) out.owner_email = u.email; }
      return out;
    }
    function patchLecture(id, patch) {
      if (!patch) return;
      function apply(list) { list.forEach(function (x, i) { if (x.id === id) list[i] = Object.assign({}, x, patch); }); }
      apply(S.lec.items);
      if (S.ov) apply(arr(S.ov.recentLectures));
      if (S.lecExtra[id]) S.lecExtra[id] = Object.assign({}, S.lecExtra[id], patch);
    }
    function dropLecture(id) {
      S.lec.items = S.lec.items.filter(function (x) { return x.id !== id; });
      S.lec.total = Math.max(0, S.lec.total - 1);
      if (S.ov && S.ov.recentLectures) S.ov.recentLectures = arr(S.ov.recentLectures).filter(function (x) { return x.id !== id; });
      if (S.st && S.st.largest) S.st.largest = arr(S.st.largest).filter(function (x) { return x.id !== id; });
      delete S.lecExtra[id];
    }

    // MARK: - Loaders
    async function loadOverview() {
      if (inflight.ov) return;
      inflight.ov = true;
      var r = await api('GET', '/api/admin/overview');
      inflight.ov = false;
      if (!r.ok || !r.data) {
        if (r.status === 401) return showGate('signin');
        if (r.status === 403) return showGate('forbidden');
        S.ovErr = r.error || 'error';
      } else {
        S.ov = r.data;
        S.ovErr = null;
        S.ovAt = Date.now();
      }
      if (S.lec.fallback) S.lec.items = fallbackLectures();
      renderCounts();
      renderBody();
    }
    async function loadOps() {
      if (inflight.ops) return;
      inflight.ops = true;
      var r = await api('GET', '/api/admin/ops');
      inflight.ops = false;
      if (r.ok && r.data && r.data.jobs) {
        S.ops = r.data;
        S.opsErr = null;
      } else {
        S.opsErr = r.status === 404 ? 'unavailable' : (r.error || 'error');
      }
      renderCounts();
      renderBody();
      updatePeekJob();
    }
    async function loadStorage() {
      if (inflight.st) return;
      inflight.st = true;
      var r = await api('GET', '/api/admin/storage');
      inflight.st = false;
      if (r.ok && r.data && r.data.totals) {
        S.st = r.data;
        S.stErr = null;
        S.stAt = Date.now();
      } else {
        S.stErr = r.status === 404 ? 'unavailable' : (r.error || 'error');
      }
      renderCounts();
      renderBody();
    }
    var lecSeq = 0;
    function fallbackLectures() {
      var L = S.lec;
      var q = L.q.trim().toLowerCase();
      return arr(S.ov && S.ov.recentLectures).filter(function (l) {
        if (L.status && l.status !== L.status) return false;
        if (L.owner && l.owner_id !== L.owner) return false;
        if (!q) return true;
        return [l.title, l.course, l.owner_email, l.owner_name].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }
    async function loadLectures(reset) {
      var L = S.lec;
      var seq = ++lecSeq;
      L.loading = true;
      if (reset && S.view === 'lectures' && !L.items.length) renderBody();
      var offset = reset ? 0 : L.items.length;
      var qs = 'status=' + encodeURIComponent(L.status) + '&q=' + encodeURIComponent(L.q.trim()) +
        '&owner=' + encodeURIComponent(L.owner) + '&limit=50&offset=' + offset;
      var r = await api('GET', '/api/admin/lectures?' + qs);
      if (seq !== lecSeq) return;
      L.loading = false;
      L.loaded = true;
      if (r.ok && r.data && Array.isArray(r.data.lectures)) {
        L.fallback = false;
        L.err = null;
        L.items = reset ? r.data.lectures : L.items.concat(r.data.lectures);
        L.total = Number(r.data.total) || 0;
        L.counts = r.data.counts ? obj(r.data.counts) : null;
      } else {
        L.fallback = true;
        L.err = r.status === 404 ? 'unavailable' : (r.error || 'error');
        L.items = fallbackLectures();
        L.total = L.items.length;
        L.counts = null;
      }
      renderCounts();
      if (S.view === 'lectures') renderBody();
    }
    var audSeq = 0;
    async function loadAudit(reset) {
      var A = S.aud;
      var seq = ++audSeq;
      A.loading = true;
      if (reset && S.view === 'audit' && !A.items.length) renderBody();
      var qs = 'q=' + encodeURIComponent(A.q.trim()) + '&action=' + encodeURIComponent(A.prefix) + '&limit=50' +
        (!reset && A.next ? '&cursor=' + encodeURIComponent(A.next) : '');
      var r = await api('GET', '/api/admin/audit?' + qs);
      if (seq !== audSeq) return;
      A.loading = false;
      A.loaded = true;
      if (r.ok && r.data && Array.isArray(r.data.logs)) {
        A.fallback = false;
        A.items = reset ? r.data.logs : A.items.concat(r.data.logs);
        A.next = r.data.nextCursor || null;
        A.counts = obj(r.data.counts);
        A.total = Number(r.data.total) || 0;
      } else {
        // Older server or transient failure: filter the recent entries from the overview.
        A.fallback = true;
        A.items = [];
        A.next = null;
        A.counts = null;
        if (!S.ov) await loadOverview();
      }
      if (S.view === 'audit') { renderSubbar(); renderBody(); $('h-count').textContent = headerCount(); }
    }
    function auditById(id) {
      return S.aud.items.filter(function (x) { return x.id === id; })[0] ||
        auditLogs().filter(function (x) { return x.id === id; })[0] || null;
    }
    async function ensureLectureDetail(id) {
      var l = findLecture(id);
      var r = await api('GET', '/api/admin/lectures/' + encodeURIComponent(id));
      if (!r.ok || !r.data || !r.data.lecture) {
        if (!l && S.peek && S.peek.kind === 'lecture' && S.peek.id === id) {
          S.peek.missing = r.status === 404 ? '강의를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.' : (r.error || '강의 정보를 불러오지 못했습니다.');
          renderPeek();
        }
        return;
      }
      // The admin detail DTO: list fields plus peek-only ones, never the note itself.
      S.lecExtra[id] = r.data.lecture;
      if (S.peek && S.peek.kind === 'lecture' && S.peek.id === id) renderPeek();
    }
    function refreshAll() {
      loadOverview();
      loadOps();
      if (S.view === 'storage' || S.view === 'overview' || S.st) loadStorage();
      if (S.view === 'lectures') loadLectures(true);
      toast('새로고침했습니다.');
    }

    // MARK: - Chrome (sidebar, header, subbar)
    function navCounts() {
      var c = {};
      var m = obj(S.ov && S.ov.metrics);
      if (S.ov) {
        c.members = { n: users().length, dot: m.pendingUsers ? 'yellow' : '' };
        c.lectures = { n: m.totalLectures, dot: m.errorLectures ? 'red' : '' };
      }
      if (S.ops) {
        var J = obj(S.ops.jobs);
        var active = arr(J.running).length + arr(J.queued).length;
        c.jobs = { n: active || '', dot: active ? 'blue' : '' };
        if (S.ops.disk && S.ops.disk.low) c.storage = { n: '', dot: 'red' };
      }
      return c;
    }
    function renderSidebar() {
      var c = navCounts();
      $('nav').innerHTML = VIEWS.map(function (v) {
        var cnt = c[v.id];
        var on = S.view === v.id;
        return '<a href="#' + v.id + '" class="nav-item' + (on ? ' active' : '') + '" data-action="nav" data-view="' + v.id + '"' + (on ? ' aria-current="page"' : '') + '>' +
          ic(v.icon) + '<span class="nav-label">' + v.label + '</span>' +
          (cnt && cnt.dot ? '<span class="nav-dot ' + cnt.dot + '"></span>' : '') +
          (cnt && cnt.n !== '' && cnt.n !== undefined ? '<span class="nav-count">' + num(cnt.n) + '</span>' : '') +
          '<span class="nav-hint"><kbd>G</kbd><kbd>' + (v.key === ',' ? ',' : v.key.toUpperCase()) + '</kbd></span></a>';
      }).join('');
      renderSidebarFoot();
    }
    function renderSidebarFoot() {
      var me = S.me;
      var dark = document.documentElement.getAttribute('data-theme') !== 'light';
      var who = me
        ? '<div class="me">' + avatar(me.displayName, me.email, me.id) + '<div class="min0"><div class="t strong">' + esc(me.displayName || me.email) + '</div><div class="t faint small">' + esc(ROLE_LABEL[me.role] || me.role) + ' · ' + esc(me.email) + '</div></div></div>'
        : '';
      $('side-foot').innerHTML = who +
        '<div class="foot-actions">' +
        '<button class="btn btn-ghost icon-btn" type="button" data-action="theme" title="' + (dark ? '라이트 모드' : '다크 모드') + '로 전환" aria-label="테마 전환">' + ic(dark ? 'sun' : 'moon') + '</button>' +
        '<button class="btn btn-ghost icon-btn" type="button" data-action="shortcuts" title="단축키 (?)" aria-label="단축키">' + ic('keyboard') + '</button>' +
        '<span class="sp"></span>' +
        '<a class="btn btn-ghost btn-sm" href="/">' + ic('external', 14) + '앱으로</a>' +
        '<button class="btn btn-ghost icon-btn" type="button" data-action="logout" title="로그아웃" aria-label="로그아웃">' + ic('logout') + '</button>' +
        '</div>';
    }
    function headerCount() {
      if (S.view === 'members' && S.ov) {
        var f = filteredMembers().length;
        var t = users().length;
        return f === t ? num(t) : num(f) + ' / ' + num(t);
      }
      if (S.view === 'lectures' && S.lec.loaded) return num(S.lec.total);
      if (S.view === 'jobs' && S.ops) { var J = obj(S.ops.jobs); return num(arr(J.running).length + arr(J.queued).length); }
      if (S.view === 'audit') {
        if (S.aud.loaded && !S.aud.fallback) return num(S.aud.total);
        if (S.ov) return num(filteredAudit().length);
      }
      return '';
    }
    function searchBox(placeholder, value) {
      return '<label class="search">' + ic('search', 14) + '<input id="q" type="search" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" autocomplete="off" spellcheck="false" aria-label="' + esc(placeholder) + '"><kbd>/</kbd></label>';
    }
    function renderHeader() {
      var v = viewDef(S.view);
      var h = '<button class="btn btn-ghost icon-btn menu-btn" type="button" data-action="drawer" aria-label="메뉴 열기">' + ic('menu') + '</button>' +
        '<div class="h-title">' + ic(v.icon) + '<span>' + v.label + '</span><span class="h-count" id="h-count"></span></div><span class="sp"></span>';
      if (S.view === 'overview' || S.view === 'jobs') h += '<span class="live hide-xs" title="5초마다 자동으로 갱신합니다"><i></i>실시간</span>';
      if (S.view === 'members') h += searchBox('이름, 이메일, 메모', S.mem.q);
      if (S.view === 'lectures') h += searchBox('제목, 과목, 소유자', S.lec.q);
      if (S.view === 'audit') h += searchBox('계정, 작업, 상세', S.aud.q);
      if (S.view === 'members') h += '<button class="btn btn-primary" type="button" data-action="new-member" title="새 멤버 (C)">' + ic('plus', 14) + '<span class="lbl">새 멤버</span></button>';
      else if (S.view === 'storage') h += '<button class="btn" type="button" data-action="compact-all">' + ic('compress', 14) + '<span class="lbl">전체 압축</span></button><button class="btn btn-ghost icon-btn" type="button" data-action="refresh" title="새로고침" aria-label="새로고침">' + ic('retry') + '</button>';
      else if (S.view === 'settings') h += '<span class="save-hint hide-xs" id="save-hint" hidden>저장되지 않은 변경사항</span><button class="btn btn-ghost" type="button" data-action="settings-reset" id="settings-reset" hidden>되돌리기</button><button class="btn btn-primary" type="button" data-action="settings-save" id="settings-save" disabled>저장</button>';
      else h += '<button class="btn btn-ghost icon-btn" type="button" data-action="refresh" title="새로고침" aria-label="새로고침">' + ic('retry') + '</button>';
      $('header').innerHTML = h;
      renderSubbar();
      $('h-count').textContent = headerCount();
    }
    function chip(group, value, label, on, n) {
      return '<button class="chip' + (on ? ' on' : '') + '" type="button" data-action="chip" data-group="' + group + '" data-value="' + esc(value) + '"' + (on ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + label +
        (n !== undefined && n !== null ? '<span class="chip-n">' + num(n) + '</span>' : '') + '</button>';
    }
    function renderSubbar() {
      var el = $('subbar');
      var h = '';
      if (S.view === 'members') {
        var us = users();
        var byRole = function (r) { return us.filter(function (u) { return u.role === r; }).length; };
        var bySt = function (s) { return us.filter(function (u) { return u.status === s; }).length; };
        h += chip('role', '', '전체 역할', !S.mem.role);
        ['owner', 'admin', 'member', 'viewer'].forEach(function (r) { h += chip('role', r, ROLE_LABEL[r], S.mem.role === r, byRole(r)); });
        h += '<span class="vsep"></span>';
        ['active', 'pending', 'suspended'].forEach(function (s) { h += chip('status', s, '<span class="sdot ' + STATUS_DOT[s] + '"></span>' + STATUS_LABEL[s], S.mem.status === s, bySt(s)); });
      } else if (S.view === 'lectures') {
        var L = S.lec;
        [['', '전체', ''], ['processing', '처리 중', 'processing'], ['error', '오류', 'error'], ['done', '완료', 'done']].forEach(function (t) {
          var on = L.status === t[0];
          var n = L.counts && !L.fallback ? L.counts[t[0] || 'all'] : (on && L.loaded ? L.total : null);
          h += chip('lstatus', t[0], (t[2] ? statusIcon(t[2], 50) : '') + t[1], on, n);
        });
        if (L.owner) {
          var o = userById(L.owner);
          h += '<span class="vsep"></span><button class="chip on" type="button" data-action="chip" data-group="owner" data-value="" title="소유자 필터 해제">' + ic('members', 12) + '소유자: ' + esc(o ? (o.display_name || o.email) : L.owner) + '<span class="x">' + ic('close', 12) + '</span></button>';
        }
      } else if (S.view === 'audit') {
        var logs = auditLogs();
        var ac = S.aud.counts && !S.aud.fallback ? S.aud.counts : null;
        h += chip('prefix', '', '전체', !S.aud.prefix, ac ? ac.all : logs.length);
        AUDIT_PREFIXES.forEach(function (p) {
          var n = ac ? ac[p] : logs.filter(function (a) { return String(a.action || '').indexOf(p + '.') === 0; }).length;
          h += chip('prefix', p, '<span class="act ' + p + '">' + p + '</span>', S.aud.prefix === p, n);
        });
      }
      el.innerHTML = h;
      el.hidden = !h;
    }
    function renderCounts() {
      if (S.gated || !S.me) return;
      renderSidebar();
      renderSubbar();
      var hc = $('h-count');
      if (hc) hc.textContent = headerCount();
    }

    // MARK: - Body
    function loadingHtml() { return '<div class="empty"><div class="spinner"></div><div>불러오는 중…</div></div>'; }
    function emptyHtml(icon, title, sub) {
      return '<div class="empty">' + ic(icon, 24) + '<div>' + title + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
    }
    function unavailHtml(what, action) {
      return '<div class="unavail">' + ic('alert', 14) + '<span>' + what + ' 정보를 지금 불러올 수 없습니다. 서버가 아직 이 기능을 지원하지 않거나 일시적인 오류일 수 있습니다.</span>' +
        (action ? '<button class="btn btn-sm" type="button" data-action="' + action + '">다시 시도</button>' : '') + '</div>';
    }
    var RENDER = {};
    var LAST_BODY = { html: '' };
    function renderBody(force) {
      if (S.gated || !S.me) return;
      var el = $('content');
      if (S.view === 'settings' && !force && $('settings-form')) {
        var oi = $('ops-info');
        if (oi) oi.innerHTML = opsInfoHtml();
        return;
      }
      var html = RENDER[S.view]();
      // Polls re-render every few seconds; skip identical markup so focus and hover survive.
      if (!force && el.getAttribute('data-view') === S.view && LAST_BODY.html === html) return;
      LAST_BODY.html = html;
      el.setAttribute('data-view', S.view);
      el.innerHTML = html;
      applySel();
      markOpenRow();
      if (S.view === 'settings') updateSettingsDirty();
    }

    // Overview
    function kpi(label, value, sub, extra) {
      return '<div class="kpi"><div class="kpi-l">' + label + '</div><div class="kpi-v">' + value + '</div><div class="kpi-s">' + sub + '</div>' + (extra || '') + '</div>';
    }
    function attentionItems() {
      var out = [];
      var ov = S.ov;
      var ops = S.ops;
      var st = S.st;
      var pending = users().filter(function (u) { return u.status === 'pending'; });
      pending.slice(0, 5).forEach(function (u) {
        out.push('<div class="row" data-open="member" data-id="' + esc(u.id) + '"><span class="att-ic c-yellow">' + ic('userplus', 14) + '</span>' +
          '<div class="c-main"><span class="t strong keep">가입 승인 대기</span><span class="t">' + esc(u.display_name || u.email) + '</span><span class="t muted hide-xs">' + esc(u.email) + '</span></div>' +
          timeEl(u.created_at, 'c-time') +
          '<button class="btn btn-sm" type="button" data-action="approve-user" data-user-id="' + esc(u.id) + '">' + ic('check', 13) + '승인</button></div>');
      });
      if (pending.length > 5) out.push('<div class="row" data-open="goto" data-id="members:pending"><span class="att-ic faint">' + ic('members', 14) + '</span><div class="c-main"><span class="muted">승인 대기 멤버 ' + num(pending.length - 5) + '명 더 보기</span></div><span class="c-icon">' + ic('arrow', 14) + '</span></div>');
      var failed = arr(ov && ov.recentLectures).filter(function (l) { return l.status === 'error'; });
      failed.slice(0, 5).forEach(function (l) {
        out.push('<div class="row" data-open="lecture" data-id="' + esc(l.id) + '"><span class="att-ic">' + statusIcon('error') + '</span>' +
          '<div class="c-main"><span class="t strong keep">분석 실패</span><span class="t">' + esc(l.title || '제목 없음') + '</span><span class="t muted hide-xs">' + esc(l.owner_email || '') + '</span></div>' +
          timeEl(l.updated_at || l.created_at, 'c-time') +
          (l.has_audio === false ? '' : '<button class="btn btn-sm" type="button" data-action="lec-retry" data-id="' + esc(l.id) + '">' + ic('retry', 13) + '재시도</button>') + '</div>');
      });
      var errTotal = Number(obj(ov && ov.metrics).errorLectures) || 0;
      if (errTotal > Math.min(5, failed.length)) out.push('<div class="row" data-open="goto" data-id="lectures:error"><span class="att-ic faint">' + ic('lectures', 14) + '</span><div class="c-main"><span class="muted">오류 강의 ' + num(errTotal) + '개 모두 보기</span></div><span class="c-icon">' + ic('arrow', 14) + '</span></div>');
      if (ops && ops.disk && ops.disk.low) {
        out.push('<div class="row" data-open="view" data-id="storage"><span class="att-ic c-red">' + ic('alert', 14) + '</span><div class="c-main"><span class="t strong keep">디스크 여유 공간 부족</span><span class="t muted">남은 공간 ' + fmtBytes(ops.disk.freeBytes) + ' · ' + Math.round(Number(ops.disk.usedPct) || 0) + '% 사용 중</span></div><span class="c-icon">' + ic('arrow', 14) + '</span></div>');
      }
      if (ops && ops.backups) {
        var latest = ops.backups.latest;
        var age = latest ? (Date.now() - Date.parse(latest.createdAt)) / 3600000 : Infinity;
        if (!latest || age > 36) {
          out.push('<div class="row" data-open="view" data-id="settings"><span class="att-ic c-orange">' + ic('archive', 14) + '</span><div class="c-main"><span class="t strong keep">' + (latest ? '백업이 오래되었습니다' : '백업이 없습니다') + '</span><span class="t muted">' + (latest ? '마지막 백업 ' + esc(relTime(latest.createdAt)) : '아직 생성된 데이터베이스 백업이 없습니다') + '</span></div>' +
            '<button class="btn btn-sm" type="button" data-action="maint-run">' + ic('tool', 13) + '유지보수 실행</button></div>');
        }
      }
      var ffmpegMissing = (ops && ops.server && ops.server.ffmpegAvailable === false) || (st && st.compaction && st.compaction.ffmpegAvailable === false);
      if (ffmpegMissing) {
        out.push('<div class="row" data-open="view" data-id="storage"><span class="att-ic c-orange">' + ic('chip', 14) + '</span><div class="c-main"><span class="t strong keep">ffmpeg를 사용할 수 없습니다</span><span class="t muted">오디오 압축이 동작하지 않습니다. 서버에 ffmpeg를 설치하세요.</span></div><span class="c-icon">' + ic('arrow', 14) + '</span></div>');
      }
      var comp = st && st.compaction;
      if (comp && !ffmpegMissing && Number(comp.candidates) > 0) {
        out.push('<div class="row" data-open="view" data-id="storage"><span class="att-ic c-accent">' + ic('compress', 14) + '</span><div class="c-main"><span class="t strong keep">압축 가능한 녹음 ' + num(comp.candidates) + '개</span><span class="t muted">약 ' + fmtBytes(comp.estimatedSavedBytes) + ' 절약 가능 (' + fmtBytes(comp.candidateBytes) + ' 대상)</span></div>' +
          '<button class="btn btn-sm" type="button" data-action="compact-all">미리보기</button></div>');
      }
      var lastMaint = ops && ops.maintenance && ops.maintenance.lastResult;
      if (lastMaint && arr(lastMaint.errors).length) {
        out.push('<div class="row" data-open="view" data-id="settings"><span class="att-ic c-red">' + ic('tool', 14) + '</span><div class="c-main"><span class="t strong keep">유지보수 오류 ' + num(arr(lastMaint.errors).length) + '건</span><span class="t muted">' + esc(arr(lastMaint.errors)[0]) + '</span></div>' + timeEl(lastMaint.finishedAt, 'c-time') + '</div>');
      }
      var dep = ops && ops.deploy && ops.deploy.lastResult;
      if (dep && dep.ok === false) {
        out.push('<div class="row" data-open="view" data-id="settings"><span class="att-ic c-red">' + ic('server', 14) + '</span><div class="c-main"><span class="t strong keep">최근 배포 실패</span><span class="t muted">' + esc(dep.error || dep.sha || '') + '</span></div>' + timeEl(dep.at, 'c-time') + '</div>');
      }
      return out;
    }
    function auditRow(a) {
      var p = String(a.action || '').split('.')[0];
      var cls = AUDIT_PREFIXES.indexOf(p) >= 0 ? p : '';
      return '<div class="row" data-open="audit" data-id="' + esc(a.id) + '">' +
        '<span class="act ' + cls + ' c-action t">' + esc(a.action) + '</span>' +
        '<div class="c-main"><span class="t">' + esc(a.detail || '—') + '</span></div>' +
        '<span class="c-actor t hide-xs">' + esc(a.actor_email || '') + '</span>' +
        timeEl(a.created_at, 'c-time') + '</div>';
    }
    RENDER.overview = function () {
      if (!S.ov) return S.ovErr ? unavailHtml('개요', 'reload-overview') : loadingHtml();
      var m = obj(S.ov.metrics);
      var ops = S.ops;
      var disk = ops && ops.disk;
      var audioBytes = S.st && S.st.totals ? S.st.totals.audioBytes : m.totalAudioBytes;
      var h = '<div class="kpis">';
      h += kpi('멤버', num(m.totalUsers), '활성 ' + num(m.activeUsers) + ' · <span class="' + (m.pendingUsers ? 'c-yellow' : '') + '">대기 ' + num(m.pendingUsers) + '</span> · 정지 ' + num(m.suspendedUsers));
      h += kpi('강의', num(m.totalLectures), '<span class="' + (m.errorLectures ? 'c-red' : '') + '">오류 ' + num(m.errorLectures) + '</span> · 공개 ' + num(m.publicLectures));
      h += kpi('오디오 용량', fmtBytes(audioBytes),
        disk ? '디스크 여유 ' + fmtBytes(disk.freeBytes) + ' / ' + fmtBytes(disk.totalBytes) : (S.opsErr ? '디스크 정보 없음' : '디스크 확인 중…'),
        disk ? bar(disk.usedPct, 'wide ' + (disk.low ? 'red' : Number(disk.usedPct) >= 80 ? 'orange' : '')) : '');
      if (ops) {
        var J = obj(ops.jobs);
        var d24 = obj(J.last24h);
        h += kpi('작업', num(arr(J.running).length) + '<span class="kpi-u">실행 중</span>', '대기 ' + num(arr(J.queued).length) + ' · 24시간 완료 ' + num(d24.completed) + (d24.failed ? ' · <span class="c-red">실패 ' + num(d24.failed) + '</span>' : ''));
      } else {
        h += kpi('작업', '—', S.opsErr ? '작업 정보 없음' : '불러오는 중…');
      }
      h += '</div>';
      var items = attentionItems();
      h += '<section class="section"><div class="section-h"><span class="sec-t">확인 필요</span>' + (items.length ? '<span class="count-pill">' + items.length + '</span>' : '') + '</div>';
      h += items.length ? items.join('') : '<div class="row-empty">' + ic('check', 14) + '확인이 필요한 항목이 없습니다.</div>';
      if (S.opsErr || S.stErr) h += '<div class="row-note">' + ic('alert', 12) + '운영·스토리지 정보를 불러오지 못해 디스크·백업·압축 점검은 건너뛰었습니다.</div>';
      h += '</section>';
      var logs = auditLogs().slice(0, 10);
      h += '<section class="section"><div class="section-h"><span class="sec-t">최근 활동</span><span class="sp"></span><button class="btn btn-ghost btn-sm" type="button" data-action="nav" data-view="audit">감사 로그 전체 보기' + ic('arrow', 12) + '</button></div>';
      h += logs.length ? logs.map(auditRow).join('') : '<div class="row-empty">기록된 활동이 없습니다.</div>';
      h += '</section>';
      return h;
    };

    // Members
    function filteredMembers() {
      var q = S.mem.q.trim().toLowerCase();
      return users().filter(function (u) {
        if (S.mem.role && u.role !== S.mem.role) return false;
        if (S.mem.status && u.status !== S.mem.status) return false;
        if (!q) return true;
        return [u.display_name, u.email, u.memo].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }
    function usageHtml(bytes, quotaMb) {
      var used = Number(bytes) || 0;
      var quota = (Number(quotaMb) || 0) * 1048576;
      if (!quota) return '<span class="mono muted">' + fmtBytes(used) + '</span><span class="faint small">무제한</span>';
      var p = pct(used, quota);
      return '<span class="mono muted">' + fmtBytes(used) + '</span>' + bar(p, usageClass(p)) + '<span class="mono faint">' + fmtBytes(quota) + '</span>';
    }
    function memberRow(u) {
      return '<div class="row" data-open="member" data-id="' + esc(u.id) + '">' +
        avatar(u.display_name, u.email, u.id) +
        '<div class="c-main"><span class="t strong">' + esc(u.display_name || u.email) + '</span><span class="t muted hide-md">' + esc(u.email) + '</span>' + (u.role === 'member' ? '' : roleBadge(u.role)) + '</div>' +
        (u.status === 'pending' ? '<button class="btn btn-sm" type="button" data-action="approve-user" data-user-id="' + esc(u.id) + '">' + ic('check', 13) + '승인</button>' : '') +
        '<span class="c-status hide-sm">' + statusLabel(u.status) + '</span>' +
        '<span class="c-num hide-sm" title="강의 ' + num(u.lecture_count) + '개 · 오류 ' + num(u.error_count) + '개">' + (Number(u.error_count) ? '<span class="sdot red"></span>' : ic('lectures', 13)) + num(u.lecture_count) + '</span>' +
        '<span class="c-usage hide-xs">' + usageHtml(u.audio_bytes, u.quota_mb) + '</span>' +
        '<span class="c-time" title="최근 로그인 ' + esc(absTime(u.last_login_at) || '기록 없음') + '">' + (u.last_login_at ? esc(relTime(u.last_login_at)) : '<span class="faint">—</span>') + '</span>' +
        '</div>';
    }
    RENDER.members = function () {
      if (!S.ov) return S.ovErr ? unavailHtml('멤버', 'reload-overview') : loadingHtml();
      var list = filteredMembers();
      if (!users().length) return emptyHtml('members', '아직 멤버가 없습니다.', '<button class="btn btn-primary" type="button" data-action="new-member">' + ic('plus', 14) + '새 멤버</button>');
      if (!list.length) return emptyHtml('search', '조건에 맞는 멤버가 없습니다.', '검색어나 필터를 바꿔 보세요.');
      if (S.mem.status) return list.map(memberRow).join('');
      var h = '';
      ['pending', 'active', 'suspended'].forEach(function (s) {
        var g = list.filter(function (u) { return u.status === s; });
        if (!g.length) return;
        h += '<div class="group-h"><span class="sdot ' + STATUS_DOT[s] + '"></span>' + STATUS_LABEL[s] + '<span class="n">' + num(g.length) + '</span></div>';
        h += g.map(memberRow).join('');
      });
      var other = list.filter(function (u) { return !STATUS_DOT[u.status]; });
      if (other.length) h += '<div class="group-h">기타<span class="n">' + num(other.length) + '</span></div>' + other.map(memberRow).join('');
      return h;
    };

    // Lectures
    function lectureRow(l) {
      var kind = lecKind(l);
      var job = l.job_kind !== 'compact' || !l.job_state ? ''
        : l.job_state === 'running' ? '<span class="badge blue hide-sm">압축 중</span>' : '<span class="badge hide-sm">압축 대기</span>';
      var size = l.has_audio === false
        ? '<span class="faint small">오디오 없음</span>'
        : (l.compacted ? '<span class="badge green hide-xs">압축됨</span>' : '') + '<span class="mono muted">' + fmtBytes(l.audio_size) + '</span>';
      return '<div class="row" data-open="lecture" data-id="' + esc(l.id) + '">' +
        '<span class="c-icon" title="' + esc((LEC_STATUS[l.status] || '') + (l.status === 'processing' ? ' · ' + stageText(l) + ' ' + (Number(l.progress) || 0) + '%' : '')) + '">' + statusIcon(kind, l.progress) + '</span>' +
        '<div class="c-main"><span class="t strong">' + esc(l.title || '제목 없음') + '</span>' + (l.course ? '<span class="t muted hide-xs">' + esc(l.course) + '</span>' : '') +
        (l.status === 'processing' ? '<span class="t lo faint small hide-xs">' + esc(stageText(l)) + ' ' + (Number(l.progress) || 0) + '%</span>' : '') + '</div>' +
        job +
        '<span class="c-owner t hide-sm">' + esc(l.owner_email || '') + '</span>' +
        '<span class="c-dur hide-sm">' + fmtClock(l.duration_sec) + '</span>' +
        '<span class="c-size">' + size + '</span>' +
        timeEl(l.created_at, 'c-time hide-xs') + '</div>';
    }
    RENDER.lectures = function () {
      var L = S.lec;
      if (!L.loaded) return loadingHtml();
      var h = '';
      if (L.fallback) {
        if (!S.ov) return L.err === 'unavailable' ? unavailHtml('강의', 'reload-lectures') : loadingHtml();
        h += '<div class="row-note">' + ic('alert', 12) + '전체 강의 목록을 불러올 수 없어 최근 강의 ' + num(arr(S.ov.recentLectures).length) + '개 안에서만 보여 줍니다.<span class="sp"></span><button class="btn btn-ghost btn-sm" type="button" data-action="reload-lectures">다시 시도</button></div>';
      }
      if (!L.items.length) return h + emptyHtml('lectures', L.q || L.status || L.owner ? '조건에 맞는 강의가 없습니다.' : '아직 강의가 없습니다.');
      h += L.items.map(lectureRow).join('');
      if (!L.fallback && L.items.length < L.total) {
        h += '<div class="more"><button class="btn" type="button" data-action="lec-more"' + (L.loading ? ' disabled' : '') + '>' + (L.loading ? '불러오는 중…' : '더 보기 (' + num(L.total - L.items.length) + '개 남음)') + '</button></div>';
      }
      return h;
    };

    // Jobs
    function kindBadge(kind) {
      return '<span class="badge ' + (kind === 'compact' ? 'green' : '') + '">' + esc(KIND_LABEL[kind] || kind) + '</span>';
    }
    function jobRow(j) {
      var running = j.state === 'running';
      var p = Math.max(0, Math.min(100, Number(j.progress) || 0));
      return '<div class="row" data-open="lecture" data-id="' + esc(j.lectureId) + '">' +
        '<span class="c-icon">' + statusIcon(running ? 'processing' : 'queued', p) + '</span>' + kindBadge(j.kind) +
        '<div class="c-main"><span class="t strong">' + esc(j.lectureTitle || '제목 없음') + '</span><span class="t muted hide-xs">' + esc(j.ownerEmail || '') + '</span></div>' +
        (running && j.kind === 'distill' ? '<span class="c-progress hide-xs">' + bar(p, 'yellow') + '<span class="num">' + p + '%</span></span>' : '') +
        '<span class="c-stage hide-sm">' + esc(running ? (STAGE_LABEL[j.stage] || j.stage || '실행 중') : '대기 중') + '</span>' +
        '<span class="c-time" title="' + esc(absTime(running ? j.startedAt : j.enqueuedAt)) + '">' + esc(relTime(running ? j.startedAt : j.enqueuedAt)) + '</span></div>';
    }
    function finishedRow(f) {
      var extra = !f.ok
        ? '<span class="t lo c-red small hide-xs" title="' + esc(f.error || '') + '">' + esc(f.error || '실패') + '</span>'
        : f.kind === 'compact' && Number(f.savedBytes) > 0 ? '<span class="c-green small mono hide-xs">−' + fmtBytes(f.savedBytes) + '</span>' : '';
      return '<div class="row" data-open="lecture" data-id="' + esc(f.lectureId) + '">' +
        '<span class="c-icon">' + statusIcon(f.ok ? 'done' : 'error') + '</span>' + kindBadge(f.kind) +
        '<div class="c-main"><span class="t strong">' + esc(f.lectureTitle || '제목 없음') + '</span>' + extra + '</div>' +
        '<span class="c-owner t hide-sm">' + esc(f.ownerEmail || '') + '</span>' +
        '<span class="c-dur" title="소요 시간">' + fmtMs(f.durationMs) + '</span>' +
        timeEl(f.finishedAt, 'c-time') + '</div>';
    }
    RENDER.jobs = function () {
      if (!S.ops) return S.opsErr ? unavailHtml('작업', 'reload-ops') : loadingHtml();
      var J = obj(S.ops.jobs);
      var c = obj(J.concurrency);
      var d = obj(J.last24h);
      var running = arr(J.running);
      var queued = arr(J.queued);
      var recent = arr(J.recent);
      var h = '<div class="kpis">' +
        kpi('실행 중', num(running.length), '동시 실행 · 노트 ' + num(c.distill) + ' · 압축 ' + num(c.compact)) +
        kpi('대기 중', num(queued.length), queued.length ? '가장 오래된 대기 ' + esc(relTime(queued.reduce(function (m, j) { return !m || Date.parse(j.enqueuedAt) < Date.parse(m) ? j.enqueuedAt : m; }, ''))) : '대기 중인 작업 없음') +
        kpi('24시간 완료', num(d.completed), (d.failed ? '<span class="c-red">실패 ' + num(d.failed) + '</span>' : '실패 0')) +
        kpi('평균 처리 시간', d.avgDurationMs ? fmtMs(d.avgDurationMs) : '—', '최근 24시간 기준') + '</div>';
      h += '<div class="group-h">' + statusIcon('processing', 60) + '실행 중<span class="n">' + num(running.length) + '</span></div>';
      h += running.length ? running.map(jobRow).join('') : '<div class="row-note">실행 중인 작업이 없습니다.</div>';
      h += '<div class="group-h">' + statusIcon('queued') + '대기 중<span class="n">' + num(queued.length) + '</span></div>';
      h += queued.length ? queued.map(jobRow).join('') : '<div class="row-note">대기 중인 작업이 없습니다.</div>';
      h += '<div class="group-h">' + ic('clock', 14) + '최근 완료<span class="n">' + num(recent.length) + '</span></div>';
      h += recent.length ? recent.map(finishedRow).join('') : '<div class="row-note">최근 완료된 작업이 없습니다.</div>';
      return h;
    };

    // Storage
    function hbars(rows, cls) {
      var max = rows.reduce(function (m, r) { return Math.max(m, Number(r.value) || 0); }, 0);
      if (!rows.length) return '<div class="faint small">데이터가 없습니다.</div>';
      return '<div class="hbars">' + rows.map(function (r) {
        return '<div class="hb' + (r.open ? ' click' : '') + '"' + (r.open ? ' data-open="member" data-id="' + esc(r.open) + '"' : '') + '>' +
          '<span class="hb-l" title="' + esc(r.title || '') + '">' + r.label + '</span>' + bar(pct(r.value, max), r.cls || cls || '') +
          '<span class="hb-v">' + r.text + '</span></div>';
      }).join('') + '</div>';
    }
    function largestRow(g) {
      return '<div class="row" data-open="lecture" data-id="' + esc(g.id) + '">' +
        '<span class="c-icon">' + ic('file', 14) + '</span>' +
        '<div class="c-main"><span class="t strong">' + esc(g.title || '제목 없음') + '</span><span class="t muted hide-xs">' + esc(g.course || '') + '</span>' +
        '<span class="badge hide-xs">' + esc(extLabel(g.ext)) + '</span>' + (g.compacted ? '<span class="badge green hide-xs">압축됨</span>' : '') + '</div>' +
        '<span class="c-owner t hide-sm">' + esc(g.ownerEmail || '') + '</span>' +
        '<span class="c-dur hide-sm">' + fmtClock(g.durationSec) + '</span>' +
        '<span class="c-dur mono" style="width:76px">' + fmtBytes(g.audioBytes) + '</span>' +
        '<span class="c-btns">' + (g.compacted ? '' : '<button class="btn btn-sm hide-xs" type="button" data-action="lec-compact" data-id="' + esc(g.id) + '" title="지금 압축">' + ic('compress', 13) + '압축</button>') +
        '<button class="btn btn-sm btn-ghost icon-btn danger-text" type="button" data-action="lec-del-audio" data-id="' + esc(g.id) + '" title="오디오 삭제" aria-label="오디오 삭제">' + ic('trash', 13) + '</button></span></div>';
    }
    RENDER.storage = function () {
      if (!S.st) return S.stErr ? unavailHtml('스토리지', 'reload-storage') : loadingHtml();
      var st = S.st;
      var T = obj(st.totals);
      var C = obj(st.compaction);
      var R = obj(st.reclaimable);
      var tr = obj(st.trash);
      var disk = S.ops && S.ops.disk;
      var h = '<div class="kpis">' +
        kpi('오디오', fmtBytes(T.audioBytes), num(T.withAudio) + '개 녹음 · 강의 ' + num(T.lectures) + '개') +
        kpi('업로드 폴더', fmtBytes(T.uploadsBytes), num(T.uploadsFiles) + '개 파일 (고아 파일 포함)') +
        (disk
          ? kpi('디스크', fmtBytes(disk.freeBytes) + '<span class="kpi-u">여유</span>', Math.round(Number(disk.usedPct) || 0) + '% 사용 · 전체 ' + fmtBytes(disk.totalBytes), bar(disk.usedPct, 'wide ' + (disk.low ? 'red' : Number(disk.usedPct) >= 80 ? 'orange' : '')))
          : kpi('디스크', '—', S.opsErr ? '측정할 수 없음' : '확인 중…')) +
        kpi('압축으로 절약', fmtBytes(C.savedBytesTotal), num(C.compactedCount) + '개 녹음 압축됨') + '</div>';
      h += '<div class="cards">';
      // Compaction
      var ffOk = C.ffmpegAvailable !== false;
      var kbps = Number(C.bitrateKbps) || 0;
      h += '<div class="card"><div class="card-h">' + ic('compress', 14) + '<span class="sec-t">압축</span>' +
        (!ffOk ? '<span class="badge red">ffmpeg 없음</span>' : C.enabled ? '<span class="badge green">자동 압축 켜짐</span>' : '<span class="badge">자동 압축 꺼짐</span>') + '</div>' +
        '<div class="card-b"><dl class="kv">' +
        '<dt>비트레이트</dt><dd>' + (kbps ? num(kbps) + ' kbps · 시간당 약 ' + (Math.round(kbps * 0.45 * 10) / 10) + ' MB' : '—') + '</dd>' +
        '<dt>압축 대상</dt><dd>' + num(C.candidates) + '개 · ' + fmtBytes(C.candidateBytes) + '</dd>' +
        '<dt>예상 절약</dt><dd' + (Number(C.estimatedSavedBytes) ? ' class="c-green">약 ' + fmtBytes(C.estimatedSavedBytes) : '>—') + '</dd>' +
        '<dt>압축 완료</dt><dd>' + num(C.compactedCount) + '개 · ' + fmtBytes(C.savedBytesTotal) + ' 절약</dd>' +
        '<dt>진행 상황</dt><dd>실행 ' + num(C.running) + ' · 대기 ' + num(C.queued) + '</dd>' +
        '</dl>' + (!ffOk ? '<div class="callout red">' + ic('alert', 14) + '<div>서버에서 ffmpeg를 찾을 수 없어 압축할 수 없습니다.</div></div>' : '') +
        '<div class="inline-actions" style="margin-top:12px"><button class="btn btn-primary btn-sm" type="button" data-action="compact-all"' + (!ffOk || !Number(C.candidates) ? ' disabled' : '') + '>' + ic('compress', 13) + '전체 압축</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="nav" data-view="settings">설정 변경</button></div></div></div>';
      // Reclaimable
      var fa = obj(R.failedAudio);
      var rt = obj(R.retention);
      var or = obj(R.orphans);
      var trashDays = Number(tr.retentionDays) || 7;
      var failedDays = Number(obj(settingsBase()).failed_audio_retention_days) || 0;
      h += '<div class="card"><div class="card-h">' + ic('trash', 14) + '<span class="sec-t">회수 가능 공간</span></div>' +
        '<div class="rec"><div class="min0 grow"><div class="strong">실패한 강의의 오디오</div><div class="muted small">' + cntBytes(fa) + (failedDays ? ' · ' + failedDays + '일 지나면 강의째 삭제' : ' · 정리 정책 꺼짐') + '</div></div>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="goto-lectures-error">목록</button>' +
        '<button class="btn btn-sm" type="button" data-action="retention"' + (!Number(fa.count) || !failedDays ? ' disabled title="설정에서 실패한 강의 보존 기간을 켜면 정리할 수 있습니다"' : '') + '>정리</button></div>' +
        '<div class="rec"><div class="min0 grow"><div class="strong">보존 기간이 지난 오디오</div><div class="muted small">' + (Number(rt.days) ? cntBytes(rt) + ' · ' + num(rt.days) + '일 경과, 노트는 유지' : '보존 정책 꺼짐') + '</div></div>' +
        '<button class="btn btn-sm" type="button" data-action="retention"' + (!Number(rt.days) || !Number(rt.count) ? ' disabled' : '') + '>정리</button></div>' +
        '<div class="rec"><div class="min0 grow"><div class="strong">고아 파일</div><div class="muted small">' + cntBytes(or) + ' · 어떤 강의도 참조하지 않는 업로드</div></div>' +
        '<button class="btn btn-sm" type="button" data-action="gc"' + (!Number(or.count) ? ' disabled' : '') + '>휴지통으로 이동</button></div>' +
        '<div class="rec">' + ic('archive', 14) + '<div class="min0 grow"><div class="strong">휴지통</div><div class="muted small">' + cntBytes(tr) + ' · ' + num(trashDays) + '일 후 자동 삭제</div></div></div>' +
        '</div>';
      // Breakdowns
      var fmts = arr(st.byFormat).map(function (f) { return { label: '<span class="mono">' + esc(extLabel(f.ext)) + '</span>', title: f.ext, value: f.bytes, text: num(f.count) + '개 · ' + fmtBytes(f.bytes) }; });
      h += '<div class="card"><div class="card-h">' + ic('file', 14) + '<span class="sec-t">형식별</span></div><div class="card-b">' + hbars(fmts) + '</div></div>';
      var stc = { done: 'green', processing: 'yellow', error: 'red' };
      var sts = arr(st.byStatus).map(function (s) { return { label: esc(LEC_STATUS[s.status] || s.status), value: s.audioBytes, cls: stc[s.status] || '', text: num(s.count) + '개 · ' + fmtBytes(s.audioBytes) }; });
      h += '<div class="card"><div class="card-h">' + ic('lectures', 14) + '<span class="sec-t">상태별</span></div><div class="card-b">' + hbars(sts) + '</div></div>';
      var bus = arr(st.byUser).map(function (u) {
        var p = u.usedPct === null || u.usedPct === undefined ? null : Number(u.usedPct);
        return { label: esc(u.displayName || u.email), title: u.email, value: u.audioBytes, open: u.userId, cls: p === null ? '' : usageClass(p),
          text: num(u.lectureCount) + '개 · ' + fmtBytes(u.audioBytes) + ' · ' + (p === null ? '무제한' : Math.round(p) + '%') };
      });
      h += '<div class="card full"><div class="card-h">' + ic('members', 14) + '<span class="sec-t">사용자별</span><span class="faint small">한도 대비 사용률</span></div><div class="card-b">' + hbars(bus) + '</div></div>';
      var big = arr(st.largest);
      h += '<div class="card full"><div class="card-h">' + ic('storage', 14) + '<span class="sec-t">가장 큰 녹음</span><span class="count-pill">' + num(big.length) + '</span></div>' +
        (big.length ? big.map(largestRow).join('') : '<div class="row-note">저장된 녹음이 없습니다.</div>') + '</div>';
      h += '</div>';
      return h;
    };

    // Audit
    function filteredAudit() {
      var q = S.aud.q.trim().toLowerCase();
      return auditLogs().filter(function (a) {
        if (S.aud.prefix && String(a.action || '').indexOf(S.aud.prefix + '.') !== 0) return false;
        if (!q) return true;
        return [a.actor_email, a.action, a.detail, a.target_id].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }
    RENDER.audit = function () {
      var A = S.aud;
      if (!A.loaded) return loadingHtml();
      if (A.fallback) {
        if (!S.ov) return S.ovErr ? unavailHtml('감사 로그', 'reload-audit') : loadingHtml();
        var list = filteredAudit();
        var note = '<div class="row-note">' + ic('alert', 12) + '전체 기록을 불러올 수 없어 최근 ' + num(auditLogs().length) + '건 안에서만 보여 줍니다.<span class="sp"></span><button class="btn btn-ghost btn-sm" type="button" data-action="reload-audit">다시 시도</button></div>';
        if (!auditLogs().length) return note + emptyHtml('audit', '기록된 감사 로그가 없습니다.');
        if (!list.length) return note + emptyHtml('search', '조건에 맞는 기록이 없습니다.');
        return note + list.map(auditRow).join('');
      }
      if (!A.items.length) return emptyHtml(A.q || A.prefix ? 'search' : 'audit', A.q || A.prefix ? '조건에 맞는 기록이 없습니다.' : '기록된 감사 로그가 없습니다.');
      var h = A.items.map(auditRow).join('');
      if (A.next) {
        h += '<div class="more"><button class="btn" type="button" data-action="aud-more"' + (A.loading ? ' disabled' : '') + '>' +
          (A.loading ? '불러오는 중…' : '더 보기 (' + num(Math.max(0, A.total - A.items.length)) + '건 남음)') + '</button></div>';
      } else if (A.items.length > 20) {
        h += '<div class="row-note">모든 기록을 표시했습니다.</div>';
      }
      return h;
    };

    // Settings
    var BITRATES = [24, 32, 40, 48, 64, 96];
    var RET_DEFAULTS = { 'set-ret-audio': 180, 'set-ret-failed': 30, 'set-ret-audit': 365 };
    function swInput(id, checked, extra) {
      return '<input type="checkbox" class="switch" id="' + id + '"' + (checked ? ' checked' : '') + (extra || '') + '>';
    }
    function setRow(title, desc, ctl, forId) {
      return '<div class="set-row"><div class="sr-text">' + (forId ? '<label class="sr-title" for="' + forId + '">' + title + '</label>' : '<div class="sr-title">' + title + '</div>') +
        (desc ? '<div class="sr-desc">' + desc + '</div>' : '') + '</div><div class="sr-ctl">' + ctl + '</div></div>';
    }
    function retCtl(id, days) {
      var on = Number(days) > 0;
      return swInput(id + '-on', on, ' data-ret="' + id + '" aria-label="사용"') +
        '<span class="ret-state' + (on ? '' : ' off') + '" id="' + id + '-state">' + (on ? '사용' : '끄기') + '</span>' +
        '<input type="number" class="input num ret-days" id="' + id + '" min="1" max="3650" step="1" value="' + (on ? Number(days) : '') + '" placeholder="—"' + (on ? '' : ' disabled') + ' aria-label="보존 일수"><span class="muted">일</span>';
    }
    function bitrateHint(k) { return '녹음 1시간당 약 ' + (Math.round(Number(k) * 0.45 * 10) / 10) + ' MB'; }
    RENDER.settings = function () {
      var s = settingsBase();
      if (!s) return S.ovErr ? unavailHtml('설정', 'reload-overview') : loadingHtml();
      var kbps = Number(s.storage_compact_bitrate_kbps) || 32;
      var rates = BITRATES.indexOf(kbps) >= 0 ? BITRATES : BITRATES.concat([kbps]).sort(function (a, b) { return a - b; });
      var ffMissing = (S.ops && S.ops.server && S.ops.server.ffmpegAvailable === false) || (S.st && S.st.compaction && S.st.compaction.ffmpegAvailable === false);
      var rt = S.st ? obj(obj(S.st.reclaimable).retention) : null;
      var h = '<form class="settings" id="settings-form" autocomplete="off">';
      h += '<section class="set-sec"><h2 class="set-sec-h">가입 정책</h2><p class="set-sec-d">새 멤버가 가입하는 방식과 기본 권한을 정합니다.</p><div class="set-card">' +
        setRow('공개 회원가입 허용', '끄면 로그인 화면의 가입이 막히고 관리자만 멤버를 추가할 수 있습니다.', swInput('set-signup', s.allow_public_signup), 'set-signup') +
        setRow('가입 시 관리자 승인 필요', '새 가입자는 승인 대기 상태로 시작하며 승인 후 이용할 수 있습니다.', swInput('set-approval', s.default_require_approval), 'set-approval') +
        setRow('기본 역할', 'Member는 녹음·노트 생성·공유가 가능하고 Viewer는 열람만 할 수 있습니다.',
          '<select class="input" id="set-role"><option value="member"' + (s.default_user_role !== 'viewer' ? ' selected' : '') + '>Member</option><option value="viewer"' + (s.default_user_role === 'viewer' ? ' selected' : '') + '>Viewer</option></select>', 'set-role') +
        setRow('노트 자동 정리 엔진 기본 허용', '새 멤버가 서버 AI 키로 강의 노트를 생성할 수 있습니다.', swInput('set-serverkey', s.default_can_use_server_key), 'set-serverkey') +
        setRow('기본 오디오 한도', '새 멤버의 오디오 저장 한도입니다. 0이면 무제한입니다.',
          '<input type="number" class="input num" id="set-quota" min="0" step="256" style="width:110px;text-align:right" value="' + (Number(s.default_quota_mb) || 0) + '"><span class="muted">MB</span>', 'set-quota') +
        '</div></section>';
      h += '<section class="set-sec"><h2 class="set-sec-h">스토리지</h2><p class="set-sec-d">완료된 강의의 오디오를 음성에 맞춘 모노 AAC(.m4a)로 다시 인코딩해 공간을 줄입니다.</p><div class="set-card">' +
        setRow('자동 압축', '노트 생성이 끝난 녹음을 백그라운드에서 압축합니다.' + (ffMissing ? ' <span class="c-red">서버에 ffmpeg가 없어 지금은 동작하지 않습니다.</span>' : ''), swInput('set-compact', s.storage_auto_compact), 'set-compact') +
        setRow('압축 비트레이트', '<span id="bitrate-hint">' + bitrateHint(kbps) + '</span> · 낮을수록 작지만 음질이 떨어집니다.',
          '<select class="input" id="set-bitrate">' + rates.map(function (r) { return '<option value="' + r + '"' + (r === kbps ? ' selected' : '') + '>' + r + ' kbps</option>'; }).join('') + '</select>', 'set-bitrate') +
        '</div></section>';
      h += '<section class="set-sec"><h2 class="set-sec-h">보존 정책</h2><p class="set-sec-d">기간이 지난 데이터를 유지보수 때 자동으로 정리합니다. 0일(끄기)이면 정리하지 않습니다.</p>' +
        '<div class="callout yellow">' + ic('alert', 14) + '<div>보존 정책으로 지운 데이터는 복구할 수 없습니다. 완료된 강의는 오디오만 삭제되고 노트는 남지만 다시 듣거나 재분석할 수 없습니다. 실패한 강의는 노트가 없으므로 강의 자체가 오디오와 함께 삭제됩니다.</div></div>' +
        '<div class="set-card">' +
        setRow('완료된 강의의 오디오', '완료 후 지정한 기간이 지나면 오디오를 영구 삭제합니다. 노트(Markdown)는 그대로 유지됩니다.' +
          (rt && Number(rt.days) ? ' <span class="faint">현재 기준 ' + num(rt.count) + '개 · ' + fmtBytes(rt.bytes) + ' 대상</span>' : ''), retCtl('set-ret-audio', s.audio_retention_days)) +
        setRow('실패한 강의', '노트가 없는 실패한 강의를 지정한 기간 동안 변경이 없으면 오디오와 함께 강의를 삭제합니다.', retCtl('set-ret-failed', s.failed_audio_retention_days)) +
        setRow('감사 로그', '기간이 지난 감사 로그를 삭제합니다. 끄면 모든 기록을 보관합니다.', retCtl('set-ret-audit', s.audit_retention_days)) +
        '</div></section>';
      h += '<section class="set-sec"><h2 class="set-sec-h">운영 정보</h2><p class="set-sec-d">유지보수, 백업, 배포, 서버 상태입니다.</p><div id="ops-info">' + opsInfoHtml() + '</div></section>';
      h += '</form>';
      return h;
    };
    function opsInfoHtml() {
      if (!S.ops) return S.opsErr ? unavailHtml('운영', 'reload-ops') : loadingHtml();
      var o = S.ops;
      var mt = obj(o.maintenance);
      var lr = mt.lastResult;
      var bk = obj(o.backups);
      var dp = obj(o.deploy);
      var sv = obj(o.server);
      var db = obj(o.database);
      var mem = obj(sv.memory);
      var rq = obj(sv.requests);
      var lastSummary = lr
        ? '세션 ' + num(lr.expiredSessions) + ' · 고아 파일 ' + num(obj(lr.orphanFiles).count) + ' · 보존 ' + num(obj(lr.retention).count + obj(lr.failedRetention).count) + (arr(lr.errors).length ? ' · <span class="c-red">오류 ' + num(arr(lr.errors).length) + '</span>' : '')
        : '기록 없음';
      var h = '<div class="set-card">';
      h += '<div class="set-row"><div class="sr-text"><div class="sr-title">유지보수</div><div class="sr-desc">' + num(mt.intervalMin) + '분마다 실행 · 마지막 실행 ' + (mt.lastRunAt ? timeEl(mt.lastRunAt) : '없음') + (mt.running ? ' · <span class="c-blue">실행 중</span>' : '') + '</div><div class="sr-desc">' + lastSummary + '</div></div>' +
        '<div class="sr-ctl"><button class="btn" type="button" data-action="maint-run"' + (mt.running ? ' disabled' : '') + '>' + ic('tool', 14) + '지금 유지보수 실행</button></div></div>';
      var latest = bk.latest;
      h += setRow('백업', latest
        ? '<span class="mono">' + esc(latest.file) + '</span> · ' + fmtBytes(latest.sizeBytes) + ' · ' + timeEl(latest.createdAt) + '<br>' + num(bk.count) + '개 보관 중 (최대 ' + num(bk.keep) + '개) · ' + fmtBytes(bk.totalBytes)
        : '<span class="c-orange">아직 백업이 없습니다.</span> 유지보수를 실행하면 백업이 생성됩니다.', '');
      var lastDep = dp.lastResult;
      h += setRow('배포', dp.inProgress ? '<span class="c-blue">배포 진행 중…</span>' : lastDep
        ? (lastDep.ok ? '<span class="c-green">성공</span>' : '<span class="c-red">실패</span>') + ' · <span class="mono">' + esc(String(lastDep.sha || '').slice(0, 7)) + '</span> · ' + timeEl(lastDep.at) + (lastDep.error ? '<div class="pre">' + esc(lastDep.error) + '</div>' : '')
        : '배포 기록이 없습니다.', '');
      h += setRow('서버', '<span class="mono">' + esc(String(sv.gitSha || '').slice(0, 7) || '—') + '</span> · 가동 ' + fmtDur(sv.uptimeSec) + ' · 메모리 ' + fmtBytes(mem.rssBytes) + ' (힙 ' + fmtBytes(mem.heapUsedBytes) + ')' +
        '<br>Bun ' + esc(sv.bunVersion || '—') + ' · ' + esc(sv.platform || '') + ' · PID ' + esc(sv.pid) + ' · ffmpeg ' + (sv.ffmpegAvailable ? '<span class="c-green">사용 가능</span>' : '<span class="c-red">없음</span>') +
        ' · 요청 ' + num(rq.total) + (Number(rq.errors5xx) ? ' (<span class="c-red">5xx ' + num(rq.errors5xx) + '</span>)' : ''), '');
      h += setRow('데이터베이스', fmtBytes(db.sizeBytes) + ' (WAL ' + fmtBytes(db.walBytes) + ') · 멤버 ' + num(db.users) + ' · 강의 ' + num(db.lectures) + ' · 세션 ' + num(db.sessions) + ' · 감사 로그 ' + num(db.auditLogs), '');
      h += '</div>';
      return h;
    }
    function readSettingsForm() {
      function ret(id) { return $(id + '-on').checked ? Math.max(1, Math.round(Number($(id).value) || 0)) : 0; }
      return {
        allow_public_signup: $('set-signup').checked,
        default_require_approval: $('set-approval').checked,
        default_user_role: $('set-role').value === 'viewer' ? 'viewer' : 'member',
        default_can_use_server_key: $('set-serverkey').checked,
        default_quota_mb: Math.max(0, Math.round(Number($('set-quota').value) || 0)),
        storage_auto_compact: $('set-compact').checked,
        storage_compact_bitrate_kbps: Number($('set-bitrate').value) || 32,
        audio_retention_days: ret('set-ret-audio'),
        failed_audio_retention_days: ret('set-ret-failed'),
        audit_retention_days: ret('set-ret-audit')
      };
    }
    function settingsDirty() {
      var base = settingsBase();
      if (!base || !$('settings-form')) return false;
      var cur = readSettingsForm();
      return Object.keys(cur).some(function (k) {
        var b = base[k];
        if (typeof cur[k] === 'boolean') return Boolean(b) !== cur[k];
        if (typeof cur[k] === 'number') return (Number(b) || 0) !== cur[k];
        return String(b || '') !== String(cur[k]);
      });
    }
    function updateSettingsDirty() {
      var dirty = settingsDirty();
      var b = $('settings-save');
      if (b) b.disabled = !dirty;
      var r = $('settings-reset');
      if (r) r.hidden = !dirty;
      var hn = $('save-hint');
      if (hn) hn.hidden = !dirty;
    }
    async function saveSettings() {
      if (!$('settings-form')) return;
      var body = readSettingsForm();
      var btn = $('settings-save');
      if (btn) btn.disabled = true;
      var r = await api('PATCH', '/api/admin/settings', body);
      if (!r.ok || !r.data) {
        toast(r.error || '설정을 저장하지 못했습니다.', 'error');
        updateSettingsDirty();
        return;
      }
      if (r.data.settings) {
        if (S.ov) S.ov.settings = r.data.settings;
        if (S.st) S.st.settings = r.data.settings;
      }
      toast('설정을 저장했습니다.', 'ok');
      renderBody(true);
      if (S.st) loadStorage();
    }

    // MARK: - Selection (j/k) and peek
    function rowEls() { return Array.prototype.slice.call($('content').querySelectorAll('[data-open]')); }
    function rowKey(el) { return el.getAttribute('data-open') + ':' + (el.getAttribute('data-id') || ''); }
    function applySel() {
      rowEls().forEach(function (r) { r.classList.toggle('sel', rowKey(r) === S.selKey); });
    }
    function markOpenRow() {
      var key = S.peek && S.peek.id ? S.peek.kind + ':' + S.peek.id : '';
      rowEls().forEach(function (r) { r.classList.toggle('is-open', rowKey(r) === key); });
    }
    function moveSel(d) {
      var rows = rowEls();
      if (!rows.length) return false;
      var i = -1;
      rows.forEach(function (r, idx) { if (rowKey(r) === S.selKey) i = idx; });
      i = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + d));
      S.selKey = rowKey(rows[i]);
      applySel();
      rows[i].scrollIntoView({ block: 'nearest' });
      var kind = rows[i].getAttribute('data-open');
      if (S.peek && (kind === 'member' || kind === 'lecture' || kind === 'audit')) openFromEl(rows[i]);
      return true;
    }
    function openSelected() {
      var row = rowEls().filter(function (r) { return rowKey(r) === S.selKey; })[0];
      if (row) openFromEl(row);
    }
    function openFromEl(el) {
      var kind = el.getAttribute('data-open');
      var id = el.getAttribute('data-id') || '';
      if ($('content').contains(el)) { S.selKey = rowKey(el); applySel(); }
      if (kind === 'view') return go(id);
      if (kind === 'goto') {
        var parts = id.split(':');
        if (parts[0] === 'members') { S.mem.status = parts[1] || ''; S.mem.role = ''; S.mem.q = ''; }
        if (parts[0] === 'lectures') { S.lec.status = parts[1] || ''; S.lec.q = ''; S.lec.owner = ''; }
        return go(parts[0], { reload: true });
      }
      openPeek(kind, id);
    }
    function openPeek(kind, id) {
      var p = $('peek');
      var wasOpen = p.classList.contains('open');
      S.peek = { kind: kind, id: id || null };
      renderPeek();
      p.classList.add('open');
      document.body.classList.add('peek-open');
      if (!wasOpen) p.scrollTop = 0;
      markOpenRow();
      if (kind === 'lecture') ensureLectureDetail(id);
      if (kind === 'new-member') setTimeout(function () { var e = $('cu-email'); if (e) e.focus(); }, 30);
    }
    function closePeek() {
      if (!S.peek) return;
      var p = $('peek');
      if (p.contains(document.activeElement)) document.activeElement.blur();
      S.peek = null;
      p.classList.remove('open');
      document.body.classList.remove('peek-open');
      markOpenRow();
    }
    function peekHead(crumb, title) {
      return '<div class="peek-h"><span class="peek-crumb">' + crumb + '</span><span class="faint">/</span><span class="t strong grow">' + title + '</span>' +
        '<button class="btn btn-ghost icon-btn" type="button" data-action="peek-close" title="닫기 (Esc)" aria-label="닫기">' + ic('close') + '</button></div>';
    }
    function prop(k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }
    function field(label, ctl, hint, forId) {
      return '<div class="field">' + (forId ? '<label class="lbl" for="' + forId + '">' + label + '</label>' : '<span class="lbl">' + label + '</span>') + ctl + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    }
    function swRow(id, label, desc, checked) {
      return '<label class="sw-row" for="' + id + '">' + swInput(id, checked) + '<span class="sw-text"><span class="strong">' + label + '</span>' + (desc ? '<br><span class="hint">' + desc + '</span>' : '') + '</span></label>';
    }
    function segRadios(name, opts, value) {
      return '<div class="seg" role="radiogroup">' + opts.map(function (o) {
        return '<label><input type="radio" name="' + name + '" value="' + o[0] + '"' + (o[0] === value ? ' checked' : '') + '><span>' + o[1] + '</span></label>';
      }).join('') + '</div>';
    }
    function roleSelect(id, value, allowed) {
      return '<select class="input" id="' + id + '">' + allowed.map(function (r) {
        return '<option value="' + r + '"' + (r === value ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>';
      }).join('') + '</select>';
    }
    function renderPeek() {
      var p = S.peek;
      var el = $('peek');
      if (!p) { el.innerHTML = ''; return; }
      var html;
      if (p.kind === 'member') {
        var u = userById(p.id);
        html = u ? memberPeek(u) : peekHead('멤버', '') + '<div class="peek-b">' + emptyHtml('members', '멤버를 찾을 수 없습니다.') + '</div>';
      } else if (p.kind === 'new-member') {
        html = newMemberPeek();
      } else if (p.kind === 'lecture') {
        var l = findLecture(p.id);
        html = l ? lecturePeek(l) : peekHead('강의', '') + '<div class="peek-b">' + (p.missing ? emptyHtml('lectures', esc(p.missing)) : loadingHtml()) + '</div>';
      } else if (p.kind === 'audit') {
        var a = auditById(p.id);
        html = a ? auditPeek(a) : peekHead('감사 로그', '') + '<div class="peek-b">' + emptyHtml('audit', '기록을 찾을 수 없습니다.') + '</div>';
      } else {
        html = '';
      }
      var key = p.kind + ':' + (p.id || '');
      var body = el.querySelector('.peek-b');
      var keep = el.getAttribute('data-key') === key && body ? body.scrollTop : 0;
      el.setAttribute('data-key', key);
      el.innerHTML = html;
      body = el.querySelector('.peek-b');
      if (body && keep) body.scrollTop = keep;
    }
    function memberPeek(u) {
      var used = Number(u.audio_bytes) || 0;
      var quota = (Number(u.quota_mb) || 0) * 1048576;
      var p = quota ? pct(used, quota) : 0;
      var isOwnerAccount = S.me && S.me.id === u.id;
      var allowed = S.me && S.me.role === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : (u.role === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : ['admin', 'member', 'viewer']);
      var h = peekHead('멤버', esc(u.display_name || u.email));
      h += '<div class="peek-b">';
      h += '<div class="hero">' + avatar(u.display_name, u.email, u.id, true) + '<div class="min0"><div class="hero-title">' + esc(u.display_name || u.email) + '</div><div class="mono muted t">' + esc(u.email) + '</div></div></div>';
      h += '<dl class="props">' +
        prop('상태', statusLabel(u.status)) +
        prop('역할', roleBadge(u.role) + (isOwnerAccount ? '<span class="faint small">나</span>' : '')) +
        prop('강의', num(u.lecture_count) + '개 · 공개 ' + num(u.public_count) + ' · ' + (Number(u.error_count) ? '<span class="c-red">오류 ' + num(u.error_count) + '</span>' : '오류 0')) +
        prop('오디오', fmtBytes(used) + ' / ' + (quota ? fmtBytes(quota) + ' ' + bar(p, usageClass(p)) + '<span class="faint small">' + Math.round(p) + '%</span>' : '무제한')) +
        prop('세션', num(u.session_count) + '개 기기') +
        prop('최근 로그인', u.last_login_at ? timeEl(u.last_login_at) : '<span class="faint">기록 없음</span>') +
        prop('가입', timeEl(u.created_at)) +
        prop('ID', '<span class="mono muted">' + esc(u.id) + '</span>') +
        '</dl>';
      h += '<div class="inline-actions"><button class="btn btn-sm" type="button" data-action="member-lectures" data-id="' + esc(u.id) + '">' + ic('lectures', 13) + '강의 보기</button>' +
        (u.status === 'pending' ? '<button class="btn btn-sm btn-primary" type="button" data-action="approve-user" data-user-id="' + esc(u.id) + '">' + ic('check', 13) + '가입 승인</button>' : '') + '</div>';
      h += '<form id="member-form" data-form="member" data-id="' + esc(u.id) + '" autocomplete="off">';
      h += '<div class="sec-title">프로필 및 권한</div>';
      h += field('표시 이름', '<input class="input" id="pm-name" maxlength="80" value="' + esc(u.display_name || '') + '">', '', 'pm-name');
      h += '<div class="grid2">' + field('역할', roleSelect('pm-role', u.role, allowed), '', 'pm-role') +
        field('상태', segRadios('pm-status', [['active', '활성'], ['pending', '대기'], ['suspended', '정지']], u.status)) + '</div>';
      h += '<div class="sw-list">' +
        swRow('pm-ingest', '오디오 녹음·업로드', 'Viewer 역할은 이 설정과 관계없이 제한됩니다.', u.can_ingest) +
        swRow('pm-share', '공개 공유 링크', '노트를 /s/ 링크로 외부에 공개할 수 있습니다.', u.can_share) +
        swRow('pm-serverkey', '노트 자동 정리 엔진', '서버 AI 키로 강의 노트를 생성합니다.', u.can_use_server_key) +
        '</div>';
      h += field('오디오 저장 한도 (MB)', '<input class="input num" id="pm-quota" type="number" min="0" step="256" value="' + (Number(u.quota_mb) || 0) + '">', '0 = 무제한 · 현재 ' + fmtBytes(used) + ' 사용 중', 'pm-quota');
      h += field('메모', '<textarea class="input" id="pm-memo" rows="2" maxlength="500" placeholder="소속, 학과, 운영 메모">' + esc(u.memo || '') + '</textarea>', '', 'pm-memo');
      h += '<div class="sec-title">보안</div>';
      h += field('새 비밀번호', '<input class="input" id="pm-pw" type="password" autocomplete="new-password" placeholder="비워 두면 그대로 유지 (6자 이상)">', '', 'pm-pw');
      h += '<div class="sw-list">' + swRow('pm-revoke', '저장할 때 모든 세션 로그아웃', '현재 ' + num(u.session_count) + '개 기기에서 로그인되어 있습니다.', false) + '</div>';
      h += '<div class="form-err" id="pm-err" role="alert" hidden></div>';
      h += '</form></div>';
      h += '<div class="peek-f"><button class="btn btn-ghost danger-text" type="button" data-action="delete-member" data-id="' + esc(u.id) + '"' + (isOwnerAccount ? ' disabled title="자기 계정은 삭제할 수 없습니다"' : '') + '>' + ic('trash', 14) + '삭제</button>' +
        '<span class="sp"></span><span class="faint small hide-xs">' + MOD + ' ↵</span><button class="btn btn-primary" type="submit" form="member-form">저장</button></div>';
      return h;
    }
    function newMemberPeek() {
      var s = obj(settingsBase());
      var h = peekHead('멤버', '새 멤버');
      h += '<div class="peek-b"><form id="new-member-form" data-form="new-member" autocomplete="off">';
      h += field('아이디 또는 이메일', '<input class="input" id="cu-email" maxlength="200" placeholder="student@example.com" autocomplete="off" spellcheck="false" required>', '', 'cu-email');
      h += field('표시 이름', '<input class="input" id="cu-name" maxlength="80" placeholder="예: 홍길동">', '', 'cu-name');
      h += field('초기 비밀번호', '<input class="input" id="cu-pw" type="password" autocomplete="new-password" placeholder="6자 이상" required>', '처음 로그인한 뒤 본인이 변경할 수 있습니다.', 'cu-pw');
      h += '<div class="grid2">' + field('역할', roleSelect('cu-role', s.default_user_role === 'viewer' ? 'viewer' : 'member', S.me && S.me.role === 'owner' ? ['member', 'viewer', 'admin', 'owner'] : ['member', 'viewer', 'admin']), '', 'cu-role') +
        field('상태', segRadios('cu-status', [['active', '활성'], ['pending', '대기']], 'active')) + '</div>';
      h += '<div class="sw-list">' +
        swRow('cu-ingest', '오디오 녹음·업로드', '', true) +
        swRow('cu-share', '공개 공유 링크', '', true) +
        swRow('cu-serverkey', '노트 자동 정리 엔진', '', s.default_can_use_server_key !== false) + '</div>';
      h += field('오디오 저장 한도 (MB)', '<input class="input num" id="cu-quota" type="number" min="0" step="256" value="' + (s.default_quota_mb === undefined ? 2048 : Number(s.default_quota_mb) || 0) + '">', '0 = 무제한', 'cu-quota');
      h += field('메모', '<textarea class="input" id="cu-memo" rows="2" maxlength="500" placeholder="소속, 학과, 운영 메모"></textarea>', '', 'cu-memo');
      h += '<div class="form-err" id="cu-err" role="alert" hidden></div>';
      h += '</form></div>';
      h += '<div class="peek-f"><span class="sp"></span><button class="btn btn-ghost" type="button" data-action="peek-close">취소</button><button class="btn btn-primary" type="submit" form="new-member-form">' + ic('plus', 14) + '멤버 만들기</button></div>';
      return h;
    }
    function lectureJobHtml(id) {
      var j = jobsFor(id)[0];
      if (!j) return '';
      var running = j.state === 'running';
      var p = Math.max(0, Math.min(100, Number(j.progress) || 0));
      return '<div class="jobbox">' + statusIcon(running ? 'processing' : 'queued', p) + '<div class="min0 grow"><div class="strong">' + esc(KIND_LABEL[j.kind] || j.kind) + ' · ' + (running ? '실행 중' : '대기열') + '</div>' +
        '<div class="muted small">' + (running ? esc(STAGE_LABEL[j.stage] || j.stage || '') + (j.kind === 'distill' ? ' · ' + p + '%' : '') + ' · ' + esc(relTime(j.startedAt)) + ' 시작' : esc(relTime(j.enqueuedAt)) + ' 대기열에 추가됨') + '</div>' +
        (running && j.kind === 'distill' ? bar(p, 'wide yellow') : '') + '</div></div>';
    }
    function updatePeekJob() {
      if (!S.peek || S.peek.kind !== 'lecture') return;
      var el = $('peek-job');
      if (el) el.innerHTML = lectureJobHtml(S.peek.id);
    }
    function lecturePeek(l) {
      var kind = lecKind(l);
      var hasAudio = l.has_audio !== false;
      var busy = Boolean(l.job_state) || jobsFor(l.id).length > 0;
      var orig = Number(l.audio_original_size) || 0;
      var cur = Number(l.audio_size) || 0;
      var audio = !hasAudio ? '<span class="faint">삭제됨</span>'
        : '<span class="mono">' + fmtBytes(cur) + '</span>' + (l.audio_ext ? '<span class="badge">' + esc(extLabel(l.audio_ext)) + '</span>' : '') +
          (l.compacted ? '<span class="badge green">압축됨</span>' : '');
      var h = peekHead('강의', esc(l.title || '제목 없음'));
      h += '<div class="peek-b">';
      h += '<div class="hero"><span style="flex:none">' + statusIcon(kind, l.progress) + '</span><div class="min0"><div class="hero-title">' + esc(l.title || '제목 없음') + '</div><div class="muted small">' + esc([l.course, l.date_label].filter(Boolean).join(' · ') || '—') + '</div></div></div>';
      if (l.error_message) h += '<div class="callout red">' + ic('alert', 14) + '<div class="min0"><div class="strong">오류 메시지</div><div class="pre">' + esc(l.error_message) + '</div></div></div>';
      h += '<div id="peek-job">' + lectureJobHtml(l.id) + '</div>';
      h += '<dl class="props">' +
        prop('상태', l.status ? '<span class="st-label">' + statusIcon(kind, l.progress) + esc(LEC_STATUS[l.status] || l.status) + '</span>' + (l.status === 'processing' ? '<span class="faint small">' + (Number(l.progress) || 0) + '%</span>' : '') : '<span class="faint">불러오는 중…</span>') +
        prop('단계', esc(stageText(l) || '—') + (l.stage_message && l.stage_message !== l.error_message ? '<span class="faint small">' + esc(l.stage_message) + '</span>' : '')) +
        prop('소유자', l.owner_id ? '<button class="link t" type="button" data-open="member" data-id="' + esc(l.owner_id) + '">' + esc(l.owner_email || l.owner_name || l.owner_id) + '</button>' : esc(l.owner_email || '—')) +
        prop('길이', esc(fmtDur(l.duration_sec))) +
        prop('오디오', audio) +
        (l.compacted && orig > cur ? prop('압축 전', '<span class="mono">' + fmtBytes(orig) + '</span><span class="c-green small">−' + fmtBytes(orig - cur) + ' (' + Math.round((orig - cur) / orig * 100) + '%)</span>') : '') +
        (l.audio_compact_state === 'skipped' ? prop('압축', '<span class="faint">이미 충분히 작아 원본 유지</span>') : '') +
        (l.compacted && l.audio_compacted_at ? prop('압축 시각', timeEl(l.audio_compacted_at)) : '') +
        (hasAudio && l.audio_in_uploads === false ? prop('보관 위치', '<span class="faint">강의 아카이브 (압축·보존 정책 제외)</span>') : '') +
        (l.source_client ? prop('업로드 경로', '<span class="mono">' + esc(l.source_client) + '</span>') : '') +
        (l.model_used ? prop('모델', '<span class="mono">' + esc(l.model_used) + '</span>' +
          (l.model_requested && l.model_requested !== l.model_used ? '<span class="faint small">요청 ' + esc(l.model_requested) + '</span>' : '')) : '') +
        (typeof l.markdown_chars === 'number' ? prop('노트', l.markdown_chars ? num(l.markdown_chars) + '자' + (l.archived ? '<span class="badge">아카이브 저장</span>' : '') : '<span class="faint">없음</span>') : '') +
        (l.is_public !== undefined ? prop('공개', l.is_public ? '<span class="c-accent">공개 링크 활성</span>' : '비공개') : '') +
        prop('생성', timeEl(l.created_at)) +
        (l.updated_at ? prop('수정', timeEl(l.updated_at)) : '') +
        prop('ID', '<span class="mono muted">' + esc(l.id) + '</span>') +
        '</dl>';
      if (l.excerpt && l.status === 'done') h += '<div class="sec-title">요약</div><p class="excerpt">' + esc(l.excerpt) + '</p>';
      h += '</div>';
      var canRetry = hasAudio && (l.status === 'error' || (l.status === 'processing' && !busy));
      var canCompact = hasAudio && l.status === 'done' && !l.compacted && l.audio_compact_state !== 'skipped' && l.audio_in_uploads !== false && !busy;
      h += '<div class="peek-f">' +
        (hasAudio ? '<button class="btn btn-ghost danger-text btn-sm" type="button" data-action="lec-del-audio" data-id="' + esc(l.id) + '">' + ic('trash', 13) + '오디오 삭제</button>' : '') +
        '<button class="btn btn-ghost danger-text btn-sm" type="button" data-action="lec-delete" data-id="' + esc(l.id) + '">' + ic('trash', 13) + '강의 삭제</button>' +
        '<span class="sp"></span>' +
        (canCompact ? '<button class="btn btn-sm" type="button" data-action="lec-compact" data-id="' + esc(l.id) + '">' + ic('compress', 13) + '지금 압축</button>' : '') +
        (canRetry ? '<button class="btn btn-sm" type="button" data-action="lec-retry" data-id="' + esc(l.id) + '">' + ic('retry', 13) + '재시도</button>' : '') +
        '<a class="btn btn-sm btn-primary" href="/?lecture=' + esc(encodeURIComponent(l.id)) + '">' + ic('external', 13) + '앱에서 열기</a></div>';
      return h;
    }
    function auditPeek(a) {
      var target = a.target_id ? userById(a.target_id) : null;
      var lec = a.target_id && !target ? findLecture(a.target_id) : null;
      var h = peekHead('감사 로그', '<span class="act">' + esc(a.action) + '</span>');
      h += '<div class="peek-b"><dl class="props">' +
        prop('시각', esc(absTime(a.created_at)) + '<span class="faint small">' + esc(relTime(a.created_at)) + '</span>') +
        prop('작업', '<span class="act">' + esc(a.action) + '</span>') +
        prop('수행자', esc(a.actor_email || '—')) +
        prop('대상', target ? '<button class="link" type="button" data-open="member" data-id="' + esc(target.id) + '">' + esc(target.email) + '</button>'
          : lec ? '<button class="link" type="button" data-open="lecture" data-id="' + esc(lec.id) + '">' + esc(lec.title || lec.id) + '</button>'
          : '<span class="mono muted">' + esc(a.target_id || '—') + '</span>') +
        prop('ID', '<span class="mono muted">' + esc(a.id) + '</span>') +
        '</dl><div class="sec-title">상세</div><div class="pre" style="color:var(--text)">' + esc(a.detail || '—') + '</div></div>';
      return h;
    }

    // MARK: - Actions
    function showFormErr(id, msg) {
      var el = $(id);
      if (!el) return;
      el.textContent = msg || '';
      el.hidden = !msg;
      if (msg && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    async function busy(el, fn) {
      if (el) { el.disabled = true; el.classList.add('is-busy'); }
      try { return await fn(); }
      finally { if (el && el.isConnected) { el.disabled = false; el.classList.remove('is-busy'); } }
    }
    async function approveUser(id) {
      if (!id) return;
      var r = await api('PATCH', '/api/admin/users/' + encodeURIComponent(id), { status: 'active' });
      if (!r.ok) return toast(r.error, 'error');
      toast('가입을 승인했습니다.', 'ok');
      await loadOverview();
      if (S.peek && S.peek.kind === 'member' && S.peek.id === id) renderPeek();
    }
    async function saveMember(form) {
      var id = form.getAttribute('data-id');
      var st = form.querySelector('input[name="pm-status"]:checked');
      var body = {
        displayName: $('pm-name').value.trim(),
        role: $('pm-role').value,
        status: st ? st.value : undefined,
        canIngest: $('pm-ingest').checked,
        canShare: $('pm-share').checked,
        canUseServerKey: $('pm-serverkey').checked,
        quotaMb: Math.max(0, Math.round(Number($('pm-quota').value) || 0)),
        memo: $('pm-memo').value.trim(),
        revokeSessions: $('pm-revoke').checked
      };
      var pw = $('pm-pw').value;
      if (pw) {
        if (pw.length < 6) return showFormErr('pm-err', '새 비밀번호는 6자 이상이어야 합니다.');
        body.newPassword = pw;
      }
      showFormErr('pm-err', '');
      var r = await api('PATCH', '/api/admin/users/' + encodeURIComponent(id), body);
      if (!r.ok) {
        showFormErr('pm-err', r.error);
        return toast(r.error, 'error');
      }
      toast('멤버 정보를 저장했습니다.', 'ok');
      await loadOverview();
      if (S.peek && S.peek.kind === 'member' && S.peek.id === id) renderPeek();
    }
    async function createMember() {
      var st = document.querySelector('input[name="cu-status"]:checked');
      var body = {
        email: $('cu-email').value.trim(),
        displayName: $('cu-name').value.trim(),
        password: $('cu-pw').value,
        role: $('cu-role').value,
        status: st ? st.value : 'active',
        canIngest: $('cu-ingest').checked,
        canShare: $('cu-share').checked,
        canUseServerKey: $('cu-serverkey').checked,
        quotaMb: Math.max(0, Math.round(Number($('cu-quota').value) || 0)),
        memo: $('cu-memo').value.trim()
      };
      if (!body.email) return showFormErr('cu-err', '아이디 또는 이메일을 입력하세요.');
      if (body.password.length < 6) return showFormErr('cu-err', '초기 비밀번호는 6자 이상이어야 합니다.');
      showFormErr('cu-err', '');
      var r = await api('POST', '/api/admin/users', body);
      if (!r.ok) {
        showFormErr('cu-err', r.error);
        return toast(r.error, 'error');
      }
      toast('새 멤버를 만들었습니다.', 'ok');
      await loadOverview();
      var created = r.data && r.data.user;
      if (created && created.id && userById(created.id)) openPeek('member', created.id);
      else closePeek();
    }
    async function deleteMember(id) {
      var u = userById(id);
      if (!u) return;
      var ok = await confirmDialog({
        title: '멤버 삭제',
        danger: true,
        html: '<p><b class="strong">' + esc(u.display_name || u.email) + '</b> 계정과 이 멤버가 소유한 강의 ' + num(u.lecture_count) + '개, 오디오 ' + fmtBytes(u.audio_bytes) + '가 영구 삭제됩니다. 되돌릴 수 없습니다.</p>',
        requireText: u.email,
        confirmLabel: '영구 삭제'
      });
      if (!ok) return;
      var r = await api('DELETE', '/api/admin/users/' + encodeURIComponent(id));
      if (!r.ok) return toast(r.error, 'error');
      toast('멤버를 삭제했습니다.', 'ok');
      closePeek();
      loadOverview();
      if (S.st) loadStorage();
    }
    function openNewMember() {
      if (S.view !== 'members') go('members');
      openPeek('new-member', null);
    }
    function afterLectureChange() {
      loadOverview();
      loadOps();
      if (S.st) loadStorage();
      if (S.view === 'lectures') renderBody();
      if (S.peek && S.peek.kind === 'lecture') renderPeek();
    }
    async function retryLecture(id) {
      var r = await api('POST', '/api/lectures/' + encodeURIComponent(id) + '/retry');
      if (r.status === 409) return toast('이미 처리 중입니다.');
      if (!r.ok) return toast(r.error, 'error');
      toast('재시도를 시작했습니다.', 'ok');
      var lec = r.data && r.data.lecture;
      patchLecture(id, lec ? Object.assign({ error_message: null }, lec) : { status: 'processing', error_message: null });
      afterLectureChange();
    }
    async function compactLecture(id) {
      var r = await api('POST', '/api/admin/storage/compact', { ids: [id] });
      if (!r.ok) return failToast(r, '압축');
      if (Number(r.data && r.data.queued) > 0) {
        toast('압축 대기열에 추가했습니다. 예상 절약 약 ' + fmtBytes(r.data.estimatedSavedBytes) + '.', 'ok');
        patchLecture(id, { job_state: 'queued', job_kind: 'compact' });
      } else {
        toast('압축 대상이 아닙니다. 이미 압축되었거나 아직 완료되지 않은 강의입니다.');
      }
      afterLectureChange();
    }
    async function deleteLectureAudio(id) {
      var l = findLecture(id) || { id: id };
      var ok = await confirmDialog({
        title: '오디오 삭제',
        danger: true,
        html: '<p><b class="strong">' + esc(l.title || '이 강의') + '</b>의 오디오 원본' + (l.audio_size ? ' (' + fmtBytes(l.audio_size) + ')' : '') + '을 영구 삭제합니다. 노트는 유지되지만 다시 듣거나 재분석할 수 없습니다.</p>',
        confirmLabel: '오디오 삭제'
      });
      if (!ok) return;
      var r = await api('DELETE', '/api/lectures/' + encodeURIComponent(id) + '/audio');
      if (!r.ok) return toast(r.error, 'error');
      toast('오디오를 삭제했습니다. ' + fmtBytes(r.data && r.data.reclaimedBytes) + ' 확보.', 'ok');
      var lec = r.data && r.data.lecture;
      patchLecture(id, Object.assign({}, lec || {}, { has_audio: false }));
      if (S.st && S.st.largest) S.st.largest = arr(S.st.largest).filter(function (x) { return x.id !== id; });
      afterLectureChange();
    }
    async function deleteLecture(id) {
      var l = findLecture(id) || { id: id };
      var ok = await confirmDialog({
        title: '강의 삭제',
        danger: true,
        html: '<p><b class="strong">' + esc(l.title || '이 강의') + '</b>의 노트와 오디오가 모두 영구 삭제됩니다. 되돌릴 수 없습니다.</p>',
        confirmLabel: '강의 삭제'
      });
      if (!ok) return;
      var r = await api('DELETE', '/api/lectures/' + encodeURIComponent(id));
      if (!r.ok) return toast(r.error, 'error');
      toast('강의를 삭제했습니다.', 'ok');
      dropLecture(id);
      if (S.peek && S.peek.kind === 'lecture' && S.peek.id === id) closePeek();
      afterLectureChange();
    }
    function statsTable(rows) {
      return '<dl class="dstats">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
    }
    async function compactAllFlow() {
      if (S.st && S.st.compaction && S.st.compaction.ffmpegAvailable === false) return toast('서버에 ffmpeg가 없어 압축할 수 없습니다.', 'error');
      var r = await api('POST', '/api/admin/storage/compact', { all: true, dryRun: true });
      if (!r.ok || !r.data) return failToast(r, '압축');
      var d = r.data;
      if (!Number(d.candidates)) return toast('압축할 녹음이 없습니다.');
      var kbps = S.st && S.st.compaction ? Number(S.st.compaction.bitrateKbps) : 0;
      var ok = await confirmDialog({
        title: '전체 압축',
        html: '<p>완료된 강의 중 아직 압축하지 않은 녹음을 ' + (kbps ? num(kbps) + ' kbps ' : '') + '모노 AAC로 다시 인코딩합니다. 노트는 바뀌지 않으며, 결과가 원본보다 크면 원본을 유지합니다.</p>' +
          statsTable([['대상', num(d.candidates) + '개'], ['현재 용량', fmtBytes(d.candidateBytes)], ['예상 절약', '<span class="c-green">약 ' + fmtBytes(d.estimatedSavedBytes) + '</span>']]),
        confirmLabel: '압축 시작'
      });
      if (!ok) return;
      var r2 = await api('POST', '/api/admin/storage/compact', { all: true });
      if (!r2.ok || !r2.data) return failToast(r2, '압축');
      toast(num(r2.data.queued) + '개 녹음을 압축 대기열에 추가했습니다.', 'ok');
      loadStorage();
      loadOps();
    }
    async function gcFlow() {
      var r = await api('POST', '/api/admin/storage/gc', { dryRun: true });
      if (!r.ok || !r.data) return failToast(r, '고아 파일 정리');
      var o = obj(r.data.orphans);
      if (!Number(o.count)) return toast('정리할 고아 파일이 없습니다.');
      var days = S.st && S.st.trash ? Number(S.st.trash.retentionDays) || 7 : 7;
      var files = arr(o.files).slice(0, 10);
      var ok = await confirmDialog({
        title: '고아 파일을 휴지통으로 이동',
        html: '<p>어떤 강의도 참조하지 않는 업로드 파일입니다. 휴지통으로 옮긴 뒤 ' + num(days) + '일이 지나면 자동으로 삭제됩니다.</p>' +
          statsTable([['파일', num(o.count) + '개'], ['용량', fmtBytes(o.bytes)]]) +
          (files.length ? '<div class="file-list">' + files.map(function (f) { return '<div class="mono t">' + esc(f) + '</div>'; }).join('') +
            (Number(o.count) > files.length ? '<div class="faint small">외 ' + num(Number(o.count) - files.length) + '개</div>' : '') + '</div>' : ''),
        confirmLabel: '휴지통으로 이동'
      });
      if (!ok) return;
      var r2 = await api('POST', '/api/admin/storage/gc', { dryRun: false });
      if (!r2.ok || !r2.data) return failToast(r2, '고아 파일 정리');
      toast('고아 파일 ' + num(r2.data.movedToTrash) + '개를 휴지통으로 옮겼습니다.', 'ok');
      loadStorage();
    }
    async function retentionFlow() {
      var r = await api('POST', '/api/admin/storage/retention', { dryRun: true });
      if (!r.ok || !r.data) return failToast(r, '보존 정책');
      var a = obj(r.data.retention);
      var f = obj(r.data.failedRetention);
      if (!Number(a.count) && !Number(f.count)) {
        return toast(!Number(a.days) && !Number(f.days) ? '보존 정책이 꺼져 있습니다. 설정에서 기간을 지정하세요.' : '보존 기간이 지난 항목이 없습니다.');
      }
      var ok = await confirmDialog({
        title: '보존 정책 적용',
        danger: true,
        html: '<p>아래 항목을 지금 영구 삭제합니다. 되돌릴 수 없습니다.</p>' + statsTable([
          ['완료된 강의 오디오', Number(a.days) ? cntBytes(a) + '<br><span class="faint small">' + num(a.days) + '일 경과 · 노트는 유지</span>' : '<span class="faint">정책 꺼짐</span>'],
          ['실패한 강의', Number(f.days) ? cntBytes(f) + '<br><span class="faint small">' + num(f.days) + '일 동안 변경 없음 · 강의째 삭제</span>' : '<span class="faint">정책 꺼짐</span>']
        ]),
        confirmLabel: '영구 삭제'
      });
      if (!ok) return;
      var r2 = await api('POST', '/api/admin/storage/retention', { dryRun: false });
      if (!r2.ok || !r2.data) return failToast(r2, '보존 정책');
      var a2 = obj(r2.data.retention);
      var f2 = obj(r2.data.failedRetention);
      toast('보존 정책을 적용했습니다. ' + num((Number(a2.count) || 0) + (Number(f2.count) || 0)) + '개 정리, ' + fmtBytes((Number(a2.bytes) || 0) + (Number(f2.bytes) || 0)) + ' 확보.', 'ok');
      loadStorage();
      loadOverview();
    }
    function maintResultHtml(m) {
      var errs = arr(m.errors);
      var ms = Date.parse(m.finishedAt) - Date.parse(m.startedAt);
      return statsTable([
        ['만료 세션', num(m.expiredSessions) + '개'],
        ['만료 인증 코드', num(m.expiredCodes) + '개'],
        ['감사 로그 정리', num(m.prunedAuditLogs) + '건'],
        ['고아 파일 → 휴지통', cntBytes(m.orphanFiles)],
        ['임시 파일', cntBytes(m.tempFiles)],
        ['오디오 보존 정책', cntBytes(m.retention)],
        ['실패한 강의 정리', cntBytes(m.failedRetention)],
        ['백업', m.backup ? '<span class="mono">' + esc(m.backup.file) + '</span> · ' + fmtBytes(m.backup.sizeBytes) : '<span class="faint">없음</span>'],
        ['WAL 체크포인트', m.walCheckpointed ? '완료' : '<span class="faint">건너뜀</span>'],
        ['소요 시간', isFinite(ms) ? fmtMs(ms) : '—']
      ]) + (errs.length ? '<div class="callout red">' + ic('alert', 14) + '<div class="min0">' + errs.map(function (e) { return '<div class="pre">' + esc(e) + '</div>'; }).join('') + '</div></div>' : '');
    }
    async function maintFlow() {
      var ok = await confirmDialog({
        title: '유지보수 실행',
        html: '<p>다음 작업을 지금 실행합니다.</p><ul><li>만료된 세션과 인증 코드 정리</li><li>고아 파일을 휴지통으로 이동하고 기간이 지난 휴지통 비우기</li><li>보존 정책 적용 (설정된 경우, 영구 삭제)</li><li>데이터베이스 백업과 WAL 체크포인트</li></ul>',
        confirmLabel: '실행'
      });
      if (!ok) return;
      toast('유지보수를 실행하는 중…');
      var r = await api('POST', '/api/admin/maintenance/run');
      if (r.status === 409) return toast('유지보수가 이미 실행 중입니다.');
      if (!r.ok) return failToast(r, '유지보수');
      loadOps();
      loadOverview();
      if (S.st) loadStorage();
      var m = r.data && r.data.result;
      if (!m) return toast('유지보수를 완료했습니다.', 'ok');
      await confirmDialog({ title: arr(m.errors).length ? '유지보수 완료 (오류 있음)' : '유지보수 완료', html: maintResultHtml(m), confirmLabel: '닫기', cancel: false });
    }
    async function logout() {
      await api('POST', '/api/auth/logout');
      location.href = '/';
    }
    function setTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('lectern_theme', t); } catch {}
      renderSidebarFoot();
    }
    function toggleTheme() {
      setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    }
    function setDrawer(open) { $('app').classList.toggle('drawer-open', Boolean(open)); }
    function setChip(group, value) {
      if (group === 'role') S.mem.role = S.mem.role === value ? '' : value;
      else if (group === 'status') S.mem.status = S.mem.status === value ? '' : value;
      else if (group === 'prefix') { S.aud.prefix = value; if (!S.aud.fallback) loadAudit(true); }
      else if (group === 'lstatus') { S.lec.status = value; loadLectures(true); }
      else if (group === 'owner') { S.lec.owner = ''; loadLectures(true); }
      S.selKey = '';
      renderSubbar();
      $('h-count').textContent = headerCount();
      renderBody();
    }

    var ACTIONS = {
      nav: function (el) { go(el.getAttribute('data-view')); },
      palette: function () { openPalette(); },
      theme: toggleTheme,
      logout: logout,
      shortcuts: openSheet,
      'sheet-close': closeSheet,
      drawer: function () { setDrawer(!$('app').classList.contains('drawer-open')); },
      'drawer-close': function () { setDrawer(false); },
      'peek-close': closePeek,
      'approve-user': function (el) { return approveUser(el.getAttribute('data-user-id')); },
      'new-member': openNewMember,
      'delete-member': function (el) { return deleteMember(el.getAttribute('data-id')); },
      'member-lectures': function (el) { S.lec.owner = el.getAttribute('data-id') || ''; S.lec.status = ''; S.lec.q = ''; go('lectures', { reload: true }); },
      'goto-lectures-error': function () { S.lec.status = 'error'; S.lec.q = ''; S.lec.owner = ''; go('lectures', { reload: true }); },
      'lec-retry': function (el) { return retryLecture(el.getAttribute('data-id')); },
      'lec-compact': function (el) { return compactLecture(el.getAttribute('data-id')); },
      'lec-del-audio': function (el) { return deleteLectureAudio(el.getAttribute('data-id')); },
      'lec-delete': function (el) { return deleteLecture(el.getAttribute('data-id')); },
      'lec-more': function () { return loadLectures(false); },
      'compact-all': compactAllFlow,
      gc: gcFlow,
      retention: retentionFlow,
      'maint-run': maintFlow,
      chip: function (el) { setChip(el.getAttribute('data-group'), el.getAttribute('data-value') || ''); },
      refresh: refreshAll,
      'reload-overview': loadOverview,
      'reload-ops': loadOps,
      'reload-storage': loadStorage,
      'reload-lectures': function () { return loadLectures(true); },
      'reload-audit': function () { return loadAudit(true); },
      'aud-more': function () { return loadAudit(false); },
      'settings-save': saveSettings,
      'settings-reset': function () { renderBody(true); },
      'dlg-ok': function () { closeDialog(true); },
      'dlg-cancel': function () { closeDialog(false); }
    };
    var ASYNC_BUSY = { 'approve-user': 1, 'lec-retry': 1, 'lec-compact': 1, 'compact-all': 1, gc: 1, retention: 1, 'lec-more': 1, 'aud-more': 1, 'reload-audit': 1 };

    // MARK: - Routing
    function go(view, opts) {
      opts = opts || {};
      if (!viewDef(view)) view = 'overview';
      if (S.view === 'settings' && view !== 'settings' && !opts.force && settingsDirty()) {
        confirmDialog({ title: '저장하지 않은 변경사항', html: '<p>설정 변경사항을 저장하지 않았습니다. 이동하면 변경사항이 사라집니다.</p>', confirmLabel: '저장하지 않고 이동', danger: true })
          .then(function (ok) {
            if (ok) go(view, Object.assign({}, opts, { force: true }));
            else if (location.hash !== '#settings') history.replaceState(null, '', '#settings');
          });
        return;
      }
      var changed = S.view !== view;
      S.view = view;
      if (location.hash !== '#' + view) location.hash = view;
      if (changed) { S.selKey = ''; closePeek(); }
      setDrawer(false);
      document.title = viewDef(view).label + ' · Lectern Admin';
      renderSidebar();
      renderHeader();
      renderBody(true);
      if (changed) $('content').scrollTop = 0;
      enterView(view, opts);
    }
    function enterView(v, opts) {
      if (v === 'overview') { loadOps(); if (!S.st || Date.now() - S.stAt > 60000) loadStorage(); if (Date.now() - S.ovAt > 15000) loadOverview(); }
      else if (v === 'members') { if (Date.now() - S.ovAt > 15000) loadOverview(); }
      else if (v === 'audit') { loadAudit(true); if (Date.now() - S.ovAt > 15000) loadOverview(); }
      else if (v === 'lectures') loadLectures(true);
      else if (v === 'jobs') loadOps();
      else if (v === 'storage') { loadStorage(); loadOps(); }
      else if (v === 'settings') { loadOps(); if (!S.st) loadStorage(); }
    }
    window.addEventListener('hashchange', function () {
      var v = (location.hash || '').slice(1);
      if (S.me && !S.gated && viewDef(v) && v !== S.view) go(v);
    });

    // MARK: - Dialog, sheet, toast, gate
    var DLG = { resolve: null, require: '', lastFocus: null };
    function dialogOpen() { return $('dlg-ov').classList.contains('open'); }
    function confirmDialog(o) {
      return new Promise(function (resolve) {
        if (DLG.resolve) DLG.resolve(false);
        DLG.resolve = resolve;
        DLG.require = o.requireText || '';
        DLG.lastFocus = document.activeElement;
        var ov = $('dlg-ov');
        ov.innerHTML = '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title"><div class="dlg-b">' +
          '<div class="dlg-title" id="dlg-title">' + esc(o.title) + '</div><div class="dlg-body">' + (o.html || '') + '</div>' +
          (DLG.require ? '<label class="dlg-req"><span>확인하려면 <span class="mono strong">' + esc(DLG.require) + '</span>을(를) 입력하세요.</span><input class="input" id="dlg-input" autocomplete="off" spellcheck="false"></label>' : '') +
          '</div><div class="dlg-f">' + (o.cancel === false ? '' : '<button class="btn" type="button" data-action="dlg-cancel">취소</button>') +
          '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-action="dlg-ok" id="dlg-ok"' + (DLG.require ? ' disabled' : '') + '>' + esc(o.confirmLabel || '확인') + '</button></div></div>';
        ov.classList.add('open');
        setTimeout(function () { var f = $('dlg-input') || $('dlg-ok'); if (f) f.focus(); }, 20);
      });
    }
    function closeDialog(result) {
      var ov = $('dlg-ov');
      if (!ov.classList.contains('open')) return;
      if (result && DLG.require) {
        var inp = $('dlg-input');
        if (!inp || inp.value.trim() !== DLG.require) return;
      }
      ov.classList.remove('open');
      ov.innerHTML = '';
      var res = DLG.resolve;
      DLG.resolve = null;
      if (DLG.lastFocus && DLG.lastFocus.isConnected && DLG.lastFocus.focus) DLG.lastFocus.focus();
      if (res) res(Boolean(result));
    }
    var SHORTCUTS = [
      [[MOD, 'K'], '명령 팔레트'],
      [['G', 'O'], '개요로 이동'],
      [['G', 'M'], '멤버로 이동'],
      [['G', 'L'], '강의로 이동'],
      [['G', 'J'], '작업으로 이동'],
      [['G', 'S'], '스토리지로 이동'],
      [['G', 'A'], '감사 로그로 이동'],
      [['G', ','], '설정으로 이동'],
      [['J'], '아래 항목 선택'],
      [['K'], '위 항목 선택'],
      [['↵'], '선택한 항목 열기'],
      [['/'], '검색'],
      [['C'], '새 멤버 (멤버 화면)'],
      [[MOD, '↵'], '패널 저장'],
      [['Esc'], '닫기'],
      [['?'], '단축키 보기']
    ];
    function openSheet() {
      var ov = $('sheet-ov');
      ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="키보드 단축키"><div class="sheet-h"><span class="sec-t">키보드 단축키</span><button class="btn btn-ghost icon-btn" type="button" data-action="sheet-close" aria-label="닫기">' + ic('close') + '</button></div><div class="sheet-b">' +
        SHORTCUTS.map(function (s) { return '<div class="sk"><span>' + s[1] + '</span><span class="kbds">' + s[0].map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('') + '</span></div>'; }).join('') + '</div></div>';
      ov.classList.add('open');
    }
    function closeSheet() { var ov = $('sheet-ov'); ov.classList.remove('open'); ov.innerHTML = ''; }
    function toast(msg, kind) {
      var host = $('toasts');
      var el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      var dot = document.createElement('span');
      dot.className = 'sdot';
      var txt = document.createElement('span');
      txt.textContent = String(msg || '');
      el.appendChild(dot);
      el.appendChild(txt);
      host.appendChild(el);
      while (host.children.length > 3) host.removeChild(host.firstChild);
      setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, kind === 'error' ? 5200 : 2800);
    }
    function showGate(kind) {
      S.gated = true;
      closePeek();
      var who = S.me ? '<span class="mono">' + esc(S.me.email) + '</span>' : '';
      var msg = kind === 'forbidden'
        ? '현재 계정 ' + who + '에는 관리자 권한이 없습니다. Owner 또는 Admin 계정으로 로그인하세요.'
        : kind === 'offline'
        ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.'
        : '관리자(Owner/Admin) 계정으로 로그인한 뒤 다시 열어 주세요.';
      var g = $('gate');
      g.innerHTML = '<div class="gate-card"><span class="ws-logo" aria-hidden="true">L</span><h1>' + (kind === 'offline' ? '연결할 수 없습니다' : '관리자 로그인이 필요합니다') + '</h1><p>' + msg + '</p>' +
        '<a class="btn btn-primary" href="/">' + (kind === 'offline' ? 'Lectern으로 이동' : '로그인 페이지로 이동') + '</a></div>';
      g.hidden = false;
      $('app').setAttribute('aria-hidden', 'true');
    }

    // MARK: - Command palette
    var PAL = { open: false, idx: 0, items: [], remote: [], timer: null, lastFocus: null };
    function palCommands() {
      var dark = document.documentElement.getAttribute('data-theme') !== 'light';
      return [
        { g: '명령', label: '새 멤버 추가', icon: 'userplus', keys: ['C'], kw: 'new member create user 생성', run: openNewMember },
        { g: '명령', label: '유지보수 실행', icon: 'tool', kw: 'maintenance backup 백업 정리', run: maintFlow },
        { g: '명령', label: '전체 압축 (미리보기)', icon: 'compress', kw: 'compact compress 압축', run: compactAllFlow },
        { g: '명령', label: '고아 파일 정리 (미리보기)', icon: 'file', kw: 'gc orphan trash 휴지통', run: gcFlow },
        { g: '명령', label: '보존 정책 적용 (미리보기)', icon: 'clock', kw: 'retention 보존', run: retentionFlow },
        { g: '명령', label: dark ? '라이트 테마로 전환' : '다크 테마로 전환', icon: dark ? 'sun' : 'moon', kw: 'theme dark light 테마 다크 라이트', run: toggleTheme },
        { g: '명령', label: '새로고침', icon: 'retry', kw: 'refresh reload', run: refreshAll },
        { g: '명령', label: '키보드 단축키', icon: 'keyboard', keys: ['?'], kw: 'shortcuts help 도움말', run: openSheet },
        { g: '명령', label: '앱으로 돌아가기', icon: 'external', kw: 'app home 워크스페이스', run: function () { location.href = '/'; } },
        { g: '명령', label: '로그아웃', icon: 'logout', kw: 'logout sign out', run: logout }
      ];
    }
    function palAll(q) {
      var items = VIEWS.map(function (v) {
        return { g: '이동', label: v.label, icon: v.icon, keys: ['G', v.key === ',' ? ',' : v.key.toUpperCase()], kw: v.id, run: function () { go(v.id); } };
      }).concat(palCommands());
      if (!q) return items;
      users().forEach(function (u) {
        items.push({ g: '멤버', label: u.display_name || u.email, sub: u.email, av: u, kw: u.memo || '', run: function () { openPeek('member', u.id); } });
      });
      var seen = {};
      S.lec.items.concat(arr(S.ov && S.ov.recentLectures), PAL.remote).forEach(function (l) {
        if (!l || !l.id || seen[l.id]) return;
        seen[l.id] = 1;
        items.push({ g: '강의', label: l.title || '제목 없음', sub: [l.course, l.owner_email].filter(Boolean).join(' · '), st: l, kw: l.id, run: function () { openPeek('lecture', l.id); } });
      });
      return items;
    }
    function fuzzy(q, text) {
      text = String(text || '').toLowerCase();
      if (!text) return -1;
      var i = text.indexOf(q);
      if (i >= 0) return 1000 - i * 4 - text.length * 0.2;
      var from = 0;
      var last = -2;
      var score = 0;
      for (var k = 0; k < q.length; k++) {
        var ch = q.charAt(k);
        if (ch === ' ') continue;
        var f = text.indexOf(ch, from);
        if (f < 0) return -1;
        score += f === last + 1 ? 6 : 1;
        last = f;
        from = f + 1;
      }
      return score;
    }
    var PAL_ORDER = ['이동', '명령', '멤버', '강의'];
    var PAL_CAP = { '이동': 7, '명령': 10, '멤버': 6, '강의': 8 };
    function palFilter(q) {
      q = q.trim().toLowerCase();
      var all = palAll(q);
      var scored = all.map(function (it) {
        if (!q) return { it: it, s: 0 };
        var a = fuzzy(q, it.label);
        var b = fuzzy(q, [it.sub, it.kw].join(' '));
        return { it: it, s: a >= 0 ? a + 200 : b };
      }).filter(function (x) { return x.s >= 0; });
      var out = [];
      PAL_ORDER.forEach(function (g) {
        var grp = scored.filter(function (x) { return x.it.g === g; });
        if (q) grp.sort(function (a, b) { return b.s - a.s; });
        grp.slice(0, PAL_CAP[g]).forEach(function (x) { out.push(x.it); });
      });
      return out;
    }
    function renderPalette() {
      var q = $('pal-input') ? $('pal-input').value : '';
      PAL.items = palFilter(q);
      if (PAL.idx >= PAL.items.length) PAL.idx = Math.max(0, PAL.items.length - 1);
      var h = '';
      var g = '';
      PAL.items.forEach(function (it, i) {
        if (it.g !== g) { g = it.g; h += '<div class="pal-g">' + g + '</div>'; }
        var lead = it.av ? avatar(it.av.display_name, it.av.email, it.av.id) : it.st ? statusIcon(lecKind(it.st), it.st.progress) : ic(it.icon);
        h += '<div class="pal-i' + (i === PAL.idx ? ' on' : '') + '" role="option" id="pal-' + i + '" data-pal-idx="' + i + '"' + (i === PAL.idx ? ' aria-selected="true"' : '') + '>' + lead +
          '<span class="t">' + esc(it.label) + '</span>' + (it.sub ? '<span class="t sub">' + esc(it.sub) + '</span>' : '') + '<span class="sp"></span>' +
          (it.keys ? '<span class="kbds">' + it.keys.map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('') + '</span>' : '') + '</div>';
      });
      $('pal-list').innerHTML = h || '<div class="pal-empty">일치하는 항목이 없습니다.</div>';
      var on = $('pal-' + PAL.idx);
      if (on) on.scrollIntoView({ block: 'nearest' });
      var inp = $('pal-input');
      if (inp) inp.setAttribute('aria-activedescendant', on ? on.id : '');
    }
    function openPalette() {
      if (S.gated || dialogOpen()) return;
      closeSheet();
      PAL.open = true;
      PAL.idx = 0;
      PAL.remote = [];
      PAL.lastFocus = document.activeElement;
      $('pal-in').innerHTML = ic('search') + '<input id="pal-input" placeholder="이동, 명령, 멤버·강의 검색…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-label="명령 검색"><kbd>esc</kbd>';
      $('pal-ov').classList.add('open');
      renderPalette();
      $('pal-input').focus();
    }
    function closePalette() {
      if (!PAL.open) return;
      PAL.open = false;
      $('pal-ov').classList.remove('open');
      clearTimeout(PAL.timer);
      if (PAL.lastFocus && PAL.lastFocus.isConnected && PAL.lastFocus.focus && PAL.lastFocus !== document.body) PAL.lastFocus.focus();
    }
    function runPalette(i) {
      var it = PAL.items[i];
      if (!it) return;
      closePalette();
      setTimeout(function () { it.run(); }, 0);
    }
    function palRemoteSearch(q) {
      clearTimeout(PAL.timer);
      if (q.trim().length < 2 || (S.lec.fallback && S.lec.err === 'unavailable')) return;
      PAL.timer = setTimeout(async function () {
        var r = await api('GET', '/api/admin/lectures?q=' + encodeURIComponent(q.trim()) + '&limit=8&offset=0');
        if (!PAL.open || !$('pal-input') || $('pal-input').value !== q) return;
        if (r.ok && r.data && Array.isArray(r.data.lectures)) {
          PAL.remote = r.data.lectures;
          renderPalette();
        }
      }, 220);
    }

    // MARK: - Events
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var ov = t.closest('[data-overlay]');
      if (ov && t === ov) {
        var kind = ov.getAttribute('data-overlay');
        if (kind === 'palette') closePalette();
        else if (kind === 'dialog') closeDialog(false);
        else if (kind === 'sheet') closeSheet();
        return;
      }
      var pi = t.closest('[data-pal-idx]');
      if (pi) { runPalette(Number(pi.getAttribute('data-pal-idx'))); return; }
      var a = t.closest('[data-action]');
      if (a) {
        if (a.disabled) return;
        var name = a.getAttribute('data-action');
        if (a.tagName === 'A') {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
        }
        var fn = ACTIONS[name];
        if (!fn) return;
        if (ASYNC_BUSY[name]) busy(a, function () { return fn(a); });
        else fn(a);
        return;
      }
      var r = t.closest('[data-open]');
      if (r && !t.closest('a[href]')) openFromEl(r);
    });
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (!(f instanceof HTMLFormElement)) return;
      e.preventDefault();
      var kind = f.getAttribute('data-form');
      var btn = document.querySelector('button[type="submit"][form="' + f.id + '"]');
      if (kind === 'member') busy(btn, function () { return saveMember(f); });
      else if (kind === 'new-member') busy(btn, createMember);
    });
    var qTimer = null;
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'q') {
        var v = t.value;
        S.selKey = '';
        if (S.view === 'members') { S.mem.q = v; renderBody(); $('h-count').textContent = headerCount(); }
        else if (S.view === 'audit') {
          S.aud.q = v;
          if (S.aud.fallback) { renderBody(); $('h-count').textContent = headerCount(); }
          else { clearTimeout(qTimer); qTimer = setTimeout(function () { loadAudit(true); }, 250); }
        }
        else if (S.view === 'lectures') {
          S.lec.q = v;
          clearTimeout(qTimer);
          qTimer = setTimeout(function () { loadLectures(true); }, 250);
        }
      } else if (t.id === 'pal-input') {
        PAL.idx = 0;
        renderPalette();
        palRemoteSearch(t.value);
      } else if (t.id === 'dlg-input') {
        var ok = $('dlg-ok');
        if (ok) ok.disabled = t.value.trim() !== DLG.require;
      } else if (t.closest && t.closest('#settings-form')) {
        if (t.id === 'set-bitrate') { var bh = $('bitrate-hint'); if (bh) bh.textContent = bitrateHint(t.value); }
        updateSettingsDirty();
      }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.closest || !t.closest('#settings-form')) return;
      var rid = t.getAttribute('data-ret');
      if (rid) {
        var days = $(rid);
        var state = $(rid + '-state');
        days.disabled = !t.checked;
        if (t.checked && !(Number(days.value) > 0)) days.value = RET_DEFAULTS[rid] || 30;
        if (!t.checked) days.value = '';
        state.textContent = t.checked ? '사용' : '끄기';
        state.classList.toggle('off', !t.checked);
        if (t.checked) days.focus();
      }
      if (t.id === 'set-bitrate') { var bh = $('bitrate-hint'); if (bh) bh.textContent = bitrateHint(t.value); }
      updateSettingsDirty();
    });
    $('peek').addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        var f = $('peek').querySelector('form');
        if (f) { e.preventDefault(); f.requestSubmit(); }
      }
    });
    function isTyping(el) {
      if (!el || !el.tagName) return false;
      var tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
      if (tag === 'INPUT') return ['checkbox', 'radio', 'button', 'submit', 'range', 'color'].indexOf(String(el.type || 'text').toLowerCase()) < 0;
      return false;
    }
    function handleEscape() {
      if (dialogOpen()) { closeDialog(false); return true; }
      if (PAL.open) { closePalette(); return true; }
      if ($('sheet-ov').classList.contains('open')) { closeSheet(); return true; }
      if ($('app').classList.contains('drawer-open')) { setDrawer(false); return true; }
      var a = document.activeElement;
      if (a && a.id === 'q') { a.blur(); return true; }
      if (S.peek) { closePeek(); return true; }
      if (isTyping(a)) { a.blur(); return true; }
      if (S.selKey) { S.selKey = ''; applySel(); return true; }
      return false;
    }
    var chord = '';
    var chordTimer = null;
    document.addEventListener('keydown', function (e) {
      if (S.gated || !S.me) return;
      // Korean (IME) input: the Enter/arrow that commits a composition is not a command.
      if (e.isComposing || e.keyCode === 229) return;
      var k = e.key;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'k' || k === 'K')) {
        e.preventDefault();
        if (PAL.open) closePalette(); else openPalette();
        return;
      }
      if (k === 'Escape') { if (handleEscape()) e.preventDefault(); return; }
      if (PAL.open) {
        if (k === 'ArrowDown' || (e.ctrlKey && k === 'n')) { e.preventDefault(); PAL.idx = Math.min(PAL.items.length - 1, PAL.idx + 1); renderPalette(); }
        else if (k === 'ArrowUp' || (e.ctrlKey && k === 'p')) { e.preventDefault(); PAL.idx = Math.max(0, PAL.idx - 1); renderPalette(); }
        else if (k === 'Enter') { e.preventDefault(); runPalette(PAL.idx); }
        return;
      }
      if (dialogOpen()) {
        if (k === 'Enter' && e.target && e.target.id === 'dlg-input') { e.preventDefault(); closeDialog(true); }
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (chord === 'g') {
        chord = '';
        clearTimeout(chordTimer);
        var v = VIEWS.filter(function (x) { return x.key === k.toLowerCase(); })[0];
        if (v) { e.preventDefault(); go(v.id); }
        return;
      }
      if (k === 'g' || k === 'G') {
        chord = 'g';
        clearTimeout(chordTimer);
        chordTimer = setTimeout(function () { chord = ''; }, 1200);
        return;
      }
      if ($('sheet-ov').classList.contains('open')) return;
      var tgt = e.target;
      var isControl = tgt && tgt.closest && tgt.closest('button, a[href]');
      if (k === 'j' || k === 'ArrowDown') { if (moveSel(1)) e.preventDefault(); }
      else if (k === 'k' || k === 'ArrowUp') { if (moveSel(-1)) e.preventDefault(); }
      else if (k === 'Enter' && !isControl && S.selKey) { e.preventDefault(); openSelected(); }
      else if (k === '/') { e.preventDefault(); var q = $('q'); if (q) { q.focus(); q.select(); } else openPalette(); }
      else if (k === '?') { e.preventDefault(); openSheet(); }
      else if ((k === 'c' || k === 'C') && S.view === 'members') { e.preventDefault(); openNewMember(); }
    });

    // MARK: - Auto-refresh (5s on 개요/작업, paused while the tab is hidden)
    var tick = 0;
    setInterval(function () {
      if (document.hidden || !S.me || S.gated) return;
      tick++;
      if (S.view === 'jobs' || S.view === 'overview') loadOps();
      if (S.view === 'overview' && tick % 6 === 0) loadOverview();
      if (S.view === 'overview' && tick % 12 === 0) loadStorage();
      if (S.view === 'lectures' && tick % 3 === 0 && !S.lec.fallback && S.lec.items.length <= 50 &&
        S.lec.items.some(function (l) { return l.status === 'processing' || l.job_state; })) loadLectures(true);
    }, 5000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !S.me || S.gated) return;
      if (S.view === 'jobs' || S.view === 'overview') loadOps();
    });

    // MARK: - Boot
    async function boot() {
      $('search-trigger').innerHTML = ic('search', 14) + '<span class="lbl">검색 및 명령</span><span class="kbds"><kbd>' + MOD + '</kbd><kbd>K</kbd></span>';
      var me = await api('GET', '/api/auth/me');
      if (!me.ok || !me.data || !me.data.user) return showGate(me.status === 0 ? 'offline' : 'signin');
      var u = me.data.user;
      // Keep only what the console displays (the DTO also carries the user's API token).
      S.me = { id: u.id, email: u.email, displayName: u.displayName, role: u.role, isAdmin: Boolean(u.isAdmin) };
      if (!S.me.isAdmin) return showGate('forbidden');
      var v = (location.hash || '').slice(1);
      S.view = viewDef(v) ? v : 'overview';
      document.title = viewDef(S.view).label + ' · Lectern Admin';
      renderSidebar();
      renderHeader();
      renderBody(true);
      await loadOverview();
      if (S.gated) return;
      enterView(S.view, {});
    }
    boot();
`;

// Loaded synchronously in the admin <head> so the saved theme applies before first paint
// (the main script runs at the end of <body>).
const ADMIN_THEME_SCRIPT = `
  (function () {
    try {
      var saved = localStorage.getItem('lectern_theme');
      if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
    } catch (e) {}
  })();
`;

export interface PageScript {
  body: string;
  hash: string;
}

function pageScript(body: string): PageScript {
  return { body, hash: createHash("sha256").update(body).digest("hex").slice(0, 16) };
}

/**
 * Page scripts served by index.ts at /assets/<name>. Pages reference them with a content
 * hash so they can be cached immutably, and the HTML CSP can use script-src 'self'.
 */
export const PAGE_SCRIPTS: ReadonlyMap<string, PageScript> = new Map([
  ["share.js", pageScript(SHARE_PAGE_SCRIPT)],
  ["app.js", pageScript(APP_PAGE_SCRIPT)],
  ["admin.js", pageScript(ADMIN_PAGE_SCRIPT)],
  ["admin-theme.js", pageScript(ADMIN_THEME_SCRIPT)],
]);

function pageScriptTag(name: string): string {
  const script = PAGE_SCRIPTS.get(name);
  if (!script) throw new Error(`unknown page script: ${name}`);
  return `<script src="/assets/${name}?v=${script.hash}"></script>`;
}
