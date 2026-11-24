import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Profile, ProfileLock } from "../src/lib/account/backend";
import { hashPin } from "../src/lib/account/pin";
import { guardEnter, guardLockChange, guardManage, setNewPin, type GuardContext } from "../src/lib/account/profileGuard";
import { checkPin, endUnlocks, manageGranted, setPinAsker, takeEnterGrant, type PinAnswer, type PinRequest } from "../src/lib/account/unlock";

const store = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

const HASH = await hashPin("4321", { iterations: 1000 });
const p = (id: string, lock: Partial<ProfileLock> = {}): Profile => ({ id, name: id, avatar: "fox", position: 0, lock: { pin: null, viewingLimit: null, hideUnrated: false, ...lock } }) as Profile;

let asked: PinRequest[] = [];
let answers: PinAnswer[] = [];
let locks: [string, Partial<ProfileLock>][] = [];
let undo: () => void;
beforeEach(() => {
  asked = [];
  answers = [];
  locks = [];
  endUnlocks();
  undo = setPinAsker(async (r) => (asked.push(r), answers.shift() ?? null));
});
afterEach(() => {
  undo();
  localStorage.removeItem("polar.pinTries");
});

const ctx = (actor: Profile | null, profiles: Profile[]): GuardContext => ({
  actor,
  profiles,
  reauth: { email: "parent@example.com", start: async () => {}, verify: async () => {} },
  setLock: async (id, patch) => void locks.push([id, patch]),
});

const parent = p("parent", { pin: HASH });
const kid = p("kid", { viewingLimit: 9 });

test("a restricted profile asks for the guardian's PIN once, then not again for a while", async () => {
  answers = [{ profile: "parent", pin: "4321" }];
  expect(await guardManage(ctx(kid, [parent, kid]))).toBe(true);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ kind: "check", profiles: [parent] });
  expect(manageGranted("kid")).toBe(true);
  expect(await guardManage(ctx(kid, [parent, kid]))).toBe(true);
  expect(asked).toHaveLength(1);
  // A PIN hashed with fewer rounds is hashed again, in the background (up to 10 s on a slow CI runner).
  for (let i = 0; i < 500 && !locks.length; i++) await Bun.sleep(20);
  expect(locks[0]?.[0]).toBe("parent");
});

test("cancelled, the restricted profile is refused", async () => {
  expect(await guardManage(ctx(kid, [parent, kid]))).toBe(false);
  expect(manageGranted("kid")).toBe(false);
});

test("without a guardian's PIN in the account, the account itself is asked", async () => {
  answers = [true];
  expect(await guardManage(ctx(kid, [p("other"), kid]))).toBe(true);
  expect(asked[0]).toMatchObject({ kind: "account" });
});

test("an unrestricted profile manages without being asked", async () => {
  expect(await guardManage(ctx(parent, [parent, kid]))).toBe(true);
  expect(asked).toHaveLength(0);
});

test("entering a profile with a PIN asks once; the grant is used by the account layer", async () => {
  answers = [{ profile: "parent", pin: "4321" }];
  expect(await guardEnter(parent, ctx(kid, [parent, kid]))).toBe(true);
  expect(takeEnterGrant("parent")).toBe(true);
  expect(takeEnterGrant("parent")).toBe(false);
  expect(await guardEnter(kid, ctx(parent, [parent, kid]))).toBe(true);
  expect(asked).toHaveLength(1);
});

test("a forgotten PIN, confirmed through the account, is removed", async () => {
  answers = ["account"];
  expect(await guardEnter(parent, ctx(null, [parent, kid]))).toBe(true);
  expect(asked[0]).toMatchObject({ kind: "check", forgot: { email: "parent@example.com" } });
  expect(locks).toEqual([["parent", { pin: null }]]);
});

test("changing a profile's PIN asks for its current one; a new PIN is stored hashed", async () => {
  answers = [{ profile: "parent", pin: "4321" }, { pin: "0007" }];
  expect(await guardLockChange(parent, ctx(parent, [parent, kid]))).toBe(true);
  expect(await setNewPin(parent, ctx(parent, [parent, kid]))).toBe(true);
  expect(asked[1]).toMatchObject({ kind: "new" });
  // The typed PIN's rehash (fewer rounds than this version's) is written in the background and can land before or
  // after the new PIN on a slow machine: the new PIN is whichever stored PIN "0007" opens. Each is checked as a
  // profile of its own, so a miss doesn't count as a wrong try against the parent.
  const pins = locks.map(([, lock]) => lock.pin).filter((p): p is string => !!p);
  const opens = await Promise.all(pins.map((pin, i) => checkPin({ ...parent, id: `stored-${i}`, lock: { ...parent.lock!, pin } }, "0007")));
  const stored = pins[opens.findIndex((r) => r.ok)];
  expect(stored).toBeDefined();
  expect(stored).not.toContain("0007");
});

test("checking: wrong PINs back off on the device, and nothing is checked while waiting", async () => {
  for (let i = 0; i < 2; i++) expect(await checkPin(parent, "0000", 1000)).toEqual({ ok: false, wait: 0 });
  expect(await checkPin(parent, "0000", 1000)).toEqual({ ok: false, wait: 30_000 });
  // The right PIN doesn't get through during the wait…
  expect(await checkPin(parent, "4321", 2000)).toEqual({ ok: false, wait: 29_000 });
  // …and does after it, clearing the count.
  expect(await checkPin(parent, "4321", 40_000)).toEqual({ ok: true });
  expect(await checkPin(parent, "0000", 40_000)).toEqual({ ok: false, wait: 0 });
});
