import { usePlayTarget } from "../../../src/lib/playback";
import { formatTime } from "../../../src/lib/format";
import type { Meta, MetaPreview } from "../../../src/lib/types";
import { episodeCode } from "./time";

/** What Play plays for a title (the film, or the show's next episode) and what its button says. */
export function usePlayLabel(item: MetaPreview, meta?: Meta) {
  const { next, videoId, resumeAt } = usePlayTarget(item, meta);
  const label = (() => {
    if (item.type !== "series") return resumeAt ? `Resume from ${formatTime(resumeAt)}` : "Play";
    if (!next?.video) return "Play";
    const code = episodeCode(next.video.season, next.video.episode);
    return next.kind === "resume" ? `Resume ${code}` : `Play ${code}`;
  })();
  return { videoId, label };
}
