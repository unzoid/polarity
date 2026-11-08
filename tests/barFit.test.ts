import { describe, expect, test } from "bun:test";
import { ACTION_SPACE, fitLabels, fitTop, TITLE_ROOM, type TopWidths } from "../src/components/player/useBarFit";

// A Windows window at its narrowest (960 px): Back, volume with slider, pin, fill, fullscreen, window buttons.
const narrow: TopWidths = { room: 940, gaps: 32, back: 44, title: 300, end: 420, slider: 100, movable: 48 };

describe("the player's top bar gives way in steps (#396)", () => {
  test("everything stays while the title has its room", () => {
    expect(fitTop(narrow)).toEqual({ slider: true, more: false });
  });

  test("a longer title first folds the volume slider", () => {
    // 940 - 32 - 44 - 420 = 444 free; a long title wants TITLE_ROOM.
    expect(fitTop({ ...narrow, title: 900, room: 940 - (444 - TITLE_ROOM) - 1 })).toEqual({ slider: false, more: false });
  });

  test("then pin and fill move into More", () => {
    expect(fitTop({ ...narrow, title: 900, room: 700 })).toEqual({ slider: false, more: true });
  });

  test("with nothing worth moving (one button), only the slider folds", () => {
    expect(fitTop({ ...narrow, title: 900, room: 700, movable: 0 })).toEqual({ slider: false, more: false });
  });

  test("a short title needs only its own width", () => {
    expect(fitTop({ ...narrow, title: 120, room: 650 })).toEqual({ slider: true, more: false });
  });
});

describe("the bottom actions drop their words when they don't fit (#396)", () => {
  const widths = [150, 140, 220, 130, 200, 170];
  const total = widths.reduce((a, b) => a + b) + (widths.length - 1) * ACTION_SPACE;
  test("they keep their words with room for them and the space between", () => {
    expect(fitLabels(widths, total)).toBe(true);
  });
  test("one pixel less and the words go", () => {
    expect(fitLabels(widths, total - 1)).toBe(false);
  });
  test("no actions always fit", () => {
    expect(fitLabels([], 0)).toBe(true);
  });
});
