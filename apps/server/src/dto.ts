// Wire shapes shared by the API and the job handlers (which also run in apps/worker, so
// this module must not import index.ts).

import { existsSync } from "node:fs";
import type { LectureSummaryDto } from "./admin-api.ts";
import { formatKstTimestamp, type LectureRecord } from "./db.ts";

export function toLectureSummaryDto(l: LectureRecord): LectureSummaryDto {
  const displayDateLabel =
    l.date_label && l.date_label.length > 10
      ? l.date_label
      : formatKstTimestamp(l.created_at).fullLabel;
  return {
    id: l.id,
    share_token: l.share_token,
    is_public: Boolean(l.is_public),
    title: l.title,
    course: l.course,
    date_label: displayDateLabel,
    status: l.status,
    stage: l.stage,
    stage_message: l.stage_message,
    progress: l.progress,
    excerpt: l.excerpt,
    duration_sec: l.duration_sec,
    audio_size: l.audio_size,
    model_used: l.model_used,
    has_audio: Boolean(l.audio_path && existsSync(l.audio_path)),
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}
