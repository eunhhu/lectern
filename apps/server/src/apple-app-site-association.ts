// /.well-known/apple-app-site-association (CONTRACTS D-P6-4): which Apple apps may open
// /app/* and /s/* links (universal links) and use this site's saved passwords. Apple fetches
// it through its CDN without cookies or redirects, so http.ts answers it directly.

/** The document for APPLE_APP_IDS (`<TEAM_ID>.<bundle id>`), or null when there is none. */
export function aasaDocument(appIds: string[]): object | null {
  if (appIds.length === 0) return null;
  return {
    applinks: {
      details: [{ appIDs: [...appIds], components: [{ "/": "/app/*" }, { "/": "/s/*" }] }],
    },
    webcredentials: { apps: [...appIds] },
  };
}
