import { describe, expect, test } from "bun:test";
import { handleRequest } from "../src/index.ts";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  deleteLectureById,
  ensureBootstrapOwner,
  generateId,
} from "../src/db.ts";

describe("@lectern/server HTTP, Auth Isolation & SQLite E2E", () => {
  test("GET /api/health returns service status and authRequired: true without leaking private lectureCount", async () => {
    const res = await handleRequest(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.status).toBe("ok");
    expect(data.authRequired).toBe(true);
    expect(data.lectureCount).toBeUndefined();
    expect(data.defaultModel).toBe("gemini-flash-latest");
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
    expect(shareHtml).toContain("--elysium-surface-canvas: #F8F6FF");
    expect(shareHtml).toContain("--elysium-surface-canvas: #111113");
    expect(shareHtml).toContain("--elysium-action-primary: #5650FF");
    expect(shareHtml).toContain("Pretendard Variable");

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

    // Main App UI verifies Elysium Design System v1.0 Light & Dark tokens + Auth Gate
    const appRes = await handleRequest(new Request("http://localhost/"));
    expect(appRes.status).toBe(200);
    const appHtml = await appRes.text();
    expect(appHtml).toContain("--elysium-surface-canvas: #F8F6FF");
    expect(appHtml).toContain("--elysium-surface-canvas: #111113");
    expect(appHtml).toContain("--elysium-action-primary: #5650FF");
    expect(appHtml).toContain("--elysium-space-48: 48px");
    expect(appHtml).toContain("word-break: keep-all");
    expect(appHtml).toContain("font-variant-numeric: tabular-nums");
    expect(appHtml).toContain("id=\"auth-gate\"");
    expect(appHtml).toContain("lectern_audio_vault_v1");
    expect(appHtml).toContain("retryLectureDistillation");

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
    expect(deleteLectureById(id)).toBe(true);
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
  });

  test("POST /api/cd/deploy rejects unauthorized requests", async () => {
    const res = await handleRequest(
      new Request("http://localhost/api/cd/deploy", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });
});
