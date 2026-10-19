import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleRequest, isRetryableDistillError } from "../src/index.ts";
import {
  DATA_DIR,
  completeLectureRecord,
  createPendingLecture,
  createSession,
  createUser,
  db,
  deleteUserAndData,
  ensureBootstrapOwner,
  failLectureRecord,
  generateId,
  getLectureById,
  getSystemSettings,
  recordAuditLog,
  updateSystemSettings,
  type SystemSettings,
} from "../src/db.ts";
import { enqueueJob, snapshotJobs } from "../src/jobs.ts";
import {
  TRASH_DIR,
  UPLOADS_DIR,
  compactLectureAudio,
  isFfmpegAvailable,
  purgeTrash,
} from "../src/storage.ts";
import { BACKUP_DIR, DEPLOY_REPO_DIR, redactUrlForLog } from "../src/ops.ts";

const hasFfmpeg = isFfmpegAvailable();
const originalSettings: SystemSettings = getSystemSettings();
afterAll(() => {
  updateSystemSettings(originalSettings);
});

function uniq(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function ownerToken(): string {
  return createSession(ensureBootstrapOwner().id);
}

function memberToken(): { token: string; userId: string } {
  const user = createUser({
    email: `${uniq("member")}@ops.test`,
    displayName: "Member",
    password: "member_password_1",
  });
  return { token: createSession(user.id), userId: user.id };
}

function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return handleRequest(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    })
  );
}

function makeDoneLecture(
  audioPath: string | null,
  opts: { durationSec?: number; ownerId?: string } = {}
): string {
  const id = generateId("lec");
  createPendingLecture({
    id,
    ownerId: opts.ownerId || ensureBootstrapOwner().id,
    title: "ops test",
    course: "운영 테스트",
    audioPath: audioPath || "/nonexistent.m4a",
    audioMime: "audio/mp4",
    audioSize: audioPath && existsSync(audioPath) ? statSync(audioPath).size : 0,
    audioSha256: uniq("sha"),
    modelRequested: "gemini-flash-latest",
    sourceClient: "bun-test", // keeps completeLectureRecord out of the lecture archive
  });
  completeLectureRecord(id, {
    title: "ops test",
    courseName: "운영 테스트",
    markdown: "# 운영 테스트\n\n- [00:01] 압축 테스트 노트입니다. 충분히 긴 문장이 필요합니다.",
    excerpt: "압축 테스트",
    modelUsed: "gemini-test",
    durationSec: opts.durationSec ?? 0,
  });
  return id;
}

async function ffmpegToUploads(ext: string, args: string[]): Promise<string> {
  const path = join(UPLOADS_DIR, `${generateId("aud")}${ext}`);
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args, path], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`ffmpeg fixture failed: ${stderr}`);
  return path;
}

async function waitFor(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await Bun.sleep(50);
  }
}

describe("admin ops & storage API access", () => {
  const endpoints: Array<[string, string]> = [
    ["GET", "/api/admin/ops"],
    ["GET", "/api/admin/storage"],
    ["GET", "/api/admin/lectures"],
    ["POST", "/api/admin/storage/compact"],
    ["POST", "/api/admin/storage/gc"],
    ["POST", "/api/admin/storage/retention"],
    ["POST", "/api/admin/maintenance/run"],
  ];

  test("non-admins are refused and anonymous callers must sign in", async () => {
    const member = memberToken();
    for (const [method, path] of endpoints) {
      const asMember = await api(path, member.token, {
        method,
        body: method === "POST" ? JSON.stringify({ dryRun: true }) : undefined,
      });
      expect(asMember.status).toBe(403);
      const anon = await handleRequest(new Request(`http://localhost${path}`, { method }));
      expect(anon.status).toBe(401);
    }
    deleteUserAndData(member.userId);
  });

  test("ops and storage snapshots have the contract's shape", async () => {
    const token = ownerToken();
    const ops: any = await (await api("/api/admin/ops", token)).json();
    expect(ops.ok).toBe(true);
    expect(typeof ops.server.uptimeSec).toBe("number");
    expect(ops.server.requests.total).toBeGreaterThan(0);
    expect(ops.jobs.concurrency.distill).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(ops.jobs.running)).toBe(true);
    expect(ops.database.users).toBeGreaterThan(0);
    expect(typeof ops.backups.keep).toBe("number");
    expect(ops.maintenance.intervalMin).toBeGreaterThan(0);

    const storage: any = await (await api("/api/admin/storage", token)).json();
    expect(storage.ok).toBe(true);
    expect(typeof storage.totals.audioBytes).toBe("number");
    expect(storage.compaction.bitrateKbps).toBe(getSystemSettings().storage_compact_bitrate_kbps);
    expect(storage.trash.retentionDays).toBeGreaterThan(0);
    expect(Array.isArray(storage.byUser)).toBe(true);
  });

  test("health reports database and disk checks", async () => {
    const res = await handleRequest(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.checks.database).toBe("ok");
    expect(["ok", "low", "unknown"]).toContain(data.checks.disk);
  });
});

describe("storage settings", () => {
  test("bitrate is clamped and negative retention values are ignored", async () => {
    const token = ownerToken();
    const res = await api("/api/admin/settings", token, {
      method: "PATCH",
      body: JSON.stringify({
        storage_compact_bitrate_kbps: 500,
        audio_retention_days: -3,
        audit_retention_days: 90,
        storage_auto_compact: false,
      }),
    });
    expect(res.status).toBe(200);
    const { settings }: any = await res.json();
    expect(settings.storage_compact_bitrate_kbps).toBe(96);
    expect(settings.audio_retention_days).toBe(originalSettings.audio_retention_days);
    expect(settings.audit_retention_days).toBe(90);
    expect(settings.storage_auto_compact).toBe(false);
    updateSystemSettings(originalSettings);
  });
});

describe("audio compaction", () => {
  test.skipIf(!hasFfmpeg)(
    "a WAV upload is re-encoded to a much smaller m4a and the original upload is removed",
    async () => {
      const wav = await ffmpegToUploads(".wav", [
        "-f", "lavfi", "-i", "sine=frequency=440:duration=12:sample_rate=44100",
        "-ac", "2", "-c:a", "pcm_s16le",
      ]);
      const originalSize = statSync(wav).size;
      const id = makeDoneLecture(wav, { durationSec: 12 });
      const sha = getLectureById(id)!.audio_sha256;

      const res = await compactLectureAudio(id, 40);
      expect(res.ok).toBe(true);
      expect(res.state).toBe("compacted");

      const rec = getLectureById(id)!;
      expect(rec.audio_path!.endsWith(".m4a")).toBe(true);
      expect(rec.audio_mime).toBe("audio/mp4");
      expect(rec.audio_compact_state).toBe("compacted");
      expect(rec.audio_original_size).toBe(originalSize);
      expect(rec.audio_size).toBe(statSync(rec.audio_path!).size);
      expect(rec.audio_size).toBeLessThan(originalSize / 5);
      expect(rec.audio_sha256).toBe(sha); // upload idempotency key is preserved
      expect(existsSync(wav)).toBe(false);
      expect(res.savedBytes).toBe(originalSize - rec.audio_size);

      // Already compacted: a second pass is a no-op.
      const again = await compactLectureAudio(id, 40);
      expect(again.state).toBe("unchanged");
    }
  );

  test.skipIf(!hasFfmpeg)(
    "an already-compact file is left as is and not offered again",
    async () => {
      const small = await ffmpegToUploads(".m4a", [
        "-f", "lavfi", "-i", "sine=frequency=300:duration=8:sample_rate=16000",
        "-ac", "1", "-c:a", "aac", "-b:a", "24k",
      ]);
      const size = statSync(small).size;
      const id = makeDoneLecture(small, { durationSec: 8 });
      const res = await compactLectureAudio(id, 64);
      expect(res.state).toBe("skipped");
      const rec = getLectureById(id)!;
      expect(rec.audio_path).toBe(small);
      expect(rec.audio_size).toBe(size);
      expect(rec.audio_compact_state).toBe("skipped");

      const token = ownerToken();
      const preview: any = await (
        await api("/api/admin/storage/compact", token, {
          method: "POST",
          body: JSON.stringify({ ids: [id], dryRun: true }),
        })
      ).json();
      expect(preview.candidates).toBe(0);
    }
  );

  test.skipIf(!hasFfmpeg)("the admin endpoint previews, then queues compaction jobs", async () => {
    const wav = await ffmpegToUploads(".wav", [
      "-f", "lavfi", "-i", "sine=frequency=520:duration=6:sample_rate=32000",
      "-ac", "1", "-c:a", "pcm_s16le",
    ]);
    const id = makeDoneLecture(wav, { durationSec: 6 });
    const token = ownerToken();

    const preview: any = await (
      await api("/api/admin/storage/compact", token, {
        method: "POST",
        body: JSON.stringify({ ids: [id], dryRun: true }),
      })
    ).json();
    expect(preview.dryRun).toBe(true);
    expect(preview.candidates).toBe(1);
    expect(preview.queued).toBe(0);
    expect(preview.estimatedSavedBytes).toBeGreaterThan(0);
    expect(getLectureById(id)!.audio_compact_state).toBeNull();

    const run: any = await (
      await api("/api/admin/storage/compact", token, {
        method: "POST",
        body: JSON.stringify({ ids: [id] }),
      })
    ).json();
    expect(run.queued).toBe(1);
    await waitFor(() => getLectureById(id)!.audio_compact_state === "compacted");
    expect(snapshotJobs().recent.some((j) => j.kind === "compact" && j.lectureId === id && j.ok)).toBe(true);
  });

  test("compaction never touches audio outside the uploads folder", async () => {
    const id = makeDoneLecture(null);
    const res = await compactLectureAudio(id, 40);
    expect(res.ok).toBe(false);
    expect(res.state).toBe("unchanged");
  });
});

describe("orphan uploads, trash and retention", () => {
  test("only old, unreferenced files with our naming are moved to the trash", async () => {
    const oldOrphan = `${generateId("aud")}.m4a`;
    const freshOrphan = `${generateId("aud")}.m4a`;
    const foreign = `keep-me-${uniq("x")}.m4a`;
    for (const name of [oldOrphan, freshOrphan, foreign]) {
      writeFileSync(join(UPLOADS_DIR, name), "orphan");
    }
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    utimesSync(join(UPLOADS_DIR, oldOrphan), twoHoursAgo, twoHoursAgo);
    utimesSync(join(UPLOADS_DIR, foreign), twoHoursAgo, twoHoursAgo);

    const token = ownerToken();
    const preview: any = await (
      await api("/api/admin/storage/gc", token, { method: "POST", body: JSON.stringify({ dryRun: true }) })
    ).json();
    expect(preview.orphans.files).toContain(oldOrphan);
    expect(preview.orphans.files).not.toContain(freshOrphan);
    expect(preview.orphans.files).not.toContain(foreign);
    expect(preview.movedToTrash).toBe(0);
    expect(existsSync(join(UPLOADS_DIR, oldOrphan))).toBe(true);

    const run: any = await (
      await api("/api/admin/storage/gc", token, { method: "POST", body: JSON.stringify({}) })
    ).json();
    expect(run.movedToTrash).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(UPLOADS_DIR, oldOrphan))).toBe(false);
    expect(existsSync(join(TRASH_DIR, oldOrphan))).toBe(true);
    expect(existsSync(join(UPLOADS_DIR, freshOrphan))).toBe(true);
    expect(existsSync(join(UPLOADS_DIR, foreign))).toBe(true);

    // Trash is emptied only after its retention window.
    purgeTrash(Date.now());
    expect(existsSync(join(TRASH_DIR, oldOrphan))).toBe(true);
    purgeTrash(Date.now() + 30 * 86400_000);
    expect(existsSync(join(TRASH_DIR, oldOrphan))).toBe(false);
  });

  test("retention removes old audio (keeping notes) and deletes stale failed lectures", async () => {
    const token = ownerToken();
    updateSystemSettings({ audio_retention_days: 30, failed_audio_retention_days: 14 });
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();

    const audioPath = join(UPLOADS_DIR, `${generateId("aud")}.m4a`);
    writeFileSync(audioPath, "x".repeat(2048));
    const doneId = makeDoneLecture(audioPath);
    db.query(`UPDATE lectures SET created_at = ? WHERE id = ?`).run(old, doneId);

    const failedId = generateId("lec");
    createPendingLecture({
      id: failedId,
      ownerId: ensureBootstrapOwner().id,
      title: "실패 강의",
      course: "운영 테스트",
      audioPath: "/nonexistent.m4a",
      audioMime: "audio/mp4",
      audioSize: 0,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });
    failLectureRecord(failedId, "boom");
    db.query(`UPDATE lectures SET updated_at = ? WHERE id = ?`).run(old, failedId);

    const recentId = makeDoneLecture(null);

    const preview: any = await (
      await api("/api/admin/storage/retention", token, { method: "POST", body: JSON.stringify({ dryRun: true }) })
    ).json();
    expect(preview.retention.count).toBeGreaterThanOrEqual(1);
    expect(preview.failedRetention.count).toBeGreaterThanOrEqual(1);
    expect(existsSync(audioPath)).toBe(true);

    await api("/api/admin/storage/retention", token, { method: "POST", body: JSON.stringify({}) });
    const done = getLectureById(doneId)!;
    expect(done.audio_path).toBeNull();
    expect(done.markdown).toContain("압축 테스트 노트");
    expect(existsSync(audioPath)).toBe(false);
    expect(getLectureById(failedId)).toBeNull();
    expect(getLectureById(recentId)).not.toBeNull();

    updateSystemSettings({ audio_retention_days: 0, failed_audio_retention_days: 0 });
  });
});

describe("maintenance", () => {
  test("purges expired rows, prunes audit history, and writes a rotated backup", async () => {
    const token = ownerToken();
    const member = memberToken();
    db.query(`UPDATE sessions SET expires_at = ? WHERE token = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
      member.token
    );
    updateSystemSettings({ audit_retention_days: 30 });
    recordAuditLog({ actorId: "t", actorEmail: "t@ops.test", action: "test.old", detail: "old" });
    db.query(`UPDATE audit_logs SET created_at = ? WHERE action = 'test.old'`).run(
      new Date(Date.now() - 60 * 86400_000).toISOString()
    );

    const res = await api("/api/admin/maintenance/run", token, { method: "POST" });
    expect(res.status).toBe(200);
    const { result }: any = await res.json();
    expect(result.errors).toEqual([]);
    expect(result.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(result.prunedAuditLogs).toBeGreaterThanOrEqual(1);
    expect(result.walCheckpointed).toBe(true);
    expect(result.backup?.file).toMatch(/^lectern-\d{8}-\d{6}\.sqlite$/);
    expect(existsSync(join(BACKUP_DIR, result.backup.file))).toBe(true);
    expect(readdirSync(BACKUP_DIR).length).toBeGreaterThanOrEqual(1);
    expect(
      (db.query(`SELECT COUNT(*) AS n FROM sessions WHERE token = ?`).get(member.token) as any).n
    ).toBe(0);

    const ops: any = await (await api("/api/admin/ops", token)).json();
    expect(ops.maintenance.lastResult.backup.file).toBe(result.backup.file);
    expect(ops.backups.latest.file).toBe(result.backup.file);
    expect(DATA_DIR).toContain("lectern-test-"); // never the real data dir
    deleteUserAndData(member.userId);
  });
});

describe("job queue", () => {
  test("respects concurrency, deduplicates per lecture, and retry answers 409 while busy", async () => {
    const releases: Array<() => void> = [];
    const blocker = () =>
      new Promise<{ ok: boolean }>((resolve) => releases.push(() => resolve({ ok: true })));
    const ids = [makeDoneLecture(null), makeDoneLecture(null), makeDoneLecture(null)];
    const handles = ids.map((id) => enqueueJob("distill", id, blocker));
    const dup = enqueueJob("distill", ids[0], blocker);
    expect(dup.deduplicated).toBe(true);

    const snap = snapshotJobs();
    const mine = (list: typeof snap.running) => list.filter((j) => ids.includes(j.lectureId));
    expect(mine(snap.running).length).toBe(Math.min(3, snap.concurrency.distill));
    expect(mine(snap.running).length + mine(snap.queued).length).toBe(3);

    // A lecture with a job in flight cannot be re-run concurrently.
    const token = ownerToken();
    const retry = await api(`/api/lectures/${ids[0]}/retry`, token, { method: "POST" });
    expect(retry.status).toBe(409);

    while (releases.length) {
      releases.shift()!();
      await Bun.sleep(10);
    }
    await Promise.all(handles.map((h) => h.done));
    expect(snapshotJobs().running.filter((j) => ids.includes(j.lectureId)).length).toBe(0);
  });

  test("only transient Gemini failures are retried", () => {
    expect(isRetryableDistillError(new Error("GEMINI_API_KEY is not configured. Pass an API key"))).toBe(false);
    expect(isRetryableDistillError(new Error("Gemini generateContent failed (400): bad request"))).toBe(false);
    expect(isRetryableDistillError(new Error("Gemini generateContent failed (429): quota"))).toBe(true);
    expect(isRetryableDistillError(new Error("Gemini File API init failed (503): unavailable"))).toBe(true);
    expect(isRetryableDistillError(new Error("Gemini generateContent timed out after 900s"))).toBe(true);
    expect(isRetryableDistillError(new Error("녹음된 오디오에 음성 신호가 감지되지 않았습니다"))).toBe(false);
    expect(
      isRetryableDistillError(new Error("Gemini File processing did not reach ACTIVE state (state=FAILED)."))
    ).toBe(false);
    expect(
      isRetryableDistillError(new Error("Gemini File processing did not reach ACTIVE state (state=PROCESSING)."))
    ).toBe(true);
  });
});

describe("admin lecture list", () => {
  test("filters by status and search, with owner and job details", async () => {
    const token = ownerToken();
    const member = memberToken();
    const id = makeDoneLecture(null, { ownerId: member.userId });
    db.query(`UPDATE lectures SET title = ? WHERE id = ?`).run("검색용 특별한 제목", id);

    const res: any = await (
      await api(`/api/admin/lectures?status=done&q=${encodeURIComponent("특별한")}&limit=10`, token)
    ).json();
    expect(res.ok).toBe(true);
    const row = res.lectures.find((l: any) => l.id === id);
    expect(row).toBeTruthy();
    expect(row.owner_id).toBe(member.userId);
    expect(row.owner_email).toContain("@ops.test");
    expect(row.job_state).toBeNull();
    expect(row.compacted).toBe(false);

    const errors: any = await (await api(`/api/admin/lectures?status=error&q=${encodeURIComponent("특별한")}`, token)).json();
    expect(errors.lectures.some((l: any) => l.id === id)).toBe(false);

    // LIKE wildcards in the query are literal.
    const wild: any = await (await api(`/api/admin/lectures?q=${encodeURIComponent("%")}`, token)).json();
    expect(wild.lectures.some((l: any) => l.id === id)).toBe(false);
    deleteUserAndData(member.userId);
  });
});

describe("deploy & logging safety", () => {
  // Skipped wherever a deploy checkout exists, so this can never reset a real repo.
  test.skipIf(DEPLOY_REPO_DIR !== null)(
    "an authorized deploy refuses to run without an explicit checkout",
    async () => {
      process.env.LECTERN_DEPLOY_TOKEN = "deploy-secret-for-test";
      try {
        const res = await handleRequest(
          new Request("http://localhost/api/cd/deploy", {
            method: "POST",
            headers: { "X-Lectern-Deploy-Token": "deploy-secret-for-test" },
          })
        );
        expect(res.status).toBe(500);
        const data: any = await res.json();
        expect(data.ok).toBe(false);
        expect(data.error).toContain("LECTERN_REPO_DIR");
      } finally {
        delete process.env.LECTERN_DEPLOY_TOKEN;
      }
    }
  );

  test("credential query parameters are redacted in request logs", () => {
    const line = redactUrlForLog(
      new URL("http://localhost/api/lectures/x/audio?token=lct_secret&share=abc&q=keep")
    );
    expect(line).not.toContain("lct_secret");
    expect(line).not.toContain("share=abc");
    expect(line).toContain("q=keep");
  });
});

describe("storage accounting", () => {
  test("audio deleted after compaction no longer counts as space saved", async () => {
    const token = ownerToken();
    const before: any = await (await api("/api/admin/storage", token)).json();
    const id = makeDoneLecture(null);
    db.query(
      `UPDATE lectures SET audio_path = NULL, audio_size = 0, audio_original_size = 5000000,
         audio_compact_state = 'compacted' WHERE id = ?`
    ).run(id);
    const after: any = await (await api("/api/admin/storage", token)).json();
    expect(after.compaction.savedBytesTotal).toBe(before.compaction.savedBytesTotal);
  });

  test("the iOS shortcut recipe does not block on the distillation queue", async () => {
    const res = await handleRequest(new Request("http://localhost/api/clients/ios-shortcut"));
    const recipe: any = await res.json();
    expect(recipe.endpoint).toEndWith("/api/ingest/shortcut?wait=false");
    expect(recipe.instructions.join("\n")).toContain("/api/ingest/shortcut?wait=false");
    expect(recipe.instructions.join("\n")).not.toContain("${");
  });
});

describe("admin audit log API", () => {
  test("pages newest-first with a cursor, filters by action prefix and text, and counts per chip", async () => {
    const token = ownerToken();
    const tag = uniq("auditpage");
    const base = Date.now() - 3600_000;
    // 7 storage + 3 ops entries carrying a unique tag; two share a timestamp to exercise ties.
    for (let i = 0; i < 10; i++) {
      recordAuditLog({
        actorId: "t",
        actorEmail: `${tag}@ops.test`,
        action: i < 7 ? "storage.test" : "ops.test",
        targetId: `${tag}-${i}`,
        detail: `${tag} entry ${i}`,
      });
    }
    const rows = db
      .query(`SELECT id FROM audit_logs WHERE actor_email = ? ORDER BY rowid`)
      .all(`${tag}@ops.test`) as Array<{ id: string }>;
    rows.forEach((r, i) => {
      const at = new Date(base + (i === 4 ? 3 : i) * 1000).toISOString(); // rows 3 and 4 tie
      db.query(`UPDATE audit_logs SET created_at = ? WHERE id = ?`).run(at, r.id);
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api(
        `/api/admin/audit?q=${encodeURIComponent(tag)}&action=storage&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        token
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.total).toBe(7);
      expect(body.counts.all).toBe(10);
      expect(body.counts.storage).toBe(7);
      expect(body.counts.ops).toBe(3);
      expect(body.counts.auth).toBe(0);
      for (const log of body.logs) {
        expect(log.action).toBe("storage.test");
        seen.push(log.id);
      }
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7); // no duplicates or gaps across the tie
    const createdAt = seen.map(
      (id) => (db.query(`SELECT created_at FROM audit_logs WHERE id = ?`).get(id) as any).created_at
    );
    expect([...createdAt].sort().reverse()).toEqual(createdAt);

    // LIKE wildcards in the search are literal.
    const wild: any = await (await api(`/api/admin/audit?q=${encodeURIComponent("%")}`, token)).json();
    expect(wild.logs.some((l: any) => l.actor_email === `${tag}@ops.test`)).toBe(false);
  });

  test("rejects unknown action prefixes and malformed cursors, and is admin-only", async () => {
    const token = ownerToken();
    expect((await api("/api/admin/audit?action=evil", token)).status).toBe(400);
    expect((await api("/api/admin/audit?cursor=nonsense", token)).status).toBe(400);
    const member = memberToken();
    expect((await api("/api/admin/audit", member.token)).status).toBe(403);
    expect((await handleRequest(new Request("http://localhost/api/admin/audit"))).status).toBe(401);
    deleteUserAndData(member.userId);
  });
});

describe("admin lecture detail and status counts", () => {
  test("detail carries peek fields but never the note, and 404s for unknown ids", async () => {
    const token = ownerToken();
    const audioPath = join(UPLOADS_DIR, `${generateId("aud")}.m4a`);
    writeFileSync(audioPath, "x".repeat(1024));
    const id = makeDoneLecture(audioPath);
    const res = await api(`/api/admin/lectures/${id}`, token);
    expect(res.status).toBe(200);
    const { lecture }: any = await res.json();
    expect(lecture.id).toBe(id);
    expect(lecture.owner_email).toBeTruthy();
    expect(lecture.audio_in_uploads).toBe(true);
    expect(lecture.markdown_chars).toBeGreaterThan(10);
    expect(lecture.model_requested).toBe("gemini-flash-latest");
    expect(lecture.job_state).toBeNull();
    expect(lecture.markdown).toBeUndefined();
    expect(lecture.rendered).toBeUndefined();
    expect((await api(`/api/admin/lectures/${generateId("lec")}`, token)).status).toBe(404);
    const member = memberToken();
    expect((await api(`/api/admin/lectures/${id}`, member.token)).status).toBe(403);
    deleteUserAndData(member.userId);
  });

  test("list counts cover every status for the search, independent of the status filter", async () => {
    const token = ownerToken();
    const member = memberToken();
    const done = [makeDoneLecture(null, { ownerId: member.userId }), makeDoneLecture(null, { ownerId: member.userId })];
    const failed = makeDoneLecture(null, { ownerId: member.userId });
    failLectureRecord(failed, "boom");
    const q = `owner=${member.userId}`;
    const all: any = await (await api(`/api/admin/lectures?${q}`, token)).json();
    const errOnly: any = await (await api(`/api/admin/lectures?${q}&status=error`, token)).json();
    for (const body of [all, errOnly]) {
      expect(body.counts).toEqual({ all: 3, processing: 0, error: 1, done: 2 });
    }
    expect(all.total).toBe(3);
    expect(errOnly.total).toBe(1);
    expect(errOnly.lectures.map((l: any) => l.id)).toEqual([failed]);
    expect(done.every((id) => all.lectures.some((l: any) => l.id === id))).toBe(true);
    deleteUserAndData(member.userId);
  });
});

describe("Resend key from the credentials file", () => {
  test("signup requires an email code when the key is only in the credentials file", async () => {
    const credFile = process.env.LECTERN_RESEND_CREDENTIALS_FILE!;
    expect(credFile).toContain("lectern-test-"); // the sandbox path, never the host's real file
    expect(process.env.RESEND_API_KEY).toBeUndefined();
    const register = (email: string) =>
      handleRequest(
        new Request("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "signup_password_1", displayName: "가입" }),
        })
      );

    writeFileSync(credFile, JSON.stringify({ resend: { api_key: "re_test_only_not_real" } }));
    try {
      const res = await register(`${uniq("cred")}@ops.test`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toContain("인증번호");
    } finally {
      unlinkSync(credFile);
    }

    // Without any key, signup works without a code (local/dev behaviour is unchanged).
    const email = `${uniq("nocred")}@ops.test`;
    const ok = await register(email);
    expect([200, 201]).toContain(ok.status);
    const created = db.query(`SELECT id FROM users WHERE email = ?`).get(email) as { id: string } | null;
    if (created) deleteUserAndData(created.id);
  });
});
