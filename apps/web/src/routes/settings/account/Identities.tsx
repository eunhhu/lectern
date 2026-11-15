// 설정 › 연결된 로그인 (P5-10, D-P5-5): the Google and Apple accounts the user signs in
// with. Linking goes through the same start URL as signing in; the server sees the session
// and links instead, then comes back with `?identity=linked|taken`. A provider the server
// has off is not drawn unless it is already linked (it can still be unlinked).

import { useEffect, useState } from "react";
import { ApiClientError } from "../../../api/client.ts";
import { isNotReady } from "../../../api/errors.ts";
import { useIdentities, useOAuthProviders, useUnlinkIdentity } from "../../../api/queries.ts";
import type { Identity } from "../../../api/types.ts";
import { formatDate } from "../../../lib/format.ts";
import { Badge, Button, ModalDialog } from "../../../ui/controls.tsx";
import { showToast } from "../../../ui/toast.tsx";
import { toastError } from "../../library/organise.ts";
import { AppleLogo, GoogleLogo } from "../../login/logos.tsx";
import { oauthStartUrl, PROVIDER_LABEL, type OAuthProvider } from "../../login/OAuthButtons.tsx";
import s from "../settings.module.css";
import a from "./account.module.css";
import { NOT_READY_TEXT } from "./Tokens.tsx";

const RETURN_TO = "/app/settings#account";
const LAST_METHOD_TEXT = "마지막 로그인 수단은 연결을 해제할 수 없습니다. 먼저 비밀번호를 설정해 주세요.";

/** The `?identity=linked|taken` the link flow comes back with: a toast, then the query goes. */
function useIdentityResultToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("identity");
    if (!result) return;
    if (result === "linked") showToast({ title: "로그인 수단을 연결했습니다." });
    else if (result === "taken") showToast({ title: "이미 다른 계정에 연결된 로그인입니다.", tone: "danger" });
    params.delete("identity");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, []);
}

export function Identities() {
  const identities = useIdentities();
  const providerQuery = useOAuthProviders();
  const providers = providerQuery.data;
  const unlink = useUnlinkIdentity();
  const [unlinking, setUnlinking] = useState<Identity | null>(null);
  const now = new Date();
  useIdentityResultToast();

  const runUnlink = async () => {
    const identity = unlinking;
    setUnlinking(null);
    if (!identity) return;
    try {
      await unlink.mutateAsync(identity.id);
      showToast({ title: `${PROVIDER_LABEL[identity.provider]} 로그인 연결을 해제했습니다.` });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) showToast({ title: LAST_METHOD_TEXT, tone: "danger" });
      else toastError("연결을 해제하지 못했습니다.", err);
    }
  };

  let body;
  if (isNotReady(identities.error)) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (!identities.data || providerQuery.isPending) {
    // Wait for which providers are on too, or a password-only account flashes "none".
    body = <p className={s.muted}>{identities.isPending || providerQuery.isPending ? "불러오는 중…" : "연결된 로그인을 불러오지 못했습니다."}</p>;
  } else {
    const rows = (["google", "apple"] as const)
      .map((provider) => ({ provider, identity: identities.data.find((i) => i.provider === provider) ?? null }))
      .filter((row) => row.identity || providers?.[row.provider]);
    body =
      rows.length === 0 ? (
        <p className={s.muted}>연결할 수 있는 로그인 수단이 없습니다.</p>
      ) : (
        <ul className={s.members} role="list">
          {rows.map(({ provider, identity }) => (
            <ProviderRow key={provider} provider={provider} identity={identity} now={now} onUnlink={setUnlinking} />
          ))}
        </ul>
      );
  }

  return (
    <section id="identities" className={s.section} aria-labelledby="set-identities">
      <h2 id="set-identities" className={s.heading}>
        연결된 로그인
      </h2>
      {body}
      <ModalDialog
        isOpen={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={unlinking ? `${PROVIDER_LABEL[unlinking.provider]} 로그인 연결을 해제할까요?` : "로그인 연결 해제"}
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setUnlinking(null)} autoFocus>
              취소
            </Button>
            <Button variant="danger" onPress={runUnlink}>
              연결 해제
            </Button>
          </>
        }
      >
        <p>해제한 뒤에는 이 {unlinking ? PROVIDER_LABEL[unlinking.provider] : ""} 계정으로 로그인할 수 없습니다. 언제든 다시 연결할 수 있습니다.</p>
      </ModalDialog>
    </section>
  );
}

function ProviderRow({
  provider,
  identity,
  now,
  onUnlink,
}: {
  provider: OAuthProvider;
  identity: Identity | null;
  now: Date;
  onUnlink: (identity: Identity) => void;
}) {
  const label = PROVIDER_LABEL[provider];
  return (
    <li className={s.member}>
      <span className={a.providerLogo}>{provider === "google" ? <GoogleLogo /> : <AppleLogo />}</span>
      <span className={s.memberText}>
        <span className={s.memberName}>
          {label}
          {identity && <Badge tone="success">연결됨</Badge>}
        </span>
        <span className={s.muted}>{identity ? `${identity.email ?? "이메일 없음"} · ${formatDate(identity.created_at, now)}에 연결` : "연결되지 않음"}</span>
      </span>
      {identity ? (
        <Button size="sm" variant="dangerText" aria-label={`연결 해제: ${label}`} onPress={() => onUnlink(identity)}>
          연결 해제
        </Button>
      ) : (
        <Button size="sm" aria-label={`연결: ${label}`} onPress={() => window.location.assign(oauthStartUrl(provider, RETURN_TO))}>
          연결
        </Button>
      )}
    </li>
  );
}
