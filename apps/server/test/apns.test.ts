import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId } from "@lectern/db";
import { Harness, ScriptedLlmProvider, ScriptedTranscriptionProvider, synthesizeSpeechTone, type ScriptLine } from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import { createApnsClient } from "../src/apns/client.ts";
import { APNS_TOKEN_TTL_MS, apnsAuth, apnsProviderToken, resetApnsTokenCache } from "../src/apns/jwt.ts";
import { notifyFinished, notifyStage, setApnsClientForTests, setApnsSleepForTests } from "../src/apns/notify.ts";
import { createPendingLecture, createUser, DATA_DIR, db, generateId, HARNESS_BLOB_DIR, syncPendingLectures, type UserRecord } from "../src/db.ts";
import { PROCESS_JOB_KIND, runProcessJob } from "../src/process-job.ts";
import { setLiveActivity, upsertPushDevice } from "../src/push-devices.ts";
import "../src/job-handlers.ts"; // registers the process handler's onLost / onCanceled
import { cancelQueuedJobs, embeddedWorker, reclaimExpiredLeases, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { startFakeApns, type FakeApns } from "./fakes/apns.ts";
import { notesAnswer } from "./fixtures/process-answers.ts";

// The APNs sender (P6-02, CONTRACTS D-P6-2 / D-P6-12) against a local fake APNs: the provider
// token, which pushes a stage change and the end of processing send, Apple's error answers,
// and that nothing connects when it is off. No request leaves this machine.

const TOPIC = "app.example.lectern";
const BASE_URL = "https://lectern.example";
const ENV_KEYS = ["LECTERN_APNS", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY_FILE", "APNS_TOPIC_IOS", "LECTERN_BASE_URL"] as const;

let fake: FakeApns;
let keyFile: string;
let publicKey: CryptoKey;
const sleeps: number[] = [];
const logs: string[] = [];
const spies: Array<{ mockRestore(): void }> = [];

function apnsEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): void {
  const values = {
    LECTERN_APNS: "1",
    APNS_TEAM_ID: "TEAM000001",
    APNS_KEY_ID: "KEY0000001",
    APNS_PRIVATE_KEY_FILE: keyFile,
    APNS_TOPIC_IOS: TOPIC,
    LECTERN_BASE_URL: BASE_URL,
    ...over,
  };
  for (const key of ENV_KEYS) process.env[key] = values[key];
  resetConfigForTests();
  resetApnsTokenCache();
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const dir = join(DATA_DIR, "apns-test");
  mkdirSync(dir, { recursive: true });
  keyFile = join(dir, "AuthKey_TEST.p8");
  writeFileSync(keyFile, `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`, { mode: 0o600 });
  fake = await startFakeApns();
  apnsEnv();
  setApnsSleepForTests(async (ms) => {
    sleeps.push(ms);
  });
  // Every log line of this file is kept for "no secrets in logs".
  const keep = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  spies.push(spyOn(console, "log").mockImplementation(keep), spyOn(console, "error").mockImplementation(keep));
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  setApnsClientForTests(null);
  setApnsSleepForTests(null);
  for (const key of ENV_KEYS) delete process.env[key];
  resetConfigForTests();
  resetApnsTokenCache();
  await fake.close();
});

beforeEach(() => {
  setApnsClientForTests(createApnsClient(fake.origin));
  sleeps.length = 0;
});

const randomHex = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const requestsTo = (token: string, f: FakeApns = fake) => f.requests.filter((r) => r.path === `/3/device/${token}`);

/** The pushes callers do not await: wait for them. */
async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for pushes");
    await Bun.sleep(20);
  }
}

function makeUser(): UserRecord {
  return createUser({ email: `${generateId("apns")}@example.com`, displayName: "apns", password: "correct_password_1" });
}

/** Recording id → its v1 lecture id. */
const lectureOf = new Map<string, string>();

/** A v1 lecture of `owner` projected into its v2 recording; returns the recording id. */
function recordingOf(owner: UserRecord, title = "자료구조 3주차"): string {
  const id = generateId("lec");
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const audioPath = join(DATA_DIR, "uploads", `${id}.m4a`);
  writeFileSync(audioPath, "audio");
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course: "자료구조",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  syncPendingLectures();
  lectureOf.set(lectureRecordingId(id), id);
  return lectureRecordingId(id);
}

function device(owner: UserRecord, pushToStartToken?: string): { id: string; token: string } {
  const id = crypto.randomUUID();
  const token = randomHex();
  const row = upsertPushDevice(owner.id, id, { platform: "ios", apnsToken: token, pushToStartToken });
  expect(row).not.toBe("taken");
  return { id, token };
}

function activity(recordingId: string, deviceId: string): string {
  const pushToken = randomHex();
  setLiveActivity({ recordingId, deviceId, pushToken });
  return pushToken;
}

const b64url = (part: string) => Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("provider token", () => {
  test("provider token header and claims", async () => {
    const auth = apnsAuth()!;
    expect(auth).toEqual({ teamId: "TEAM000001", keyId: "KEY0000001", keyFile });
    const now = Date.now();
    const token = await apnsProviderToken(auth, now);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(b64url(header!).toString("utf8"))).toEqual({ alg: "ES256", kid: "KEY0000001" });
    expect(JSON.parse(b64url(claims!).toString("utf8"))).toEqual({ iss: "TEAM000001", iat: Math.floor(now / 1000) });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      b64url(signature!),
      new TextEncoder().encode(`${header}.${claims}`)
    );
    expect(valid).toBe(true);
  });

  test("provider token is reused for 50 minutes", async () => {
    resetApnsTokenCache();
    const auth = apnsAuth()!;
    const now = Date.now();
    const first = await apnsProviderToken(auth, now);
    expect(await apnsProviderToken(auth, now + 49 * 60_000)).toBe(first);
    expect(APNS_TOKEN_TTL_MS).toBe(50 * 60_000);
    expect(await apnsProviderToken(auth, now + 51 * 60_000)).not.toBe(first);
  });
});

describe("stage pushes", () => {
  test("stage change sends one update", async () => {
    const owner = makeUser();
    const rec = recordingOf(owner);
    const d = device(owner);
    const push = activity(rec, d.id);
    await notifyStage(rec, "transcribe", 10);
    const sent = requestsTo(push);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers["apns-push-type"]).toBe("liveactivity");
    expect(sent[0]!.headers["apns-topic"]).toBe(`${TOPIC}.push-type.liveactivity`);
    expect(sent[0]!.headers["apns-priority"]).toBe("5");
    expect(sent[0]!.headers.authorization).toStartWith("bearer ");
    expect(sent[0]!.body.aps.event).toBe("update");
    expect(sent[0]!.body.aps["content-state"]).toEqual({
      stage: "transcribe",
      stage_label: "전사 중",
      progress: 10,
      recording_id: rec,
      document_ready: false,
    });
    // An alert is only for the end; the device token got nothing.
    expect(requestsTo(d.token)).toHaveLength(0);
  });

  test("same stage again sends nothing", async () => {
    const owner = makeUser();
    const rec = recordingOf(owner);
    const push = activity(rec, device(owner).id);
    await notifyStage(rec, "transcribe", 10);
    await notifyStage(rec, "transcribe", 40);
    expect(requestsTo(push)).toHaveLength(1);
    await notifyStage(rec, "structure", 80);
    expect(requestsTo(push).map((r) => r.body.aps["content-state"].stage)).toEqual(["transcribe", "structure"]);
  });

  test("push-to-start once", async () => {
    const owner = makeUser();
    const rec = recordingOf(owner, "운영체제 5주차");
    const startToken = randomHex();
    device(owner, startToken);
    await notifyStage(rec, "transcribe", 10);
    const sent = requestsTo(startToken);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers["apns-push-type"]).toBe("liveactivity");
    expect(sent[0]!.headers["apns-topic"]).toBe(`${TOPIC}.push-type.liveactivity`);
    expect(sent[0]!.body.aps.event).toBe("start");
    expect(sent[0]!.body.aps["attributes-type"]).toBe("ProcessingActivityAttributes");
    expect(sent[0]!.body.aps.attributes).toEqual({ recording_id: rec, title: "운영체제 5주차" });
    await notifyStage(rec, "structure", 80);
    expect(requestsTo(startToken)).toHaveLength(1);
  });
});

describe("finish", () => {
  test("finish ends the activity and alerts every device", async () => {
    const owner = makeUser();
    const rec = recordingOf(owner);
    const a = device(owner);
    const b = device(owner);
    const push = activity(rec, a.id);
    await notifyFinished(rec, "ready");
    const ends = requestsTo(push);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.body.aps.event).toBe("end");
    expect(ends[0]!.body.aps["content-state"]).toMatchObject({ stage: "done", progress: 100, document_ready: true });
    for (const token of [a.token, b.token]) {
      const alerts = requestsTo(token);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.headers["apns-push-type"]).toBe("alert");
      expect(alerts[0]!.headers["apns-topic"]).toBe(TOPIC);
      expect(alerts[0]!.body.aps.alert).toEqual({ title: "문서가 준비되었습니다", body: "자료구조 3주차" });
      expect(alerts[0]!.body.url).toBe(`${BASE_URL}/app/recordings/${rec}`);
    }
    expect((db.query(`SELECT state FROM live_activity WHERE recording_id = ?`).get(rec) as { state: string }).state).toBe("ended");
  });

  test("partial and failed titles", async () => {
    const owner = makeUser();
    const d = device(owner);
    await notifyFinished(recordingOf(owner), "partial");
    await notifyFinished(recordingOf(owner), "failed");
    expect(requestsTo(d.token).map((r) => r.body.aps.alert.title)).toEqual(["전사가 준비되었습니다", "녹음을 처리하지 못했습니다"]);
  });
});

describe("APNs answers", () => {
  test("410 removes the device token", async () => {
    const owner = makeUser();
    const d = device(owner);
    fake.respondWith(d.token, { status: 410, reason: "Unregistered" });
    await notifyFinished(recordingOf(owner), "ready");
    expect(requestsTo(d.token)).toHaveLength(1);
    expect(db.query(`SELECT id FROM push_device WHERE id = ?`).get(d.id)).toBeNull();
    expect(sleeps).toEqual([]);
  });

  test("429 and 503 are retried twice", async () => {
    const owner = makeUser();
    const d = device(owner);
    fake.respondWith(d.token, { status: 429, reason: "TooManyRequests" }, 1);
    fake.respondWith(d.token, { status: 503, reason: "ServiceUnavailable" }, 1);
    await notifyFinished(recordingOf(owner), "ready");
    expect(requestsTo(d.token)).toHaveLength(3);
    expect(sleeps).toEqual([1000, 4000]);
    expect(db.query(`SELECT id FROM push_device WHERE id = ?`).get(d.id)).not.toBeNull();
  });

  test("gives up after two retries", async () => {
    const owner = makeUser();
    const d = device(owner);
    fake.respondWith(d.token, { status: 503 });
    await expect(notifyFinished(recordingOf(owner), "ready")).resolves.toBeUndefined();
    expect(requestsTo(d.token)).toHaveLength(3);
    expect(db.query(`SELECT id FROM push_device WHERE id = ?`).get(d.id)).not.toBeNull();
  });

  test("expired provider token", async () => {
    const owner = makeUser();
    const d = device(owner);
    fake.respondWith(d.token, { status: 403, reason: "ExpiredProviderToken" }, 1);
    await notifyFinished(recordingOf(owner), "ready");
    const sent = requestsTo(d.token);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers.authorization).not.toBe(sent[0]!.headers.authorization);
    expect(sleeps).toEqual([]);
  });
});

describe("disabled", () => {
  async function silent(over: Parameters<typeof apnsEnv>[0]): Promise<void> {
    apnsEnv(over);
    const other = await startFakeApns();
    try {
      setApnsClientForTests(createApnsClient(other.origin));
      const owner = makeUser();
      const rec = recordingOf(owner);
      const startToken = randomHex();
      const d = device(owner, startToken);
      activity(rec, device(owner).id);
      await notifyStage(rec, "transcribe", 10);
      await notifyFinished(rec, "ready");
      expect(other.connections()).toBe(0);
      expect(other.requests).toEqual([]);
      expect(requestsTo(d.token)).toEqual([]);
    } finally {
      await other.close();
      apnsEnv();
    }
  }

  test("flag off: no connection", async () => {
    await silent({ LECTERN_APNS: "0" });
  });

  test("no key file: no connection", async () => {
    await silent({ APNS_PRIVATE_KEY_FILE: join(DATA_DIR, "apns-test", "missing.p8") });
  });
});

describe("robustness", () => {
  test("never throws", async () => {
    const closed = await startFakeApns();
    await closed.close();
    setApnsClientForTests(createApnsClient(closed.origin));
    const owner = makeUser();
    const rec = recordingOf(owner);
    device(owner, randomHex());
    activity(rec, device(owner).id);
    await expect(notifyStage(rec, "transcribe", 10)).resolves.toBeUndefined();
    await expect(notifyFinished(rec, "ready")).resolves.toBeUndefined();
  });

  test("a lost or canceled process job ends the activity", async () => {
    const owner = makeUser();
    const d = device(owner);

    // Interrupted three times (onLost): the activity ends as failed and the iPhone gets the alert.
    const lost = recordingOf(owner);
    const lostPush = activity(lost, d.id);
    db.query(
      `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at, attempts, max_attempts, lease_owner, lease_until)
       VALUES (?, ?, ?, ?, 'running', 0, '{}', ?, 2, 3, 'gone-worker', 1)`
    ).run(`job_${crypto.randomUUID()}`, owner.id, PROCESS_JOB_KIND, lectureOf.get(lost)!, Date.now());
    reclaimExpiredLeases();
    await until(() => requestsTo(lostPush).length === 1 && requestsTo(d.token).length === 1);
    expect(requestsTo(lostPush)[0]!.body.aps).toMatchObject({ event: "end", "content-state": { stage: "failed", document_ready: false } });
    expect(requestsTo(d.token)[0]!.body.aps.alert.title).toBe("녹음을 처리하지 못했습니다");

    // Canceled while queued (onCanceled): the activity ends as canceled, no alert. run_after
    // keeps a running worker away from it.
    const canceled = recordingOf(owner);
    const canceledPush = activity(canceled, d.id);
    const jobId = `job_${crypto.randomUUID()}`;
    db.query(
      `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at, cancel_requested_at)
       VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?)`
    ).run(jobId, owner.id, PROCESS_JOB_KIND, lectureOf.get(canceled)!, Date.now() + 3_600_000, Date.now(), Date.now());
    expect(cancelQueuedJobs(jobId)).toBe(1);
    await until(() => requestsTo(canceledPush).length === 1);
    expect(requestsTo(canceledPush)[0]!.body.aps).toMatchObject({ event: "end", "content-state": { stage: "canceled", stage_label: "취소됨" } });
    await Bun.sleep(50);
    expect(requestsTo(d.token)).toHaveLength(1); // still only the lost job's alert
  });

  describe.skipIf(!isFfmpegAvailable())("with a process job", () => {
    let paused: JobWorker | null = null;
    const jobs: string[] = [];
    beforeAll(async () => {
      process.env.LECTERN_WORKER_MODE = "external";
      process.env.LECTERN_PIPELINE = "v2";
      resetConfigForTests();
      paused = embeddedWorker();
      await paused?.drain(10_000);
    });
    afterAll(() => {
      for (const id of jobs) {
        db.query(`UPDATE job SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('queued', 'running')`).run(Date.now(), id);
      }
      delete process.env.LECTERN_WORKER_MODE;
      delete process.env.LECTERN_PIPELINE;
      resetConfigForTests();
      paused?.start();
    });

    test("process job triggers pushes", async () => {
      const owner = makeUser();
      const script: ScriptLine[] = Array.from({ length: 18 }, (_, i) => ({
        start_ms: i * 5000,
        end_ms: i * 5000 + 4000,
        speaker: "S1",
        text: `${i + 1}번째 문장에서는 블록 암호의 운영 모드를 설명한다.`,
      }));
      mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
      const audio = await synthesizeSpeechTone(script, 92_000, join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`));
      const lectureId = generateId("lec");
      createPendingLecture({
        id: lectureId,
        ownerId: owner.id,
        title: "",
        course: "정보보호",
        audioPath: audio,
        audioMime: "audio/mp4",
        audioSize: 0,
        modelRequested: "gemini-3.8-flash",
        sourceClient: "bun-test",
      });
      syncPendingLectures();
      const rec = lectureRecordingId(lectureId);
      const a = device(owner);
      const b = device(owner);
      const push = activity(rec, a.id);
      // One iPhone's alerts always fail: the job does not notice.
      fake.respondWith(b.token, { status: 500, reason: "InternalServerError" });

      const jobId = `job_${crypto.randomUUID()}`;
      const payload = { title: "", course: "정보보호" };
      db.query(
        `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at) VALUES (?, ?, ?, ?, 'running', 0, ?, ?)`
      ).run(jobId, owner.id, PROCESS_JOB_KIND, lectureId, JSON.stringify(payload), Date.now());
      jobs.push(jobId);
      const job: LeasedJob = { id: jobId, kind: PROCESS_JOB_KIND, subjectId: lectureId, ownerId: owner.id, payload, attempts: 0, secret: () => undefined };
      const transcription: ScriptedTranscriptionProvider = new ScriptedTranscriptionProvider(script);
      const outcome = await runProcessJob(job, {
        transcription,
        llm: new ScriptedLlmProvider(notesAnswer),
        harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
        pipeline: {
          concurrency: 1,
          chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 },
          onStage: (event) => transcription.observe(event),
        },
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.result).toMatchObject({ status: "ready" });

      // The pushes are not awaited by the job: wait for the last ones.
      await until(() => requestsTo(b.token).length === 3 && requestsTo(a.token).length === 1 && requestsTo(push).some((r) => r.body.aps.event === "end"));
      const stages = (
        db.query(`SELECT payload FROM job_event WHERE subject_id = ? AND type = 'progress' ORDER BY id`).all(lectureId) as Array<{ payload: string }>
      ).map((r) => JSON.parse(r.payload).stage as string);
      expect(stages.length).toBeGreaterThan(3);
      const toActivity = requestsTo(push);
      const updates = toActivity.filter((r) => r.body.aps.event === "update").map((r) => r.body.aps["content-state"].stage as string);
      expect(updates.sort()).toEqual([...stages].sort());
      expect(toActivity.filter((r) => r.body.aps.event === "end")).toHaveLength(1);
      expect(requestsTo(a.token).map((r) => r.body.aps.alert.title)).toEqual(["문서가 준비되었습니다"]);
      expect(requestsTo(b.token)).toHaveLength(3);
    }, 60_000);
  });

  test("no secrets in logs", () => {
    const text = logs.join("\n");
    // The flows above logged dropped and failed tokens: by their first 8 characters only.
    expect(text).toContain("apns token dropped");
    expect(text).toContain("apns push failed");
    const bearer = new Set(fake.requests.map((r) => r.headers.authorization!.replace(/^bearer /, "")));
    expect(bearer.size).toBeGreaterThan(1);
    for (const token of bearer) expect(text).not.toContain(token);
    const deviceTokens = new Set(fake.requests.map((r) => r.path.replace(/^\/3\/device\//, "")));
    for (const token of deviceTokens) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(token.slice(0, 9));
    }
    expect(text).not.toContain("PRIVATE KEY");
  });
});
