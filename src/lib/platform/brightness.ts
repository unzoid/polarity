import { call, inShell } from "./bridge";
import { os, type Os } from "./device";

/**
 * The screen's brightness, for the player's swipe on the left half: iOS's screen through the shell
 * (src-tauri/src/ios/brightness.m), Android's window through the page's bridge (gen/android MainActivity.kt),
 * which needs no permission. Both give the old level back when `restore` is called and while the app is in the
 * background. Where `available` is false (desktop, a browser, an older shell) nothing here does anything.
 */
export type ScreenBrightness = {
  available: boolean;
  /** The level now, 0 to 1; null where it can't be read. */
  read(): Promise<number | null>;
  /** Set it, 0 to 1, while the player is open. */
  set(level: number): void;
  /** Give back the level from before the player changed it. */
  restore(): void;
};

type Actions = { postMessage?: (message: string) => void };
export type BrightnessBridge = {
  polarActions?: Actions;
  polarDevice?: { brightness?: () => number; setBrightness?: (level: number) => void };
};

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const level = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? clamp(n) : null);
const none: ScreenBrightness = { available: false, read: () => Promise.resolve(null), set: () => {}, restore: () => {} };

/** The brightness for a system (exported for tests; the app uses `screenBrightness`). */
export function brightnessFor(system: Os, shell: boolean, scope: BrightnessBridge): ScreenBrightness {
  if (system === "ios" && shell) {
    return {
      available: true,
      read: () => call<number | null>("player_brightness").then(level, () => null),
      set: (n) => void call<void>("player_set_brightness", { level: clamp(n) }).catch(() => {}),
      restore: () => void call<void>("player_set_brightness", { level: null }).catch(() => {}),
    };
  }
  const device = scope.polarDevice;
  if (system !== "android" || typeof device?.brightness !== "function") return none;
  // The app's own pages send the change as a message; a web view too old for messages calls the interface.
  const send = (n: number | null) => {
    try {
      if (typeof scope.polarActions?.postMessage === "function") scope.polarActions.postMessage(n == null ? "brightness:off" : `brightness:${n.toFixed(3)}`);
      else device.setBrightness?.(n ?? -1);
    } catch {
      // An older shell without the call: the screen keeps its level.
    }
  };
  return {
    available: true,
    read: () => {
      try {
        return Promise.resolve(level(device.brightness?.()));
      } catch {
        return Promise.resolve(null);
      }
    },
    set: (n) => send(clamp(n)),
    restore: () => send(null),
  };
}

export const screenBrightness: ScreenBrightness = brightnessFor(os, inShell, globalThis as BrightnessBridge);
