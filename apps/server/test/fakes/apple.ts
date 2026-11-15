// A fake Sign in with Apple for server tests (P5-05, CONTRACTS D-P4-9 style): it replaces
// globalThis.fetch and answers the token endpoint and the JWKS from memory. A request to any
// other host throws. The ID tokens are ES256 (P-256), signed with a key made at start.

export interface FakeAppleIdToken {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  aud?: string;
  /** Unset: the nonce of the last authorize() call. */
  nonce?: string;
  exp?: number;
}

export interface FakeApple {
  install(): void;
  restore(): void;
  requests: { url: string; form?: Record<string, string> }[];
  /** A code the token endpoint accepts once, answering with this ID token. */
  issueCode(code: string, idToken: FakeAppleIdToken): void;
  /** The browser visiting the consent page: remembers its nonce for the next ID token. */
  authorize(url: string | URL): void;
  /** The client_secret of the last token request. */
  lastClientSecret(): string | null;
  /** The public key of the ID token signing key (resolves once the key is made). */
  publicJwk(): Promise<JsonWebKey>;
}

const APPLE_HOST = "appleid.apple.com";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const b64url = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");

export function createFakeApple(): FakeApple {
  let original: typeof fetch | null = null;
  let counter = 0;
  let lastNonce: string | undefined;
  let clientSecret: string | null = null;
  const codes = new Map<string, FakeAppleIdToken>();
  const keyPromise = (async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = "fake-apple-1";
    return { kid, privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" } };
  })();

  async function idToken(claims: FakeAppleIdToken, clientId: string): Promise<string> {
    const key = await keyPromise;
    const now = Math.floor(Date.now() / 1000);
    const { nonce, ...rest } = claims;
    const payload = { iss: "https://appleid.apple.com", aud: clientId, iat: now, exp: now + 600, ...rest, ...(nonce === undefined ? {} : { nonce }) };
    const head = `${b64url(JSON.stringify({ alg: "ES256", kid: key.kid }))}.${b64url(JSON.stringify(payload))}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(head));
    return `${head}.${b64url(new Uint8Array(signature))}`;
  }

  const fake: FakeApple = {
    requests: [],
    install() {
      if (original) return;
      original = globalThis.fetch;
      globalThis.fetch = handle as typeof fetch;
    },
    restore() {
      if (original) globalThis.fetch = original;
      original = null;
    },
    issueCode(code, claims) {
      codes.set(code, claims.nonce === undefined ? { ...claims, nonce: lastNonce } : claims);
    },
    authorize(url) {
      lastNonce = new URL(url).searchParams.get("nonce") ?? undefined;
    },
    lastClientSecret: () => clientSecret,
    publicJwk: async () => (await keyPromise).publicJwk,
  };

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.hostname !== APPLE_HOST) throw new Error(`fake Apple: refused request to ${url.hostname}`);
    const text = request.method === "GET" ? "" : await request.text();
    const form = (request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(text))
      : undefined;
    fake.requests.push({ url: request.url, form });

    if (url.pathname === "/auth/keys") return json(200, { keys: [(await keyPromise).publicJwk] });
    if (url.pathname === "/auth/token" && request.method === "POST") {
      const f = form ?? {};
      clientSecret = f.client_secret ?? null;
      if (!f.client_id || !f.client_secret) return json(400, { error: "invalid_client" });
      if (f.grant_type !== "authorization_code" || !f.redirect_uri) return json(400, { error: "invalid_request" });
      const claims = codes.get(f.code ?? "");
      if (!claims) return json(400, { error: "invalid_grant" });
      codes.delete(f.code!);
      return json(200, {
        access_token: `apple-at-${++counter}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `apple-rt-${counter}`,
        id_token: await idToken(claims, f.client_id),
      });
    }
    return json(404, { error: "not_found" });
  }

  return fake;
}
