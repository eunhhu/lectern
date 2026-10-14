import { existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import {
  distillLectureAudio,
  renderMarkdownToHtml,
  DEFAULT_GEMINI_MODEL,
} from "../../../packages/core/src/index.ts";
import {
  DATA_DIR,
  completeLectureRecord,
  createPendingLecture,
  deleteLectureById,
  failLectureRecord,
   generateId,
  getLectureById,
  getLectureByShareToken,
  listLectures,
  syncLocalLecturesDir,
  updateLectureMarkdown,
  updateLectureProgress,
} from "./db.ts";
import { renderAppHtml, renderSharePageHtml } from "./ui.ts";

const PORT = Number(process.env.PORT || 18775);
const PUBLIC_BASE_URL =
  process.env.LECTERN_BASE_URL || "https://lectern.qucord.com";

await syncLocalLecturesDir();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Course, X-Title, X-Model, X-Gemini-Key",
    },
  });
}

async function saveIncomingAudio(
  req: Request
): Promise<{
  audioPath: string;
  audioMime: string;
  audioSize: number;
  course: string;
  title: string;
  model: string;
  sourceClient: string;
  apiKey?: string;
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

    const origExt = extname(fileField.name || "").toLowerCase() || ".m4a";
    const audioPath = join(DATA_DIR, "uploads", `${id}${origExt}`);
    await Bun.write(audioPath, fileField);
    const st = statSync(audioPath);

    return {
      audioPath,
      audioMime: fileField.type || "audio/mp4",
      audioSize: st.size,
      course,
      title: title || `${course} · ${new Date().toISOString().slice(0, 10)}`,
      model,
      sourceClient,
      apiKey,
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

  return {
    audioPath,
    audioMime: contentType || "audio/mp4",
    audioSize: buf.byteLength,
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

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  maxRequestBodySize: 250 * 1024 * 1024, // 250 MB
  idleTimeout: 255,

  async fetch(req: Request): Promise<Response> {
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

    // 3. Public Share View: /s/:token
    if (req.method === "GET" && path.startsWith("/s/")) {
      const token = decodeURIComponent(path.slice(3));
      const lecture = getLectureByShareToken(token);
      if (!lecture) {
        return new Response("공유된 강의 노트를 찾을 수 없습니다.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return new Response(renderSharePageHtml(lecture), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 4. Health check
    if (req.method === "GET" && path === "/api/health") {
      return jsonResponse({
        status: "ok",
        service: "lectern",
        runtime: `Bun ${Bun.version}`,
        defaultModel: DEFAULT_GEMINI_MODEL,
      });
    }

    // 5. iOS Shortcut Recipe Download
    if (req.method === "GET" && path === "/api/clients/ios-shortcut") {
      return jsonResponse({
        name: "Lectern 강의 녹음 요약",
        endpoint: `${PUBLIC_BASE_URL}/api/ingest/shortcut`,
        method: "POST",
        headers: {
          "X-Course": "정보보호개론",
        },
        formField: "audio",
        openUrlOnComplete: `${PUBLIC_BASE_URL}/?lecture={{id}}`,
        instructions: [
          "1. iOS '단축어(Shortcuts)' 앱에서 새 단축어 생성",
          "2. '오디오 녹음' 또는 공유 시트에서 '오디오 파일' 입력 받기 추가",
          "3. 'URL 내용 가져오기' 액션 추가 → URL: https://lectern.qucord.com/api/ingest/shortcut, 메소드: POST, 요청 본문: 폼(Form), 필드명 'audio'에 녹음 파일 연결",
          "4. '사전 값 가져오기'로 'url' 추출 후 'URL 열기' 액션 연결 → 녹음 직후 마크다운 리더가 바로 열립니다.",
        ],
      });
    }

    // 6. List Lectures
    if (req.method === "GET" && path === "/api/lectures") {
      await syncLocalLecturesDir();
      const course = url.searchParams.get("course") || undefined;
      const q = url.searchParams.get("q") || undefined;
      const all = listLectures();
      const courses = Array.from(new Set(all.map((l) => l.course)));
      const filtered = listLectures(course, q).map((l) => ({
        id: l.id,
        share_token: l.share_token,
        title: l.title,
        course: l.course,
        date_label: l.date_label,
        status: l.status,
        stage: l.stage,
        stage_message: l.stage_message,
        progress: l.progress,
        excerpt: l.excerpt,
        duration_sec: l.duration_sec,
        model_used: l.model_used,
        has_audio: Boolean(l.audio_path && existsSync(l.audio_path)),
        created_at: l.created_at,
      }));
      return jsonResponse({ lectures: filtered, courses });
    }

    // 7. Single Lecture Detail / Edit / Delete / Audio / Markdown Download
    const lecMatch = path.match(/^\/api\/lectures\/([^/]+)(?:\/(audio|markdown))?$/);
    if (lecMatch && lecMatch[1] !== "ingest") {
      const id = decodeURIComponent(lecMatch[1]);
      const sub = lecMatch[2];
      const rec = getLectureById(id);
      if (!rec) {
        return jsonResponse({ error: "Lecture not found" }, 404);
      }

      if (req.method === "GET" && !sub) {
        const rendered = renderMarkdownToHtml(rec.markdown || "");
        return jsonResponse({
          lecture: {
            ...rec,
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

      if (req.method === "PUT" && !sub) {
        const body: any = await req.json();
        const updated = updateLectureMarkdown(
          id,
          String(body.title || rec.title),
          String(body.course || rec.course),
          String(body.markdown ?? rec.markdown)
        );
        return jsonResponse({ lecture: updated });
      }

      if (req.method === "DELETE" && !sub) {
        deleteLectureById(id);
        return jsonResponse({ ok: true });
      }
    }

    // 8. Async Web/Native Ingest: POST /api/lectures/ingest
    if (req.method === "POST" && path === "/api/lectures/ingest") {
      try {
        const incoming = await saveIncomingAudio(req);
        const id = generateId("lec");
        const pending = createPendingLecture({
          id,
          title: incoming.title,
          course: incoming.course,
          audioPath: incoming.audioPath,
          audioMime: incoming.audioMime,
          audioSize: incoming.audioSize,
          modelRequested: incoming.model,
          sourceClient: incoming.sourceClient,
        });

        // Kick off distillation in background
        (async () => {
          try {
            const res = await distillLectureAudio({
              audioPath: incoming.audioPath,
              courseName: incoming.course,
              title: incoming.title,
              model: incoming.model,
              apiKey: incoming.apiKey,
              onProgress: (ev) => {
                updateLectureProgress(
                  id,
                  ev.stage,
                  ev.message,
                  ev.progress ?? 50
                );
              },
            });
            completeLectureRecord(id, res);
          } catch (err: any) {
            failLectureRecord(id, err?.message || String(err));
          }
        })();

        return jsonResponse({
          ok: true,
          lecture: pending,
          url: `${PUBLIC_BASE_URL}/?lecture=${id}`,
          shareUrl: `${PUBLIC_BASE_URL}/s/${pending.share_token}`,
        });
      } catch (err: any) {
        return jsonResponse({ error: err?.message || String(err) }, 400);
      }
    }

    // 9. Quick-Action / iOS Shortcut / Menu Bar / Android Tile Ingest: POST /api/ingest/shortcut
    if (req.method === "POST" && path === "/api/ingest/shortcut") {
      try {
        const waitComplete = url.searchParams.get("wait") !== "false";
        const incoming = await saveIncomingAudio(req);
        const id = generateId("lec");
        const pending = createPendingLecture({
          id,
          title: incoming.title,
          course: incoming.course,
          audioPath: incoming.audioPath,
          audioMime: incoming.audioMime,
          audioSize: incoming.audioSize,
          modelRequested: incoming.model,
          sourceClient: incoming.sourceClient || "shortcut",
        });

        if (!waitComplete) {
          (async () => {
            try {
              const res = await distillLectureAudio({
                audioPath: incoming.audioPath,
                courseName: incoming.course,
                title: incoming.title,
                model: incoming.model,
                apiKey: incoming.apiKey,
                onProgress: (ev) =>
                  updateLectureProgress(id, ev.stage, ev.message, ev.progress ?? 50),
              });
              completeLectureRecord(id, res);
            } catch (err: any) {
              failLectureRecord(id, err?.message || String(err));
            }
          })();

          return jsonResponse({
            ok: true,
            id,
            status: "processing",
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
          onProgress: (ev) =>
            updateLectureProgress(id, ev.stage, ev.message, ev.progress ?? 50),
        });
        const done = completeLectureRecord(id, res);

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
  },
});

console.log(`🚀 Lectern Bun Server listening on http://127.0.0.1:${server.port}`);
