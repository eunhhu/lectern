import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearJwksCache, JwtError, verifyJwt, type JwtErrorReason } from "../src/oauth/jwt.ts";

// ID token verification (P5-04): RS256 and ES256 against a JWKS, then iss, aud, exp, nonce.
// A local fetch stub serves the key set; no other host is reached.

const JWKS_URL = "https://keys.test.invalid/jwks";
const ISSUER = "https://issuer.test.invalid";
const AUDIENCE = "client-123";

interface Key {
  kid: string;
  alg: "RS256" | "ES256";
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string };
}

async function makeKey(alg: "RS256" | "ES256", kid: string): Promise<Key> {
  const params =
    alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" };
  const pair = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const { d: _d, key_ops: _ops, ext: _ext, ...pub } = jwk;
  return { kid, alg, privateKey: pair.privateKey, publicJwk: { ...pub, kid, alg, use: "sig" } };
}

const b64url = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");

async function sign(key: Key, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const head = `${b64url(JSON.stringify({ alg: key.alg, kid: key.kid, typ: "JWT", ...header }))}.${b64url(JSON.stringify(claims))}`;
  const algorithm = key.alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
  const signature = await crypto.subtle.sign(algorithm, key.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(signature))}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({ iss: ISSUER, aud: AUDIENCE, sub: "user-1", exp: nowSec() + 600, ...extra });
const opts = (extra: Partial<Parameters<typeof verifyJwt>[1]> = {}) => ({ jwksUrl: JWKS_URL, issuers: [ISSUER], audience: AUDIENCE, ...extra });

async function rejects(promise: Promise<unknown>, reason: JwtErrorReason): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(JwtError);
    expect((err as JwtError).reason).toBe(reason);
    return;
  }
  throw new Error(`expected rejection: ${reason}`);
}

let rsa: Key;
let ec: Key;
let served: Key[] = [];
let fetches = 0;
const originalFetch = globalThis.fetch;

const stub = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  if (url.toString() !== JWKS_URL) throw new Error(`refused request to ${url.hostname}`);
  fetches++;
  return new Response(JSON.stringify({ keys: served.map((k) => k.publicJwk) }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

beforeAll(async () => {
  rsa = await makeKey("RS256", "rsa-1");
  ec = await makeKey("ES256", "ec-1");
  globalThis.fetch = stub;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  clearJwksCache();
  served = [rsa, ec];
  fetches = 0;
});

describe("verifyJwt", () => {
  test("valid RS256", async () => {
    const result = await verifyJwt(await sign(rsa, claims({ email: "a@example.com" })), opts());
    expect(result.sub).toBe("user-1");
    expect(result.email).toBe("a@example.com");
  });

  test("valid ES256", async () => {
    const result = await verifyJwt(await sign(ec, claims()), opts());
    expect(result.sub).toBe("user-1");
  });

  test("audience in an array", async () => {
    const result = await verifyJwt(await sign(rsa, claims({ aud: ["other", AUDIENCE] })), opts());
    expect(result.sub).toBe("user-1");
  });

  test("alg none rejected", async () => {
    const head = `${b64url(JSON.stringify({ alg: "none", kid: "rsa-1" }))}.${b64url(JSON.stringify(claims()))}`;
    await rejects(verifyJwt(`${head}.`, opts()), "malformed");
    await rejects(verifyJwt(`${head}.AAAA`, opts()), "malformed");
    // HS256 with the public key as the secret: the classic confusion, refused by alg.
    await rejects(verifyJwt(`${b64url(JSON.stringify({ alg: "HS256", kid: "rsa-1" }))}.${b64url(JSON.stringify(claims()))}.AAAA`, opts()), "malformed");
  });

  test("malformed tokens", async () => {
    await rejects(verifyJwt("not-a-jwt", opts()), "malformed");
    await rejects(verifyJwt("a.b.c", opts()), "malformed");
  });

  test("bad signature", async () => {
    const token = await sign(rsa, claims());
    const [h, p] = token.split(".");
    const other = await sign(rsa, claims({ sub: "someone-else" }));
    await rejects(verifyJwt(`${h}.${other.split(".")[1]}.${token.split(".")[2]}`, opts()), "signature");
    // An EC key named in an RS256 header.
    const forged = await sign(rsa, claims(), { kid: "ec-1" });
    await rejects(verifyJwt(forged, opts()), "signature");
    expect(p).toBeTruthy();
  });

  test("wrong issuer", async () => {
    await rejects(verifyJwt(await sign(rsa, claims({ iss: "https://evil.test.invalid" })), opts()), "issuer");
  });

  test("wrong audience", async () => {
    await rejects(verifyJwt(await sign(rsa, claims({ aud: "other-client" })), opts()), "audience");
  });

  test("expired", async () => {
    await rejects(verifyJwt(await sign(rsa, claims({ exp: nowSec() - 120 })), opts()), "expired");
    // Within the 60-second clock allowance it still passes.
    expect((await verifyJwt(await sign(rsa, claims({ exp: nowSec() - 30 })), opts())).sub).toBe("user-1");
  });

  test("nonce mismatch", async () => {
    await rejects(verifyJwt(await sign(rsa, claims({ nonce: "abc" })), opts({ nonce: "xyz" })), "nonce");
    await rejects(verifyJwt(await sign(rsa, claims()), opts({ nonce: "xyz" })), "nonce");
    expect((await verifyJwt(await sign(rsa, claims({ nonce: "xyz" })), opts({ nonce: "xyz" }))).sub).toBe("user-1");
  });

  test("unknown kid refetches once", async () => {
    await verifyJwt(await sign(rsa, claims()), opts());
    expect(fetches).toBe(1);
    const rotated = await makeKey("RS256", "rsa-2");
    served = [rotated];
    expect((await verifyJwt(await sign(rotated, claims()), opts())).sub).toBe("user-1");
    expect(fetches).toBe(2);
    // A kid nobody serves: one more fetch, then "keys".
    const stray = await makeKey("RS256", "rsa-stray");
    await rejects(verifyJwt(await sign(stray, claims()), opts()), "keys");
    expect(fetches).toBe(3);
  });

  test("JWKS cached for an hour", async () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) await verifyJwt(await sign(rsa, claims()), opts({ now: now + i * 60_000 }));
    expect(fetches).toBe(1);
    await verifyJwt(await sign(rsa, claims({ exp: Math.floor((now + 2 * 3600_000) / 1000) })), opts({ now: now + 3600_000 + 1 }));
    expect(fetches).toBe(2);
  });

  test("JWKS that cannot be fetched", async () => {
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    try {
      await rejects(verifyJwt(await sign(rsa, claims()), opts()), "keys");
    } finally {
      globalThis.fetch = stub;
    }
  });
});
