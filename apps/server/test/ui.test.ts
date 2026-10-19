import { describe, expect, test } from "bun:test";
import type { LectureRecord } from "../src/db.ts";
import { PAGE_SCRIPTS, renderAdminPageHtml, renderAppHtml, renderSharePageHtml } from "../src/ui.ts";

const SHARE_FIXTURE: LectureRecord = {
  id: "lec_fixture",
  owner_id: "usr_fixture",
  share_token: "shr_fixture",
  is_public: 1,
  title: "공유 테스트 강의",
  course: "정보보호개론",
  date_label: "2026-10-19",
  status: "done",
  stage: "done",
  stage_message: "",
  progress: 100,
  markdown: "# 제목\n\n[01:30] 대칭키 암호",
  excerpt: "",
  audio_path: "/tmp/fixture.m4a",
  audio_mime: "audio/mp4",
  audio_size: 1,
  duration_sec: 90,
  model_requested: "",
  model_used: "",
  source_client: "bun-test",
  error_message: null,
  md_source_path: null,
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
};

const PAGES = {
  share: renderSharePageHtml(SHARE_FIXTURE),
  app: renderAppHtml(),
  admin: renderAdminPageHtml(),
};

// The source of every <script src> on a page, looked up in the table index.ts serves.
function pageScripts(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => {
    const src = m[1]?.match(/\ssrc="\/assets\/([^"?]+)\?v=([0-9a-f]+)"/);
    if (!src) throw new Error(`script tag without a /assets/ src: ${m[0]}`);
    const script = PAGE_SCRIPTS.get(src[1]!);
    if (!script) throw new Error(`no page script named ${src[1]}`);
    expect(src[2]).toBe(script.hash);
    return script.body;
  });
}

function extractClientFunction(code: string, name: string): (...args: any[]) => any {
  const match = code.match(new RegExp(`function ${name}\\(s\\) \\{[\\s\\S]*?\\n    \\}`));
  if (!match) throw new Error(`client function ${name} not found`);
  return new Function(`${match[0]}; return ${name};`)();
}

describe("@lectern/server web UI client script", () => {
  const appHtml = PAGES.app;
  const adminHtml = PAGES.admin;
  const appScript = pageScripts(appHtml).join("\n");
  const adminScript = pageScripts(adminHtml).join("\n");

  test("client scripts survive template-literal escaping and parse as JavaScript", () => {
    expect(PAGE_SCRIPTS.size).toBe(3);
    for (const [name, html] of Object.entries(PAGES)) {
      const scripts = pageScripts(html);
      expect(scripts.length, name).toBe(1);
      for (const code of scripts) {
        expect(() => new Function(code)).not.toThrow();
      }
    }
  });

  test("pages run under script-src 'self': no inline scripts or on* handler attributes", () => {
    for (const [name, html] of Object.entries(PAGES)) {
      expect(html.match(/<script(?![^>]*\ssrc=)[^>]*>/g), name).toBeNull();
      expect(html.match(/\son[a-z]+\s*=/gi), name).toBeNull();
      expect(html, name).not.toContain("javascript:");
      // Markup built at runtime (innerHTML strings) must not bring handlers back either.
      for (const code of pageScripts(html)) {
        expect(code.match(/\son[a-z]+=["'\\]/gi), name).toBeNull();
      }
    }
  });

  test("every data-action and wired element id on a page has a matching handler", () => {
    for (const [name, html] of Object.entries(PAGES)) {
      const code = pageScripts(html).join("\n");
      const actionTable = code.match(/const CLICK_ACTIONS = \{([\s\S]*?)\n    \};/)?.[1] ?? "";
      const handled = new Set([...actionTable.matchAll(/^\s*'([a-z-]+)':/gm)].map((m) => m[1]));
      const used = new Set(
        [...(html + code).matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1])
      );
      for (const action of used) {
        expect(handled.has(action), `${name}: data-action="${action}"`).toBe(true);
      }
      for (const m of code.matchAll(/getElementById\('([\w-]+)'\)\??\.addEventListener/g)) {
        expect(html, `${name}: #${m[1]}`).toContain(`id="${m[1]}"`);
      }
    }
    expect(PAGES.share).toContain('class="ts-chip" data-sec="90"');
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
