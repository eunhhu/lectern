// The fixture data set behind FixtureApiClient: two workspaces, folders, tags, sixteen
// recordings across domains (lectures, a seminar, meetings, interviews, a call, a memo),
// transcripts (one with thousands of segments), documents, questions, event suggestions
// and action items. Everything is synthetic and typed with packages/domain; the tests
// parse every entity with the domain's zod schemas.
//
// Times are relative to `now` so "최근 7일" and relative dates stay meaningful whenever
// the preview is opened; tests pass a fixed `now`.

import type {
  AskThread,
  AskTurn,
  ActionItem,
  AssetDto,
  AssetId,
  Document,
  DocumentId,
  DocumentVersion,
  DocumentVersionId,
  EventCandidate,
  EventCandidateId,
  Folder,
  FolderId,
  Job,
  JobId,
  Me,
  MembershipRole,
  Question,
  QuestionId,
  Recording,
  RecordingDomain,
  RecordingId,
  RecordingStatus,
  RecordingTag,
  SourceRef,
  Speaker,
  StageName,
  Tag,
  TagId,
  TemplateId,
  TranscriptGap,
  TranscriptSegment,
  UserId,
  Workspace,
  WorkspaceId,
  ActionItemId,
  Device,
  WorkspaceMember,
} from "../api/types.ts";
import { DEFAULT_TIME_ZONE, zonedTimeToUtc } from "../lib/format.ts";
import { DocBuilder, renderMarkdown } from "./doc-builder.ts";
import * as Docs from "./documents.ts";
import { fakeSha256 } from "./random.ts";
import * as S from "./scripts.ts";
import { generateTranscript, type GeneratedTranscript, type Script } from "./transcript-gen.ts";

export const ME_ID = "usr_fixture_me" as UserId;
const TEAMMATE_ID = "usr_fixture_jimin" as UserId;
export const PERSONAL_WS = "ws_personal" as WorkspaceId;
export const TEAM_WS = "ws_team" as WorkspaceId;

export interface JobProgress {
  stage: StageName;
  progress: number;
  chunk_index: number | null;
  chunk_count: number | null;
}

export interface FixtureData {
  now: Date;
  me: Me;
  workspaces: { workspace: Workspace; role: MembershipRole }[];
  folders: Folder[];
  tags: Tag[];
  recordings: Recording[];
  recordingTags: RecordingTag[];
  assets: AssetDto[];
  speakers: Speaker[];
  transcripts: Map<RecordingId, { segments: TranscriptSegment[]; gaps: TranscriptGap[] }>;
  documents: Document[];
  versions: DocumentVersion[];
  questions: Question[];
  events: EventCandidate[];
  actionItems: ActionItem[];
  jobs: Job[];
  progress: Map<JobId, JobProgress>;
  members: WorkspaceMember[];
  devices: Device[];
  /** 물어보기 history (seeded by the fixture client). */
  askThreads: AskThread[];
  askTurns: AskTurn[];
}

// ---------------------------------------------------------------------------
// Time helpers (local wall clock in Asia/Seoul)
// ---------------------------------------------------------------------------

function localDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  return { year: parts[0]!, month: parts[1]!, day: parts[2]! };
}

function makeClock(now: Date) {
  const today = localDate(now);
  const base = Date.UTC(today.year, today.month - 1, today.day);
  const local = (daysAgo: number, hour: number, minute = 0) => {
    const d = new Date(base - daysAgo * 86_400_000);
    return zonedTimeToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute });
  };
  return {
    /** ISO time `daysAgo` days before today at hh:mm KST, never later than now. */
    at(daysAgo: number, hour: number, minute = 0): string {
      const t = local(daysAgo, hour, minute);
      return new Date(Math.min(t.getTime(), now.getTime() - 60_000)).toISOString();
    },
    /** A future (or past) local time relative to `fromIso`: "next week's Tuesday 23:59" etc. */
    nextWeekday(fromIso: string, weekday: number, weeksAhead: number, hour: number, minute: number): string {
      const from = localDate(new Date(fromIso));
      const d = new Date(Date.UTC(from.year, from.month - 1, from.day));
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
      const target = new Date(monday.getTime() + (weeksAhead * 7 + ((weekday + 6) % 7)) * 86_400_000);
      return zonedTimeToUtc({
        year: target.getUTCFullYear(),
        month: target.getUTCMonth() + 1,
        day: target.getUTCDate(),
        hour,
        minute,
      }).toISOString();
    },
    plusMinutes(iso: string, minutes: number): string {
      return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
    },
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

interface RecordingSpec {
  id: string;
  ws: WorkspaceId;
  title: string;
  domain: RecordingDomain;
  folder: string | null;
  daysAgo: number;
  hour: number;
  minute?: number;
  durationMin: number;
  status: RecordingStatus;
  tags?: [tag: string, source?: "user" | "ai"][];
  script?: Script;
  doc?: Docs.DocumentWriter;
  /** `scanned`: a PDF without a text layer (the files panel offers OCR). */
  pdf?: { name: string; pages: number; scanned?: boolean };
  /** For processing / queued recordings. */
  job?: JobProgress & { state: "queued" | "running" };
  createdBy?: UserId;
  userEdited?: boolean;
  /** A v1 lecture carried over: a `legacy-markdown` document (Markdown, no body) and no transcript. */
  legacyMarkdown?: string;
}

// A v1 lecture note as the P2 migration carries it over: Markdown with [MM:SS] marks.
const LEGACY_NOTE = `# 정보보호 7주차 — 블록 암호 운영 모드

## 핵심 요약
- [03:12] **ECB**는 같은 평문 블록을 같은 암호문으로 바꿔 패턴이 드러난다.
- [09:40] **CBC**는 앞 블록의 암호문을 섞으므로 *예측할 수 없는* 초기화 벡터가 필요하다.
  - 초기화 벡터는 비밀일 필요는 없지만 재사용하면 안 된다.

## 운영 모드 비교
| 모드 | 병렬 암호화 | 오류 전파 |
|---|---|---|
| ECB | 가능 | 없음 |
| CBC | 불가 | 다음 블록 |

\`[쉬는 시간 생략: 10분]\`

## 시험
> [1:02:40] 기말시험 범위는 운영 모드까지이고 CBC 복호화 그림이 꼭 나온다.

1. 복호화 그림을 직접 그려 볼 것
2. \`IV\`를 재사용하면 생기는 문제 정리
`;

const FOLDERS: [id: string, ws: WorkspaceId, parent: string | null, name: string][] = [
  ["fld_semester", PERSONAL_WS, null, "2026년 2학기"],
  ["fld_os", PERSONAL_WS, "fld_semester", "운영체제"],
  ["fld_ds", PERSONAL_WS, "fld_semester", "자료구조"],
  ["fld_econ", PERSONAL_WS, "fld_semester", "미시경제학"],
  ["fld_research", PERSONAL_WS, null, "연구실"],
  ["fld_seminar", PERSONAL_WS, "fld_research", "세미나"],
  ["fld_personal", PERSONAL_WS, null, "개인"],
  // v1 courses become folders when the P2 migration carries lectures over.
  ["fld_security", PERSONAL_WS, null, "정보보호"],
  ["fld_weekly", TEAM_WS, null, "주간 회의"],
  ["fld_interviews", TEAM_WS, null, "사용자 인터뷰"],
];

const TAGS: [id: string, ws: WorkspaceId, name: string, color: string][] = [
  ["tag_exam", PERSONAL_WS, "시험 범위", "red"],
  ["tag_assignment", PERSONAL_WS, "과제", "orange"],
  ["tag_important", PERSONAL_WS, "중요", "yellow"],
  ["tag_review", PERSONAL_WS, "복습 필요", "blue"],
  ["tag_question", PERSONAL_WS, "질문 있음", "indigo"],
  ["tag_idea", PERSONAL_WS, "아이디어", "green"],
  ["tag_decision", TEAM_WS, "결정 사항", "green"],
  ["tag_roadmap", TEAM_WS, "로드맵", "blue"],
  ["tag_feedback", TEAM_WS, "고객 피드백", "yellow"],
];

const RECORDINGS: RecordingSpec[] = [
  {
    id: "rec_os07",
    ws: PERSONAL_WS,
    title: "운영체제 7주차 — CPU 스케줄링",
    domain: "lecture",
    folder: "fld_os",
    daysAgo: 1,
    hour: 10,
    durationMin: 190,
    status: "ready",
    tags: [["tag_exam"], ["tag_assignment", "ai"], ["tag_important"]],
    script: S.OS_SCHEDULING,
    doc: Docs.OS_SCHEDULING_DOC,
    pdf: { name: "운영체제_07_CPU스케줄링.pdf", pages: 24 },
  },
  {
    id: "rec_os08",
    ws: PERSONAL_WS,
    title: "운영체제 8주차 — 동기화",
    domain: "lecture",
    folder: "fld_os",
    daysAgo: 0,
    hour: 10,
    durationMin: 80,
    status: "processing",
    pdf: { name: "운영체제_08_동기화.pdf", pages: 21 },
    job: { state: "running", stage: "transcribe", progress: 0.42, chunk_index: 5, chunk_count: 12 },
  },
  {
    id: "rec_os06",
    ws: PERSONAL_WS,
    title: "운영체제 6주차 — 프로세스와 스레드",
    domain: "lecture",
    folder: "fld_os",
    daysAgo: 8,
    hour: 10,
    durationMin: 74,
    status: "ready",
    tags: [["tag_exam"]],
    script: S.OS_THREADS,
    doc: Docs.OS_THREADS_DOC,
    pdf: { name: "운영체제_06_프로세스와스레드.pdf", pages: 18, scanned: true },
  },
  {
    id: "rec_ds05",
    ws: PERSONAL_WS,
    title: "자료구조 5주차 — 힙과 우선순위 큐",
    domain: "lecture",
    folder: "fld_ds",
    daysAgo: 2,
    hour: 13,
    durationMin: 70,
    status: "ready",
    tags: [["tag_review"]],
    script: S.DS_HEAP,
    doc: Docs.DS_HEAP_DOC,
    userEdited: true,
  },
  {
    id: "rec_ds06",
    ws: PERSONAL_WS,
    title: "자료구조 6주차 — 그래프 탐색",
    domain: "lecture",
    folder: "fld_ds",
    daysAgo: 0,
    hour: 13,
    durationMin: 65,
    status: "queued",
    job: { state: "queued", stage: "ingest", progress: 0, chunk_index: null, chunk_count: null },
  },
  {
    id: "rec_ds04",
    ws: PERSONAL_WS,
    title: "자료구조 4주차 — 트리 순회",
    domain: "lecture",
    folder: "fld_ds",
    daysAgo: 9,
    hour: 13,
    durationMin: 52,
    status: "partial",
    script: S.DS_TREES,
    doc: Docs.DS_TREES_DOC,
  },
  {
    id: "rec_econ04",
    ws: PERSONAL_WS,
    title: "미시경제학 4주차 — 소비자 선택",
    domain: "lecture",
    folder: "fld_econ",
    daysAgo: 3,
    hour: 15,
    durationMin: 90,
    status: "ready",
    tags: [["tag_exam"], ["tag_question"]],
    script: S.ECON_CHOICE,
    doc: Docs.ECON_CHOICE_DOC,
    pdf: { name: "미시경제학_4주차_소비자선택.pdf", pages: 14 },
  },
  {
    id: "rec_sem01",
    ws: PERSONAL_WS,
    title: "연구실 세미나 — 음성 인식 평가 지표",
    domain: "seminar",
    folder: "fld_seminar",
    daysAgo: 4,
    hour: 17,
    durationMin: 58,
    status: "ready",
    tags: [["tag_question", "ai"]],
    script: S.SEMINAR_ASR,
    doc: Docs.SEMINAR_ASR_DOC,
    pdf: { name: "세미나_음성인식평가_발표.pdf", pages: 12 },
  },
  {
    id: "rec_adv",
    ws: PERSONAL_WS,
    title: "대학원 진학 상담",
    domain: "one_on_one",
    folder: "fld_research",
    daysAgo: 6,
    hour: 16,
    minute: 30,
    durationMin: 32,
    status: "ready",
    tags: [["tag_important"]],
    script: S.ADVISING,
    doc: Docs.ADVISING_DOC,
  },
  {
    id: "rec_call",
    ws: PERSONAL_WS,
    title: "치과 예약 변경 통화",
    domain: "call",
    folder: "fld_personal",
    daysAgo: 5,
    hour: 12,
    minute: 10,
    durationMin: 3,
    status: "ready",
    script: S.DENTIST_CALL,
    doc: Docs.DENTIST_CALL_DOC,
  },
  {
    id: "rec_memo",
    ws: PERSONAL_WS,
    title: "산책하며 떠올린 아이디어",
    domain: "other",
    folder: null,
    daysAgo: 2,
    hour: 21,
    durationMin: 6,
    status: "ready",
    tags: [["tag_idea"]],
    script: S.IDEA_MEMO,
    doc: Docs.IDEA_MEMO_DOC,
  },
  {
    id: "rec_legacy_sec07",
    ws: PERSONAL_WS,
    title: "정보보호 7주차 — 블록 암호 운영 모드",
    domain: "lecture",
    folder: "fld_security",
    daysAgo: 40,
    hour: 10,
    durationMin: 75,
    status: "ready",
    legacyMarkdown: LEGACY_NOTE,
  },
  {
    id: "rec_test",
    ws: PERSONAL_WS,
    title: "녹음 테스트",
    domain: "other",
    folder: null,
    daysAgo: 12,
    hour: 9,
    durationMin: 1,
    status: "failed",
  },
  {
    id: "rec_tw42",
    ws: TEAM_WS,
    title: "제품팀 주간 회의 — 10월 3주차",
    domain: "meeting",
    folder: "fld_weekly",
    daysAgo: 1,
    hour: 11,
    durationMin: 48,
    status: "ready",
    tags: [["tag_decision"], ["tag_roadmap", "ai"]],
    script: S.TEAM_WEEKLY,
    doc: Docs.TEAM_WEEKLY_DOC,
    createdBy: TEAMMATE_ID,
  },
  {
    id: "rec_roadmap",
    ws: TEAM_WS,
    title: "4분기 로드맵 리뷰",
    domain: "meeting",
    folder: "fld_weekly",
    daysAgo: 0,
    hour: 9,
    durationMin: 62,
    status: "processing",
    tags: [["tag_roadmap"]],
    job: { state: "running", stage: "structure", progress: 0.78, chunk_index: null, chunk_count: null },
    createdBy: TEAMMATE_ID,
  },
  {
    id: "rec_ui12",
    ws: TEAM_WS,
    title: "사용자 인터뷰 #12 — 대학원생",
    domain: "interview",
    folder: "fld_interviews",
    daysAgo: 3,
    hour: 14,
    durationMin: 36,
    status: "ready",
    tags: [["tag_feedback"]],
    script: S.USER_INTERVIEW,
    doc: Docs.USER_INTERVIEW_DOC,
  },
  {
    id: "rec_ui13",
    ws: TEAM_WS,
    title: "사용자 인터뷰 #13 — 직장인",
    domain: "interview",
    folder: "fld_interviews",
    daysAgo: 0,
    hour: 8,
    durationMin: 29,
    status: "uploading",
    createdBy: TEAMMATE_ID,
  },
];

export const TEMPLATE_FOR: Record<RecordingDomain, "lecture" | "meeting" | null> = {
  lecture: "lecture",
  seminar: "lecture",
  meeting: "meeting",
  one_on_one: "meeting",
  call: "meeting",
  interview: "meeting",
  other: null,
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface ProcessedParts {
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  speakers: Speaker[];
  document: Document;
  version: DocumentVersion;
  anchors: GeneratedTranscript["anchors"];
  durationMs: number;
}

/** Transcript, speakers and document for one recording (also used for fixture uploads). */
export function processRecording(
  rec: Pick<Recording, "id" | "workspace_id" | "title" | "domain">,
  script: Script,
  writer: Docs.DocumentWriter,
  durationMs: number,
  createdAt: string,
  pdfAssetId: AssetId | null,
  userEdited = false,
): ProcessedParts {
  const generated = generateTranscript(script, { workspaceId: rec.workspace_id, recordingId: rec.id }, durationMs, rec.id);
  const speakers: Speaker[] = script.speakers.map((s, i) => ({
    id: generated.speakerIds[s.label]!,
    workspace_id: rec.workspace_id,
    recording_id: rec.id,
    label: s.label,
    display_name: s.name,
    confidence: Math.round((0.95 - i * 0.07) * 100) / 100,
    created_at: createdAt,
    updated_at: createdAt,
  }));
  const documentId = `${rec.id}_doc` as DocumentId;
  const builder = new DocBuilder(documentId, generated.anchors, pdfAssetId);
  const body = { sections: writer(builder, { gaps: generated.gaps }) };
  const template = (TEMPLATE_FOR[rec.domain] ?? "lecture") as TemplateId;
  const version = userEdited ? 2 : 1;
  const document: Document = {
    id: documentId,
    workspace_id: rec.workspace_id,
    recording_id: rec.id,
    template_id: template,
    template_version: 1,
    current_version: version,
    user_edited: userEdited,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const documentVersion: DocumentVersion = {
    id: `${documentId}_v${version}` as DocumentVersionId,
    workspace_id: rec.workspace_id,
    document_id: documentId,
    recording_id: rec.id,
    version,
    base_version: userEdited ? 1 : null,
    template_id: template,
    template_version: 1,
    body,
    rendered_md: renderMarkdown(rec.title, body),
    created_by: userEdited ? "user" : "ai",
    author_id: userEdited ? ME_ID : null,
    created_at: createdAt,
  };
  return {
    segments: generated.segments,
    gaps: generated.gaps,
    speakers,
    document,
    version: documentVersion,
    anchors: generated.anchors,
    durationMs: generated.durationMs,
  };
}

export function buildFixtureData(now = new Date()): FixtureData {
  const clock = makeClock(now);
  const createdAt = clock.at(30, 9);

  const me: Me = {
    id: ME_ID,
    email: "preview@example.com",
    display_name: "미리보기 사용자",
    timezone: DEFAULT_TIME_ZONE,
    system_role: "owner",
    personal_workspace_id: PERSONAL_WS,
  };

  const workspaces: FixtureData["workspaces"] = [
    {
      workspace: { id: PERSONAL_WS, name: "개인", kind: "personal", plan: "free", settings: { default_language: "ko" }, created_at: createdAt, updated_at: createdAt },
      role: "owner",
    },
    {
      workspace: {
        id: TEAM_WS,
        name: "제품팀",
        kind: "team",
        plan: "team",
        settings: { calendar_auto_add: { enabled: false, min_confidence: 0.85 }, default_language: "ko" },
        created_at: createdAt,
        updated_at: createdAt,
      },
      role: "member",
    },
  ];

  const folders: Folder[] = FOLDERS.map(([id, ws, parent, name], i) => ({
    id: id as FolderId,
    workspace_id: ws,
    parent_id: parent as FolderId | null,
    name,
    sort_key: `a${String(i).padStart(2, "0")}`,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const tags: Tag[] = TAGS.map(([id, ws, name, color]) => ({
    id: id as TagId,
    workspace_id: ws,
    name,
    color,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const data: FixtureData = {
    now,
    me,
    workspaces,
    folders,
    tags,
    recordings: [],
    recordingTags: [],
    assets: [],
    speakers: [],
    transcripts: new Map(),
    documents: [],
    versions: [],
    questions: [],
    events: [],
    actionItems: [],
    jobs: [],
    progress: new Map(),
    members: [],
    devices: [],
    askThreads: [],
    askTurns: [],
  };

  // Team members (synthetic names, example.com addresses) and this user's devices.
  const person = (id: string, name: string, email: string, ws: WorkspaceId, role: MembershipRole): WorkspaceMember => ({
    workspace_id: ws,
    user_id: id as UserId,
    role,
    display_name: name,
    email,
    created_at: createdAt,
    updated_at: createdAt,
  });
  data.members.push(
    person(ME_ID, me.display_name, me.email, PERSONAL_WS, "owner"),
    person(TEAMMATE_ID, "한지민", "jimin@example.com", TEAM_WS, "owner"),
    person("usr_fixture_sehun", "오세훈", "sehun@example.com", TEAM_WS, "admin"),
    person(ME_ID, me.display_name, me.email, TEAM_WS, "member"),
    person("usr_fixture_seoa", "윤서아", "seoa@example.com", TEAM_WS, "member"),
    person("usr_fixture_dohyun", "최도현", "dohyun@example.com", TEAM_WS, "member"),
  );
  const device = (id: string, client: "web" | "native", name: string, agent: string, lastSeen: string, current = false): Device => ({
    id: id as Device["id"],
    workspace_id: PERSONAL_WS,
    user_id: ME_ID,
    client,
    device_name: name,
    user_agent: agent,
    created_at: createdAt,
    last_seen_at: lastSeen,
    expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    revoked_at: null,
    current,
  });
  data.devices.push(
    device("ses_fixture_web", "web", "이 브라우저", "Mozilla/5.0 (Macintosh) Safari", new Date(now.getTime() - 60_000).toISOString(), true),
    device("ses_fixture_mac", "native", "Lectern for Mac", "Lectern/2.0 macOS", clock.at(1, 18)),
    device("ses_fixture_android", "native", "Android 빠른 녹음", "Lectern/1.6 Android", clock.at(4, 9)),
  );

  const anchorsById = new Map<string, GeneratedTranscript["anchors"]>();
  const pdfById = new Map<string, AssetId>();

  for (const spec of RECORDINGS) {
    const id = spec.id as RecordingId;
    // Recordings from "today" must have ended (and been uploaded) before now.
    const latestStart = now.getTime() - (spec.durationMin + 15) * 60_000;
    const recordedAt = new Date(
      Math.min(new Date(clock.at(spec.daysAgo, spec.hour, spec.minute ?? 0)).getTime(), latestStart),
    ).toISOString();
    const uploadedAt = clock.plusMinutes(recordedAt, spec.durationMin + 7);
    const finishedAt = new Date(Math.min(new Date(clock.plusMinutes(uploadedAt, 9)).getTime(), now.getTime() - 30_000)).toISOString();
    let durationMs: number | null = spec.status === "uploading" ? null : spec.durationMin * 60_000;
    const rec: Recording = {
      id,
      workspace_id: spec.ws,
      folder_id: spec.folder as FolderId | null,
      title: spec.title,
      domain: spec.domain,
      template_id: (TEMPLATE_FOR[spec.domain] as TemplateId | null) ?? null,
      language: "ko",
      recorded_at: recordedAt,
      recorded_at_source: spec.domain === "call" ? "media" : "client",
      duration_ms: durationMs,
      status: spec.status,
      created_by: spec.createdBy ?? ME_ID,
      visibility: spec.ws === TEAM_WS ? "workspace" : "private",
      created_at: uploadedAt,
      updated_at: spec.script ? finishedAt : uploadedAt,
    };

    if (spec.status !== "uploading") {
      data.assets.push({
        id: `${spec.id}_audio0` as AssetId,
        workspace_id: spec.ws,
        recording_id: id,
        kind: "audio",
        part_index: 0,
        sha256: fakeSha256(`${spec.id}:audio`),
        bytes: Math.round(spec.durationMin * 60 * 16_000),
        mime: "audio/mp4",
        duration_ms: durationMs,
        page_count: null,
        meta: { original_name: `${spec.title.replace(/\s—\s/g, "_").replace(/\s+/g, "_")}.m4a` },
        created_at: uploadedAt,
      });
    }
    if (spec.pdf) {
      const pdfId = `${spec.id}_pdf` as AssetId;
      pdfById.set(spec.id, pdfId);
      data.assets.push({
        id: pdfId,
        workspace_id: spec.ws,
        recording_id: id,
        kind: "pdf",
        part_index: 0,
        sha256: fakeSha256(`${spec.id}:pdf`),
        bytes: spec.pdf.pages * 180_000,
        mime: "application/pdf",
        duration_ms: null,
        page_count: spec.pdf.pages,
        meta: { original_name: spec.pdf.name, ...(spec.pdf.scanned ? { scanned: true } : {}) },
        created_at: uploadedAt,
      });
    }

    if (spec.legacyMarkdown) {
      const documentId = `${spec.id}_doc` as DocumentId;
      data.transcripts.set(id, { segments: [], gaps: [] });
      data.documents.push({
        id: documentId,
        workspace_id: spec.ws,
        recording_id: id,
        template_id: "legacy-markdown" as TemplateId,
        template_version: 1,
        current_version: 1,
        user_edited: false,
        created_at: finishedAt,
        updated_at: finishedAt,
      });
      data.versions.push({
        id: `${documentId}_v1` as DocumentVersionId,
        workspace_id: spec.ws,
        document_id: documentId,
        recording_id: id,
        version: 1,
        base_version: null,
        template_id: "legacy-markdown" as TemplateId,
        template_version: 1,
        body: null,
        rendered_md: spec.legacyMarkdown,
        created_by: "ai",
        author_id: null,
        created_at: finishedAt,
      });
    }

    if (spec.script && spec.doc) {
      const parts = processRecording(rec, spec.script, spec.doc, spec.durationMin * 60_000, finishedAt, pdfById.get(spec.id) ?? null, spec.userEdited);
      rec.duration_ms = durationMs = parts.durationMs;
      const audio = data.assets.find((a) => a.id === `${spec.id}_audio0`);
      if (audio) audio.duration_ms = durationMs;
      data.transcripts.set(id, { segments: parts.segments, gaps: parts.gaps });
      data.speakers.push(...parts.speakers);
      data.documents.push(parts.document);
      data.versions.push(parts.version);
      anchorsById.set(spec.id, parts.anchors);
    }

    for (const [tag, source = "user"] of spec.tags ?? []) {
      data.recordingTags.push({
        workspace_id: spec.ws,
        recording_id: id,
        tag_id: tag as TagId,
        source,
        confidence: source === "ai" ? 0.82 : null,
        created_at: finishedAt,
      });
    }

    if (spec.job) {
      const jobId = `job_${spec.id}` as JobId;
      data.jobs.push({
        id: jobId,
        workspace_id: spec.ws,
        recording_id: id,
        kind: "process",
        state: spec.job.state,
        priority: 0,
        run_after: uploadedAt,
        attempts: spec.job.state === "running" ? 1 : 0,
        lease_owner: spec.job.state === "running" ? "fixture-worker" : null,
        lease_until: spec.job.state === "running" ? new Date(now.getTime() + 60_000).toISOString() : null,
        budget_microusd: 400_000,
        spent_microusd: Math.round(spec.job.progress * 120_000),
        idempotency_key: null,
        error_code: null,
        created_at: uploadedAt,
        updated_at: uploadedAt,
      });
      const { state: _state, ...progress } = spec.job;
      data.progress.set(jobId, progress);
    }

    data.recordings.push(rec);
  }

  addExtractedItems(data, anchorsById, pdfById, clock);
  return data;
}

function addExtractedItems(
  data: FixtureData,
  anchorsById: Map<string, GeneratedTranscript["anchors"]>,
  pdfById: Map<string, AssetId>,
  clock: ReturnType<typeof makeClock>,
) {
  const rec = (id: string) => data.recordings.find((r) => r.id === id)!;
  const src = (id: string, ...keys: string[]): SourceRef[] =>
    keys.map((k) => {
      const range = anchorsById.get(id)?.[k];
      if (!range) throw new Error(`fixture anchor not found: ${id}/${k}`);
      return { kind: "transcript" as const, ...range };
    });
  const page = (id: string, p: number): SourceRef => ({ kind: "pdf_page", asset_id: pdfById.get(id)!, page: p });
  const stamp = (id: string) => rec(id).updated_at;

  // --- Questions: recall cards for lectures, issues and discussion prompts for meetings.
  type Q = [id: string, kind: Question["kind"], prompt: string, answer: string | null, keys: string[], difficulty: Question["difficulty"], extra?: { pages?: number[]; flags?: Question["flags"] }];
  const questions: Q[] = [
    ["rec_os07", "recall", "FCFS에서 호위 효과가 생기는 이유는?", "실행 시간이 긴 프로세스가 먼저 CPU를 잡으면 비선점이라 뒤의 짧은 프로세스들이 모두 기다려야 하기 때문이다.", ["convoy"], "easy"],
    ["rec_os07", "recall", "SJF가 최적이면서도 그대로 쓰기 어려운 이유는?", "다음 CPU 버스트 길이를 미리 알 수 없기 때문이다. 그래서 지수 평균으로 예측한다.", ["sjf_optimal", "sjf_predict"], "medium"],
    ["rec_os07", "recall", "라운드 로빈에서 타임 퀀텀이 너무 크면 어떻게 되는가?", "사실상 FCFS와 같아진다.", ["rr_quantum_large"], "easy", { pages: [12] }],
    ["rec_os07", "recall", "타임 퀀텀을 정하는 경험 규칙은?", "CPU 버스트의 80%가 한 퀀텀 안에 끝나도록 잡는다.", ["rr_rule"], "medium"],
    ["rec_os07", "recall", "기아 상태와 그 해결책을 설명하라.", "낮은 우선순위 프로세스가 계속 실행되지 못하는 상태이며, 기다린 시간에 따라 우선순위를 올리는 에이징으로 해결한다.", ["starvation", "aging"], "medium"],
    ["rec_os07", "recall", "프로세서 친화성과 부하 분산은 왜 부딪히는가?", "부하 분산은 프로세스를 다른 코어로 옮기지만, 옮기면 캐시를 다시 채워야 해서 친화성의 이점을 잃는다.", ["affinity"], "hard", { flags: ["low_confidence"] }],
    ["rec_os07", "recall", "다단계 피드백 큐가 대화형 작업에 유리한 이유는?", "CPU를 오래 쓰는 작업은 아래 큐로 내려가므로 짧은 대화형 작업이 위쪽 큐에서 빨리 응답받는다.", ["mlfq"], "medium", { pages: [16] }],
    ["rec_os06", "recall", "같은 프로세스의 스레드끼리 공유하지 않는 것은?", "스택과 레지스터(프로그램 카운터 포함)는 스레드마다 따로 있다.", ["thread_share"], "easy"],
    ["rec_os06", "recall", "PCB에 들어가는 정보를 세 가지 이상 말하라.", "프로세스 상태, 프로그램 카운터, 레지스터 값, 메모리 관리 정보 등.", ["pcb"], "easy", { pages: [3] }],
    ["rec_os06", "recall", "일대일 스레드 모델의 장점과 단점은?", "병렬성이 좋지만 사용자 스레드마다 커널 스레드를 만들어야 해서 비용이 크다.", ["one_to_one"], "medium"],
    ["rec_ds05", "recall", "배열로 힙을 만드는 시간 복잡도는?", "아래에서부터 내리면 O(n)이다.", ["heap_build"], "medium"],
    ["rec_ds05", "recall", "힙 정렬의 최악 시간 복잡도는?", "O(n log n)", ["heapsort"], "easy"],
    ["rec_ds05", "recall", "우선순위 큐의 두 연산은?", "원소 넣기와, 우선순위가 가장 높은 원소 꺼내기.", ["pq_def"], "easy"],
    ["rec_ds04", "recall", "이진 탐색 트리를 중위 순회하면 어떤 순서가 나오는가?", "키가 정렬된 순서.", ["inorder_bst"], "easy"],
    ["rec_ds04", "recall", "레벨 순회에 쓰는 자료구조는?", "큐.", ["level_queue"], "easy"],
    ["rec_econ04", "recall", "소비자 균형의 조건은?", "한계대체율이 두 재화의 가격비와 같다.", ["optimum"], "medium", { pages: [8] }],
    ["rec_econ04", "recall", "예산선의 기울기는 무엇으로 정해지는가?", "두 재화의 가격비(−P1/P2).", ["budget_slope"], "easy"],
    ["rec_econ04", "recall", "한계대체율의 정의는?", "같은 효용을 유지하면서 한 재화를 한 단위 더 얻으려고 포기하는 다른 재화의 양.", ["mrs"], "medium"],
    ["rec_sem01", "recall", "한국어 음성 인식 평가에 CER을 주 지표로 쓰자는 이유는?", "띄어쓰기가 흔들려 단어 단위 WER이 불안정하기 때문이다.", ["cer"], "medium", { pages: [4] }],
    ["rec_sem01", "recall", "청크 경계에서 화자 번호가 바뀌는 문제는 어떻게 풀었나?", "겹치는 구간을 두고 양쪽 화자 번호를 다시 맞췄다.", ["chunk_speaker"], "hard"],
    ["rec_tw42", "issue", "연간 요금제를 결제 화면 앞에 계속 둘 것인가?", null, ["pricing_open"], null],
    ["rec_tw42", "issue", "온보딩 이탈은 어디서 가장 많이 생기는가?", "권한 요청 화면. 그래서 가입 직후 바로 올리기 화면으로 보내기로 했다.", ["onboarding_decision"], null],
    ["rec_tw42", "discussion", "학생 할인을 따로 떼어 분석해야 할까?", null, ["pricing_open"], null],
    ["rec_ui12", "issue", "참여자가 녹음을 다시 듣지 않는 이유는?", "녹음은 쌓이지만 필요한 부분을 찾을 수 없어서.", ["pain"], null],
    ["rec_ui12", "discussion", "요약을 믿고 쓰려면 무엇이 필요하다고 했나?", "요약 문장마다 원래 녹음 위치가 붙어 있어야 한다.", ["sources"], null],
  ];
  questions.forEach(([id, kind, prompt, answer, keys, difficulty, extra], i) => {
    data.questions.push({
      id: `q_${id}_${i}` as QuestionId,
      workspace_id: rec(id).workspace_id,
      recording_id: rec(id).id,
      kind,
      prompt,
      answer,
      sources: [...src(id, ...keys), ...(extra?.pages ?? []).map((p) => page(id, p))],
      difficulty,
      flags: extra?.flags ?? [],
      created_at: stamp(id),
      updated_at: stamp(id),
    });
  });

  // --- Events found in recordings: confirmed ones fill the calendar, suggested ones wait in the inbox.
  let n = 0;
  const event = (
    id: string,
    e: Pick<EventCandidate, "kind" | "title" | "start_at" | "end_at" | "all_day" | "raw_expression" | "confidence" | "status"> & {
      rule: string | null;
      keys: string[];
      quote: string;
      flags?: EventCandidate["flags"];
    },
  ) => {
    data.events.push({
      id: `ev_${id}_${n++}` as EventCandidateId,
      workspace_id: rec(id).workspace_id,
      recording_id: rec(id).id,
      kind: e.kind,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      tz: DEFAULT_TIME_ZONE,
      raw_expression: e.raw_expression,
      resolution: { method: e.rule ? "parser" : "model", rule: e.rule },
      confidence: e.confidence,
      evidence: { sources: src(id, ...e.keys), quote: e.quote },
      flags: e.flags ?? [],
      status: e.status,
      created_at: stamp(id),
      updated_at: stamp(id),
    });
  };
  const at = (id: string) => rec(id).recorded_at;
  const wk = clock.nextWeekday;
  event("rec_os07", { kind: "deadline", title: "운영체제 과제 3 제출", start_at: wk(at("rec_os07"), 2, 1, 23, 59), end_at: null, all_day: false, raw_expression: "다음 주 화요일 밤 11시 59분까지", confidence: 0.93, status: "suggested", rule: "next_week_weekday", keys: ["assignment"], quote: "다음 주 화요일 밤 11시 59분까지 제출하세요" });
  event("rec_os07", { kind: "exam", title: "운영체제 중간고사", start_at: wk(at("rec_os07"), 3, 1, 10, 0), end_at: wk(at("rec_os07"), 3, 1, 11, 15), all_day: false, raw_expression: "다음 주 수요일 수업 시간에", confidence: 0.71, status: "suggested", rule: "next_week_weekday", keys: ["midterm"], quote: "중간고사는 다음 주 수요일 수업 시간에 봅니다", flags: ["needs_review"] });
  event("rec_os06", { kind: "deadline", title: "운영체제 과제 2 제출", start_at: wk(at("rec_os06"), 5, 0, 23, 59), end_at: null, all_day: false, raw_expression: "이번 주 금요일 밤 11시 59분까지", confidence: 0.94, status: "synced", rule: "this_week_weekday", keys: ["hw2"], quote: "과제 2는 이번 주 금요일 밤 11시 59분까지 제출하세요" });
  event("rec_os06", { kind: "meeting", title: "운영체제 실습 보충", start_at: wk(at("rec_os06"), 4, 1, 19, 0), end_at: wk(at("rec_os06"), 4, 1, 20, 30), all_day: false, raw_expression: "다음 주 목요일 저녁 7시에", confidence: 0.9, status: "accepted", rule: "next_week_weekday_time", keys: ["lab"], quote: "다음 주 목요일 저녁 7시에 실습 보충 시간을 엽니다" });
  event("rec_ds05", { kind: "exam", title: "자료구조 힙 구현 퀴즈", start_at: wk(at("rec_ds05"), 1, 1, 13, 0), end_at: wk(at("rec_ds05"), 1, 1, 13, 30), all_day: false, raw_expression: "다음 주 월요일 수업 시작할 때", confidence: 0.86, status: "accepted", rule: "next_week_weekday", keys: ["heap_quiz"], quote: "다음 주 월요일 수업 시작할 때 힙 구현 퀴즈를 봅니다" });
  event("rec_econ04", { kind: "exam", title: "미시경제학 쪽지 시험", start_at: wk(at("rec_econ04"), 4, 1, 15, 0), end_at: wk(at("rec_econ04"), 4, 1, 15, 30), all_day: false, raw_expression: "다음 주 목요일에", confidence: 0.88, status: "accepted", rule: "next_week_weekday", keys: ["quiz"], quote: "다음 주 목요일에 이 단원으로 쪽지 시험을 봅니다" });
  event("rec_sem01", { kind: "meeting", title: "연구실 세미나", start_at: wk(at("rec_sem01"), 4, 2, 17, 0), end_at: wk(at("rec_sem01"), 4, 2, 18, 30), all_day: false, raw_expression: "2주 뒤 목요일 오후 5시에", confidence: 0.84, status: "synced", rule: "weeks_ahead_weekday_time", keys: ["next_seminar"], quote: "다음 세미나는 2주 뒤 목요일 오후 5시에 하겠습니다" });
  event("rec_adv", { kind: "deadline", title: "대학원 원서 접수 마감", ...allDay(at("rec_adv"), 11, 28), raw_expression: "11월 28일까지", confidence: 0.97, status: "accepted", rule: "absolute_date", keys: ["deadline"], quote: "대학원 원서 접수는 11월 28일까지예요" });
  event("rec_call", { kind: "other", title: "치과 예약", start_at: wk(at("rec_call"), 5, 1, 16, 0), end_at: wk(at("rec_call"), 5, 1, 16, 30), all_day: false, raw_expression: "다음 주 금요일 오후 4시로", confidence: 0.96, status: "synced", rule: "next_week_weekday_time", keys: ["new_time"], quote: "다음 주 금요일 오후 4시로 옮겨 드릴게요" });
  event("rec_tw42", { kind: "meeting", title: "출시 점검 회의", start_at: wk(at("rec_tw42"), 4, 1, 14, 0), end_at: wk(at("rec_tw42"), 4, 1, 15, 0), all_day: false, raw_expression: "다음 주 목요일 오후 2시에", confidence: 0.95, status: "suggested", rule: "next_week_weekday_time", keys: ["release_date"], quote: "출시 점검 회의는 다음 주 목요일 오후 2시에 하겠습니다" });
  event("rec_tw42", { kind: "meeting", title: "사용자 인터뷰 2건", start_at: wk(at("rec_tw42"), 3, 1, 15, 0), end_at: wk(at("rec_tw42"), 3, 1, 17, 0), all_day: false, raw_expression: "다음 주 수요일 오후 3시에", confidence: 0.89, status: "accepted", rule: "next_week_weekday_time", keys: ["interview_plan"], quote: "사용자 인터뷰는 다음 주 수요일 오후 3시에 두 명 더 잡겠습니다" });
  event("rec_ui12", { kind: "meeting", title: "후속 인터뷰 (#12)", start_at: wk(at("rec_ui12"), 2, 1, 10, 0), end_at: wk(at("rec_ui12"), 2, 1, 11, 0), all_day: false, raw_expression: "다음 주 화요일 오전 10시에", confidence: 0.82, status: "suggested", rule: "next_week_weekday_time", keys: ["follow_up"], quote: "다음 주 화요일 오전 10시에 한 번 더 이야기 나눌 수 있을까요?" });

  function allDay(fromIso: string, month: number, day: number) {
    let year = new Date(fromIso).getUTCFullYear();
    let start = zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 });
    if (start.getTime() < new Date(fromIso).getTime()) start = zonedTimeToUtc({ year: ++year, month, day, hour: 0, minute: 0 });
    return { start_at: start.toISOString(), end_at: new Date(start.getTime() + 86_400_000).toISOString(), all_day: true };
  }

  // --- Action items.
  let m = 0;
  const item = (id: string, text: string, owner: string | null, due: string | null, raw: string | null, keys: string[], status: ActionItem["status"] = "open") => {
    data.actionItems.push({
      id: `ai_${id}_${m++}` as ActionItemId,
      workspace_id: rec(id).workspace_id,
      recording_id: rec(id).id,
      text,
      owner_name: owner,
      due_at: due,
      due_raw: raw,
      status,
      evidence: { sources: src(id, ...keys), quote: null },
      flags: [],
      created_at: stamp(id),
      updated_at: stamp(id),
    });
  };
  item("rec_os07", "스케줄링 시뮬레이터 구현 (과제 3)", "나", wk(at("rec_os07"), 2, 1, 23, 59), "다음 주 화요일까지", ["assignment"]);
  item("rec_os06", "과제 2 제출", "나", wk(at("rec_os06"), 5, 0, 23, 59), "이번 주 금요일까지", ["hw2"], "done");
  item("rec_ds05", "힙 삽입·삭제 직접 구현해 올리기", "나", wk(at("rec_ds05"), 1, 1, 13, 0), "다음 수업 전까지", ["heap_hw"]);
  item("rec_econ04", "교재 연습문제 3–7번 풀기", "나", null, null, ["econ_hw"]);
  item("rec_sem01", "강의실 녹음 세 시간으로 평가 세트 만들기", "발표자", wk(at("rec_sem01"), 4, 2, 17, 0), "다음 발표 전까지", ["eval_set"]);
  item("rec_adv", "추천 논문 세 편 읽고 요약", "나", null, "다음 면담 전까지", ["reading"]);
  item("rec_call", "지난번 엑스레이 사진 챙기기", "나", wk(at("rec_call"), 5, 1, 16, 0), "예약 날", ["bring"]);
  const tw = at("rec_tw42");
  item("rec_tw42", "QA 체크리스트 정리", "윤서아", wk(tw, 3, 0, 18, 0), "수요일까지", ["qa_owner"]);
  item("rec_tw42", "릴리스 노트 초안 작성", "최도현", wk(tw, 5, 0, 18, 0), "금요일까지", ["notes_owner"]);
  item("rec_tw42", "가입 직후 올리기 화면으로 이동", "한지민", null, null, ["onboarding_decision"], "done");
  item("rec_ui12", "인터뷰 내용 정리해 팀 채널에 공유", "진행자", null, null, ["share_notes"]);
}
