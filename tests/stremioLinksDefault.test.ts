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
  return m.getPrefs().stremioLinks;
}

test("Stremio links open in Polarity on new installs, and where prefs never held the setting (#428)", async () => {
  expect(await loadWith({}, "links-new")).toBe(true);
  expect(await loadWith({ "polar.prefs": JSON.stringify({ uiSounds: false }) }, "links-before163")).toBe(true);
});

test("a stored choice stands (#428)", async () => {
  expect(await loadWith({ "polar.prefs": JSON.stringify({ uiSounds: true, stremioLinks: false }) }, "links-off")).toBe(false);
  expect(await loadWith({ "polar.prefs": JSON.stringify({ stremioLinks: true }) }, "links-on")).toBe(true);
});
