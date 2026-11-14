import { isRecord, num, count, storedJson } from "../parse";

/**
 * Wrong PINs back off, on this device and per profile: a few tries free, then a wait that doubles with each
 * wrong one, up to an hour. Kept in localStorage, so closing the app doesn't start the count again; a right PIN
 * clears it.
 */

export interface Tries {
  /** Wrong PINs in a row. */
  fails: number;
  /** No try before this time (ms since the epoch). */
  until: number;
}

export const FREE_TRIES = 3;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 60 * 60_000;
const NONE: Tries = { fails: 0, until: 0 };

/** The wait after `fails` wrong PINs in a row. */
export function waitAfter(fails: number): number {
  if (fails < FREE_TRIES) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (fails - FREE_TRIES), MAX_WAIT_MS);
}

/** After one more wrong PIN at `now`. */
export const afterFailure = (t: Tries, now: number): Tries => ({ fails: t.fails + 1, until: now + waitAfter(t.fails + 1) });

/**
 * How long until the next try (0: now). Never longer than the wait the count calls for, so a clock set back
 * doesn't lock the profile for longer.
 */
export const waitLeft = (t: Tries, now: number) => Math.max(0, Math.min(t.until - now, waitAfter(t.fails)));

const KEY = "polar.pinTries";

function readAll(): Record<string, Tries> {
  const v = storedJson(globalThis.localStorage, KEY);
  if (!isRecord(v)) return {};
  const out: Record<string, Tries> = {};
  for (const [id, t] of Object.entries(v)) {
    if (!isRecord(t)) continue;
    const fails = count(t.fails);
    const until = num(t.until);
    if (fails !== undefined && until !== undefined) out[id] = { fails, until };
  }
  return out;
}

function writeAll(all: Record<string, Tries>) {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full or blocked: the wait holds until the app closes.
  }
}

/** A profile's wrong tries on this device. */
export const triesOf = (profileId: string): Tries => readAll()[profileId] ?? NONE;

/** Counts a wrong PIN; returns the new state. */
export function recordFailure(profileId: string, now = Date.now()): Tries {
  const all = readAll();
  const next = afterFailure(all[profileId] ?? NONE, now);
  writeAll({ ...all, [profileId]: next });
  return next;
}

/** A right PIN: the count starts again. */
export function clearTries(profileId: string) {
  const all = readAll();
  if (!(profileId in all)) return;
  delete all[profileId];
  writeAll(all);
}

/** "Try again in 2 minutes." */
export function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `Try again in ${s} second${s === 1 ? "" : "s"}.`;
  const m = Math.ceil(s / 60);
  return `Try again in ${m} minute${m === 1 ? "" : "s"}.`;
}
