// Publishes a harness transcript to the v2 tables (CONTRACTS §1.9): transcript_segment,
// speaker and transcript_gap, replaced in one transaction. Speaker rows are kept by label
// across republishes, so their ids and the names users gave them survive. Like queue.ts,
// this module must not import index.ts.

import type { Transcript } from "@lectern/harness";
import { transact, uuidv7 } from "./api/v2/store.ts";
import { db } from "./db.ts";

export interface PublishTranscriptInput {
  recordingId: string;
  workspaceId: string;
  transcript: Transcript;
}

export interface PublishTranscriptResult {
  segments: number;
  speakers: number;
  gaps: number;
}

export function publishTranscript(input: PublishTranscriptInput): PublishTranscriptResult {
  const { recordingId, workspaceId, transcript } = input;
  if (!db.query(`SELECT 1 FROM recording WHERE id = ?`).get(recordingId)) throw new Error("recording not found");

  return transact(() => {
    const now = Date.now();
    const existing = db
      .query(`SELECT id, label, display_name FROM speaker WHERE recording_id = ?`)
      .all(recordingId) as Array<{ id: string; label: string; display_name: string | null }>;
    const byLabel = new Map(existing.map((row) => [row.label, row.id] as const));

    const updateSpeaker = db.query(`UPDATE speaker SET confidence = ?, updated_at = ? WHERE id = ?`);
    const insertSpeaker = db.query(
      `INSERT INTO speaker (id, workspace_id, recording_id, label, display_name, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
    );
    const labels = new Set<string>();
    for (const speaker of transcript.speakers) {
      labels.add(speaker.label);
      const id = byLabel.get(speaker.label);
      if (id) {
        updateSpeaker.run(speaker.confidence, now, id);
      } else {
        const newId = uuidv7();
        insertSpeaker.run(newId, workspaceId, recordingId, speaker.label, speaker.confidence, now, now);
        byLabel.set(speaker.label, newId);
      }
    }
    // A segment may carry a label the speakers list missed; give it a row too.
    for (const segment of transcript.segments) {
      if (labels.has(segment.speaker)) continue;
      labels.add(segment.speaker);
      if (!byLabel.has(segment.speaker)) {
        const newId = uuidv7();
        insertSpeaker.run(newId, workspaceId, recordingId, segment.speaker, null, now, now);
        byLabel.set(segment.speaker, newId);
      }
    }
    const deleteSpeaker = db.query(`DELETE FROM speaker WHERE id = ?`);
    for (const row of existing) if (!labels.has(row.label)) deleteSpeaker.run(row.id);

    db.query(`DELETE FROM transcript_segment WHERE recording_id = ?`).run(recordingId);
    db.query(`DELETE FROM transcript_gap WHERE recording_id = ?`).run(recordingId);
    const insertSegment = db.query(
      `INSERT INTO transcript_segment (workspace_id, recording_id, idx, start_ms, end_ms, speaker_id, text, confidence, source_chunk, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`
    );
    for (const s of transcript.segments) {
      insertSegment.run(workspaceId, recordingId, s.idx, s.start_ms, s.end_ms, byLabel.get(s.speaker) ?? null, s.text, s.source_chunk);
    }
    const insertGap = db.query(
      `INSERT INTO transcript_gap (workspace_id, recording_id, kind, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)`
    );
    for (const gap of transcript.gaps) insertGap.run(workspaceId, recordingId, gap.kind, gap.start_ms, gap.end_ms);

    return { segments: transcript.segments.length, speakers: labels.size, gaps: transcript.gaps.length };
  });
}
