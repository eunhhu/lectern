// 로그인: the existing cookie auth (POST /api/auth/login sets the HttpOnly
// `lectern_session` cookie). Nothing from the response is stored in the browser; the
// session token in its body is ignored. Signing up and password reset are /signup and
// /reset (routes/account).

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Form, Input, Label, TextField } from "react-aria-components";
import { errorMessage } from "../../api/errors.ts";
import { queryKeys, useApi } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { Button, uiStyles } from "../../ui/controls.tsx";
import { Icon } from "../../ui/Icon.tsx";
import s from "./login.module.css";
import { appNext, OAuthButtons } from "./OAuthButtons.tsx";

export interface LoginSearch {
  /** App path to return to after signing in (`/recordings/rec_1?t=3000`). */
  next?: string;
  /** Why a Google/Apple sign-in came back here (`/app/login?error=oauth`, D-P5-5). */
  error?: string;
}

const OAUTH_ERRORS: Record<string, string> = {
  oauth: "로그인하지 못했습니다. 다시 시도해 주세요.",
  email_unverified: "이메일이 인증되지 않은 계정으로는 로그인할 수 없습니다.",
  no_email: "이메일 주소를 받지 못해 로그인할 수 없습니다.",
  inactive: "사용이 중지된 계정입니다.",
  signup_closed: "이 이메일로 가입된 계정이 없고, 지금은 새로 가입할 수 없습니다.",
};

/** The message for `?error=`; an unknown code reads as the generic failure. */
export function oauthErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return OAUTH_ERRORS[code] ?? OAUTH_ERRORS.oauth!;
}

/** `next` when it is a path inside the app, otherwise home: never another origin. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /^\/login(?:[/?#]|$)/.test(next)) return "/";
  return next;
}

export function LoginPage() {
  usePageTitle("로그인");
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { next, error: oauthError } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => oauthErrorMessage(oauthError));
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (pending) return;
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 모두 입력하세요.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const user = await api.login(email.trim(), password);
      // Another account may have used this tab: start from an empty cache.
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, user);
      await navigate({ href: safeNext(next), replace: true });
    } catch (err) {
      setError(errorMessage(err, "로그인하지 못했습니다. 잠시 뒤 다시 시도하세요."));
      setPassword("");
    } finally {
      setPending(false);
    }
  };

  return (
    <main id="main" className={s.page}>
      <div className={s.card}>
        <p className={s.brand}>
          <Icon name="spark" size={20} /> Lectern
        </p>
        <h1 className={s.title}>로그인</h1>
        <p className={s.lead}>녹음과 문서를 보려면 Lectern 계정으로 로그인하세요.</p>
        <Form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField className={uiStyles.field} value={email} onChange={setEmail} type="email" autoComplete="username" isRequired autoFocus>
            <Label className={uiStyles.label}>이메일</Label>
            <Input className={uiStyles.input} inputMode="email" spellCheck={false} />
          </TextField>
          <TextField className={uiStyles.field} value={password} onChange={setPassword} type="password" autoComplete="current-password" isRequired>
            <Label className={uiStyles.label}>비밀번호</Label>
            <Input className={uiStyles.input} />
          </TextField>
          {error && (
            <p className={s.error} role="alert">
              <Icon name="alert" /> {error}
            </p>
          )}
          <Button type="submit" variant="primary" isDisabled={pending}>
            {pending ? "로그인하는 중…" : "로그인"}
          </Button>
        </Form>
        <OAuthButtons next={appNext(safeNext(next))} />
        {api.mode === "fixture" && (
          <p className={s.note}>미리보기에는 서버가 없습니다. 예시 사용자의 이메일과 아무 비밀번호로 들어갑니다.</p>
        )}
        <p className={s.note}>
          계정이 없거나 비밀번호를 잊었다면 <Link to="/signup">회원가입</Link> · <Link to="/reset">비밀번호를 잊으셨나요?</Link>
        </p>
      </div>
    </main>
  );
}
