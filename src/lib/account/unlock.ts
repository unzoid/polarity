import { useSyncExternalStore } from "react";
import type { Profile } from "./backend";
import type { ProfileLock } from "./profileLock";
import { verifyPin } from "./pin";
import { clearTries, recordFailure, triesOf, waitLeft } from "./pinTries";

/**
 * The state behind profile PINs on this device: the lock of the profile in use (for the viewing limit), how
 * long an unlock lasts, and the one prompt that asks for a PIN or the account (drawn by
 * components/profileLock/PinHost.tsx, which registers itself here).
 */

// --- The profile in use ----------------------------------------------------------------------------------

let active: ProfileLock | null = null;
const listeners = new Set<() => void>();

/** AccountProvider, as a profile is entered, changed or left. */
export function setActiveLock(lock: ProfileLock | null | undefined) {
  const next = lock ?? null;
  if (next === active || (next && active && next.pin === active.pin && next.viewingLimit === active.viewingLimit && next.hideUnrated === active.hideUnrated)) return;
  active = next;
  listeners.forEach((l) => l());
}

/** The PIN and limit of the profile in use; null without one (or without an account). */
export const getActiveLock = () => active;

export const onActiveLock = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useActiveLock = () => useSyncExternalStore(onActiveLock, getActiveLock, getActiveLock);

// --- Unlocks that last a moment --------------------------------------------------------------------------

/** How long an unlock to manage profiles and the account lasts, while the same profile stays in use. */
export const MANAGE_UNLOCK_MS = 10 * 60_000;
/** A PIN typed on "Who's watching?" lets the profile in without asking again inside the account layer. */
const ENTER_UNLOCK_MS = 30_000;

let manage: { actor: string | null; until: number } | null = null;
let enter: { id: string; until: number } | null = null;

export const grantManage = (actor: string | null, now = Date.now()) => void (manage = { actor, until: now + MANAGE_UNLOCK_MS });
export const manageGranted = (actor: string | null, now = Date.now()) => !!manage && manage.actor === actor && now < manage.until;
export const grantEnter = (id: string, now = Date.now()) => void (enter = { id, until: now + ENTER_UNLOCK_MS });
/** Whether `id` was just unlocked; the grant is used up. */
export function takeEnterGrant(id: string, now = Date.now()) {
  const ok = !!enter && enter.id === id && now < enter.until;
  enter = null;
  return ok;
}
/** Another profile is in, or the account signed out: every unlock ends. */
export function endUnlocks() {
  manage = null;
  enter = null;
}

// --- Checking a PIN --------------------------------------------------------------------------------------

export type PinCheck = { ok: true } | { ok: false; wait: number };

/**
 * `pin` against `profile`'s, counting wrong ones on this device (pinTries.ts). While a wait runs nothing is
 * checked: `wait` says how long is left.
 */
export async function checkPin(profile: Profile, pin: string, now = Date.now()): Promise<PinCheck> {
  const left = waitLeft(triesOf(profile.id), now);
  if (left > 0) return { ok: false, wait: left };
  const stored = profile.lock?.pin;
  if (stored && (await verifyPin(pin, stored))) {
    clearTries(profile.id);
    return { ok: true };
  }
  return { ok: false, wait: waitLeft(recordFailure(profile.id, now), now) };
}

// --- The prompt ------------------------------------------------------------------------------------------

/** The account's re-check (AccountBackend.reauth). */
export interface Reauth {
  /** Where the code goes. */
  email: string;
  start(captchaToken?: string): Promise<void>;
  verify(code: string): Promise<void>;
}

export type PinRequest =
  /** A PIN of one of `profiles` (which one, asked first when there are several). `forgot`: offer the account instead. */
  | { kind: "check"; title: string; text?: string; profiles: Profile[]; forgot?: Reauth }
  /** A new PIN, typed twice. */
  | { kind: "new"; title: string; text?: string }
  /** The account itself: a code sent to its email. */
  | { kind: "account"; title: string; text?: string; reauth: Reauth };

/**
 * `check`: the profile whose PIN was typed (and the PIN, to hash again with more rounds), or "account" when the
 * account was confirmed instead; `new`: the PIN; `account`: true. Null: cancelled.
 */
export type PinAnswer = { profile: string; pin: string } | "account" | { pin: string } | true | null;

type Asker = (request: PinRequest) => Promise<PinAnswer>;
let asker: Asker | null = null;

/** The prompt's host, while it's mounted. */
export function setPinAsker(fn: Asker) {
  asker = fn;
  return () => {
    if (asker === fn) asker = null;
  };
}

/** Asks; null (refused) when no prompt is mounted. */
export const askPin = (request: PinRequest): Promise<PinAnswer> => (asker ? asker(request) : Promise.resolve(null));
