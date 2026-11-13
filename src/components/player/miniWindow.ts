/**
 * The player's Picture in Picture on desktop: the app's window becomes a small player in a corner of its
 * screen, on top of every other window, and goes back to its own size, place, maximised or fullscreen state
 * when it's left (or the player is). Never remembered. Plain code with the window calls passed in, like
 * windowPin.ts, so tests/miniWindow.test.ts drives it with fakes.
 */

import type { Bounds, WorkArea } from "../../lib/platform/window";

export type { Bounds, WorkArea };

export interface MiniHost {
  isFullscreen(): Promise<boolean>;
  setFullscreen(on: boolean): Promise<void>;
  isMaximized(): Promise<boolean>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  bounds(): Promise<Bounds>;
  setBounds(b: Bounds): Promise<void>;
  /** The screen the window is on. */
  workArea(): Promise<WorkArea | null>;
  /** In logical pixels; null for none. */
  setMinSize(size: { width: number; height: number } | null): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
}

/** The app window's own smallest size (tauri.conf.json `minWidth` / `minHeight`), put back on leaving. */
export const APP_MIN = { width: 960, height: 600 };
/** The smallest the mini player can be dragged to (logical px). */
export const MINI_MIN = { width: 320, height: 180 };
/** How far from the screen's edges it sits (logical px). */
const MARGIN = 24;

/** Where the mini player goes: 16:9, about a quarter of the screen's width (360 to 640 logical px), bottom right. */
export function miniBounds(area: WorkArea): Bounds {
  const s = area.scale || 1;
  const width = Math.round(Math.min(640, Math.max(360, area.width / s / 4)) * s);
  const height = Math.round((width * 9) / 16);
  const margin = Math.round(MARGIN * s);
  return { x: area.x + area.width - width - margin, y: area.y + area.height - height - margin, width, height };
}

export function createMiniWindow(host: MiniHost, onChange: (mini: boolean) => void) {
  let mini = false;
  let saved: { bounds: Bounds; maximized: boolean; fullscreen: boolean } | null = null;
  // One change at a time, in the order asked (as windowPin.ts).
  let queue = Promise.resolve();
  const restore = async () => {
    const was = saved;
    saved = null;
    await Promise.allSettled([host.setAlwaysOnTop(false), host.setMinSize(APP_MIN)]);
    if (!was) return;
    await host.setBounds(was.bounds).catch(() => {});
    if (was.maximized) await host.maximize().catch(() => {});
    if (was.fullscreen) await host.setFullscreen(true).catch(() => {});
  };
  const set = (next: () => boolean) =>
    (queue = queue.then(async () => {
      const on = next();
      if (on === mini) return;
      if (!on) {
        await restore();
        mini = false;
        return onChange(false);
      }
      try {
        const fullscreen = await host.isFullscreen();
        if (fullscreen) await host.setFullscreen(false);
        const maximized = await host.isMaximized();
        if (maximized) await host.unmaximize();
        saved = { bounds: await host.bounds(), maximized, fullscreen };
        const area = await host.workArea();
        if (!area) throw new Error("no screen");
        await host.setMinSize(MINI_MIN);
        await host.setBounds(miniBounds(area));
        await host.setAlwaysOnTop(true);
        mini = true;
      } catch {
        // Half way is worse than not at all: the window goes back as it was.
        await restore();
        mini = false;
      }
      onChange(mini);
    }));
  return {
    get mini() {
      return mini;
    },
    enter: () => set(() => true),
    leave: () => set(() => false),
    toggle: () => set(() => !mini),
  };
}

export type MiniWindow = ReturnType<typeof createMiniWindow>;
