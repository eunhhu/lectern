// The public policy pages (static/legal/*.html) carry {{SLOT}} placeholders for values that
// belong to the operator, not to this public repository: the contact address, the privacy
// officer's name and the effective date. They are filled at serve time from LECTERN_LEGAL_*
// (packages/config). An unset value renders a neutral Korean phrase instead of the raw slot,
// and a mailto link without an address becomes plain text, so a half-configured host never
// publishes "{{CONTACT_EMAIL}}".

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "@lectern/config";
import { escapeHtml } from "@lectern/core";
import { logger } from "./log.ts";

export const LEGAL_PAGES = ["privacy", "terms"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

const LEGAL_DIR = join(import.meta.dir, "../static/legal");

export interface LegalValues {
  contactEmail: string | null;
  officerName: string | null;
  /** YYYY-MM-DD (validated by packages/config). */
  effectiveDate: string | null;
}

/** What an unset slot reads as. Each fits every sentence its slot appears in. */
export const LEGAL_FALLBACKS: Record<string, string> = {
  CONTACT_EMAIL: "추후 공고하는 문의 이메일",
  OPERATOR_NAME: "추후 공고",
  EFFECTIVE_DATE: "추후 공고하는 날",
};

const MAILTO_RE = /<a href="mailto:\{\{CONTACT_EMAIL\}\}">\{\{CONTACT_EMAIL\}\}<\/a>/g;
const SLOT_RE = /\{\{([A-Z_]+)\}\}/g;

/** "2026-10-26" → "2026년 10월 26일". */
export function formatKoreanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** Fills every slot in a policy template; `missing` names the slots that got a fallback. */
export function renderLegalTemplate(
  template: string,
  values: LegalValues
): { html: string; missing: string[] } {
  const email = values.contactEmail ? escapeHtml(values.contactEmail) : null;
  const filled: Record<string, string | null> = {
    CONTACT_EMAIL: email,
    OPERATOR_NAME: values.officerName ? escapeHtml(values.officerName) : null,
    EFFECTIVE_DATE: values.effectiveDate ? formatKoreanDate(values.effectiveDate) : null,
  };
  const missing = new Set<string>();
  const html = template
    .replace(MAILTO_RE, () => {
      if (email) return `<a href="mailto:${email}">${email}</a>`;
      missing.add("CONTACT_EMAIL");
      return LEGAL_FALLBACKS.CONTACT_EMAIL;
    })
    .replace(SLOT_RE, (_, name: string) => {
      const value = filled[name];
      if (value) return value;
      missing.add(name);
      return LEGAL_FALLBACKS[name] ?? "";
    });
  return { html, missing: [...missing].sort() };
}

const rendered = new Map<string, string>();
const warned = new Set<LegalPage>();

/** The page rendered with the configured values, or null when its template is absent. */
export function legalPageHtml(page: LegalPage): string | null {
  const values: LegalValues = config().legal;
  const key = `${page}\n${JSON.stringify(values)}`;
  const cached = rendered.get(key);
  if (cached !== undefined) return cached;

  const file = join(LEGAL_DIR, `${page}.html`);
  if (!existsSync(file)) return null;
  const { html, missing } = renderLegalTemplate(readFileSync(file, "utf8"), values);
  if (missing.length > 0 && !warned.has(page)) {
    warned.add(page);
    logger.warn("policy page shows placeholder text until LECTERN_LEGAL_* are set", { page, missing });
  }
  rendered.set(key, html);
  return html;
}
