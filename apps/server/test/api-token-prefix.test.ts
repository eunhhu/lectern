import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
// An API token is `lct_` + random base64url, so it can begin with the prefix of another
// token kind that API v2 tells apart by prefix (a native access or refresh token, a PAT).
// Such a token was refused with 401 on every v2 route (a rare CI flake: about 1 in 130,000
// users). New tokens skip those prefixes; tokens already issued keep working.

import { describe, expect, test } from "bun:test";
import { PAT_PREFIX } from "../src/access-tokens.ts";
import { authenticateV2 } from "../src/api/v2/authn.ts";
import { createUser, db, generateApiToken, generateId, RESERVED_TOKEN_PREFIXES } from "../src/db.ts";
import { ACCESS_PREFIX, REFRESH_PREFIX } from "../src/native-auth.ts";

const request = (token: string) => new Request("http://localhost/api/v2/me", { headers: { "X-Lectern-Token": token } });

describe("API tokens and the other lct_ prefixes", () => {
  test("the reserved list is the other token kinds' prefixes", () => {
    expect<string[]>([...RESERVED_TOKEN_PREFIXES].sort()).toEqual([ACCESS_PREFIX, REFRESH_PREFIX, PAT_PREFIX].sort());
  });

  test("new API tokens never begin with a reserved prefix", () => {
    for (let i = 0; i < 2_000; i++) {
      const token = generateApiToken();
      expect(token.startsWith("lct_")).toBe(true);
      expect(RESERVED_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))).toBe(false);
    }
  });

  test("an API token issued with a reserved prefix still authenticates on v2", () => {
    for (const prefix of RESERVED_TOKEN_PREFIXES) {
      const user = createUser({ email: `${generateId("prefix")}@example.com`, displayName: "prefix", password: "correct_password_1" });
      const token = `${prefix}${generateApiToken().slice(4)}`;
      db.query(`UPDATE users SET api_token = ? WHERE id = ?`).run(token, user.id);
      const auth = authenticateV2(request(token));
      expect(auth?.user.id).toBe(user.id);
      expect(auth?.via).toBe("api_token");
    }
  });

  test("unknown native and PAT tokens are still refused", () => {
    for (const prefix of RESERVED_TOKEN_PREFIXES) expect(authenticateV2(request(`${prefix}not-a-real-token`))).toBeNull();
  });
});
