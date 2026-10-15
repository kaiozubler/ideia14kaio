import { describe, it as test } from "node:test";
import { strictEqual } from "node:assert";
import { oauthReturnPath } from "./oauth-return-path";

describe("OAuth return destination", () => {
  test("keeps authorization ID and fragment", () => {
    strictEqual(oauthReturnPath("/.lovable/oauth/consent?authorization_id=abc#request"), "/.lovable/oauth/consent?authorization_id=abc#request");
  });
  test("rejects external destinations", () => {
    for (const path of ["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/\noutside.invalid", null]) strictEqual(oauthReturnPath(path), "/");
  });
});