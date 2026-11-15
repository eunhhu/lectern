// Push devices and Live Activity tokens (CONTRACTS D-P6-1, D-P6-2, D-P6-12).
//
// - A push device is an app install, not a login session: `/me/devices` stays the session
//   list. The app makes the device id (a UUID on first launch), so PUT both registers and
//   updates.
// - One APNs token reaches one user only: registering a token another row holds (the device
//   changed hands, or the app was reinstalled) removes that row first.
// - Tokens are stored as lowercase hex and never leave the server in a response or a log.

import { uuidv7 } from "@lectern/db";
import { db } from "./db.ts";

export { deletePushDevicesOfUser } from "./db.ts";

/** Devices per user; registering one more drops the one seen longest ago. */
export const MAX_PUSH_DEVICES_PER_USER = 20;

export interface PushDeviceRow {
  id: string;
  user_id: string;
  platform: "ios" | "macos";
  name: string | null;
  apns_token: string;
  push_to_start_token: string | null;
  app_version: string | null;
  created_at: number;
  last_seen_at: number;
}

export interface LiveActivityRow {
  id: string;
  recording_id: string;
  device_id: string;
  push_token: string;
  state: "active" | "ended";
  created_at: number;
  ended_at: number | null;
}

const hex = (token: string) => token.toLowerCase();

export function getPushDevice(deviceId: string): PushDeviceRow | null {
  return db.query(`SELECT * FROM push_device WHERE id = ?`).get(deviceId) as PushDeviceRow | null;
}

/** A device of `userId`, or null (unknown, or someone else's). */
export function pushDeviceOf(userId: string, deviceId: string): PushDeviceRow | null {
  const row = getPushDevice(deviceId);
  return row && row.user_id === userId ? row : null;
}

/**
 * Registers or updates a device. `"taken"` when the id is another user's device (409): ids
 * are random UUIDs, so that is a confused or hostile client, never a handover.
 */
export function upsertPushDevice(
  userId: string,
  deviceId: string,
  p: { platform: "ios" | "macos"; apnsToken: string; pushToStartToken?: string | null; name?: string; appVersion?: string },
  now = Date.now()
): PushDeviceRow | "taken" {
  const apnsToken = hex(p.apnsToken);
  // Omitted keeps the stored push-to-start token (the app may send it later than the device
  // token); null clears it.
  const pushToStart = p.pushToStartToken === undefined ? undefined : p.pushToStartToken === null ? null : hex(p.pushToStartToken);
  return db.transaction((): PushDeviceRow | "taken" => {
    const existing = getPushDevice(deviceId);
    if (existing && existing.user_id !== userId) return "taken";
    // The token now belongs to this device: any other row holding it goes (with its activities).
    const holders = db.query(`SELECT id FROM push_device WHERE apns_token = ? AND id != ?`).all(apnsToken, deviceId) as Array<{ id: string }>;
    for (const { id } of holders) deleteDeviceRows(id);
    if (existing) {
      db.query(
        `UPDATE push_device SET platform = ?, apns_token = ?, push_to_start_token = CASE WHEN ? THEN ? ELSE push_to_start_token END,
           name = COALESCE(?, name), app_version = COALESCE(?, app_version), last_seen_at = ?
         WHERE id = ?`
      ).run(p.platform, apnsToken, pushToStart === undefined ? 0 : 1, pushToStart ?? null, p.name ?? null, p.appVersion ?? null, now, deviceId);
    } else {
      db.query(
        `INSERT INTO push_device (id, user_id, platform, name, apns_token, push_to_start_token, app_version, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(deviceId, userId, p.platform, p.name ?? null, apnsToken, pushToStart ?? null, p.appVersion ?? null, now, now);
      const extra = db
        .query(`SELECT id FROM push_device WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC LIMIT -1 OFFSET ?`)
        .all(userId, MAX_PUSH_DEVICES_PER_USER) as Array<{ id: string }>;
      for (const { id } of extra) deleteDeviceRows(id);
    }
    return getPushDevice(deviceId)!;
  })();
}

function deleteDeviceRows(deviceId: string): void {
  db.query(`DELETE FROM live_activity WHERE device_id = ?`).run(deviceId);
  db.query(`DELETE FROM push_device WHERE id = ?`).run(deviceId);
}

/** Stops pushes to one of the user's devices. False when it is not theirs (or unknown). */
export function deletePushDevice(userId: string, deviceId: string): boolean {
  if (!pushDeviceOf(userId, deviceId)) return false;
  db.transaction(() => deleteDeviceRows(deviceId))();
  return true;
}

/** The APNs sender's answer to `410 Unregistered`: that token is dead (D-P6-2). */
export function deletePushDeviceByToken(apnsToken: string): void {
  const row = db.query(`SELECT id FROM push_device WHERE apns_token = ?`).get(hex(apnsToken)) as { id: string } | null;
  if (row) db.transaction(() => deleteDeviceRows(row.id))();
}

/** Starts or refreshes a device's Live Activity for a recording (one per recording and device). */
export function setLiveActivity(p: { recordingId: string; deviceId: string; pushToken: string }, now = Date.now()): void {
  db.query(
    `INSERT INTO live_activity (id, recording_id, device_id, push_token, state, created_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)
     ON CONFLICT (recording_id, device_id) DO UPDATE SET push_token = excluded.push_token, state = 'active', ended_at = NULL`
  ).run(uuidv7(now), p.recordingId, p.deviceId, hex(p.pushToken), now);
}

/** Marks a Live Activity ended. False when there is none for that recording and device. */
export function endLiveActivity(recordingId: string, deviceId: string, now = Date.now()): boolean {
  return (
    db
      .query(`UPDATE live_activity SET state = 'ended', ended_at = COALESCE(ended_at, ?) WHERE recording_id = ? AND device_id = ?`)
      .run(now, recordingId, deviceId).changes > 0
  );
}

export function liveActivityOf(recordingId: string, deviceId: string): LiveActivityRow | null {
  return db.query(`SELECT * FROM live_activity WHERE recording_id = ? AND device_id = ?`).get(recordingId, deviceId) as LiveActivityRow | null;
}
