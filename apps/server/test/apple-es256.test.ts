import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { importP8, signEs256Jwt } from "../src/apple/es256.ts";

// ES256 JWTs from a `.p8` key (P5-05). The keys are made here; no key file is in the repository.

async function p8Pair(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const lines = der.toString("base64").match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("ES256 with a .p8 key", () => {
  test("signs a JWT that verifies with the public key", async () => {
    const { pem, publicKey } = await p8Pair();
    const token = await signEs256Jwt(await importP8(pem), { kid: "KEY1" }, { sub: "x" });
    const [h, p, s] = token.split(".") as [string, string, string];
    const signature = Buffer.from(s, "base64url");
    expect(signature.length).toBe(64); // r‖s, not DER
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  test("header and claims round trip", async () => {
    const { pem } = await p8Pair();
    const claims = { iss: "TEAM123", iat: 1_700_000_000, exp: 1_700_000_300, aud: "https://appleid.apple.com", sub: "com.example.web", name: "김선우" };
    const token = await signEs256Jwt(await importP8(pem), { kid: "KEY1", alg: "HS256" }, claims);
    const [h, p] = token.split(".") as [string, string];
    expect(decode(h)).toEqual({ kid: "KEY1", alg: "ES256" });
    expect(decode(p)).toEqual(claims);
  });

  test("rejects a non-EC key file", async () => {
    const rsa = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", rsa.privateKey)).toString("base64");
    await expect(importP8(`-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`)).rejects.toThrow("not a P-256 EC private key");
    await expect(importP8("not a key")).rejects.toThrow();
    await expect(importP8("")).rejects.toThrow();
  });
});
