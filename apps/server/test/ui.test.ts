import { describe, expect, test } from "bun:test";
import { renderAdminPageHtml, renderAppHtml } from "../src/ui.ts";

function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
}

function extractClientFunction(code: string, name: string): (...args: any[]) => any {
  const match = code.match(new RegExp(`function ${name}\\(s\\) \\{[\\s\\S]*?\\n    \\}`));
  if (!match) throw new Error(`client function ${name} not found`);
  return new Function(`${match[0]}; return ${name};`)();
}

describe("@lectern/server web UI client script", () => {
  const appHtml = renderAppHtml();
  const adminHtml = renderAdminPageHtml();
  const appScript = inlineScripts(appHtml).join("\n");
  const adminScript = inlineScripts(adminHtml).join("\n");

  test("inline client scripts survive template-literal escaping and parse as JavaScript", () => {
    for (const code of [...inlineScripts(appHtml), ...inlineScripts(adminHtml)]) {
      expect(() => new Function(code)).not.toThrow();
    }
  });

  test("HTML escapers used for attribute interpolation escape both quote characters", () => {
    const payload = `x" autofocus onfocus="alert(1)//' <b>&`;
    const expected = "x&quot; autofocus onfocus=&quot;alert(1)//&#39; &lt;b&gt;&amp;";
    expect(extractClientFunction(appScript, "escapeClientHtml")(payload)).toBe(expected);
    expect(extractClientFunction(adminScript, "esc")(payload)).toBe(expected);
  });

  test("user and record data is bound through data attributes, not inline onclick handlers", () => {
    expect(appScript).toContain("data-course=");
    expect(appScript).toContain("data-lecture-id=");
    expect(appScript).toContain("data-vault-action=");
    for (const handler of [
      "setCourseFilter(",
      "selectLecture(",
      "retrySingleVaultUpload(",
      "downloadVaultItem(",
      "removePendingUploadFromVault(",
    ]) {
      expect(appHtml).not.toContain(`onclick="${handler}\\'`);
    }
    expect(appHtml).not.toContain(`onclick="document.getElementById(\\'rec-course\\')`);
    expect(adminScript).toContain('data-action="approve-user"');
    expect(adminHtml).not.toContain(`onclick="quickApproveUser(\\'`);
    expect(adminHtml).not.toContain(`onclick="openEditUserModal(\\'`);
    expect(adminHtml).not.toContain(`onclick="adminRetryLecture(\\'`);
  });

  test("session token is never stored in localStorage or put in same-origin URLs", () => {
    for (const code of [appScript, adminScript]) {
      expect(code).not.toContain("localStorage.setItem('lectern_token'");
      expect(code).not.toContain("localStorage.getItem('lectern_token'");
      expect(code).not.toContain("'?token='");
    }
  });

  test("device integration curl snippet keeps its shell line continuations", () => {
    const expr = appScript.match(/curlEl\.textContent = (.*);/)?.[1];
    expect(expr).toBeDefined();
    const snippet: string = new Function("user", `return ${expr};`)({ apiToken: "lct_test" });
    const lines = snippet.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).every((line) => line.endsWith(" \\"))).toBe(true);
    expect(lines[1]).toContain('X-Lectern-Token: lct_test');
  });
});
