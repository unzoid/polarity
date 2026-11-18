import { useEffect, useState } from "react";
import { playingFormat } from "../../lib/playback/playingFormat";
import { isMpv, type MediaLike } from "./mpvMedia";

/**
 * "4K · Dolby Vision · Dolby Atmos · English 5.1": what's playing now, read from the player rather than
 * the source's name, kept up to date as the audio track changes. mpv knows the picture's HDR and the
 * sound's format; the built-in player only its size.
 */
export function usePlayingFormat(media: MediaLike | null, enabled: boolean): string | undefined {
  const [format, setFormat] = useState<string>();
  useEffect(() => {
    setFormat(undefined);
    if (!media || !enabled) return;
    let alive = true;
    let asked = 0;
    const read = async () => {
      const turn = ++asked;
      if (!isMpv(media)) {
        const v = media as Partial<HTMLVideoElement>;
        return setFormat(playingFormat({ width: v.videoWidth, height: v.videoHeight }));
      }
      // Known once the first frame is decoded; before that the tracks alone.
      const params = (await media.command("get_property", "video-params").catch(() => null)) as { w?: number; h?: number; gamma?: string } | null;
      if (!alive || turn !== asked) return;
      const video = media.tracks.find((t) => t.type === "video" && t.selected);
      const audio = media.playing("audio");
      setFormat(
        playingFormat({
          width: params?.w,
          height: params?.h,
          gamma: params?.gamma,
          dolbyVision: video?.["dolby-vision-profile"],
          audio: audio && { codec: audio.codec, profile: audio["codec-profile"], channels: audio["demux-channel-count"], lang: audio.lang },
        }),
      );
    };
    const events = ["loadedmetadata", "playing", "tracks", "resize"];
    for (const e of events) media.addEventListener(e, read);
    void read();
    return () => {
      alive = false;
      for (const e of events) media.removeEventListener(e, read);
    };
  }, [media, enabled]);
  return format;
}
