// The one fake Google for server tests (CONTRACTS D-P4-9): it replaces globalThis.fetch and
// answers the OAuth token and revoke endpoints and the Calendar API from memory. A request
// to any other host throws, so a test can never reach a real service. P4-02 made it (tokens,
// revoke, calendars); P4-03 added events; P4-04 and P5-04 extend it. P5-04 added sign-in: an
// RS256 key pair made at start, its public key at the JWKS URL, and ID tokens signed with it.
//
// Tokens are fake values: access tokens `at-<n>`, refresh tokens `rt-<n>`.

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  form?: Record<string, string>;
  json?: unknown;
}

/** Claims of the ID token a code returns (P5-04). Unset: iss Google, aud the exchanging client, exp in an hour. */
export interface FakeIdToken {
  sub: string;
  email?: string;
  email_verified?: boolean;
  aud?: string;
  iss?: string;
  exp?: number;
  /** Unset: the nonce of the last authorize() call. */
  nonce?: string;
  name?: string;
}

export interface FakeGoogle {
  /** Replaces globalThis.fetch. */
  install(): void;
  restore(): void;
  requests: FakeRequest[];
  /** A code the token endpoint accepts once. `refreshToken: null` answers without a refresh token. With `idToken`, the answer carries a signed ID token. */
  issueCode(code: string, opts?: { refreshToken?: string | null; scope?: string; idToken?: FakeIdToken }): void;
  /** The browser visiting the consent page: remembers its nonce for the next ID token. */
  authorize(url: string | URL): void;
  /** A new signing key with a new kid; the JWKS endpoint serves only the new one. */
  rotateSigningKey(): void;
  /** The next `times` requests whose URL matches get this response instead. */
  failNext(match: string | RegExp, response: { status: number; json: unknown }, times?: number): void;
  /** Drops every pending failNext. */
  clearFailures(): void;
  calendars: Map<string, { summary: string; timeZone: string }>;
  /** calendarId → eventId → event resource. */
  events: Map<string, Map<string, Record<string, unknown>>>;
  /** Every token sent to the revoke endpoint, in order. */
  revoked: string[];
  /** Access tokens the Calendar API accepts. */
  accessTokens: Set<string>;
  /** Refresh tokens the token endpoint accepts (revoking one removes it). */
  refreshTokens: Set<string>;
}

const ALLOWED_HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"]);
const JWKS_PATH = "/oauth2/v3/certs";

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string };
}

let keyCounter = 0;

async function newSigningKey(): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const kid = `fake-google-${++keyCounter}`;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid } };
}

const b64url = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");

async function signJwt(key: SigningKey, claims: Record<string, unknown>): Promise<string> {
  const head = `${b64url(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(signature))}`;
}
export const FAKE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function createFakeGoogle(): FakeGoogle {
  let original: typeof fetch | null = null;
  let counter = 0;
  const codes = new Map<string, { refreshToken: string | null; scope: string; idToken?: FakeIdToken }>();
  let signing = newSigningKey();
  let lastNonce: string | undefined;
  const failures: Array<{ match: string | RegExp; response: { status: number; json: unknown }; left: number }> = [];

  const fake: FakeGoogle = {
    requests: [],
    calendars: new Map(),
    events: new Map(),
    revoked: [],
    accessTokens: new Set(),
    refreshTokens: new Set(),

    install() {
      if (original) return;
      original = globalThis.fetch;
      globalThis.fetch = handle as typeof fetch;
    },
    restore() {
      if (original) globalThis.fetch = original;
      original = null;
    },
    issueCode(code, opts = {}) {
      const refreshToken = opts.refreshToken === undefined ? `rt-${++counter}` : opts.refreshToken;
      const nonce = opts.idToken && opts.idToken.nonce === undefined ? lastNonce : opts.idToken?.nonce;
      codes.set(code, {
        refreshToken,
        scope: opts.scope ?? (opts.idToken ? "openid email profile" : FAKE_CALENDAR_SCOPE),
        idToken: opts.idToken ? { ...opts.idToken, nonce } : undefined,
      });
    },
    authorize(url) {
      lastNonce = new URL(url).searchParams.get("nonce") ?? undefined;
    },
    rotateSigningKey() {
      signing = newSigningKey();
    },
    failNext(match, response, times = 1) {
      failures.push({ match, response, left: times });
    },
    clearFailures() {
      failures.length = 0;
    },
  };

  const newAccessToken = () => {
    const token = `at-${++counter}`;
    fake.accessTokens.add(token);
    return token;
  };

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`fake Google: refused request to ${url.hostname}`);
    const headers = Object.fromEntries(request.headers.entries());
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    const recorded: FakeRequest = { method: request.method, url: request.url, headers };
    const type = headers["content-type"] ?? "";
    if (type.startsWith("application/x-www-form-urlencoded")) recorded.form = Object.fromEntries(new URLSearchParams(text));
    else if (type.startsWith("application/json") && text) recorded.json = JSON.parse(text);
    fake.requests.push(recorded);

    const failure = failures.find((f) => (typeof f.match === "string" ? request.url.includes(f.match) : f.match.test(request.url)));
    if (failure) {
      failure.left -= 1;
      if (failure.left <= 0) failures.splice(failures.indexOf(failure), 1);
      return json(failure.response.status, failure.response.json);
    }

    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") return token(recorded.form ?? {});
    if (url.hostname === "www.googleapis.com" && url.pathname === JWKS_PATH) return json(200, { keys: [(await signing).publicJwk] });
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") {
      const value = recorded.form?.token ?? url.searchParams.get("token") ?? "";
      fake.revoked.push(value);
      fake.refreshTokens.delete(value);
      fake.accessTokens.delete(value);
      return new Response("", { status: 200 });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/calendar/v3/")) {
      const bearer = (headers.authorization ?? "").replace(/^Bearer /, "");
      if (!fake.accessTokens.has(bearer)) return json(401, { error: { code: 401, message: "Invalid Credentials" } });
      return calendar(request.method, url, recorded.json);
    }
    return json(404, { error: { code: 404, message: "Not Found" } });
  }

  async function idTokenFor(claims: FakeIdToken, clientId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const { nonce, ...rest } = claims;
    return signJwt(await signing, {
      iss: "https://accounts.google.com",
      aud: clientId,
      iat: now,
      exp: now + 3600,
      ...rest,
      ...(nonce === undefined ? {} : { nonce }),
    });
  }

  async function token(form: Record<string, string>): Promise<Response> {
    if (!form.client_id || !form.client_secret) return json(401, { error: "invalid_client" });
    if (form.grant_type === "authorization_code") {
      const issued = codes.get(form.code ?? "");
      if (!issued || !form.code_verifier || !form.redirect_uri) return json(400, { error: "invalid_grant" });
      codes.delete(form.code!);
      if (issued.refreshToken) fake.refreshTokens.add(issued.refreshToken);
      return json(200, {
        access_token: newAccessToken(),
        expires_in: 3599,
        scope: issued.scope,
        token_type: "Bearer",
        ...(issued.refreshToken ? { refresh_token: issued.refreshToken } : {}),
        ...(issued.idToken ? { id_token: await idTokenFor(issued.idToken, form.client_id) } : {}),
      });
    }
    if (form.grant_type === "refresh_token") {
      if (!fake.refreshTokens.has(form.refresh_token ?? "")) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: newAccessToken(), expires_in: 3599, scope: FAKE_CALENDAR_SCOPE, token_type: "Bearer" });
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  const notFound = () => json(404, { error: { code: 404, message: "Not Found" } });

  function calendar(method: string, url: URL, body: unknown): Response {
    const path = url.pathname.slice("/calendar/v3".length);
    if (method === "POST" && path === "/calendars") {
      const b = body as { summary?: string; timeZone?: string };
      const id = `cal-${++counter}@group.calendar.google.com`;
      fake.calendars.set(id, { summary: b.summary ?? "", timeZone: b.timeZone ?? "UTC" });
      fake.events.set(id, new Map());
      return json(200, { kind: "calendar#calendar", id, summary: b.summary, timeZone: b.timeZone });
    }
    // /calendars/{calendarId}/events[/{eventId}] (P4-03)
    const match = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (!match) return notFound();
    const events = fake.events.get(decodeURIComponent(match[1]!));
    if (!events) return notFound();
    const eventId = match[2] === undefined ? null : decodeURIComponent(match[2]);
    if (eventId === null && method === "GET") {
      // privateExtendedProperty=name=value; deleted events are never returned (showDeleted=false).
      const [name, value] = (url.searchParams.get("privateExtendedProperty") ?? "").split("=");
      const items = [...events.values()].filter((e) => {
        const priv = (e.extendedProperties as { private?: Record<string, string> } | undefined)?.private ?? {};
        return !name || priv[name] === value;
      });
      const max = Number(url.searchParams.get("maxResults") ?? 250);
      return json(200, { kind: "calendar#events", items: items.slice(0, max) });
    }
    if (eventId === null && method === "POST") {
      const id = `gev-${++counter}`;
      const event = { ...(body as Record<string, unknown>), id, etag: `"etag-${counter}"`, status: "confirmed" };
      events.set(id, event);
      return json(200, event);
    }
    if (eventId === null) return notFound();
    const existing = events.get(eventId);
    if (method === "PATCH") {
      if (!existing) return notFound();
      const event = { ...existing, ...(body as Record<string, unknown>), id: eventId, etag: `"etag-${++counter}"` };
      events.set(eventId, event);
      return json(200, event);
    }
    if (method === "DELETE") {
      if (!existing) return json(410, { error: { code: 410, message: "Resource has been deleted" } });
      events.delete(eventId);
      return new Response(null, { status: 204 });
    }
    if (method === "GET") return existing ? json(200, existing) : notFound();
    return notFound();
  }

  return fake;
}
