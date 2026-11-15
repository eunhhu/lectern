// The @lectern/pdf skeleton (P3-C): the marker export, exact dependency versions, and the
// same pdfjs-dist version as the web viewer so worker and API match.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDF_PACKAGE } from "../src/index.ts";

const ROOT = join(import.meta.dir, "../../..");
const pkg = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, Record<string, string>>;

describe("@lectern/pdf", () => {
  test("exports marker", () => {
    expect(PDF_PACKAGE).toBe("@lectern/pdf");
  });

  test("versions are pinned", () => {
    const own = pkg("packages/pdf/package.json");
    expect(own.dependencies!["pdfjs-dist"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(own.devDependencies!["pdf-lib"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("web uses same pdfjs version", () => {
    expect(pkg("apps/web/package.json").dependencies!["pdfjs-dist"]).toBe(pkg("packages/pdf/package.json").dependencies!["pdfjs-dist"]);
  });
});
