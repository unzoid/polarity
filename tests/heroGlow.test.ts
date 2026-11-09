import { describe, expect, test } from "bun:test";
import { glowColor, type Rgb } from "../src/lib/ui/heroGlow";

/** RGBA pixels: `n` of each colour (a grey level or [r, g, b]), opaque. */
function pixels(...runs: [n: number, colour: number | Rgb][]) {
  const out: number[] = [];
  for (const [n, colour] of runs) {
    const [r, g, b] = typeof colour === "number" ? [colour, colour, colour] : colour;
    for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  }
  return out;
}

/** Which of red, green or blue is strongest. */
const dominant = ([r, g, b]: Rgb) => (r >= g && r >= b ? "red" : g >= b ? "green" : "blue");

describe("glowColor", () => {
  test("takes the hue most of the colourful picture shares, not the average of everything", () => {
    // Mostly dark, a large teal area and a small red one: teal, though the average is a muddy grey.
    const c = glowColor(pixels([500, 12], [300, [20, 140, 150]], [60, [200, 30, 30]]))!;
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[2]).toBeGreaterThan(c[0]);
  });

  test("vivid pixels outweigh a larger dull area of another hue", () => {
    const c = glowColor(pixels([200, [110, 95, 80]], [150, [230, 120, 20]], [100, [40, 60, 200]]))!;
    expect(dominant(c)).toBe("red");
  });

  test("keeps a colour that glows on a dark page, however dark or pale the art", () => {
    for (const art of [pixels([400, [30, 8, 8]]), pixels([400, [250, 220, 220]])]) {
      const c = glowColor(art)!;
      const l = (Math.max(...c) + Math.min(...c)) / 510;
      expect(l).toBeGreaterThan(0.3);
      expect(l).toBeLessThan(0.48);
      expect(dominant(c)).toBe("red");
    }
  });

  test("a grey picture gives a grey glow, and no pixels none", () => {
    const [r, g, b] = glowColor(pixels([400, 90], [400, 160]))!;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    expect(glowColor([])).toBeNull();
  });
});
