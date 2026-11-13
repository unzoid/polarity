import { expect, test } from "bun:test";
import { APP_MIN, createMiniWindow, miniBounds, MINI_MIN, type Bounds, type MiniHost } from "../src/components/player/miniWindow";

function fakeWindow(start: Partial<{ fullscreen: boolean; maximized: boolean }> = {}, fail?: "bounds") {
  const normal: Bounds = { x: 100, y: 80, width: 1440, height: 900 };
  const state = { fullscreen: false, maximized: false, onTop: false, min: APP_MIN as { width: number; height: number } | null, bounds: normal, ...start };
  const host: MiniHost = {
    isFullscreen: async () => state.fullscreen,
    setFullscreen: async (on) => void (state.fullscreen = on),
    isMaximized: async () => state.maximized,
    maximize: async () => void (state.maximized = true),
    unmaximize: async () => void (state.maximized = false),
    bounds: async () => state.bounds,
    setBounds: async (b) => {
      if (fail === "bounds" && b.width < 1000) throw new Error("refused");
      state.bounds = b;
    },
    workArea: async () => ({ x: 0, y: 0, width: 2560, height: 1400, scale: 1 }),
    setMinSize: async (m) => void (state.min = m),
    setAlwaysOnTop: async (on) => void (state.onTop = on),
  };
  return { host, state, normal };
}

test("the mini player sits bottom right at a quarter of the screen, 16:9, scaled for the screen", () => {
  expect(miniBounds({ x: 0, y: 0, width: 2560, height: 1400, scale: 1 })).toEqual({ x: 2560 - 640 - 24, y: 1400 - 360 - 24, width: 640, height: 360 });
  // A 4K screen at 200%: the same size in logical pixels.
  expect(miniBounds({ x: 0, y: 0, width: 3840, height: 2100, scale: 2 })).toEqual({ x: 3840 - 960 - 48, y: 2100 - 540 - 48, width: 960, height: 540 });
  // A second screen to the left of the first: inside that screen.
  expect(miniBounds({ x: -1920, y: 0, width: 1920, height: 1040, scale: 1 }).x).toBe(-1920 + 1920 - 480 - 24);
});

test("entering shrinks the window on top of the others; leaving puts back its size and place", async () => {
  const { host, state, normal } = fakeWindow();
  const seen: boolean[] = [];
  const mini = createMiniWindow(host, (m) => seen.push(m));
  await mini.enter();
  expect(state.onTop).toBe(true);
  expect(state.bounds.width).toBe(640);
  expect(state.min).toEqual(MINI_MIN);
  await mini.toggle();
  expect(state).toEqual({ fullscreen: false, maximized: false, onTop: false, min: APP_MIN, bounds: normal });
  expect(seen).toEqual([true, false]);
});

test("a maximised or fullscreen window comes back maximised or fullscreen", async () => {
  for (const start of [{ maximized: true }, { fullscreen: true }]) {
    const { host, state } = fakeWindow(start);
    const mini = createMiniWindow(host, () => {});
    await mini.enter();
    expect(state.fullscreen || state.maximized).toBe(false);
    await mini.leave();
    expect(state).toMatchObject(start);
  }
});

test("a window that refuses to shrink is left as it was, not on top", async () => {
  const { host, state, normal } = fakeWindow({}, "bounds");
  const mini = createMiniWindow(host, () => {});
  await mini.enter();
  expect(mini.mini).toBe(false);
  expect(state).toMatchObject({ onTop: false, min: APP_MIN, bounds: normal });
});
