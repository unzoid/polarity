import { useEffect, useRef } from "react";
import { SourcePicker, useSourcePicker } from "../components/title/SourcePicker";
import { episodeCode } from "../lib/format";
import { useMeta } from "../lib/net";
import { usePlayTarget } from "../lib/playback";
import type { MetaPreview } from "../lib/types";

/**
 * Plays `item` (its next episode, or where it was left) once what to play is known, with the sources sheet when one
 * has to be picked; mounted by a Play that was pressed, so a list of titles doesn't look every one of them up first.
 * `onDone` once it's started and no sheet is up.
 */
export function PlayNow({ item, onDone }: { item: MetaPreview; onDone: () => void }) {
  const { data: meta } = useMeta(item.type, item.id);
  const picker = useSourcePicker();
  const { next, videoId, resumeAt } = usePlayTarget(item, meta);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !videoId) return;
    started.current = true;
    picker.play({
      type: item.type,
      metaId: item.id,
      videoId,
      resumable: !!resumeAt,
      subtitle: item.type === "series" && next?.video ? episodeCode(next.video.season, next.video.episode) : item.name,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);
  useEffect(() => {
    if (!started.current || picker.open) return;
    const t = window.setTimeout(onDone, 600);
    return () => window.clearTimeout(t);
  }, [picker.open, onDone]);
  return <SourcePicker picker={picker} />;
}
