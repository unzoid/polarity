import { describe, expect, test } from "bun:test";
import { glowColor, glowScrim, glowSpotlight, type Rgb } from "../src/lib/ui/heroGlow";

/** RGBA pixels: `n` of each colour (a grey level or [r, g, b]), opaque. */
function pixels(...runs: [n: number, colour: number | Rgb][]) {
  const out: number[] = [];
  for (const [n, colour] of runs) {
    const [r, g, b] = typeof colour === "number" ? [colour, colour, colour] : colour;
    for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  }
  return out;
}

/** A `w`×`h` picture: `inner` in the middle third each way, `outer` around it. */
function framed(w: number, h: number, inner: Rgb, outer: Rgb) {
  const out: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mid = x >= w / 3 && x < (2 * w) / 3 && y >= h / 3 && y < (2 * h) / 3;
      out.push(...(mid ? inner : outer), 255);
    }
  return out;
}

/** Which of red, green or blue is strongest. */
const dominant = ([r, g, b]: Rgb) => (r >= g && r >= b ? "red" : g >= b ? "green" : "blue");
const lightness = (c: Rgb) => (Math.max(...c) + Math.min(...c)) / 510;

describe("glowColor", () => {
  test("takes the hue most of the colourful picture shares, not the average of everything", () => {
    // Mostly dark, a large teal area and a small red one: teal, though the average is a muddy grey.
    const c = glowColor(pixels([500, 12], [300, [20, 140, 150]], [60, [200, 30, 30]]))!;
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[2]).toBeGreaterThan(c[0]);
  });

  test("a face in the middle of a blue setting gives blue, not skin (Dexter)", () => {
    // The middle third is a ninth of the picture; make the face a little bigger in count by brightness alone.
    const c = glowColor(framed(30, 30, [215, 150, 110], [70, 170, 230]), 30)!;
    expect(dominant(c)).toBe("blue");
  });

  test("is always a dark shade, however bright or dark the art, as Netflix's page colours are", () => {
    for (const art of [pixels([400, [30, 8, 8]]), pixels([400, [250, 120, 120]]), pixels([400, [0, 255, 255]])]) {
      const c = glowColor(art)!;
      expect(lightness(c)).toBeGreaterThan(0.08);
      expect(lightness(c)).toBeLessThan(0.22);
    }
    expect(dominant(glowColor(pixels([400, [250, 120, 120]]))!)).toBe("red");
  });

  test("a dull, mostly grey picture with a faintly green patch gives a near-neutral, not green", () => {
    // Dark blue-grey people over a greyish lawn: the lawn is only faintly green.
    const [r, g, b] = glowColor(pixels([500, [40, 46, 56]], [300, [52, 64, 50]], [40, [30, 120, 40]]))!;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10);
    expect(b).toBeGreaterThanOrEqual(g);
  });

  test("a grey picture gives a grey glow, and no pixels none", () => {
    const [r, g, b] = glowColor(pixels([400, 90], [400, 160]))!;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(8);
    expect(glowColor([])).toBeNull();
  });
});

describe("glowSpotlight and glowScrim", () => {
  test("glowSpotlight lifts lightness while preserving dominant hue without white washout", () => {
    const base: Rgb = [19, 25, 42]; // Netflix deep indigo
    const hi = glowSpotlight(base);
    expect(lightness(hi)).toBeGreaterThan(lightness(base) * 1.8);
    expect(lightness(hi)).toBeLessThanOrEqual(0.4);
    expect(dominant(hi)).toBe("blue");
    // Saturation stays rich (not washed toward white)
    expect(hi[2] - hi[0]).toBeGreaterThan(base[2] - base[0]);
  });

  test("glowScrim stays deep and hue-matched for legible card text", () => {
    const base: Rgb = [42, 31, 14]; // warm amber
    const scrim = glowScrim(base);
    expect(lightness(scrim)).toBeLessThan(0.14);
    expect(dominant(scrim)).toBe("red");
  });
});
