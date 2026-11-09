import { useEffect, useState } from "react";
import type { YouTubeMedia } from "./youtubeMedia";

/** The speed YouTube's player plays at and the speeds it has, as it reports them (TV's Speed menu, #434). */
export function useYouTubeSpeed(yt: YouTubeMedia) {
  const read = () => ({ rate: yt.playbackRate, speeds: yt.playbackRates });
  const [speed, setSpeed] = useState(read);
  useEffect(() => {
    const update = () => setSpeed(read());
    update();
    yt.addEventListener("ratechange", update);
    yt.addEventListener("speedschange", update);
    return () => {
      yt.removeEventListener("ratechange", update);
      yt.removeEventListener("speedschange", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read only reads yt
  }, [yt]);
  return speed;
}
