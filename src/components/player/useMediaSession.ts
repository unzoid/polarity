import { useEffect, useRef } from "react";
import { call, inShell, on, os } from "../../lib/platform";
import { warnFailed } from "../../lib/errors";
import { isMpv, type MediaLike } from "./mpvMedia";

export type MediaKey = "play" | "pause" | "toggle" | "next" | "previous" | "seek";

export interface NowPlayingInfo {
  title: string;
  /** The show, for an episode. */
  subtitle?: string;
  /** A poster or still (http(s); anything else isn't shown). */
  artwork?: string;
  canNext: boolean;
  canPrevious: boolean;
}

/** How often the system hears the position while playing (it moves the time on by itself in between). */
const REFRESH_MS = 5000;

/**
 * The system's "now playing" for the player: the title, artwork and timeline in Windows' media overlay,
 * macOS's Now Playing and the iPhone's Lock Screen, and the media keys, headset buttons and those controls
 * answered through `onKey`. With mpv it's the app's own session (src-tauri's media_session); the built-in
 * player's <video> gets the web view's (navigator.mediaSession), so there's never a second one for the
 * same window. Cleared when the player closes, so the keys go back to other apps.
 */
export function useMediaSession(media: MediaLike | null, info: NowPlayingInfo | null, onKey: (key: MediaKey, position?: number) => void) {
  const latest = useRef({ info, onKey });
  latest.current = { info, onKey };
  const native = !!media && isMpv(media) && inShell && (os === "windows" || os === "macos" || os === "ios");
  const infoKey = info ? JSON.stringify(info) : "";

  // The native session: what plays, sent on every change of state and every few seconds while playing.
  useEffect(() => {
    if (!native || !media || !infoKey) return;
    let last = "";
    const send = () => {
      const i = latest.current.info;
      if (!i) return;
      const now = {
        ...i,
        subtitle: i.subtitle ?? "",
        playing: !media.paused,
        position: media.currentTime || 0,
        duration: Number.isFinite(media.duration) ? media.duration : 0,
        rate: media.playbackRate || 1,
      };
      // Same state and about the same place: nothing new for the system.
      const key = JSON.stringify({ ...now, position: Math.round(now.position) });
      if (key === last) return;
      last = key;
      void call("media_session", { now }).catch(warnFailed("media_session"));
    };
    const events = ["play", "pause", "playing", "seeked", "loadedmetadata", "ratechange", "durationchange"];
    for (const e of events) media.addEventListener(e, send);
    send();
    const timer = window.setInterval(() => !media.paused && send(), REFRESH_MS);
    return () => {
      for (const e of events) media.removeEventListener(e, send);
      window.clearInterval(timer);
    };
  }, [native, media, infoKey]);
  // Closing the player clears it (a new title sends its own straight away).
  useEffect(() => {
    if (!native) return;
    return () => void call("media_session", { now: null }).catch(warnFailed("media_session"));
  }, [native]);
  useEffect(() => {
    if (!native) return;
    const off = on<{ action: MediaKey; position?: number | null }>("media://key", (p) => latest.current.onKey(p.action, p.position ?? undefined));
    return () => void off.then((f) => f());
  }, [native]);

  // The web view's session, for the built-in player.
  useEffect(() => {
    const session = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (native || !media || !info || !session || typeof MediaMetadata === "undefined") return;
    session.metadata = new MediaMetadata({
      title: info.title,
      artist: info.subtitle ?? "",
      artwork: info.artwork && /^https?:\/\//i.test(info.artwork) ? [{ src: info.artwork }] : [],
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => latest.current.onKey("play")],
      ["pause", () => latest.current.onKey("pause")],
      ["nexttrack", info.canNext ? () => latest.current.onKey("next") : null],
      ["previoustrack", info.canPrevious ? () => latest.current.onKey("previous") : null],
      ["seekto", (d) => d.seekTime != null && latest.current.onKey("seek", d.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this web view doesn't know.
      }
    }
    return () => {
      session.metadata = null;
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
    };
    // `info` is compared by value (infoKey); handlers read the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, media, infoKey]);
}
