import { describe, expect, test } from "bun:test";
import { oauthReturnPath } from "./oauth-return-path";

describe("OAuth return destination", () => {
  test("keeps authorization ID and fragment", () => {
    expect(oauthReturnPath("/.lovable/oauth/consent?authorization_id=abc#request")).toBe("/.lovable/oauth/consent?authorization_id=abc#request");
  });
  test("rejects external destinations", () => {
    for (const path of ["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/\noutside.invalid", null]) expect(oauthReturnPath(path)).toBe("/");
  });
});