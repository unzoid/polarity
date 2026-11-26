import { expect, test } from "bun:test";
import { uiFontOf } from "../src/lib/settings/fonts";

test("a saved app font is kept when the app knows it, else it's Polarity Sans", () => {
  for (const f of ["polarity", "inter", "system", "testsans"] as const) expect(uiFontOf(f)).toBe(f);
  for (const removed of ["instrument", "hanken", "onest", "mona", "opendyslexic", "netflix", undefined]) {
    expect(uiFontOf(removed)).toBe("polarity");
  }
});
