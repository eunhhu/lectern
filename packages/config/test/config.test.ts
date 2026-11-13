import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigError, REPO_ROOT, describeEnv, loadConfig } from "../src/index.ts";

describe("@lectern/config", () => {
  test("defaults resolve against the repository, never a hard-coded home directory", () => {
    const c = loadConfig({});
    expect(c.port).toBe(18775);
    expect(c.dataDir).toBe(join(REPO_ROOT, "data"));
    expect(c.lecturesDir).toBe(join(REPO_ROOT, "lectures"));
    expect(c.repoDir).toBeNull();
    expect(c.workerMode).toBe("embedded");
    expect(c.distillEngine).toBe("legacy");
    expect(c.transcriptEngine).toBe("off");
    expect(c.ask).toEqual({ enabled: false, monthlyLimitMicrousd: 2_000_000 });
    expect(c.gemini.model).toBe("gemini-3.8-flash");
    expect(c.logRequests).toBe(true);
    expect(JSON.stringify(c)).not.toContain("/home/eunhhu");
  });

  test("values are coerced, empty strings mean unset, and lists are split", () => {
    const c = loadConfig({
      PORT: "8080",
      LECTERN_DATA_DIR: "/srv/lectern/data",
      LECTERN_LECTURES_DIR: "",
      LECTERN_LOG_REQUESTS: "0",
      LECTERN_WORKER_MODE: "external",
      LECTERN_DISTILL_ENGINE: "harness",
      LECTERN_TRANSCRIPT_ENGINE: "shadow",
      LECTERN_ASK: "1",
      LECTERN_ASK_MONTHLY_LIMIT_MICROUSD: "500000",
      LECTERN_OWNER_ALIASES: "Sunwoo, admin ,",
      LECTERN_GEMINI_ALLOWED_MODELS: "gemini-x, gemini-y",
      LECTERN_SHUTDOWN_GRACE_SEC: "5",
    });
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe("/srv/lectern/data");
    expect(c.lecturesDir).toBe(join(REPO_ROOT, "lectures"));
    expect(c.logRequests).toBe(false);
    expect(c.workerMode).toBe("external");
    expect(c.distillEngine).toBe("harness");
    expect(c.transcriptEngine).toBe("shadow");
    expect(c.ask).toEqual({ enabled: true, monthlyLimitMicrousd: 500_000 });
    expect(c.owner.aliases).toEqual(["sunwoo", "admin"]);
    expect(c.gemini.allowedModels).toEqual(["gemini-x", "gemini-y"]);
    expect(c.shutdownGraceMs).toBe(5000);
  });

  test("every invalid variable is reported at once, without echoing secrets", () => {
    let err: unknown;
    try {
      loadConfig({
        PORT: "99999",
        LECTERN_WORKER_MODE: "sometimes",
        LECTERN_BASE_URL: "not a url",
        LECTERN_TRANSCRIPT_ENGINE: "yes",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const issues = (err as ConfigError).issues.join("\n");
    expect(issues).toContain("PORT");
    expect(issues).toContain("LECTERN_WORKER_MODE");
    expect(issues).toContain("LECTERN_BASE_URL");
    expect(issues).toContain("LECTERN_TRANSCRIPT_ENGINE");
    const raw = loadConfig({ GEMINI_API_KEY: "AIza-secret-value" }).raw;
    expect(JSON.stringify(raw)).not.toContain("AIza-secret-value");
  });

  test("pipeline defaults to v1", () => {
    expect(loadConfig({}).pipeline).toBe("v1");
  });

  test("pipeline accepts v2", () => {
    expect(loadConfig({ LECTERN_PIPELINE: "v2" }).pipeline).toBe("v2");
  });

  test("pipeline rejects other values", () => {
    let err: unknown;
    try {
      loadConfig({ LECTERN_PIPELINE: "v3" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).issues.join("\n")).toContain("LECTERN_PIPELINE");
  });

  test("empty pipeline means default", () => {
    expect(loadConfig({ LECTERN_PIPELINE: "" }).pipeline).toBe("v1");
  });

  test("policy page values: an email address and a real YYYY-MM-DD date, or unset", () => {
    expect(loadConfig({}).legal).toEqual({ contactEmail: null, officerName: null, effectiveDate: null });
    expect(
      loadConfig({
        LECTERN_LEGAL_CONTACT_EMAIL: " privacy@example.com ",
        LECTERN_LEGAL_OFFICER_NAME: "홍길동",
        LECTERN_LEGAL_EFFECTIVE_DATE: "2026-10-26",
      }).legal
    ).toEqual({ contactEmail: "privacy@example.com", officerName: "홍길동", effectiveDate: "2026-10-26" });
    let err: unknown;
    try {
      loadConfig({ LECTERN_LEGAL_CONTACT_EMAIL: "not-an-email", LECTERN_LEGAL_EFFECTIVE_DATE: "2026-02-30" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const issues = (err as ConfigError).issues.join("\n");
    expect(issues).toContain("LECTERN_LEGAL_CONTACT_EMAIL");
    expect(issues).toContain("LECTERN_LEGAL_EFFECTIVE_DATE");
  });

  test("the reference table lists every variable", () => {
    const table = describeEnv();
    for (const name of ["PORT", "LECTERN_DATA_DIR", "LECTERN_WORKER_MODE", "GEMINI_API_KEY", "LECTERN_DEPLOY_TOKEN"]) {
      expect(table).toContain(`\`${name}\``);
    }
  });
});

test("docs/env.md is up to date with the schema", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = readFileSync(join(REPO_ROOT, "docs/env.md"), "utf8");
  expect(doc).toContain(describeEnv());
});
