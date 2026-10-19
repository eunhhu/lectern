// v2 table rows -> packages/domain shapes. Pure functions (no database, no db.ts import), so
// the migration rehearsal script can check every migrated row against the domain schemas
// without booting the server. Times are integer ms in the tables and ISO-8601 UTC here;
// `*_json` columns become the parsed field without the suffix (domain README).

export const iso = (ms: number) => new Date(ms).toISOString();
export const isoOrNull = (ms: number | null | undefined) => (ms == null ? null : iso(ms));

export function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (json == null) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export interface WorkspaceRow {
  id: string;
  name: string;
  kind: string;
  plan: string;
  settings_json: string;
  personal_user_id: string | null;
  created_at: number;
  updated_at: number;
}

export const workspaceDto = (w: WorkspaceRow) => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  plan: w.plan,
  settings: parseJson(w.settings_json, {}),
  created_at: iso(w.created_at),
  updated_at: iso(w.updated_at),
});

export interface MembershipRow {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: number;
  updated_at: number;
}

export const membershipDto = (m: MembershipRow) => ({
  workspace_id: m.workspace_id,
  user_id: m.user_id,
  role: m.role,
  created_at: iso(m.created_at),
  updated_at: iso(m.updated_at),
});

export interface FolderRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  sort_key: string;
  created_at: number;
  updated_at: number;
}

export const folderDto = (f: FolderRow) => ({
  id: f.id,
  workspace_id: f.workspace_id,
  parent_id: f.parent_id,
  name: f.name,
  sort_key: f.sort_key,
  created_at: iso(f.created_at),
  updated_at: iso(f.updated_at),
});

export interface TagRow {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export const tagDto = (t: TagRow) => ({
  id: t.id,
  workspace_id: t.workspace_id,
  name: t.name,
  color: t.color,
  created_at: iso(t.created_at),
  updated_at: iso(t.updated_at),
});

export interface RecordingRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  title: string;
  domain: string;
  template_id: string | null;
  language: string | null;
  recorded_at: number;
  recorded_at_source: string;
  duration_ms: number | null;
  status: string;
  created_by: string;
  visibility: "private" | "workspace";
  lecture_id: string | null;
  source_client: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: number;
  updated_at: number;
}

export const recordingDto = (r: RecordingRow) => ({
  id: r.id,
  workspace_id: r.workspace_id,
  folder_id: r.folder_id,
  title: r.title,
  domain: r.domain,
  template_id: r.template_id,
  language: r.language,
  recorded_at: iso(r.recorded_at),
  recorded_at_source: r.recorded_at_source,
  duration_ms: r.duration_ms,
  status: r.status,
  created_by: r.created_by,
  visibility: r.visibility,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});

export interface RecordingTagRow {
  workspace_id: string;
  recording_id: string;
  tag_id: string;
  source: "user" | "ai";
  confidence: number | null;
  created_at: number;
}

export const recordingTagDto = (t: RecordingTagRow) => ({
  workspace_id: t.workspace_id,
  recording_id: t.recording_id,
  tag_id: t.tag_id,
  source: t.source,
  confidence: t.confidence,
  created_at: iso(t.created_at),
});

export interface AssetRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  kind: string;
  part_index: number;
  blob_key: string;
  sha256: string | null;
  bytes: number;
  mime: string;
  duration_ms: number | null;
  page_count: number | null;
  meta_json: string;
  created_at: number;
}

/** The public asset (no blob key, no storage path in `meta`). Needs a computed `sha256`. */
export function assetDto(a: AssetRow) {
  const { path: _path, ...meta } = parseJson<Record<string, unknown>>(a.meta_json, {});
  return {
    id: a.id,
    workspace_id: a.workspace_id,
    recording_id: a.recording_id,
    kind: a.kind,
    part_index: a.part_index,
    sha256: a.sha256,
    bytes: a.bytes,
    mime: a.mime,
    duration_ms: a.duration_ms,
    page_count: a.page_count,
    meta,
    created_at: iso(a.created_at),
  };
}

export interface SpeakerRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  label: string;
  display_name: string | null;
  confidence: number | null;
  created_at: number;
  updated_at: number;
}

export const speakerDto = (s: SpeakerRow) => ({
  id: s.id,
  workspace_id: s.workspace_id,
  recording_id: s.recording_id,
  label: s.label,
  display_name: s.display_name,
  confidence: s.confidence,
  created_at: iso(s.created_at),
  updated_at: iso(s.updated_at),
});

export interface SegmentRow {
  workspace_id: string;
  recording_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_id: string | null;
  text: string;
  confidence: number | null;
  source_chunk: number | null;
  lang: string | null;
}

export const segmentDto = (s: SegmentRow) => ({
  workspace_id: s.workspace_id,
  recording_id: s.recording_id,
  idx: s.idx,
  start_ms: s.start_ms,
  end_ms: s.end_ms,
  speaker_id: s.speaker_id,
  text: s.text,
  confidence: s.confidence,
  source_chunk: s.source_chunk,
  lang: s.lang,
});

export interface GapRow {
  kind: string;
  start_ms: number;
  end_ms: number;
}

export const gapDto = (g: GapRow) => ({ kind: g.kind, start_ms: g.start_ms, end_ms: g.end_ms });

export interface DocumentRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  template_id: string;
  template_version: number;
  current_version: number;
  user_edited: number;
  md_source_path: string | null;
  created_at: number;
  updated_at: number;
}

export const documentDto = (d: DocumentRow) => ({
  id: d.id,
  workspace_id: d.workspace_id,
  recording_id: d.recording_id,
  template_id: d.template_id,
  template_version: d.template_version,
  current_version: d.current_version,
  user_edited: Boolean(d.user_edited),
  created_at: iso(d.created_at),
  updated_at: iso(d.updated_at),
});

export interface DocumentVersionRow {
  id: string;
  workspace_id: string;
  document_id: string;
  recording_id: string;
  version: number;
  base_version: number | null;
  template_id: string;
  template_version: number;
  body_json: string | null;
  rendered_md: string;
  created_by: "ai" | "user";
  author_id: string | null;
  created_at: number;
}

export const documentVersionSummaryDto = (v: DocumentVersionRow) => ({
  id: v.id,
  workspace_id: v.workspace_id,
  document_id: v.document_id,
  recording_id: v.recording_id,
  version: v.version,
  base_version: v.base_version,
  template_id: v.template_id,
  template_version: v.template_version,
  created_by: v.created_by,
  author_id: v.author_id,
  created_at: iso(v.created_at),
});

export const documentVersionDto = (v: DocumentVersionRow) => ({
  ...documentVersionSummaryDto(v),
  body: parseJson(v.body_json, null),
  rendered_md: v.rendered_md,
});

export interface QuestionRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  kind: string;
  prompt: string;
  answer: string | null;
  sources_json: string;
  difficulty: string | null;
  flags_json: string;
  created_at: number;
  updated_at: number;
}

export const questionDto = (q: QuestionRow) => ({
  id: q.id,
  workspace_id: q.workspace_id,
  recording_id: q.recording_id,
  kind: q.kind,
  prompt: q.prompt,
  answer: q.answer,
  sources: parseJson(q.sources_json, []),
  difficulty: q.difficulty,
  flags: parseJson(q.flags_json, []),
  created_at: iso(q.created_at),
  updated_at: iso(q.updated_at),
});

export interface EventCandidateRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  kind: string;
  title: string;
  start_at: number;
  end_at: number | null;
  all_day: number;
  tz: string;
  raw_expression: string;
  resolution_json: string;
  confidence: number;
  evidence_json: string;
  flags_json: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export const eventCandidateDto = (e: EventCandidateRow) => ({
  id: e.id,
  workspace_id: e.workspace_id,
  recording_id: e.recording_id,
  kind: e.kind,
  title: e.title,
  start_at: iso(e.start_at),
  end_at: isoOrNull(e.end_at),
  all_day: Boolean(e.all_day),
  tz: e.tz,
  raw_expression: e.raw_expression,
  resolution: parseJson(e.resolution_json, { method: "model", rule: null }),
  confidence: e.confidence,
  evidence: parseJson(e.evidence_json, { sources: [], quote: "" }),
  flags: parseJson(e.flags_json, []),
  status: e.status,
  created_at: iso(e.created_at),
  updated_at: iso(e.updated_at),
});

export interface ActionItemRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  text: string;
  owner_name: string | null;
  due_at: number | null;
  due_raw: string | null;
  status: string;
  evidence_json: string;
  flags_json: string;
  created_at: number;
  updated_at: number;
}

export const actionItemDto = (a: ActionItemRow) => ({
  id: a.id,
  workspace_id: a.workspace_id,
  recording_id: a.recording_id,
  text: a.text,
  owner_name: a.owner_name,
  due_at: isoOrNull(a.due_at),
  due_raw: a.due_raw,
  status: a.status,
  evidence: parseJson(a.evidence_json, { sources: [], quote: "" }),
  flags: parseJson(a.flags_json, []),
  created_at: iso(a.created_at),
  updated_at: iso(a.updated_at),
});

export interface ShareLinkRow {
  id: string;
  workspace_id: string;
  target_type: "recording" | "document";
  target_id: string;
  token_hash: string;
  scope_json: string;
  expires_at: number | null;
  password_hash: string | null;
  created_by: string;
  created_at: number;
  revoked_at: number | null;
}

export const shareLinkDto = (l: ShareLinkRow) => ({
  id: l.id,
  workspace_id: l.workspace_id,
  target_type: l.target_type,
  target_id: l.target_id,
  scope: parseJson(l.scope_json, { transcript: false, audio: false }),
  expires_at: isoOrNull(l.expires_at),
  has_password: l.password_hash !== null,
  created_by: l.created_by,
  created_at: iso(l.created_at),
  revoked_at: isoOrNull(l.revoked_at),
});

export interface IntegrationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  scopes_json: string;
  token_enc: string;
  calendar_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export const integrationDto = (i: IntegrationRow) => ({
  id: i.id,
  workspace_id: i.workspace_id,
  user_id: i.user_id,
  provider: i.provider,
  scopes: parseJson(i.scopes_json, []),
  calendar_id: i.calendar_id,
  status: i.status,
  created_at: iso(i.created_at),
  updated_at: iso(i.updated_at),
});

export interface UsageLedgerRow {
  id: string;
  workspace_id: string;
  period: string;
  audio_ms: number;
  ai_cost_microusd: number;
  storage_bytes: number;
  updated_at: number;
}

export const usageLedgerDto = (u: UsageLedgerRow) => ({ ...u, updated_at: iso(u.updated_at) });

export interface SavedViewRow {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  query_json: string;
  sort_key: string;
  created_at: number;
  updated_at: number;
}

export const savedViewDto = (v: SavedViewRow) => ({
  id: v.id,
  workspace_id: v.workspace_id,
  user_id: v.user_id,
  name: v.name,
  query: parseJson(v.query_json, {}),
  sort_key: v.sort_key,
  created_at: iso(v.created_at),
  updated_at: iso(v.updated_at),
});

export interface UploadRow {
  id: string;
  workspace_id: string;
  user_id: string;
  recording_id: string | null;
  status: "open" | "completed" | "aborted" | "expired";
  recorded_at: number | null;
  part_size: number;
  files_json: string;
  recording_json: string | null;
  source_client: string | null;
  idempotency_key: string | null;
  result_json: string | null;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
}

export const uploadSessionDto = (u: UploadRow, receivedParts: number[]) => ({
  id: u.id,
  workspace_id: u.workspace_id,
  recording_id: u.recording_id,
  status: u.status,
  recorded_at: isoOrNull(u.recorded_at),
  part_size: u.part_size,
  files: parseJson(u.files_json, []),
  received_parts: receivedParts,
  created_at: iso(u.created_at),
  expires_at: iso(u.expires_at),
});

// ---------------------------------------------------------------------------
// The queue's `job` table (packages/db schema.ts) -> domain Job
// ---------------------------------------------------------------------------

export interface QueueJobRow {
  id: string;
  workspace_id: string | null;
  owner_id: string;
  kind: string;
  subject_id: string | null;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  priority: number;
  run_after: number;
  attempts: number;
  lease_owner: string | null;
  lease_until: number | null;
  idempotency_key: string | null;
  error_code: string | null;
  budget_microusd: number | null;
  spent_microusd: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

/** v1 queue kinds -> domain JobKind (`distill` is the v1 pipeline: processing a recording). */
const JOB_KINDS: Record<string, string> = { distill: "process" };
const DOMAIN_JOB_KINDS = new Set(["process", "regenerate", "compact", "calendar_sync", "reminder", "maintenance", "index"]);

export function jobKindOf(kind: string): string {
  const mapped = JOB_KINDS[kind] ?? kind;
  return DOMAIN_JOB_KINDS.has(mapped) ? mapped : "maintenance";
}

/** Recording-subject jobs know their recording; `workspaceOf` resolves rows queued before P2 (no workspace_id). */
export function jobDto(j: QueueJobRow, recordingId: string | null, workspaceId: string | null) {
  return {
    id: j.id,
    workspace_id: workspaceId,
    recording_id: recordingId,
    kind: jobKindOf(j.kind),
    state: j.state,
    priority: j.priority,
    run_after: iso(j.run_after),
    attempts: j.attempts,
    lease_owner: j.lease_owner,
    lease_until: isoOrNull(j.lease_until),
    budget_microusd: j.budget_microusd,
    spent_microusd: j.spent_microusd,
    idempotency_key: j.idempotency_key,
    error_code: j.error_code ? j.error_code.slice(0, 64) : null,
    created_at: iso(j.created_at),
    updated_at: iso(j.finished_at ?? j.started_at ?? j.created_at),
  };
}
