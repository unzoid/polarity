import type { Profile } from "./backend";

/**
 * Who may do what with the account's profiles, given their PINs and viewing limits (profileLock.ts). Pure: the
 * screens ask here, and the prompt (components/profileLock) asks for what the answer names.
 *
 * - A profile with a viewing limit on its row is restricted. From it (or from "Who's watching?" before any
 *   profile is in, while the account has a restricted one), editing, adding or deleting profiles, and the
 *   account's own settings, need the PIN of an unrestricted profile that has one, or, when none has a PIN,
 *   the account itself (a code sent to its email).
 * - Entering a profile with a PIN needs its PIN, wherever from.
 * - Changing or removing a profile's PIN or limit needs its PIN, when it has one; a forgotten PIN gives way to
 *   the account. Deleting a profile with a PIN needs it too.
 */

/** What unlocks an action: nothing, a PIN of one of `profiles`, or the account. */
export type Unlock = { by: "none" } | { by: "pin"; profiles: Profile[] } | { by: "account" };

const NONE: Unlock = { by: "none" };

export const hasPin = (p: Profile | null | undefined) => !!p?.lock?.pin;

export const isRestricted = (p: Profile | null | undefined) => p?.lock?.viewingLimit != null;

/** The profiles whose PIN lets someone past a restricted profile: unrestricted ones with a PIN. */
export const guardiansOf = (profiles: Profile[]) => profiles.filter((p) => hasPin(p) && !isRestricted(p));

/** Whether `actor` (the profile in use; null on "Who's watching?" before one is in) is held back. */
export function heldBack(actor: Profile | null, profiles: Profile[]): boolean {
  return actor ? isRestricted(actor) : profiles.some(isRestricted);
}

/** What lets `actor` manage profiles or reach the account's settings. */
export function unlockToManage(actor: Profile | null, profiles: Profile[]): Unlock {
  if (!heldBack(actor, profiles)) return NONE;
  const guardians = guardiansOf(profiles);
  return guardians.length ? { by: "pin", profiles: guardians } : { by: "account" };
}

/** What lets anyone into `target`. */
export const unlockToEnter = (target: Profile): Unlock => (hasPin(target) ? { by: "pin", profiles: [target] } : NONE);

/** What lets someone change `target`'s PIN or limit, or delete it (after `unlockToManage`). */
export const unlockToChangeLock = unlockToEnter;

/**
 * Whether setting a limit on `target` should say that, without a PIN on an unrestricted profile, anyone can
 * switch away from it: no unrestricted profile but `target` itself has one.
 */
export function needsGuardianAdvice(target: Profile, profiles: Profile[]): boolean {
  return !guardiansOf(profiles).some((p) => p.id !== target.id);
}

/** Whether the account server keeps PINs and limits (an older one leaves `lock` out). */
export const locksAvailable = (p: Profile | null | undefined) => p?.lock !== undefined;
