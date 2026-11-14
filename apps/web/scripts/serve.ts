// Local preview of the built app (`bun apps/web/scripts/serve.ts`, used by Playwright and
// `bun run web:dev`). It serves dist through the same /app handler as production
// (apps/server/src/web-shell.ts) but never starts the API server, so no database, upload
// directory or HOME file is read: the app runs entirely on fixture data. The one thing it
// answers under /api is the bytes of a fixture PDF (a generated sample with the fixture's
// page count), so the files panel's viewer has something to show.
//
// HTML responses carry a CSP that is STRICTER than production's (no 'unsafe-inline' and
// no CDN in style-src), so anything that works here also works behind the real policy.

import { webShellResponse } from "../../server/src/web-shell.ts";
import { buildFixtureData } from "../src/fixtures/index.ts";
import { BASE_PATH } from "./html.ts";
import { makeSamplePdf } from "./sample-pdf.ts";
import { join } from "node:path";
import { DIST_DIR, argValue } from "./build.ts";

export const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const FIXTURE_PDF = /^\/api\/v2\/assets\/([\w-]+_pdf)\/content$/;
let fixturePageCounts: Map<string, number> | null = null;

/** A generated PDF for a fixture PDF asset (`<recording>_pdf`), or null for any other path. */
export function fixturePdfResponse(pathname: string): Response | null {
  const id = FIXTURE_PDF.exec(pathname)?.[1];
  if (!id) return null;
  fixturePageCounts ??= new Map(
    buildFixtureData(new Date()).assets.flatMap((a) => (a.kind === "pdf" && a.page_count ? [[a.id as string, a.page_count] as const] : [])),
  );
  const pages = fixturePageCounts.get(id);
  if (!pages) return new Response("찾을 수 없습니다.", { status: 404 });
  return new Response(new Uint8Array(makeSamplePdf(pages)), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}

export function startPreviewServer({ port = 4173, distDir = DIST_DIR }: { port?: number; distDir?: string } = {}) {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("허용되지 않는 요청입니다.", { status: 405 });
      if (pathname === "/") return Response.redirect(`${BASE_PATH}/`, 302);
      const res = fixturePdfResponse(pathname) ?? webShellResponse(pathname, distDir) ?? new Response("찾을 수 없습니다.", { status: 404 });
      res.headers.set("X-Content-Type-Options", "nosniff");
      if ((res.headers.get("Content-Type") ?? "").startsWith("text/html")) {
        res.headers.set("Content-Security-Policy", PREVIEW_CSP);
        res.headers.set("X-Frame-Options", "DENY");
      }
      return res;
    },
  });
  console.log(`web: preview at http://127.0.0.1:${server.port}${BASE_PATH}/`);
  return server;
}

if (import.meta.main) {
  const port = argValue("port");
  const dist = argValue("dist");
  startPreviewServer({ port: port ? Number(port) : undefined, ...(dist ? { distDir: join(process.cwd(), dist) } : {}) });
}
