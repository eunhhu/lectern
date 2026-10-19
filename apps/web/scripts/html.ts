// The one HTML document of the app. It only references same-origin files: no inline
// <script>, no inline <style>, no style="" attributes, no other origins. The server's CSP
// (`script-src 'self'`, and soon `style-src 'self'`) therefore never has to change for it.

export const BASE_PATH = "/app";
export const ASSET_PATH = `${BASE_PATH}/assets/`;

export interface IndexHtmlInput {
  /** Absolute URLs of the entry stylesheets, in order. */
  styles: string[];
  /** Absolute URLs of the entry module scripts. */
  scripts: string[];
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderIndexHtml({ styles, scripts }: IndexHtmlInput): string {
  for (const url of [...styles, ...scripts]) {
    if (!url.startsWith(ASSET_PATH)) throw new Error(`asset outside ${ASSET_PATH}: ${url}`);
  }
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="referrer" content="same-origin">',
    "<title>Lectern</title>",
    ...styles.map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`),
    ...scripts.map((src) => `<script type="module" src="${escapeAttr(src)}"></script>`),
    "</head>",
    "<body>",
    "<noscript>Lectern을 쓰려면 브라우저에서 JavaScript를 켜세요.</noscript>",
    '<div id="root"></div>',
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
