// 초대 수락 (P5-11, D-P5-6): the page the invitation mail links to,
// `/app/invite?token=…`. Signed out, the router sends the visitor to the login screen and
// back here. Nothing is accepted until the button is pressed: a mail client or chat app
// that previews the link must not join anyone. After joining, the token leaves the address
// and the app switches to the new workspace.

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ApiClientError } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { queryKeys, useAcceptInvite, useApi, useMe } from "../../api/queries.ts";
import { usePageTitle } from "../../app/RootLayout.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Button } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import layout from "../../app/layout.module.css";
import s from "./invite.module.css";

export interface InviteSearch {
  token?: string;
}

/** Statuses after which pressing 수락 again cannot help. */
const FINAL = new Set([403, 404, 409]);

export function InvitePage() {
  usePageTitle("워크스페이스 초대");
  const { token } = useSearch({ from: "/_authed/invite" });
  const me = useMe().data;
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { switchTo } = useWorkspace();
  const accept = useAcceptInvite();
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const run = async () => {
    if (!token || accept.isPending) return;
    setError(null);
    try {
      const joined = await accept.mutateAsync(token);
      // The token goes from the address (and from history) before anything else.
      window.history.replaceState(window.history.state, "", window.location.pathname);
      switchTo(joined.workspace.id);
      showToast({ title: `"${joined.workspace.name}" 워크스페이스에 참여했습니다.` });
      await navigate({ to: "/", replace: true });
    } catch (err) {
      setError({ status: err instanceof ApiClientError ? err.status : 0, message: errorMessage(err, "초대를 수락하지 못했습니다. 잠시 뒤 다시 시도하세요.") });
    }
  };

  // Signed in as someone else: sign out, then come back to this same invitation.
  const switchAccount = async () => {
    try {
      await api.logout();
    } catch (err) {
      showToast({ title: "로그아웃하지 못했습니다.", description: errorMessage(err), tone: "danger" });
      return;
    }
    queryClient.setQueryData(queryKeys.session, null);
    await navigate({ to: "/login", search: { next: `/invite?token=${encodeURIComponent(token ?? "")}` }, replace: true });
    queryClient.clear();
    queryClient.setQueryData(queryKeys.session, null);
  };

  return (
    <div className={layout.page}>
      <div className={s.card}>
        {!token ? (
          <>
            <h1 className={s.title}>워크스페이스 초대</h1>
            <p className={s.error} role="alert">
              <Icon name="alert" /> 초대 링크가 올바르지 않습니다.
            </p>
          </>
        ) : (
          <>
            <h1 className={s.title}>워크스페이스 초대를 받았습니다.</h1>
            {me && <p className={s.lead}>{me.email}(으)로 로그인되어 있습니다.</p>}
            {error && (
              <p className={s.error} role="alert">
                <Icon name="alert" /> {error.message}
              </p>
            )}
            <div className={s.actions}>
              {!(error && FINAL.has(error.status)) && (
                <Button variant="primary" onPress={run} isDisabled={accept.isPending}>
                  {accept.isPending ? "수락하는 중…" : "초대 수락"}
                </Button>
              )}
              {error?.status === 403 && <Button onPress={switchAccount}>다른 계정으로 로그인</Button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
