import { expect, test } from "bun:test";
import type { Profile } from "../src/lib/account/backend";
import { readProfile } from "../src/lib/account/backend";
import { lockFromRow, lockToRow, readLock } from "../src/lib/account/profileLock";
import { guardiansOf, heldBack, isRestricted, locksAvailable, needsGuardianAdvice, unlockToChangeLock, unlockToEnter, unlockToManage } from "../src/lib/account/profileRules";

const HASH = "pbkdf2-sha256$1000$AAECAwQFBgcICQoLDA0ODw$IkDqKiJ1SjxGEDVu-OTXrPJa8qw9LRGGbel6i3gSxSw";
const p = (id: string, lock?: Partial<NonNullable<Profile["lock"]>> | null): Profile =>
  ({ id, name: id, avatar: "fox", position: 0, ...(lock !== null && { lock: { pin: null, viewingLimit: null, hideUnrated: false, ...lock } }) }) as Profile;

const parent = p("parent", { pin: HASH });
const other = p("other");
const kid = p("kid", { viewingLimit: 9 });
const lockedKid = p("lockedKid", { viewingLimit: 12, pin: HASH });

test("a profile with a limit on its row is restricted; one with a PIN and no limit guards it", () => {
  expect([parent, other, kid, lockedKid].map(isRestricted)).toEqual([false, false, true, true]);
  expect(guardiansOf([parent, other, kid, lockedKid]).map((x) => x.id)).toEqual(["parent"]);
});

test("from a restricted profile, managing needs a guardian's PIN, or the account when none has one", () => {
  expect(unlockToManage(kid, [parent, other, kid])).toEqual({ by: "pin", profiles: [parent] });
  const second = p("second", { pin: HASH });
  expect(unlockToManage(kid, [parent, second, kid])).toEqual({ by: "pin", profiles: [parent, second] });
  expect(unlockToManage(kid, [other, kid])).toEqual({ by: "account" });
  // Its own PIN isn't enough: it's restricted.
  expect(unlockToManage(lockedKid, [other, lockedKid])).toEqual({ by: "account" });
});

test("from an unrestricted profile, managing asks nothing", () => {
  expect(unlockToManage(other, [parent, other, kid])).toEqual({ by: "none" });
  expect(unlockToManage(parent, [parent, kid])).toEqual({ by: "none" });
});

test("on 'Who's watching?' before a profile is in, managing asks while the account has a restricted profile", () => {
  expect(heldBack(null, [parent, other])).toBe(false);
  expect(unlockToManage(null, [parent, other])).toEqual({ by: "none" });
  expect(unlockToManage(null, [parent, other, kid])).toEqual({ by: "pin", profiles: [parent] });
});

test("entering asks for the profile's own PIN only, from anywhere", () => {
  expect(unlockToEnter(parent)).toEqual({ by: "pin", profiles: [parent] });
  expect(unlockToEnter(other)).toEqual({ by: "none" });
  expect(unlockToEnter(kid)).toEqual({ by: "none" });
  expect(unlockToChangeLock(lockedKid)).toEqual({ by: "pin", profiles: [lockedKid] });
});

test("a limit set while no other unrestricted profile has a PIN is said to leave a way around it", () => {
  expect(needsGuardianAdvice(kid, [other, kid])).toBe(true);
  expect(needsGuardianAdvice(kid, [parent, kid])).toBe(false);
  // The profile being limited can't be its own guardian.
  expect(needsGuardianAdvice(parent, [parent, kid])).toBe(true);
});

test("a server without the columns leaves `lock` out, and nothing is restricted", () => {
  const old = p("old", null);
  expect(locksAvailable(old)).toBe(false);
  expect(isRestricted(old)).toBe(false);
  expect(lockFromRow({ id: "x" } as never)).toBeUndefined();
});

test("the row and the cached copy read and write the same lock", () => {
  const row = lockToRow({ pin: HASH, viewingLimit: 12, hideUnrated: true });
  expect(row).toEqual({ pin_hash: HASH, viewing_limit: 12, viewing_hide_unrated: true });
  expect(lockFromRow(row)).toEqual({ pin: HASH, viewingLimit: 12, hideUnrated: true });
  expect(lockToRow({ viewingLimit: 0 })).toEqual({ viewing_limit: null });
  // Unrated titles hide only with a limit; nonsense reads as none.
  expect(readLock({ pin: "", viewingLimit: 99, hideUnrated: true })).toEqual({ pin: null, viewingLimit: null, hideUnrated: false });
  const cached = readProfile(JSON.parse(JSON.stringify(lockedKid)));
  expect(cached?.lock).toEqual(lockedKid.lock);
  expect(readProfile({ id: "a", name: "A" })?.lock).toBeUndefined();
});
