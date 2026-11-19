/**
 * Picks the account backend. To switch providers, implement `AccountBackend`
 * in a new file and return it here; nothing else in the app changes.
 *
 * With no provider configured, `backend` is null and Polarity runs fully
 * local (no sign-in screen). Dev builds have none built in: they use the
 * database a connection code named (devDatabase.ts), read before the app starts.
 *
 * This file is the folder's public surface: code outside src/lib imports
 * this folder, code inside src/lib imports the file.
 */
import type { AccountBackend } from "./backend";
import { accountDatabase, devDatabase, loadDevDatabase } from "./devDatabase";
import { buildChannel } from "../platform/build";

function configuredDatabase() {
  const builtIn = { url: import.meta.env.VITE_SUPABASE_URL as string | undefined, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined };
  // The condition stays here so a release bundle leaves out the dev database (scripts/releaseBundle.ts).
  return accountDatabase(buildChannel, builtIn, buildChannel === "dev" ? devDatabase() : null);
}

function initialBackend(): AccountBackend | null {
  // fake.html's stand-in account (lib/platform/fake/account.ts): dev server only, never in a build.
  if (import.meta.env.DEV && "__polarFakeAccount" in globalThis) {
    return (globalThis as { __polarFakeAccount?: AccountBackend | null }).__polarFakeAccount ?? null;
  }
  return null;
}

export let backend = initialBackend();

/** Before the app renders: loads the configured account provider (and in dev builds, any saved connection code). */
export async function startAccountBackend() {
  if (import.meta.env.DEV && "__polarFakeAccount" in globalThis) {
    backend = (globalThis as { __polarFakeAccount?: AccountBackend | null }).__polarFakeAccount ?? null;
    return;
  }
  if (buildChannel === "dev") await loadDevDatabase();
  const db = configuredDatabase();
  if (!db) {
    backend = null;
    return;
  }
  const { createSupabaseBackend } = await import("./supabase");
  backend = createSupabaseBackend(db.url, db.key);
}

export * from "./backend";
export * from "./avatars";
export * from "./AccountProvider";
export * from "./sync";
export * from "./settingsSync";
export { SECRET_KEYS } from "./settingsDoc";
export { databaseHost, devDatabase, removeDevDatabase, saveDevDatabase } from "./devDatabase";
export * from "./spacePush";
export { linkHasKey } from "./keyedLink";
export { formatTvCode, isTvCode, TV_CODE_LENGTH, type TvSignInRequest } from "./tvSignIn";
export { hasTvCode, offerTvCode, takeTvCode, useLinkedTvCode } from "./tvSignInLink";
export { groupSecret, isTwoStepCode, tidyCode, tidyEmail, TWO_STEP_CODE_LENGTH, type AccountSecurity } from "./twoStep";
export { dismissNotice, exposedNames, noticeDue, onFirstPlainSync } from "./secretsNotice";
