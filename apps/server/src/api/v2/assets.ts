import { defineRouter, notImplemented } from "./common.ts";

// Asset bytes come from the content-addressed blob store, which v2 does not have yet
// (ROADMAP P2). There is no JSON schema to serve a fixture against, so this answers 501.
export const assetsRouter = defineRouter({
  getAssetContent: notImplemented,
});
