import { useEffect } from "react";
import { appWindow, osName } from "../../lib/platform";
import { appVersion } from "../../lib/updater";
import { formatTime } from "../../lib/format";
import { watch, watchLog, watchMedia } from "../../lib/playback/watchLog";
import { isMpv, type MediaLike } from "./mpvMedia";

/**
 * Keeps the watch log (#424) while the player is open, in builds that have one: the engine's play, pause,
 * buffering, seeks, track changes and its own lines (mpv's events, autocrop), and the window's focus. The player
 * notes the rest where it happens (who sought, why the controls showed, the source, the watch party).
 */
export function useWatchLog(media: MediaLike | null, videoId: string) {
  useEffect(() => {
    if (!watchLog) return;
    watchLog.reset(Date.now(), performance.now());
    watch("player opened");
    return () => watch("player closed");
  }, [videoId]);

  useEffect(() => {
    if (!watchLog || !media) return;
    watchMedia(media);
    const ahead = () => {
      const b = media.buffered;
      return b.length ? Math.max(0, b.end(b.length - 1) - media.currentTime).toFixed(1) : "0.0";
    };
    const tracks = () => {
      if (!isMpv(media)) return "tracks changed";
      const [audio, sub] = [media.playing("audio"), media.playing("sub")];
      const name = (t: typeof audio) => (t ? `#${t.id}${t.lang ? ` (${t.lang})` : ""}` : "none");
      return `tracks: audio ${name(audio)}, subtitles ${name(sub)}`;
    };
    let lastTracks = "";
    const lines: Record<string, (e: Event) => string | null> = {
      play: () => "play",
      pause: () => "pause",
      waiting: () => `buffering (cache ${ahead()} s ahead)`,
      playing: () => `playing (cache ${ahead()} s ahead)`,
      seeking: () => `seeking to ${formatTime(media.currentTime)}`,
      ended: () => "ended",
      error: () => "error",
      ratechange: () => `speed ${media.playbackRate}×`,
      tracks: () => {
        const now = tracks();
        if (now === lastTracks) return null;
        lastTracks = now;
        return now;
      },
      watch: (e) => (e as CustomEvent<string>).detail,
    };
    const bound = Object.entries(lines).map(([type, line]) => {
      const fn = (e: Event) => {
        const text = line(e);
        if (text) watch(text);
      };
      media.addEventListener(type, fn);
      return [type, fn] as const;
    });
    return () => {
      bound.forEach(([type, fn]) => media.removeEventListener(type, fn));
      watchMedia(null);
    };
  }, [media]);

  useEffect(() => {
    if (!watchLog) return;
    const unlisten = appWindow.onFocusChanged((focused) => watch(focused ? "window gained focus" : "window lost focus"));
    const onVisibility = () => watch(document.hidden ? "page hidden" : "page shown");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void unlisten.then((f) => f());
    };
  }, []);
}

/** The watch log as "Copy Watch Log" puts it on the clipboard, with the app's version, the system and the player. */
export async function watchLogText(backend: string) {
  const app = await appVersion().catch(() => "unknown");
  return watchLog?.text([`Polarity ${app} · ${osName} · player: ${backend}`]) ?? "";
}
