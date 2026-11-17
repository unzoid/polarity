import { expect, test } from "bun:test";
import { fromBase64Url, hashPin, isPin, needsRehash, parsePinHash, pbkdf2, PIN_ITERATIONS, toBase64Url, verifyPin } from "../src/lib/account/pin";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
/** "1234" with SALT and 1,000 rounds, as Node's own pbkdf2Sync makes it. */
const FIXED = "pbkdf2-sha256$1000$AAECAwQFBgcICQoLDA0ODw$IkDqKiJ1SjxGEDVu-OTXrPJa8qw9LRGGbel6i3gSxSw";

test("PBKDF2-HMAC-SHA256 gives the published test vectors (RFC 7914 §11 style, P=password S=salt)", async () => {
  const salt = new TextEncoder().encode("salt");
  expect(hex(await pbkdf2("password", salt, 1))).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
  expect(hex(await pbkdf2("password", salt, 4096))).toBe("c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a");
});

test("a PIN's hash keeps its algorithm, rounds and salt, and matches a fixed vector", async () => {
  expect(await hashPin("1234", { iterations: 1000, salt: SALT })).toBe(FIXED);
  expect(await verifyPin("1234", FIXED)).toBe(true);
  expect(await verifyPin("1235", FIXED)).toBe(false);
  expect(await verifyPin("123", FIXED)).toBe(false);
  expect(parsePinHash(FIXED)).toMatchObject({ iterations: 1000 });
});

test("each new hash gets its own salt, with this version's rounds", async () => {
  const [a, b] = await Promise.all([hashPin("0000"), hashPin("0000")]);
  expect(a).not.toBe(b);
  expect(a.startsWith(`pbkdf2-sha256$${PIN_ITERATIONS}$`)).toBe(true);
  expect(await verifyPin("0000", a)).toBe(true);
  expect(needsRehash(a)).toBe(false);
  expect(needsRehash(FIXED)).toBe(true);
});

test("only four digits are a PIN; a hash this version can't read matches nothing", async () => {
  expect(isPin("0429")).toBe(true);
  for (const s of ["", "123", "12345", "12a4", " 1234", "١٢٣٤"]) expect(isPin(s)).toBe(false);
  await expect(hashPin("12")).rejects.toThrow();
  for (const bad of ["", "1234", "argon2$1$AAAA$BBBB", "pbkdf2-sha256$0$AAECAwQFBgcICQoLDA0ODw$AAAA", "pbkdf2-sha256$99999999$AAECAwQFBgcICQoLDA0ODw$IkDqKiJ1SjxGEDVu-OTXrPJa8qw9LRGGbel6i3gSxSw", `${FIXED}$extra`]) {
    expect(parsePinHash(bad)).toBeNull();
    expect(await verifyPin("1234", bad)).toBe(false);
  }
});

test("base64url round-trips without padding", () => {
  const bytes = Uint8Array.from([0, 251, 255, 62, 63]);
  expect(toBase64Url(bytes)).toBe("APv_Pj8");
  expect([...fromBase64Url("APv_Pj8")!]).toEqual([...bytes]);
  expect(fromBase64Url("a+b")).toBeNull();
});
