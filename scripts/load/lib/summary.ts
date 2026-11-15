// The JSON summary every load script prints, and the small argument parser they share.

import { writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import type { UploadOutcome } from "./client.ts";

export interface LoadSummary {
  scenario: "uploads" | "long-recording" | "disk-full";
  started_at: string;
  duration_ms: number;
  host: { platform: string; arch: string; cpus: number; total_mem_bytes: number };
  server: { mode: string; processing: string; max_rss_bytes: number; alive_at_end: boolean };
  uploads: UploadOutcome[];
  processing: Array<{ recording_id: string; status: string; ms: number }>;
  failures: string[];
  ok: boolean;
  notes: string[];
}

export function hostInfo(): LoadSummary["host"] {
  return { platform: platform(), arch: arch(), cpus: cpus().length, total_mem_bytes: totalmem() };
}

/** Nearest-rank percentile; 0 for no values. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

const PROCESSING_DONE_BAD = new Set(["failed", "timeout", "canceled"]);

/**
 * The common ok rule: every upload succeeded, the server is still up and, when processing ran,
 * no recording failed, timed out or was canceled.
 */
export function uploadsOk(summary: Pick<LoadSummary, "uploads" | "processing" | "server">): boolean {
  if (summary.uploads.some((u) => !u.ok)) return false;
  if (!summary.server.alive_at_end) return false;
  if (summary.server.processing === "on" && summary.processing.some((p) => PROCESSING_DONE_BAD.has(p.status))) return false;
  return true;
}

export class ArgsError extends Error {}

type ArgSpec = Record<string, { default: string | number | boolean }>;

/** `--name value` and `--flag` against `spec`; throws ArgsError on an unknown name or a bad number. */
export function parseArgsOrThrow(argv: string[], spec: ArgSpec): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, { default: value }] of Object.entries(spec)) out[name] = value;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new ArgsError(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const entry = spec[name];
    if (!entry) throw new ArgsError(`unknown option: ${arg}`);
    if (typeof entry.default === "boolean") {
      out[name] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new ArgsError(`${arg} needs a value`);
    if (typeof entry.default === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new ArgsError(`${arg} must be a positive number`);
      out[name] = n;
    } else {
      out[name] = value;
    }
  }
  return out;
}

function usage(spec: ArgSpec): string {
  return Object.entries(spec)
    .map(([name, { default: value }]) => (typeof value === "boolean" ? `[--${name}]` : `[--${name} ${value === "" ? "<value>" : value}]`))
    .join(" ");
}

/** parseArgsOrThrow, or the usage on stderr and exit code 2. */
export function parseArgs(argv: string[], spec: ArgSpec): Record<string, string | number | boolean> {
  try {
    return parseArgsOrThrow(argv, spec);
  } catch (err) {
    if (!(err instanceof ArgsError)) throw err;
    process.stderr.write(`${err.message}\nusage: ${usage(spec)}\n`);
    process.exit(2);
  }
}

/** Prints the summary as JSON on stdout, writes `outPath` when given; exit 0 when ok, else 1. */
export function finish(summary: LoadSummary, outPath?: string): never {
  const json = JSON.stringify(summary, null, 2);
  process.stdout.write(`${json}\n`);
  if (outPath) writeFileSync(outPath, `${json}\n`);
  process.exit(summary.ok ? 0 : 1);
}

/** Progress lines go to stderr (stdout is the JSON summary). */
export function progress(message: string): void {
  process.stderr.write(`load: ${message}\n`);
}
