import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import type { DistillationResult, DistillOptions } from "@lectern/core";
import { geminiLegacyDistillProvider, Harness, legacyDistillStage } from "@lectern/harness";
import {
  DATA_DIR,
  createPendingLecture,
  db,
  deleteLectureById,
  ensureBootstrapOwner,
  generateId,
  getLectureById,
  getSystemSettings,
  updateSystemSettings,
} from "../src/db.ts";
import { LECTURE_GONE_MESSAGE, runDistillation, runDistillationOnHarness } from "../src/job-handlers.ts";
import { waitForJob, type LeasedJob } from "../src/queue.ts";
import { isFfmpegAvailable } from "../src/storage.ts";

const originalSettings = getSystemSettings();
beforeAll(() => {
  // completeLectureRecord would queue a compaction job (and start the embedded worker).
  updateSystemSettings({ storage_auto_compact: false });
});
afterAll(() => {
  updateSystemSettings(originalSettings);
  delete process.env.LECTERN_DISTILL_ENGINE;
  resetConfigForTests();
});

/** A lecture in 'processing' with an audio file, and the running job that distills it. */
function pendingLecture(course = "정보보호", audio?: string) {
  const id = generateId("lec");
  const audioPath = audio ?? join(DATA_DIR, "uploads", `${id}.m4a`);
  if (!audio) writeFileSync(audioPath, `audio for ${id}`);
  const ownerId = ensureBootstrapOwner().id;
  createPendingLecture({
    id,
    ownerId,
    title: "",
    course,
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 16,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test", // keeps completeLectureRecord out of the lecture archive
  });
  const jobId = `job_${crypto.randomUUID()}`;
  // A kind no handler is registered for, so no worker ever leases it.
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at)
     VALUES (?, ?, 'distill-harness-test', ?, 'running', 0, '{}', 0)`
  ).run(jobId, ownerId, id);
  const job: LeasedJob = {
    id: jobId,
    kind: "distill",
    subjectId: id,
    ownerId,
    payload: { audioPath, course, title: "", model: "gemini-3.8-flash" },
    attempts: 0,
    secret: () => undefined,
  };
  return { id, job, audioPath };
}

function events(lectureId: string) {
  return (
    db.query(`SELECT type, payload FROM job_event WHERE subject_id = ? ORDER BY id`).all(lectureId) as Array<{
      type: string;
      payload: string;
    }>
  ).map((r) => ({ type: r.type, ...JSON.parse(r.payload) }));
}

function recorded(opts: DistillOptions): DistillationResult {
  return {
    markdown: `# 📚 ${opts.courseName} 강의 노트\n\n- [00:01] 블록 암호 운영 모드를 설명했습니다. 충분히 긴 문장입니다.`,
    title: `${opts.courseName} 강의 노트`,
    courseName: opts.courseName!,
    excerpt: "블록 암호 운영 모드를 설명했습니다.",
    modelRequested: opts.model!,
    modelUsed: "gemini-3.8-flash-001",
    durationSec: 95,
    sizeBytes: 16,
    usage: { promptTokenCount: 3100, candidatesTokenCount: 900 },
    requestId: "resp-test",
    generateMs: 1500,
  };
}

function fakeGemini(failures: Error[] = []) {
  let calls = 0;
  const provider = geminiLegacyDistillProvider(async (opts) => {
    calls++;
    opts.onProgress?.({ stage: "analyzing", message: "쉬는시간 필터링 및 강의 핵심 노트 구조화 중...", progress: 65 });
    const failure = failures.shift();
    if (failure) throw failure;
    return recorded(opts);
  });
  return { provider, calls: () => calls };
}

// A fixed date keeps the pricing.json rate (and the asserted cost) stable.
const testHarness = () =>
  new Harness({
    db,
    blobDir: join(DATA_DIR, "blobs"),
    sleep: async () => {},
    now: () => Date.parse("2026-10-20T00:00:00Z"),
  });

describe("distill on the harness (LECTERN_DISTILL_ENGINE=harness)", () => {
  test("publishes to lectures with the same events as the direct path, and records the run and its cost", async () => {
    const { id, job } = pendingLecture();
    const gemini = fakeGemini();
    const outcome = await runDistillationOnHarness(job, { provider: gemini.provider, harness: testHarness() });
    expect(outcome).toEqual({ ok: true });
    expect(gemini.calls()).toBe(1);

    const lecture = getLectureById(id)!;
    expect(lecture.status).toBe("done");
    expect(lecture.markdown).toContain("블록 암호 운영 모드");
    expect(lecture.model_used).toBe("gemini-3.8-flash-001");
    expect(lecture.duration_sec).toBe(95);
    expect(lecture.title).not.toBe(""); // completeLectureRecord's title normalization still applies

    const evs = events(id);
    expect(evs.map((e) => [e.type, e.stage ?? null])).toEqual([
      ["progress", "analyzing"],
      ["completed", null],
    ]);
    expect(evs[1].lecture.status).toBe("done");

    expect(db.query(`SELECT stage, state, attempts, cache_hit FROM stage_run WHERE job_id = ?`).all(job.id)).toEqual([
      { stage: "legacy_distill", state: "succeeded", attempts: 1, cache_hit: 0 },
    ]);
    expect(
      db.query(`SELECT status, input_tokens, output_tokens, cost_microusd FROM ai_call WHERE job_id = ?`).all(job.id)
    ).toEqual([{ status: "ok", input_tokens: 3100, output_tokens: 900, cost_microusd: 5700 }]);
    expect((db.query(`SELECT spent_microusd FROM job WHERE id = ?`).get(job.id) as any).spent_microusd).toBe(5700);
    // The notes live in `lectures` only: the stage's copy is gone with the job.
    expect(db.query(`SELECT COUNT(*) AS n FROM artifact WHERE job_id = ?`).get(job.id)).toEqual({ n: 0 });
  });

  test("the user's title wins over the one derived from the Markdown", async () => {
    const { id, job } = pendingLecture("암호학");
    job.payload = { ...job.payload, title: "3주차 운영 모드" };
    await runDistillationOnHarness(job, { provider: fakeGemini().provider, harness: testHarness() });
    expect(getLectureById(id)!.title).toBe("3주차 운영 모드");
  });

  test("a transient failure emits the same 'retrying' progress and retries on the same stage run", async () => {
    const { id, job } = pendingLecture();
    const gemini = fakeGemini([new Error("Gemini generateContent failed (503): overloaded")]);
    expect(await runDistillationOnHarness(job, { provider: gemini.provider, harness: testHarness() })).toEqual({ ok: true });
    expect(events(id).map((e) => [e.type, e.stage ?? null, e.stage_message ?? null])).toEqual([
      ["progress", "analyzing", "쉬는시간 필터링 및 강의 핵심 노트 구조화 중..."],
      ["progress", "retrying", "일시적 네트워크/API 오류 자동 재시도 중 (2/3)..."],
      ["progress", "analyzing", "쉬는시간 필터링 및 강의 핵심 노트 구조화 중..."],
      ["completed", null, null],
    ]);
    expect(db.query(`SELECT attempts FROM stage_run WHERE job_id = ?`).get(job.id)).toEqual({ attempts: 2 });
    expect(
      (db.query(`SELECT status FROM ai_call WHERE job_id = ? ORDER BY status`).all(job.id) as any[]).map((r) => r.status)
    ).toEqual(["error", "ok"]);
  });

  test("a job resumed after Gemini answered (crash before publish) publishes without a second call", async () => {
    const { id, job, audioPath } = pendingLecture();
    const harness = testHarness();
    const gemini = fakeGemini();
    // The stage finished and was recorded, then the process died before publishing.
    await harness
      .job({ jobId: job.id, scope: `owner:${job.ownerId}` })
      .run(legacyDistillStage(gemini.provider), { audioPath, course: "정보보호", model: "gemini-3.8-flash" });
    expect(getLectureById(id)!.status).toBe("processing");

    expect(await runDistillationOnHarness(job, { provider: gemini.provider, harness })).toEqual({ ok: true });
    expect(gemini.calls()).toBe(1);
    expect(getLectureById(id)!.status).toBe("done");
    expect(events(id).map((e) => e.type)).toEqual(["completed"]); // no Gemini progress: no Gemini call
    expect(db.query(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ?`).get(job.id)).toEqual({ n: 1 });
  });

  test("a lecture deleted while Gemini works is not published and gets no error event", async () => {
    const { id, job } = pendingLecture();
    const provider = geminiLegacyDistillProvider(async (opts) => {
      deleteLectureById(id);
      return recorded(opts);
    });
    expect(await runDistillationOnHarness(job, { provider, harness: testHarness() })).toEqual({
      ok: false,
      error: LECTURE_GONE_MESSAGE,
    });
    expect(getLectureById(id)).toBeNull();
    expect(events(id).filter((e) => e.type !== "deleted")).toEqual([]);
  });

  // Embedded worker: a compaction queued from inside the handler was leased at once and
  // refused, because the distill job still held the lecture ("distill:<id>").
  test.skipIf(!isFfmpegAvailable())(
    "auto-compaction is queued only once the distill job's row is finished, and then runs",
    async () => {
      // 95 s like the recorded distillation's durationSec: compaction checks the length.
      const wav = join(DATA_DIR, "uploads", `${generateId("aud")}.wav`);
      const ffmpeg = Bun.spawnSync(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=95:sample_rate=16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
        { stdout: "ignore", stderr: "pipe" }
      );
      expect(ffmpeg.exitCode).toBe(0);
      const { id, job } = pendingLecture("정보보호", wav);
      // The queue's dedupe key, held while the job runs: isLectureBusy(id, "distill").
      db.query(`UPDATE job SET idempotency_key = ? WHERE id = ?`).run(`distill:${id}`, job.id);
      const compactions = () =>
        db.query(`SELECT id FROM job WHERE kind = 'compact' AND subject_id = ?`).all(id) as Array<{ id: string }>;

      updateSystemSettings({ storage_auto_compact: true });
      try {
        const outcome = await runDistillationOnHarness(job, { provider: fakeGemini().provider, harness: testHarness() });
        expect(outcome.ok).toBe(true);
        expect(compactions()).toEqual([]);

        // What JobWorker.execute does after the handler: finish the row, then the follow-up.
        db.query(`UPDATE job SET state = 'succeeded', idempotency_key = NULL, finished_at = ? WHERE id = ?`).run(
          Date.now(),
          job.id
        );
        outcome.followUp!();
        const [compact] = compactions();
        const done = await waitForJob(compact!.id, 30_000);
        expect(done).toMatchObject({ state: "succeeded", error: null });
        expect(getLectureById(id)!.audio_compact_state).toBe("compacted");
      } finally {
        updateSystemSettings({ storage_auto_compact: false });
      }
    },
    60_000
  );

  test("the flag picks the engine; both fail a keyless distillation the same way, offline", async () => {
    // The sandbox has no Gemini key: the real provider fails before any network access.
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    const results: Array<{ outcome: unknown; error: string | null; events: unknown[]; stageRuns: number }> = [];
    for (const engine of ["legacy", "harness"]) {
      process.env.LECTERN_DISTILL_ENGINE = engine;
      resetConfigForTests();
      const { id, job } = pendingLecture();
      const outcome = await runDistillation(job);
      const lecture = getLectureById(id)!;
      results.push({
        outcome,
        error: lecture.error_message,
        events: events(id).map((e) => [e.type, e.error_message]),
        stageRuns: (db.query(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ?`).get(job.id) as any).n,
      });
      expect(lecture.status).toBe("error");
    }
    const [legacy, harness] = results;
    expect(legacy!.error).toContain("GEMINI_API_KEY is not configured");
    expect(harness!.outcome).toEqual(legacy!.outcome);
    expect(harness!.error).toBe(legacy!.error);
    expect(harness!.events).toEqual(legacy!.events);
    expect(legacy!.stageRuns).toBe(0);
    expect(harness!.stageRuns).toBe(1);
  });

  test("blobs land under DATA_DIR/blobs, owner-only", async () => {
    const { job } = pendingLecture();
    const harness = testHarness();
    const gemini = fakeGemini();
    const res = await harness
      .job({ jobId: job.id, scope: `owner:${job.ownerId}` })
      .run(legacyDistillStage(gemini.provider), {
        audioPath: job.payload.audioPath as string,
        course: "정보보호",
        model: "gemini-3.8-flash",
      });
    const path = harness.blobs.path(res.output.sha256);
    expect(path.startsWith(join(DATA_DIR, "blobs"))).toBe(true);
    expect((await Bun.file(path).stat()).mode & 0o777).toBe(0o600);
    harness.deleteArtifactsForJob(job.id);
    expect(existsSync(path)).toBe(false);
  });
});
