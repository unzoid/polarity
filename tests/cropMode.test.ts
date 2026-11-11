import { expect, test } from "bun:test";
import { cropsBars, nextCropMode, shownCropMode, type CropMode } from "../src/lib/settings/cropMode";

/** prefs.ts reads localStorage once, as it loads: each case loads a fresh copy over its own storage. */
async function loadWith(stored: Record<string, unknown> | null, tag: string) {
  const mem = new Map(stored ? [["polar.prefs", JSON.stringify(stored)]] : []);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const m = (await import(`../src/lib/settings/prefs?crop-${tag}`)) as typeof import("../src/lib/settings/prefs");
  return m.getPrefs();
}

test("the crop button cycles Fit, Crop black bars, Fill window (#330)", () => {
  const seen: CropMode[] = [];
  let mode: CropMode = "fit";
  for (let i = 0; i < 4; i++) seen.push((mode = nextCropMode(mode, true)));
  expect(seen).toEqual(["bars", "fill", "fit", "bars"]);
});

test("where autocrop can't run, the cycle skips Crop black bars and Fill doesn't crop bars first", () => {
  expect(nextCropMode("fit", false)).toBe("fill");
  expect(nextCropMode("fill", false)).toBe("fit");
  // Crop black bars chosen elsewhere (Settings on a device with mpv) shows as Fit here; the next press fills.
  expect(shownCropMode("bars", false)).toBe("fit");
  expect(nextCropMode("bars", false)).toBe("fill");
  expect(shownCropMode("bars", true)).toBe("bars");
  expect([cropsBars("fit"), cropsBars("bars"), cropsBars("fill")]).toEqual([false, true, true]);
});

test("the old autocrop switch and Fill carry over into the crop mode", async () => {
  expect((await loadWith(null, "new")).cropMode).toBe("fit");
  expect((await loadWith({ autocrop: false, videoFill: false }, "off")).cropMode).toBe("fit");
  expect((await loadWith({ autocrop: true }, "autocrop")).cropMode).toBe("bars");
  expect((await loadWith({ autocrop: true, videoFill: true }, "both")).cropMode).toBe("fill");
  expect((await loadWith({ videoFill: true }, "fill")).cropMode).toBe("fill");
  // Once stored, the mode stands over leftovers; one that isn't a mode is Fit.
  expect((await loadWith({ cropMode: "fit", autocrop: true }, "chosen")).cropMode).toBe("fit");
  expect((await loadWith({ cropMode: "zoom" }, "odd")).cropMode).toBe("fit");
  const p = await loadWith({ autocrop: true }, "keys");
  expect("autocrop" in p || "videoFill" in p).toBe(false);
});
