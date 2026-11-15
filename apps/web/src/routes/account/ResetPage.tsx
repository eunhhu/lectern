// 비밀번호 재설정 (D-P2-1): POST /api/auth/send-code (purpose "reset") and
// POST /api/auth/reset-password. The server answers the same sentence whether or not the
// email has an account, so this screen never says which.

import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Form, Input, Label, TextField } from "react-aria-components";
import { errorMessage } from "../../api/errors.ts";
import { useApi } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { Button, uiStyles } from "../../ui/controls.tsx";
import { Icon } from "../../ui/Icon.tsx";
import s from "./account.module.css";
import { MIN_PASSWORD } from "./SignupPage.tsx";
import { useSendCode } from "./useSendCode.ts";

export function ResetPage() {
  usePageTitle("비밀번호 재설정");
  const api = useApi();
  const sender = useSendCode("reset");
  const sendId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLAnchorElement>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [focus, setFocus] = useState<"code" | "send" | null>(null);

  useEffect(() => {
    if (focus === "code") codeRef.current?.focus();
    if (focus === "send") document.getElementById(sendId)?.focus();
    if (focus) setFocus(null);
  }, [focus, sendId]);

  // The form is gone after a reset: the next step is the login link.
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const sendCode = async () => {
    const problem = await sender.send(email);
    setError(problem);
    setFocus(problem ? "send" : "code");
  };

  const submit = async () => {
    if (pending) return;
    if (!email.trim()) return setError("이메일을 입력하세요.");
    if (!code.trim()) return setError("인증번호를 입력하세요.");
    if (password.length < MIN_PASSWORD) return setError("새 비밀번호는 6자 이상이어야 합니다.");
    if (password !== confirm) return setError("비밀번호가 서로 다릅니다.");
    setPending(true);
    setError(null);
    try {
      const message = await api.resetPassword({ email: email.trim(), verificationCode: code.trim(), newPassword: password });
      setDone(message || "비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.");
    } catch (err) {
      setError(errorMessage(err, "비밀번호를 바꾸지 못했습니다. 잠시 뒤 다시 시도하세요."));
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
        <h1 className={s.title}>비밀번호 재설정</h1>
        {done ? (
          <p className={s.status} role="status">
            {done}{" "}
            <Link ref={doneRef} to="/login">
              로그인하기
            </Link>
          </p>
        ) : (
          <>
            <p className={s.lead}>가입한 이메일로 인증번호를 받아 새 비밀번호를 정합니다.</p>
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
              <TextField className={uiStyles.field} value={password} onChange={setPassword} type="password" autoComplete="new-password" isRequired>
                <Label className={uiStyles.label}>새 비밀번호</Label>
                <Input className={uiStyles.input} />
              </TextField>
              <TextField className={uiStyles.field} value={confirm} onChange={setConfirm} type="password" autoComplete="new-password" isRequired>
                <Label className={uiStyles.label}>새 비밀번호 확인</Label>
                <Input className={uiStyles.input} />
              </TextField>
              {error && (
                <p className={s.error} role="alert">
                  <Icon name="alert" /> {error}
                </p>
              )}
              <Button type="submit" variant="primary" isDisabled={pending}>
                {pending ? "바꾸는 중…" : "비밀번호 바꾸기"}
              </Button>
            </Form>
            <p className={s.note}>
              <Link to="/login">로그인으로 돌아가기</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
