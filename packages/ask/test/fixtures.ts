// Synthetic notes for the ask tests. Invented text only: no real recording or person.

import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "@lectern/db";
import { AskScope, DocumentBody } from "@lectern/domain";
import type { z } from "zod";
import { chunkRecording, type RecordingSources, type SegmentInput, syncRecordingChunks } from "../src/index.ts";
import type { FolderRow, RecordingAccessRow } from "../src/scope.ts";

export const WS = "ws_personal";
export const WS_OTHER = "ws_other";
export const ME = "usr_me";
export const TEAMMATE = "usr_teammate";

export const REC = {
  crypto: "rec_crypto",
  meeting: "rec_meeting",
  privateTeammate: "rec_private_teammate",
  otherWorkspace: "rec_other_ws",
  long: "rec_long",
} as const;

export const FOLDERS: FolderRow[] = [
  { id: "fld_school", workspace_id: WS, parent_id: null },
  { id: "fld_security", workspace_id: WS, parent_id: "fld_school" },
  { id: "fld_work", workspace_id: WS, parent_id: null },
];

const T = "2026-10-14T01:00:00.000Z";

export const RECORDINGS: RecordingAccessRow[] = [
  { id: REC.crypto, workspace_id: WS, folder_id: "fld_security", visibility: "private", created_by: ME, title: "정보보호 7주차", recorded_at: T, status: "ready" },
  { id: REC.meeting, workspace_id: WS, folder_id: "fld_work", visibility: "workspace", created_by: TEAMMATE, title: "주간 회의", recorded_at: "2026-10-16T05:00:00.000Z", status: "ready" },
  { id: REC.privateTeammate, workspace_id: WS, folder_id: "fld_work", visibility: "private", created_by: TEAMMATE, title: "팀원 개인 메모", recorded_at: T, status: "ready" },
  { id: REC.otherWorkspace, workspace_id: WS_OTHER, folder_id: null, visibility: "workspace", created_by: ME, title: "다른 워크스페이스", recorded_at: T, status: "ready" },
  { id: REC.long, workspace_id: WS, folder_id: "fld_school", visibility: "workspace", created_by: ME, title: "운영체제 긴 강의", recorded_at: T, status: "ready" },
];

let ms = 0;
function seg(idx: number, speaker: string | null, text: string, gapMs = 400): SegmentInput {
  const start = ms + gapMs;
  const end = start + Math.max(2_000, text.length * 180);
  ms = end;
  return { idx, start_ms: start, end_ms: end, speaker_id: speaker, text };
}

function cryptoSegments(): SegmentInput[] {
  ms = 0;
  return [
    seg(0, "spk_prof", "오늘은 대칭키 암호의 운영 모드를 보겠습니다."),
    seg(1, "spk_prof", "먼저 ECB 모드는 같은 평문 블록을 항상 같은 암호문 블록으로 바꿉니다."),
    seg(2, "spk_student", "질문 있는데요, ECB가 왜 위험한가요?"),
    seg(3, "spk_prof", "평문의 패턴이 암호문에 그대로 드러나서 위험합니다. 그래서 실제로는 쓰면 안 됩니다."),
    seg(4, "spk_prof", "CBC 모드는 이전 암호문 블록을 다음 평문 블록과 XOR한 뒤에 암호화합니다.", 3_000),
    seg(5, "spk_prof", "CBC에는 초기화 벡터, 즉 IV가 필요하고 IV는 예측할 수 없어야 합니다."),
    seg(6, "spk_prof", "시험 범위는 운영 모드까지입니다. CBC 복호화 그림은 꼭 시험에 나옵니다.", 90_000),
    seg(7, "spk_prof", "과제 3은 다음 주 화요일 수업 전까지 제출하세요."),
  ];
}

/** Parses a scope literal so test ids get their domain brands. */
export const scopeOf = (scope: z.input<typeof AskScope>): AskScope => AskScope.parse(scope);

export const SPEAKERS = new Map([
  ["spk_prof", "S1"],
  ["spk_student", "S2"],
]);

export const CRYPTO_DOC = DocumentBody.parse({
  sections: [
    {
      key: "summary",
      title: "핵심 요약",
      blocks: [
        { id: "b1", type: "paragraph", heading: null, text: "ECB는 같은 평문 블록을 같은 암호문으로 바꿔 패턴이 드러난다.", sources: [{ kind: "transcript", start_idx: 1, end_idx: 3 }] },
        {
          id: "b2",
          type: "list",
          heading: null,
          style: "bullet",
          items: [
            { text: "CBC는 IV가 필요하다.", sources: [{ kind: "transcript", start_idx: 5, end_idx: 5 }] },
            { text: "IV는 예측할 수 없어야 한다.", sources: [{ kind: "transcript", start_idx: 5, end_idx: 5 }] },
          ],
          sources: [],
        },
      ],
    },
    {
      key: "exam",
      title: "시험·과제",
      blocks: [
        { id: "b3", type: "callout", heading: null, tone: "exam", text: "시험 범위는 운영 모드까지, CBC 복호화 그림 출제.", sources: [{ kind: "transcript", start_idx: 6, end_idx: 6 }] },
        { id: "b4", type: "gap", heading: null, kind: "break", start_ms: 60_000, end_ms: 90_000, sources: [] },
      ],
    },
  ],
});

export function cryptoSources(): RecordingSources {
  return {
    workspaceId: WS,
    recordingId: REC.crypto,
    transcript: { segments: cryptoSegments(), speakers: SPEAKERS },
    document: { kind: "blocks", documentId: "doc_crypto", version: 2, body: CRYPTO_DOC },
  };
}

export function meetingSources(): RecordingSources {
  ms = 0;
  return {
    workspaceId: WS,
    recordingId: REC.meeting,
    transcript: {
      segments: [
        seg(0, "spk_a", "이번 주 회의 안건은 출시 일정입니다."),
        seg(1, "spk_b", "QA를 일주일 당기기로 결정했습니다."),
        seg(2, "spk_a", "출시일은 11월 3일로 확정합니다. 마감 전에 회의록을 공유해 주세요."),
      ],
      speakers: new Map([
        ["spk_a", "S1"],
        ["spk_b", "S2"],
      ]),
    },
  };
}

export function privateSources(): RecordingSources {
  ms = 0;
  return {
    workspaceId: WS,
    recordingId: REC.privateTeammate,
    transcript: { segments: [seg(0, null, "비밀 메모: 연봉 협상 전략과 출시 일정 걱정.")] },
  };
}

export function otherWorkspaceSources(): RecordingSources {
  ms = 0;
  return {
    workspaceId: WS_OTHER,
    recordingId: REC.otherWorkspace,
    transcript: { segments: [seg(0, null, "다른 워크스페이스의 ECB 운영 모드 시험 범위 이야기.")] },
  };
}

/** A note well over the full-note budget: 320 segments on unrelated topics plus one fact. */
export function longSources(): RecordingSources {
  ms = 0;
  const topics = ["프로세스 스케줄링", "가상 메모리", "페이지 교체", "교착 상태", "파일 시스템", "동기화"];
  const segments: SegmentInput[] = [];
  for (let i = 0; i < 320; i++) {
    const topic = topics[i % topics.length]!;
    segments.push(seg(i, "spk_prof", `${topic}에 대해 자세히 설명하는 ${i}번째 문장입니다. 개념과 예시를 함께 들고 교과서 내용을 다시 정리합니다.`));
  }
  segments[197] = { ...segments[197]!, text: "라운드 로빈의 타임 퀀텀은 보통 10밀리초에서 100밀리초 사이로 잡습니다." };
  return { workspaceId: WS, recordingId: REC.long, transcript: { segments } };
}

/**
 * Lecture PDF pages only (P3-06): slides of the crypto lecture, a teammate's private PDF and
 * one in another workspace. No transcript or document, so indexing them replaces PDF chunks only.
 */
export function pdfSources(): RecordingSources[] {
  return [
    {
      workspaceId: WS,
      recordingId: REC.crypto,
      pdfs: [
        {
          assetId: "ast_slides",
          pages: [
            { page: 1, text: "운영 모드 비교표 ECB CBC CTR 슬라이드" },
            { page: 2, text: "키 확장 서브키 스케줄 AES-256은 14라운드를 쓴다" },
          ],
        },
      ],
    },
    { workspaceId: WS, recordingId: REC.privateTeammate, pdfs: [{ assetId: "ast_secret", pages: [{ page: 1, text: "비밀 연봉 협상 자료 급여 테이블" }] }] },
    { workspaceId: WS_OTHER, recordingId: REC.otherWorkspace, pdfs: [{ assetId: "ast_other", pages: [{ page: 1, text: "타사 로드맵 보안 문서" }] }] },
  ];
}

export function tempDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db, { backupDir: join(mkdtempSync(join(tmpdir(), "lectern-ask-")), "backups") });
  return db;
}

/** A migrated DB with every fixture note indexed (no embeddings). */
export function seededDb(): Database {
  const db = tempDb();
  for (const src of [cryptoSources(), meetingSources(), privateSources(), otherWorkspaceSources(), longSources()]) {
    const chunks = chunkRecording(src);
    syncRecordingChunks(db, {
      workspaceId: src.workspaceId,
      recordingId: src.recordingId,
      kinds: ["transcript", "document", "pdf_page"],
      chunks,
    });
  }
  return db;
}
