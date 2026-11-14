// The transcript–PDF alignment of a `process` run (P3-04, CONTRACTS D-P3-4): the harness
// `align` stage (no model) over the published transcript and the stored PDF pages, kept as
// a file for GET /recordings/{id}/alignment, and the PDF part of the notes prompt built
// from it. The alignment is extra information: when it fails the notes run without it and
// the recording does not become `partial`. Like queue.ts, this module must not import
// index.ts.

import { alignStage, buildPdfContext, type AlignPage, type AlignSegment, type JobRun, type PdfContext } from "@lectern/harness";
import { db } from "./db.ts";
import { logger } from "./log.ts";
import { writeAlignment } from "./pdf-align-file.ts";

export { alignmentPath, deleteAlignment, readAlignment, type RecordingAlignmentFile } from "./pdf-align-file.ts";

/**
 * Aligns a recording's transcript with its PDF pages and returns the notes' PDF context.
 * Null, without running the stage, when there is no transcript or no page with text.
 */
export async function alignRecording(args: { run: JobRun; recordingId: string; workspaceId: string }): Promise<PdfContext | null> {
  const { run, recordingId } = args;
  try {
    const segments = db
      .query(`SELECT idx, start_ms, end_ms, text FROM transcript_segment WHERE recording_id = ? ORDER BY idx`)
      .all(recordingId) as AlignSegment[];
    const pages = db
      .query(`SELECT asset_id, page_no, text FROM pdf_page WHERE recording_id = ? AND char_count > 0 ORDER BY asset_id, page_no`)
      .all(recordingId) as AlignPage[];
    if (segments.length === 0 || pages.length === 0) return null;

    const result = await run.run(alignStage, { segments, pages });
    writeAlignment(recordingId, { windows: result.value.windows });
    const assetOrder = (
      db.query(`SELECT id FROM asset WHERE recording_id = ? AND kind = 'pdf' ORDER BY part_index, created_at`).all(recordingId) as Array<{
        id: string;
      }>
    ).map((a) => a.id);
    return buildPdfContext(result.value, pages, assetOrder);
  } catch (err) {
    logger.warn("pdf align failed", { recording_id: recordingId, err });
    return null;
  }
}
