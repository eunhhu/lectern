// Structured logs: one JSON object per line in production (journald → `journalctl -u
// lectern -o cat | jq`), a readable line with LECTERN_LOG_FORMAT=pretty. Callers pass
// already-redacted values; never log tokens, cookies or request bodies.

import { config } from "@lectern/config";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

function serializeError(err: unknown): unknown {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const clean: LogFields = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = k === "err" ? serializeError(v) : v;
  const write = level === "warn" || level === "error" ? console.error : console.log;
  if (config().logFormat === "pretty") {
    const extra = Object.entries(clean)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    write(`${level.toUpperCase().padEnd(5)} ${msg}${extra ? ` ${extra}` : ""}`);
    return;
  }
  write(JSON.stringify({ level, ts: new Date().toISOString(), msg, ...clean }));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => log("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => log("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => log("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => log("error", msg, fields),
};
