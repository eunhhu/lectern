// "Google로 계속하기" and "Apple로 계속하기" (P5-10, D-P5-5). The server starts the OAuth
// flow at /api/v2/auth/<provider>/start and comes back to `next`. Which providers are on is
// probed once per session (ApiClient.oauthProviders); a provider that is off has no button,
// and with neither there is no divider either. The logos are inline SVG (logos.tsx; CSP:
// no external images).

import { useOAuthProviders } from "../../api/queries.ts";
import { Button } from "../../ui/controls.tsx";
import s from "./login.module.css";
import { AppleLogo, GoogleLogo } from "./logos.tsx";

export type OAuthProvider = "google" | "apple";

export const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

/** Where the browser goes to sign in (or, signed in, to link) with `provider`. */
export function oauthStartUrl(provider: OAuthProvider, next: string): string {
  return `/api/v2/auth/${provider}/start?next=${encodeURIComponent(next)}`;
}

/** The app path the login screen returns to, as the full `/app/…` URL the server redirects to. */
export function appNext(path: string | undefined): string {
  return !path || path === "/" ? "/app" : `/app${path}`;
}

export function OAuthButtons({ next }: { next: string }) {
  const providers = useOAuthProviders().data;
  const shown = (["google", "apple"] as const).filter((p) => providers?.[p]);
  if (shown.length === 0) return null;
  return (
    <div className={s.oauth}>
      <p className={s.divider}>
        <span>또는</span>
      </p>
      {shown.map((provider) => (
        <Button key={provider} className={s.oauthButton} onPress={() => window.location.assign(oauthStartUrl(provider, next))}>
          {provider === "google" ? <GoogleLogo /> : <AppleLogo />}
          {PROVIDER_LABEL[provider]}로 계속하기
        </Button>
      ))}
    </div>
  );
}
