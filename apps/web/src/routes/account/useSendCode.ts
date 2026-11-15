// The "인증번호 받기" button of the sign-up and reset screens: POST /api/auth/send-code,
// the server's sentence as a status, then a 60-second wait before the next request.

import { useEffect, useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import { useApi } from "../../api/queries.ts";

export const RESEND_SECONDS = 60;

export interface SendCode {
  /** The server's sentence after a successful send (shown with role="status"). */
  status: string | null;
  sending: boolean;
  /** Seconds left before another code can be asked for. */
  cooldown: number;
  label: string;
  /** Resolves with an error sentence for the page's alert, or null when the code went out. */
  send(email: string): Promise<string | null>;
}

export function useSendCode(purpose: "signup" | "reset"): SendCode {
  const api = useApi();
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const waiting = cooldown > 0;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const send = async (email: string): Promise<string | null> => {
    if (sending || waiting) return null;
    if (!email.trim()) return "이메일을 입력하세요.";
    setSending(true);
    setStatus(null);
    try {
      const message = await api.sendCode(email.trim(), purpose);
      setStatus(message || "인증번호를 보냈습니다.");
      setCooldown(RESEND_SECONDS);
      return null;
    } catch (err) {
      return errorMessage(err, "인증번호를 보내지 못했습니다. 잠시 뒤 다시 시도하세요.");
    } finally {
      setSending(false);
    }
  };

  const label = sending ? "보내는 중…" : waiting ? `다시 받기 (${cooldown}초)` : "인증번호 받기";
  return { status, sending, cooldown, label, send };
}
