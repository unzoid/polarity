import { call, inShell } from "./bridge";
import { os } from "./device";

/**
 * iOS and Android show what mpv plays on their lock screens and media controls, and play its sound on with the
 * app in the background or the screen locked (#461, src-tauri/src/player/background.rs). Elsewhere nothing shows.
 */
export const nowPlayingAvailable = inShell && (os === "ios" || os === "android");

export interface NowPlayingInfo {
  title: string;
  subtitle?: string;
  /** A JPEG, base64, without the data URL's head. */
  art?: string;
}

/** A player handing over to the next episode's sends its title within this: the controls stay up between them. */
const HIDE_AFTER_MS = 1500;

let hiding: ReturnType<typeof setTimeout> | undefined;

/**
 * Show `info` on the system's controls, or take them away (null) a moment later unless something else shows by
 * then. On Android a shown title also keeps the app running in the background, which it can start only while
 * the app is in front: a gap between two episodes would lose it.
 */
export function showNowPlaying(info: NowPlayingInfo | null): void {
  if (!nowPlayingAvailable) return;
  clearTimeout(hiding);
  hiding = undefined;
  if (info) void call<void>("now_playing", { info }).catch(() => {});
  else
    hiding = setTimeout(() => {
      hiding = undefined;
      void call<void>("now_playing", { info: null }).catch(() => {});
    }, HIDE_AFTER_MS);
}
