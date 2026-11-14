// ApiClient backed by the in-memory fixture data set. It behaves like the /api/v2
// contract where the shell depends on it: cursor pages, domain error codes, a resumable
// upload with a part plan, workspace roles (members cannot delete others' recordings),
// and an event stream that replays the current job progress on subscribe. Changes live
// in memory only and are gone after a reload.

import type {
  AskScope,
  AskStreamEvent,
  AskThread,
  AskThreadId,
  AskTurn,
  AskTurnId,
  AssetDto,
  AssetId,
  AssetPages,
  CompleteUploadResponse,
  CreateUploadRequest,
  DocumentBlock,
  DocumentBody,
  DocumentVersion,
  DocumentVersionId,
  EventCandidate,
  FolderId,
  JobId,
  Recording,
  RecordingDetail,
  RecordingId,
  SearchHit,
  ReprocessResponse,
  OcrAssetResponse,
  ShareLinkDto,
  ServerEvent,
  TagId,
  Transcript,
  UpdateEventCandidateRequest,
  UpdateRecordingRequest,
  CreateFolderRequest,
  CreateTagRequest,
  Folder,
  Tag,
  UpdateFolderRequest,
  UpdateMeRequest,
  UpdateTagRequest,
  ActionItem,
  UpdateActionItemRequest,
  UploadId,
  UploadPartReceipt,
  UploadSession,
  WorkspaceId,
} from "../types.ts";
import { buildFixtureData, PDF_PAGE_TEXTS, processRecording, TEMPLATE_FOR, type FixtureData, type JobProgress } from "../../fixtures/index.ts";
import { UPLOADED_GENERIC_DOC } from "../../fixtures/documents.ts";
import { UPLOADED_GENERIC } from "../../fixtures/scripts.ts";
import { parseFileName } from "../../lib/pairing.ts";
import { ApiClientError, type ApiClient, type SessionUser } from "../client.ts";
import { composeAnswer, streamChunks, type ComposedAnswer } from "./ask.ts";
import { asId, type ListRecordingsParams, type ListSuggestionsParams, type RecordingFailure, type RecordingProgress, type SearchParams } from "../types.ts";

export interface FixtureClientOptions {
  now?: Date;
  /** Simulated network latency in ms (0 in unit tests). */
  latencyMs?: number;
  /** Length of one simulated processing run for uploads, in ms. */
  processingMs?: number;
}

const PART_SIZE = 8 * 1024 * 1024;
/** What the fixture charges per OCR page (made up; the server estimates from the model's price). */
const FIXTURE_OCR_MICROUSD_PER_PAGE = 2_818;

/** Why the fixture's failed and partial recordings ended that way (RecordingDetail.failure). */
const FAILURES: Record<"failed" | "partial", RecordingFailure> = {
  failed: { code: "input_silent", message: "오디오에서 말소리를 찾지 못했습니다. 녹음이 제대로 됐는지 확인하세요.", job_id: null, failed_at: null },
  partial: { code: "transcribe_partial", message: "일부 구간을 전사하지 못했습니다. 나머지로 문서를 만들었습니다.", job_id: null, failed_at: null },
};
const MAX_PAGE = 200;

const notFound = (what: string) => new ApiClientError(404, "not_found", `${what}을 찾을 수 없습니다.`);

function page<T>(items: T[], cursor: string | undefined, limit: unknown) {
  const size = Math.min(Math.max(Number(limit ?? 50) || 50, 1), MAX_PAGE);
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) throw new ApiClientError(400, "bad_request", "잘못된 페이지 커서입니다.");
  const slice = items.slice(start, start + size);
  const next = start + size < items.length ? String(start + size) : null;
  return { items: structuredClone(slice), next_cursor: next };
}

/** Waits `ms` (a microtask when 0), rejecting with an AbortError if `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("답을 멈췄습니다.", "AbortError"));
    if (signal?.aborted) return abort();
    if (ms <= 0) {
      queueMicrotask(() => (signal?.aborted ? abort() : resolve()));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      abort();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// 물어보기 history the preview opens with: synthetic questions answered by the same
// composer, so their citations resolve like live answers.
const ASK_SEEDS: { id: string; ws: string; scope: AskScope; questions: string[]; hoursAgo: number }[] = [
  { id: "ask_seed_os07", ws: "ws_personal", scope: { kind: "recording", recording_id: asId("rec_os07") }, questions: ["SJF가 최적이면서도 그대로 쓰기 어려운 이유는?", "라운드 로빈에서 타임 퀀텀이 너무 크면 어떻게 돼?"], hoursAgo: 3 },
  { id: "ask_seed_deadlines", ws: "ws_personal", scope: { kind: "workspace" }, questions: ["다가오는 마감과 시험을 정리해 줘"], hoursAgo: 26 },
  { id: "ask_seed_os", ws: "ws_personal", scope: { kind: "folder", folder_id: asId("fld_os"), include_subfolders: true }, questions: ["운영체제 수업 핵심만 요약해 줘"], hoursAgo: 50 },
  { id: "ask_seed_decisions", ws: "ws_team", scope: { kind: "workspace" }, questions: ["최근 회의에서 결정된 사항은?"], hoursAgo: 5 },
  { id: "ask_seed_tasks", ws: "ws_team", scope: { kind: "folder", folder_id: asId("fld_weekly"), include_subfolders: true }, questions: ["누가 무엇을 맡았어?"], hoursAgo: 30 },
];

/** Thread titles are the first question, shortened (packages/ask does the same). */
const threadTitle = (question: string) => (question.length > 40 ? `${question.slice(0, 40)}…` : question);

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function blockText(block: DocumentBlock): string {
  switch (block.type) {
    case "list":
      return block.items.map((i) => i.text).join(" ");
    case "term":
      return `${block.term} ${block.definition}`;
    case "formula":
      return block.explanation ?? "";
    case "gap":
      return "";
    default:
      return block.text;
  }
}

function snippet(text: string, q: string) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return [{ text: text.slice(0, 80), highlight: false }];
  const from = Math.max(0, at - 24);
  return [
    { text: (from > 0 ? "…" : "") + text.slice(from, at), highlight: false },
    { text: text.slice(at, at + q.length), highlight: true },
    { text: text.slice(at + q.length, at + q.length + 40), highlight: false },
  ].filter((p) => p.text);
}

export function createFixtureClient(options: FixtureClientOptions = {}): ApiClient & { readonly data: FixtureData } {
  const data = buildFixtureData(options.now ?? new Date());
  const latency = options.latencyMs ?? 60;
  const processingMs = options.processingMs ?? 5000;
  const uploads = new Map<string, { session: UploadSession; body: CreateUploadRequest; parts: Map<number, number> }>();
  const listeners = new Map<WorkspaceId, Set<(e: ServerEvent) => void>>();
  let eventSeq = 0;
  let idSeq = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const wait = <T>(fn: () => T): Promise<T> =>
    new Promise((resolve, reject) => {
      const run = () => {
        try {
          resolve(fn());
        } catch (err) {
          reject(err);
        }
      };
      if (latency <= 0) queueMicrotask(run);
      else setTimeout(run, latency * (0.6 + Math.random() * 0.8));
    });

  const nowIso = () => new Date().toISOString();
  const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(++idSeq).toString(36)}`;

  const emit = (workspaceId: WorkspaceId, recordingId: RecordingId | null, event: Omit<ServerEvent, "id" | "workspace_id" | "recording_id" | "created_at">) => {
    const full = {
      id: `evt_${++eventSeq}`,
      workspace_id: workspaceId,
      recording_id: recordingId,
      created_at: nowIso(),
      ...event,
    } as ServerEvent;
    for (const listener of listeners.get(workspaceId) ?? []) listener(structuredClone(full));
  };

  const progressEvent = (jobId: JobId, p: JobProgress) => {
    const job = data.jobs.find((j) => j.id === jobId);
    if (!job?.workspace_id) return;
    emit(job.workspace_id, job.recording_id, {
      type: "job.progress",
      payload: { job_id: jobId, stage: p.stage, state: "running", progress: p.progress, chunk_index: p.chunk_index, chunk_count: p.chunk_count },
    } as Omit<ServerEvent, "id" | "workspace_id" | "recording_id" | "created_at">);
  };

  const recording = (id: string) => {
    const rec = data.recordings.find((r) => r.id === id);
    if (!rec) throw notFound("녹음");
    return rec;
  };
  const pdfAsset = (id: string) => {
    const asset = data.assets.find((a) => a.id === id && a.kind === "pdf");
    if (!asset) throw notFound("PDF");
    return asset;
  };

  const role = (ws: WorkspaceId) => data.workspaces.find((w) => w.workspace.id === ws)?.role ?? "viewer";
  const tagIdsOf = (id: string) => data.recordingTags.filter((t) => t.recording_id === id).map((t) => t.tag_id);

  const folderName = (raw: string) => {
    const name = raw.trim();
    if (!name || name.length > 200) throw new ApiClientError(400, "validation_failed", "폴더 이름은 1자 이상 200자 이하로 입력하세요.");
    return name;
  };
  const tagName = (raw: string) => {
    const name = raw.trim();
    if (!name || name.length > 64) throw new ApiClientError(400, "validation_failed", "태그 이름은 1자 이상 64자 이하로 입력하세요.");
    return name;
  };
  const assertUniqueFolderName = (ws: string, parent: string | null, name: string, except: string | null) => {
    const clash = data.folders.some((f) => f.workspace_id === ws && f.parent_id === parent && f.id !== except && f.name === name);
    if (clash) throw new ApiClientError(409, "conflict", "같은 위치에 이름이 같은 폴더가 있습니다. 다른 이름을 쓰세요.");
  };
  const assertUniqueTagName = (ws: string, name: string, except: string | null) => {
    const clash = data.tags.some((t) => t.workspace_id === ws && t.id !== except && t.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new ApiClientError(409, "conflict", "이름이 같은 태그가 있습니다. 다른 이름을 쓰세요.");
  };
  const nextSortKey = (ws: string, parent: string | null) => {
    const keys = data.folders.filter((f) => f.workspace_id === ws && f.parent_id === parent).map((f) => f.sort_key).sort();
    const last = keys.at(-1);
    return last ? `${last}m` : "m";
  };
  const descendantsOf = (id: string) => {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of data.folders) {
        if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    return ids;
  };

  // 물어보기: threads and turns as packages/ask stores them.
  const createThread = (workspaceId: WorkspaceId, scope: AskScope, at: string): AskThread => {
    const thread: AskThread = {
      id: asId<AskThreadId>(newId("ask")),
      workspace_id: workspaceId,
      user_id: data.me.id,
      scope: structuredClone(scope),
      title: "새 대화",
      turn_count: 0,
      created_at: at,
      updated_at: at,
    };
    data.askThreads.push(thread);
    return thread;
  };
  const answeredTurn = (thread: AskThread, question: string, answer: ComposedAnswer, at: string): AskTurn => ({
    id: asId<AskTurnId>(newId("turn")),
    thread_id: thread.id,
    workspace_id: thread.workspace_id,
    idx: thread.turn_count,
    question,
    answer: answer.text,
    citations: structuredClone(answer.citations),
    status: "completed",
    outcome: answer.outcome,
    mode: thread.scope.kind === "recording" ? "full_note" : "retrieval",
    cached: false,
    cost_microusd: answer.outcome === "no_answer" ? 0 : 1_800,
    error: null,
    created_at: at,
    completed_at: at,
  });
  const saveTurn = (thread: AskThread, turn: AskTurn) => {
    data.askTurns.push(turn);
    if (thread.turn_count === 0) thread.title = threadTitle(turn.question);
    thread.turn_count += 1;
    thread.updated_at = turn.completed_at ?? turn.created_at;
  };
  const assertAskScope = (workspaceId: string, scope: AskScope) => {
    if (!data.workspaces.some((w) => w.workspace.id === workspaceId)) throw new ApiClientError(403, "forbidden", "이 워크스페이스에 접근할 권한이 없습니다.");
    if (scope.kind === "recording" && recording(scope.recording_id).workspace_id !== workspaceId) throw notFound("녹음");
    if (scope.kind === "folder" && !data.folders.some((f) => f.id === scope.folder_id && f.workspace_id === workspaceId)) throw notFound("폴더");
  };
  const ownThread = (id: string) => {
    const thread = data.askThreads.find((x) => x.id === id);
    if (!thread) throw notFound("대화");
    return thread;
  };
  for (const seed of ASK_SEEDS) {
    const at = new Date(data.now.getTime() - seed.hoursAgo * 3_600_000).toISOString();
    const thread = createThread(asId(seed.ws), seed.scope, at);
    thread.id = asId(seed.id);
    for (const question of seed.questions) {
      saveTurn(thread, answeredTurn(thread, question, composeAnswer(data, { workspaceId: seed.ws, scope: seed.scope, question }), at));
    }
  }

  // Slowly advance the long-running fixture jobs while someone is listening, so the
  // inbox shows live progress. They hold at 95% and never finish.
  const startTicker = () => {
    if (ticker) return;
    ticker = setInterval(() => {
      for (const [jobId, p] of data.progress) {
        const job = data.jobs.find((j) => j.id === jobId);
        if (!job || job.state !== "running" || jobId.startsWith("job_up")) continue;
        if (p.progress >= 0.95) continue;
        p.progress = Math.min(0.95, Math.round((p.progress + 0.01) * 100) / 100);
        if (p.chunk_count && p.chunk_index !== null) p.chunk_index = Math.min(p.chunk_count - 1, Math.floor(p.progress * p.chunk_count));
        progressEvent(jobId, p);
      }
    }, 3000);
  };

  function simulateProcessing(rec: Recording, jobId: JobId, pdfAssetId: AssetId | null) {
    const job = data.jobs.find((j) => j.id === jobId)!;
    const steps: [JobProgress["stage"], number][] = [
      ["ingest", 0.05],
      ["normalize", 0.12],
      ["transcribe", 0.3],
      ["transcribe", 0.55],
      ["merge", 0.62],
      ["structure", 0.75],
      ["structure", 0.86],
      ["verify", 0.94],
      ["publish", 0.99],
    ];
    let i = 0;
    const tick = () => {
      if (!data.recordings.includes(rec)) return; // deleted meanwhile
      if (i === 0) {
        job.state = "running";
        rec.status = "processing";
        emit(rec.workspace_id, rec.id, { type: "recording.updated", payload: { recording: structuredClone(rec) } } as never);
      }
      if (i < steps.length) {
        const [stage, progress] = steps[i++]!;
        const p = { stage, progress, chunk_index: null, chunk_count: null };
        data.progress.set(jobId, p);
        progressEvent(jobId, p);
        setTimeout(tick, processingMs / (steps.length + 1));
        return;
      }
      const parts = processRecording(rec, UPLOADED_GENERIC, UPLOADED_GENERIC_DOC, rec.duration_ms ?? 60_000, nowIso(), pdfAssetId);
      data.transcripts.set(rec.id, { segments: parts.segments, gaps: parts.gaps });
      data.speakers.push(...parts.speakers);
      data.documents.push(parts.document);
      data.versions.push(parts.version);
      rec.status = "ready";
      rec.updated_at = nowIso();
      job.state = "succeeded";
      job.updated_at = nowIso();
      data.progress.delete(jobId);
      emit(rec.workspace_id, rec.id, { type: "transcript.ready", payload: { segment_count: parts.segments.length } } as never);
      emit(rec.workspace_id, rec.id, { type: "document.updated", payload: { document_id: parts.document.id, version: 1 } } as never);
      emit(rec.workspace_id, rec.id, { type: "job.updated", payload: { job: structuredClone(job) } } as never);
      emit(rec.workspace_id, rec.id, { type: "recording.updated", payload: { recording: structuredClone(rec) } } as never);
    };
    setTimeout(tick, processingMs / (steps.length + 1));
  }

  /** Where a recording's queued or running job stands (RecordingProgress), for the first render. */
  const progressOf = (id: string): RecordingProgress | null => {
    const job = data.jobs.find((j) => j.recording_id === id && (j.state === "queued" || j.state === "running"));
    if (!job) return null;
    const p = data.progress.get(job.id);
    const queue = data.jobs.filter((j) => j.state === "queued");
    return {
      job_id: job.id,
      state: job.state === "queued" ? "queued" : "running",
      stage: p?.stage ?? "ingest",
      stage_state: job.state === "queued" ? "pending" : "running",
      progress: p?.progress ?? null,
      message: null,
      queue_position: job.state === "queued" ? queue.indexOf(job) + 1 : null,
    };
  };

  // Recording writes, shared by the single routes and POST /recordings/batch.
  const patchRecording = (id: string, body: UpdateRecordingRequest): Recording => {
    const rec = recording(id);
    if (role(rec.workspace_id) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
    if (body.folder_id) {
      const folder = data.folders.find((f) => f.id === body.folder_id);
      if (!folder || folder.workspace_id !== rec.workspace_id) throw notFound("폴더");
    }
    if (body.title !== undefined) rec.title = body.title;
    if (body.folder_id !== undefined) rec.folder_id = body.folder_id as FolderId | null;
    if (body.domain !== undefined) rec.domain = body.domain;
    if (body.template_id !== undefined) rec.template_id = body.template_id;
    if (body.language !== undefined) rec.language = body.language;
    if (body.visibility !== undefined) rec.visibility = body.visibility;
    if (body.recorded_at !== undefined) {
      rec.recorded_at = body.recorded_at;
      rec.recorded_at_source = "client";
    }
    if (body.tag_ids !== undefined) {
      const wanted = new Set(body.tag_ids);
      for (const tagId of wanted) {
        const tag = data.tags.find((t) => t.id === tagId);
        if (!tag || tag.workspace_id !== rec.workspace_id) throw notFound("태그");
      }
      const kept = data.recordingTags.filter((t) => t.recording_id !== id || wanted.has(t.tag_id));
      const have = new Set(kept.filter((t) => t.recording_id === id).map((t) => t.tag_id));
      for (const tagId of wanted) {
        if (!have.has(tagId)) {
          kept.push({ workspace_id: rec.workspace_id, recording_id: rec.id, tag_id: tagId, source: "user", confidence: null, created_at: nowIso() });
        }
      }
      data.recordingTags = kept;
    }
    rec.updated_at = nowIso();
    emit(rec.workspace_id, rec.id, { type: "recording.updated", payload: { recording: structuredClone(rec) } } as never);
    return structuredClone(rec);
  };
  const removeRecording = (id: string): void => {
    const rec = recording(id);
    const r = role(rec.workspace_id);
    if (r === "viewer" || (r === "member" && rec.created_by !== data.me.id)) {
      throw new ApiClientError(403, "forbidden", "다른 멤버가 올린 녹음은 워크스페이스 관리자만 삭제할 수 있습니다.");
    }
    data.recordings = data.recordings.filter((x) => x.id !== id);
    data.recordingTags = data.recordingTags.filter((x) => x.recording_id !== id);
    data.assets = data.assets.filter((x) => x.recording_id !== id);
    data.documents = data.documents.filter((x) => x.recording_id !== id);
    data.versions = data.versions.filter((x) => x.recording_id !== id);
    data.questions = data.questions.filter((x) => x.recording_id !== id);
    data.events = data.events.filter((x) => x.recording_id !== id);
    data.actionItems = data.actionItems.filter((x) => x.recording_id !== id);
    data.transcripts.delete(rec.id);
    emit(rec.workspace_id, null, { type: "recording.deleted", payload: { recording_id: rec.id } } as never);
  };

  // The preview starts signed in as the fixture user; signing out shows the login screen,
  // and signing in again takes that user's email with any password (there is no server).
  let signedIn = true;
  const shareLinks: ShareLinkDto[] = [];
  let shareSeq = 0;
  const unauthorized = new Set<() => void>();
  const session = (): SessionUser => ({ id: data.me.id, email: data.me.email, displayName: data.me.display_name });

  const client: ApiClient & { readonly data: FixtureData } = {
    mode: "fixture",
    data,

    getSession: () => wait(() => (signedIn ? session() : null)),
    login: (email, password) =>
      wait(() => {
        if (email.trim().toLowerCase() !== data.me.email || !password) {
          throw new ApiClientError(401, "unauthorized", "아이디(이메일) 또는 비밀번호가 올바르지 않습니다.");
        }
        signedIn = true;
        return session();
      }),
    logout: () =>
      wait(() => {
        signedIn = false;
      }),
    // No mail in the preview: the code is always 000000.
    sendCode: (_email, purpose) =>
      wait(() =>
        purpose === "reset"
          ? "가입된 계정이라면 이메일로 6자리 인증번호가 발송됩니다. (10분간 유효)"
          : "이메일로 6자리 인증번호를 발송했습니다. (10분간 유효)",
      ),
    register: ({ email, password, verificationCode }) =>
      wait(() => {
        if (email.trim().toLowerCase() === data.me.email) throw new ApiClientError(400, "bad_request", "이미 가입된 이메일 주소입니다.");
        if (password.length < 6) throw new ApiClientError(400, "bad_request", "비밀번호는 최소 6자 이상이어야 합니다.");
        if (verificationCode !== "000000") throw new ApiClientError(400, "bad_request", "이메일 인증번호가 올바르지 않거나 만료되었습니다.");
        signedIn = true;
        return { kind: "signedIn" as const, user: session() };
      }),
    resetPassword: ({ verificationCode, newPassword }) =>
      wait(() => {
        if (verificationCode !== "000000") throw new ApiClientError(400, "bad_request", "인증번호가 올바르지 않거나 만료되었습니다.");
        if (newPassword.length < 6) throw new ApiClientError(400, "bad_request", "새 비밀번호는 최소 6자 이상이어야 합니다.");
        return "비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.";
      }),
    onUnauthorized(listener) {
      unauthorized.add(listener);
      return () => unauthorized.delete(listener);
    },

    getMe: () => wait(() => structuredClone(data.me)),

    updateMe: (body: UpdateMeRequest) =>
      wait(() => {
        if (body.display_name !== undefined) {
          const name = body.display_name.trim();
          if (!name || name.length > 100) throw new ApiClientError(400, "validation_failed", "이름은 1자 이상 100자 이하로 입력하세요.");
          data.me.display_name = name;
          for (const m of data.members) if (m.user_id === data.me.id) m.display_name = name;
        }
        if (body.timezone !== undefined) data.me.timezone = body.timezone;
        return structuredClone(data.me);
      }),

    listDevices: () => wait(() => page(data.devices, undefined, MAX_PAGE)),

    revokeDevice: (id) =>
      wait(() => {
        const device = data.devices.find((d) => d.id === id);
        if (!device) throw notFound("기기");
        if (device.current) throw new ApiClientError(409, "conflict", "지금 쓰는 기기는 여기서 로그아웃할 수 없습니다.");
        data.devices = data.devices.filter((d) => d.id !== id);
      }),

    listWorkspaces: () => wait(() => page(data.workspaces, undefined, MAX_PAGE)),

    listMembers: (ws) => wait(() => page(data.members.filter((m) => m.workspace_id === ws), undefined, MAX_PAGE)),

    listFolders: (ws) =>
      wait(() => page([...data.folders.filter((f) => f.workspace_id === ws)].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1)), undefined, MAX_PAGE)),

    createFolder: (body: CreateFolderRequest) =>
      wait((): Folder => {
        const ws = body.workspace_id;
        if (role(ws) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
        const name = folderName(body.name);
        const parent = body.parent_id ?? null;
        if (parent && !data.folders.some((f) => f.id === parent && f.workspace_id === ws)) throw notFound("상위 폴더");
        assertUniqueFolderName(ws, parent, name, null);
        const stamp = nowIso();
        const folder: Folder = {
          id: newId("fld") as FolderId,
          workspace_id: ws,
          parent_id: parent,
          name,
          sort_key: body.sort_key ?? nextSortKey(ws, parent),
          created_at: stamp,
          updated_at: stamp,
        };
        data.folders.push(folder);
        return structuredClone(folder);
      }),

    updateFolder: (id, body: UpdateFolderRequest) =>
      wait((): Folder => {
        const folder = data.folders.find((f) => f.id === id);
        if (!folder) throw notFound("폴더");
        if (role(folder.workspace_id) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
        const parent = body.parent_id === undefined ? folder.parent_id : body.parent_id;
        if (parent) {
          if (!data.folders.some((f) => f.id === parent && f.workspace_id === folder.workspace_id)) throw notFound("상위 폴더");
          if (descendantsOf(folder.id).has(parent)) throw new ApiClientError(409, "conflict", "폴더를 자기 자신이나 그 안의 폴더로 옮길 수 없습니다.");
        }
        const name = body.name === undefined ? folder.name : folderName(body.name);
        if (body.name !== undefined || body.parent_id !== undefined) assertUniqueFolderName(folder.workspace_id, parent, name, folder.id);
        folder.name = name;
        if (body.parent_id !== undefined) {
          folder.parent_id = parent;
          if (body.sort_key === undefined) folder.sort_key = nextSortKey(folder.workspace_id, parent);
        }
        if (body.sort_key !== undefined) folder.sort_key = body.sort_key;
        folder.updated_at = nowIso();
        return structuredClone(folder);
      }),

    deleteFolder: (id) =>
      wait(() => {
        const folder = data.folders.find((f) => f.id === id);
        if (!folder) throw notFound("폴더");
        if (role(folder.workspace_id) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
        // packages/domain: "recordings move to the parent". Subfolders move up as well.
        for (const child of data.folders.filter((f) => f.parent_id === id)) child.parent_id = folder.parent_id;
        for (const rec of data.recordings.filter((r) => r.folder_id === id)) {
          rec.folder_id = folder.parent_id;
          rec.updated_at = nowIso();
          emit(rec.workspace_id, rec.id, { type: "recording.updated", payload: { recording: structuredClone(rec) } } as never);
        }
        data.folders = data.folders.filter((f) => f.id !== id);
      }),

    listTags: (ws) => wait(() => page(data.tags.filter((t) => t.workspace_id === ws), undefined, MAX_PAGE)),

    createTag: (body: CreateTagRequest) =>
      wait((): Tag => {
        if (role(body.workspace_id) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
        const name = tagName(body.name);
        assertUniqueTagName(body.workspace_id, name, null);
        const stamp = nowIso();
        const tag: Tag = { id: newId("tag") as TagId, workspace_id: body.workspace_id, name, color: body.color, created_at: stamp, updated_at: stamp };
        data.tags.push(tag);
        return structuredClone(tag);
      }),

    updateTag: (id, body: UpdateTagRequest) =>
      wait((): Tag => {
        const tag = data.tags.find((t) => t.id === id);
        if (!tag) throw notFound("태그");
        if (body.name !== undefined) {
          const name = tagName(body.name);
          assertUniqueTagName(tag.workspace_id, name, tag.id);
          tag.name = name;
        }
        if (body.color !== undefined) tag.color = body.color;
        tag.updated_at = nowIso();
        return structuredClone(tag);
      }),

    deleteTag: (id) =>
      wait(() => {
        const tag = data.tags.find((t) => t.id === id);
        if (!tag) throw notFound("태그");
        data.recordingTags = data.recordingTags.filter((rt) => rt.tag_id !== id);
        data.tags = data.tags.filter((t) => t.id !== id);
      }),

    listRecordings: (q: ListRecordingsParams) =>
      wait(() => {
        const items = data.recordings
          .filter((r) => r.workspace_id === q.workspace_id)
          .filter((r) => !q.folder_id || r.folder_id === q.folder_id)
          .filter((r) => !q.tag_id || tagIdsOf(r.id).includes(q.tag_id as TagId))
          .filter((r) => !q.domain || r.domain === q.domain)
          .filter((r) => !q.status || r.status === q.status)
          .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))
          .map((r) => ({ ...r, tag_ids: tagIdsOf(r.id), progress: progressOf(r.id) }));
        return page(items, q.cursor, q.limit);
      }),

    getRecording: (id) =>
      wait((): RecordingDetail => {
        const rec = recording(id);
        return structuredClone({
          recording: rec,
          tags: data.recordingTags.filter((t) => t.recording_id === id),
          assets: data.assets.filter((a) => a.recording_id === id),
          speakers: data.speakers.filter((s) => s.recording_id === id),
          documents: data.documents.filter((d) => d.recording_id === id),
          active_job: data.jobs.find((j) => j.recording_id === id && (j.state === "queued" || j.state === "running")) ?? null,
          progress: progressOf(id),
          failure: rec.status === "failed" || rec.status === "partial" ? FAILURES[rec.status] : null,
        });
      }),

    updateRecording: (id, body: UpdateRecordingRequest) => wait(() => patchRecording(id, body)),

    deleteRecording: (id) => wait(() => removeRecording(id)),

    batchRecordings: (body) =>
      wait(() => {
        const results = body.recording_ids.map((id) => {
          try {
            if (body.action === "move") patchRecording(id, { folder_id: body.folder_id });
            else if (body.action === "delete") removeRecording(id);
            else {
              const have = new Set(tagIdsOf(id));
              for (const tagId of body.tag_ids) body.action === "add_tags" ? have.add(tagId) : have.delete(tagId);
              patchRecording(id, { tag_ids: [...have] });
            }
            return { recording_id: id, ok: true, error: null };
          } catch (err) {
            const e = err instanceof ApiClientError ? err : new ApiClientError(500, "internal", "처리하지 못했습니다.");
            return { recording_id: id, ok: false, error: { code: e.code as "internal", message: e.message } };
          }
        });
        return { results };
      }),

    getTranscript: (id) =>
      wait((): Transcript => {
        recording(id);
        const t = data.transcripts.get(id as RecordingId);
        if (!t) throw notFound("전사");
        return structuredClone({
          recording_id: id as RecordingId,
          segments: t.segments,
          speakers: data.speakers.filter((s) => s.recording_id === id),
          gaps: t.gaps,
        });
      }),

    listQuestions: (id) => wait(() => (recording(id), page(data.questions.filter((q) => q.recording_id === id), undefined, MAX_PAGE))),
    listRecordingEvents: (id) => wait(() => (recording(id), page(data.events.filter((e) => e.recording_id === id), undefined, MAX_PAGE))),
    listActionItems: (id) => wait(() => (recording(id), page(data.actionItems.filter((a) => a.recording_id === id), undefined, MAX_PAGE))),

    listWorkspaceActionItems: (q) =>
      wait(() => {
        // Due items first (soonest first), then the rest by creation, like the server.
        const items = data.actionItems
          .filter((a) => a.workspace_id === q.workspace_id)
          .filter((a) => !q.status || a.status === q.status)
          .filter((a) => !q.recording_id || a.recording_id === q.recording_id)
          .filter((a) => (!q.due_after && !q.due_before) || (a.due_at !== null && (!q.due_after || a.due_at >= q.due_after) && (!q.due_before || a.due_at < q.due_before)))
          .sort((a, b) => (a.due_at && b.due_at ? a.due_at.localeCompare(b.due_at) : a.due_at ? -1 : b.due_at ? 1 : a.created_at.localeCompare(b.created_at)));
        return page(items, q.cursor, q.limit);
      }),

    updateActionItem: (id, body: UpdateActionItemRequest) =>
      wait((): ActionItem => {
        const item = data.actionItems.find((a) => a.id === id);
        if (!item) throw notFound("할 일");
        Object.assign(item, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), { updated_at: nowIso() });
        return structuredClone(item);
      }),

    getDocument: (documentId) =>
      wait(() => {
        const document = data.documents.find((d) => d.id === documentId);
        if (!document) throw notFound("문서");
        const version = data.versions.find((v) => v.document_id === documentId && v.version === document.current_version)!;
        return structuredClone({ document, version });
      }),

    createDocumentVersion: (documentId, body, baseVersion) =>
      wait((): DocumentVersion => {
        const document = data.documents.find((d) => d.id === documentId);
        if (!document) throw notFound("문서");
        if (role(document.workspace_id) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
        if (baseVersion !== document.current_version) {
          throw new ApiClientError(412, "precondition_failed", "다른 곳에서 문서가 먼저 바뀌었습니다. 새로 고친 뒤 다시 저장하세요.");
        }
        const base = data.versions.find((v) => v.document_id === document.id && v.version === baseVersion)!;
        // A structured edit sends `body`; a legacy-markdown note sends its Markdown.
        const edit = body as { body?: DocumentBody; markdown?: string };
        if (!edit.body === (edit.markdown === undefined)) {
          throw new ApiClientError(400, "validation_failed", "본문(body)과 Markdown 중 하나만 보내야 합니다.");
        }
        const version: DocumentVersion = {
          ...structuredClone(base),
          id: asId<DocumentVersionId>(newId("docv")),
          version: baseVersion + 1,
          base_version: baseVersion,
          body: edit.body ? structuredClone(edit.body) : null,
          rendered_md: edit.markdown ?? base.rendered_md,
          created_by: "user",
          author_id: data.me.id,
          created_at: nowIso(),
        };
        data.versions.push(version);
        document.current_version = version.version;
        document.user_edited = true;
        document.updated_at = version.created_at;
        emit(document.workspace_id, document.recording_id, { type: "document.updated", payload: { document_id: document.id, version: version.version } } as never);
        return structuredClone(version);
      }),

    // Share links: in memory, never persisted. The URL (with its token) is only returned here.
    listShareLinks: (ws, targetId) =>
      wait(() => page(shareLinks.filter((l) => l.workspace_id === ws && !l.revoked_at && (!targetId || l.target_id === targetId)), undefined, MAX_PAGE)),
    createShareLink: (body) =>
      wait(() => {
        const rec = data.recordings.find((r) => r.id === body.target_id);
        if (body.target_type === "recording" && !rec) throw notFound("녹음");
        shareSeq += 1;
        const link = {
          id: `shl_fx${shareSeq}`,
          workspace_id: rec?.workspace_id ?? data.workspaces[0]!.workspace.id,
          target_type: body.target_type,
          target_id: body.target_id,
          scope: { transcript: body.scope.transcript, audio: body.scope.audio },
          expires_at: body.expires_at ?? null,
          has_password: Boolean(body.password),
          created_by: data.me.id,
          created_at: nowIso(),
          revoked_at: null,
        } as ShareLinkDto;
        shareLinks.unshift(link);
        return { link: structuredClone(link), url: `https://lectern.example/s/fixture-token-${shareSeq}` };
      }),
    revokeShareLink: (id) =>
      wait(() => {
        const link = shareLinks.find((l) => l.id === id && !l.revoked_at);
        if (!link) throw notFound("공유 링크");
        link.revoked_at = nowIso() as ShareLinkDto["revoked_at"];
      }),

    deleteRecordingAudio: (id) =>
      wait(() => {
        recording(id);
        data.assets = data.assets.filter((a) => a.recording_id !== id || !a.kind.startsWith("audio"));
      }),

    reprocessRecording: (id, body) =>
      wait((): ReprocessResponse => {
        const rec = recording(id);
        if (body.mode === "document" && !data.transcripts.has(rec.id)) {
          throw new ApiClientError(409, "conflict", "전사가 없는 녹음이라 문서만 다시 만들 수 없습니다. 전체 재처리를 선택하세요.");
        }
        const full = body.mode === "full";
        const estimate = {
          estimated_microusd: full ? Math.ceil(((rec.duration_ms ?? 0) / 3_600_000) * 120_000) : 2_000,
          audio_ms: full ? (rec.duration_ms ?? 0) : 0,
          within_quota: true,
        } as ReprocessResponse["estimate"];
        if (body.dry_run) return { estimate, job: null };
        const stamp = nowIso() as Recording["updated_at"];
        const job = {
          id: newId("job_re") as JobId,
          workspace_id: rec.workspace_id,
          recording_id: rec.id,
          kind: "process" as const,
          state: "queued" as const,
          priority: 0,
          run_after: stamp,
          attempts: 0,
          lease_owner: null,
          lease_until: null,
          budget_microusd: 400_000,
          spent_microusd: 0,
          idempotency_key: null,
          error_code: null,
          created_at: stamp,
          updated_at: stamp,
        };
        data.jobs.push(job);
        rec.status = "queued";
        rec.updated_at = stamp;
        emit(rec.workspace_id, rec.id, { type: "recording.updated", payload: { recording: structuredClone(rec) } } as never);
        return structuredClone({ estimate, job }) as ReprocessResponse;
      }),

    exportDocument: (documentId) =>
      wait(() => {
        const document = data.documents.find((d) => d.id === documentId);
        if (!document) throw notFound("문서");
        const version = data.versions.find((v) => v.document_id === documentId && v.version === document.current_version)!;
        const title = data.recordings.find((r) => r.id === document.recording_id)?.title ?? "note";
        return { filename: `${title}.md`, blob: new Blob([`${version.rendered_md}\n`], { type: "text/markdown" }) };
      }),

    // The fixture keeps the screen's own rule (lib/ask-suggestions.ts): no server list.
    listAskSuggestions: () => wait((): never => {
      throw new ApiClientError(501, "not_implemented", "아직 준비 중인 기능입니다.");
    }),

    listCalendarSuggestions: (q: ListSuggestionsParams) =>
      wait(() => {
        const statuses = q.statuses ? q.statuses.split(",") : [q.status ?? "suggested"];
        const items = data.events
          .filter((e) => e.workspace_id === q.workspace_id && statuses.includes(e.status))
          .filter((e) => (!q.start_after || e.start_at >= q.start_after) && (!q.start_before || e.start_at < q.start_before))
          .sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
        return page(items, q.cursor, q.limit);
      }),

    updateCalendarSuggestion: (id, body: UpdateEventCandidateRequest) =>
      wait((): EventCandidate => {
        const ev = data.events.find((e) => e.id === id);
        if (!ev) throw notFound("일정 제안");
        Object.assign(ev, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), { updated_at: nowIso() });
        return structuredClone(ev);
      }),

    search: (q: SearchParams) =>
      wait(() => {
        const needle = q.q.trim().toLowerCase();
        const recs = data.recordings.filter((r) => r.workspace_id === q.workspace_id && (!q.recording_id || r.id === q.recording_id));
        const titles: SearchHit[] = [];
        const pdfPages: SearchHit[] = [];
        const documents: SearchHit[] = [];
        const transcripts: SearchHit[] = [];
        for (const rec of recs) {
          if ((!q.kind || q.kind === "recording") && rec.title.toLowerCase().includes(needle)) {
            titles.push({ kind: "recording", recording_id: rec.id, recording_title: rec.title, snippet: snippet(rec.title, needle) });
          }
          if (!q.kind || q.kind === "pdf_page") {
            for (const p of PDF_PAGE_TEXTS.filter((x) => x.recordingId === rec.id)) {
              if (p.text.toLowerCase().includes(needle)) {
                pdfPages.push({ kind: "pdf_page", recording_id: rec.id, recording_title: rec.title, snippet: snippet(p.text, needle), asset_id: p.assetId as AssetId, page: p.page });
              }
            }
          }
          if (!q.kind || q.kind === "document") {
            const doc = data.documents.find((d) => d.recording_id === rec.id);
            const version = doc && data.versions.find((v) => v.document_id === doc.id && v.version === doc.current_version);
            for (const block of version?.body?.sections.flatMap((s) => s.blocks) ?? []) {
              const text = blockText(block);
              if (text.toLowerCase().includes(needle)) {
                documents.push({ kind: "document", recording_id: rec.id, recording_title: rec.title, snippet: snippet(text, needle), document_id: doc!.id, block_id: block.id });
              }
            }
          }
          if ((!q.kind || q.kind === "transcript") && transcripts.length < 200) {
            for (const seg of data.transcripts.get(rec.id)?.segments ?? []) {
              if (seg.text.toLowerCase().includes(needle)) {
                transcripts.push({ kind: "transcript", recording_id: rec.id, recording_title: rec.title, snippet: snippet(seg.text, needle), segment_idx: seg.idx, start_ms: seg.start_ms });
                if (transcripts.length >= 200) break;
              }
            }
          }
        }
        // The server ranks every kind together and puts title matches first; here the rarer
        // kinds come before the many transcript lines, so a page of results shows each kind.
        return page([...titles, ...pdfPages, ...documents, ...transcripts], q.cursor, q.limit ?? 20);
      }),

    createAskThread: (body) =>
      wait(() => {
        assertAskScope(body.workspace_id, body.scope);
        return structuredClone(createThread(body.workspace_id, body.scope, nowIso()));
      }),

    askQuestion: async (threadId, rawQuestion, { signal, onEvent }) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new ApiClientError(0, "network", "네트워크에 연결되어 있지 않아 답을 받지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.");
      }
      const question = rawQuestion.trim();
      if (!question || question.length > 2000) throw new ApiClientError(400, "validation_failed", "질문은 1자 이상 2,000자 이하로 입력하세요.");
      const thread = ownThread(threadId);
      assertAskScope(thread.workspace_id, thread.scope);
      const at = nowIso();
      const answer = composeAnswer(data, { workspaceId: thread.workspace_id, scope: thread.scope, question });
      const turn = answeredTurn(thread, question, answer, at);
      // Like the server: once asked, the turn is finished and stored even if the client
      // stops reading (the answer is in the thread afterwards).
      let saved = false;
      const save = () => {
        if (!saved) saveTurn(thread, turn);
        saved = true;
      };
      const send = (event: AskStreamEvent) => onEvent(structuredClone(event));
      try {
        send({ type: "turn.started", thread_id: thread.id, turn_id: turn.id, idx: turn.idx, created_at: at });
        await pause(latency * 6, signal);
        send({ type: "retrieval", mode: turn.mode!, passage_count: answer.passageCount, recording_count: answer.recordingCount });
        const announced = new Set<string>();
        for (const text of streamChunks(answer.text)) {
          await pause(latency > 0 ? 22 : 0, signal);
          // A marker's citation goes out right before the text that first uses it.
          for (const [, label] of text.matchAll(/\[(c\d+)\]/g)) {
            const citation = answer.citations.find((c) => c.label === label);
            if (citation && !announced.has(label!)) {
              announced.add(label!);
              send({ type: "citation", citation: { ...citation, support: null } });
            }
          }
          send({ type: "answer.delta", text });
        }
        save();
        send({ type: "turn.completed", turn });
        return structuredClone(turn);
      } finally {
        save();
      }
    },

    listAskThreads: (q) =>
      wait(() => {
        assertAskScope(q.workspace_id, { kind: "workspace" });
        const threads = data.askThreads
          .filter((x) => x.workspace_id === q.workspace_id && x.user_id === data.me.id)
          .filter((x) => !q.recording_id || (x.scope.kind === "recording" && x.scope.recording_id === q.recording_id))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return page(threads, q.cursor, q.limit);
      }),

    getAskThread: (id) =>
      wait(() => {
        const thread = ownThread(id);
        return structuredClone({ thread, turns: data.askTurns.filter((t) => t.thread_id === thread.id).sort((a, b) => a.idx - b.idx) });
      }),

    deleteAskThread: (id) =>
      wait(() => {
        const thread = ownThread(id);
        data.askThreads = data.askThreads.filter((x) => x !== thread);
        data.askTurns = data.askTurns.filter((t) => t.thread_id !== thread.id);
      }),

    getAskUsage: (ws) =>
      wait(() => {
        assertAskScope(ws, { kind: "workspace" });
        const period = nowIso().slice(0, 7);
        const turns = data.askTurns.filter((t) => t.workspace_id === ws && t.created_at.startsWith(period));
        return {
          workspace_id: ws,
          period,
          turn_count: turns.length,
          spent_microusd: turns.reduce((sum, t) => sum + t.cost_microusd, 0),
          limit_microusd: 2_000_000,
          per_turn_cap_microusd: 20_000,
        };
      }),

    createUpload: (body: CreateUploadRequest) =>
      wait((): UploadSession => {
        if (!data.workspaces.some((w) => w.workspace.id === body.workspace_id)) throw notFound("워크스페이스");
        if (!body.recording_id && !body.files.some((f) => f.kind === "audio")) {
          throw new ApiClientError(400, "validation_failed", "새 녹음에는 오디오 파일이 하나 이상 있어야 합니다.");
        }
        let next = 1;
        const files = body.files.map((f, index) => {
          const part_count = Math.max(1, Math.ceil(f.bytes / PART_SIZE));
          const file = { ...f, index, first_part: next, part_count };
          next += part_count;
          return file;
        });
        const session: UploadSession = {
          id: newId("up") as UploadId,
          workspace_id: body.workspace_id,
          recording_id: (body.recording_id as RecordingId | undefined) ?? null,
          status: "open",
          recorded_at: body.recorded_at ?? null,
          part_size: PART_SIZE,
          files,
          received_parts: [],
          created_at: nowIso(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        };
        uploads.set(session.id, { session, body, parts: new Map() });
        return structuredClone(session);
      }),

    uploadPart: async (uploadId, part, bytes) => {
      const sha256 = await sha256Hex(bytes);
      return wait((): UploadPartReceipt => {
        const upload = uploads.get(uploadId);
        if (!upload || upload.session.status !== "open") throw notFound("업로드");
        const total = upload.session.files.reduce((s, f) => s + f.part_count, 0);
        if (part < 1 || part > total) throw new ApiClientError(400, "bad_request", "파트 번호가 범위를 벗어났습니다.");
        upload.parts.set(part, bytes.size);
        upload.session.received_parts = [...upload.parts.keys()].sort((a, b) => a - b);
        return { part, bytes: Math.max(1, bytes.size), sha256 };
      });
    },

    completeUpload: (uploadId) =>
      wait((): CompleteUploadResponse => {
        const upload = uploads.get(uploadId);
        if (!upload) throw notFound("업로드");
        const { session, body } = upload;
        const total = session.files.reduce((s, f) => s + f.part_count, 0);
        if (upload.parts.size !== total) throw new ApiClientError(409, "upload_incomplete", "아직 받지 못한 파트가 있습니다.");
        const ws = session.workspace_id;
        const audio = session.files.filter((f) => f.kind === "audio");
        const audioBytes = audio.reduce((s, f) => s + f.bytes, 0);
        // No decoding in the browser fixture: estimate length from size (≈128 kbit/s).
        const durationMs = Math.min(180 * 60_000, Math.max(30_000, Math.round(audioBytes / 16)));
        const recId = newId("rec") as RecordingId;
        const domain = body.recording?.domain ?? "lecture";
        const stamp = nowIso();
        const rec: Recording = {
          id: recId,
          workspace_id: ws,
          folder_id: (body.recording?.folder_id as FolderId | null | undefined) ?? null,
          title: body.recording?.title || parseFileName(audio[0]?.filename ?? "새 녹음").title || "새 녹음",
          domain,
          template_id: (body.recording?.template_id ?? TEMPLATE_FOR[domain]) as Recording["template_id"],
          language: "ko",
          recorded_at: session.recorded_at ?? stamp,
          recorded_at_source: session.recorded_at ? "client" : "upload",
          duration_ms: durationMs,
          status: "queued",
          created_by: data.me.id,
          visibility: data.workspaces.find((w) => w.workspace.id === ws)?.workspace.kind === "team" ? "workspace" : "private",
          created_at: stamp,
          updated_at: stamp,
        };
        let pdfAssetId: AssetId | null = null;
        let audioIndex = 0;
        for (const f of session.files) {
          const asset: AssetDto = {
            id: newId("as") as AssetId,
            workspace_id: ws,
            recording_id: recId,
            kind: f.kind === "audio" ? "audio" : f.kind,
            part_index: f.kind === "audio" ? audioIndex++ : 0,
            sha256: f.sha256 ?? "0".repeat(64),
            bytes: f.bytes,
            mime: f.mime,
            duration_ms: null,
            page_count: f.kind === "pdf" ? 10 : null,
            meta: { original_name: f.filename },
            created_at: stamp,
          };
          if (f.kind === "pdf" && !pdfAssetId) pdfAssetId = asset.id;
          data.assets.push(asset);
        }
        for (const tagId of body.recording?.tag_ids ?? []) {
          data.recordingTags.push({ workspace_id: ws, recording_id: recId, tag_id: tagId, source: "user", confidence: null, created_at: stamp });
        }
        const jobId = newId("job_up") as JobId;
        const job = {
          id: jobId,
          workspace_id: ws,
          recording_id: recId,
          kind: "process" as const,
          state: "queued" as const,
          priority: 0,
          run_after: stamp,
          attempts: 0,
          lease_owner: null,
          lease_until: null,
          budget_microusd: 400_000,
          spent_microusd: 0,
          idempotency_key: null,
          error_code: null,
          created_at: stamp,
          updated_at: stamp,
        };
        data.jobs.push(job);
        data.progress.set(jobId, { stage: "ingest", progress: 0, chunk_index: null, chunk_count: null });
        data.recordings.push(rec);
        session.status = "completed";
        session.recording_id = recId;
        emit(ws, recId, { type: "recording.created", payload: { recording: structuredClone(rec) } } as never);
        simulateProcessing(rec, jobId, pdfAssetId);
        return structuredClone({ upload: session, recording: rec, job, deduplicated: false });
      }),

    // Fixture PDFs have no bytes either; the URL is the real route so the e2e suite can
    // answer it (page.route) with a generated PDF. Audio stays null (no player source).
    assetContentUrl: (assetId) => (assetId.endsWith("_pdf") ? `/api/v2/assets/${encodeURIComponent(assetId)}/content` : null),

    listAssetPages: (assetId) =>
      wait((): AssetPages => {
        const asset = pdfAsset(assetId);
        const scanned = asset.meta.scanned === true;
        const read = typeof asset.meta.ocr_pages === "number";
        const count = asset.page_count ?? 0;
        return {
          page_count: count,
          scanned,
          pages: Array.from({ length: count }, (_, i) => ({
            page_no: i + 1,
            has_text_layer: !scanned,
            char_count: scanned && !read ? 0 : 800,
          })),
        };
      }),

    ocrAsset: (assetId, body) =>
      wait((): OcrAssetResponse => {
        const asset = pdfAsset(assetId);
        if (role(asset.workspace_id) === "viewer") throw new ApiClientError(403, "forbidden", "이 워크스페이스에서는 보기만 할 수 있습니다.");
        // Pages a scan still needs: none once an OCR ran (the fixture finishes it at once).
        const pages = asset.meta.scanned === true && typeof asset.meta.ocr_pages !== "number" ? (asset.page_count ?? 0) : 0;
        const estimate = { pages_to_ocr: pages, estimated_cost_microusd: FIXTURE_OCR_MICROUSD_PER_PAGE * pages };
        if (body.dry_run || pages === 0) return { ...estimate, job_id: null };
        asset.meta = { ...asset.meta, ocr_pages: pages };
        return { ...estimate, job_id: "job_fixture_ocr" as JobId };
      }),

    subscribe(workspaceId, onEvent) {
      const set = listeners.get(workspaceId) ?? new Set();
      set.add(onEvent);
      listeners.set(workspaceId, set);
      // Like a reconnect with Last-Event-ID: replay where every active job stands.
      queueMicrotask(() => {
        for (const [jobId, p] of data.progress) {
          const job = data.jobs.find((j) => j.id === jobId);
          if (job?.workspace_id === workspaceId && job.state === "running") progressEvent(jobId, p);
        }
      });
      startTicker();
      return () => {
        set.delete(onEvent);
        if ([...listeners.values()].every((s) => s.size === 0)) {
          clearInterval(ticker);
          ticker = undefined;
        }
      };
    },
  };
  return client;
}
