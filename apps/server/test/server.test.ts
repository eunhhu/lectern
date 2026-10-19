import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getClientIp,
  handleRequest,
  resetAuthRateLimits,
  resumeInterruptedLectures,
  syncLocalLecturesIfStale,
} from "../src/index.ts";
import {
  DATA_DIR,
  LECTURES_ROOT,
  MAX_VERIFICATION_CODE_ATTEMPTS,
  completeLectureRecord,
  createEmailVerificationCode,
  createPendingLecture,
  createUser,
  db,
  deleteLectureById,
  deleteUserAndData,
  ensureBootstrapOwner,
  failLectureRecord,
  generateId,
  getLectureById,
  getUserById,
  listInterruptedLectures,
  listLecturesForUser,
  setLectureVisibility,
  syncLocalLecturesDir,
  updateUserByAdmin,
  verifyEmailVerificationCode,
} from "../src/db.ts";

beforeEach(() => {
  resetAuthRateLimits();
});

describe("@lectern/server HTTP, Auth Isolation & SQLite E2E", () => {
  test("GET /api/health returns service status and authRequired: true without leaking private lectureCount or internal model names", async () => {
    const res = await handleRequest(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.status).toBe("ok");
    expect(data.authRequired).toBe(true);
    expect(data.lectureCount).toBeUndefined();
    expect(data.defaultModel).toBeUndefined();
    expect(typeof data.gitSha).toBe("string");
  });

  test("Unauthenticated requests to /api/lectures and /api/lectures/:id return 401", async () => {
    const listRes = await handleRequest(new Request("http://localhost/api/lectures"));
    expect(listRes.status).toBe(401);

    const owner = ensureBootstrapOwner();
    const id = generateId("unauth_lec");
    createPendingLecture({
      id,
      ownerId: owner.id,
      title: "비공개 강의",
      course: "정보보호개론",
      audioPath: "/tmp/nonexistent.m4a",
      audioMime: "audio/mp4",
      audioSize: 512,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });

    const detailRes = await handleRequest(
      new Request(`http://localhost/api/lectures/${id}`)
    );
    expect(detailRes.status).toBe(401);

    deleteLectureById(id);
  });

  test("Full lifecycle with Account Isolation: owner access, stranger 403 block, share page, and Elysium tokens", async () => {
    const owner = ensureBootstrapOwner();
    const id = generateId("test_lec");
    const pending = createPendingLecture({
      id,
      ownerId: owner.id,
      title: "테스트 강의",
      course: "정보보호개론",
      audioPath: "/tmp/nonexistent.m4a",
      audioMime: "audio/mp4",
      audioSize: 1024,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });

    expect(pending.status).toBe("processing");

    const done = completeLectureRecord(id, {
      title: "정보보호개론 · 대칭키 암호학",
      courseName: "정보보호개론",
      markdown: "# 📚 정보보호개론\n\n## 🎯 핵심\n- [10:15] AES-GCM 인증 암호화",
      excerpt: "AES-GCM 인증 암호화",
      modelUsed: "gemini-3.8-flash",
      durationSec: 3600,
    });

    expect(done.status).toBe("done");
    expect(done.model_used).toBe("gemini-3.8-flash");

    // Owner Detail endpoint with X-Lectern-Token
    const detailRes = await handleRequest(
      new Request(`http://localhost/api/lectures/${id}`, {
        headers: { "X-Lectern-Token": owner.api_token },
      })
    );
    expect(detailRes.status).toBe(200);
    const detailJson: any = await detailRes.json();
    expect(detailJson.rendered.html).toContain(`data-sec="615"`); // 10:15 = 615s

    // Register a separate stranger user and verify strict tenant isolation
    const strangerEmail = `stranger_${Date.now()}@example.com`;
    const regRes = await handleRequest(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: strangerEmail,
          displayName: "외부 사용자",
          password: "strangerPass123!",
        }),
      })
    );
    expect(regRes.status).toBe(201);
    const regJson: any = await regRes.json();
    const strangerToken = regJson.user.apiToken;

    // Stranger's lecture list must NOT contain owner's lecture
    const strangerListRes = await handleRequest(
      new Request("http://localhost/api/lectures", {
        headers: { "X-Lectern-Token": strangerToken },
      })
    );
    expect(strangerListRes.status).toBe(200);
    const strangerListJson: any = await strangerListRes.json();
    expect(strangerListJson.lectures.length).toBe(0);

    // Stranger trying to access owner's lecture detail gets 403 Forbidden
    const strangerDetailRes = await handleRequest(
      new Request(`http://localhost/api/lectures/${id}`, {
        headers: { "X-Lectern-Token": strangerToken },
      })
    );
    expect(strangerDetailRes.status).toBe(403);

    // By default, new lectures are private (is_public === 0), so /s/:token is 403 for unauthenticated strangers
    const privateShareRes = await handleRequest(
      new Request(`http://localhost/s/${done.share_token}`)
    );
    expect(privateShareRes.status).toBe(403);

    // Owner toggles visibility to PUBLIC via PATCH /api/lectures/:id/visibility
    const visRes = await handleRequest(
      new Request(`http://localhost/api/lectures/${id}/visibility`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Lectern-Token": owner.api_token,
        },
        body: JSON.stringify({ is_public: true }),
      })
    );
    expect(visRes.status).toBe(200);
    const visJson: any = await visRes.json();
    expect(visJson.lecture.is_public).toBe(true);

    // Now Share page endpoint (/s/:token) works publicly
    const shareRes = await handleRequest(
      new Request(`http://localhost/s/${done.share_token}`)
    );
    expect(shareRes.status).toBe(200);
    const shareHtml = await shareRes.text();
    expect(shareHtml).toContain("AES-GCM 인증 암호화");
    expect(shareHtml).toContain("--elysium-surface-canvas: #F8F9FA");
    expect(shareHtml).toContain("--elysium-surface-canvas: #111214");
    expect(shareHtml).toContain("--elysium-action-primary: #4F46E5");
    expect(shareHtml).toContain("Pretendard Variable");
    expect(shareHtml).not.toContain("gemini-3.8-flash");

    // SSE endpoint (/api/events) requires auth (401 without token, 200 text/event-stream with token)
    const unauthSse = await handleRequest(
      new Request("http://localhost/api/events")
    );
    expect(unauthSse.status).toBe(401);

    const authSse = await handleRequest(
      new Request("http://localhost/api/events", {
        headers: { "X-Lectern-Token": owner.api_token },
      })
    );
    expect(authSse.status).toBe(200);
    expect(authSse.headers.get("Content-Type")).toContain("text/event-stream");
    try {
      await authSse.body?.cancel();
    } catch {}

    // Main App UI verifies neutral light/dark palette, subtle borders, Resend email verification UI & Auth Gate
    const appRes = await handleRequest(new Request("http://localhost/"));
    expect(appRes.status).toBe(200);
    const appHtml = await appRes.text();
    expect(appHtml).toContain("--elysium-surface-canvas: #F8F9FA");
    expect(appHtml).toContain("--elysium-surface-canvas: #111214");
    expect(appHtml).toContain("--elysium-border-control: #DFE3E8");
    expect(appHtml).toContain("--elysium-action-primary: #4F46E5");
    expect(appHtml).toContain("--elysium-space-48: 48px");
    expect(appHtml).toContain("word-break: keep-all");
    expect(appHtml).toContain("font-variant-numeric: tabular-nums");
    expect(appHtml).toContain("id=\"auth-gate\"");
    expect(appHtml).not.toContain("gemini-flash-latest");
    expect(appHtml).not.toContain("BYOK");

    // Pages only run same-origin script files: CSP forbids inline script, and the
    // page script is served from /assets with a content hash.
    for (const res of [appRes, shareRes]) {
      const csp = res.headers.get("Content-Security-Policy") || "";
      const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
      expect(scriptSrc).toBe("script-src 'self'");
    }
    const appScriptSrc = appHtml.match(/<script src="(\/assets\/app\.js\?v=[0-9a-f]+)"><\/script>/)?.[1];
    expect(appScriptSrc).toBeDefined();
    const appJsRes = await handleRequest(new Request(`http://localhost${appScriptSrc}`));
    expect(appJsRes.status).toBe(200);
    expect(appJsRes.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(appJsRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(appJsRes.headers.get("Cache-Control")).toContain("immutable");
    const appJs = await appJsRes.text();
    expect(appJs).toContain("sendEmailVerificationCode");
    expect(appJs).toContain("lectern_audio_vault_v1");
    expect(appJs).toContain("retryLectureDistillation");
    expect(appJs).not.toContain("gemini-flash-latest");
    expect(appJs).not.toContain("BYOK");
    const staleJsRes = await handleRequest(new Request("http://localhost/assets/app.js?v=stale"));
    expect(staleJsRes.status).toBe(200);
    expect(staleJsRes.headers.get("Cache-Control")).toBe("no-cache");
    for (const missing of ["/assets/missing.js", "/assets/constructor", "/assets/"]) {
      expect((await handleRequest(new Request(`http://localhost${missing}`))).status).toBe(404);
    }

    // Verify Idempotent Upload Deduplication by Audio SHA-256 / Idempotency Key
    const idemKey = `test_idem_${Date.now()}`;
    const idemId = generateId("test_idem");
    createPendingLecture({
      id: idemId,
      ownerId: owner.id,
      title: "네트워크 재전송 방지 테스트",
      course: "정보보호개론",
      audioPath: "/tmp/nonexistent_idem.m4a",
      audioMime: "audio/mp4",
      audioSize: 2048,
      audioSha256: idemKey,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });

    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3, 4])], "retry.m4a", { type: "audio/mp4" }));
    form.append("course", "정보보호개론");
    form.append("idempotency_key", idemKey);

    const dupRes = await handleRequest(
      new Request("http://localhost/api/lectures/ingest", {
        method: "POST",
        headers: {
          "X-Lectern-Token": owner.api_token,
          "X-Idempotency-Key": idemKey,
        },
        body: form,
      })
    );
    expect(dupRes.status).toBe(200);
    const dupJson: any = await dupRes.json();
    expect(dupJson.deduplicated).toBe(true);
    expect(dupJson.lecture.id).toBe(idemId);
    deleteLectureById(idemId);

    // Owner Markdown download endpoint
    const mdRes = await handleRequest(
      new Request(`http://localhost/api/lectures/${id}/markdown`, {
        headers: { "X-Lectern-Token": owner.api_token },
      })
    );
    expect(mdRes.status).toBe(200);
    expect(await mdRes.text()).toContain("# 📚 정보보호개론");

    // Cleanup
    deleteUserAndData(regJson.user.id);
    expect(deleteLectureById(id)).toBe(true);
  });

  test("Resend 6-digit email verification code signup and password reset flow", async () => {
    const verifyEmail = `verified_${Date.now()}@test.local`;
    const code = createEmailVerificationCode(verifyEmail, "signup", 10);
    expect(code.length).toBe(6);

    // Wrong code rejected
    const badRegRes = await handleRequest(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifyEmail,
          displayName: "인증 가입자",
          password: "verified_pass_123",
          verificationCode: "000000",
        }),
      })
    );
    expect(badRegRes.status).toBe(400);

    // Correct code accepted
    const okRegRes = await handleRequest(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifyEmail,
          displayName: "인증 가입자",
          password: "verified_pass_123",
          verificationCode: code,
        }),
      })
    );
    expect(okRegRes.status).toBe(201);
    const okRegJson: any = await okRegRes.json();

    // Password reset via email verification code
    const resetCode = createEmailVerificationCode(verifyEmail, "reset", 10);
    const resetRes = await handleRequest(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifyEmail,
          verificationCode: resetCode,
          newPassword: "reset_password_789",
        }),
      })
    );
    expect(resetRes.status).toBe(200);

    // Login with reset password succeeds
    const loginRes = await handleRequest(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifyEmail,
          password: "reset_password_789",
        }),
      })
    );
    expect(loginRes.status).toBe(200);

    deleteUserAndData(okRegJson.user.id);
  });

  test("Password change, Admin CRM Console, and RBAC permission management", async () => {
    const adminOwner = createUser({
      email: `owner_${Date.now()}@test.local`,
      displayName: "테스트오너",
      password: "old_password_123",
      role: "owner",
      isAdmin: true,
    });
    const memberUser = createUser({
      email: `member_${Date.now()}@test.local`,
      displayName: "일반회원",
      password: "member_password_123",
      role: "member",
    });

    // 1. Self-service password change
    const pwFailRes = await handleRequest(
      new Request("http://localhost/api/auth/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lectern-Token": memberUser.api_token,
        },
        body: JSON.stringify({
          currentPassword: "wrong_password",
          newPassword: "new_password_456",
        }),
      })
    );
    expect(pwFailRes.status).toBe(400);

    const pwOkRes = await handleRequest(
      new Request("http://localhost/api/auth/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lectern-Token": memberUser.api_token,
        },
        body: JSON.stringify({
          currentPassword: "member_password_123",
          newPassword: "new_password_456",
        }),
      })
    );
    expect(pwOkRes.status).toBe(200);

    // Verify login works with new password
    const loginNewRes = await handleRequest(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: memberUser.email,
          password: "new_password_456",
        }),
      })
    );
    expect(loginNewRes.status).toBe(200);

    // 2. Non-admin blocked from /api/admin/overview
    const nonAdminRes = await handleRequest(
      new Request("http://localhost/api/admin/overview", {
        headers: { "X-Lectern-Token": memberUser.api_token },
      })
    );
    expect(nonAdminRes.status).toBe(403);

    // 3. Admin can access /admin UI and /api/admin/overview CRM
    const adminHtmlRes = await handleRequest(new Request("http://localhost/admin"));
    expect(adminHtmlRes.status).toBe(200);
    expect(await adminHtmlRes.text()).toContain("Lectern Admin");

    const crmRes = await handleRequest(
      new Request("http://localhost/api/admin/overview", {
        headers: { "X-Lectern-Token": adminOwner.api_token },
      })
    );
    expect(crmRes.status).toBe(200);
    const crmJson: any = await crmRes.json();
    expect(crmJson.ok).toBe(true);
    expect(Array.isArray(crmJson.users)).toBe(true);
    expect(Array.isArray(crmJson.auditLogs)).toBe(true);

    // 4. Admin updates member role to viewer (disables ingest) & adds CRM memo
    const patchUserRes = await handleRequest(
      new Request(`http://localhost/api/admin/users/${memberUser.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Lectern-Token": adminOwner.api_token,
        },
        body: JSON.stringify({
          role: "viewer",
          canIngest: false,
          canShare: false,
          memo: "열람 전용 테스터",
        }),
      })
    );
    expect(patchUserRes.status).toBe(200);
    const patchUserJson: any = await patchUserRes.json();
    expect(patchUserJson.user.role).toBe("viewer");
    expect(patchUserJson.user.canIngest).toBe(false);
    expect(patchUserJson.user.memo).toBe("열람 전용 테스터");

    deleteUserAndData(memberUser.id);
    deleteUserAndData(adminOwner.id);
  });

  test("Multiple recordings with identical course name get distinct UUIDs, KST timestamps, and never collide or overwrite", async () => {
    const owner = ensureBootstrapOwner();
    const id1 = generateId("lec");
    const id2 = generateId("lec");
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/i);
    expect(id2).toMatch(/^[0-9a-f-]{36}$/i);

    const p1 = createPendingLecture({
      id: id1,
      ownerId: owner.id,
      title: "",
      course: "웹프",
      audioPath: "/tmp/nonexistent1.m4a",
      audioMime: "audio/mp4",
      audioSize: 2048,
      modelRequested: "gemini-flash-latest",
      sourceClient: "web-mic",
    });
    const p2 = createPendingLecture({
      id: id2,
      ownerId: owner.id,
      title: "",
      course: "웹프",
      audioPath: "/tmp/nonexistent2.m4a",
      audioMime: "audio/mp4",
      audioSize: 4096,
      modelRequested: "gemini-flash-latest",
      sourceClient: "web-mic",
    });

    // Both have full YYYY-MM-DD HH:MM:SS KST timestamp in date_label
    expect(p1.date_label).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(p2.date_label).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const d1 = completeLectureRecord(id1, {
      title: "웹프 강의 노트",
      courseName: "웹프",
      markdown: "# 📚 웹프\n\n첫 번째 녹음 노트",
      excerpt: "첫 번째 녹음 노트",
      modelUsed: "gemini-3.8-flash",
      durationSec: 185,
    });
    const d2 = completeLectureRecord(id2, {
      title: "웹프 강의 노트",
      courseName: "웹프",
      markdown: "# 📚 웹프\n\n두 번째 녹음 노트",
      excerpt: "두 번째 녹음 노트",
      modelUsed: "gemini-3.8-flash",
      durationSec: 240,
    });

    expect(d1.status).toBe("done");
    expect(d2.status).toBe("done");
    expect(d1.markdown).toContain("첫 번째 녹음 노트");
    expect(d2.markdown).toContain("두 번째 녹음 노트");
    if (d1.md_source_path && d2.md_source_path) {
      expect(d1.md_source_path).not.toBe(d2.md_source_path);
    }

    deleteLectureById(id1);
    deleteLectureById(id2);
  });

  test("POST /api/cd/deploy rejects unauthorized requests", async () => {
    const res = await handleRequest(
      new Request("http://localhost/api/cd/deploy", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });

  test("UI enforces text overflow truncation, word-break wrapping, and responsive grid rules across App, Share, and Admin views", async () => {
    const appRes = await handleRequest(new Request("http://localhost/"));
    expect(appRes.status).toBe(200);
    const appHtml = await appRes.text();
    expect(appHtml).toContain("grid-template-columns: 400px minmax(0, 1fr)");
    expect(appHtml).toContain("overflow-wrap: anywhere");
    expect(appHtml).toContain("text-overflow: ellipsis");
    expect(appHtml).toContain("@media (max-width: 1280px)");
    expect(appHtml).toContain("@media (max-width: 1024px)");
    expect(appHtml).toContain("@media (max-width: 640px)");

    const adminRes = await handleRequest(new Request("http://localhost/admin"));
    expect(adminRes.status).toBe(200);
    const adminHtml = await adminRes.text();
    // The Linear-style console: truncating rows, min-width:0 flex/grid children, and
    // breakpoints for the narrow-desktop, drawer (900px) and phone layouts.
    expect(adminHtml).toContain("text-overflow: ellipsis");
    expect(adminHtml).toContain("minmax(0, 1fr)");
    expect(adminHtml).toContain("@media (max-width: 1180px)");
    expect(adminHtml).toContain("@media (max-width: 900px)");
    expect(adminHtml).toContain("@media (max-width: 600px)");
  });
});

// MARK: - Security regression tests

let uniqSeq = 0;
function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${++uniqSeq}`;
}

function makeUser(
  overrides: Partial<Parameters<typeof createUser>[0]> = {}
) {
  return createUser({
    email: `${uniq("sec")}@test.local`,
    displayName: "보안테스트",
    password: "correct_password_1",
    role: "member",
    ...overrides,
  });
}

function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return handleRequest(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

function login(email: string, password: string, ip: string): Promise<Response> {
  return postJson(
    "/api/auth/login",
    { email, password },
    // A client-chosen leftmost entry must not change which bucket is charged.
    { "X-Forwarded-For": `10.${++uniqSeq % 250}.0.1, ${ip}` }
  );
}

// Written by hand so a part carries exactly the Content-Type a hostile client would send
// (Bun's FormData serializer substitutes one guessed from the filename).
function audioMultipart(
  fileName: string,
  partType: string,
  extra: Record<string, string> = {}
): { headers: Record<string, string>; body: string } {
  const boundary = `lectern-test-${++uniqSeq}`;
  let body = "";
  for (const [name, value] of Object.entries({ course: "보안테스트", ...extra })) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body +=
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${fileName}"\r\n` +
    `Content-Type: ${partType}\r\n\r\n<script>alert(1)</script>\r\n--${boundary}--\r\n`;
  return {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  };
}

function audioForm(
  fileName: string,
  type: string,
  extra: Record<string, string> = {}
): FormData {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array([1, 2, 3, 4, 5, 6])], fileName, { type }));
  form.append("course", "보안테스트");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

function uploadsCount(): number {
  return readdirSync(join(DATA_DIR, "uploads")).length;
}

function writeUploadFile(ext: string, content: string | Uint8Array): string {
  const filePath = join(DATA_DIR, "uploads", `${generateId("aud")}${ext}`);
  writeFileSync(filePath, content);
  return filePath;
}

describe("security regressions", () => {
  test("#1 a verification code is invalidated after 5 wrong guesses", async () => {
    const email = `${uniq("brute")}@test.local`;
    const code = createEmailVerificationCode(email, "signup", 10);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < MAX_VERIFICATION_CODE_ATTEMPTS - 1; i++) {
      expect(verifyEmailVerificationCode(email, wrong, "signup")).toBe(false);
    }
    // Still valid below the limit (checked without consuming it)
    expect(verifyEmailVerificationCode(email, code, "signup", false)).toBe(true);
    expect(verifyEmailVerificationCode(email, wrong, "signup")).toBe(false);
    // The 5th wrong guess burned the code: the right one no longer works
    expect(verifyEmailVerificationCode(email, code, "signup")).toBe(false);

    // Same through the HTTP password reset flow
    const user = makeUser();
    const resetCode = createEmailVerificationCode(user.email, "reset", 10);
    const resetWrong = resetCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_VERIFICATION_CODE_ATTEMPTS; i++) {
      const res = await postJson("/api/auth/reset-password", {
        email: user.email,
        verificationCode: resetWrong,
        newPassword: "attacker_pw_1",
      });
      expect(res.status).toBe(400);
    }
    const lateRes = await postJson("/api/auth/reset-password", {
      email: user.email,
      verificationCode: resetCode,
      newPassword: "attacker_pw_1",
    });
    expect(lateRes.status).toBe(400);
    expect((await login(user.email, "attacker_pw_1", "203.0.113.1")).status).toBe(401);
    expect((await login(user.email, "correct_password_1", "203.0.113.1")).status).toBe(200);

    deleteUserAndData(user.id);
  });

  test("#1 login is rate limited per email and per client IP, keyed on the proxy-appended X-Forwarded-For entry", async () => {
    expect(
      getClientIp(
        new Request("http://localhost/", {
          headers: { "X-Forwarded-For": "6.6.6.6, 198.51.100.7" },
        })
      )
    ).toBe("198.51.100.7");
    expect(getClientIp(new Request("http://localhost/"))).toBeNull();

    // Per email: 10 failures lock the account out, even with the right password from a new IP
    const victim = makeUser();
    for (let i = 0; i < 10; i++) {
      expect((await login(victim.email, `wrong_${i}`, "203.0.113.10")).status).toBe(401);
    }
    const lockedRes = await login(victim.email, "correct_password_1", "203.0.113.11");
    expect(lockedRes.status).toBe(429);
    expect(Number(lockedRes.headers.get("Retry-After"))).toBeGreaterThan(0);

    // Per IP: 30 failures spread over different emails block that IP, even for a valid login
    const other = makeUser();
    for (let i = 0; i < 30; i++) {
      const res = await login(`${uniq("nobody")}@test.local`, "x", "203.0.113.20");
      expect(res.status).toBe(401);
    }
    expect((await login(other.email, "correct_password_1", "203.0.113.20")).status).toBe(429);
    expect((await login(other.email, "correct_password_1", "203.0.113.21")).status).toBe(200);

    deleteUserAndData(victim.id);
    deleteUserAndData(other.id);
  }, 120_000); // ~45 logins, each a deliberate scrypt

  test("#1 send-code and reset-password are rate limited", async () => {
    const email = `${uniq("flood")}@test.local`;
    const headers = { "X-Forwarded-For": "203.0.113.30" };
    for (let i = 0; i < 5; i++) {
      const res = await postJson("/api/auth/send-code", { email, purpose: "reset" }, headers);
      expect(res.status).toBe(200);
    }
    const blocked = await postJson("/api/auth/send-code", { email, purpose: "reset" }, headers);
    expect(blocked.status).toBe(429);

    const resetEmail = `${uniq("resetflood")}@test.local`;
    for (let i = 0; i < 10; i++) {
      const res = await postJson(
        "/api/auth/reset-password",
        { email: resetEmail, verificationCode: "123456", newPassword: "whatever_1" },
        { "X-Forwarded-For": "203.0.113.31" }
      );
      expect(res.status).toBe(400);
    }
    const resetBlocked = await postJson(
      "/api/auth/reset-password",
      { email: resetEmail, verificationCode: "123456", newPassword: "whatever_1" },
      { "X-Forwarded-For": "203.0.113.32" }
    );
    expect(resetBlocked.status).toBe(429);

    // Without a proxy-reported address there is no shared per-IP bucket for one client
    // to exhaust for everyone (more than the per-IP send-code limit of 20, all accepted)
    for (let i = 0; i < 25; i++) {
      const res = await postJson("/api/auth/send-code", {
        email: `${uniq("noxff")}@test.local`,
        purpose: "reset",
      });
      expect(res.status).toBe(200);
    }
  });

  test("#1 reset endpoints do not reveal whether an email is registered", async () => {
    const user = makeUser();
    const unknown = `${uniq("ghost")}@test.local`;

    const knownRes = await postJson("/api/auth/send-code", { email: user.email, purpose: "reset" });
    const unknownRes = await postJson("/api/auth/send-code", { email: unknown, purpose: "reset" });
    expect(knownRes.status).toBe(200);
    expect(unknownRes.status).toBe(200);
    expect(await unknownRes.json()).toEqual(await knownRes.json());
    const hasCode = (email: string) =>
      Boolean(db.query(`SELECT 1 FROM email_verifications WHERE email = ? AND purpose = 'reset'`).get(email));
    expect(hasCode(user.email)).toBe(true);
    expect(hasCode(unknown)).toBe(false);

    const wrongCodeRes = await postJson("/api/auth/reset-password", {
      email: user.email,
      verificationCode: "999999x",
      newPassword: "whatever_1",
    });
    const unknownResetRes = await postJson("/api/auth/reset-password", {
      email: unknown,
      verificationCode: "999999x",
      newPassword: "whatever_1",
    });
    expect(unknownResetRes.status).toBe(wrongCodeRes.status);
    expect(await unknownResetRes.json()).toEqual(await wrongCodeRes.json());

    deleteUserAndData(user.id);
  });

  test("#2 only an owner can grant or remove the owner role; role and status are validated", async () => {
    const owner = makeUser({ role: "owner", isAdmin: true });
    const admin = makeUser({ role: "admin" });
    const member = makeUser();
    const patch = (actor: { api_token: string }, targetId: string, body: unknown) =>
      handleRequest(
        new Request(`http://localhost/api/admin/users/${targetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Lectern-Token": actor.api_token },
          body: JSON.stringify(body),
        })
      );
    const create = (actor: { api_token: string }, body: unknown) =>
      postJson("/api/admin/users", body, { "X-Lectern-Token": actor.api_token });

    // The reproduced escalation: admin makes itself owner, then takes over the real owner
    expect((await patch(admin, admin.id, { role: "owner" })).status).toBe(403);
    expect(getUserById(admin.id)!.role).toBe("admin");
    expect((await patch(admin, member.id, { role: "owner" })).status).toBe(403);
    expect(getUserById(member.id)!.role).toBe("member");
    expect((await patch(admin, owner.id, { role: "member" })).status).toBe(403);
    expect((await patch(admin, owner.id, { newPassword: "hijacked_pw_1" })).status).toBe(403);
    expect(getUserById(owner.id)!.role).toBe("owner");
    expect((await login(owner.email, "hijacked_pw_1", "203.0.113.40")).status).toBe(401);

    // Invalid values are rejected instead of being written
    expect((await patch(owner, member.id, { role: "superuser" })).status).toBe(400);
    expect((await patch(owner, member.id, { status: "banned" })).status).toBe(400);
    expect(getUserById(member.id)!.role).toBe("member");
    expect(getUserById(member.id)!.status).toBe("active");
    const newEmail = `${uniq("created")}@test.local`;
    expect((await create(admin, { email: newEmail, password: "pw_123456", role: "owner" })).status).toBe(403);
    expect((await create(owner, { email: newEmail, password: "pw_123456", role: "root" })).status).toBe(400);
    expect((await create(owner, { email: newEmail, password: "pw_123456", status: "deleted" })).status).toBe(400);
    expect(() => makeUser({ role: "god" as any })).toThrow();
    expect(() => makeUser({ status: "banned" as any })).toThrow();
    expect(() => updateUserByAdmin(member.id, { role: "root" as any })).toThrow();
    expect(() => updateUserByAdmin(member.id, { status: "banned" as any })).toThrow();

    // An owner may still grant the role
    expect((await patch(owner, member.id, { role: "owner" })).status).toBe(200);
    expect(getUserById(member.id)!.role).toBe("owner");

    deleteUserAndData(owner.id);
    deleteUserAndData(admin.id);
    deleteUserAndData(member.id);
  });

  test("#3 stored audio is served with an extension-derived type, never the uploader's (no stored XSS)", async () => {
    const owner = ensureBootstrapOwner();
    const htmlId = generateId("test_xss");
    const html = createPendingLecture({
      id: htmlId,
      ownerId: owner.id,
      title: "xss",
      course: "보안테스트",
      audioPath: writeUploadFile(".html", "<script>alert(document.cookie)</script>"),
      audioMime: "text/html",
      audioSize: 40,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });
    setLectureVisibility(htmlId, true);
    const audioUrl = `http://localhost/api/lectures/${htmlId}/audio?share=${html.share_token}`;
    for (const headers of [{}, { Range: "bytes=0-3" }, { Range: "items=0-3" }] as Record<string, string>[]) {
      const res = await handleRequest(new Request(audioUrl, { headers }));
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).toBe("attachment");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }

    const m4aId = generateId("test_xss");
    const m4a = createPendingLecture({
      id: m4aId,
      ownerId: owner.id,
      title: "spoofed mime",
      course: "보안테스트",
      audioPath: writeUploadFile(".m4a", new Uint8Array([0, 1, 2, 3])),
      audioMime: "text/html",
      audioSize: 4,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });
    setLectureVisibility(m4aId, true);
    const m4aRes = await handleRequest(
      new Request(`http://localhost/api/lectures/${m4aId}/audio?share=${m4a.share_token}`)
    );
    expect(m4aRes.headers.get("content-type")).toBe("audio/mp4");

    deleteLectureById(htmlId);
    deleteLectureById(m4aId);
  });

  test("#3 non-audio uploads are rejected before anything is stored", async () => {
    const user = makeUser();
    const before = uploadsCount();
    const auth = { "X-Lectern-Token": user.api_token };
    const attempts: Array<[string, { headers: Record<string, string>; body: string }]> = [
      // Raw bodies declared as a renderable document (the reproduced share-link XSS)
      [
        "/api/lectures/ingest",
        { headers: { "Content-Type": "text/html" }, body: "<script>alert(1)</script>" },
      ],
      [
        "/api/ingest/shortcut?wait=false",
        { headers: { "Content-Type": "image/svg+xml" }, body: "<svg onload=alert(1)>" },
      ],
      // Audio part type, non-audio extension
      ["/api/ingest/shortcut?wait=false", audioMultipart("evil.html", "audio/mp4")],
      ["/api/lectures/ingest", audioMultipart("evil.svg", "application/octet-stream")],
    ];
    for (const [path, { headers, body }] of attempts) {
      const res = await handleRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { ...auth, ...headers },
          body,
        })
      );
      expect(res.status).toBe(400);
    }
    expect(uploadsCount()).toBe(before);
    expect(listLecturesForUser(user.id).length).toBe(0);
    deleteUserAndData(user.id);
  });

  test("#3 every response carries nosniff; HTML pages carry CSP, X-Frame-Options and Referrer-Policy", async () => {
    for (const path of ["/api/health", "/api/lectures", "/api/nope", "/", "/admin"]) {
      const res = await handleRequest(new Request(`http://localhost${path}`));
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    for (const path of ["/", "/admin"]) {
      const res = await handleRequest(new Request(`http://localhost${path}`));
      const csp = res.headers.get("content-security-policy") || "";
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
    }
  });

  test("#4 suspended and pending accounts cannot ingest through the multipart token field", async () => {
    const before = uploadsCount();
    for (const status of ["suspended", "pending"]) {
      const user = makeUser();
      // Flip status directly so the old api_token stays valid: this isolates the status check
      db.query(`UPDATE users SET status = ? WHERE id = ?`).run(status, user.id);
      for (const path of ["/api/lectures/ingest", "/api/ingest/shortcut?wait=false"]) {
        const res = await handleRequest(
          new Request(`http://localhost${path}`, {
            method: "POST",
            body: audioForm("lecture.m4a", "audio/mp4", { token: user.api_token }),
          })
        );
        expect(res.status).toBe(401);
      }
      expect(listLecturesForUser(user.id).length).toBe(0);
      deleteUserAndData(user.id);
    }
    expect(uploadsCount()).toBe(before);
  });

  test("#4 suspending a user rotates their API token", async () => {
    const user = makeUser();
    const oldToken = user.api_token;
    const suspended = updateUserByAdmin(user.id, { status: "suspended" })!;
    expect(suspended.api_token).not.toBe(oldToken);
    const reactivated = updateUserByAdmin(user.id, { status: "active" })!;
    expect(reactivated.api_token).toBe(suspended.api_token);
    const meRes = await handleRequest(
      new Request("http://localhost/api/auth/me", { headers: { "X-Lectern-Token": oldToken } })
    );
    expect(meRes.status).toBe(401);
    deleteUserAndData(user.id);
  });

  test("#5 retry and boot auto-resume honour can_use_server_key", async () => {
    const restricted = makeUser({ canUseServerKey: false });
    const audioPath = writeUploadFile(".m4a", new Uint8Array([1, 2, 3, 4]));
    const lectureInput = {
      ownerId: restricted.id,
      title: "제한 계정 강의",
      course: "보안테스트",
      audioPath,
      audioMime: "audio/mp4",
      audioSize: 4,
      modelRequested: "gemini-flash-latest",
      sourceClient: "web",
    };

    const failedId = generateId("lec");
    createPendingLecture({ id: failedId, ...lectureInput });
    failLectureRecord(failedId, "분석 실패");
    const owner = ensureBootstrapOwner();
    for (const actor of [restricted, owner]) {
      const res = await handleRequest(
        new Request(`http://localhost/api/lectures/${failedId}/retry`, {
          method: "POST",
          headers: { "X-Lectern-Token": actor.api_token },
        })
      );
      expect(res.status).toBe(403);
      expect(getLectureById(failedId)!.status).toBe("error");
    }

    const interruptedId = generateId("lec");
    createPendingLecture({ id: interruptedId, ...lectureInput });
    const result = resumeInterruptedLectures([getLectureById(interruptedId)!]);
    expect(result.resumed).toEqual([]);
    expect(result.failed).toEqual([interruptedId]);
    expect(getLectureById(interruptedId)!.status).toBe("error");

    deleteUserAndData(restricted.id);
  });

  test("#6 the local archive sync never reassigns another admin's lectures and is throttled on list", async () => {
    const adminA = makeUser({ role: "admin" });
    const adminB = makeUser({ role: "admin" });
    const id = generateId("lec");
    createPendingLecture({
      id,
      ownerId: adminA.id,
      title: "",
      course: "동기화테스트",
      audioPath: "/tmp/nonexistent_sync.m4a",
      audioMime: "audio/mp4",
      audioSize: 0,
      modelRequested: "gemini-flash-latest",
      sourceClient: "web",
    });
    const done = completeLectureRecord(id, {
      title: "동기화테스트 노트",
      courseName: "동기화테스트",
      markdown: "# 📚 동기화테스트\n\nA 관리자의 노트",
      excerpt: "A 관리자의 노트",
      modelUsed: "gemini-3.8-flash",
      durationSec: 120,
    });
    expect(done.md_source_path?.startsWith(LECTURES_ROOT)).toBe(true);
    // Edit the archived file so the sync takes its UPDATE path for this row
    writeFileSync(done.md_source_path!, "# 📚 동기화테스트\n\nA 관리자의 노트 (수정됨)\n");

    await syncLocalLecturesDir(adminB.id);
    expect(getLectureById(id)!.markdown).toContain("(수정됨)");
    expect(getLectureById(id)!.owner_id).toBe(adminA.id);

    // Bootstrapping with an explicit owner email (as in production) adopts only orphaned
    // rows, not an archive-synced lecture someone else already owns.
    const syncedId = generateId("lec");
    createPendingLecture({
      id: syncedId,
      ownerId: adminA.id,
      title: "",
      course: "동기화테스트",
      audioPath: "/tmp/nonexistent_sync.m4a",
      audioMime: "audio/mp4",
      audioSize: 0,
      modelRequested: "gemini-flash-latest",
      sourceClient: "local-sync",
    });
    process.env.LECTERN_OWNER_EMAIL = ensureBootstrapOwner().email;
    try {
      ensureBootstrapOwner();
    } finally {
      delete process.env.LECTERN_OWNER_EMAIL;
    }
    expect(getLectureById(id)!.owner_id).toBe(adminA.id);
    expect(getLectureById(syncedId)!.owner_id).toBe(adminA.id);
    expect(await syncLocalLecturesIfStale(Date.now() + 10 * 60_000)).toBe(true);
    const listRes = await handleRequest(
      new Request("http://localhost/api/lectures", { headers: { "X-Lectern-Token": adminB.api_token } })
    );
    const listJson: any = await listRes.json();
    expect(listJson.lectures.some((l: any) => l.id === id)).toBe(false);
    expect(getLectureById(id)!.owner_id).toBe(adminA.id);

    // A file dropped into the archive is not picked up by every list request...
    const courseDir = join(LECTURES_ROOT, "스로틀테스트");
    mkdirSync(courseDir, { recursive: true });
    const mdPath = join(courseDir, `${uniq("20261019")}_스로틀테스트_요약.md`);
    writeFileSync(mdPath, "# 📚 스로틀테스트\n\n외부에서 추가된 노트");
    const findRow = () =>
      db.query(`SELECT id, owner_id FROM lectures WHERE md_source_path = ?`).get(mdPath) as
        | { id: string; owner_id: string }
        | null;
    expect(await syncLocalLecturesIfStale()).toBe(false);
    await handleRequest(
      new Request("http://localhost/api/lectures", { headers: { "X-Lectern-Token": adminB.api_token } })
    );
    expect(findRow()).toBeNull();
    // ...only once the interval has passed, and it goes to the workspace owner
    expect(await syncLocalLecturesIfStale(Date.now() + 20 * 60_000)).toBe(true);
    expect(findRow()?.owner_id).toBe(ensureBootstrapOwner().id);

    deleteLectureById(findRow()!.id);
    deleteUserAndData(adminA.id);
    deleteUserAndData(adminB.id);
  });

  test("#7 PUT and batch cleanup cannot make a lecture public without can_share", async () => {
    for (const overrides of [{ canShare: false }, { role: "viewer" as const, canShare: true }]) {
      const user = makeUser(overrides);
      const id = generateId("test_share");
      createPendingLecture({
        id,
        ownerId: user.id,
        title: "공유 제한",
        course: "보안테스트",
        audioPath: "/tmp/nonexistent_share.m4a",
        audioMime: "audio/mp4",
        audioSize: 0,
        modelRequested: "gemini-flash-latest",
        sourceClient: "bun-test",
      });
      const auth = { "X-Lectern-Token": user.api_token, "Content-Type": "application/json" };
      const put = (body: unknown) =>
        handleRequest(
          new Request(`http://localhost/api/lectures/${id}`, {
            method: "PUT",
            headers: auth,
            body: JSON.stringify(body),
          })
        );

      expect((await put({ is_public: true })).status).toBe(403);
      expect(getLectureById(id)!.is_public).toBe(0);
      const cleanupRes = await postJson(
        "/api/lectures/cleanup",
        { mode: "batch_visibility", ids: [id], isPublic: true },
        auth
      );
      expect(cleanupRes.status).toBe(403);
      expect(getLectureById(id)!.is_public).toBe(0);
      // Editing without touching visibility, or keeping it private, still works
      expect((await put({ title: "새 제목" })).status).toBe(200);
      expect((await put({ is_public: false })).status).toBe(200);

      deleteUserAndData(user.id);
    }
  });

  test("#8 ingest authenticates before reading or storing the upload", async () => {
    const before = uploadsCount();
    for (const path of ["/api/lectures/ingest", "/api/ingest/shortcut"]) {
      for (const headers of [{}, { "X-Lectern-Token": "lct_not_a_real_token" }] as Record<string, string>[]) {
        const req = new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "Content-Type": "audio/mp4", ...headers },
          body: new Uint8Array(4096),
        });
        expect((await handleRequest(req)).status).toBe(401);
        expect(req.bodyUsed).toBe(false);
      }
      const badFormToken = await handleRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body: audioForm("lecture.m4a", "audio/mp4", { token: "lct_not_a_real_token" }),
        })
      );
      expect(badFormToken.status).toBe(401);
    }

    // An authenticated account without ingest rights is refused before the body is read
    const viewer = makeUser({ role: "viewer" });
    const viewerReq = new Request("http://localhost/api/lectures/ingest", {
      method: "POST",
      headers: { "Content-Type": "audio/mp4", "X-Lectern-Token": viewer.api_token },
      body: new Uint8Array(4096),
    });
    expect((await handleRequest(viewerReq)).status).toBe(403);
    expect(viewerReq.bodyUsed).toBe(false);

    expect(uploadsCount()).toBe(before);
    deleteUserAndData(viewer.id);
  });

  test("#9 a failed wait=true shortcut ingest marks the lecture failed instead of leaving it processing", async () => {
    // The sandbox has no Gemini key, so distillation fails deterministically and offline
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    const user = makeUser();
    // Declared as HTML: an allowed extension is accepted, but the type is not trusted
    const upload = audioMultipart("lecture.m4a", "text/html");
    const res = await handleRequest(
      new Request("http://localhost/api/ingest/shortcut", {
        method: "POST",
        headers: { "X-Lectern-Token": user.api_token, ...upload.headers },
        body: upload.body,
      })
    );
    expect(res.status).toBe(502);
    const data: any = await res.json();
    expect(data.status).toBe("error");
    const rec = getLectureById(data.id)!;
    expect(rec.status).toBe("error");
    expect(rec.error_message).toContain("GEMINI_API_KEY");
    expect(listInterruptedLectures().some((l) => l.id === data.id)).toBe(false);
    // Accepted uploads store the extension-derived type, not the client's
    expect(rec.audio_path?.endsWith(".m4a")).toBe(true);
    expect(rec.audio_mime).toBe("audio/mp4");

    deleteUserAndData(user.id);
  });

  test("#10 the session cookie is Secure, HttpOnly and SameSite", async () => {
    const user = makeUser();
    const loginRes = await login(user.email, "correct_password_1", "203.0.113.50");
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") || "";
    expect(cookie).toContain("lectern_session=ses_");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const logoutRes = await handleRequest(
      new Request("http://localhost/api/auth/logout", { method: "POST" })
    );
    const clearCookie = logoutRes.headers.get("set-cookie") || "";
    expect(clearCookie).toContain("Secure");
    expect(clearCookie).toContain("Max-Age=0");

    deleteUserAndData(user.id);
  });

  test("the web UI's cookie-only auth works for fetch, SSE, ingest, audio, downloads and logout", async () => {
    const user = makeUser();
    const loginRes = await login(user.email, "correct_password_1", "203.0.113.60");
    const session = /lectern_session=([^;]+)/.exec(loginRes.headers.get("set-cookie") || "")![1];
    const cookie = { Cookie: `lectern_session=${session}` };
    const get = (path: string) =>
      handleRequest(new Request(`http://localhost${path}`, { headers: cookie }));

    const me: any = await (await get("/api/auth/me")).json();
    expect(me.user.id).toBe(user.id);

    const sse = await get("/api/events");
    expect(sse.status).toBe(200);
    try {
      await sse.body?.cancel();
    } catch {}

    const id = generateId("test_cookie");
    const idemKey = uniq("cookie_idem");
    createPendingLecture({
      id,
      ownerId: user.id,
      title: "쿠키 인증",
      course: "보안테스트",
      audioPath: writeUploadFile(".m4a", new Uint8Array([1, 2, 3, 4])),
      audioMime: "audio/mp4",
      audioSize: 4,
      audioSha256: idemKey,
      modelRequested: "gemini-flash-latest",
      sourceClient: "bun-test",
    });
    // Multipart ingest with only the cookie (dedupes onto the lecture above, so nothing runs)
    const ingestRes = await handleRequest(
      new Request("http://localhost/api/lectures/ingest", {
        method: "POST",
        headers: { ...cookie, "X-Idempotency-Key": idemKey },
        body: audioForm("lecture.m4a", "audio/mp4"),
      })
    );
    expect(ingestRes.status).toBe(200);
    expect(((await ingestRes.json()) as any).lecture.id).toBe(id);
    expect((await get(`/api/lectures/${id}/audio`)).status).toBe(200);
    expect((await get(`/api/lectures/${id}/markdown`)).status).toBe(200);

    const logoutRes = await handleRequest(
      new Request("http://localhost/api/auth/logout", { method: "POST", headers: cookie })
    );
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await get("/api/auth/me")).status).toBe(401);

    deleteUserAndData(user.id);
  });
});
