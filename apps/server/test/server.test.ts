import { describe, expect, test } from "bun:test";
import { handleRequest } from "../src/index.ts";
import {
  completeLectureRecord,
  createPendingLecture,
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

    // Share page endpoint (/s/:token) works with explicit share_token
    const shareRes = await handleRequest(
      new Request(`http://localhost/s/${done.share_token}`)
    );
    expect(shareRes.status).toBe(200);
    const shareHtml = await shareRes.text();
    expect(shareHtml).toContain("AES-GCM 인증 암호화");
    expect(shareHtml).toContain("--surface-canvas: #0B0D11");
    expect(shareHtml).toContain("--action-primary: #3182F6");
    expect(shareHtml).toContain("Pretendard Variable");

    // Main App UI verifies Elysium Design System v1.0 Light & Dark tokens + Auth Gate
    const appRes = await handleRequest(new Request("http://localhost/"));
    expect(appRes.status).toBe(200);
    const appHtml = await appRes.text();
    expect(appHtml).toContain("--surface-canvas: #F9FAFB");
    expect(appHtml).toContain("--surface-canvas: #0B0D11");
    expect(appHtml).toContain("word-break: keep-all");
    expect(appHtml).toContain("font-variant-numeric: tabular-nums");
    expect(appHtml).toContain("id=\"auth-gate\"");

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

  test("POST /api/cd/deploy rejects unauthorized requests", async () => {
    const res = await handleRequest(
      new Request("http://localhost/api/cd/deploy", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });
});
