// Who gets which push while a recording is processed (CONTRACTS D-P6-2, D-P6-12).
//
// - Only when the stage changes and when processing ends; never per progress tick.
// - Live Activity updates go to the recording's active activity tokens; a push-to-start goes
//   once per recording to the creator's iPhones that have no activity for it yet.
// - The end of processing ends the activities and alerts every iPhone of the creator.
// - Nothing here throws, and callers do not wait: a push never slows or fails a job.
// - Off (LECTERN_APNS=0, a missing value or key file, no APNS_TOPIC_IOS): no connection at all.
// - Logs carry the recording id, the status and at most a token's first 8 characters.

import { config } from "@lectern/config";
import { db } from "../db.ts";
import { logger } from "../log.ts";
import { deletePushDeviceByToken } from "../push-devices.ts";
import { createApnsClient, type ApnsClient, type ApnsResult, type ApnsSend } from "./client.ts";
import { apnsAuth, apnsProviderToken, resetApnsTokenCache, type ApnsAuth } from "./jwt.ts";
import {
  documentReadyAlert,
  liveActivityEnd,
  liveActivityStart,
  liveActivityUpdate,
  processingFailedAlert,
  stageLabel,
  type ContentState,
} from "./payload.ts";

const RETRY_DELAYS_MS = [1000, 4000];
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

let client: ApnsClient | null = null;
let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The last stage sent per recording (process memory: another process may repeat one, accepted). */
const lastStage = new Map<string, string>();
/** Devices already sent a push-to-start for a recording. */
const started = new Map<string, Set<string>>();

/** Tests: a client on the fake APNs (null: the default one is made when first needed). */
export function setApnsClientForTests(next: ApnsClient | null): void {
  client?.close();
  client = next;
  lastStage.clear();
  started.clear();
}

/** Tests: the wait between retries. */
export function setApnsSleepForTests(next: ((ms: number) => Promise<void>) | null): void {
  sleep = next ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

interface Ready {
  auth: ApnsAuth;
  topic: string;
  client: ApnsClient;
}

/** Everything a send needs, or null: then nothing connects anywhere. */
function ready(): Ready | null {
  const auth = apnsAuth();
  const topic = config().apns.topicIos;
  if (!auth || !topic) return null;
  client ??= createApnsClient();
  return { auth, topic, client };
}

interface RecordingFacts {
  id: string;
  title: string;
  created_by: string;
}

function recordingOf(recordingId: string): RecordingFacts | null {
  return db.query(`SELECT id, title, created_by FROM recording WHERE id = ?`).get(recordingId) as RecordingFacts | null;
}

const short = (token: string) => token.slice(0, 8);
const nowSec = () => Math.floor(Date.now() / 1000);

type Target =
  | { kind: "device"; token: string }
  | { kind: "start"; token: string; deviceId: string }
  | { kind: "activity"; token: string; activityId: string };

/**
 * One push with Apple's answers handled: a dead token is dropped (no retry), an expired
 * provider token is replaced once, throttling and server errors are retried twice.
 */
async function deliver(r: Ready, target: Target, p: Omit<ApnsSend, "token" | "providerToken">, recordingId: string): Promise<ApnsResult> {
  let refreshed = false;
  let retries = 0;
  for (;;) {
    const result = await r.client.send({ ...p, token: target.token, providerToken: await apnsProviderToken(r.auth) });
    if (result.status === 200) return result;
    if (result.status === 410 || (result.status === 400 && result.reason && DEAD_TOKEN_REASONS.has(result.reason))) {
      if (target.kind === "device") deletePushDeviceByToken(target.token);
      else if (target.kind === "start") db.query(`UPDATE push_device SET push_to_start_token = NULL WHERE id = ?`).run(target.deviceId);
      else db.query(`UPDATE live_activity SET state = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`).run(Date.now(), target.activityId);
      logger.info("apns token dropped", { recording_id: recordingId, status: result.status, reason: result.reason, token: short(target.token) });
      return result;
    }
    if (result.status === 403 && result.reason === "ExpiredProviderToken" && !refreshed) {
      refreshed = true;
      resetApnsTokenCache(r.auth.keyId);
      continue;
    }
    if ((result.status === 429 || result.status >= 500 || result.status === 0) && retries < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[retries]!);
      retries += 1;
      continue;
    }
    logger.warn("apns push failed", { recording_id: recordingId, status: result.status, reason: result.reason, token: short(target.token) });
    return result;
  }
}

interface ActivityRow {
  id: string;
  device_id: string;
  push_token: string;
}

const activeActivities = (recordingId: string) =>
  db.query(`SELECT id, device_id, push_token FROM live_activity WHERE recording_id = ? AND state = 'active'`).all(recordingId) as ActivityRow[];

const iosDevices = (userId: string) =>
  db.query(`SELECT id, apns_token, push_to_start_token FROM push_device WHERE user_id = ? AND platform = 'ios'`).all(userId) as Array<{
    id: string;
    apns_token: string;
    push_to_start_token: string | null;
  }>;

/** A stage started (process job). Sends nothing when the stage is the one sent last. Never throws. */
export async function notifyStage(recordingId: string, stage: string, progress: number | null): Promise<void> {
  try {
    const r = ready();
    if (!r) return;
    if (lastStage.get(recordingId) === stage) return;
    lastStage.set(recordingId, stage);
    const recording = recordingOf(recordingId);
    if (!recording) return;
    // `progress` is the stage's percent (PROCESS_STAGE_PROGRESS), as the web shows it.
    const state: ContentState = { stage, stage_label: stageLabel(stage), progress, recording_id: recordingId, document_ready: false };
    const sec = nowSec();
    const activityTopic = `${r.topic}.push-type.liveactivity`;
    const sends: Promise<unknown>[] = [];
    const activities = activeActivities(recordingId);
    for (const a of activities) {
      sends.push(
        deliver(
          r,
          { kind: "activity", token: a.push_token, activityId: a.id },
          { topic: activityTopic, pushType: "liveactivity", priority: 5, expiration: sec + 3600, payload: liveActivityUpdate(state, sec) },
          recordingId
        )
      );
    }
    // Push-to-start: once per recording, to the creator's iPhones without an activity for it.
    const withActivity = new Set(
      (db.query(`SELECT device_id FROM live_activity WHERE recording_id = ?`).all(recordingId) as Array<{ device_id: string }>).map((a) => a.device_id)
    );
    const sent = started.get(recordingId) ?? new Set<string>();
    for (const d of iosDevices(recording.created_by)) {
      if (!d.push_to_start_token || withActivity.has(d.id) || sent.has(d.id)) continue;
      sent.add(d.id);
      sends.push(
        deliver(
          r,
          { kind: "start", token: d.push_to_start_token, deviceId: d.id },
          {
            topic: activityTopic,
            pushType: "liveactivity",
            priority: 10,
            expiration: sec + 3600,
            payload: liveActivityStart(state, { recording_id: recordingId, title: recording.title }, sec),
          },
          recordingId
        )
      );
    }
    started.set(recordingId, sent);
    await Promise.all(sends);
  } catch (err) {
    logger.warn("apns stage push failed", { recording_id: recordingId, error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Ends every active Live Activity of the recording with `state`, then marks the rows ended. */
async function endActivities(r: Ready, recordingId: string, state: ContentState): Promise<void> {
  const sec = nowSec();
  const activities = activeActivities(recordingId);
  await Promise.all(
    activities.map((a) =>
      deliver(
        r,
        { kind: "activity", token: a.push_token, activityId: a.id },
        { topic: `${r.topic}.push-type.liveactivity`, pushType: "liveactivity", priority: 10, expiration: sec + 3600, payload: liveActivityEnd(state, sec) },
        recordingId
      )
    )
  );
  if (activities.length) {
    db.query(`UPDATE live_activity SET state = 'ended', ended_at = COALESCE(ended_at, ?) WHERE recording_id = ? AND state = 'active'`).run(
      Date.now(),
      recordingId
    );
  }
}

function forget(recordingId: string): void {
  lastStage.delete(recordingId);
  started.delete(recordingId);
}

/** Processing ended: end the activities, alert the creator's iPhones. Never throws. */
export async function notifyFinished(recordingId: string, outcome: "ready" | "partial" | "failed"): Promise<void> {
  try {
    const r = ready();
    if (!r) return;
    const recording = recordingOf(recordingId);
    forget(recordingId);
    if (!recording) return;
    const failed = outcome === "failed";
    await endActivities(r, recordingId, {
      stage: failed ? "failed" : "done",
      stage_label: stageLabel(failed ? "failed" : "done"),
      progress: failed ? null : 100,
      recording_id: recordingId,
      document_ready: !failed,
    });
    const url = `${config().baseUrl.replace(/\/+$/, "")}/app/recordings/${recordingId}`;
    const payload = failed
      ? processingFailedAlert({ recordingId, title: recording.title, url })
      : documentReadyAlert({ recordingId, title: recording.title, url, partial: outcome === "partial" });
    const expiration = nowSec() + 86_400;
    await Promise.all(
      iosDevices(recording.created_by).map((d) =>
        deliver(r, { kind: "device", token: d.apns_token }, { topic: r.topic, pushType: "alert", priority: 10, expiration, payload }, recordingId)
      )
    );
  } catch (err) {
    logger.warn("apns finish push failed", { recording_id: recordingId, error: err instanceof Error ? err.name : "unknown" });
  }
}

/** A canceled job: the activities end ("취소됨"), no alert. Never throws. */
export async function endAllLiveActivities(recordingId: string): Promise<void> {
  try {
    const r = ready();
    forget(recordingId);
    if (!r) return;
    await endActivities(r, recordingId, {
      stage: "canceled",
      stage_label: stageLabel("canceled"),
      progress: null,
      recording_id: recordingId,
      document_ready: false,
    });
  } catch (err) {
    logger.warn("apns cancel push failed", { recording_id: recordingId, error: err instanceof Error ? err.name : "unknown" });
  }
}
