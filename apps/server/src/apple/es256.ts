// ES256 JWTs signed with an Apple `.p8` key (P5-05): the Sign in with Apple client secret,
// and later the APNs provider token (P6-02). WebCrypto only. Never log the key or a token.

/** A PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----") holding a P-256 key, as an ECDSA signing key. Throws on anything else. */
export async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error("not a PKCS#8 PEM key");
  const der = Buffer.from(body, "base64");
  try {
    return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } catch {
    throw new Error("not a P-256 EC private key");
  }
}

const b64url = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");

/** base64url(header).base64url(claims).base64url(r‖s). The header's `alg` is always ES256. */
export async function signEs256Jwt(key: CryptoKey, header: Record<string, unknown>, claims: Record<string, unknown>): Promise<string> {
  const head = `${b64url(JSON.stringify({ ...header, alg: "ES256" }))}.${b64url(JSON.stringify(claims))}`;
  // WebCrypto's ECDSA signature is already the raw r‖s (64 bytes) that JWS uses.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(signature))}`;
}
