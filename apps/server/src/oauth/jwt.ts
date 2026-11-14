// ID token verification for Google and Apple sign-in (P5-04, CONTRACTS D-P5-5): the
// signature against the provider's JWKS, then issuer, audience, expiry and nonce. WebCrypto
// only, no dependency. RS256 (Google) and ES256 (Apple) are the only algorithms accepted.
//
// Never log a token or put it into an error message.

export interface JwtClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat?: number;
  email?: string;
  email_verified?: boolean | string;
  nonce?: string;
  [k: string]: unknown;
}

export type JwtErrorReason = "malformed" | "signature" | "issuer" | "audience" | "expired" | "nonce" | "keys";

export class JwtError extends Error {
  constructor(readonly reason: JwtErrorReason) {
    super(`id token rejected: ${reason}`);
    this.name = "JwtError";
  }
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

const ALGORITHMS = {
  RS256: { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: { name: "RSASSA-PKCS1-v1_5" }, kty: "RSA" },
  ES256: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" }, kty: "EC" },
} as const;
type Alg = keyof typeof ALGORITHMS;

interface Jwk extends JsonWebKey {
  kid?: string;
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

/** Forgets every cached key set (tests). */
export function clearJwksCache(): void {
  jwksCache.clear();
}

async function fetchJwks(url: string, now: number): Promise<Jwk[]> {
  let keys: unknown;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new JwtError("keys");
    keys = ((await res.json()) as { keys?: unknown }).keys;
  } catch (err) {
    if (err instanceof JwtError) throw err;
    throw new JwtError("keys");
  }
  if (!Array.isArray(keys)) throw new JwtError("keys");
  const list = keys.filter((k): k is Jwk => !!k && typeof k === "object");
  jwksCache.set(url, { keys: list, fetchedAt: now });
  return list;
}

/** The key for `kid`: from the cache (an hour), else fetched; an unknown kid refetches once. */
async function keyFor(url: string, kid: string, now: number): Promise<Jwk> {
  const cached = jwksCache.get(url);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    const hit = cached.keys.find((k) => k.kid === kid);
    if (hit) return hit;
  }
  const fresh = await fetchJwks(url, now);
  const key = fresh.find((k) => k.kid === kid);
  if (!key) throw new JwtError("keys");
  return key;
}

function decodePart(part: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new JwtError("malformed");
  }
}

export async function verifyJwt(
  token: string,
  opts: { jwksUrl: string; issuers: string[]; audience: string; nonce?: string; now?: number },
): Promise<JwtClaims> {
  const now = opts.now ?? Date.now();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new JwtError("malformed");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodePart(headerPart);
  const alg = header.alg;
  if (typeof alg !== "string" || !(alg in ALGORITHMS)) throw new JwtError("malformed");
  const spec = ALGORITHMS[alg as Alg];
  if (typeof header.kid !== "string" || !header.kid) throw new JwtError("malformed");
  const payload = decodePart(payloadPart);

  const jwk = await keyFor(opts.jwksUrl, header.kid, now);
  if (jwk.kty !== spec.kty) throw new JwtError("signature");
  let valid = false;
  try {
    // The JWK's own alg/use/key_ops would only narrow what it may do: the header decides.
    const { alg: _alg, use: _use, key_ops: _ops, ...material } = jwk as Jwk & { use?: string };
    const key = await crypto.subtle.importKey("jwk", material, spec.import, false, ["verify"]);
    valid = await crypto.subtle.verify(
      spec.verify,
      key,
      Buffer.from(signaturePart, "base64url"),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new JwtError("signature");

  const claims = payload as JwtClaims;
  if (typeof claims.iss !== "string" || !opts.issuers.includes(claims.iss)) throw new JwtError("issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(opts.audience)) throw new JwtError("audience");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SEC <= now / 1000) throw new JwtError("expired");
  if (typeof claims.sub !== "string" || !claims.sub) throw new JwtError("malformed");
  if (opts.nonce !== undefined && claims.nonce !== opts.nonce) throw new JwtError("nonce");
  return claims;
}
