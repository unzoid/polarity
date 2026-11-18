/**
 * Profile PINs (4 digits), kept on the profile's row as a salted, slow hash, never as the PIN: PBKDF2 with
 * SHA-256 through WebCrypto, a random salt per PIN, and the parameters stored with the hash, so the count can
 * be raised later and PINs hashed with the old one still check (`needsRehash` says when to hash again).
 *
 * Stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>`, salt and hash in unpadded base64url.
 */

export const PIN_LENGTH = 4;
/** OWASP's figure for PBKDF2-HMAC-SHA256 (Password Storage Cheat Sheet, 2023). */
export const PIN_ITERATIONS = 600_000;
const ALGORITHM = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BYTES = 32;
/** What a stored hash may ask for before it's refused: a row with a huge count would hang the device. */
const MAX_ITERATIONS = 10_000_000;

/** Exactly four digits. */
export const isPin = (s: string) => new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(s);

/** PBKDF2-HMAC-SHA256 of `secret`. */
export async function pbkdf2(secret: string, salt: Uint8Array, iterations: number, bytes = HASH_BYTES): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

interface Parsed {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

/** A stored hash's parts; null when it isn't one this version can check. */
export function parsePinHash(stored: string): Parsed | null {
  const [algorithm, count, salt64, hash64, ...rest] = stored.split("$");
  if (rest.length || algorithm !== ALGORITHM || !/^[1-9][0-9]{0,8}$/.test(count ?? "")) return null;
  const iterations = Number(count);
  const salt = fromBase64Url(salt64 ?? "");
  const hash = fromBase64Url(hash64 ?? "");
  if (iterations > MAX_ITERATIONS || !salt || salt.length < 8 || !hash || hash.length < 16) return null;
  return { iterations, salt, hash };
}

/** A new hash of `pin` to store; `salt` and `iterations` are for tests. */
export async function hashPin(pin: string, { iterations = PIN_ITERATIONS, salt }: { iterations?: number; salt?: Uint8Array } = {}): Promise<string> {
  if (!isPin(pin)) throw new Error(`A PIN is ${PIN_LENGTH} digits.`);
  const s = salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(pin, s, iterations);
  return [ALGORITHM, String(iterations), toBase64Url(s), toBase64Url(hash)].join("$");
}

/** Whether `pin` is the one `stored` was made from. An unreadable `stored` matches nothing. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parsed = parsePinHash(stored);
  if (!parsed || !isPin(pin)) return false;
  const hash = await pbkdf2(pin, parsed.salt, parsed.iterations, parsed.hash.length);
  // Every byte compared, whatever differs first.
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ parsed.hash[i];
  return diff === 0;
}

/** Hashed with fewer rounds than this version uses: hash it again once the PIN is typed right. */
export const needsRehash = (stored: string) => (parsePinHash(stored)?.iterations ?? 0) < PIN_ITERATIONS;
