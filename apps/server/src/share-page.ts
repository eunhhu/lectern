// The public page of a share link, /s/:token (D-P2-3), drawn from `share_link` rows: links
// made in v2 and migrated v1 tokens alike. The page shows the document, and the transcript
// and audio only when the link's scope includes them (nothing outside the scope is in the
// markup). A password link asks first: the form POSTs back here, attempts are limited per
// link and client, and a right answer sets an HttpOnly cookie for that link's path only.
//
// Unknown and revoked tokens fall through (next()) to the v1 handler in index.ts, which
// keeps its 404/403 sentences (and the owner's view of a private lecture). Markup follows
// AGENTS.md: escaped text, double-quoted attributes, no inline script or style; script and
// stylesheet are served from /share-assets/ with a content hash in the URL.

import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "@lectern/config";
import { escapeHtml, renderMarkdownToHtml } from "@lectern/core";
import { sha256Hex } from "@lectern/db";
import type { DocumentBody } from "@lectern/domain";
import { Hono, type Context } from "hono";
import { renderDocumentMarkdown } from "./api/v2/render-md.ts";
import { parseJson, type RecordingRow, type ShareLinkRow } from "./api/v2/rows.ts";
import { assetPath } from "./api/v2/store.ts";
import { db, syncPendingLectures, verifyPassword } from "./db.ts";
import { audioMimeForPath, serveFileWithRange } from "./media-files.ts";

const LEGACY_TEMPLATE_ID = "legacy-markdown";
const PASSWORD_ATTEMPTS_PER_MINUTE = 10;
const UNLOCK_COOKIE_MAX_AGE_SEC = 86_400;

// --- attempt limit ----------------------------------------------------------------------

/** A sliding-window counter: at most `limit` calls of allow(key) per `windowMs`. */
export class PasswordLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
  }
}

const limiter = new PasswordLimiter(PASSWORD_ATTEMPTS_PER_MINUTE, 60_000);

/** The address the trusted proxy reports (index.ts getClientIp's rule; importing it would be a cycle). */
function clientIp(req: Request): string | null {
  const hops = config().trustedProxyHops;
  if (hops === 0) return null;
  const list = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list[Math.max(0, list.length - hops)]! : null;
}

// --- links ------------------------------------------------------------------------------

interface Shared {
  token: string;
  link: ShareLinkRow;
  scope: { transcript: boolean; audio: boolean };
  recording: RecordingRow;
  /** The shared document: the target, or the recording's primary document. */
  documentId: string | null;
}

type Lookup = { kind: "pass" } | { kind: "expired" } | { kind: "ok"; shared: Shared };

/** Structured documents before the migrated Markdown, newest first (the web's primaryDocument). */
function primaryDocumentId(recordingId: string): string | null {
  const row = db
    .query(
      `SELECT id FROM document WHERE recording_id = ?
       ORDER BY CASE WHEN template_id = ? THEN 1 ELSE 0 END, updated_at DESC, id LIMIT 1`
    )
    .get(recordingId, LEGACY_TEMPLATE_ID) as { id: string } | null;
  return row?.id ?? null;
}

function lookup(token: string): Lookup {
  // A v1 visibility change marks the lecture for projection; apply it before reading links.
  syncPendingLectures();
  const link = db.query(`SELECT * FROM share_link WHERE token_hash = ?`).get(sha256Hex(token)) as ShareLinkRow | null;
  if (!link || link.revoked_at !== null) return { kind: "pass" };
  if (link.expires_at !== null && link.expires_at <= Date.now()) return { kind: "expired" };
  let recordingId = link.target_id;
  let documentId: string | null = null;
  if (link.target_type === "document") {
    const doc = db.query(`SELECT id, recording_id FROM document WHERE id = ?`).get(link.target_id) as { id: string; recording_id: string } | null;
    if (!doc) return { kind: "pass" };
    recordingId = doc.recording_id;
    documentId = doc.id;
  }
  const recording = db.query(`SELECT * FROM recording WHERE id = ?`).get(recordingId) as RecordingRow | null;
  if (!recording) return { kind: "pass" };
  documentId ??= primaryDocumentId(recording.id);
  const scope = parseJson(link.scope_json, { transcript: false, audio: false });
  return { kind: "ok", shared: { token, link, scope: { transcript: scope.transcript === true, audio: scope.audio === true }, recording, documentId } };
}

// --- password cookie --------------------------------------------------------------------

const cookieName = (link: ShareLinkRow) => `lectern_share_${link.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
/** Changes with the password, so a new password locks out every old cookie. */
const cookieValue = (link: ShareLinkRow) => sha256Hex(`${link.password_hash}:${link.id}`);

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function unlocked(req: Request, link: ShareLinkRow): boolean {
  if (!link.password_hash) return true;
  const got = Buffer.from(readCookie(req, cookieName(link)) ?? "");
  const want = Buffer.from(cookieValue(link));
  return got.length === want.length && timingSafeEqual(got, want);
}

function unlockCookie(shared: Shared): string {
  const secure = config().baseUrl.startsWith("http://") ? "" : " Secure;";
  return `${cookieName(shared.link)}=${cookieValue(shared.link)}; Path=/s/${encodeURIComponent(shared.token)}; HttpOnly;${secure} SameSite=Lax; Max-Age=${UNLOCK_COOKIE_MAX_AGE_SEC}`;
}

// --- content ----------------------------------------------------------------------------

/** The shared document as Markdown (the current version), or null without one. */
function documentMarkdown(shared: Shared): string | null {
  if (!shared.documentId) return null;
  const row = db
    .query(
      `SELECT v.body_json, v.rendered_md FROM document d
       JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version WHERE d.id = ?`
    )
    .get(shared.documentId) as { body_json: string | null; rendered_md: string } | null;
  if (!row) return null;
  if (row.body_json) {
    const body = parseJson<DocumentBody | null>(row.body_json, null);
    if (body) return renderDocumentMarkdown(shared.recording.title, body);
  }
  return row.rendered_md;
}

function transcriptRows(recordingId: string): Array<{ start_ms: number; text: string }> {
  return db.query(`SELECT start_ms, text FROM transcript_segment WHERE recording_id = ? ORDER BY idx`).all(recordingId) as Array<{ start_ms: number; text: string }>;
}

function audioFile(recordingId: string): string | null {
  const assets = db
    .query(
      `SELECT blob_key FROM asset WHERE recording_id = ? AND kind LIKE 'audio%'
       ORDER BY COALESCE(part_index, 0), CASE WHEN kind = 'audio' THEN 0 ELSE 1 END, id`
    )
    .all(recordingId) as Array<{ blob_key: string }>;
  for (const asset of assets) {
    const path = assetPath(asset);
    if (path) return path;
  }
  return null;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h}:${mmss}` : mmss;
}

// --- markup -----------------------------------------------------------------------------

const SHARE_CSS = `:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --border: #e3e5e8;
  --text: #1b1d21;
  --text-muted: #5b616b;
  --accent: #4338ca;
  --accent-soft: #eef0fd;
  --danger: #b42318;
  --font: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #111214;
    --surface: #1a1c20;
    --border: #2c2f35;
    --text: #eceef1;
    --text-muted: #a3a9b3;
    --accent: #a5b4fc;
    --accent-soft: #23253a;
    --danger: #fda29b;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111214;
  --surface: #1a1c20;
  --border: #2c2f35;
  --text: #eceef1;
  --text-muted: #a3a9b3;
  --accent: #a5b4fc;
  --accent-soft: #23253a;
  --danger: #fda29b;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); }
button, input { font: inherit; }
.share-topbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 24px; background: var(--surface); border-bottom: 1px solid var(--border); }
.share-topbar .brand { margin-right: auto; font-weight: 700; text-decoration: none; color: var(--text); }
.share-topbar button, .share-topbar a.action, .password-form button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 8px; padding: 6px 12px; cursor: pointer; text-decoration: none; }
.share-topbar button:hover, .share-topbar a.action:hover { background: var(--accent-soft); }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.container { max-width: 820px; margin: 0 auto; padding: 32px 16px 64px; }
.article-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 32px; }
.article-card h1 { margin: 0 0 16px; font-size: 1.75rem; line-height: 1.3; }
.audio-bar { margin: 0 0 24px; }
.audio-bar audio { width: 100%; }
.md-body { overflow-wrap: break-word; word-break: keep-all; }
.md-body h1 { font-size: 1.5rem; }
.md-body h2 { font-size: 1.25rem; margin-top: 2em; }
.md-body h3 { font-size: 1.1rem; }
.md-body code { background: var(--accent-soft); border-radius: 4px; padding: 0 4px; }
.md-body pre { overflow-x: auto; background: var(--accent-soft); border-radius: 8px; padding: 12px; }
.md-body table { border-collapse: collapse; }
.md-body th, .md-body td { border: 1px solid var(--border); padding: 4px 8px; }
.ts-chip { border: 1px solid var(--border); background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 0 8px; font-size: 0.85em; cursor: pointer; }
.ts-chip:disabled { cursor: default; color: var(--text-muted); }
.transcript { margin-top: 40px; border-top: 1px solid var(--border); padding-top: 24px; }
.transcript h2 { font-size: 1.25rem; margin: 0 0 12px; }
.transcript ol { list-style: none; margin: 0; padding: 0; }
.transcript li { padding: 4px 0; }
.transcript .ts { color: var(--text-muted); font-variant-numeric: tabular-nums; margin-right: 8px; }
.empty { color: var(--text-muted); }
.password-form { display: flex; flex-direction: column; gap: 8px; max-width: 320px; }
.password-form input { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--bg); color: var(--text); }
.form-error { color: var(--danger); }
@media print {
  .share-topbar, .audio-bar { display: none; }
  .article-card { border: none; padding: 0; }
  html, body { background: #ffffff; color: #000000; }
}
`;

const SHARE_JS = `(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("lectern_theme");
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (e) {}
  function isDark() {
    var theme = root.getAttribute("data-theme");
    if (theme) return theme === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target.closest("[data-action], .ts-chip") : null;
    if (!target) return;
    if (target.classList.contains("ts-chip")) {
      var audio = document.querySelector("audio");
      if (!audio) return;
      audio.currentTime = Number(target.getAttribute("data-sec")) || 0;
      var played = audio.play();
      if (played && played.catch) played.catch(function () {});
      return;
    }
    var action = target.getAttribute("data-action");
    if (action === "toggle-theme") {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("lectern_theme", next); } catch (e) {}
    } else if (action === "print") {
      window.print();
    }
  });
  document.addEventListener("DOMContentLoaded", function () {
    if (document.querySelector("audio")) return;
    var chips = document.querySelectorAll(".ts-chip");
    for (var i = 0; i < chips.length; i++) chips[i].disabled = true;
  });
})();
`;

const assetVersion = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);
const CSS_URL = `/share-assets/share.css?v=${assetVersion(SHARE_CSS)}`;
const JS_URL = `/share-assets/share.js?v=${assetVersion(SHARE_JS)}`;

function shell(title: string, main: string, topbar: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} | Lectern</title>
<link rel="stylesheet" href="${CSS_URL}">
<script src="${JS_URL}" defer></script>
</head>
<body>
<header class="share-topbar">
<a class="brand" href="/app">Lectern</a>
${topbar}
</header>
<main class="container">
${main}
</main>
</body>
</html>
`;
}

export interface SharePageInput {
  token: string;
  title: string;
  /** The document as Markdown, or null when the recording has none yet. */
  markdown: string | null;
  transcript: Array<{ start_ms: number; text: string }> | null;
  audio: boolean;
}

export function renderSharePage(input: SharePageInput): string {
  const base = `/s/${encodeURIComponent(input.token)}`;
  // The page shows the title itself; drop the Markdown's own leading H1.
  const markdown = input.markdown?.replace(/^\s*# [^\n]*\n?/, "") ?? null;
  const body = markdown !== null ? renderMarkdownToHtml(markdown).html : `<p class="empty">공유된 문서가 없습니다.</p>`;
  const audio = input.audio ? `<div class="audio-bar"><audio controls preload="metadata" src="${escapeHtml(`${base}/audio`)}"></audio></div>` : "";
  const transcript = input.transcript
    ? `<section class="transcript" aria-label="전사">
<h2>전사</h2>
<ol>
${input.transcript
  .map((row) => {
    const at = clock(row.start_ms);
    const mark = input.audio
      ? `<button type="button" class="ts-chip" data-sec="${Math.floor(row.start_ms / 1000)}">${at}</button>`
      : `<span class="ts">[${at}]</span>`;
    return `<li>${mark} ${escapeHtml(row.text)}</li>`;
  })
  .join("\n")}
</ol>
</section>`
    : "";
  const topbar = `<button type="button" data-action="toggle-theme">테마 전환</button>
${markdown !== null ? `<a class="action" href="${escapeHtml(`${base}/markdown`)}">Markdown</a>` : ""}
<button type="button" data-action="print">PDF 인쇄</button>`;
  const main = `<article class="article-card">
<h1>${escapeHtml(input.title)}</h1>
${audio}
<div class="md-body">
${body}
</div>
${transcript}
</article>`;
  return shell(input.title, main, topbar);
}

function renderPasswordPage(token: string, error: string | null): string {
  const main = `<article class="article-card">
<h1>비밀번호가 필요한 공유 문서</h1>
<p>이 문서를 보려면 공유한 사람이 알려 준 비밀번호를 입력하세요.</p>
${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
<form class="password-form" method="post" action="${escapeHtml(`/s/${encodeURIComponent(token)}`)}">
<label for="password">비밀번호</label>
<input type="password" id="password" name="password" autocomplete="off" required>
<button type="submit">확인</button>
</form>
</article>`;
  return shell("비밀번호 확인", main, `<button type="button" data-action="toggle-theme">테마 전환</button>`);
}

// --- routes -----------------------------------------------------------------------------

const PAGE_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const html = (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: { ...PAGE_HEADERS, ...extra } });

const expired = () =>
  new Response("만료된 공유 링크입니다.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const notFoundText = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const attachmentName = (title: string) => encodeURIComponent(`${title}.md`.replace(/[^\w가-힣._ -]/g, "_"));

export function createShareRouter(): Hono {
  const app = new Hono();

  app.get("/share-assets/share.css", () => new Response(SHARE_CSS, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" } }));
  app.get("/share-assets/share.js", () => new Response(SHARE_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" } }));

  /** Looks the token up; unknown or revoked → the v1 handler, expired → 410. */
  const withLink = (handler: (c: Context, shared: Shared) => Response | Promise<Response>) => async (c: Context, next: () => Promise<void>) => {
    const found = lookup(c.req.param("token") ?? "");
    if (found.kind === "pass") return next();
    if (found.kind === "expired") return expired();
    return handler(c, found.shared);
  };

  app.get(
    "/s/:token",
    withLink((c, shared) => {
      if (!unlocked(c.req.raw, shared.link)) return html(renderPasswordPage(shared.token, null));
      return html(
        renderSharePage({
          token: shared.token,
          title: shared.recording.title,
          markdown: documentMarkdown(shared),
          transcript: shared.scope.transcript ? transcriptRows(shared.recording.id) : null,
          audio: shared.scope.audio && audioFile(shared.recording.id) !== null,
        })
      );
    })
  );

  app.post(
    "/s/:token",
    withLink(async (c, shared) => {
      const here = `/s/${encodeURIComponent(shared.token)}`;
      if (!shared.link.password_hash) return new Response(null, { status: 303, headers: { Location: here } });
      if (!limiter.allow(`${shared.link.id}|${clientIp(c.req.raw) ?? "unknown"}`)) {
        return html(renderPasswordPage(shared.token, "시도가 너무 많습니다. 1분 뒤 다시 시도하세요."), 429, { "Retry-After": "60" });
      }
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      const password = typeof form.password === "string" ? form.password : "";
      if (!password || !verifyPassword(password, shared.link.password_hash)) {
        return html(renderPasswordPage(shared.token, "비밀번호가 올바르지 않습니다."), 403);
      }
      return new Response(null, { status: 303, headers: { Location: here, "Set-Cookie": unlockCookie(shared), "Cache-Control": "no-store" } });
    })
  );

  app.get(
    "/s/:token/audio",
    withLink((c, shared) => {
      if (!shared.scope.audio || !unlocked(c.req.raw, shared.link)) return notFoundText();
      const path = audioFile(shared.recording.id);
      if (!path) return notFoundText();
      return serveFileWithRange(c.req.raw, path, audioMimeForPath(path), { "Cache-Control": "private, no-store" });
    })
  );

  app.get(
    "/s/:token/markdown",
    withLink((c, shared) => {
      if (!unlocked(c.req.raw, shared.link)) return notFoundText();
      const markdown = documentMarkdown(shared);
      if (markdown === null) return notFoundText();
      return new Response(`${markdown}\n`, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="note.md"; filename*=UTF-8''${attachmentName(shared.recording.title)}`,
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex",
        },
      });
    })
  );

  return app;
}
