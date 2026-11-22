import { useEffect } from "react";
import { call } from "../../lib/platform";
import { cropsBars, usePrefs } from "../../lib/settings";
import { warnFailed } from "../../lib/errors";
import type { MpvMedia } from "./mpvMedia";

/**
 * This machine's sound and picture options (Settings → Subtitles & Audio,
 * → Advanced) applied to mpv: on load, when the audio track changes, and
 * whenever one of them is switched. Rust turns them into fixed mpv values
 * (polar_player `Tune`).
 */
export function useMpvTune(mpv: MpvMedia | null, fullscreen = false) {
  const {
    dialogueBoost,
    volumeLeveling,
    drcProfile,
    hwdec,
    deband,
    frameRateMatch,
    cropMode,
    autocropLookahead,
    autocropEveryFrame,
    buffer,
    passthrough,
    hdrOutput,
    subtitleHdrPeak,
  } = usePrefs();
  const autocrop = cropsBars(cropMode);

  useEffect(() => {
    if (!mpv) return;
    const apply = () => {
      const track = mpv.playing("audio");
      const audioChannels = Math.max(0, Math.min(255, Math.round(track?.["demux-channel-count"] ?? 0)));
      void call("mpv_tune", {
        tune: {
          dialogueBoost,
          volumeLeveling,
          drcProfile,
          hwdec,
          deband,
          frameRateMatch,
          audioChannels,
          fullscreen,
          autocrop,
          lookahead: autocropLookahead,
          everyFrame: autocropEveryFrame,
          buffer,
          passthrough,
          hdr: hdrOutput,
          subHdr: subtitleHdrPeak,
        },
      }).catch(warnFailed("mpv_tune"));
    };
    apply();
    mpv.addEventListener("loadedmetadata", apply);
    mpv.addEventListener("tracks", apply);
    return () => {
      mpv.removeEventListener("loadedmetadata", apply);
      mpv.removeEventListener("tracks", apply);
    };
  }, [
    mpv,
    fullscreen,
    dialogueBoost,
    volumeLeveling,
    drcProfile,
    hwdec,
    deband,
    frameRateMatch,
    autocrop,
    autocropLookahead,
    autocropEveryFrame,
    buffer,
    passthrough,
    hdrOutput,
    subtitleHdrPeak,
  ]);
}
