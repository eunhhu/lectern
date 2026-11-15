// 회원가입 (D-P2-1): the existing v1 endpoints, POST /api/auth/send-code and
// POST /api/auth/register. A successful sign-up sets the HttpOnly session cookie; the
// session token in the response body is ignored (D-P2-5). Whether the code is required is
// the server's call (it is when mail is configured), so an empty code is still sent.

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Form, Input, Label, TextField } from "react-aria-components";
import { errorMessage } from "../../api/errors.ts";
import { queryKeys, useApi } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { Button, uiStyles } from "../../ui/controls.tsx";
import { Icon } from "../../ui/Icon.tsx";
import s from "./account.module.css";
import { useSendCode } from "./useSendCode.ts";
import { OAuthButtons } from "../login/OAuthButtons.tsx";

export const MIN_PASSWORD = 6;

export function SignupPage() {
  usePageTitle("회원가입");
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sender = useSendCode("signup");
  const sendId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [waitingApproval, setWaitingApproval] = useState<string | null>(null);
  const [focus, setFocus] = useState<"code" | "send" | null>(null);

  // After a send the button is briefly disabled: put focus where the keyboard user goes next.
  useEffect(() => {
    if (focus === "code") codeRef.current?.focus();
    if (focus === "send") document.getElementById(sendId)?.focus();
    if (focus) setFocus(null);
  }, [focus, sendId]);

  const sendCode = async () => {
    const problem = await sender.send(email);
    setError(problem);
    setFocus(problem ? "send" : "code");
  };

  const submit = async () => {
    if (pending) return;
    if (!email.trim()) return setError("이메일을 입력하세요.");
    if (password.length < MIN_PASSWORD) return setError("비밀번호는 6자 이상이어야 합니다.");
    if (password !== confirm) return setError("비밀번호가 서로 다릅니다.");
    setPending(true);
    setError(null);
    try {
      const result = await api.register({ email: email.trim(), displayName: name.trim(), password, verificationCode: code.trim() });
      if (result.kind === "pending") {
        setWaitingApproval(result.message || "가입 신청을 받았습니다. 관리자가 승인하면 로그인할 수 있습니다.");
        return;
      }
      // Another account may have used this tab: start from an empty cache.
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, result.user);
      await navigate({ href: "/", replace: true });
    } catch (err) {
      setError(errorMessage(err, "가입하지 못했습니다. 잠시 뒤 다시 시도하세요."));
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
        <h1 className={s.title}>회원가입</h1>
        {waitingApproval ? (
          <p className={s.status} role="status">
            {waitingApproval} <Link to="/login">로그인 화면으로</Link>
          </p>
        ) : (
          <>
            <p className={s.lead}>이메일을 확인한 뒤 Lectern 계정을 만듭니다.</p>
            <Form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className={s.row}>
                <TextField className={uiStyles.field} value={email} onChange={setEmail} type="email" autoComplete="username" isRequired autoFocus>
                  <Label className={uiStyles.label}>이메일</Label>
                  <Input className={uiStyles.input} inputMode="email" spellCheck={false} />
                </TextField>
                <Button id={sendId} type="button" onPress={() => void sendCode()} isDisabled={sender.sending || sender.cooldown > 0}>
                  {sender.label}
                </Button>
              </div>
              {sender.status && (
                <p className={s.status} role="status">
                  {sender.status}
                </p>
              )}
              <TextField className={uiStyles.field} value={code} onChange={setCode} autoComplete="one-time-code" maxLength={6}>
                <Label className={uiStyles.label}>인증번호</Label>
                <Input ref={codeRef} className={uiStyles.input} inputMode="numeric" spellCheck={false} />
              </TextField>
              <TextField className={uiStyles.field} value={name} onChange={setName} autoComplete="name">
                <Label className={uiStyles.label}>이름</Label>
                <Input className={uiStyles.input} />
              </TextField>
              <TextField className={uiStyles.field} value={password} onChange={setPassword} type="password" autoComplete="new-password" isRequired>
                <Label className={uiStyles.label}>비밀번호</Label>
                <Input className={uiStyles.input} />
              </TextField>
              <TextField className={uiStyles.field} value={confirm} onChange={setConfirm} type="password" autoComplete="new-password" isRequired>
                <Label className={uiStyles.label}>비밀번호 확인</Label>
                <Input className={uiStyles.input} />
              </TextField>
              {error && (
                <p className={s.error} role="alert">
                  <Icon name="alert" /> {error}
                </p>
              )}
              <Button type="submit" variant="primary" isDisabled={pending}>
                {pending ? "가입하는 중…" : "가입하기"}
              </Button>
            </Form>
            <OAuthButtons next="/app" />
            <p className={s.note}>
              이미 계정이 있나요? <Link to="/login">로그인</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
