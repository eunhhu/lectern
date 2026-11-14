import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { handleRequest } from "../src/index.ts";
import { LEGAL_FALLBACKS, LEGAL_PAGES, renderLegalTemplate } from "../src/legal.ts";

const template = (page: string) =>
  readFileSync(join(import.meta.dir, `../static/legal/${page}.html`), "utf8");

const SET = { contactEmail: "privacy@example.com", officerName: "홍길동", effectiveDate: "2026-10-26" };
const UNSET = { contactEmail: null, officerName: null, effectiveDate: null };

describe("policy pages", () => {
  test("the templates only use slots the renderer knows", () => {
    for (const page of LEGAL_PAGES) {
      const slots = [...template(page).matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) expect(Object.keys(LEGAL_FALLBACKS)).toContain(slot);
    }
  });

  test("configured values fill every slot, with a mailto link and a Korean date", () => {
    for (const page of LEGAL_PAGES) {
      const { html, missing } = renderLegalTemplate(template(page), SET);
      expect(missing).toEqual([]);
      expect(html).not.toContain("{{");
      expect(html).toContain('<a href="mailto:privacy@example.com">privacy@example.com</a>');
      expect(html).toContain("2026년 10월 26일");
    }
    expect(renderLegalTemplate(template("privacy"), SET).html).toContain("개인정보 보호책임자: 홍길동");
  });

  test("privacy page covers calendar and reminders", () => {
    const html = template("privacy");
    expect(html).toContain("캘린더 구독 주소(ICS)는 이용자만 아는 비밀 주소입니다");
    expect(html).toContain("일정·할 일 알림");
    expect(html).toContain("이메일 알림 기록");
    expect(html).toContain("<td>발송 후 90일, 또는 계정을 삭제할 때까지</td>");
    expect(html).toContain("주소 원문은 저장하지 않습니다");
  });

  test("unset values read as neutral text, never a raw slot or an empty mailto link", () => {
    for (const page of LEGAL_PAGES) {
      const { html, missing } = renderLegalTemplate(template(page), UNSET);
      expect(html).not.toContain("{{");
      expect(html).not.toContain('href="mailto:');
      expect(html).toContain(LEGAL_FALLBACKS.CONTACT_EMAIL);
      expect(html).toContain(LEGAL_FALLBACKS.EFFECTIVE_DATE);
      expect(missing).toContain("CONTACT_EMAIL");
      expect(missing).toContain("EFFECTIVE_DATE");
    }
    expect(renderLegalTemplate(template("terms"), UNSET).html).toContain(
      `이 약관은 ${LEGAL_FALLBACKS.EFFECTIVE_DATE}부터 시행합니다.`
    );
  });

  test("values are escaped and unknown slots are dropped", () => {
    const { html, missing } = renderLegalTemplate("<p>{{OPERATOR_NAME}} {{SOMETHING_NEW}}</p>", {
      ...SET,
      officerName: '<script>"x"</script>',
    });
    expect(html).toBe("<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt; </p>");
    expect(missing).toEqual(["SOMETHING_NEW"]);
  });

  test("the served pages use the configured values", async () => {
    const unset = await (await handleRequest(new Request("http://localhost/privacy"))).text();
    expect(unset).not.toContain("{{");
    expect(unset).toContain(LEGAL_FALLBACKS.CONTACT_EMAIL);

    const env = {
      LECTERN_LEGAL_CONTACT_EMAIL: SET.contactEmail,
      LECTERN_LEGAL_OFFICER_NAME: SET.officerName,
      LECTERN_LEGAL_EFFECTIVE_DATE: SET.effectiveDate,
    };
    Object.assign(process.env, env);
    resetConfigForTests();
    try {
      for (const page of LEGAL_PAGES) {
        const res = await handleRequest(new Request(`http://localhost/${page}`));
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/html");
        const html = await res.text();
        expect(html).not.toContain("{{");
        expect(html).toContain("mailto:privacy@example.com");
        expect(html).toContain("2026년 10월 26일");
      }
    } finally {
      for (const key of Object.keys(env)) delete process.env[key];
      resetConfigForTests();
    }
  });
});
