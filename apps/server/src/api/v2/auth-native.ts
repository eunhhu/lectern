// Native app sign-in (CONTRACTS D-P5-4): access/refresh token pairs for the Apple, Android
// and Windows apps. Both routes are public (no session). Stubs until P5-03 implements them.

import { defineRouter, notImplemented } from "./common.ts";

export const authNativeRouter = defineRouter({
  issueNativeToken: notImplemented,
  revokeNativeToken: notImplemented,
});
