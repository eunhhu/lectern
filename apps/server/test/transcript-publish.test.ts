import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import {
  Harness,
  ScriptedTranscriptionProvider,
  synthesizeSpeechTone,
  type ScriptLine,
  type Transcript,
} from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import { API_BASE_PATH } from "../src/api/v2/index.ts";
import { isIndexable, lectureSources } from "../src/ask/legacy.ts";
import {
  createPendingLecture,
  DATA_DIR,
  db,
  ensureBootstrapOwner,
  generateId,
  getLectureById,
  HARNESS_BLOB_DIR,
  type LectureRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { runTranscriptJob, TRANSCRIBE_JOB_KIND } from "../src/transcript-job.ts";
import { publishTranscript } from "../src/transcript-publish.ts";

const S = 1000;

// Transcribe jobs run here directly; the shared embedded worker must not lease them.
let paused: JobWorker | null = null;
beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
afterAll(() => {
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_TRANSCRIPT_ENGINE"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

function engine(mode: "off" | "shadow" | "on"): void {
  process.env.LECTERN_TRANSCRIPT_ENGINE = mode;
  resetConfigForTests();
}

function uploadPath(ext = "m4a"): string {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  return join(DATA_DIR, "uploads", `${generateId("aud")}.${ext}`);
}

function pendingLecture(audioPath?: string): LectureRecord {
  const path = audioPath ?? uploadPath();
  if (!audioPath) writeFileSync(path, "audio");
  return createPendingLecture({
    id: generateId("lec"),
    ownerId: ensureBootstrapOwner().id,
    title: "",
    course: "정보보호",
    audioPath: path,
    audioMime: "audio/mp4",
    audioSize: statSync(path).size,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
}

function directJob(lectureId: string): LeasedJob {
  const ownerId = ensureBootstrapOwner().id;
  const id = `job_${crypto.randomUUID()}`;
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at)
     VALUES (?, ?, 'transcribe-direct-test', ?, 'running', 0, '{}', 0)`
  ).run(id, ownerId, lectureId);
  return { id, kind: TRANSCRIBE_JOB_KIND, subjectId: lectureId, ownerId, payload: {}, attempts: 0, secret: () => undefined };
}

function transcript(labels: string[] = ["S1", "S2", "S1"], gaps: Transcript["gaps"] = [{ kind: "break", start_ms: 50_000, end_ms: 60_000 }]): Transcript {
  const unique = [...new Set(labels)];
  return {
    version: 1,
    duration_ms: 120_000,
    failed_chunks: [],
    gaps,
    speakers: unique.map((label) => ({
      label,
      confidence: 0.9,
      basis: "single_chunk",
      segments: labels.filter((l) => l === label).length,
      chars: 10,
      members: [{ chunk: 0, label }],
    })),
    segments: labels.map((speaker, idx) => ({
      idx,
      start_ms: idx * 10_000,
      end_ms: idx * 10_000 + 9_000,
      speaker,
      source_chunk: 0,
      text: `세그먼트 ${idx}`,
    })),
  };
}

const count = (table: string, recordingId: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE recording_id = ?`).get(recordingId) as { n: number }).n;

async function api(method: string, path: string, body?: unknown) {
  const owner = ensureBootstrapOwner();
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, {
      method,
      headers: { "X-Lectern-Token": owner.api_token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return { status: res.status, body: (await res.json()) as any };
}

function setup() {
  const lecture = pendingLecture();
  const recordingId = lectureRecordingId(lecture.id);
  const workspaceId = personalWorkspaceId(lecture.owner_id);
  return { lecture, recordingId, workspaceId };
}

describe("publishTranscript", () => {
  test("publishes segments, speakers and gaps", async () => {
    const { recordingId, workspaceId } = setup();
    expect(publishTranscript({ recordingId, workspaceId, transcript: transcript() })).toEqual({ segments: 3, speakers: 2, gaps: 1 });
    const res = await api("GET", `/recordings/${recordingId}/transcript`);
    expect(res.status).toBe(200);
    expect(res.body.segments.map((s: any) => s.idx)).toEqual([0, 1, 2]);
    expect(res.body.segments.map((s: any) => s.text)).toEqual(["세그먼트 0", "세그먼트 1", "세그먼트 2"]);
    expect(res.body.speakers.map((s: any) => s.label).sort()).toEqual(["S1", "S2"]);
    expect(res.body.gaps).toHaveLength(1);
    expect(res.body.gaps[0].kind).toBe("break");
  });

  test("publishing twice keeps the same row counts", () => {
    const { recordingId, workspaceId } = setup();
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    expect(count("transcript_segment", recordingId)).toBe(3);
    expect(count("speaker", recordingId)).toBe(2);
    expect(count("transcript_gap", recordingId)).toBe(1);
  });

  test("speaker ids are stable across republish", () => {
    const { recordingId, workspaceId } = setup();
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    const s1 = (db.query(`SELECT id FROM speaker WHERE recording_id = ? AND label = 'S1'`).get(recordingId) as { id: string }).id;
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    expect((db.query(`SELECT id FROM speaker WHERE recording_id = ? AND label = 'S1'`).get(recordingId) as { id: string }).id).toBe(s1);
    const ids = db.query(`SELECT speaker_id FROM transcript_segment WHERE recording_id = ? AND idx IN (0, 2)`).all(recordingId) as Array<{
      speaker_id: string;
    }>;
    expect(ids.map((r) => r.speaker_id)).toEqual([s1, s1]);
  });

  test("user-given speaker names survive", async () => {
    const { recordingId, workspaceId } = setup();
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    const s1 = (db.query(`SELECT id FROM speaker WHERE recording_id = ? AND label = 'S1'`).get(recordingId) as { id: string }).id;
    const res = await api("PATCH", `/recordings/${recordingId}/speakers/${s1}`, { display_name: "김교수" });
    expect(res.status).toBe(200);
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    expect((db.query(`SELECT display_name FROM speaker WHERE id = ?`).get(s1) as { display_name: string }).display_name).toBe("김교수");
  });

  test("failed chunk shows as missing_transcript gap", () => {
    const { recordingId, workspaceId } = setup();
    const t = transcript(undefined, [
      { kind: "missing_transcript", start_ms: 10_000, end_ms: 20_000 },
      { kind: "break", start_ms: 50_000, end_ms: 60_000 },
    ]);
    publishTranscript({ recordingId, workspaceId, transcript: t });
    expect(
      db.query(`SELECT kind, start_ms, end_ms FROM transcript_gap WHERE recording_id = ? AND kind = 'missing_transcript'`).get(recordingId)
    ).toEqual({ kind: "missing_transcript", start_ms: 10_000, end_ms: 20_000 });
  });

  test("removed speaker is deleted on republish", () => {
    const { recordingId, workspaceId } = setup();
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    publishTranscript({ recordingId, workspaceId, transcript: transcript(["S1", "S1", "S1"]) });
    expect(count("speaker", recordingId)).toBe(1);
  });

  test("missing recording throws", () => {
    expect(() =>
      publishTranscript({ recordingId: "rec_missing_publish_test", workspaceId: "ws", transcript: transcript() })
    ).toThrow();
  });

  test("transcript-only recording is indexable", () => {
    const { lecture, recordingId, workspaceId } = setup();
    publishTranscript({ recordingId, workspaceId, transcript: transcript() });
    const row = getLectureById(lecture.id)!;
    expect(row.status).not.toBe("done");
    const indexable = { id: row.id, owner_id: row.owner_id, status: row.status, markdown: row.markdown ?? "", updated_at: row.updated_at };
    expect(isIndexable(indexable)).toBe(true);
    expect(lectureSources(indexable).transcript!.segments).toHaveLength(3);
  });
});

describe.skipIf(!isFfmpegAvailable())("transcribe job publishing (scripted provider, synthetic audio)", () => {
  async function talk(): Promise<{ audio: string; script: ScriptLine[] }> {
    const script: ScriptLine[] = Array.from({ length: 6 }, (_, i) => ({
      start_ms: i * 5 * S,
      end_ms: i * 5 * S + 4 * S,
      speaker: "S1",
      text: `블록 암호 운영 모드 설명 ${i}번째 문장입니다.`,
    }));
    return { audio: await synthesizeSpeechTone(script, 32 * S, uploadPath()), script };
  }

  const run = async (mode: "on" | "shadow" | "off") => {
    engine(mode);
    const { audio, script } = await talk();
    const lecture = pendingLecture(audio);
    const job = directJob(lecture.id);
    const lastEvent = (db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM job_event`).get() as { id: number }).id;
    const provider = new ScriptedTranscriptionProvider(script);
    const outcome = await runTranscriptJob(job, {
      provider,
      harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
      pipeline: { concurrency: 1, onStage: provider.observe },
    });
    return { outcome, lecture, recordingId: lectureRecordingId(lecture.id), lastEvent };
  };

  test("on: job publishes, indexes and announces", async () => {
    const { outcome, lecture, recordingId, lastEvent } = await run("on");
    expect(outcome.ok).toBe(true);
    expect((outcome as any).result.published).toBe(true);
    expect(count("transcript_segment", recordingId)).toBeGreaterThan(0);
    const events = db.query(`SELECT type FROM job_event WHERE subject_id = ? AND id > ?`).all(lecture.id, lastEvent) as Array<{
      type: string;
    }>;
    expect(events.some((e) => e.type === "updated")).toBe(true);
  }, 60_000);

  test("shadow and off publish nothing", async () => {
    const shadow = await run("shadow");
    expect(shadow.outcome.ok).toBe(true);
    expect(count("transcript_segment", shadow.recordingId)).toBe(0);
    const off = await run("off");
    expect(count("transcript_segment", off.recordingId)).toBe(0);
  }, 60_000);
});
