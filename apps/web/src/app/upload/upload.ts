// Runs one upload group through the resumable upload contract (ARCHITECTURE §6):
// create a session with the file list → PUT each part the session's plan asks for →
// complete. Parts already received (a resumed session) are skipped.

import type { ApiClient } from "../../api/client.ts";
import type { CompleteUploadResponse, CreateUploadRequest, FolderId, RecordingDomain, UploadFileSpec, WorkspaceId } from "../../api/types.ts";
import { extensionOf, type UploadGroup } from "../../lib/pairing.ts";

const MIME_BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  weba: "audio/webm",
  flac: "audio/flac",
  caf: "audio/x-caf",
  amr: "audio/amr",
  pdf: "application/pdf",
};

export function mimeOf(file: File): string {
  if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(file.type)) return file.type;
  return MIME_BY_EXT[extensionOf(file.name)] ?? "application/octet-stream";
}

export interface UploadOptions {
  workspaceId: WorkspaceId;
  title: string | null;
  folderId: FolderId | null;
  domain: RecordingDomain | null;
}

export function buildUploadRequest(group: UploadGroup<File>, options: UploadOptions): CreateUploadRequest {
  const files: UploadFileSpec[] = [
    ...group.audio.map((f) => ({ kind: "audio" as const, filename: f.name.normalize("NFC"), mime: mimeOf(f), bytes: f.size })),
    ...group.pdfs.map((p) => ({ kind: "pdf" as const, filename: p.file.name.normalize("NFC"), mime: mimeOf(p.file), bytes: p.file.size })),
  ];
  return {
    workspace_id: options.workspaceId,
    recording: {
      ...(options.title ? { title: options.title } : {}),
      ...(options.folderId ? { folder_id: options.folderId } : {}),
      ...(options.domain ? { domain: options.domain } : {}),
    },
    ...(group.recordedAt ? { recorded_at: group.recordedAt } : {}),
    files,
  };
}

export async function uploadGroup(
  api: ApiClient,
  group: UploadGroup<File>,
  options: UploadOptions,
  onProgress: (sentBytes: number, totalBytes: number) => void,
): Promise<CompleteUploadResponse> {
  const blobs = [...group.audio, ...group.pdfs.map((p) => p.file)];
  const total = blobs.reduce((sum, f) => sum + f.size, 0);
  const session = await api.createUpload(buildUploadRequest(group, options), crypto.randomUUID());
  const received = new Set(session.received_parts);
  let sent = 0;
  onProgress(0, total);
  for (const spec of session.files) {
    const file = blobs[spec.index]!;
    for (let i = 0; i < spec.part_count; i++) {
      const part = spec.first_part + i;
      const slice = file.slice(i * session.part_size, (i + 1) * session.part_size);
      if (!received.has(part)) await api.uploadPart(session.id, part, slice);
      sent += slice.size;
      onProgress(sent, total);
    }
  }
  return api.completeUpload(session.id, crypto.randomUUID());
}
