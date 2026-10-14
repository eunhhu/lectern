import { existsSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  distillLectureAudio,
  renderMarkdownToHtml,
  DEFAULT_GEMINI_MODEL,
} from "../../../packages/core/src/index.ts";
import {
  DATA_DIR,
  type LectureRecord,
  type UserRecord,
  cleanupLecturesForUser,
  completeLectureRecord,
  createPendingLecture,
  createSession,
  createUser,
  deleteLectureAudioOnly,
  deleteLectureById,
  deleteSession,
  ensureBootstrapOwner,
  failLectureRecord,
  generateId,
  getLectureByAudioSha256,
  getLectureById,
  getLectureByShareToken,
  getUserByEmail,
  getUserBySessionOrApiToken,
  listInterruptedLectures,
  listLecturesForUser,
  resetLectureForRetry,
  rotateUserApiToken,
  setLectureVisibility,
  syncLocalLecturesDir,
  updateLectureMarkdown,
  updateLectureProgress,
  verifyPassword,
} from "./db.ts";
import { renderAppHtml, renderSharePageHtml } from "./ui.ts";

const PORT = Number(process.env.PORT || 18775);
const PUBLIC_BASE_URL =
  process.env.LECTERN_BASE_URL || "https://lectern.qucord.com";

function resolveGitSha(): string {
  try {
    const res = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: existsSync("/home/eunhhu/work/lectern")
        ? "/home/eunhhu/work/lectern"
        : process.cwd(),
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = new TextDecoder().decode(res.stdout).trim();
    return out || "unknown";
  } catch {
    return "unknown";
  }
}

const BOOT_GIT_SHA = resolveGitSha();

const bootstrapOwner = ensureBootstrapOwner();
await syncLocalLecturesDir(bootstrapOwner.id);
cleanupLecturesForUser(bootstrapOwner.id, { mode: "short_fragments" });

type SSEController = ReadableStreamDefaultController<Uint8Array>;
const sseClientsByOwner = new Map<string, Set<SSEController>>();
const sseEncoder = new TextEncoder();

export function toLectureSummaryDto(l: LectureRecord) {
  return {
    id: l.id,
    share_token: l.share_token,
    is_public: Boolean(l.is_public),
    title: l.title,
    course: l.course,
    date_label: l.date_label,
    status: l.status,
    stage: l.stage,
    stage_message: l.stage_message,
    progress: l.progress,
    excerpt: l.excerpt,
    duration_sec: l.duration_sec,
    audio_size: l.audio_size,
    model_used: l.model_used,
    has_audio: Boolean(l.audio_path && existsSync(l.audio_path)),
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

export function broadcastLectureEvent(
  ownerId: string,
  payload: {
    type: "created" | "progress" | "completed" | "error" | "updated" | "deleted";
    id?: string;
    ids?: string[];
    lecture?: ReturnType<typeof toLectureSummaryDto>;
    stage?: string;
    stage_message?: string;
    progress?: number;
    error_message?: string | null;
  }
): void {
  const clients = sseClientsByOwner.get(ownerId);
  if (!clients || clients.size === 0) return;

  const chunk = sseEncoder.encode(
    `event: lecture_update\ndata: ${JSON.stringify(payload)}\n\n`
  );
  for (const ctrl of Array.from(clients)) {
    try {
      ctrl.enqueue(chunk);
    } catch {
      clients.delete(ctrl);
    }
  }
}

function runBackgroundDistillation(
  id: string,
  ownerId: string,
  incoming: {
    audioPath: string;
    course: string;
    title: string;
    model: string;
    apiKey?: string;
  }
) {
  (async () => {
    const maxAttempts = 3;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          const retryUpdate = updateLectureProgress(
            id,
            "retrying",
            `일시적 네트워크/API 오류 자동 재시도 중 (${attempt}/${maxAttempts})...`,
            15
          );
          if (retryUpdate) {
            broadcastLectureEvent(ownerId, {
              type: "progress",
              id,
              stage: retryUpdate.stage,
              stage_message: retryUpdate.stage_message,
              progress: retryUpdate.progress,
              lecture: toLectureSummaryDto(retryUpdate),
            });
          }
          await new Promise((r) => setTimeout(r, 2500 * attempt));
        }

        const res = await distillLectureAudio({
          audioPath: incoming.audioPath,
          courseName: incoming.course,
          title: incoming.title,
          model: incoming.model,
          apiKey: incoming.apiKey,
          onProgress: (ev) => {
            const updated = updateLectureProgress(
              id,
              ev.stage,
              ev.message,
              ev.progress ?? 50
            );
            if (updated) {
              broadcastLectureEvent(ownerId, {
                type: "progress",
                id,
                stage: updated.stage,
                stage_message: updated.stage_message,
                progress: updated.progress,
                lecture: toLectureSummaryDto(updated),
              });
            }
          },
        });
        const done = completeLectureRecord(id, res);
        broadcastLectureEvent(ownerId, {
          type: "completed",
          id,
          lecture: toLectureSummaryDto(done),
        });
        return;
      } catch (err: any) {
        lastErr = err;
      }
    }

    const errMsg = lastErr?.message || String(lastErr);
    const failed = failLectureRecord(id, errMsg);
    broadcastLectureEvent(ownerId, {
      type: "error",
      id,
      error_message: errMsg,
      lecture: failed ? toLectureSummaryDto(failed) : undefined,
    });
  })();
}

// Auto-resume any lecture that was interrupted mid-processing (e.g., server restart)
for (const item of listInterruptedLectures()) {
  if (
    item.audio_path &&
    existsSync(item.audio_path) &&
    item.source_client !== "bun-test" &&
    !item.id.startsWith("test_") &&
    !item.id.startsWith("unauth_")
  ) {
    runBackgroundDistillation(item.id, item.owner_id, {
      audioPath: item.audio_path,
      course: item.course,
      title: item.title,
      model: item.model_requested || DEFAULT_GEMINI_MODEL,
    });
  }
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Lectern-Token, X-Idempotency-Key, X-Course, X-Title, X-Model, X-Gemini-Key, X-Lectern-Deploy-Token",
      ...extraHeaders,
    },
  });
}

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...v] = part.trim().split("=");
    if (k === "lectern_session") {
      return decodeURIComponent(v.join("=").trim());
    }
  }
  return null;
}

export function extractAuthToken(req: Request, url: URL): string | null {
  const authHeader = (req.headers.get("authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const tok = authHeader.slice(7).trim();
    if (tok) return tok;
  }
  const xTok = (req.headers.get("x-lectern-token") || "").trim();
  if (xTok) return xTok;
  const qTok = (url.searchParams.get("token") || "").trim();
  if (qTok) return qTok;
  return parseSessionCookie(req.headers.get("cookie"));
}

export function authenticateRequest(req: Request): UserRecord | null {
  const url = new URL(req.url);
  const token = extractAuthToken(req, url);
  if (!token) return null;
  return getUserBySessionOrApiToken(token);
}

function makeSessionCookieHeader(sessionToken: string, maxAgeSec = 30 * 86400): string {
  return `lectern_session=${encodeURIComponent(
    sessionToken
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

async function saveIncomingAudio(
  req: Request
): Promise<{
  audioPath: string;
  audioMime: string;
  audioSize: number;
  audioSha256: string;
  course: string;
  title: string;
  model: string;
  sourceClient: string;
  apiKey?: string;
  formToken?: string;
}> {
  const contentType = req.headers.get("content-type") || "";
  let course =
    decodeURIComponent(req.headers.get("x-course") || "").trim() ||
    "대학교 전공 강의";
  let title = decodeURIComponent(req.headers.get("x-title") || "").trim();
  let model =
    (req.headers.get("x-model") || "").trim() || DEFAULT_GEMINI_MODEL;
  let sourceClient = (req.headers.get("x-client") || "api").trim();
  const apiKey = (req.headers.get("x-gemini-key") || "").trim() || undefined;
  let idempotencyKey = (req.headers.get("x-idempotency-key") || "").trim();
  let formToken: string | undefined;

  const id = generateId("aud");

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const fileField = (form.get("audio") || form.get("file")) as File | null;
    if (!fileField || typeof fileField === "string") {
      throw new Error("multipart form에 'audio' 또는 'file' 필드가 없습니다.");
    }
    if (form.get("course")) course = String(form.get("course")).trim() || course;
    if (form.get("title")) title = String(form.get("title")).trim() || title;
    if (form.get("model")) model = String(form.get("model")).trim() || model;
    if (form.get("source")) {
      sourceClient = String(form.get("source")).trim() || sourceClient;
    }
    if (form.get("token")) {
      formToken = String(form.get("token")).trim() || undefined;
    }
    if (form.get("idempotency_key")) {
      idempotencyKey = String(form.get("idempotency_key")).trim() || idempotencyKey;
    }

    const origExt = extname(fileField.name || "").toLowerCase() || ".m4a";
    const audioPath = join(DATA_DIR, "uploads", `${id}${origExt}`);
    const arrBuf = await fileField.arrayBuffer();
    if (!arrBuf.byteLength) {
      throw new Error("빈 오디오 파일입니다.");
    }
    await Bun.write(audioPath, arrBuf);
    const sha256 =
      idempotencyKey ||
      createHash("sha256").update(Buffer.from(arrBuf)).digest("hex");

    return {
      audioPath,
      audioMime: fileField.type || "audio/mp4",
      audioSize: arrBuf.byteLength,
      audioSha256: sha256,
      course,
      title: title || `${course} · ${new Date().toISOString().slice(0, 10)}`,
      model,
      sourceClient,
      apiKey,
      formToken,
    };
  }

  // Raw binary body (e.g. direct iOS Shortcut / native stream)
  const ext = contentType.includes("webm")
    ? ".webm"
    : contentType.includes("wav")
    ? ".wav"
    : contentType.includes("mpeg") || contentType.includes("mp3")
    ? ".mp3"
    : ".m4a";
  const audioPath = join(DATA_DIR, "uploads", `${id}${ext}`);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) {
    throw new Error("빈 오디오 데이터입니다.");
  }
  await Bun.write(audioPath, buf);
  const sha256 =
    idempotencyKey ||
    createHash("sha256").update(Buffer.from(buf)).digest("hex");

  return {
    audioPath,
    audioMime: contentType || "audio/mp4",
    audioSize: buf.byteLength,
    audioSha256: sha256,
    course,
    title: title || `${course} · ${new Date().toISOString().slice(0, 10)}`,
    model,
    sourceClient,
    apiKey,
  };
}

function serveAudioWithRange(
  req: Request,
  filePath: string,
  mimeType: string
): Response {
  const st = statSync(filePath);
  const total = st.size;
  const range = req.headers.get("range");
  const bunFile = Bun.file(filePath);

  if (!range) {
    return new Response(bunFile, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (!m) {
    return new Response(bunFile, { status: 200 });
  }
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  return new Response(bunFile.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": mimeType,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

export async function handleRequest(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // 1. Web App Root
    if (req.method === "GET" && path === "/") {
      return new Response(renderAppHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // 2. PWA Manifest
    if (req.method === "GET" && path === "/manifest.json") {
      return jsonResponse({
        name: "Lectern — Academic Audio Distillation",
        short_name: "Lectern",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0c0e",
        theme_color: "#0b0c0e",
        icons: [],
      });
    }

    // 3. Public Share View: /s/:token (Requires lecture.is_public === 1 OR authenticated owner)
    if (req.method === "GET" && path.startsWith("/s/")) {
      const token = decodeURIComponent(path.slice(3));
      const lecture = getLectureByShareToken(token);
      if (!lecture) {
        return new Response("공유된 강의 노트를 찾을 수 없습니다.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const viewer = authenticateRequest(req);
      const isOwner = Boolean(viewer && viewer.id === lecture.owner_id);
      if (!lecture.is_public && !isOwner) {
        return new Response(
          "비공개로 설정된 강의 노트입니다. 소유자가 '공개'로 전환한 노트만 공유 링크로 열람할 수 있습니다.",
          {
            status: 403,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
      return new Response(renderSharePageHtml(lecture), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 3b. Real-Time Server-Sent Events Stream: GET /api/events
    if (req.method === "GET" && path === "/api/events") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }

      let ctrlRef: SSEController | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          ctrlRef = controller;
          let set = sseClientsByOwner.get(user.id);
          if (!set) {
            set = new Set();
            sseClientsByOwner.set(user.id, set);
          }
          set.add(controller);

          controller.enqueue(
            sseEncoder.encode(
              `event: connected\ndata: ${JSON.stringify({ ok: true, userId: user.id })}\n\n`
            )
          );

          heartbeatTimer = setInterval(() => {
            try {
              controller.enqueue(sseEncoder.encode(`: heartbeat ${Date.now()}\n\n`));
            } catch {
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              if (ctrlRef) sseClientsByOwner.get(user.id)?.delete(ctrlRef);
            }
          }, 15000);
        },
        cancel() {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (ctrlRef) {
            sseClientsByOwner.get(user.id)?.delete(ctrlRef);
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 4. Health check (no private lecture count exposed)
    if (req.method === "GET" && path === "/api/health") {
      return jsonResponse({
        status: "ok",
        service: "lectern",
        version: "1.0.0",
        authRequired: true,
        gitSha: BOOT_GIT_SHA,
        runtime: `Bun ${Bun.version}`,
        defaultModel: DEFAULT_GEMINI_MODEL,
      });
    }

    // 4b. Continuous Deployment Webhook: POST /api/cd/deploy
    if (req.method === "POST" && path === "/api/cd/deploy") {
      const configuredSecret = (process.env.LECTERN_DEPLOY_TOKEN || "").trim();
      const providedSecret = (
        req.headers.get("x-lectern-deploy-token") || ""
      ).trim();

      if (!configuredSecret || !safeTokenCompare(configuredSecret, providedSecret)) {
        return jsonResponse({ error: "Unauthorized CD request" }, 401);
      }

      const repoDir = "/home/eunhhu/work/lectern";
      const fetchProc = Bun.spawnSync(["git", "fetch", "origin", "main"], {
        cwd: repoDir,
      });
      const resetProc = Bun.spawnSync(["git", "reset", "--hard", "origin/main"], {
        cwd: repoDir,
      });
      const installProc = Bun.spawnSync(["bun", "install"], { cwd: repoDir });

      const newSha = resolveGitSha();
      const ok =
        fetchProc.exitCode === 0 &&
        resetProc.exitCode === 0 &&
        installProc.exitCode === 0;

      if (!ok) {
        return jsonResponse(
          {
            ok: false,
            error: "Git pull or bun install failed during CD",
            newSha,
          },
          500
        );
      }

      setTimeout(() => {
        process.exit(0);
      }, 350);

      return jsonResponse({
        ok: true,
        deployedSha: newSha,
        restarting: true,
      });
    }

    // 5. Auth Routes: /api/auth/{login,register,logout,me,rotate-token}
    if (req.method === "POST" && path === "/api/auth/login") {
      try {
        const body: any = await req.json();
        let rawId = String(body.email || body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        const ownerAliases = (process.env.LECTERN_OWNER_ALIASES || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (ownerAliases.includes(rawId) && process.env.LECTERN_OWNER_EMAIL) {
          rawId = process.env.LECTERN_OWNER_EMAIL.trim().toLowerCase();
        }
        const user = getUserByEmail(rawId);
        if (!user || !verifyPassword(password, user.password_hash)) {
          return jsonResponse(
            { error: "아이디(이메일) 또는 비밀번호가 올바르지 않습니다." },
            401
          );
        }

        const sessionToken = createSession(user.id);
        return jsonResponse(
          {
            ok: true,
            token: sessionToken,
            user: {
              id: user.id,
              email: user.email,
              displayName: user.display_name,
              apiToken: user.api_token,
              isAdmin: user.is_admin === 1,
            },
          },
          200,
          { "Set-Cookie": makeSessionCookieHeader(sessionToken) }
        );
      } catch (err: any) {
        return jsonResponse({ error: err?.message || "로그인 실패" }, 400);
      }
    }

    if (req.method === "POST" && path === "/api/auth/register") {
      try {
        const body: any = await req.json();
        const email = String(body.email || "").trim().toLowerCase();
        const displayName = String(body.displayName || body.name || "").trim();
        const password = String(body.password || "");

        if (!email || email.length < 3) {
          return jsonResponse({ error: "이메일(또는 아이디)을 입력해주세요." }, 400);
        }
        if (!password || password.length < 6) {
          return jsonResponse(
            { error: "비밀번호는 최소 6자 이상이어야 합니다." },
            400
          );
        }

        const user = createUser({
          email,
          displayName: displayName || email.split("@")[0],
          password,
        });
        const sessionToken = createSession(user.id);
        return jsonResponse(
          {
            ok: true,
            token: sessionToken,
            user: {
              id: user.id,
              email: user.email,
              displayName: user.display_name,
              apiToken: user.api_token,
              isAdmin: user.is_admin === 1,
            },
          },
          201,
          { "Set-Cookie": makeSessionCookieHeader(sessionToken) }
        );
      } catch (err: any) {
        return jsonResponse({ error: err?.message || "회원가입 실패" }, 400);
      }
    }

    if (req.method === "POST" && path === "/api/auth/logout") {
      const tok = extractAuthToken(req, url);
      if (tok && tok.startsWith("ses_")) {
        deleteSession(tok);
      }
      return jsonResponse(
        { ok: true },
        200,
        { "Set-Cookie": makeSessionCookieHeader("", 0) }
      );
    }

    if (req.method === "GET" && path === "/api/auth/me") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      return jsonResponse({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          apiToken: user.api_token,
          isAdmin: user.is_admin === 1,
        },
      });
    }

    if (req.method === "POST" && path === "/api/auth/rotate-token") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      const apiToken = rotateUserApiToken(user.id);
      return jsonResponse({ ok: true, apiToken });
    }

    // 6. iOS Shortcut Recipe Download
    if (req.method === "GET" && path === "/api/clients/ios-shortcut") {
      const user = authenticateRequest(req);
      return jsonResponse({
        name: "Lectern 강의 녹음 요약",
        endpoint: `${PUBLIC_BASE_URL}/api/ingest/shortcut`,
        method: "POST",
        headers: {
          "X-Lectern-Token": user ? user.api_token : "<내_계정_API_토큰>",
          "X-Course": "정보보호개론",
        },
        formField: "audio",
        openUrlOnComplete: `${PUBLIC_BASE_URL}/?lecture={{id}}`,
        instructions: [
          "1. iOS '단축어(Shortcuts)' 앱에서 새 단축어 생성",
          "2. '오디오 녹음' 또는 공유 시트에서 '오디오 파일' 입력 받기 추가",
          "3. 'URL 내용 가져오기' 액션 추가 → URL: https://lectern.qucord.com/api/ingest/shortcut, 메소드: POST, 헤더에 X-Lectern-Token 추가, 요청 본문: 폼(Form), 필드명 'audio'에 녹음 파일 연결",
          "4. '사전 값 가져오기'로 'url' 추출 후 'URL 열기' 액션 연결 → 내 계정에 노트가 저장되고 즉시 열립니다.",
        ],
      });
    }

    // 7. List Lectures (Requires Authentication; Strictly Scoped to User's Account)
    if (req.method === "GET" && path === "/api/lectures") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      if (user.is_admin === 1) {
        await syncLocalLecturesDir(user.id);
      }
      const course = url.searchParams.get("course") || undefined;
      const q = url.searchParams.get("q") || undefined;
      const all = listLecturesForUser(user.id);
      const courses = Array.from(new Set(all.map((l) => l.course)));
      const filtered = listLecturesForUser(user.id, course, q).map(toLectureSummaryDto);
      return jsonResponse({ lectures: filtered, courses });
    }

    // 7b. Batch Cleanup & Organization: POST /api/lectures/cleanup
    if (req.method === "POST" && path === "/api/lectures/cleanup") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      const body: any = await req.json();
      const mode = body.mode;
      const result = cleanupLecturesForUser(user.id, {
        mode,
        ids: body.ids,
        targetCourse: body.targetCourse,
        isPublic: body.isPublic,
      });

      if (
        mode === "failed" ||
        mode === "short_fragments" ||
        mode === "batch_delete"
      ) {
        if (result.affectedIds.length > 0) {
          broadcastLectureEvent(user.id, {
            type: "deleted",
            ids: result.affectedIds,
          });
        }
      } else {
        for (const id of result.affectedIds) {
          const updated = getLectureById(id);
          if (updated) {
            broadcastLectureEvent(user.id, {
              type: "updated",
              id,
              lecture: toLectureSummaryDto(updated),
            });
          }
        }
      }

      return jsonResponse({
        ok: true,
        affectedCount: result.affectedIds.length,
        affectedIds: result.affectedIds,
        reclaimedBytes: result.reclaimedBytes,
      });
    }

    // 8. Single Lecture Detail / Edit / Visibility / Retry / Delete / Audio / Markdown Download
    const lecMatch = path.match(
      /^\/api\/lectures\/([^/]+)(?:\/(audio|markdown|visibility|retry))?$/
    );
    if (
      lecMatch &&
      lecMatch[1] !== "ingest" &&
      lecMatch[1] !== "cleanup"
    ) {
      const id = decodeURIComponent(lecMatch[1]);
      const sub = lecMatch[2];
      const rec = getLectureById(id);
      if (!rec) {
        return jsonResponse({ error: "Lecture not found" }, 404);
      }

      const user = authenticateRequest(req);
      const shareParam = (url.searchParams.get("share") || "").trim();
      const hasValidShareToken =
        Boolean(shareParam) &&
        shareParam === rec.share_token &&
        rec.is_public === 1;
      const isOwner = Boolean(user && user.id === rec.owner_id);

      if (
        !isOwner &&
        !(hasValidShareToken && (sub === "audio" || sub === "markdown"))
      ) {
        return jsonResponse(
          {
            error: user
              ? "접근 권한이 없는 강의 노트입니다."
              : "로그인이 필요합니다.",
          },
          user ? 403 : 401
        );
      }

      if (req.method === "GET" && !sub) {
        const rendered = renderMarkdownToHtml(rec.markdown || "");
        return jsonResponse({
          lecture: {
            ...rec,
            is_public: Boolean(rec.is_public),
            has_audio: Boolean(rec.audio_path && existsSync(rec.audio_path)),
          },
          rendered,
        });
      }

      if (req.method === "GET" && sub === "markdown") {
        const safeName = `${rec.course}_${rec.date_label}.md`.replace(
          /[^\w가-힣._-]/g,
          "_"
        );
        return new Response(rec.markdown + "\n", {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
              safeName
            )}`,
          },
        });
      }

      if (req.method === "GET" && sub === "audio") {
        if (!rec.audio_path || !existsSync(rec.audio_path)) {
          return jsonResponse({ error: "Audio file not found" }, 404);
        }
        return serveAudioWithRange(
          req,
          rec.audio_path,
          rec.audio_mime || "audio/mp4"
        );
      }

      if (req.method === "DELETE" && sub === "audio") {
        if (!isOwner) {
          return jsonResponse({ error: "권한이 없습니다." }, 403);
        }
        const res = deleteLectureAudioOnly(id);
        if (res.lecture) {
          broadcastLectureEvent(rec.owner_id, {
            type: "updated",
            id,
            lecture: toLectureSummaryDto(res.lecture),
          });
        }
        return jsonResponse({
          ok: res.ok,
          reclaimedBytes: res.reclaimedBytes,
          lecture: res.lecture
            ? {
                ...res.lecture,
                is_public: Boolean(res.lecture.is_public),
                has_audio: false,
              }
            : null,
        });
      }

      if (req.method === "POST" && sub === "retry") {
        if (!isOwner) {
          return jsonResponse({ error: "재분석 권한이 없습니다." }, 403);
        }
        if (!rec.audio_path || !existsSync(rec.audio_path)) {
          return jsonResponse(
            { error: "서버에 보존된 원본 오디오 파일이 없어 재분석할 수 없습니다." },
            400
          );
        }
        const reset = resetLectureForRetry(id);
        if (reset) {
          broadcastLectureEvent(rec.owner_id, {
            type: "progress",
            id,
            stage: reset.stage,
            stage_message: reset.stage_message,
            progress: reset.progress,
            lecture: toLectureSummaryDto(reset),
          });
        }
        runBackgroundDistillation(id, rec.owner_id, {
          audioPath: rec.audio_path,
          course: rec.course,
          title: rec.title,
          model: rec.model_requested || DEFAULT_GEMINI_MODEL,
        });
        return jsonResponse({
          ok: true,
          lecture: reset ? toLectureSummaryDto(reset) : null,
        });
      }

      if ((req.method === "PATCH" || req.method === "POST") && sub === "visibility") {
        if (!isOwner) {
          return jsonResponse({ error: "수정 권한이 없습니다." }, 403);
        }
        const body: any = await req.json();
        const nextPublic =
          typeof body.is_public === "boolean"
            ? body.is_public
            : !Boolean(rec.is_public);
        const updated = setLectureVisibility(
          id,
          nextPublic,
          Boolean(body.rotate_token)
        );
        if (updated) {
          broadcastLectureEvent(rec.owner_id, {
            type: "updated",
            id,
            lecture: toLectureSummaryDto(updated),
          });
        }
        return jsonResponse({
          ok: true,
          lecture: updated
            ? {
                ...updated,
                is_public: Boolean(updated.is_public),
                has_audio: Boolean(
                  updated.audio_path && existsSync(updated.audio_path)
                ),
              }
            : null,
        });
      }

      if (req.method === "PUT" && !sub) {
        if (!isOwner) {
          return jsonResponse({ error: "수정 권한이 없습니다." }, 403);
        }
        const body: any = await req.json();
        const updated = updateLectureMarkdown(
          id,
          String(body.title || rec.title),
          String(body.course || rec.course),
          String(body.markdown ?? rec.markdown),
          typeof body.is_public === "boolean" ? body.is_public : undefined
        );
        if (updated) {
          broadcastLectureEvent(rec.owner_id, {
            type: "updated",
            id,
            lecture: toLectureSummaryDto(updated),
          });
        }
        return jsonResponse({
          lecture: updated
            ? {
                ...updated,
                is_public: Boolean(updated.is_public),
                has_audio: Boolean(
                  updated.audio_path && existsSync(updated.audio_path)
                ),
              }
            : null,
        });
      }

      if (req.method === "DELETE" && !sub) {
        if (!isOwner) {
          return jsonResponse({ error: "삭제 권한이 없습니다." }, 403);
        }
        deleteLectureById(id);
        broadcastLectureEvent(rec.owner_id, {
          type: "deleted",
          id,
          ids: [id],
        });
        return jsonResponse({ ok: true, deletedId: id });
      }
    }

    // 9. Async Web/Native Ingest: POST /api/lectures/ingest
    if (req.method === "POST" && path === "/api/lectures/ingest") {
      try {
        let user = authenticateRequest(req);
        const incoming = await saveIncomingAudio(req);
        if (!user && incoming.formToken) {
          user = getUserBySessionOrApiToken(incoming.formToken);
        }
        if (!user) {
          try { unlinkSync(incoming.audioPath); } catch {}
          return jsonResponse({ error: "로그인이 필요합니다." }, 401);
        }

        // Idempotent Upload Deduplication: if this exact audio was already uploaded by this user
        const existing = getLectureByAudioSha256(user.id, incoming.audioSha256);
        if (existing) {
          try { unlinkSync(incoming.audioPath); } catch {}
          if (existing.status === "error" && existing.audio_path && existsSync(existing.audio_path)) {
            const retried = resetLectureForRetry(existing.id);
            runBackgroundDistillation(existing.id, user.id, {
              audioPath: existing.audio_path,
              course: existing.course,
              title: existing.title,
              model: incoming.model || existing.model_requested,
              apiKey: incoming.apiKey,
            });
            return jsonResponse({
              ok: true,
              deduplicated: true,
              retried: true,
              lecture: toLectureSummaryDto(retried || existing),
              url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
              shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
            });
          }
          return jsonResponse({
            ok: true,
            deduplicated: true,
            lecture: toLectureSummaryDto(existing),
            url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
            shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
          });
        }

        const id = generateId("lec");
        const pending = createPendingLecture({
          id,
          ownerId: user.id,
          title: incoming.title,
          course: incoming.course,
          audioPath: incoming.audioPath,
          audioMime: incoming.audioMime,
          audioSize: incoming.audioSize,
          audioSha256: incoming.audioSha256,
          modelRequested: incoming.model,
          sourceClient: incoming.sourceClient,
        });

        broadcastLectureEvent(user.id, {
          type: "created",
          id,
          lecture: toLectureSummaryDto(pending),
        });

        runBackgroundDistillation(id, user.id, incoming);

        return jsonResponse({
          ok: true,
          lecture: toLectureSummaryDto(pending),
          url: `${PUBLIC_BASE_URL}/?lecture=${id}`,
          shareUrl: `${PUBLIC_BASE_URL}/s/${pending.share_token}`,
        });
      } catch (err: any) {
        return jsonResponse({ error: err?.message || String(err) }, 400);
      }
    }

    // 10. Quick-Action / iOS Shortcut / Menu Bar / Android Tile Ingest: POST /api/ingest/shortcut
    if (req.method === "POST" && path === "/api/ingest/shortcut") {
      try {
        let user = authenticateRequest(req);
        const waitComplete = url.searchParams.get("wait") !== "false";
        const incoming = await saveIncomingAudio(req);
        if (!user && incoming.formToken) {
          user = getUserBySessionOrApiToken(incoming.formToken);
        }
        if (!user) {
          try { unlinkSync(incoming.audioPath); } catch {}
          return jsonResponse(
            { error: "인증 토큰(X-Lectern-Token 또는 로그인 세션)이 필요합니다." },
            401
          );
        }

        const existing = getLectureByAudioSha256(user.id, incoming.audioSha256);
        if (existing) {
          try { unlinkSync(incoming.audioPath); } catch {}
          if (existing.status === "error" && existing.audio_path && existsSync(existing.audio_path)) {
            const retried = resetLectureForRetry(existing.id);
            runBackgroundDistillation(existing.id, user.id, {
              audioPath: existing.audio_path,
              course: existing.course,
              title: existing.title,
              model: incoming.model || existing.model_requested,
              apiKey: incoming.apiKey,
            });
            return jsonResponse({
              ok: true,
              deduplicated: true,
              retried: true,
              id: existing.id,
              status: "processing",
              lecture: toLectureSummaryDto(retried || existing),
              url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
              shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
            });
          }
          return jsonResponse({
            ok: true,
            deduplicated: true,
            id: existing.id,
            status: existing.status,
            lecture: toLectureSummaryDto(existing),
            url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
            shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
            markdown: existing.markdown,
          });
        }

        const id = generateId("lec");
        const pending = createPendingLecture({
          id,
          ownerId: user.id,
          title: incoming.title,
          course: incoming.course,
          audioPath: incoming.audioPath,
          audioMime: incoming.audioMime,
          audioSize: incoming.audioSize,
          audioSha256: incoming.audioSha256,
          modelRequested: incoming.model,
          sourceClient: incoming.sourceClient || "shortcut",
        });

        broadcastLectureEvent(user.id, {
          type: "created",
          id,
          lecture: toLectureSummaryDto(pending),
        });

        if (!waitComplete) {
          runBackgroundDistillation(id, user.id, incoming);

          return jsonResponse({
            ok: true,
            id,
            status: "processing",
            lecture: toLectureSummaryDto(pending),
            url: `${PUBLIC_BASE_URL}/?lecture=${id}`,
            shareUrl: `${PUBLIC_BASE_URL}/s/${pending.share_token}`,
          });
        }

        const res = await distillLectureAudio({
          audioPath: incoming.audioPath,
          courseName: incoming.course,
          title: incoming.title,
          model: incoming.model,
          apiKey: incoming.apiKey,
          onProgress: (ev) => {
            const updated = updateLectureProgress(
              id,
              ev.stage,
              ev.message,
              ev.progress ?? 50
            );
            if (updated) {
              broadcastLectureEvent(user!.id, {
                type: "progress",
                id,
                stage: updated.stage,
                stage_message: updated.stage_message,
                progress: updated.progress,
                lecture: toLectureSummaryDto(updated),
              });
            }
          },
        });
        const done = completeLectureRecord(id, res);
        broadcastLectureEvent(user.id, {
          type: "completed",
          id,
          lecture: toLectureSummaryDto(done),
        });

        return jsonResponse({
          ok: true,
          id: done.id,
          title: done.title,
          course: done.course,
          modelUsed: done.model_used,
          excerpt: done.excerpt,
          url: `${PUBLIC_BASE_URL}/?lecture=${done.id}`,
          shareUrl: `${PUBLIC_BASE_URL}/s/${done.share_token}`,
          markdown: done.markdown,
        });
      } catch (err: any) {
        return jsonResponse({ error: err?.message || String(err) }, 400);
      }
    }

    return jsonResponse({ error: "Not Found" }, 404);
}

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    maxRequestBodySize: 250 * 1024 * 1024, // 250 MB
    idleTimeout: 255,
    fetch: handleRequest,
  });

  console.log(`🚀 Lectern Bun Server listening on http://127.0.0.1:${server.port}`);
}
