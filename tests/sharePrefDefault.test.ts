import { expect, test } from "bun:test";

/** prefs.ts reads localStorage once, as it loads: each case loads a fresh copy over its own storage. */
async function loadWith(entries: Record<string, string>, tag: string) {
  const mem = new Map(Object.entries(entries));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const m = (await import(`../src/lib/settings/prefs?${tag}`)) as typeof import("../src/lib/settings/prefs");
  return m.getPrefs().shareSetup;
}

test("new installs share add-ons and keys between the account's profiles (#429)", async () => {
  expect(await loadWith({}, "new")).toBe("account");
});

test("the switch from before #429: Off is Not shared; On, and installs from before the switch, are this account's profiles", async () => {
  expect(await loadWith({ "polar.prefs": JSON.stringify({ shareAddonsAndKeys: false }), "polar.settingsOwner": "p1" }, "off")).toBe("none");
  expect(await loadWith({ "polar.prefs": JSON.stringify({ shareAddonsAndKeys: true }) }, "on")).toBe("account");
  expect(await loadWith({ "polar.settingsOwner": "local" }, "owner")).toBe("account");
  expect(await loadWith({ "polar.prefs": JSON.stringify({ uiSounds: false }) }, "before80")).toBe("account");
});

test("a choice made stands", async () => {
  for (const v of ["none", "account", "device"]) expect(await loadWith({ "polar.prefs": JSON.stringify({ shareSetup: v, shareAddonsAndKeys: false }) }, `chosen-${v}`)).toBe(v);
});
