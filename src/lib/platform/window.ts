import { getCurrentWebview } from "@tauri-apps/api/webview";
import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { call, type Unlisten } from "./bridge";
import { isDesktop, os } from "./device";

/** A window's outer position and inner size, in physical pixels. */
export type Bounds = { x: number; y: number; width: number; height: number };
/** A screen's usable area (no taskbar or dock), in physical pixels, and its scale. */
export type WorkArea = Bounds & { scale: number };

/**
 * The app's window: buttons for a frameless desktop window, fullscreen for the
 * player and TV mode, focus and size for the player's controls, and interface
 * zoom. On phones and TVs the window is the whole screen: fullscreen hides the
 * system bars and minimise/maximise do nothing.
 */
export interface AppWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMinimized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(on: boolean): Promise<void>;
  /** While the player is open: no status bar, and on iOS a home indicator that fades until the screen is touched. */
  setSystemBarsHidden(hidden: boolean): Promise<void>;
  /** Called with `false` when the window loses focus and `true` when it gets it back. */
  onFocusChanged(handler: (focused: boolean) => void): Promise<Unlisten>;
  onResized(handler: () => void): Promise<Unlisten>;
  /** Scales the whole interface (Settings → Interface size); 1 = as designed. */
  setZoom(scale: number): Promise<void>;
  /** Desktop, where the system lets an app keep itself on top (not Wayland): the player can pin the window (#266). */
  canPin(): Promise<boolean>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  /** Locked: no resizing at the edges, minimise and maximise turned off (close still works). */
  setLocked(locked: boolean): Promise<void>;
  // The player's Picture in Picture on desktop (components/player/miniWindow.ts):
  isMaximized(): Promise<boolean>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  /** Outer position and inner size, physical pixels. */
  bounds(): Promise<Bounds>;
  setBounds(b: Bounds): Promise<void>;
  /** The usable part of the screen the window is on. */
  workArea(): Promise<WorkArea | null>;
  /** Logical pixels; null for none. */
  setMinSize(size: { width: number; height: number } | null): Promise<void>;
}

// Looked up on each use: the Tauri handle can't be made outside the shell, and importing this file must not fail there.
const win = () => getCurrentWindow();

export const appWindow: AppWindow = {
  minimize: () => win().minimize(),
  toggleMaximize: () => win().toggleMaximize(),
  close: () => win().close(),
  isMinimized: () => win().isMinimized(),
  // A phone or TV app already has the whole screen, and the window commands are refused there
  // (capabilities/mobile.json): asking would reject, and the player's Back waited on the answer (#147).
  isFullscreen: () => (isDesktop ? win().isFullscreen() : Promise.resolve(false)),
  setFullscreen: (on) => (isDesktop ? win().setFullscreen(on) : Promise.resolve()),
  // iOS only so far (src-tauri's ios/system_bars.m); a desktop window has no such bars.
  setSystemBarsHidden: (hidden) => (os === "ios" ? call<void>("player_system_bars", { hidden }) : Promise.resolve()),
  onFocusChanged: (handler) => win().onFocusChanged(({ payload }) => handler(payload)),
  onResized: (handler) => win().onResized(() => handler()),
  setZoom: (scale) => getCurrentWebview().setZoom(scale),
  canPin: () => (isDesktop ? call<boolean>("window_can_pin").catch(() => false) : Promise.resolve(false)),
  setAlwaysOnTop: (on) => win().setAlwaysOnTop(on),
  setLocked: async (locked) => {
    const w = win();
    await Promise.all([w.setResizable(!locked), w.setMinimizable(!locked), w.setMaximizable(!locked)]);
  },
  isMaximized: () => win().isMaximized(),
  maximize: () => win().maximize(),
  unmaximize: () => win().unmaximize(),
  bounds: async () => {
    const [pos, size] = await Promise.all([win().outerPosition(), win().innerSize()]);
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
  },
  setBounds: async (b) => {
    // Size first: a window moved into a corner at its old size could land partly off the screen on the way.
    await win().setSize(new PhysicalSize(b.width, b.height));
    await win().setPosition(new PhysicalPosition(b.x, b.y));
  },
  workArea: async () => {
    const m = await currentMonitor();
    if (!m) return null;
    const { position: p, size: s } = m.workArea;
    return { x: p.x, y: p.y, width: s.width, height: s.height, scale: m.scaleFactor };
  },
  setMinSize: (size) => win().setMinSize(size ? new LogicalSize(size.width, size.height) : null),
};

export type FileDrag = { type: "enter"; paths: string[] } | { type: "leave" } | { type: "drop" };

/**
 * Files dragged onto the window from the system (desktop windows). The dropped files themselves come
 * from the native side once it has checked them (lib/localFiles), not from here.
 */
export function onFileDrag(handler: (e: FileDrag) => void): Promise<Unlisten> {
  return getCurrentWebview().onDragDropEvent(({ payload: p }) => {
    if (p.type === "enter") handler({ type: "enter", paths: p.paths });
    else if (p.type === "leave") handler({ type: "leave" });
    else if (p.type === "drop") handler({ type: "drop" });
  });
}
