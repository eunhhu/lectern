import type { z } from "zod";
import * as D from "../src/index.ts";

// Valid fixtures, typed against each schema's input so drift fails `tsc`.
// Invalid fixtures are `unknown` on purpose.

type In<T extends z.ZodType> = z.input<T>;

export const T0 = "2026-10-19T05:30:00.000Z";
export const T1 = "2026-10-19T08:10:00Z";
export const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

export const ID = {
  workspace: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a01",
  user: "usr_3b1f0c9e-6a52-4f6e-9d3a-0c8f2e7b1a44", // legacy v1 id format
  folder: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a02",
  tag: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a03",
  recording: "lec_4be2a1c9d0f3", // legacy v1 id format
  asset: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a05",
  pdf: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a06",
  speaker: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a07",
  document: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a08",
  documentVersion: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a09",
  question: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a10",
  event: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a11",
  actionItem: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a12",
  shareLink: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a13",
  job: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a14",
  stageRun: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a15",
  artifact: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a16",
  aiCall: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a17",
  authSession: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a18",
  accessToken: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a19",
  integration: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a20",
  usage: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a21",
  upload: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a22",
  savedView: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a23",
} as const;

const scope = { workspace_id: ID.workspace, recording_id: ID.recording } as const;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const workspace = {
  id: ID.workspace,
  name: "개인 워크스페이스",
  kind: "personal",
  plan: "free",
  settings: { calendar_auto_add: { enabled: false, min_confidence: 0.85 }, default_language: "ko" },
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Workspace>;

export const membership = {
  workspace_id: ID.workspace,
  user_id: ID.user,
  role: "owner",
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Membership>;

export const folder = {
  id: ID.folder,
  workspace_id: ID.workspace,
  parent_id: null,
  name: "암호학",
  sort_key: "a0",
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Folder>;

export const tag = {
  id: ID.tag,
  workspace_id: ID.workspace,
  name: "시험",
  color: "red",
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Tag>;

export const recordingTag = {
  ...scope,
  tag_id: ID.tag,
  source: "ai",
  confidence: 0.72,
  created_at: T0,
} satisfies In<typeof D.RecordingTag>;

export const recording = {
  id: ID.recording,
  workspace_id: ID.workspace,
  folder_id: ID.folder,
  title: "암호학 7주차: 블록 암호 운영 모드",
  domain: "lecture",
  template_id: "lecture",
  language: "ko",
  recorded_at: T0,
  recorded_at_source: "client",
  duration_ms: 4_980_000,
  status: "ready",
  created_by: ID.user,
  visibility: "private",
  created_at: T0,
  updated_at: T1,
} satisfies In<typeof D.Recording>;

export const asset = {
  id: ID.asset,
  ...scope,
  kind: "audio",
  part_index: 0,
  blob_key: `sha256/9f/${SHA}`,
  sha256: SHA,
  bytes: 48_211_009,
  mime: "audio/mp4",
  duration_ms: 4_980_000,
  page_count: null,
  meta: { channels: 1, sample_rate: 48000 },
  created_at: T0,
} satisfies In<typeof D.Asset>;

export const transcriptSegment = {
  ...scope,
  idx: 12,
  start_ms: 843_000,
  end_ms: 851_500,
  speaker_id: ID.speaker,
  text: "오늘은 대칭키 암호의 운영 모드를 보겠습니다.",
  confidence: 0.93,
  source_chunk: 2,
} satisfies In<typeof D.TranscriptSegment>;

export const speaker = {
  id: ID.speaker,
  ...scope,
  label: "S1",
  display_name: "김교수",
  confidence: 0.8,
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Speaker>;

export const transcriptRef = { kind: "transcript", start_idx: 12, end_idx: 14 } as const;
export const pdfRef = { kind: "pdf_page", asset_id: ID.pdf, page: 3 } as const;

export const documentBody = {
  sections: [
    {
      key: "summary",
      title: "핵심 요약",
      blocks: [
        { id: "b1", type: "paragraph", heading: null, text: "ECB는 같은 평문 블록을 같은 암호문으로 바꾼다.", sources: [transcriptRef] },
        {
          id: "b2",
          type: "list",
          heading: null,
          style: "bullet",
          items: [
            { text: "CBC는 IV가 필요하다.", sources: [transcriptRef] },
            { text: "CTR은 병렬화가 쉽다.", sources: [pdfRef] },
          ],
          sources: [],
        },
      ],
    },
    {
      key: "topics",
      title: "주제별 상세",
      blocks: [
        { id: "b3", type: "term", heading: "운영 모드", term: "IV", definition: "초기화 벡터", sources: [transcriptRef] },
        { id: "b4", type: "formula", heading: null, expression: "C_i = E_K(P_i \\oplus C_{i-1})", explanation: null, sources: [pdfRef] },
        { id: "b5", type: "callout", heading: null, tone: "exam", text: "CBC 복호화 그림은 시험에 나온다.", sources: [transcriptRef] },
        { id: "b6", type: "quote", heading: null, text: "ECB는 절대 쓰지 마세요.", speaker: "S1", sources: [transcriptRef] },
        { id: "b7", type: "gap", heading: null, kind: "break", start_ms: 3_012_000, end_ms: 3_760_000, sources: [] },
      ],
    },
  ],
} satisfies In<typeof D.DocumentBody>;

export const document = {
  id: ID.document,
  ...scope,
  template_id: "lecture",
  template_version: 1,
  current_version: 2,
  user_edited: true,
  created_at: T0,
  updated_at: T1,
} satisfies In<typeof D.Document>;

export const documentVersion = {
  id: ID.documentVersion,
  ...scope,
  document_id: ID.document,
  version: 2,
  base_version: 1,
  template_id: "lecture",
  template_version: 1,
  body: documentBody,
  rendered_md: "## 핵심 요약\n\nECB는 같은 평문 블록을 같은 암호문으로 바꾼다.\n",
  created_by: "user",
  author_id: ID.user,
  created_at: T1,
} satisfies In<typeof D.DocumentVersion>;

export const legacyDocumentVersion = {
  ...documentVersion,
  version: 1,
  base_version: null,
  template_id: "legacy-markdown",
  body: null,
  created_by: "ai",
  author_id: null,
} satisfies In<typeof D.DocumentVersion>;

export const question = {
  id: ID.question,
  ...scope,
  kind: "recall",
  prompt: "ECB 모드가 위험한 이유는?",
  answer: "같은 평문 블록이 같은 암호문 블록이 되어 패턴이 드러난다.",
  sources: [transcriptRef, pdfRef],
  difficulty: "medium",
  flags: [],
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Question>;

export const eventCandidate = {
  id: ID.event,
  ...scope,
  kind: "deadline",
  title: "과제 3 제출",
  start_at: "2026-10-27T00:00:00.000Z",
  end_at: null,
  all_day: false,
  tz: "Asia/Seoul",
  raw_expression: "다음 주 화요일 수업 전까지",
  resolution: { method: "parser", rule: "next_week_weekday" },
  confidence: 0.88,
  evidence: { sources: [{ kind: "transcript", start_idx: 311, end_idx: 311 }], quote: "다음 주 화요일까지 제출" },
  flags: [],
  status: "suggested",
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.EventCandidate>;

export const actionItem = {
  id: ID.actionItem,
  ...scope,
  text: "회의록 공유",
  owner_name: "민지",
  due_at: null,
  due_raw: "이번 주 안에",
  status: "open",
  evidence: { sources: [transcriptRef], quote: null },
  flags: ["needs_review"],
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.ActionItem>;

export const shareLink = {
  id: ID.shareLink,
  workspace_id: ID.workspace,
  target_type: "document",
  target_id: ID.document,
  token_hash: SHA,
  scope: { transcript: true, audio: false },
  expires_at: null,
  password_hash: null,
  created_by: ID.user,
  created_at: T0,
  revoked_at: null,
} satisfies In<typeof D.ShareLink>;

export const job = {
  id: ID.job,
  ...scope,
  kind: "process",
  state: "running",
  priority: 0,
  run_after: T0,
  attempts: 1,
  lease_owner: "worker-1",
  lease_until: T1,
  budget_microusd: 420_000,
  spent_microusd: 61_000,
  idempotency_key: "upload-0192a3b4",
  error_code: null,
  created_at: T0,
  updated_at: T1,
} satisfies In<typeof D.Job>;

export const maintenanceJob = {
  ...job,
  workspace_id: null,
  recording_id: null,
  kind: "maintenance",
  budget_microusd: null,
  spent_microusd: 0,
  idempotency_key: null,
} satisfies In<typeof D.Job>;

export const stageRun = {
  id: ID.stageRun,
  workspace_id: ID.workspace,
  job_id: ID.job,
  stage: "transcribe",
  chunk_index: 2,
  state: "failed",
  input_hash: SHA,
  output_artifact_ids: [ID.artifact],
  cache_hit: false,
  attempts: 2,
  started_at: T0,
  finished_at: T1,
  error: { class: "output_validation", code: "repetition_loop", message: "n-gram repeated 40 times" },
  created_at: T0,
} satisfies In<typeof D.StageRun>;

export const artifact = {
  id: ID.artifact,
  workspace_id: ID.workspace,
  kind: "chunk_manifest",
  blob_key: `sha256/9f/${SHA}`,
  sha256: SHA,
  bytes: 2048,
  produced_by_stage_run: ID.stageRun,
  created_at: T0,
  expires_at: null,
} satisfies In<typeof D.Artifact>;

export const aiCall = {
  id: ID.aiCall,
  workspace_id: ID.workspace,
  stage_run_id: ID.stageRun,
  recording_id: ID.recording,
  provider: "gemini",
  model: "gemini-3.8-flash",
  model_version: "gemini-3.8-flash-001",
  input_tokens: 14_400,
  cached_tokens: 0,
  output_tokens: 3_100,
  audio_seconds: 450,
  cost_microusd: 22_425,
  latency_ms: 18_400,
  status: "ok",
  request_id: "req_7f3",
  error_code: null,
  created_at: T0,
} satisfies In<typeof D.AiCall>;

export const authSession = {
  id: ID.authSession,
  workspace_id: ID.workspace,
  user_id: ID.user,
  client: "native",
  token_hash: SHA,
  refresh_hash: SHA,
  device_name: "MacBook Pro",
  user_agent: "Lectern/2.0 (macOS 27.0)",
  ip_hash: SHA,
  created_at: T0,
  last_seen_at: T1,
  expires_at: "2026-11-18T05:30:00.000Z",
  revoked_at: null,
} satisfies In<typeof D.AuthSession>;

export const accessToken = {
  id: ID.accessToken,
  workspace_id: ID.workspace,
  user_id: ID.user,
  name: "iOS 단축어",
  prefix: "lpat_ab12",
  token_hash: SHA,
  scopes: ["recordings:write"],
  expires_at: null,
  last_used_at: T1,
  created_at: T0,
  revoked_at: null,
} satisfies In<typeof D.AccessToken>;

export const integration = {
  id: ID.integration,
  workspace_id: ID.workspace,
  user_id: ID.user,
  provider: "google",
  scopes: ["https://www.googleapis.com/auth/calendar.app.created"],
  token_enc: "v1:gcm:3q2+7w==",
  calendar_id: "abc123@group.calendar.google.com",
  status: "active",
  created_at: T0,
  updated_at: T0,
} satisfies In<typeof D.Integration>;

export const usageLedger = {
  id: ID.usage,
  workspace_id: ID.workspace,
  period: "2026-10",
  audio_ms: 18_000_000,
  ai_cost_microusd: 1_050_000,
  storage_bytes: 912_000_000,
  updated_at: T1,
} satisfies In<typeof D.UsageLedger>;

export const savedView = {
  id: ID.savedView,
  workspace_id: ID.workspace,
  user_id: ID.user,
  name: "이번 주 시험",
  query: { tag_ids: [ID.tag], recorded_after: T0, sort: "recorded_at_asc" },
  sort_key: "m",
  created_at: T0,
  updated_at: T1,
} satisfies In<typeof D.SavedView>;

export const ENTITY_FIXTURES: Record<D.EntityName, unknown[]> = {
  workspace: [workspace],
  membership: [membership],
  folder: [folder, { ...folder, parent_id: ID.folder }],
  tag: [tag],
  recording_tag: [recordingTag, { ...recordingTag, source: "user", confidence: null }],
  recording: [recording, { ...recording, folder_id: null, template_id: null, duration_ms: null, recorded_at_source: "upload" }],
  asset: [asset, { ...asset, kind: "pdf", mime: "application/pdf", duration_ms: null, page_count: 42 }],
  transcript_segment: [transcriptSegment, { ...transcriptSegment, speaker_id: null, confidence: null, start_ms: 0, end_ms: 0 }],
  speaker: [speaker, { ...speaker, display_name: null, confidence: null }],
  document: [document],
  document_version: [documentVersion, legacyDocumentVersion],
  question: [question],
  event_candidate: [eventCandidate, { ...eventCandidate, all_day: true, end_at: "2026-10-27T15:00:00.000Z" }],
  action_item: [actionItem],
  share_link: [shareLink, { ...shareLink, target_type: "recording", target_id: ID.recording, password_hash: "scrypt$abc$def" }],
  job: [job, maintenanceJob],
  stage_run: [stageRun, { ...stageRun, workspace_id: null, error: null, state: "succeeded", chunk_index: null }],
  artifact: [artifact],
  ai_call: [aiCall, { ...aiCall, status: "empty", output_tokens: 0, model_version: null }],
  auth_session: [authSession, { ...authSession, client: "web", refresh_hash: null }],
  access_token: [accessToken],
  integration: [integration],
  usage_ledger: [usageLedger],
  saved_view: [savedView, { ...savedView, query: {} }],
};

/** Hand-written invalid rows; the tests also drop every required key of each valid fixture. */
export const ENTITY_INVALID: Record<D.EntityName, unknown[]> = {
  workspace: [{ ...workspace, kind: "org" }, { ...workspace, settings: { calendar_auto_add: { enabled: true, min_confidence: 2 } } }],
  membership: [{ ...membership, role: "guest" }],
  folder: [{ ...folder, name: "" }],
  tag: [{ ...tag, color: "#ff0000" }],
  recording_tag: [{ ...recordingTag, source: "model" }],
  recording: [
    { ...recording, recorded_at: "2026-10-19T14:30:00+09:00" }, // offsets are not UTC
    { ...recording, status: "done" },
    { ...recording, workspace_id: "not an id" },
    { ...recording, domain: "lecture-hall" },
  ],
  asset: [{ ...asset, sha256: SHA.toUpperCase() }, { ...asset, part_index: -1 }],
  transcript_segment: [{ ...transcriptSegment, end_ms: 842_999 }, { ...transcriptSegment, idx: 1.5 }],
  speaker: [{ ...speaker, label: "Speaker 1" }],
  document: [{ ...document, current_version: 0 }],
  document_version: [
    { ...documentVersion, body: { sections: [{ key: "summary", title: "요약", blocks: [{ id: "b1", type: "video", sources: [] }] }] } },
    {
      ...documentVersion,
      body: {
        sections: [
          {
            key: "summary",
            title: "요약",
            blocks: [{ id: "b1", type: "paragraph", heading: null, text: "x", sources: [{ kind: "transcript", start_idx: 5, end_idx: 4 }] }],
          },
        ],
      },
    },
    { ...documentVersion, body: { sections: [{ key: "Summary!", title: "요약", blocks: [] }] } },
  ],
  question: [{ ...question, kind: "trivia" }, { ...question, sources: [{ kind: "pdf_page", asset_id: ID.pdf, page: 0 }] }],
  event_candidate: [
    { ...eventCandidate, confidence: 1.5 },
    { ...eventCandidate, status: "maybe" },
    { ...eventCandidate, tz: "+09:00" },
    { ...eventCandidate, evidence: { sources: [] } },
  ],
  action_item: [{ ...actionItem, status: "closed" }],
  share_link: [{ ...shareLink, scope: "document" }],
  job: [{ ...job, state: "paused" }, { ...job, spent_microusd: -1 }],
  stage_run: [{ ...stageRun, stage: "summarize" }, { ...stageRun, error: { class: "boom", code: "x", message: "" } }],
  artifact: [{ ...artifact, kind: "Chunk Manifest" }],
  ai_call: [{ ...aiCall, status: "timeout" }, { ...aiCall, cost_microusd: 0.5 }],
  auth_session: [{ ...authSession, client: "cli" }],
  access_token: [{ ...accessToken, scopes: [] }, { ...accessToken, scopes: ["admin"] }],
  integration: [{ ...integration, provider: "outlook" }],
  usage_ledger: [{ ...usageLedger, period: "2026-13" }, { ...usageLedger, period: "2026-10-01" }],
  saved_view: [{ ...savedView, query: { sort: "newest" } }, { ...savedView, query: { tag_ids: ["not an id"] } }],
};

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

const page = <T>(items: T[]) => ({ items, next_cursor: null });

const me = {
  id: ID.user,
  email: "student@example.com",
  display_name: "학생",
  timezone: "Asia/Seoul",
  system_role: "member",
  personal_workspace_id: ID.workspace,
} satisfies In<typeof D.Me>;

const { token_hash: _t, refresh_hash: _r, ip_hash: _i, ...deviceBase } = authSession;
const device = { ...deviceBase, current: true } satisfies In<typeof D.DeviceDto>;
const { token_hash: _a, ...accessTokenDto } = accessToken;
const { token_enc: _e, ...integrationDto } = integration;
const { token_hash: _s, password_hash: _p, ...shareLinkBase } = shareLink;
const shareLinkDto = { ...shareLinkBase, has_password: false } satisfies In<typeof D.ShareLinkDto>;
const { blob_key: _b, ...assetDto } = asset;
const { body: _body, rendered_md: _md, ...versionSummary } = documentVersion;

const uploadSession = {
  id: ID.upload,
  workspace_id: ID.workspace,
  recording_id: null,
  status: "open",
  recorded_at: T0,
  part_size: 8_388_608,
  files: [
    { index: 0, kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: 48_211_009, first_part: 1, part_count: 6 },
    { index: 1, kind: "pdf", filename: "week7.pdf", mime: "application/pdf", bytes: 1_200_000, sha256: SHA, first_part: 7, part_count: 1 },
  ],
  received_parts: [1, 2, 3],
  created_at: T0,
  expires_at: "2026-10-20T05:30:00.000Z",
} satisfies In<typeof D.UploadSession>;

const createUpload = {
  workspace_id: ID.workspace,
  recording: { title: "암호학 7주차", domain: "lecture", folder_id: ID.folder, tag_ids: [ID.tag] },
  recorded_at: T0,
  files: [
    { kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: 48_211_009 },
    { kind: "pdf", filename: "week7.pdf", mime: "application/pdf", bytes: 1_200_000, sha256: SHA },
  ],
} satisfies In<typeof D.CreateUploadRequest>;

const envelope = { id: "1042", workspace_id: ID.workspace, recording_id: ID.recording, created_at: T0 } as const;

export const SERVER_EVENTS = [
  { ...envelope, type: "recording.created", payload: { recording } },
  { ...envelope, type: "recording.updated", payload: { recording } },
  { ...envelope, type: "recording.deleted", payload: { recording_id: ID.recording } },
  {
    ...envelope,
    type: "job.progress",
    payload: { job_id: ID.job, stage: "transcribe", state: "running", progress: 0.4, chunk_index: 3, chunk_count: 9 },
  },
  { ...envelope, type: "job.updated", payload: { job } },
  { ...envelope, type: "transcript.ready", payload: { segment_count: 1240 } },
  { ...envelope, type: "document.updated", payload: { document_id: ID.document, version: 2 } },
  { ...envelope, type: "calendar.suggested", payload: { event_candidate_ids: [ID.event] } },
] satisfies In<typeof D.ServerEvent>[];

// Ask (ADR-0009)
export const askThreadId = "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a30";
export const askTurnId = "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a31";

export const askThread = {
  id: askThreadId,
  workspace_id: ID.workspace,
  user_id: ID.user,
  scope: { kind: "recording", recording_id: ID.recording },
  title: "ECB가 왜 위험해?",
  turn_count: 1,
  created_at: T0,
  updated_at: T1,
} satisfies In<typeof D.AskThread>;

export const askTranscriptCitation = {
  kind: "transcript",
  label: "c1",
  chunk_id: "chk_3f9a0b1c2d3e4f5a",
  recording_id: ID.recording,
  recording_title: recording.title,
  snippet: "ECB는 같은 평문 블록을 같은 암호문으로 바꿔요.",
  support: "supported",
  available: true,
  start_idx: 13,
  end_idx: 14,
  start_ms: 843_000,
  end_ms: 871_500,
} satisfies In<typeof D.AskCitation>;

export const askDocumentCitation = {
  kind: "document",
  label: "c2",
  chunk_id: "chk_9e8d7c6b5a4f3e2d",
  recording_id: ID.recording,
  recording_title: recording.title,
  snippet: "CBC 복호화 그림은 시험에 나온다.",
  support: "weak",
  available: true,
  document_id: ID.document,
  document_version: 2,
  block_id: "b5",
  section_title: "주제별 상세",
  start_ms: 843_000,
  sources: [transcriptRef],
} satisfies In<typeof D.AskCitation>;

export const askTurn = {
  id: askTurnId,
  thread_id: askThreadId,
  workspace_id: ID.workspace,
  idx: 0,
  question: "ECB가 왜 위험해?",
  answer: "같은 평문 블록이 같은 암호문이 되어 패턴이 드러나기 때문입니다 [c1]. 시험에도 나온다고 했습니다 [c2].",
  citations: [askTranscriptCitation, askDocumentCitation],
  status: "completed",
  outcome: "answered",
  mode: "full_note",
  cached: false,
  cost_microusd: 2_400,
  error: null,
  created_at: T0,
  completed_at: T0,
} satisfies In<typeof D.AskTurn>;

export const askStreamEvents = [
  { type: "turn.started", thread_id: askThreadId, turn_id: askTurnId, idx: 0, created_at: T0 },
  { type: "retrieval", mode: "retrieval", passage_count: 8, recording_count: 3 },
  { type: "tool", name: "search_notes", state: "started" },
  { type: "answer.delta", text: "같은 평문 블록이 " },
  { type: "citation", citation: { ...askTranscriptCitation, support: null } },
  { type: "turn.completed", turn: askTurn },
  { type: "error", error: { code: "budget_exceeded", message: "질문 한 번에 쓸 수 있는 비용을 넘었습니다." } },
] satisfies In<typeof D.AskStreamEvent>[];

export interface Case {
  schema: z.ZodType;
  valid: unknown[];
  invalid: unknown[];
}

/** Every published request/response body, keyed by OpenAPI component id. */
export const API_CASES: Record<string, Case> = {
  BatchRecordingsRequest: {
    schema: D.BatchRecordingsRequest,
    valid: [
      { action: "move", recording_ids: [ID.recording], folder_id: null },
      { action: "add_tags", recording_ids: [ID.recording], tag_ids: [ID.tag] },
      { action: "delete", recording_ids: [ID.recording] },
    ],
    invalid: [{ action: "move", recording_ids: [], folder_id: null }, { action: "archive", recording_ids: [ID.recording] }, { action: "add_tags", recording_ids: [ID.recording], tag_ids: [] }],
  },
  BatchRecordingsResponse: {
    schema: D.BatchRecordingsResponse,
    valid: [{ results: [{ recording_id: ID.recording, ok: true, error: null }, { recording_id: ID.recording, ok: false, error: { code: "not_found", message: "녹음을 찾을 수 없습니다." } }] }],
    invalid: [{ results: [{ recording_id: ID.recording, ok: false }] }],
  },
  SavedView: { schema: D.SavedView, valid: [savedView], invalid: [{ ...savedView, name: "" }] },
  SavedViewPage: { schema: D.SavedViewPage, valid: [page([savedView])], invalid: [{ items: [savedView] }] },
  CreateSavedViewRequest: {
    schema: D.CreateSavedViewRequest,
    valid: [{ workspace_id: ID.workspace, name: "시험", query: { status: "ready" } }],
    invalid: [{ workspace_id: ID.workspace, name: "시험" }],
  },
  UpdateSavedViewRequest: { schema: D.UpdateSavedViewRequest, valid: [{}, { name: "새 이름", query: {} }], invalid: [{ name: "" }] },
  ApiError: {
    schema: D.ApiError,
    valid: [
      { error: { code: "not_found", message: "녹음을 찾을 수 없습니다." } },
      { error: { code: "validation_failed", message: "잘못된 요청", details: { issues: [{ path: ["title"], message: "Required" }] } } },
    ],
    invalid: [{ error: { code: "teapot", message: "x" } }, { code: "not_found", message: "flat shape" }],
  },
  Me: { schema: D.Me, valid: [me], invalid: [{ ...me, email: "nope" }, { ...me, timezone: "KST+9" }] },
  UpdateMeRequest: { schema: D.UpdateMeRequest, valid: [{}, { timezone: "Europe/Berlin" }], invalid: [{ display_name: "" }] },
  DevicePage: { schema: D.DevicePage, valid: [page([device])], invalid: [{ items: [device] }] },
  AccessTokenPage: { schema: D.AccessTokenPage, valid: [page([accessTokenDto])], invalid: [page([{ ...accessTokenDto, scopes: [] }])] },
  CreateAccessTokenRequest: {
    schema: D.CreateAccessTokenRequest,
    valid: [{ workspace_id: ID.workspace, name: "단축어", scopes: ["recordings:write"] }, { workspace_id: ID.workspace, name: "CI", scopes: ["recordings:read"], expires_at: null }],
    invalid: [{ workspace_id: ID.workspace, name: "단축어", scopes: [] }, { name: "no workspace", scopes: ["recordings:read"] }],
  },
  CreatedAccessToken: {
    schema: D.CreatedAccessToken,
    valid: [{ token: accessTokenDto, secret: "lpat_ab12cd34ef56gh78ij90" }],
    invalid: [{ token: accessTokenDto, secret: "short" }],
  },
  MyWorkspacePage: { schema: D.MyWorkspacePage, valid: [page([{ workspace, role: "owner" }])], invalid: [page([{ workspace, role: "boss" }])] },
  Workspace: { schema: D.Workspace, valid: [workspace], invalid: [{ ...workspace, plan: "Free Plan" }] },
  CreateWorkspaceRequest: { schema: D.CreateWorkspaceRequest, valid: [{ name: "연구실" }], invalid: [{ name: "" }] },
  UpdateWorkspaceRequest: {
    schema: D.UpdateWorkspaceRequest,
    valid: [{ settings: {} }, { name: "새 이름" }],
    invalid: [{ settings: { default_language: "Korean" } }],
  },
  WorkspaceMemberPage: {
    schema: D.WorkspaceMemberPage,
    valid: [page([{ ...membership, display_name: "학생", email: "student@example.com" }])],
    invalid: [page([membership])],
  },
  FolderPage: { schema: D.FolderPage, valid: [page([folder])], invalid: [page([{ ...folder, id: "" }])] },
  Folder: { schema: D.Folder, valid: [folder], invalid: [{ ...folder, sort_key: "" }] },
  CreateFolderRequest: {
    schema: D.CreateFolderRequest,
    valid: [{ workspace_id: ID.workspace, name: "과목" }, { workspace_id: ID.workspace, name: "하위", parent_id: ID.folder, sort_key: "a1" }],
    invalid: [{ name: "no workspace" }],
  },
  UpdateFolderRequest: { schema: D.UpdateFolderRequest, valid: [{ parent_id: null }, {}], invalid: [{ name: "" }] },
  TagPage: { schema: D.TagPage, valid: [page([tag])], invalid: [page([{ ...tag, color: "rgb(0,0,0)" }])] },
  Tag: { schema: D.Tag, valid: [tag], invalid: [{ ...tag, name: "" }] },
  CreateTagRequest: { schema: D.CreateTagRequest, valid: [{ workspace_id: ID.workspace, name: "과제", color: "blue" }], invalid: [{ workspace_id: ID.workspace, name: "과제" }] },
  UpdateTagRequest: { schema: D.UpdateTagRequest, valid: [{ color: "green" }], invalid: [{ color: "#00ff00" }] },
  CreateUploadRequest: {
    schema: D.CreateUploadRequest,
    valid: [
      createUpload,
      { workspace_id: ID.workspace, files: [{ kind: "audio", filename: "a.wav", mime: "audio/wav", bytes: 1 }] },
      { workspace_id: ID.workspace, recording_id: ID.recording, files: [{ kind: "pdf", filename: "b.pdf", mime: "application/pdf", bytes: 10 }] },
    ],
    invalid: [
      { ...createUpload, files: [] },
      { ...createUpload, recording_id: ID.recording }, // recording and recording_id together
      { workspace_id: ID.workspace, files: [{ kind: "pdf", filename: "b.pdf", mime: "application/pdf", bytes: 10 }] }, // new recording without audio
      { ...createUpload, recorded_at: "2026-10-19 05:30:00" },
      { ...createUpload, files: [{ kind: "audio", filename: "a.wav", mime: "audio/wav", bytes: 0 }] },
    ],
  },
  UploadSession: { schema: D.UploadSession, valid: [uploadSession], invalid: [{ ...uploadSession, status: "pending" }, { ...uploadSession, received_parts: [0] }] },
  UploadPartReceipt: { schema: D.UploadPartReceipt, valid: [{ part: 1, bytes: 8_388_608, sha256: SHA }], invalid: [{ part: 0, bytes: 1, sha256: SHA }] },
  CompleteUploadResponse: {
    schema: D.CompleteUploadResponse,
    valid: [
      { upload: { ...uploadSession, status: "completed", recording_id: ID.recording }, recording: { ...recording, status: "queued" }, job, deduplicated: false },
      { upload: { ...uploadSession, status: "completed", recording_id: ID.recording }, recording, job: null, deduplicated: true },
    ],
    invalid: [{ upload: uploadSession, recording, job: null }],
  },
  RecordingPage: {
    schema: D.RecordingPage,
    valid: [
      page([{ ...recording, tag_ids: [ID.tag] }]),
      { items: [], next_cursor: "eyJrIjoxfQ" },
      page([
        {
          ...recording,
          tag_ids: [],
          excerpt: "스케줄링 정리",
          audio_bytes: 1024,
          pdf_count: 1,
          unverified_count: 0,
          progress: { job_id: ID.job, state: "running", stage: "legacy_distill", stage_state: "running", progress: 0.4, message: "노트 정리 중...", queue_position: null },
        },
      ]),
    ],
    invalid: [page([recording]), { items: [], next_cursor: "" }],
  },
  RecordingDetail: {
    schema: D.RecordingDetail,
    valid: [
      { recording, tags: [recordingTag], assets: [assetDto], speakers: [speaker], documents: [document], active_job: null },
      {
        recording: { ...recording, status: "failed" },
        tags: [],
        assets: [],
        speakers: [],
        documents: [],
        active_job: null,
        progress: null,
        failure: { code: "legacy_error", message: "Gemini 응답이 비었습니다.", job_id: null, failed_at: T1 },
      },
    ],
    invalid: [{ recording, tags: [], assets: [], speakers: [], documents: [] }],
  },
  Recording: { schema: D.Recording, valid: [recording], invalid: [{ ...recording, visibility: "public" }] },
  UpdateRecordingRequest: {
    schema: D.UpdateRecordingRequest,
    valid: [{ folder_id: null, tag_ids: [] }, { recorded_at: T1, visibility: "workspace", template_id: "meeting" }],
    invalid: [{ recorded_at: "yesterday" }, { template_id: "Meeting Notes" }],
  },
  Transcript: {
    schema: D.Transcript,
    valid: [
      {
        recording_id: ID.recording,
        segments: [transcriptSegment],
        speakers: [speaker],
        gaps: [{ kind: "break", start_ms: 3_012_000, end_ms: 3_760_000 }, { kind: "missing_transcript", start_ms: 4_000_000, end_ms: 4_300_000 }],
      },
    ],
    invalid: [{ recording_id: ID.recording, segments: [], speakers: [], gaps: [{ kind: "break", start_ms: 10, end_ms: 5 }] }],
  },
  Speaker: { schema: D.Speaker, valid: [speaker], invalid: [{ ...speaker, label: "s1" }] },
  UpdateSpeakerRequest: { schema: D.UpdateSpeakerRequest, valid: [{ display_name: "조교" }, { display_name: null }], invalid: [{}] },
  DocumentPage: { schema: D.DocumentPage, valid: [page([document])], invalid: [page([{ ...document, template_version: 0 }])] },
  QuestionPage: { schema: D.QuestionPage, valid: [page([question])], invalid: [page([{ ...question, difficulty: "trivial" }])] },
  EventCandidatePage: { schema: D.EventCandidatePage, valid: [page([eventCandidate])], invalid: [page([{ ...eventCandidate, all_day: "yes" }])] },
  ActionItemPage: { schema: D.ActionItemPage, valid: [page([actionItem])], invalid: [page([{ ...actionItem, evidence: [] }])] },
  ReprocessRequest: {
    schema: D.ReprocessRequest,
    valid: [{ mode: "document", template_id: "meeting" }, { mode: "full", dry_run: true }],
    invalid: [{ mode: "transcribe" }, {}],
  },
  ReprocessResponse: {
    schema: D.ReprocessResponse,
    valid: [
      { estimate: { estimated_microusd: 210_000, audio_ms: 4_980_000, within_quota: true }, job: null },
      { estimate: { estimated_microusd: 50_000, audio_ms: 0, within_quota: true }, job },
    ],
    invalid: [{ estimate: { estimated_microusd: -1, audio_ms: 0, within_quota: true }, job: null }],
  },
  Asset: { schema: D.AssetDto, valid: [assetDto], invalid: [{ ...assetDto, kind: "video" }] },
  DocumentWithVersion: {
    schema: D.DocumentWithVersion,
    valid: [{ document, version: documentVersion }],
    invalid: [{ document, version: { ...documentVersion, created_by: "robot" } }],
  },
  DocumentVersionPage: { schema: D.DocumentVersionPage, valid: [page([versionSummary])], invalid: [page([{ ...versionSummary, version: 0 }])] },
  DocumentVersion: { schema: D.DocumentVersion, valid: [documentVersion, legacyDocumentVersion], invalid: [{ ...documentVersion, rendered_md: null }] },
  CreateDocumentVersionRequest: {
    schema: D.CreateDocumentVersionRequest,
    valid: [{ body: documentBody }, { body: { sections: [] } }],
    invalid: [{ body: null }, { body: { sections: [{ key: "summary", title: "", blocks: [] }] } }],
  },
  ActionItem: { schema: D.ActionItem, valid: [actionItem], invalid: [{ ...actionItem, text: "" }] },
  UpdateActionItemRequest: { schema: D.UpdateActionItemRequest, valid: [{ status: "done" }, { due_at: null, owner_name: null }], invalid: [{ status: "finished" }] },
  Job: { schema: D.Job, valid: [job, maintenanceJob], invalid: [{ ...job, kind: "transcode" }] },
  AskThread: {
    schema: D.AskThread,
    valid: [askThread, { ...askThread, scope: { kind: "folder", folder_id: ID.folder, include_subfolders: true } }, { ...askThread, scope: { kind: "workspace" } }],
    invalid: [{ ...askThread, scope: { kind: "folder", folder_id: ID.folder } }, { ...askThread, title: "" }],
  },
  AskThreadPage: { schema: D.AskThreadPage, valid: [page([askThread]), page([])], invalid: [page([{ ...askThread, scope: { kind: "recording" } }])] },
  AskThreadDetail: {
    schema: D.AskThreadDetail,
    valid: [
      { thread: askThread, turns: [askTurn] },
      {
        thread: askThread,
        turns: [
          {
            ...askTurn,
            answer: null,
            citations: [],
            status: "failed",
            outcome: null,
            mode: null,
            cost_microusd: 0,
            error: { code: "quota_exceeded", message: "이번 달 물어보기 한도를 다 썼습니다." },
            completed_at: T0,
          },
          { ...askTurn, idx: 1, citations: [{ ...askTranscriptCitation, available: false, snippet: "" }], cached: true, cost_microusd: 0 },
          { ...askTurn, idx: 2, answer: "노트에서 관련 내용을 찾지 못했습니다.", citations: [], outcome: "no_answer" },
          {
            ...askTurn,
            idx: 3,
            citations: [{ kind: "pdf_page", label: "c1", chunk_id: "chk_1", recording_id: ID.recording, recording_title: "x", snippet: "", support: null, available: true, asset_id: ID.pdf, page: 3 }],
          },
        ],
      },
    ],
    invalid: [
      { thread: askThread, turns: [{ ...askTurn, citations: [{ ...askTranscriptCitation, label: "1" }] }] },
      { thread: askThread, turns: [{ ...askTurn, outcome: "maybe" }] },
      { thread: askThread, turns: [{ ...askTurn, citations: [{ ...askDocumentCitation, document_version: 0 }] }] },
    ],
  },
  CreateAskThreadRequest: {
    schema: D.CreateAskThreadRequest,
    valid: [{ workspace_id: ID.workspace, scope: { kind: "workspace" } }, { workspace_id: ID.workspace, scope: { kind: "recording", recording_id: ID.recording } }],
    invalid: [{ workspace_id: ID.workspace, scope: { kind: "tag" } }, { workspace_id: ID.workspace }],
  },
  AskQuestionRequest: {
    schema: D.AskQuestionRequest,
    valid: [{ question: "시험 범위가 어디까지야?" }],
    invalid: [{ question: "" }, { question: "가".repeat(D.ASK_QUESTION_MAX_CHARS + 1) }],
  },
  AskUsage: {
    schema: D.AskUsage,
    valid: [
      { workspace_id: ID.workspace, period: "2026-10", turn_count: 12, spent_microusd: 31_000, limit_microusd: 2_000_000, per_turn_cap_microusd: 20_000 },
      { workspace_id: ID.workspace, period: "2026-10", turn_count: 0, spent_microusd: 0, limit_microusd: null, per_turn_cap_microusd: 20_000 },
    ],
    invalid: [{ workspace_id: ID.workspace, period: "2026-13", turn_count: 0, spent_microusd: 0, limit_microusd: null, per_turn_cap_microusd: 0 }],
  },
  AskStreamEvent: {
    schema: D.AskStreamEvent,
    valid: askStreamEvents,
    invalid: [{ type: "answer.delta" }, { type: "retrieval", mode: "everything", passage_count: 1, recording_count: 1 }, { type: "tool", name: "", state: "started" }],
  },
  SearchHitPage: {
    schema: D.SearchHitPage,
    valid: [
      page([
        { kind: "transcript", recording_id: ID.recording, recording_title: recording.title, snippet: [{ text: "대칭키 ", highlight: false }, { text: "암호", highlight: true }], segment_idx: 12, start_ms: 843_000 },
        { kind: "document", recording_id: ID.recording, recording_title: recording.title, snippet: [{ text: "ECB", highlight: true }], document_id: ID.document, block_id: "b1" },
        { kind: "pdf_page", recording_id: ID.recording, recording_title: recording.title, snippet: [], asset_id: ID.pdf, page: 3 },
      ]),
    ],
    invalid: [page([{ kind: "audio", recording_id: ID.recording, recording_title: "x", snippet: [] }]), page([{ kind: "pdf_page", recording_id: ID.recording, recording_title: "x", snippet: [], asset_id: ID.pdf, page: 0 }])],
  },
  EventCandidate: { schema: D.EventCandidate, valid: [eventCandidate], invalid: [{ ...eventCandidate, raw_expression: "" }] },
  UpdateEventCandidateRequest: {
    schema: D.UpdateEventCandidateRequest,
    valid: [{ status: "accepted" }, { start_at: T1, end_at: null, all_day: false, title: "수정" }],
    invalid: [{ status: "synced" }, { start_at: "2026-10-19" }],
  },
  BatchEventCandidatesRequest: {
    schema: D.BatchEventCandidatesRequest,
    valid: [{ event_candidate_ids: [ID.event], action: "accept" }],
    invalid: [{ event_candidate_ids: [], action: "accept" }, { event_candidate_ids: [ID.event], action: "sync" }],
  },
  EventCandidateList: { schema: D.EventCandidateList, valid: [{ items: [eventCandidate] }], invalid: [{ items: [{ ...eventCandidate, kind: "party" }] }] },
  IntegrationPage: { schema: D.IntegrationPage, valid: [page([integrationDto])], invalid: [page([{ ...integrationDto, status: "ok" }])] },
  StartGoogleIntegrationRequest: {
    schema: D.StartGoogleIntegrationRequest,
    valid: [{ workspace_id: ID.workspace }, { workspace_id: ID.workspace, return_to: "/settings/integrations" }],
    invalid: [{ workspace_id: ID.workspace, return_to: "https://evil.example/" }, { workspace_id: ID.workspace, return_to: "//evil.example" }],
  },
  StartGoogleIntegrationResponse: {
    schema: D.StartGoogleIntegrationResponse,
    valid: [{ authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x" }],
    invalid: [{ authorization_url: "not a url" }],
  },
  ShareLinkPage: { schema: D.ShareLinkPage, valid: [page([shareLinkDto])], invalid: [page([shareLink])] },
  ShareLink: { schema: D.ShareLinkDto, valid: [shareLinkDto], invalid: [{ ...shareLinkDto, target_type: "folder" }] },
  CreateShareLinkRequest: {
    schema: D.CreateShareLinkRequest,
    valid: [
      { target_type: "document", target_id: ID.document, scope: { transcript: false, audio: false } },
      { target_type: "recording", target_id: ID.recording, scope: { transcript: true, audio: true }, expires_at: T1, password: "correct horse" },
    ],
    invalid: [{ target_type: "document", target_id: ID.document, scope: { transcript: false, audio: false }, password: "short" }],
  },
  CreatedShareLink: {
    schema: D.CreatedShareLink,
    valid: [{ link: shareLinkDto, url: "https://lectern.qucord.com/s/Zx81kP2" }],
    invalid: [{ link: shareLinkDto, url: "/s/relative" }],
  },
  UpdateShareLinkRequest: { schema: D.UpdateShareLinkRequest, valid: [{ password: null }, { expires_at: T1 }], invalid: [{ scope: { transcript: "yes", audio: false } }] },
  ServerEvent: {
    schema: D.ServerEvent,
    valid: SERVER_EVENTS,
    invalid: [
      { ...envelope, type: "recording.renamed", payload: {} },
      { ...envelope, type: "job.progress", payload: { job_id: ID.job, stage: "transcribe", state: "running", progress: 1.2, chunk_index: null, chunk_count: null } },
      { ...envelope, id: "", type: "transcript.ready", payload: { segment_count: 1 } },
      { ...envelope, type: "calendar.suggested", payload: { event_candidate_ids: [] } },
    ],
  },
  JobPage: { schema: D.JobPage, valid: [page([job, maintenanceJob])], invalid: [page([{ ...job, attempts: -1 }])] },
  JobDetail: {
    schema: D.JobDetail,
    valid: [{ job, stage_runs: [stageRun], ai_calls: [aiCall] }],
    invalid: [{ job, stage_runs: [{ ...stageRun, input_hash: "abc" }], ai_calls: [] }],
  },
  UsageLedgerPage: { schema: D.UsageLedgerPage, valid: [page([usageLedger])], invalid: [page([{ ...usageLedger, audio_ms: -5 }])] },
};

// ---------------------------------------------------------------------------
// Harness outputs
// ---------------------------------------------------------------------------

export const transcribeResult = {
  segments: [
    { start_ms: 0, end_ms: 4_200, speaker: "S1", text: "오늘은 대칭키 암호의 운영 모드를 보겠습니다.", confidence: 0.94 },
    { start_ms: 4_200, end_ms: 9_000, speaker: "S2", text: "질문 있는데요, ECB가 왜 위험한가요?" },
  ],
  language: "ko",
} satisfies In<typeof D.TranscribeResult>;

export const lectureOutput = {
  sections: [
    {
      key: "summary",
      blocks: [{ type: "paragraph", heading: null, text: "운영 모드의 차이를 다뤘다.", sources: ["#12", "#40-#44"], pdf_pages: [3] }],
    },
    {
      key: "topics",
      blocks: [
        { type: "term", heading: "ECB", term: "ECB", definition: "블록마다 독립적으로 암호화한다.", sources: ["#13"], pdf_pages: [] },
        { type: "formula", heading: "CBC", expression: "C_i = E_K(P_i \\oplus C_{i-1})", explanation: "이전 암호문과 XOR", sources: ["#20"], pdf_pages: [4] },
        {
          type: "list",
          heading: "모드 비교",
          style: "numbered",
          items: [
            { text: "ECB: 패턴 노출", sources: ["#13"], pdf_pages: [] },
            { text: "CTR: 병렬화", sources: ["#50-#52"], pdf_pages: [5] },
          ],
          sources: [],
          pdf_pages: [],
        },
      ],
    },
    { key: "quotes", blocks: [{ type: "quote", heading: null, text: "ECB는 절대 쓰지 마세요.", speaker: "S1", sources: ["#14"], pdf_pages: [] }] },
  ],
} satisfies In<typeof D.TemplateOutput>;

export const meetingOutput = {
  sections: [
    { key: "summary", blocks: [{ type: "list", heading: null, style: "bullet", items: [{ text: "출시일을 확정했다.", sources: ["#3"], pdf_pages: [] }], sources: [], pdf_pages: [] }] },
    { key: "topics", blocks: [{ type: "paragraph", heading: "QA 일정", text: "QA를 1주 당긴다.", sources: ["#10-#12"], pdf_pages: [] }] },
  ],
} satisfies In<typeof D.TemplateOutput>;

export const extractResult = {
  events: [
    {
      title: "과제 3 제출",
      kind: "deadline",
      raw_expression: "다음 주 화요일 수업 전까지",
      model_resolution: { date: "2026-10-27", time: "09:00", end_time: null, all_day: false },
      evidence: ["#311"],
      quote: "다음 주 화요일까지 제출",
      confidence: 0.9,
    },
  ],
  action_items: [{ text: "회의록 공유", owner_name: "민지", due_raw: "이번 주 안에", evidence: ["#40"], quote: null }],
  questions: [
    {
      kind: "recall",
      prompt: "ECB가 위험한 이유는?",
      answer: "같은 평문 블록이 같은 암호문이 된다.",
      sources: { segments: ["#13", "#14-#15"], pdf_pages: [3] },
      difficulty: "easy",
    },
  ],
  decisions: [{ text: "QA를 1주 당긴다.", evidence: ["#10-#12"] }],
  glossary: [{ term: "IV", definition: "초기화 벡터", evidence: ["#21"] }],
} satisfies In<typeof D.ExtractResult>;
