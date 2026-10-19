import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promoteStagedWebBuild } from "../src/web-build.ts";

const SHA = "a".repeat(40);

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "lectern-web-build-"));
  const staged = join(root, "dist.next");
  const live = join(root, "dist");
  const write = (dir: string, body: string, sha?: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), body);
    if (sha) writeFileSync(join(dir, ".release-sha"), sha);
  };
  return { root, staged, live, write };
}

describe("release web build", () => {
  test("a build staged for this release replaces the live one at boot", () => {
    const d = dirs();
    try {
      d.write(d.live, "old");
      d.write(d.staged, "new", SHA);
      expect(promoteStagedWebBuild(SHA, d)).toBe("promoted");
      expect(readFileSync(join(d.live, "index.html"), "utf8")).toBe("new");
      expect(existsSync(d.staged)).toBe(false);
      expect(existsSync(`${d.live}.prev`)).toBe(false);
      expect(promoteStagedWebBuild(SHA, d)).toBe("none");
    } finally {
      rmSync(d.root, { recursive: true, force: true });
    }
  });

  test("a build staged for another release is discarded, never promoted", () => {
    const d = dirs();
    try {
      d.write(d.live, "old");
      d.write(d.staged, "from a failed deploy", "b".repeat(40));
      expect(promoteStagedWebBuild(SHA, d)).toBe("stale");
      expect(existsSync(d.staged)).toBe(false);
      expect(readFileSync(join(d.live, "index.html"), "utf8")).toBe("old");

      d.write(d.staged, "no stamp");
      expect(promoteStagedWebBuild(SHA, d)).toBe("stale");
      expect(readFileSync(join(d.live, "index.html"), "utf8")).toBe("old");
    } finally {
      rmSync(d.root, { recursive: true, force: true });
    }
  });

  test("the first promotion works without a live build", () => {
    const d = dirs();
    try {
      d.write(d.staged, "first", SHA);
      expect(promoteStagedWebBuild(SHA, d)).toBe("promoted");
      expect(readFileSync(join(d.live, "index.html"), "utf8")).toBe("first");
    } finally {
      rmSync(d.root, { recursive: true, force: true });
    }
  });

  test(
    "staging builds the production web app with the release stamp",
    async () => {
      // In its own process, like the deploy preflight (Bun.build inside the test runner
      // cannot resolve the app's relative imports).
      const d = dirs();
      try {
        const proc = Bun.spawn(
          [
            process.execPath,
            "-e",
            `const { stageWebBuild } = await import(${JSON.stringify(join(import.meta.dir, "../src/web-build.ts"))});
             if (!(await stageWebBuild(${JSON.stringify(SHA)}, ${JSON.stringify(d.staged)}))) process.exit(3);`,
          ],
          { stdout: "ignore", stderr: "pipe" }
        );
        const code = await proc.exited;
        if (code !== 0) throw new Error(await new Response(proc.stderr).text());
        expect(readFileSync(join(d.staged, ".release-sha"), "utf8")).toBe(SHA);
        const html = readFileSync(join(d.staged, "index.html"), "utf8");
        expect(html).toContain("/app/assets/");
        expect(html).not.toMatch(/<script>[^<]/); // CSP: no inline script bodies
      } finally {
        rmSync(d.root, { recursive: true, force: true });
      }
    },
    60_000
  );
});
