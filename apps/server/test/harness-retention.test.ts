// Harness artifacts are copies of a recording's content: they must go with the recording
// (privacy policy §3), and maintenance must clean up what pruned jobs and crashes leave.

import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineStage, Harness, sha256Hex } from "@lectern/harness";
import { z } from "zod";
import {
  DATA_DIR,
  HARNESS_BLOB_DIR,
  createPendingLecture,
  createUser,
  db,
  deleteLectureAudioOnly,
  deleteLectureById,
  deleteUserAndData,
  ensureBootstrapOwner,
  failLectureRecord,
  generateId,
  getLectureById,
  getSystemSettings,
  updateSystemSettings,
} from "../src/db.ts";
import "../src/job-handlers.ts"; // registers the distill handler and its onLost hook
import { runMaintenance } from "../src/ops.ts";
import { reclaimExpiredLeases } from "../src/queue.ts";

const originalSettings = getSystemSettings();
beforeAll(() => updateSystemSettings({ storage_auto_compact: false }));
afterAll(() => updateSystemSettings(originalSettings));

const harness = new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} });

/** Stands in for a v2 stage that keeps derived content (e.g. a transcript chunk). */
const derive = defineStage({
  name: "transcribe",
  version: 1,
  output: z.object({ text: z.string() }),
  key: (input: { text: string }) => ({ inputs: [sha256Hex(input.text)] }),
  async run(input, ctx) {
    await ctx.putArtifact("normalized_audio", `audio:${input.text}`);
    return { text: `전사: ${input.text}` };
  },
});

function lectureWithJob(ownerId = ensureBootstrapOwner().id, jobFields: { finishedAt?: number } = {}) {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${id}.m4a`);
  writeFileSync(audioPath, `audio for ${id}`);
  createPendingLecture({
    id,
    ownerId,
    title: "보존 테스트",
    course: "보존",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 16,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  const jobId = `job_${crypto.randomUUID()}`;
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at, finished_at)
     VALUES (?, ?, 'harness-retention-test', ?, ?, 0, '{}', 0, ?)`
  ).run(jobId, ownerId, id, jobFields.finishedAt ? "succeeded" : "running", jobFields.finishedAt ?? null);
  return { id, jobId, ownerId };
}

const artifactCount = (jobId: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM artifact WHERE job_id = ?`).get(jobId) as { n: number }).n;

describe("deleting a recording deletes its harness artifacts", () => {
  test("deleteLectureById removes the artifacts and blobs, but not a blob another recording still uses", async () => {
    const mine = lectureWithJob();
    const other = lectureWithJob();
    const res = await harness.job({ jobId: mine.jobId, scope: "owner:x" }).run(derive, { text: "공유 내용" });
    await harness.job({ jobId: other.jobId, scope: "owner:x" }).run(derive, { text: "공유 내용" }); // cache hit
    const own = await harness.job({ jobId: mine.jobId, scope: "owner:x" }).run(derive, { text: "내 내용" });

    expect(deleteLectureById(mine.id)).toBe(true);
    expect(artifactCount(mine.jobId)).toBe(0);
    expect(harness.blobs.has(own.output.sha256)).toBe(false);
    expect(harness.blobs.has(sha256Hex("audio:내 내용"))).toBe(false);
    expect(harness.blobs.has(res.output.sha256)).toBe(true);
    expect(artifactCount(other.jobId)).toBe(2);
    // Job records (no content) stay until the job row is pruned.
    expect((db.query(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ?`).get(mine.jobId) as any).n).toBe(2);
  });

  test("'오디오만 삭제' also removes derived content (normalized audio is audio)", async () => {
    const lec = lectureWithJob();
    const res = await harness.job({ jobId: lec.jobId, scope: "owner:x" }).run(derive, { text: "오디오 파생" });
    expect(deleteLectureAudioOnly(lec.id).ok).toBe(true);
    expect(artifactCount(lec.jobId)).toBe(0);
    expect(harness.blobs.has(res.output.sha256)).toBe(false);
    expect(harness.blobs.has(sha256Hex("audio:오디오 파생"))).toBe(false);
    expect(getLectureById(lec.id)).not.toBeNull(); // the document stays
  });

  test("deleting a user deletes the artifacts of every recording", async () => {
    const user = createUser({
      email: `retention-${crypto.randomUUID()}@harness.test`,
      displayName: "보존",
      password: "correct_password_1",
    });
    const lec = lectureWithJob(user.id);
    const res = await harness.job({ jobId: lec.jobId, scope: `owner:${user.id}` }).run(derive, { text: "계정 삭제" });
    expect(deleteUserAndData(user.id)).toBe(true);
    expect(artifactCount(lec.jobId)).toBe(0);
    expect(harness.blobs.has(res.output.sha256)).toBe(false);
  });
});

describe("maintenance", () => {
  test("after a finished job is pruned (30 days), its stage runs and blobs go and its ai_call rows turn anonymous", async () => {
    const now = Date.now();
    const lec = lectureWithJob(undefined, { finishedAt: now - 31 * 24 * 3600_000 });
    const res = await harness.job({ jobId: lec.jobId, scope: "owner:x" }).run(derive, { text: "오래된 작업" });
    db.query(
      `INSERT INTO ai_call (id, job_id, stage_run_id, provider, model, input_tokens, cost_microusd, status, request_id, created_at)
       VALUES (?, ?, ?, 'gemini', 'gemini-3.8-flash', 100, 75, 'ok', 'resp-old', ?)`
    ).run(`aic_${crypto.randomUUID()}`, lec.jobId, res.stageRunId, now);

    const result = await runMaintenance({ isBusy: () => false, now });
    expect(result.errors).toEqual([]);
    expect(result.harnessCleanup).toMatchObject({ stageRuns: 1, artifacts: 2, detachedAiCalls: 1 });
    expect(result.harnessCleanup!.blobs).toBeGreaterThanOrEqual(2);
    expect(harness.blobs.has(res.output.sha256)).toBe(false);
    expect(db.query(`SELECT 1 FROM job WHERE id = ?`).get(lec.jobId)).toBeNull();
    expect(db.query(`SELECT 1 FROM stage_run WHERE job_id = ?`).get(lec.jobId)).toBeNull();
    expect(db.query(`SELECT job_id, stage_run_id, request_id, cost_microusd FROM ai_call WHERE request_id IS NULL AND cost_microusd = 75`).all()).toContainEqual({
      job_id: null,
      stage_run_id: null,
      request_id: null,
      cost_microusd: 75,
    });
  });

  test("artifacts a still-running job commits after its lecture was deleted go at the next maintenance", async () => {
    const lec = lectureWithJob();
    const run = harness.job({ jobId: lec.jobId, scope: "owner:x" });
    await run.run(derive, { text: "삭제 전" });
    deleteLectureById(lec.id);
    expect(artifactCount(lec.jobId)).toBe(0);
    // The job's next stage was already running and commits afterwards.
    const late = await run.run(derive, { text: "삭제 후 커밋" });
    expect(artifactCount(lec.jobId)).toBe(2);

    const result = await runMaintenance({ isBusy: () => false });
    expect(result.errors).toEqual([]);
    expect(artifactCount(lec.jobId)).toBe(0);
    expect(harness.blobs.has(late.output.sha256)).toBe(false);
    expect(harness.blobs.has(sha256Hex("audio:삭제 후 커밋"))).toBe(false);
  });

  test("a distill job given up after repeated interruptions leaves no artifacts behind", async () => {
    const lec = lectureWithJob();
    // A distill job the worker kept losing; run_after in the future so no live worker leases it.
    db.query(
      `UPDATE job SET kind = 'distill', state = 'queued', attempts = 3, max_attempts = 3, run_after = ? WHERE id = ?`
    ).run(Date.now() + 3600_000, lec.jobId);
    await harness.job({ jobId: lec.jobId, scope: "owner:x" }).run(derive, { text: "중단된 작업" });
    expect(artifactCount(lec.jobId)).toBe(2);

    reclaimExpiredLeases();
    expect((db.query(`SELECT state, error_code FROM job WHERE id = ?`).get(lec.jobId) as any)).toEqual({
      state: "failed",
      error_code: "lease_lost",
    });
    expect(artifactCount(lec.jobId)).toBe(0);
    expect(getLectureById(lec.id)!.status).toBe("error"); // the existing onLost behaviour still runs
    failLectureRecord(lec.id, "cleanup");
  });
});
