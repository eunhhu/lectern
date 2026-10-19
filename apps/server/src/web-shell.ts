// Serves the v2 web app (apps/web, built by `bun run web:build`) at /app when
// LECTERN_WEB_SHELL=1. The build output is plain same-origin files: index.html plus
// content-hashed assets under /app/assets, so the CSP in index.ts applies unchanged.
//
// - Paths with a file extension are files: served from the dist directory or 404. A
//   missing script must never come back as index.html, or the browser would run HTML.
// - Every other path under /app is a client-side route and gets index.html (SPA).
// - Hashed assets are cached for a year; index.html is revalidated on every load so a
//   deploy is picked up immediately.

import { existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { REPO_ROOT } from "@lectern/config";

export const WEB_SHELL_BASE = "/app";
export const WEB_SHELL_DIST_DIR = join(REPO_ROOT, "apps/web/dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const IMMUTABLE = "public, max-age=31536000, immutable";

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * The response for `pathname` (which starts with /app), or null when the path is not
 * under /app at all. `distDir` is the build output directory.
 */
export function webShellResponse(pathname: string, distDir: string): Response | null {
  if (pathname !== WEB_SHELL_BASE && !pathname.startsWith(`${WEB_SHELL_BASE}/`)) return null;

  const indexFile = join(distDir, "index.html");
  if (!existsSync(indexFile)) {
    return text(503, "웹 앱이 아직 빌드되지 않았습니다. 서버 체크아웃에서 `bun run web:build`를 실행하세요.");
  }

  let segments: string[];
  try {
    segments = pathname
      .slice(WEB_SHELL_BASE.length)
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return text(400, "잘못된 경로입니다.");
  }
  // No dot-files, no parent references, no smuggled separators or NUL bytes.
  if (segments.some((s) => s.startsWith(".") || s.includes("/") || s.includes("\\") || s.includes("\0"))) {
    return text(404, "찾을 수 없습니다.");
  }

  const last = segments.at(-1) ?? "";
  if (!extname(last)) {
    return new Response(Bun.file(indexFile), {
      headers: { "Content-Type": CONTENT_TYPES[".html"]!, "Cache-Control": "no-cache" },
    });
  }

  const file = join(distDir, ...segments);
  let real: string;
  try {
    real = realpathSync(file);
    if (!real.startsWith(realpathSync(distDir) + sep) || !statSync(real).isFile()) {
      return text(404, "찾을 수 없습니다.");
    }
  } catch {
    return text(404, "찾을 수 없습니다.");
  }
  const type = CONTENT_TYPES[extname(real).toLowerCase()] ?? "application/octet-stream";
  const cache = segments[0] === "assets" ? IMMUTABLE : "no-cache";
  return new Response(Bun.file(real), { headers: { "Content-Type": type, "Cache-Control": cache } });
}
