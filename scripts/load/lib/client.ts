// HTTP client for the load scripts: sign in as the sandbox owner, upload a file through the v2
// resumable upload (create → parts → complete), and poll a recording until it settles.

import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "../../../apps/web/e2e/server/accounts.ts";

export interface Session {
  baseUrl: string;
  token: string;
  workspaceId: string;
}

export interface UploadOutcome {
  ok: boolean;
  recordingId: string | null;
  bytes: number;
  parts: number;
  uploadMs: number;
  status: number | null;
  error: string | null;
  /** Where it failed: create, part or complete (null when it worked). */
  stage?: "create" | "part" | "complete" | null;
  /** The upload session id, once created. */
  uploadId?: string | null;
}

const TERMINAL = new Set(["ready", "partial", "failed", "canceled"]);

function headers(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { "X-Lectern-Token": session.token, "X-Client": "load-test", ...extra };
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string } };
    if (typeof body.error === "string") return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 200) || `HTTP ${res.status}`;
}

/** POST /api/auth/login → user.apiToken, then GET /api/v2/me → personal_workspace_id. */
export async function signIn(baseUrl: string): Promise<Session> {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_OWNER_EMAIL, password: E2E_OWNER_PASSWORD }),
  });
  if (!login.ok) throw new Error(`sign-in failed (${login.status}): ${await errorMessage(login)}`);
  const token = ((await login.json()) as { user?: { apiToken?: string } }).user?.apiToken;
  if (!token) throw new Error("sign-in answered without user.apiToken");
  const me = await fetch(`${baseUrl}/api/v2/me`, { headers: { "X-Lectern-Token": token } });
  if (!me.ok) throw new Error(`GET /api/v2/me failed (${me.status}): ${await errorMessage(me)}`);
  const workspaceId = ((await me.json()) as { personal_workspace_id?: string }).personal_workspace_id;
  if (!workspaceId) throw new Error("GET /api/v2/me answered without personal_workspace_id");
  return { baseUrl, token, workspaceId };
}

/** The byte ranges of a file's parts (numbered from 1). */
export function partPlan(bytes: number, partSize: number): Array<{ part: number; offset: number; length: number }> {
  const count = Math.max(1, Math.ceil(bytes / partSize));
  return Array.from({ length: count }, (_, i) => {
    const offset = i * partSize;
    return { part: i + 1, offset, length: Math.min(partSize, bytes - offset) };
  });
}

/** Uploads one audio file; never throws (a failure is `ok: false` with its status and message). */
export async function uploadFile(session: Session, path: string, key: string): Promise<UploadOutcome> {
  const file = Bun.file(path);
  const bytes = file.size;
  const started = performance.now();
  const outcome: UploadOutcome = { ok: false, recordingId: null, bytes, parts: 0, uploadMs: 0, status: null, error: null, stage: "create", uploadId: null };
  const fail = (status: number | null, error: string): UploadOutcome => {
    outcome.status = status;
    outcome.error = error;
    outcome.uploadMs = Math.round(performance.now() - started);
    return outcome;
  };
  try {
    const filename = path.split("/").at(-1) ?? "audio.wav";
    const created = await fetch(`${session.baseUrl}/api/v2/uploads`, {
      method: "POST",
      headers: headers(session, { "Content-Type": "application/json", "Idempotency-Key": key }),
      body: JSON.stringify({ workspace_id: session.workspaceId, files: [{ kind: "audio", filename, mime: "audio/wav", bytes }] }),
    });
    if (!created.ok) return fail(created.status, await errorMessage(created));
    const upload = (await created.json()) as { id: string; part_size: number; files: Array<{ first_part: number; part_count: number }> };
    outcome.uploadId = upload.id;
    const first = upload.files[0]!;
    const plan = partPlan(bytes, upload.part_size);
    if (plan.length !== first.part_count) return fail(null, `part plan mismatch: ${plan.length} here, ${first.part_count} on the server`);
    outcome.parts = plan.length;

    outcome.stage = "part";
    for (const { part, offset, length } of plan) {
      const number = first.first_part + part - 1;
      const put = await fetch(`${session.baseUrl}/api/v2/uploads/${encodeURIComponent(upload.id)}/parts/${number}`, {
        method: "PUT",
        headers: headers(session, { "Content-Type": "application/octet-stream" }),
        body: file.slice(offset, offset + length),
      });
      if (!put.ok) return fail(put.status, await errorMessage(put));
      await put.arrayBuffer();
    }

    outcome.stage = "complete";
    const done = await fetch(`${session.baseUrl}/api/v2/uploads/${encodeURIComponent(upload.id)}/complete`, {
      method: "POST",
      headers: headers(session, { "Idempotency-Key": key }),
    });
    if (!done.ok) return fail(done.status, await errorMessage(done));
    const result = (await done.json()) as { recording?: { id?: string } };
    outcome.recordingId = result.recording?.id ?? null;
    outcome.ok = outcome.recordingId !== null;
    outcome.stage = outcome.ok ? null : "complete";
    if (!outcome.ok) outcome.error = "complete answered without recording.id";
    outcome.status = done.status;
    outcome.uploadMs = Math.round(performance.now() - started);
    return outcome;
  } catch (err) {
    return fail(null, err instanceof Error ? err.message : String(err));
  }
}

/** GET /api/v2/recordings/<id> every 2 s until ready, partial, failed or canceled; "timeout" after `timeoutMs`. */
export async function waitForRecording(
  session: Session,
  recordingId: string,
  timeoutMs: number,
): Promise<{ status: string; ms: number; lastSeen: string }> {
  const started = performance.now();
  let last = "unknown";
  while (performance.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${session.baseUrl}/api/v2/recordings/${encodeURIComponent(recordingId)}`, { headers: headers(session) });
      if (res.ok) {
        // RecordingDetail: { recording: { status }, active_job, progress, … }
        last = ((await res.json()) as { recording?: { status?: string } }).recording?.status ?? last;
        if (TERMINAL.has(last)) return { status: last, ms: Math.round(performance.now() - started), lastSeen: last };
      } else {
        await res.arrayBuffer();
      }
    } catch {
      // the server may be busy; try again
    }
    await Bun.sleep(2000);
  }
  return { status: "timeout", ms: Math.round(performance.now() - started), lastSeen: last };
}

/** GET /api/v2/recordings for the workspace, every page: how many recordings it lists. */
export async function countRecordings(session: Session): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ workspace_id: session.workspaceId, limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const res = await fetch(`${session.baseUrl}/api/v2/recordings?${query}`, { headers: headers(session) });
    if (!res.ok) throw new Error(`GET /api/v2/recordings failed (${res.status}): ${await errorMessage(res)}`);
    const body = (await res.json()) as { items: unknown[]; next_cursor: string | null };
    count += body.items.length;
    cursor = body.next_cursor;
    if (!cursor) return count;
  }
  return count;
}

/** DELETE /api/v2/uploads/<id>: drops an upload session and its stored parts. */
export async function abortUpload(session: Session, uploadId: string): Promise<number> {
  const res = await fetch(`${session.baseUrl}/api/v2/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE", headers: headers(session) });
  await res.arrayBuffer();
  return res.status;
}

/** GET /api/health → the status code (null when the server does not answer). */
export async function health(baseUrl: string): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    await res.arrayBuffer();
    return res.status;
  } catch {
    return null;
  }
}
