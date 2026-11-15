// Where a recording's transcript–PDF alignment is kept (P3-04): one JSON file per recording
// under DATA_DIR/pdf-align/. The harness's own `align` artifact is a blob that goes with the
// job (deleteArtifactsForJob), and the contract has no table for it, so the server keeps
// this copy for GET /recordings/{id}/alignment. Separate from pdf-align.ts so db.ts can
// delete the file without importing the module that imports db.ts.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "@lectern/config";
import type { AlignOutput } from "@lectern/harness";
import { ensurePrivateDir, makePrivate } from "./fsperm.ts";

export interface RecordingAlignmentFile {
  windows: AlignOutput["windows"];
}

const alignmentDir = () => join(config().dataDir, "pdf-align");

export function alignmentPath(recordingId: string): string {
  return join(alignmentDir(), `${recordingId}.json`);
}

/** The stored alignment; no file (no PDF, not processed yet) is no windows. */
export function readAlignment(recordingId: string): RecordingAlignmentFile {
  const path = alignmentPath(recordingId);
  if (!existsSync(path)) return { windows: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RecordingAlignmentFile>;
    return { windows: Array.isArray(parsed.windows) ? parsed.windows : [] };
  } catch {
    return { windows: [] };
  }
}

/** Writes through a temporary file and a rename, so a reader never sees half a file. */
export function writeAlignment(recordingId: string, alignment: RecordingAlignmentFile): void {
  ensurePrivateDir(alignmentDir());
  const path = alignmentPath(recordingId);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ windows: alignment.windows }));
  makePrivate(tmp);
  renameSync(tmp, path);
}

export function deleteAlignment(recordingId: string): void {
  rmSync(alignmentPath(recordingId), { force: true });
}
