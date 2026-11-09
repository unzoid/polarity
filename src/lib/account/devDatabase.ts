/**
 * A dev build's database (docs/dev-channel.md). Dev builds are made without one, so out of the box
 * they work signed out; someone on the team connects one by pasting a connection code in
 * Settings → Advanced → Database. The code holds the database's URL and publishable key, is kept
 * in the system keychain (`polar.devdb`), and is read once at start, before the account backend
 * is picked (lib/account/index.ts): connecting or removing one takes a restart. Release and
 * local builds never read it.
 */
import { buildChannel, type BuildChannel } from "../platform/build";
import { keychainStorage, type KeyStorage } from "../platform/keychain";

export interface DevDatabase {
  url: string;
  key: string;
}

const NAME = "polar.devdb";
const PREFIX = "polarity-db:";
/** What the auth client keeps for a session (lib/account/supabase.ts `storageKey`): another database's session is of no use. */
const SESSION = ["polar.auth", "polar.auth-code-verifier", "polar.auth-user"];

const toBase64Url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Why `url` and `key` can't be a dev build's database, or null when they can. */
export function databaseProblem({ url, key }: DevDatabase): string | null {
  // The web view only reaches Supabase's hosts (tauri.conf.json connect-src).
  if (!/^https:\/\/[a-z0-9-]{1,63}\.supabase\.co$/.test(url)) return "The database address should look like https://<project>.supabase.co.";
  if (/^sb_secret_/.test(key)) return "That's a secret key. Use the project's publishable key: a secret key must never be in an app.";
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null;
  // Older projects' "anon" key is a JWT; its "service_role" sibling is a secret.
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const role = (JSON.parse(fromBase64Url(parts[1])) as { role?: unknown }).role;
      if (role === "anon") return null;
      if (role === "service_role") return "That's the service role key, a secret. Use the project's publishable (anon) key.";
    } catch {}
  }
  return "The key should be the project's publishable key (sb_publishable_…).";
}

/** A code for `url` and `key`, for sharing with the team (scripts/devDatabaseCode.ts makes one too). */
export function connectionCode(db: DevDatabase): string {
  return PREFIX + toBase64Url(JSON.stringify({ url: db.url, key: db.key }));
}

/** The database a pasted code holds, or why it isn't one. */
export function parseConnectionCode(text: string): DevDatabase | { problem: string } {
  const code = text.replace(/\s+/g, "");
  if (!code.startsWith(PREFIX)) return { problem: `A connection code starts with ${PREFIX}` };
  let db: DevDatabase;
  try {
    const value = JSON.parse(fromBase64Url(code.slice(PREFIX.length))) as Partial<DevDatabase>;
    if (typeof value.url !== "string" || typeof value.key !== "string") throw new Error();
    db = { url: value.url.replace(/\/+$/, ""), key: value.key };
  } catch {
    return { problem: "That code isn't complete. Copy the whole code and paste it again." };
  }
  const problem = databaseProblem(db);
  return problem ? { problem } : db;
}

let connected: DevDatabase | null = null;

/** The database this run is connected to (read at start), or null. */
export const devDatabase = () => connected;

/** Called once at start, before the app renders: dev builds read their connection from the keychain. */
export async function loadDevDatabase(storage: KeyStorage = keychainStorage(), channel = buildChannel): Promise<DevDatabase | null> {
  connected = null;
  if (channel !== "dev") return null;
  const saved = await storage.getItem(NAME).catch(() => null);
  if (!saved) return null;
  const db = parseConnectionCode(saved);
  connected = "problem" in db ? null : db;
  return connected;
}

/** Keeps the database a code holds for the next start, or says why it can't; the old session is dropped. */
export async function saveDevDatabase(text: string, storage: KeyStorage = keychainStorage()): Promise<string | null> {
  if (buildChannel !== "dev") return "Only dev builds connect to a database this way.";
  const db = parseConnectionCode(text);
  if ("problem" in db) return db.problem;
  await Promise.all(SESSION.map((k) => storage.removeItem(k)));
  await storage.setItem(NAME, connectionCode(db));
  return null;
}

/** Forgets the database (from the next start) and the session on it. */
export async function removeDevDatabase(storage: KeyStorage = keychainStorage()) {
  if (buildChannel !== "dev") return;
  await Promise.all([...SESSION, NAME].map((k) => storage.removeItem(k)));
}

/**
 * The database the account backend uses (lib/account/index.ts): a dev build only the one its connection code
 * named (`dev`, from `devDatabase()`), any other build only the one built in (`VITE_SUPABASE_*`), else none.
 */
export function accountDatabase(channel: BuildChannel, builtIn: { url?: string; key?: string }, dev: DevDatabase | null): DevDatabase | null {
  if (channel === "dev") return dev;
  return builtIn.url && builtIn.key ? { url: builtIn.url, key: builtIn.key } : null;
}

/** "abcdefghijklmnopqrst.supabase.co": which database, without the key. */
export const databaseHost = (db: DevDatabase) => new URL(db.url).host;
