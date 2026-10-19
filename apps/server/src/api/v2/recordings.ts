import { denyUnlessMember } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok, okPage, type Handler, type V2Request } from "./common.ts";
import * as F from "./fixtures.ts";

type Recording = (typeof F.recordings)[number];

/** A handler for `/recordings/{recording_id}/...` that 404s on unknown recordings. */
function withRecording(handler: (req: V2Request, recording: Recording) => Response): Handler {
  return (req) => {
    const recording = F.recordings.find((r) => r.id === req.params.recording_id);
    return recording ? handler(req, recording) : notFound(req, "녹음");
  };
}

const tagIdsOf = (recordingId: string): string[] =>
  F.recordingTags.filter((t) => t.recording_id === recordingId).map((t) => t.tag_id);

export const recordingsRouter = defineRouter({
  listRecordings: (req) => {
    const q = req.query as { workspace_id: string; folder_id?: string; tag_id?: string; domain?: string; status?: string };
    const denied = denyUnlessMember(req, q.workspace_id);
    if (denied) return denied;
    const items = F.recordings
      .filter(
        (r) =>
          r.workspace_id === q.workspace_id &&
          (q.folder_id === undefined || r.folder_id === q.folder_id) &&
          (q.tag_id === undefined || tagIdsOf(r.id).includes(q.tag_id)) &&
          (q.domain === undefined || r.domain === q.domain) &&
          (q.status === undefined || r.status === q.status)
      )
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
      .map((r) => ({ ...r, tag_ids: tagIdsOf(r.id) }));
    return okPage(req, items);
  },
  getRecording: withRecording((req, recording) =>
    ok(req, {
      recording,
      tags: F.recordingTags.filter((t) => t.recording_id === recording.id),
      assets: F.assets.filter((a) => a.recording_id === recording.id),
      speakers: F.speakers.filter((s) => s.recording_id === recording.id),
      documents: F.documents.filter((d) => d.recording_id === recording.id),
      active_job:
        F.jobs.find((j) => j.recording_id === recording.id && (j.state === "queued" || j.state === "running")) ?? null,
    })
  ),
  updateRecording: notImplemented,
  deleteRecording: notImplemented,
  getTranscript: withRecording((req, recording) =>
    ok(req, F.transcripts.find((t) => t.recording_id === recording.id))
  ),
  updateSpeaker: notImplemented,
  listRecordingDocuments: withRecording((req, recording) =>
    okPage(req, F.documents.filter((d) => d.recording_id === recording.id))
  ),
  listRecordingQuestions: withRecording((req, recording) => {
    const { kind } = req.query as { kind?: string };
    return okPage(
      req,
      F.questions.filter((q) => q.recording_id === recording.id && (kind === undefined || q.kind === kind))
    );
  }),
  listRecordingEvents: withRecording((req, recording) =>
    okPage(req, F.eventCandidates.filter((e) => e.recording_id === recording.id))
  ),
  listRecordingActionItems: withRecording((req, recording) =>
    okPage(req, F.actionItems.filter((a) => a.recording_id === recording.id))
  ),
  reprocessRecording: notImplemented,
});
