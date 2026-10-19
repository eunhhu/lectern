// Fixed, synthetic data served by the read-only /api/v2 stubs until the v2 tables exist
// (ROADMAP P2). Nothing here comes from a real user or recording. Ids cross-reference so a
// client can walk the whole graph: /me -> workspaces -> folders/tags/recordings ->
// detail -> transcript/documents/questions/events/action items -> jobs.
//
// The literals are typed against the domain schemas' input types; the contract test
// (apps/server/test/api-v2.test.ts) parses every response, which also checks the id
// formats that TypeScript cannot see.

import type { z } from "zod";
import type * as D from "@lectern/domain";

type In<S extends z.ZodType> = z.input<S>;

/** Distinct, obviously fake digests. */
const sha = (n: number) => n.toString(16).padStart(64, "0");

export const ID = {
  user: "usr_00000000-0000-4000-8000-000000000001", // v1 id format, kept by the migration
  teammate: "usr_00000000-0000-4000-8000-000000000002",
  wsPersonal: "0199f0a0-1000-7000-8000-000000000001",
  wsTeam: "0199f0a0-1000-7000-8000-000000000002",
  folderLectures: "0199f0a0-2000-7000-8000-000000000001",
  folderOs: "0199f0a0-2000-7000-8000-000000000002",
  folderNetwork: "0199f0a0-2000-7000-8000-000000000003",
  folderMeetings: "0199f0a0-2000-7000-8000-000000000004",
  tagExam: "0199f0a0-3000-7000-8000-000000000001",
  tagReview: "0199f0a0-3000-7000-8000-000000000002",
  tagDecision: "0199f0a0-3000-7000-8000-000000000003",
  recOs5: "lec_0000000000a5", // v1 id format, kept by the migration
  recOs6: "0199f0a0-4000-7000-8000-000000000006",
  recSync: "0199f0a0-4000-7000-8000-000000000010",
  assetOs5Audio: "0199f0a0-5000-7000-8000-000000000001",
  assetOs5Pdf: "0199f0a0-5000-7000-8000-000000000002",
  assetOs6Audio: "0199f0a0-5000-7000-8000-000000000003",
  assetSyncAudio: "0199f0a0-5000-7000-8000-000000000004",
  spkOs5Lecturer: "0199f0a0-6000-7000-8000-000000000001",
  spkOs5Student: "0199f0a0-6000-7000-8000-000000000002",
  spkSyncHost: "0199f0a0-6000-7000-8000-000000000003",
  spkSyncMember: "0199f0a0-6000-7000-8000-000000000004",
  docOs5: "0199f0a0-7000-7000-8000-000000000001",
  docOs5V1: "0199f0a0-7100-7000-8000-000000000001",
  docOs5V2: "0199f0a0-7100-7000-8000-000000000002",
  docSync: "0199f0a0-7000-7000-8000-000000000002",
  docSyncV1: "0199f0a0-7100-7000-8000-000000000003",
  questionConvoy: "0199f0a0-8000-7000-8000-000000000001",
  questionQuantum: "0199f0a0-8000-7000-8000-000000000002",
  questionFairness: "0199f0a0-8000-7000-8000-000000000003",
  eventAssignment: "0199f0a0-9000-7000-8000-000000000001",
  eventMidterm: "0199f0a0-9000-7000-8000-000000000002",
  eventReview: "0199f0a0-9000-7000-8000-000000000003",
  actionMockups: "0199f0a0-a000-7000-8000-000000000001",
  actionNotes: "0199f0a0-a000-7000-8000-000000000002",
  jobOs5: "0199f0a0-b000-7000-8000-000000000001",
  jobOs6: "0199f0a0-b000-7000-8000-000000000002",
  jobSync: "0199f0a0-b000-7000-8000-000000000003",
  jobMaintenance: "0199f0a0-b000-7000-8000-000000000004",
  deviceWeb: "0199f0a0-c000-7000-8000-000000000001",
  deviceIphone: "0199f0a0-c000-7000-8000-000000000002",
  tokenShortcut: "0199f0a0-c100-7000-8000-000000000001",
  integrationGoogle: "0199f0a0-c200-7000-8000-000000000001",
  shareOs5Doc: "0199f0a0-c300-7000-8000-000000000001",
  usagePersonalSep: "0199f0a0-c400-7000-8000-000000000001",
  usagePersonalOct: "0199f0a0-c400-7000-8000-000000000002",
  usageTeamOct: "0199f0a0-c400-7000-8000-000000000003",
} as const;

// ---------------------------------------------------------------------------
// Me, devices, tokens
// ---------------------------------------------------------------------------

/** `system_role` is filled in per request from the caller's v1 role (see me.ts). */
export const me = {
  id: ID.user,
  email: "demo@example.com",
  display_name: "데모 사용자",
  timezone: "Asia/Seoul",
  personal_workspace_id: ID.wsPersonal,
} satisfies Omit<In<typeof D.Me>, "system_role">;

export const devices = [
  {
    id: ID.deviceWeb,
    workspace_id: ID.wsPersonal,
    user_id: ID.user,
    client: "web",
    device_name: null,
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Fixture/1.0",
    created_at: "2026-10-01T00:00:00.000Z",
    last_seen_at: "2026-10-19T00:30:00.000Z",
    expires_at: "2026-10-31T00:00:00.000Z",
    revoked_at: null,
    current: true,
  },
  {
    id: ID.deviceIphone,
    workspace_id: ID.wsPersonal,
    user_id: ID.user,
    client: "native",
    device_name: "iPhone",
    user_agent: "Lectern-iOS/2.0 Fixture",
    created_at: "2026-09-20T00:00:00.000Z",
    last_seen_at: "2026-10-18T12:00:00.000Z",
    expires_at: "2026-11-19T00:00:00.000Z",
    revoked_at: null,
    current: false,
  },
] satisfies In<typeof D.DeviceDto>[];

export const accessTokens = [
  {
    id: ID.tokenShortcut,
    workspace_id: ID.wsPersonal,
    user_id: ID.user,
    name: "iOS 단축어",
    prefix: "lpat_ab12",
    scopes: ["recordings:write"],
    expires_at: null,
    last_used_at: "2026-10-12T00:56:00.000Z",
    created_at: "2026-09-30T00:00:00.000Z",
    revoked_at: null,
  },
] satisfies In<typeof D.AccessTokenDto>[];

// ---------------------------------------------------------------------------
// Workspaces, members, folders, tags
// ---------------------------------------------------------------------------

export const workspaces = [
  {
    workspace: {
      id: ID.wsPersonal,
      name: "내 워크스페이스",
      kind: "personal",
      plan: "free",
      settings: { calendar_auto_add: { enabled: false, min_confidence: 0.85 }, default_language: "ko" },
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    },
    role: "owner",
  },
  {
    workspace: {
      id: ID.wsTeam,
      name: "프로젝트 팀",
      kind: "team",
      plan: "free",
      settings: {},
      created_at: "2026-09-15T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    },
    role: "admin",
  },
] satisfies In<typeof D.MyWorkspace>[];

export const members = [
  {
    workspace_id: ID.wsPersonal,
    user_id: ID.user,
    role: "owner",
    display_name: me.display_name,
    email: me.email,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  },
  {
    workspace_id: ID.wsTeam,
    user_id: ID.teammate,
    role: "owner",
    display_name: "동료 사용자",
    email: "teammate@example.com",
    created_at: "2026-09-15T00:00:00.000Z",
    updated_at: "2026-09-15T00:00:00.000Z",
  },
  {
    workspace_id: ID.wsTeam,
    user_id: ID.user,
    role: "admin",
    display_name: me.display_name,
    email: me.email,
    created_at: "2026-09-16T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
] satisfies In<typeof D.WorkspaceMember>[];

const folder = (id: string, workspace_id: string, parent_id: string | null, name: string, sort_key: string) => ({
  id,
  workspace_id,
  parent_id,
  name,
  sort_key,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

export const folders = [
  folder(ID.folderLectures, ID.wsPersonal, null, "강의", "a0"),
  folder(ID.folderOs, ID.wsPersonal, ID.folderLectures, "운영체제", "a0"),
  folder(ID.folderNetwork, ID.wsPersonal, ID.folderLectures, "컴퓨터 네트워크", "a1"),
  folder(ID.folderMeetings, ID.wsTeam, null, "주간 회의", "a0"),
] satisfies In<typeof D.Folder>[];

const tag = (id: string, workspace_id: string, name: string, color: string) => ({
  id,
  workspace_id,
  name,
  color,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

export const tags = [
  tag(ID.tagExam, ID.wsPersonal, "시험", "red"),
  tag(ID.tagReview, ID.wsPersonal, "복습", "blue"),
  tag(ID.tagDecision, ID.wsTeam, "결정", "green"),
] satisfies In<typeof D.Tag>[];

// ---------------------------------------------------------------------------
// Recordings and media
// ---------------------------------------------------------------------------

export const recordings = [
  {
    id: ID.recOs5,
    workspace_id: ID.wsPersonal,
    folder_id: ID.folderOs,
    title: "운영체제 5주차: CPU 스케줄링",
    domain: "lecture",
    template_id: "lecture",
    language: "ko",
    recorded_at: "2026-10-12T00:00:00.000Z",
    recorded_at_source: "client",
    duration_ms: 330_000,
    status: "ready",
    created_by: ID.user,
    visibility: "private",
    created_at: "2026-10-12T00:56:00.000Z",
    updated_at: "2026-10-12T01:12:00.000Z",
  },
  {
    id: ID.recOs6,
    workspace_id: ID.wsPersonal,
    folder_id: ID.folderOs,
    title: "운영체제 6주차",
    domain: "lecture",
    template_id: null,
    language: "ko",
    recorded_at: "2026-10-19T00:00:00.000Z",
    recorded_at_source: "media",
    duration_ms: 240_000,
    status: "processing",
    created_by: ID.user,
    visibility: "private",
    created_at: "2026-10-19T00:58:00.000Z",
    updated_at: "2026-10-19T01:02:00.000Z",
  },
  {
    id: ID.recSync,
    workspace_id: ID.wsTeam,
    folder_id: ID.folderMeetings,
    title: "주간 동기화 회의",
    domain: "meeting",
    template_id: "meeting",
    language: "ko",
    recorded_at: "2026-10-16T05:00:00.000Z",
    recorded_at_source: "client",
    duration_ms: 48_000,
    status: "ready",
    created_by: ID.teammate,
    visibility: "workspace",
    created_at: "2026-10-16T06:00:00.000Z",
    updated_at: "2026-10-16T06:09:00.000Z",
  },
] satisfies In<typeof D.Recording>[];

export const recordingTags = [
  { workspace_id: ID.wsPersonal, recording_id: ID.recOs5, tag_id: ID.tagExam, source: "ai", confidence: 0.82, created_at: "2026-10-12T01:10:00.000Z" },
  { workspace_id: ID.wsPersonal, recording_id: ID.recOs5, tag_id: ID.tagReview, source: "user", confidence: null, created_at: "2026-10-12T02:00:00.000Z" },
  { workspace_id: ID.wsTeam, recording_id: ID.recSync, tag_id: ID.tagDecision, source: "user", confidence: null, created_at: "2026-10-16T06:20:00.000Z" },
] satisfies In<typeof D.RecordingTag>[];

export const assets = [
  {
    id: ID.assetOs5Audio,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "audio",
    part_index: 0,
    sha256: sha(1),
    bytes: 5_280_000,
    mime: "audio/mp4",
    duration_ms: 330_000,
    page_count: null,
    meta: { channels: 1, sample_rate: 48_000 },
    created_at: "2026-10-12T00:56:00.000Z",
  },
  {
    id: ID.assetOs5Pdf,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "pdf",
    part_index: 0,
    sha256: sha(2),
    bytes: 1_200_000,
    mime: "application/pdf",
    duration_ms: null,
    page_count: 12,
    meta: { filename: "week05-slides.pdf" },
    created_at: "2026-10-12T00:56:00.000Z",
  },
  {
    id: ID.assetOs6Audio,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs6,
    kind: "audio",
    part_index: 0,
    sha256: sha(3),
    bytes: 3_840_000,
    mime: "audio/mp4",
    duration_ms: 240_000,
    page_count: null,
    meta: { channels: 1, sample_rate: 48_000 },
    created_at: "2026-10-19T00:58:00.000Z",
  },
  {
    id: ID.assetSyncAudio,
    workspace_id: ID.wsTeam,
    recording_id: ID.recSync,
    kind: "audio",
    part_index: 0,
    sha256: sha(4),
    bytes: 768_000,
    mime: "audio/webm",
    duration_ms: 48_000,
    page_count: null,
    meta: { channels: 1, sample_rate: 48_000 },
    created_at: "2026-10-16T06:00:00.000Z",
  },
] satisfies In<typeof D.AssetDto>[];

export const speakers = [
  { id: ID.spkOs5Lecturer, workspace_id: ID.wsPersonal, recording_id: ID.recOs5, label: "S1", display_name: "교수", confidence: 0.91, created_at: "2026-10-12T01:05:00.000Z", updated_at: "2026-10-12T02:00:00.000Z" },
  { id: ID.spkOs5Student, workspace_id: ID.wsPersonal, recording_id: ID.recOs5, label: "S2", display_name: null, confidence: 0.64, created_at: "2026-10-12T01:05:00.000Z", updated_at: "2026-10-12T01:05:00.000Z" },
  { id: ID.spkSyncHost, workspace_id: ID.wsTeam, recording_id: ID.recSync, label: "S1", display_name: "진행자", confidence: 0.88, created_at: "2026-10-16T06:04:00.000Z", updated_at: "2026-10-16T06:30:00.000Z" },
  { id: ID.spkSyncMember, workspace_id: ID.wsTeam, recording_id: ID.recSync, label: "S2", display_name: null, confidence: 0.7, created_at: "2026-10-16T06:04:00.000Z", updated_at: "2026-10-16T06:04:00.000Z" },
] satisfies In<typeof D.Speaker>[];

type SegmentInput = In<typeof D.TranscriptSegment>;

function segments(
  workspace_id: string,
  recording_id: string,
  rows: Array<[start_ms: number, end_ms: number, speaker_id: string, text: string, source_chunk: number]>
): SegmentInput[] {
  return rows.map(([start_ms, end_ms, speaker_id, text, source_chunk], idx) => ({
    workspace_id,
    recording_id,
    idx,
    start_ms,
    end_ms,
    speaker_id,
    text,
    confidence: 0.9,
    source_chunk,
  }));
}

export const transcripts = [
  {
    recording_id: ID.recOs5,
    segments: segments(ID.wsPersonal, ID.recOs5, [
      [0, 8_000, ID.spkOs5Lecturer, "지난주에 이어서 오늘은 CPU 스케줄링을 다룹니다.", 0],
      [8_000, 19_000, ID.spkOs5Lecturer, "스케줄러는 준비 큐에 있는 프로세스 중 다음에 실행할 것을 고릅니다.", 0],
      [19_000, 31_000, ID.spkOs5Lecturer, "가장 단순한 방식은 먼저 도착한 순서대로 처리하는 FCFS입니다.", 0],
      [31_000, 44_000, ID.spkOs5Lecturer, "FCFS에서는 긴 작업 뒤에 짧은 작업들이 줄줄이 기다리는 호위 효과가 생깁니다.", 0],
      [44_000, 52_000, ID.spkOs5Student, "라운드 로빈에서 타임 퀀텀은 어떻게 정하나요?", 0],
      [52_000, 66_000, ID.spkOs5Lecturer, "퀀텀이 너무 크면 FCFS와 같아지고, 너무 작으면 문맥 교환 비용이 커집니다.", 0],
      [300_000, 312_000, ID.spkOs5Lecturer, "다음 주 수요일까지 스케줄링 과제를 제출하세요.", 1],
      [312_000, 325_000, ID.spkOs5Lecturer, "중간고사는 10월 27일이고 오늘 내용까지 범위에 들어갑니다.", 1],
    ]),
    speakers: speakers.filter((s) => s.recording_id === ID.recOs5),
    gaps: [
      { kind: "break", start_ms: 66_000, end_ms: 300_000 },
      { kind: "tail", start_ms: 325_000, end_ms: 330_000 },
    ],
  },
  {
    // Still processing: nothing published yet.
    recording_id: ID.recOs6,
    segments: [],
    speakers: [],
    gaps: [],
  },
  {
    recording_id: ID.recSync,
    segments: segments(ID.wsTeam, ID.recSync, [
      [0, 9_000, ID.spkSyncHost, "이번 주 진행 상황부터 공유하겠습니다.", 0],
      [9_000, 21_000, ID.spkSyncMember, "업로드 재개 기능은 테스트까지 끝났습니다.", 0],
      [21_000, 33_000, ID.spkSyncHost, "온보딩 화면 시안은 수요일까지 공유해 주세요.", 0],
      [33_000, 45_000, ID.spkSyncHost, "디자인 리뷰는 금요일 오후 세 시에 하겠습니다.", 0],
    ]),
    speakers: speakers.filter((s) => s.recording_id === ID.recSync),
    gaps: [{ kind: "tail", start_ms: 45_000, end_ms: 48_000 }],
  },
] satisfies In<typeof D.Transcript>[];

/** Text of PDF pages, for search hits. */
export const pdfPages = [
  { asset_id: ID.assetOs5Pdf, recording_id: ID.recOs5, page: 4, text: "평균 대기 시간은 각 프로세스 대기 시간의 평균이다." },
];

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const ref = (start_idx: number, end_idx = start_idx) => ({ kind: "transcript" as const, start_idx, end_idx });

type BodyInput = In<typeof D.DocumentBody>;

function os5Body(summary: string): BodyInput {
  return {
    sections: [
      {
        key: "summary",
        title: "핵심 요약",
        blocks: [
          { id: "b1", type: "paragraph", heading: null, text: summary, sources: [ref(0, 1)] },
          {
            id: "b2",
            type: "list",
            heading: null,
            style: "bullet",
            items: [
              { text: "FCFS는 단순하지만 호위 효과가 생길 수 있다.", sources: [ref(2, 3)] },
              { text: "라운드 로빈은 타임 퀀텀 크기가 성능을 좌우한다.", sources: [ref(4, 5)] },
            ],
            sources: [],
          },
        ],
      },
      {
        key: "topics",
        title: "주제별 상세",
        blocks: [
          { id: "b3", type: "term", heading: "FCFS", term: "호위 효과", definition: "긴 작업 뒤에 짧은 작업들이 줄줄이 기다리는 현상", sources: [ref(3)] },
          { id: "b4", type: "quote", heading: null, text: "퀀텀이 너무 크면 FCFS와 같아지고, 너무 작으면 문맥 교환 비용이 커집니다.", speaker: "S1", sources: [ref(5)] },
          { id: "b5", type: "gap", heading: null, kind: "break", start_ms: 66_000, end_ms: 300_000, sources: [] },
          {
            id: "b6",
            type: "formula",
            heading: "평균 대기 시간",
            expression: "\\bar{W} = \\frac{1}{n}\\sum_{i=1}^{n} W_i",
            explanation: "n개 프로세스 대기 시간의 평균",
            sources: [{ kind: "pdf_page", asset_id: ID.assetOs5Pdf, page: 4 }],
          },
        ],
      },
      {
        key: "notices",
        title: "공지",
        blocks: [
          { id: "b7", type: "callout", heading: null, tone: "assignment", text: "다음 주 수요일까지 스케줄링 과제 제출", sources: [ref(6)] },
          { id: "b8", type: "callout", heading: null, tone: "exam", text: "중간고사는 10월 27일이며 오늘 내용까지 포함된다.", sources: [ref(7)] },
        ],
      },
    ],
  };
}

const syncBody: BodyInput = {
  sections: [
    {
      key: "summary",
      title: "요약",
      blocks: [{ id: "b1", type: "paragraph", heading: null, text: "업로드 재개 기능의 테스트가 끝났고, 온보딩 시안과 디자인 리뷰 일정을 정했다.", sources: [ref(0, 3)] }],
    },
    {
      key: "decisions",
      title: "결정 사항",
      blocks: [
        {
          id: "b2",
          type: "list",
          heading: null,
          style: "bullet",
          items: [{ text: "디자인 리뷰는 금요일 오후 세 시에 한다.", sources: [ref(3)] }],
          sources: [],
        },
      ],
    },
  ],
};

/** Fixture-only Markdown rendering; the real renderer comes with the harness `publish` stage. */
function renderMarkdown(title: string, body: BodyInput): string {
  const lines = [`# ${title}`];
  for (const section of body.sections) {
    lines.push("", `## ${section.title}`);
    for (const block of section.blocks) {
      if (block.heading) lines.push("", `### ${block.heading}`);
      switch (block.type) {
        case "paragraph":
          lines.push("", block.text);
          break;
        case "list":
          lines.push("", ...block.items.map((item, i) => (block.style === "numbered" ? `${i + 1}. ` : "- ") + item.text));
          break;
        case "quote":
          lines.push("", `> ${block.text}`);
          break;
        case "term":
          lines.push("", `**${block.term}**: ${block.definition}`);
          break;
        case "formula":
          lines.push("", `$$${block.expression}$$`, ...(block.explanation ? ["", block.explanation] : []));
          break;
        case "callout":
          lines.push("", `> **${block.tone}** ${block.text}`);
          break;
        case "gap":
          lines.push("", "_(전사 없음)_");
          break;
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

const os5V1Body = os5Body("스케줄러는 준비 큐에서 다음에 실행할 프로세스를 고른다.");
const os5V2Body = os5Body("스케줄러는 준비 큐에서 다음에 실행할 프로세스를 고르며, 방식에 따라 대기 시간과 응답성이 달라진다.");

export const documents = [
  {
    id: ID.docOs5,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    template_id: "lecture",
    template_version: 1,
    current_version: 2,
    user_edited: true,
    created_at: "2026-10-12T01:12:00.000Z",
    updated_at: "2026-10-12T02:00:00.000Z",
  },
  {
    id: ID.docSync,
    workspace_id: ID.wsTeam,
    recording_id: ID.recSync,
    template_id: "meeting",
    template_version: 1,
    current_version: 1,
    user_edited: false,
    created_at: "2026-10-16T06:09:00.000Z",
    updated_at: "2026-10-16T06:09:00.000Z",
  },
] satisfies In<typeof D.Document>[];

export const documentVersions = [
  {
    id: ID.docOs5V1,
    workspace_id: ID.wsPersonal,
    document_id: ID.docOs5,
    recording_id: ID.recOs5,
    version: 1,
    base_version: null,
    template_id: "lecture",
    template_version: 1,
    body: os5V1Body,
    rendered_md: renderMarkdown(recordings[0].title, os5V1Body),
    created_by: "ai",
    author_id: null,
    created_at: "2026-10-12T01:12:00.000Z",
  },
  {
    id: ID.docOs5V2,
    workspace_id: ID.wsPersonal,
    document_id: ID.docOs5,
    recording_id: ID.recOs5,
    version: 2,
    base_version: 1,
    template_id: "lecture",
    template_version: 1,
    body: os5V2Body,
    rendered_md: renderMarkdown(recordings[0].title, os5V2Body),
    created_by: "user",
    author_id: ID.user,
    created_at: "2026-10-12T02:00:00.000Z",
  },
  {
    id: ID.docSyncV1,
    workspace_id: ID.wsTeam,
    document_id: ID.docSync,
    recording_id: ID.recSync,
    version: 1,
    base_version: null,
    template_id: "meeting",
    template_version: 1,
    body: syncBody,
    rendered_md: renderMarkdown(recordings[2].title, syncBody),
    created_by: "ai",
    author_id: null,
    created_at: "2026-10-16T06:09:00.000Z",
  },
] satisfies In<typeof D.DocumentVersion>[];

// ---------------------------------------------------------------------------
// Extracted items
// ---------------------------------------------------------------------------

export const questions = [
  {
    id: ID.questionConvoy,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "recall",
    prompt: "FCFS 스케줄링에서 호위 효과란 무엇인가?",
    answer: "긴 작업이 CPU를 오래 차지해 뒤의 짧은 작업들이 함께 오래 기다리는 현상이다.",
    sources: [ref(3)],
    difficulty: "easy",
    flags: [],
    created_at: "2026-10-12T01:12:00.000Z",
    updated_at: "2026-10-12T01:12:00.000Z",
  },
  {
    id: ID.questionQuantum,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "recall",
    prompt: "라운드 로빈에서 타임 퀀텀이 너무 작으면 어떤 문제가 생기는가?",
    answer: "문맥 교환이 잦아져 오버헤드가 커진다.",
    sources: [ref(5)],
    difficulty: "medium",
    flags: [],
    created_at: "2026-10-12T01:12:00.000Z",
    updated_at: "2026-10-12T01:12:00.000Z",
  },
  {
    id: ID.questionFairness,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "discussion",
    prompt: "짧은 작업을 항상 먼저 처리하면 어떤 공정성 문제가 생길까?",
    answer: null,
    sources: [ref(2, 3)],
    difficulty: null,
    flags: [],
    created_at: "2026-10-12T01:12:00.000Z",
    updated_at: "2026-10-12T01:12:00.000Z",
  },
] satisfies In<typeof D.Question>[];

export const eventCandidates = [
  {
    id: ID.eventAssignment,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "deadline",
    title: "스케줄링 과제 제출",
    start_at: "2026-10-20T15:00:00.000Z", // 2026-10-21 (Wed) local midnight, Asia/Seoul
    end_at: "2026-10-21T15:00:00.000Z",
    all_day: true,
    tz: "Asia/Seoul",
    raw_expression: "다음 주 수요일까지",
    resolution: { method: "parser", rule: "next_week_weekday" },
    confidence: 0.81,
    evidence: { sources: [ref(6)], quote: "다음 주 수요일까지 스케줄링 과제를 제출하세요." },
    flags: [],
    status: "suggested",
    created_at: "2026-10-12T01:12:00.000Z",
    updated_at: "2026-10-12T01:12:00.000Z",
  },
  {
    id: ID.eventMidterm,
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs5,
    kind: "exam",
    title: "운영체제 중간고사",
    start_at: "2026-10-26T15:00:00.000Z", // 2026-10-27 local midnight, Asia/Seoul
    end_at: "2026-10-27T15:00:00.000Z",
    all_day: true,
    tz: "Asia/Seoul",
    raw_expression: "10월 27일",
    resolution: { method: "parser", rule: "absolute_date" },
    confidence: 0.94,
    evidence: { sources: [ref(7)], quote: "중간고사는 10월 27일이고" },
    flags: [],
    status: "accepted",
    created_at: "2026-10-12T01:12:00.000Z",
    updated_at: "2026-10-12T03:00:00.000Z",
  },
  {
    id: ID.eventReview,
    workspace_id: ID.wsTeam,
    recording_id: ID.recSync,
    kind: "meeting",
    title: "디자인 리뷰",
    start_at: "2026-10-23T06:00:00.000Z", // 15:00 Asia/Seoul
    end_at: null,
    all_day: false,
    tz: "Asia/Seoul",
    raw_expression: "금요일 오후 세 시",
    resolution: { method: "model", rule: null },
    confidence: 0.66,
    evidence: { sources: [ref(3)], quote: "디자인 리뷰는 금요일 오후 세 시에 하겠습니다." },
    flags: ["needs_review"],
    status: "suggested",
    created_at: "2026-10-16T06:09:00.000Z",
    updated_at: "2026-10-16T06:09:00.000Z",
  },
] satisfies In<typeof D.EventCandidate>[];

export const actionItems = [
  {
    id: ID.actionMockups,
    workspace_id: ID.wsTeam,
    recording_id: ID.recSync,
    text: "온보딩 화면 시안 공유",
    owner_name: null,
    due_at: "2026-10-21T09:00:00.000Z",
    due_raw: "수요일까지",
    status: "open",
    evidence: { sources: [ref(2)], quote: "온보딩 화면 시안은 수요일까지 공유해 주세요." },
    flags: [],
    created_at: "2026-10-16T06:09:00.000Z",
    updated_at: "2026-10-16T06:09:00.000Z",
  },
  {
    id: ID.actionNotes,
    workspace_id: ID.wsTeam,
    recording_id: ID.recSync,
    text: "업로드 재개 기능 테스트 결과 정리",
    owner_name: "동료 사용자",
    due_at: null,
    due_raw: null,
    status: "done",
    evidence: { sources: [ref(1)], quote: null },
    flags: ["low_confidence"],
    created_at: "2026-10-16T06:09:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
  },
] satisfies In<typeof D.ActionItem>[];

// ---------------------------------------------------------------------------
// Jobs, stage runs, model calls, usage
// ---------------------------------------------------------------------------

type JobInput = In<typeof D.Job>;

const job = (fields: Pick<JobInput, "id" | "workspace_id" | "recording_id" | "kind" | "state" | "created_at" | "updated_at"> & Partial<JobInput>): JobInput => ({
  priority: 0,
  run_after: fields.created_at,
  attempts: 1,
  lease_owner: null,
  lease_until: null,
  budget_microusd: fields.kind === "process" ? 500_000 : null,
  spent_microusd: 0,
  idempotency_key: null,
  error_code: null,
  ...fields,
});

export const jobs = [
  job({ id: ID.jobOs6, workspace_id: ID.wsPersonal, recording_id: ID.recOs6, kind: "process", state: "running", lease_owner: "worker-1", lease_until: "2026-10-19T01:07:00.000Z", spent_microusd: 6_400, created_at: "2026-10-19T00:58:00.000Z", updated_at: "2026-10-19T01:02:00.000Z" }),
  job({ id: ID.jobSync, workspace_id: ID.wsTeam, recording_id: ID.recSync, kind: "process", state: "succeeded", spent_microusd: 4_100, created_at: "2026-10-16T06:00:00.000Z", updated_at: "2026-10-16T06:09:00.000Z" }),
  job({ id: ID.jobOs5, workspace_id: ID.wsPersonal, recording_id: ID.recOs5, kind: "process", state: "succeeded", spent_microusd: 21_300, idempotency_key: "fixture-upload-os5", created_at: "2026-10-12T00:56:00.000Z", updated_at: "2026-10-12T01:12:00.000Z" }),
  job({ id: ID.jobMaintenance, workspace_id: null, recording_id: null, kind: "maintenance", state: "succeeded", priority: -10, created_at: "2026-10-12T00:00:00.000Z", updated_at: "2026-10-12T00:01:00.000Z" }),
] satisfies JobInput[];

type StageRunInput = In<typeof D.StageRun>;

let stageRunSeq = 0;
function stageRun(
  job_id: string,
  workspace_id: string | null,
  stage: StageRunInput["stage"],
  state: StageRunInput["state"],
  started_at: string | null,
  finished_at: string | null,
  chunk_index: number | null = null
): StageRunInput {
  stageRunSeq += 1;
  return {
    id: `0199f0a0-d000-7000-8000-${String(stageRunSeq).padStart(12, "0")}`,
    workspace_id,
    job_id,
    stage,
    chunk_index,
    state,
    input_hash: sha(0x1000 + stageRunSeq),
    output_artifact_ids: [],
    cache_hit: false,
    attempts: state === "pending" ? 0 : 1,
    started_at,
    finished_at,
    error: null,
    created_at: started_at ?? "2026-10-19T00:58:00.000Z",
  };
}

export const stageRuns = [
  stageRun(ID.jobOs5, ID.wsPersonal, "ingest", "succeeded", "2026-10-12T00:56:10.000Z", "2026-10-12T00:56:20.000Z"),
  stageRun(ID.jobOs5, ID.wsPersonal, "transcribe", "succeeded", "2026-10-12T00:57:00.000Z", "2026-10-12T01:03:00.000Z", 0),
  stageRun(ID.jobOs5, ID.wsPersonal, "transcribe", "succeeded", "2026-10-12T00:57:00.000Z", "2026-10-12T01:04:00.000Z", 1),
  stageRun(ID.jobOs5, ID.wsPersonal, "merge", "succeeded", "2026-10-12T01:04:00.000Z", "2026-10-12T01:04:05.000Z"),
  stageRun(ID.jobOs5, ID.wsPersonal, "structure", "succeeded", "2026-10-12T01:05:00.000Z", "2026-10-12T01:09:00.000Z"),
  stageRun(ID.jobOs5, ID.wsPersonal, "verify", "succeeded", "2026-10-12T01:09:00.000Z", "2026-10-12T01:10:00.000Z"),
  stageRun(ID.jobOs5, ID.wsPersonal, "publish", "succeeded", "2026-10-12T01:11:00.000Z", "2026-10-12T01:12:00.000Z"),
  stageRun(ID.jobOs6, ID.wsPersonal, "ingest", "succeeded", "2026-10-19T00:58:10.000Z", "2026-10-19T00:58:20.000Z"),
  stageRun(ID.jobOs6, ID.wsPersonal, "transcribe", "succeeded", "2026-10-19T00:59:00.000Z", "2026-10-19T01:01:00.000Z", 0),
  stageRun(ID.jobOs6, ID.wsPersonal, "transcribe", "running", "2026-10-19T00:59:00.000Z", null, 1),
  stageRun(ID.jobOs6, ID.wsPersonal, "transcribe", "pending", null, null, 2),
  stageRun(ID.jobSync, ID.wsTeam, "transcribe", "succeeded", "2026-10-16T06:01:00.000Z", "2026-10-16T06:04:00.000Z", 0),
  stageRun(ID.jobSync, ID.wsTeam, "publish", "succeeded", "2026-10-16T06:08:00.000Z", "2026-10-16T06:09:00.000Z"),
  stageRun(ID.jobMaintenance, null, "maintenance", "succeeded", "2026-10-12T00:00:00.000Z", "2026-10-12T00:01:00.000Z"),
] satisfies StageRunInput[];

const runOf = (job_id: string, stage: string, chunk_index: number | null = null) =>
  stageRuns.find((r) => r.job_id === job_id && r.stage === stage && r.chunk_index === chunk_index)!;

type AiCallInput = In<typeof D.AiCall>;

function aiCall(n: number, run: StageRunInput, recording_id: string, fields: Partial<AiCallInput>): AiCallInput {
  return {
    id: `0199f0a0-e000-7000-8000-${String(n).padStart(12, "0")}`,
    workspace_id: run.workspace_id!,
    stage_run_id: run.id,
    recording_id,
    provider: "gemini",
    model: "gemini-3.8-flash",
    model_version: "gemini-3.8-flash-001",
    input_tokens: 0,
    cached_tokens: 0,
    output_tokens: 0,
    audio_seconds: 0,
    cost_microusd: 0,
    latency_ms: 0,
    status: "ok",
    request_id: null,
    error_code: null,
    created_at: run.finished_at ?? run.started_at!,
    ...fields,
  };
}

export const aiCalls = [
  aiCall(1, runOf(ID.jobOs5, "transcribe", 0), ID.recOs5, { input_tokens: 5_200, output_tokens: 1_100, audio_seconds: 66, cost_microusd: 6_100, latency_ms: 21_000 }),
  aiCall(2, runOf(ID.jobOs5, "transcribe", 1), ID.recOs5, { input_tokens: 2_100, output_tokens: 420, audio_seconds: 30, cost_microusd: 2_800, latency_ms: 9_500 }),
  aiCall(3, runOf(ID.jobOs5, "structure"), ID.recOs5, { input_tokens: 9_800, cached_tokens: 2_000, output_tokens: 2_400, cost_microusd: 12_400, latency_ms: 38_000 }),
  aiCall(4, runOf(ID.jobOs6, "transcribe", 0), ID.recOs6, { input_tokens: 4_800, output_tokens: 1_000, audio_seconds: 60, cost_microusd: 6_400, latency_ms: 19_000 }),
  aiCall(5, runOf(ID.jobSync, "transcribe", 0), ID.recSync, { input_tokens: 3_100, output_tokens: 600, audio_seconds: 48, cost_microusd: 4_100, latency_ms: 12_000 }),
] satisfies AiCallInput[];

export const usage = [
  { id: ID.usagePersonalOct, workspace_id: ID.wsPersonal, period: "2026-10", audio_ms: 570_000, ai_cost_microusd: 27_700, storage_bytes: 10_320_000, updated_at: "2026-10-19T01:02:00.000Z" },
  { id: ID.usageTeamOct, workspace_id: ID.wsTeam, period: "2026-10", audio_ms: 48_000, ai_cost_microusd: 4_100, storage_bytes: 768_000, updated_at: "2026-10-16T06:09:00.000Z" },
  { id: ID.usagePersonalSep, workspace_id: ID.wsPersonal, period: "2026-09", audio_ms: 2_400_000, ai_cost_microusd: 96_000, storage_bytes: 38_400_000, updated_at: "2026-09-30T23:00:00.000Z" },
] satisfies In<typeof D.UsageLedger>[];

// ---------------------------------------------------------------------------
// Integrations, share links
// ---------------------------------------------------------------------------

export const integrations = [
  {
    id: ID.integrationGoogle,
    workspace_id: ID.wsPersonal,
    user_id: ID.user,
    provider: "google",
    scopes: ["calendar.app.created"],
    calendar_id: "fixture-lectern-calendar",
    status: "active",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-12T03:00:00.000Z",
  },
] satisfies In<typeof D.IntegrationDto>[];

export const shareLinks = [
  {
    id: ID.shareOs5Doc,
    workspace_id: ID.wsPersonal,
    target_type: "document",
    target_id: ID.docOs5,
    scope: { transcript: true, audio: false },
    expires_at: "2026-11-12T00:00:00.000Z",
    has_password: false,
    created_by: ID.user,
    created_at: "2026-10-12T02:10:00.000Z",
    revoked_at: null,
  },
] satisfies In<typeof D.ShareLinkDto>[];

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/** The event log the SSE stub replays, oldest first (`job_events` order). */
export const serverEvents = [
  {
    id: "1001",
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs6,
    created_at: "2026-10-19T00:58:00.000Z",
    type: "recording.created",
    payload: { recording: { ...recordings[1], status: "queued", updated_at: "2026-10-19T00:58:00.000Z" } },
  },
  {
    id: "1002",
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs6,
    created_at: "2026-10-19T00:58:10.000Z",
    type: "job.updated",
    payload: { job: jobs[0] },
  },
  {
    id: "1003",
    workspace_id: ID.wsTeam,
    recording_id: ID.recSync,
    created_at: "2026-10-19T01:00:00.000Z",
    type: "document.updated",
    payload: { document_id: ID.docSync, version: 1 },
  },
  {
    id: "1004",
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs6,
    created_at: "2026-10-19T01:02:00.000Z",
    type: "job.progress",
    payload: { job_id: ID.jobOs6, stage: "transcribe", state: "running", progress: 0.35, chunk_index: 1, chunk_count: 3 },
  },
  {
    id: "1005",
    workspace_id: ID.wsPersonal,
    recording_id: ID.recOs6,
    created_at: "2026-10-19T01:02:00.000Z",
    type: "recording.updated",
    payload: { recording: recordings[1] },
  },
] satisfies In<typeof D.ServerEvent>[];
