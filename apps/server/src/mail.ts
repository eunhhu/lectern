// Outbound e-mail through Resend (RECIPES R15). Moved out of index.ts (P4-05) so reminders
// and invitations share one client. Never log addresses, subjects or bodies.

import { existsSync, readFileSync } from "node:fs";
import { config, readSecret } from "@lectern/config";

const RESEND_URL = "https://api.resend.com/emails";

// The Resend key comes from the environment, or else from the host's credentials file
// (overridable so tests never read the real one). The legacy host path stays the default
// until the production unit sets LECTERN_RESEND_CREDENTIALS_FILE or RESEND_API_KEY.
const RESEND_CREDENTIALS_FILE =
  config().resend.credentialsFile ?? "/home/eunhhu/.hermes/credentials/accounts.json";

export function resolveResendApiKey(): string {
  const envKey = readSecret("RESEND_API_KEY");
  if (envKey) return envKey;
  try {
    if (RESEND_CREDENTIALS_FILE && existsSync(RESEND_CREDENTIALS_FILE)) {
      const parsed = JSON.parse(readFileSync(RESEND_CREDENTIALS_FILE, "utf8"));
      const fileKey = String(parsed?.resend?.api_key || "").trim();
      if (fileKey) return fileKey;
    }
  } catch {}
  return "";
}

/** Sends one mail from RESEND_FROM_EMAIL. Throws without a key or on a non-2xx answer. */
export async function sendMail(m: { to: string; subject: string; html: string }): Promise<{ id?: string }> {
  const apiKey = resolveResendApiKey();
  if (!apiKey) {
    throw new Error("이메일 발송 API 키(RESEND_API_KEY)가 설정되지 않았습니다.");
  }
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config().resend.fromEmail,
      to: [m.to],
      subject: m.subject,
      html: m.html,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`이메일 발송 실패 (${res.status}): ${errText}`);
  }
  const data: any = await res.json();
  return { id: data?.id };
}
