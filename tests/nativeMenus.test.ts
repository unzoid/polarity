import { describe, expect, test } from "bun:test";
import { pickedSpeed, speedMenu } from "../src/components/player/nativeMenus";

describe("the player's iOS menus", () => {
  test("speed: every speed, the current one ticked, the pick read back", () => {
    const menu = speedMenu([0.5, 1, 1.5], 1.5);
    expect(menu.actions.map((a) => [a.label, a.checked])).toEqual([
      ["0.5x", false],
      ["1x (Normal)", false],
      ["1.5x", true],
    ]);
    expect(pickedSpeed(menu.actions[0].id)).toBe(0.5);
    expect(pickedSpeed(null)).toBeNull();
    expect(pickedSpeed("x")).toBeNull();
  });
});
