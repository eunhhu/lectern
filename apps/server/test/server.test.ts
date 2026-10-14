import { describe, expect, test } from "bun:test";
import { handleRequest } from "../src/index.ts";
import {
  completeLectureRecord,
  createEmailVerificationCode,
  createPendingLecture,
  createUser,
  deleteLectureById,
  deleteUserAndData,
  ensureBootstrapOwner,
  generateId,
} from "../src/db.ts";

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
    expect(appHtml).toContain("sendEmailVerificationCode");
    expect(appHtml).toContain("lectern_audio_vault_v1");
    expect(appHtml).toContain("retryLectureDistillation");
    expect(appHtml).not.toContain("gemini-flash-latest");
    expect(appHtml).not.toContain("BYOK");

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
    expect(await adminHtmlRes.text()).toContain("CRM & RBAC Console");

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
});
