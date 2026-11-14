// The APNs HTTP/2 client (CONTRACTS D-P6-2). One connection, reused; reopened after an error
// or a close, closed after a minute without use. Never log a token or a payload.

import http2 from "node:http2";
import { config } from "@lectern/config";

export const APNS_PRODUCTION = "https://api.push.apple.com";
export const APNS_SANDBOX = "https://api.sandbox.push.apple.com";
const REQUEST_TIMEOUT_MS = 10_000;
const IDLE_CLOSE_MS = 60_000;

export interface ApnsResult {
  status: number;
  reason: string | null;
  apnsId: string | null;
}

export interface ApnsSend {
  token: string;
  topic: string;
  pushType: "liveactivity" | "alert";
  priority: 5 | 10;
  expiration: number;
  payload: object;
  providerToken: string;
}

export interface ApnsClient {
  send(p: ApnsSend): Promise<ApnsResult>;
  close(): void;
}

/** Only called when APNs is on and configured (notify.ts checks apnsAuth() first). */
export function createApnsClient(origin?: string): ApnsClient {
  const target = origin ?? (config().apns.env === "production" ? APNS_PRODUCTION : APNS_SANDBOX);
  let session: http2.ClientHttp2Session | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const drop = () => {
    if (idle) clearTimeout(idle);
    idle = null;
    const s = session;
    session = null;
    if (s && !s.closed && !s.destroyed) s.close();
  };

  const open = (): http2.ClientHttp2Session => {
    if (session && !session.closed && !session.destroyed) return session;
    const s = http2.connect(target);
    s.on("error", () => {
      if (session === s) session = null;
    });
    s.on("close", () => {
      if (session === s) session = null;
    });
    s.unref?.();
    session = s;
    return s;
  };

  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(drop, IDLE_CLOSE_MS);
    idle.unref?.();
  };

  return {
    send(p) {
      return new Promise<ApnsResult>((resolve) => {
        let settled = false;
        const finish = (result: ApnsResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          touch();
          resolve(result);
        };
        const timer = setTimeout(() => {
          finish({ status: 0, reason: "timeout", apnsId: null });
          drop();
        }, REQUEST_TIMEOUT_MS);
        timer.unref?.();
        let s: http2.ClientHttp2Session;
        try {
          s = open();
        } catch {
          finish({ status: 0, reason: "connect_failed", apnsId: null });
          return;
        }
        const body = JSON.stringify(p.payload);
        let req: http2.ClientHttp2Stream;
        try {
          req = s.request({
            ":method": "POST",
            ":path": `/3/device/${p.token}`,
            authorization: `bearer ${p.providerToken}`,
            "apns-topic": p.topic,
            "apns-push-type": p.pushType,
            "apns-priority": String(p.priority),
            "apns-expiration": String(p.expiration),
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          });
        } catch {
          drop();
          finish({ status: 0, reason: "connect_failed", apnsId: null });
          return;
        }
        let status = 0;
        let apnsId: string | null = null;
        let text = "";
        req.setEncoding("utf8");
        req.on("response", (headers) => {
          status = Number(headers[":status"] ?? 0);
          const id = headers["apns-id"];
          apnsId = typeof id === "string" ? id : null;
        });
        req.on("data", (chunk: string) => {
          if (text.length < 4096) text += chunk;
        });
        req.on("end", () => {
          let reason: string | null = null;
          if (text) {
            try {
              const parsed = JSON.parse(text) as { reason?: unknown };
              reason = typeof parsed.reason === "string" ? parsed.reason : null;
            } catch {
              reason = null;
            }
          }
          finish({ status, reason, apnsId });
        });
        req.on("error", () => {
          drop();
          finish({ status: 0, reason: "stream_error", apnsId: null });
        });
        req.end(body);
      });
    },
    close: drop,
  };
}
