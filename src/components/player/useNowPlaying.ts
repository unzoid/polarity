import { useEffect } from "react";
import { nowPlayingText } from "../../lib/playback";
import { nowPlayingAvailable, showNowPlaying } from "../../lib/platform";
import type { Meta } from "../../lib/types";
import { loadReadable } from "../TitleLogo";
import { isMpv, type MediaLike } from "./mpvMedia";

/** The art's width on the system's controls; they show it small. */
const ART_W = 512;

/** `src` as a JPEG, base64; null when its pixels can't be read. */
async function artJpeg(src: string): Promise<string | null> {
  const img = await loadReadable(src).catch(() => null);
  if (!img?.naturalWidth) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(ART_W, img.naturalWidth);
    canvas.height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * canvas.width));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return url.slice(url.indexOf(",") + 1) || null;
  } catch {
    return null;
  }
}

/**
 * What mpv plays, on iOS's and Android's lock screen and media controls (#461), which also keeps its sound playing
 * with the app in the background. Shown once it has played (not under the loading screen), the title's art
 * following when it's read; taken away when the player closes. Their play, pause and seek go to mpv directly
 * (src-tauri/src/player/background.rs), and come back here as mpv's own changes.
 */
export function useNowPlaying(media: MediaLike | null, meta: Meta | undefined, videoId: string) {
  const mpv = isMpv(media) ? media : null;
  const name = meta?.name;
  const poster = meta?.poster;
  const video = meta?.videos?.find((v) => v.id === videoId);
  const season = video?.season;
  const episode = video?.episode;
  const episodeTitle = video?.title;
  useEffect(() => {
    if (!nowPlayingAvailable || !mpv || !name) return;
    let live = true;
    let shown = false;
    const text = nowPlayingText(name, season !== undefined && episode !== undefined ? { season, episode, title: episodeTitle } : undefined);
    const begin = () => {
      if (shown || (mpv.paused && !(mpv.currentTime > 0))) return;
      shown = true;
      showNowPlaying(text);
      if (poster) void artJpeg(poster).then((art) => live && art && showNowPlaying({ ...text, art }));
    };
    begin();
    mpv.addEventListener("play", begin);
    mpv.addEventListener("playing", begin);
    return () => {
      live = false;
      mpv.removeEventListener("play", begin);
      mpv.removeEventListener("playing", begin);
      if (shown) showNowPlaying(null);
    };
  }, [mpv, name, poster, season, episode, episodeTitle]);
}
