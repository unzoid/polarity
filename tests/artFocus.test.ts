import { describe, expect, test } from "bun:test";
import { artFocusX, focusPosition } from "../src/lib/ui/artFocus";

/** A `w`×`h` picture, flat grey but for a checkerboard in the columns from `from` up to `to`. */
function busy(w: number, h: number, from: number, to: number) {
  const out: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = x >= from && x < to ? ((x + y) % 2 ? 230 : 20) : 90;
      out.push(v, v, v, 255);
    }
  return out;
}

describe("artFocusX", () => {
  test("a subject on the right puts the focus on the right", () => {
    expect(artFocusX(busy(48, 27, 34, 44), 48)).toBeGreaterThan(0.7);
  });
  test("a subject on the left puts it on the left", () => {
    expect(artFocusX(busy(48, 27, 4, 14), 48)).toBeLessThan(0.3);
  });
  test("a flat picture is centred", () => {
    expect(artFocusX(busy(48, 27, 0, 0), 48)).toBe(0.5);
  });
});

describe("focusPosition", () => {
  test("puts the focus in the middle of the strip shown", () => {
    // A third of the picture shown, the subject at 0.5: the strip is 0.333–0.667, object-position 50%.
    expect(focusPosition(0.5, 1 / 3)).toBeCloseTo(0.5);
    expect(focusPosition(0.75, 0.5)).toBeCloseTo(1);
  });
  test("stops at the picture's edges", () => {
    expect(focusPosition(0.95, 0.4)).toBe(1);
    expect(focusPosition(0.05, 0.4)).toBe(0);
  });
  test("the whole picture shown needs no shift", () => {
    expect(focusPosition(0.9, 1)).toBe(0.5);
  });
});
