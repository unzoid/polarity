import { expect, test } from "bun:test";
import { uiFontOf } from "../src/lib/settings/fonts";

test("a saved app font is kept when the app knows it, else it's Inter", () => {
  for (const f of ["inter", "instrument", "hanken", "onest", "mona", "system", "opendyslexic"] as const) expect(uiFontOf(f)).toBe(f);
  expect(uiFontOf("netflix")).toBe("instrument");
  expect(uiFontOf(undefined)).toBe("instrument");
});
