import { count, isRecord, str } from "../parse";

/**
 * What a profile keeps besides its name and picture: a PIN asked before it's entered, and a viewing limit
 * that makes it a restricted profile (lib/account/profileRules.ts). Kept on the profile's row, so every
 * device of the account asks for the same PIN and applies the same limit, offline too, from its cached
 * copy of the profiles.
 */
export interface ProfileLock {
  /** The PIN as a salted hash with its parameters (lib/account/pin.ts), never the PIN; null without one. */
  pin: string | null;
  /** The highest age a title may be rated for; null: none set on the profile (Settings → Browsing applies). */
  viewingLimit: number | null;
  /** Titles without a rating are hidden too (only with a limit). */
  hideUnrated: boolean;
}

export const NO_LOCK: ProfileLock = { pin: null, viewingLimit: null, hideUnrated: false };

/** The highest age the server takes as a limit (its check: 1 to 21). */
const MAX_LIMIT = 21;

const limitOf = (v: unknown): number | null => {
  const n = count(v);
  return n !== undefined && n >= 1 && n <= MAX_LIMIT ? n : null;
};

/** This device's cached copy (`Profile.lock`); `undefined` when there's none (cached by a version before PINs). */
export function readLock(v: unknown): ProfileLock | undefined {
  if (!isRecord(v)) return;
  const viewingLimit = limitOf(v.viewingLimit);
  return { pin: str(v.pin) || null, viewingLimit, hideUnrated: viewingLimit !== null && v.hideUnrated === true };
}

/** The profile row's columns (supabase/migrations/20261115000000_profile_pin_and_limit.sql). */
export interface LockRow {
  pin_hash?: string | null;
  viewing_limit?: number | null;
  viewing_hide_unrated?: boolean | null;
}

/** A row's lock; `undefined` when the row has no such columns (a server not migrated yet). */
export function lockFromRow(r: LockRow): ProfileLock | undefined {
  if (!("pin_hash" in r) || !("viewing_limit" in r)) return;
  return readLock({ pin: r.pin_hash, viewingLimit: r.viewing_limit, hideUnrated: r.viewing_hide_unrated });
}

/** The columns a change to the lock writes. */
export function lockToRow(patch: Partial<ProfileLock>): LockRow {
  const row: LockRow = {};
  if ("pin" in patch) row.pin_hash = patch.pin ?? null;
  if ("viewingLimit" in patch) row.viewing_limit = limitOf(patch.viewingLimit);
  if ("hideUnrated" in patch) row.viewing_hide_unrated = patch.hideUnrated === true;
  return row;
}
