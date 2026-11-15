import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { Harness, ScriptedLlmProvider, ScriptedTranscriptionProvider, synthesizeSpeechTone, type ScriptLine } from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import { assetPath } from "../src/api/v2/store.ts";
import { createUser, DATA_DIR, db, generateId, getSystemSettings, HARNESS_BLOB_DIR, updateSystemSettings, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { PROCESS_JOB_KIND, runProcessJob } from "../src/process-job.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { notesAnswer } from "./fixtures/process-answers.ts";

// Recordings uploaded in several audio parts (D-P1-9) under LECTERN_PIPELINE=v2. Jobs run
// here on scripted providers only; the embedded worker is paused.
const S = 1000;
const ONE_AUDIO = "새 녹음에는 오디오 파일이 하나 있어야 합니다.";
const UPLOADS = join(DATA_DIR, "uploads");
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
});
afterAll(() => {
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_PIPELINE", "GEMINI_API_KEY"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

function pipeline(mode: "v2" | undefined): void {
  if (mode) process.env.LECTERN_PIPELINE = mode;
  else delete process.env.LECTERN_PIPELINE;
  resetConfigForTests();
}

/** The enqueue checks for a server key; it is never sent anywhere (no Gemini provider runs). */
async function withServerKey<T>(fn: () => Promise<T>): Promise<T> {
  process.env.GEMINI_API_KEY = "test-key-never-sent";
  try {
    return await fn();
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function api(method: string, path: string, user: UserRecord, init: { body?: unknown; raw?: Uint8Array } = {}) {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  let body: BodyInit | undefined = init.raw ? new Blob([init.raw as Uint8Array<ArrayBuffer>]) : undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: (type.startsWith("application/json") ? await res.json() : null) as any };
}

const user = createUser({ email: `${generateId("parts")}@example.com`, displayName: "파트", password: "correct_password_1" });
const workspaceId = personalWorkspaceId(user.id);

const fakeAudio = (seed: number, length = 1000) => new Uint8Array(length).map((_, i) => (i * seed + seed) % 251);
const audioFile = (name: string, data: Uint8Array) => ({ kind: "audio", filename: name, mime: "audio/mp4", bytes: data.length, sha256: sha256(data) });

function finish(jobId: string): void {
  db.query(`UPDATE job SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('queued', 'running')`).run(Date.now(), jobId);
}

/** Uploads `files` as one new recording and completes it; returns the completion body. */
async function uploadParts(files: Array<{ name: string; data: Uint8Array }>) {
  const created = await api("POST", "/uploads", user, { body: { workspace_id: workspaceId, files: files.map((f) => audioFile(f.name, f.data)) } });
  expect(created.status).toBe(201);
  for (const [i, f] of files.entries()) {
    const { first_part, part_count } = created.body.files[i];
    expect(part_count).toBe(1);
    expect((await api("PUT", `/uploads/${created.body.id}/parts/${first_part}`, user, { raw: f.data })).status).toBe(200);
  }
  const done = await api("POST", `/uploads/${created.body.id}/complete`, user);
  expect(done.status).toBe(200);
  return done.body;
}

function audioAssets(recordingId: string) {
  return db.query(`SELECT id, part_index, bytes, blob_key, duration_ms FROM asset WHERE recording_id = ? AND kind = 'audio' ORDER BY part_index`).all(
    recordingId
  ) as Array<{ id: string; part_index: number; bytes: number; blob_key: string; duration_ms: number | null }>;
}

const audioFiles = () => new Set(readdirSync(UPLOADS).filter((name) => name.startsWith("aud_")));

describe("multi-part audio uploads", () => {
  test("v1 keeps the old 400", async () => {
    pipeline(undefined);
    const res = await api("POST", "/uploads", user, {
      body: { workspace_id: workspaceId, files: [audioFile("1부.m4a", fakeAudio(1)), audioFile("2부.m4a", fakeAudio(2))] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(ONE_AUDIO);
  });

  test("no audio at all is still the old 400 under v2", async () => {
    pipeline("v2");
    const res = await api("POST", "/uploads", user, { body: { workspace_id: workspaceId, files: [] } });
    expect(res.status).toBe(400);
  });

  test("v2 rejects nine audio files", async () => {
    pipeline("v2");
    const files = Array.from({ length: 9 }, (_, i) => audioFile(`${i + 1}부.m4a`, fakeAudio(i + 3)));
    const res = await api("POST", "/uploads", user, { body: { workspace_id: workspaceId, files } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("오디오는 최대 8개까지 올릴 수 있습니다.");
  });

  let recordingId = "";
  let partPaths: string[] = [];
  const first = fakeAudio(11, 1200);
  const second = fakeAudio(13, 900);

  test("v2 accepts two audio files", async () => {
    pipeline("v2");
    const done = await withServerKey(() => uploadParts([{ name: "1부.m4a", data: first }, { name: "2부.m4a", data: second }]));
    expect(done.deduplicated).toBe(false);
    recordingId = done.recording.id;
    const assets = audioAssets(recordingId);
    expect(assets.map((a) => [a.part_index, a.bytes])).toEqual([
      [0, first.length],
      [1, second.length],
    ]);
    partPaths = assets.map((a) => assetPath(a)!);
    expect(partPaths.map((p) => sha256(readFileSync(p)))).toEqual([sha256(first), sha256(second)]);
    const kind = (db.query(`SELECT kind FROM job WHERE id = ?`).get(done.job.id) as { kind: string }).kind;
    finish(done.job.id);
    expect(kind).toBe(isFfmpegAvailable() ? PROCESS_JOB_KIND : "distill");
  });

  test("duplicate multi-part upload is deduplicated", async () => {
    pipeline("v2");
    expect(recordingId).not.toBe("");
    const before = audioFiles();
    const done = await withServerKey(() => uploadParts([{ name: "1부.m4a", data: first }, { name: "2부.m4a", data: second }]));
    expect(done.deduplicated).toBe(true);
    expect(done.recording.id).toBe(recordingId);
    expect(audioFiles()).toEqual(before); // both new copies removed
    if (done.job) finish(done.job.id);
  });

  test("deleting the recording removes every part file", async () => {
    expect(partPaths.length).toBe(2);
    expect((await api("DELETE", `/recordings/${recordingId}`, user)).status).toBe(204);
    for (const path of partPaths) expect(existsSync(path)).toBe(false);
    expect(audioAssets(recordingId)).toEqual([]);
  });
});

describe.skipIf(!isFfmpegAvailable())("multi-part processing (scripted providers, synthetic audio)", () => {
  let jobId = "";

  test(
    "timeline is the concatenated one",
    async () => {
      pipeline("v2");
      const line = (i: number, startMs: number, text: string): ScriptLine => ({ start_ms: startMs, end_ms: startMs + 3 * S, speaker: "S1", text });
      const part1 = [line(0, 500, "첫째 파트 첫 문장입니다."), line(1, 5_000, "첫째 파트 둘째 문장입니다.")];
      const part2 = [line(2, 500, "둘째 파트 첫 문장입니다."), line(3, 4_500, "둘째 파트 둘째 문장입니다.")];
      mkdirSync(join(process.env.LECTERN_TEST_SANDBOX!, "parts"), { recursive: true });
      const a = await synthesizeSpeechTone(part1, 10 * S, join(process.env.LECTERN_TEST_SANDBOX!, "parts", `${generateId("p")}.m4a`));
      const b = await synthesizeSpeechTone(part2, 8 * S, join(process.env.LECTERN_TEST_SANDBOX!, "parts", `${generateId("p")}.m4a`));
      const done = await withServerKey(() =>
        uploadParts([
          { name: "1부.m4a", data: new Uint8Array(readFileSync(a)) },
          { name: "2부.m4a", data: new Uint8Array(readFileSync(b)) },
        ])
      );
      const lectureId = (db.query(`SELECT lecture_id FROM recording WHERE id = ?`).get(done.recording.id) as { lecture_id: string }).lecture_id;
      jobId = done.job.id;
      db.query(`UPDATE job SET state = 'running' WHERE id = ?`).run(jobId);
      const job: LeasedJob = { id: jobId, kind: PROCESS_JOB_KIND, subjectId: lectureId, ownerId: user.id, payload: {}, attempts: 0, secret: () => undefined };

      // The provider hears the joined timeline: part 2's lines 10 s later.
      const joinedScript = [...part1, ...part2.map((l) => ({ ...l, start_ms: l.start_ms + 10 * S, end_ms: l.end_ms + 10 * S }))];
      const transcription = new ScriptedTranscriptionProvider(joinedScript);
      const outcome = await runProcessJob(job, {
        transcription,
        llm: new ScriptedLlmProvider(notesAnswer),
        harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
        pipeline: { concurrency: 1, onStage: transcription.observe },
      });
      finish(jobId);
      expect(outcome.ok).toBe(true);

      const segments = db
        .query(`SELECT start_ms, end_ms, text FROM transcript_segment WHERE recording_id = ? ORDER BY idx`)
        .all(done.recording.id) as Array<{ start_ms: number; end_ms: number; text: string }>;
      expect(segments.length).toBeGreaterThan(0);
      expect(segments[segments.length - 1]!.end_ms).toBeLessThanOrEqual(18_500);
      const second = segments.filter((s) => s.text.includes("둘째 파트"));
      expect(second.length).toBeGreaterThan(0);
      for (const s of second) expect(s.start_ms).toBeGreaterThanOrEqual(10_000);
      expect(segments.filter((s) => s.text.includes("첫째 파트")).every((s) => s.end_ms <= 10_000)).toBe(true);

      const durations = audioAssets(done.recording.id).map((a) => a.duration_ms!);
      expect(Math.abs(durations[0]! - 10_000)).toBeLessThanOrEqual(150);
      expect(Math.abs(durations[1]! - 8_000)).toBeLessThanOrEqual(150);
    },
    60_000
  );

  test("joined file is removed after success", () => {
    expect(jobId).not.toBe("");
    expect(existsSync(join(DATA_DIR, "work", `${jobId}-joined.flac`))).toBe(false);
  });
});
