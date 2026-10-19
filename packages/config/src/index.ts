// Every environment variable the server and worker read, validated once at boot.
//
// - `loadConfig()` parses the environment with zod and throws a ConfigError that lists
//   every invalid variable, so a bad deploy fails in the CD preflight instead of at the
//   first request that touches the value.
// - Secrets (API keys, the deploy token) are deliberately not frozen into the snapshot:
//   `readSecret()` reads them when used, so a rotated key in the environment is picked up
//   by a restart-free code path and tests can set them per case.
// - `describeEnv()` renders the reference table in docs (`bun run config:docs`).

import { join, resolve } from "node:path";
import { z } from "zod";

/** Repository root: packages/config/src → ../../.. */
export const REPO_ROOT = resolve(join(import.meta.dir, "../../.."));

const int = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const bool = (fallback: boolean) =>
  z
    .enum(["0", "1", "true", "false"])
    .default(fallback ? "1" : "0")
    .transform((v) => v === "1" || v === "true");
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

interface EnvSpec {
  schema: z.ZodType;
  description: string;
  secret?: boolean;
}

/** Name → schema + description. The single list of variables Lectern understands. */
const ENV = {
  PORT: { schema: int(1, 65535, 18775), description: "HTTP port (binds 127.0.0.1)" },
  LECTERN_BASE_URL: {
    schema: z.url().default("https://lectern.qucord.com"),
    description: "Public origin; an http:// value drops the cookie Secure flag (local dev)",
  },
  LECTERN_DATA_DIR: {
    schema: optionalString,
    description: "SQLite DB, uploads, trash and backups (default: <repo>/data)",
  },
  LECTERN_LECTURES_DIR: {
    schema: optionalString,
    description: "Owner's Markdown/audio archive synced into the library (default: <repo>/lectures)",
  },
  LECTERN_REPO_DIR: {
    schema: optionalString,
    description: "Checkout the CD webhook resets to origin/main; deploys are refused without one",
  },
  LECTERN_WORKER_MODE: {
    schema: z.enum(["embedded", "external"]).default("embedded"),
    description:
      "embedded: the API process also runs the job worker (until lectern-worker.service is installed); external: only apps/worker runs jobs",
  },
  LECTERN_TRUSTED_PROXY_HOPS: {
    schema: int(0, 10, 1),
    description: "Reverse proxies in front of the server (X-Forwarded-For hops to trust)",
  },
  LECTERN_LOG_REQUESTS: { schema: bool(true), description: "Write one log line per request" },
  LECTERN_LOG_FORMAT: {
    schema: z.enum(["json", "pretty"]).default("json"),
    description: "json for journald/production, pretty for local development",
  },
  LECTERN_SHUTDOWN_GRACE_SEC: {
    schema: int(0, 600, 20),
    description: "Seconds running jobs get to finish on SIGTERM / deploy",
  },
  LECTERN_MAX_CONCURRENT_JOBS: { schema: int(1, 16, 2), description: "Concurrent distillations" },
  LECTERN_JOB_LEASE_TTL_MS: {
    schema: int(1_000, 3_600_000, 60_000),
    description: "How long a worker's claim on a job lasts without a heartbeat before others reclaim it",
  },
  LECTERN_JOB_POLL_MS: { schema: int(50, 60_000, 1_000), description: "Worker poll interval for new jobs" },
  LECTERN_MAX_CONCURRENT_COMPACT: { schema: int(1, 8, 1), description: "Concurrent audio compactions" },
  LECTERN_MAINTENANCE_INTERVAL_MIN: {
    schema: int(5, 1440, 60),
    description: "Maintenance cadence (expired rows, trash, retention, backups, WAL)",
  },
  LECTERN_BACKUP_KEEP: { schema: int(1, 365, 7), description: "Database backups kept" },
  LECTERN_BACKUP_INTERVAL_HOURS: { schema: int(1, 720, 24), description: "Hours between backups" },
  LECTERN_TRASH_DAYS: { schema: int(1, 365, 7), description: "Days before trashed uploads are deleted" },
  LECTERN_GEMINI_MODEL: {
    schema: z.string().trim().default("gemini-3.8-flash"),
    description: "Pinned Gemini model id (never a -latest alias)",
  },
  LECTERN_GEMINI_ALLOWED_MODELS: {
    schema: optionalString,
    description: "Comma-separated extra model ids requests may select",
  },
  LECTERN_GEMINI_TIMEOUT_MS: {
    schema: int(60_000, 3_600_000, 900_000),
    description: "Deadline for one generateContent call",
  },
  LECTERN_OWNER_EMAIL: { schema: optionalString, description: "Bootstrap owner account email" },
  LECTERN_OWNER_NAME: { schema: optionalString, description: "Bootstrap owner display name" },
  LECTERN_OWNER_ALIASES: {
    schema: optionalString,
    description: "Comma-separated login ids that resolve to the owner email",
  },
  LECTERN_OWNER_PASSWORD: {
    schema: optionalString,
    description: "Initial owner password (only used when the owner account is created)",
    secret: true,
  },
  LECTERN_FORCE_RESET_OWNER_PASSWORD: {
    schema: bool(false),
    description: "1: reset the owner password to LECTERN_OWNER_PASSWORD at boot",
  },
  LECTERN_OWNER_API_TOKEN: { schema: optionalString, description: "Fixed owner API token", secret: true },
  LECTERN_DEPLOY_TOKEN: { schema: optionalString, description: "CD webhook secret", secret: true },
  GEMINI_API_KEY: { schema: optionalString, description: "Gemini API key (paid tier)", secret: true },
  RESEND_API_KEY: { schema: optionalString, description: "Resend email API key", secret: true },
  RESEND_FROM_EMAIL: {
    schema: z.string().trim().default("Lectern <noreply@qucord.com>"),
    description: "From address for verification and reminder email",
  },
  LECTERN_RESEND_CREDENTIALS_FILE: {
    schema: optionalString,
    description: "JSON file with resend.api_key, used when RESEND_API_KEY is unset",
  },
} satisfies Record<string, EnvSpec>;

export type EnvName = keyof typeof ENV;
type Parsed = { [K in EnvName]: z.output<(typeof ENV)[K]["schema"]> };

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
  }
}

export interface Config {
  port: number;
  baseUrl: string;
  dataDir: string;
  lecturesDir: string;
  /** Explicit deploy checkout; null means "use the legacy production path if present". */
  repoDir: string | null;
  workerMode: "embedded" | "external";
  trustedProxyHops: number;
  logRequests: boolean;
  logFormat: "json" | "pretty";
  shutdownGraceMs: number;
  maxConcurrentJobs: number;
  maxConcurrentCompact: number;
  jobLeaseTtlMs: number;
  jobPollMs: number;
  maintenanceIntervalMin: number;
  backupKeep: number;
  backupIntervalHours: number;
  trashDays: number;
  gemini: { model: string; allowedModels: string[]; timeoutMs: number };
  owner: {
    email: string | null;
    name: string | null;
    aliases: string[];
    forceResetPassword: boolean;
  };
  resend: { fromEmail: string; credentialsFile: string | null };
  /** Full parsed values, for diagnostics (secrets redacted). */
  raw: Record<string, unknown>;
}

const list = (v: string | undefined) =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Validates `env` (default: process.env) and returns the typed configuration. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const issues: string[] = [];
  const parsed = {} as Record<string, unknown>;
  for (const [name, spec] of Object.entries(ENV) as Array<[EnvName, EnvSpec]>) {
    const value = env[name];
    // An empty variable (common in .env files and systemd units) means "unset".
    const result = spec.schema.safeParse(
      value === undefined || value.trim() === "" ? undefined : value
    );
    if (result.success) {
      parsed[name] = result.data;
    } else {
      const reason = result.error.issues.map((i) => i.message).join("; ");
      issues.push(`${name}: ${reason}${spec.secret ? "" : ` (got ${JSON.stringify(value)})`}`);
    }
  }
  if (issues.length) throw new ConfigError(issues);
  const p = parsed as Parsed;

  return {
    port: p.PORT,
    baseUrl: p.LECTERN_BASE_URL,
    dataDir: resolve(p.LECTERN_DATA_DIR ?? join(REPO_ROOT, "data")),
    lecturesDir: resolve(p.LECTERN_LECTURES_DIR ?? join(REPO_ROOT, "lectures")),
    repoDir: p.LECTERN_REPO_DIR ? resolve(p.LECTERN_REPO_DIR) : null,
    workerMode: p.LECTERN_WORKER_MODE,
    trustedProxyHops: p.LECTERN_TRUSTED_PROXY_HOPS,
    logRequests: p.LECTERN_LOG_REQUESTS,
    logFormat: p.LECTERN_LOG_FORMAT,
    shutdownGraceMs: p.LECTERN_SHUTDOWN_GRACE_SEC * 1000,
    maxConcurrentJobs: p.LECTERN_MAX_CONCURRENT_JOBS,
    maxConcurrentCompact: p.LECTERN_MAX_CONCURRENT_COMPACT,
    jobLeaseTtlMs: p.LECTERN_JOB_LEASE_TTL_MS,
    jobPollMs: p.LECTERN_JOB_POLL_MS,
    maintenanceIntervalMin: p.LECTERN_MAINTENANCE_INTERVAL_MIN,
    backupKeep: p.LECTERN_BACKUP_KEEP,
    backupIntervalHours: p.LECTERN_BACKUP_INTERVAL_HOURS,
    trashDays: p.LECTERN_TRASH_DAYS,
    gemini: {
      model: p.LECTERN_GEMINI_MODEL,
      allowedModels: list(p.LECTERN_GEMINI_ALLOWED_MODELS),
      timeoutMs: p.LECTERN_GEMINI_TIMEOUT_MS,
    },
    owner: {
      email: p.LECTERN_OWNER_EMAIL?.toLowerCase() ?? null,
      name: p.LECTERN_OWNER_NAME ?? null,
      aliases: list(p.LECTERN_OWNER_ALIASES).map((a) => a.toLowerCase()),
      forceResetPassword: p.LECTERN_FORCE_RESET_OWNER_PASSWORD,
    },
    resend: {
      fromEmail: p.RESEND_FROM_EMAIL,
      credentialsFile: p.LECTERN_RESEND_CREDENTIALS_FILE ?? null,
    },
    raw: Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, (ENV as Record<string, EnvSpec>)[k].secret && v ? "***" : v])
    ),
  };
}

/** Reads a secret at the moment it is needed (never cached). Empty strings count as unset. */
export function readSecret(
  name: "GEMINI_API_KEY" | "RESEND_API_KEY" | "LECTERN_DEPLOY_TOKEN" | "LECTERN_OWNER_PASSWORD" | "LECTERN_OWNER_API_TOKEN"
): string | undefined {
  const v = (process.env[name] || "").trim();
  return v || undefined;
}

/** Markdown reference table of every variable (secrets marked). */
export function describeEnv(): string {
  const rows = Object.entries(ENV as Record<string, EnvSpec>).map(([name, spec]) => {
    const def = spec.schema.safeParse(undefined);
    const shown = def.success && def.data !== undefined ? `\`${String(def.data)}\`` : "—";
    return `| \`${name}\` | ${shown} | ${spec.secret ? "secret" : ""} | ${spec.description} |`;
  });
  return ["| Variable | Default | | Description |", "|---|---|---|---|", ...rows].join("\n");
}

let cached: Config | null = null;

/** The process-wide configuration, loaded on first use. */
export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Tests only: forget the cached configuration so the next config() re-reads process.env. */
export function resetConfigForTests(): void {
  cached = null;
}
