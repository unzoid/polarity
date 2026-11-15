import { expect, test } from "bun:test";
import type { AuthError, Factor } from "@supabase/supabase-js";
import { emailChanged, groupSecret, isTwoStepCode, qrImage, tidyCode, tidyEmail } from "../src/lib/account/twoStep";
import { authError, authenticators } from "../src/lib/account/supabase";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#000" d="M0 0h3v3H0z"/></svg>';

test("qrImage: supabase-js's raw-SVG data URI becomes an escaped one, a # included", () => {
  const out = qrImage(`data:image/svg+xml;utf-8,${SVG}`);
  expect(out.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  expect(out).not.toContain("#");
  expect(decodeURIComponent(out.slice(out.indexOf(",") + 1))).toBe(SVG);
});

test("qrImage: bare SVG and already escaped SVG come out the same, escaped once", () => {
  const once = qrImage(SVG);
  expect(qrImage(once)).toBe(once);
  expect(qrImage(`data:image/svg+xml;utf-8,${encodeURIComponent(SVG)}`)).toBe(once);
});

test("qrImage: a PNG data URI passes; anything that loads from elsewhere doesn't", () => {
  expect(qrImage("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  expect(qrImage("https://example.com/qr.svg")).toBe("");
  expect(qrImage("javascript:alert(1)")).toBe("");
  expect(qrImage("data:text/html,<svg>")).toBe("");
  expect(qrImage("data:image/svg+xml;utf-8,%E0%A4%A")).toBe("");
});

test("codes: digits only, six of them", () => {
  expect(tidyCode(" 123 456 ")).toBe("123456");
  expect(tidyCode("1234567")).toBe("123456");
  expect(isTwoStepCode("123456")).toBe(true);
  expect(isTwoStepCode("12345")).toBe(false);
  expect(isTwoStepCode("12345a")).toBe(false);
});

test("groupSecret: the key in fours, without a trailing space", () => {
  expect(groupSecret("ABCDEFGHIJKLMNOP")).toBe("ABCD EFGH IJKL MNOP");
  expect(groupSecret("ABCDEF")).toBe("ABCD EF");
});

test("tidyEmail and emailChanged", () => {
  expect(tidyEmail("  New.Name@Example.com ")).toBe("new.name@example.com");
  expect(tidyEmail("not an address")).toBeNull();
  expect(emailChanged({ id: "u", email: "new@example.com" }, "NEW@example.com")).toBe(true);
  expect(emailChanged({ id: "u", email: "old@example.com", newEmail: "new@example.com" }, "new@example.com")).toBe(false);
});

const factor = (id: string, status: "verified" | "unverified", friendly_name?: string, factor_type = "totp") =>
  ({ id, status, friendly_name, factor_type, created_at: "", updated_at: "" }) as Factor;

test("authenticators: confirmed TOTP factors only, unnamed ones numbered", () => {
  expect(authenticators([factor("a", "verified", "Phone"), factor("b", "unverified", "Half"), factor("c", "verified"), factor("d", "verified", "Key", "phone")])).toEqual([
    { id: "a", name: "Phone" },
    { id: "c", name: "Authenticator 2" },
  ]);
});

const err = (code: string) => ({ code, name: "AuthApiError", status: 422, message: "x" }) as unknown as AuthError;

test("authError: email change and two-step errors in the app's words", () => {
  expect(authError(err("email_exists")).code).toBe("email_taken");
  expect(authError(err("email_address_invalid")).code).toBe("invalid_email");
  expect(authError(err("over_email_send_rate_limit")).code).toBe("rate_limited");
  expect(authError(err("mfa_verification_failed")).code).toBe("invalid_code");
  expect(authError(err("mfa_challenge_expired")).code).toBe("invalid_code");
  expect(authError(err("mfa_totp_enroll_not_enabled")).code).toBe("not_set_up");
});
