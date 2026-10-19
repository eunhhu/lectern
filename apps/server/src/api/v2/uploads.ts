import { defineRouter, notImplemented } from "./common.ts";

// Resumable uploads need the upload table and streaming part storage (ROADMAP P2). No
// upload session can exist before createUpload works, so even the read answers 501.
export const uploadsRouter = defineRouter({
  createUpload: notImplemented,
  getUpload: notImplemented,
  putUploadPart: notImplemented,
  completeUpload: notImplemented,
  abortUpload: notImplemented,
});
