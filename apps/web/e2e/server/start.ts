// The real Lectern server for the e2e "server" project (`bun e2e/server/start.ts`, started
// by Playwright). It runs the production request handler (apps/server/src/index.ts
// handleRequest: v1 auth, /api/v2, the /app web shell from apps/web/dist) on a throwaway
// database, with:
//
// - an owner account and two synthetic v1 lectures (accounts.ts), each with a short WAV;
// - LECTERN_ASK=1 and the real ask service, whose Gemini calls are answered here by a
//   fake at the fetch boundary (deterministic embeddings and a model that quotes the best
//   passage with its [cN] marker). The same fake answers the v2 pipeline's calls: chunk
//   transcription (three fixed Korean sentences) and the notes stages' JSON (classify,
//   structure, extract). Every other outbound request is refused, so nothing leaves the
//   machine and no real key is ever read;
// - LECTERN_WORKER_MODE=external, so no job runs until a test turns the v2 pipeline on
//   (POST /__e2e/pipeline), which starts a job worker in this process (the lectures are
//   indexed directly).
//
// Nothing in apps/server is changed for this; it only sets the environment the server
// already reads. The /__e2e/* routes exist only in this process.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD, E2E_PORT } from "./accounts.ts";
import { wav } from "./wav.ts";

const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : E2E_PORT;

// --- sandbox -------------------------------------------------------------------------
const root = mkdtempSync(join(tmpdir(), "lectern-web-e2e-"));
const dirs = { data: join(root, "data"), lectures: join(root, "lectures"), home: join(root, "home") };
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
for (const key of ["RESEND_API_KEY", "LECTERN_DEPLOY_TOKEN", "LECTERN_OWNER_API_TOKEN", "LECTERN_OWNER_ALIASES", "LECTERN_FORCE_RESET_OWNER_PASSWORD"]) {
  delete process.env[key];
}
Object.assign(process.env, {
  LECTERN_DATA_DIR: dirs.data,
  LECTERN_LECTURES_DIR: dirs.lectures,
  // The legacy Gemini path reads ~/local.env; this process never sees the real one.
  HOME: dirs.home,
  LECTERN_RESEND_CREDENTIALS_FILE: join(root, "no-credentials.json"),
  PORT: String(port),
  LECTERN_BASE_URL: `http://127.0.0.1:${port}`, // http: the session cookie drops Secure
  LECTERN_OWNER_EMAIL: E2E_OWNER_EMAIL,
  LECTERN_OWNER_PASSWORD: E2E_OWNER_PASSWORD,
  LECTERN_OWNER_NAME: "E2E 사용자",
  LECTERN_WEB_SHELL: "1",
  LECTERN_ASK: "1",
  LECTERN_WORKER_MODE: "external",
  LECTERN_LOG_REQUESTS: "0",
  GEMINI_API_KEY: "e2e-fake-gemini-key",
});
const cleanup = () => rmSync(root, { recursive: true, force: true });
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

// --- fake Gemini ---------------------------------------------------------------------
const realFetch = globalThis.fetch;
const GEMINI = "https://generativelanguage.googleapis.com/";

function grams(text: string): Set<string> {
  const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < key.length - 1; i++) out.add(key.slice(i, i + 2));
  return out;
}

function overlap(question: Set<string>, text: string): number {
  if (!question.size) return 0;
  const g = grams(text);
  let hit = 0;
  for (const x of question) if (g.has(x)) hit++;
  return hit / question.size;
}

/** 768 dims of hashed character bigrams, L2-normalized: similar wording, similar vectors. */
function embed(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const g of grams(text)) {
    let h = 2166136261;
    for (let i = 0; i < g.length; i++) h = Math.imul(h ^ g.charCodeAt(i), 16777619);
    v[(h >>> 0) % dim]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Quotes the line of the best-matching passage, or says 모름 below a threshold. */
function answer(context: string, instruction: string): string {
  const question = grams(instruction.split("질문:").at(-1) ?? instruction);
  let best: { label: string; line: string; score: number } | null = null;
  for (const block of context.split("\n\n")) {
    const label = /^\[(c\d+)\]/.exec(block)?.[1];
    if (!label) continue;
    for (const raw of block.split("\n").slice(1)) {
      const line = raw.replace(/^[-*]\s*/, "").replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g, "").replace(/^#+\s*/, "").trim();
      const score = overlap(question, line);
      if (line.length > 8 && (!best || score > best.score)) best = { label, line, score };
    }
  }
  if (!best || best.score < 0.25) return "[[모름]] 노트에서 이 질문의 답을 찾지 못했습니다.";
  return `노트에 따르면 ${best.line} [${best.label}]`;
}

function geminiSse(text: string): Response {
  const encoder = new TextEncoder();
  const pieces = text.match(/[\s\S]{1,12}/g) ?? [text];
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [i, piece] of pieces.entries()) {
        const last = i === pieces.length - 1;
        const chunk = {
          candidates: [{ content: { role: "model", parts: [{ text: piece }] }, ...(last ? { finishReason: "STOP" } : {}) }],
          ...(last ? { usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 60, totalTokenCount: 1860 } } : {}),
          responseId: "e2e-fake",
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
        await Bun.sleep(15);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** What the fake "hears" in any chunk (clip-relative MM:SS, as the transcription prompt asks). */
const FAKE_TRANSCRIPT = [
  { start: "00:00", end: "00:04", text: "오늘은 블록 암호의 운영 모드를 살펴봅니다." },
  { start: "00:04", end: "00:08", text: "ECB 모드는 같은 평문 블록을 같은 암호문으로 바꿉니다." },
  { start: "00:08", end: "00:12", text: "그래서 실제로는 CBC 모드처럼 이전 블록을 섞는 방식을 씁니다." },
];

function geminiJson(value: unknown, usage = { promptTokenCount: 900, candidatesTokenCount: 120, totalTokenCount: 1020 }): Response {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }],
    usageMetadata: usage,
    modelVersion: "gemini-3.8-flash",
    responseId: "e2e-fake",
  });
}

const provenance = { sources: ["#0-#1"], pdf_pages: [] as number[] };

/** Notes-stage answers, told apart by the top-level properties of the request's responseSchema. */
function notesAnswer(properties: string[]): unknown {
  if (properties.includes("domain")) {
    return {
      domain: "lecture",
      language: "ko",
      title: "블록 암호 운영 모드 강의",
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0.9,
    };
  }
  if (properties.includes("sections")) {
    return {
      sections: [
        { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "ECB 모드의 한계와 CBC 모드가 쓰이는 이유를 다뤘다.", ...provenance }] },
        { key: "topics", blocks: [{ type: "paragraph", heading: "운영 모드", text: "ECB는 같은 평문 블록을 같은 암호문으로 바꾸고, CBC는 이전 블록을 섞는다.", ...provenance }] },
      ],
    };
  }
  // Extract: every field the template asks for, empty (no events, no glossary entries).
  if (["events", "action_items", "decisions", "glossary"].some((p) => properties.includes(p))) {
    return Object.fromEntries(properties.map((p) => [p, []]));
  }
  // The verifier's repair call: nothing to fix.
  if (properties.includes("fixes")) return { fixes: [] };
  return null;
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(GEMINI)) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes(":generateContent")) {
      const parts = (body.contents?.[0]?.parts ?? []) as Array<{ inlineData?: unknown }>;
      if (parts.some((p) => p.inlineData)) {
        const segments = FAKE_TRANSCRIPT.map((s) => ({ ...s, speaker: "S1" }));
        return geminiJson({ language: "ko", segments }, { promptTokenCount: 700, candidatesTokenCount: 90, totalTokenCount: 790 });
      }
      if (body.generationConfig?.responseMimeType === "application/json") {
        const answer = notesAnswer(Object.keys(body.generationConfig.responseSchema?.properties ?? {}));
        if (answer !== null) return geminiJson(answer);
      }
      return Response.json({ error: { code: 400, message: "not faked in e2e" } }, { status: 400 });
    }
    if (url.includes(":batchEmbedContents")) {
      const embeddings = (body.requests as { content: { parts: { text: string }[] }; outputDimensionality: number }[]).map((r) => ({
        values: embed(r.content.parts.map((p) => p.text).join(" "), r.outputDimensionality),
      }));
      return Response.json({ embeddings });
    }
    if (url.includes(":streamGenerateContent")) {
      const [context, instruction] = (body.contents[0].parts as { text: string }[]).map((p) => p.text);
      return geminiSse(answer(context ?? "", instruction ?? ""));
    }
    return Response.json({ error: { code: 404, message: "not faked in e2e" } }, { status: 404 });
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`e2e server: outbound request refused (${host})`);
  return realFetch(input, init);
}) as typeof fetch;

// --- server ----------------------------------------------------------------------------
const { handleRequest } = await import("../../../server/src/index.ts");
const db = await import("../../../server/src/db.ts");
const { indexLecture } = await import("../../../server/src/ask/index-job.ts");
const { askService } = await import("../../../server/src/ask/service.ts");

const owner = db.ensureBootstrapOwner();
const service = askService();
if (!service?.embedder) throw new Error("e2e server: the ask service did not start (LECTERN_ASK)");
for (const lecture of E2E_LECTURES) {
  const id = db.generateId("lec");
  const audioPath = join(dirs.lectures, `${id}.wav`);
  const bytes = wav(lecture.audioSeconds);
  writeFileSync(audioPath, bytes);
  db.createPendingLecture({
    id,
    ownerId: owner.id,
    title: lecture.title,
    course: lecture.course,
    audioPath,
    audioMime: "audio/wav",
    audioSize: bytes.byteLength,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "web",
  });
  db.completeLectureRecord(id, {
    title: lecture.title,
    courseName: lecture.course,
    markdown: lecture.markdown,
    excerpt: "",
    modelUsed: "gemini-3.8-flash",
    durationSec: lecture.audioSeconds,
  });
  const outcome = await indexLecture(id, { jobId: `job_e2e_${id}`, embedder: service.embedder });
  if (!outcome.ok) throw new Error(`e2e server: indexing ${id} failed: ${JSON.stringify(outcome)}`);
  if (lecture.transcript) seedTranscript(id, lecture.transcript);
}

/**
 * v1 lectures project to v2 rows with an empty transcript. The suite also needs a
 * recording whose transcript follows the audio, so this writes one (speaker + segments)
 * into the projected recording, as the transcription pipeline will.
 */
function seedTranscript(recordingId: string, rows: NonNullable<(typeof E2E_LECTURES)[number]["transcript"]>) {
  db.syncPendingLectures();
  const sql = db.db;
  const recording = sql.query(`SELECT id, workspace_id FROM recording WHERE id = ?`).get(recordingId) as { id: string; workspace_id: string } | null;
  if (!recording) throw new Error(`e2e server: lecture ${recordingId} was not projected to a v2 recording`);
  const now = Date.now();
  const speakerId = `spk_e2e_${recordingId.slice(0, 8)}`;
  sql
    .query(`INSERT INTO speaker (id, workspace_id, recording_id, label, display_name, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`)
    .run(speakerId, recording.workspace_id, recording.id, "S1", "교수", now, now);
  rows.forEach((row, idx) =>
    sql
      .query(`INSERT INTO transcript_segment (workspace_id, recording_id, idx, start_ms, end_ms, speaker_id, text, confidence, source_chunk, lang) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'ko')`)
      .run(recording.workspace_id, recording.id, idx, row.startMs, row.endMs, speakerId, row.text),
  );
}

// --- e2e control (this process only) -----------------------------------------------------
const { resetConfigForTests } = await import("../../../../packages/config/src/index.ts");
const { isFfmpegAvailable } = await import("../../../../packages/media/src/index.ts");
const queue = await import("../../../server/src/queue.ts");
let worker: InstanceType<typeof queue.JobWorker> | null = null;

/**
 * v2: LECTERN_PIPELINE=v2 and a job worker in this process. Jobs left queued under v1 (the
 * upload test's distill job) are canceled first, through the queue's own cancel path, so the
 * worker only runs what the v2 test enqueues. v1: back to the defaults, worker drained.
 */
async function setPipeline(mode: "v1" | "v2"): Promise<void> {
  if (mode === "v2") {
    process.env.LECTERN_PIPELINE = "v2";
    resetConfigForTests();
    db.db.query(`UPDATE job SET cancel_requested_at = ? WHERE state = 'queued' AND cancel_requested_at IS NULL`).run(Date.now());
    queue.cancelQueuedJobs();
    worker ??= new queue.JobWorker({ pollMs: 200 });
    worker.start();
    return;
  }
  delete process.env.LECTERN_PIPELINE;
  resetConfigForTests();
  const running = worker;
  worker = null;
  await running?.drain(10_000);
}

async function controlRoute(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (req.method === "GET" && pathname === "/__e2e/info") return Response.json({ ffmpeg: isFfmpegAvailable() });
  if (req.method === "POST" && pathname === "/__e2e/pipeline") {
    const mode = ((await req.json().catch(() => null)) as { mode?: unknown } | null)?.mode;
    if (mode !== "v1" && mode !== "v2") return Response.json({ error: "mode must be v1 or v2" }, { status: 400 });
    await setPipeline(mode);
    return Response.json({ mode });
  }
  return null;
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  fetch: async (req) => (await controlRoute(req)) ?? handleRequest(req),
});
console.log(`e2e server: http://127.0.0.1:${server.port}/app/ (owner ${E2E_OWNER_EMAIL}, data in ${root})`);
