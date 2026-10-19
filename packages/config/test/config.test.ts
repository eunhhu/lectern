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
      LECTERN_OWNER_ALIASES: "Sunwoo, admin ,",
      LECTERN_GEMINI_ALLOWED_MODELS: "gemini-x, gemini-y",
      LECTERN_SHUTDOWN_GRACE_SEC: "5",
    });
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe("/srv/lectern/data");
    expect(c.lecturesDir).toBe(join(REPO_ROOT, "lectures"));
    expect(c.logRequests).toBe(false);
    expect(c.workerMode).toBe("external");
    expect(c.owner.aliases).toEqual(["sunwoo", "admin"]);
    expect(c.gemini.allowedModels).toEqual(["gemini-x", "gemini-y"]);
    expect(c.shutdownGraceMs).toBe(5000);
  });

  test("every invalid variable is reported at once, without echoing secrets", () => {
    let err: unknown;
    try {
      loadConfig({ PORT: "99999", LECTERN_WORKER_MODE: "sometimes", LECTERN_BASE_URL: "not a url" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const issues = (err as ConfigError).issues.join("\n");
    expect(issues).toContain("PORT");
    expect(issues).toContain("LECTERN_WORKER_MODE");
    expect(issues).toContain("LECTERN_BASE_URL");
    const raw = loadConfig({ GEMINI_API_KEY: "AIza-secret-value" }).raw;
    expect(JSON.stringify(raw)).not.toContain("AIza-secret-value");
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
