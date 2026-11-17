import { useRef, useState } from "react";
import { episodeCode } from "../../lib/format";
import { useClamped } from "../../lib/ui";
import type { Video } from "../../lib/types";
import { Sheet } from "../Sheet";

/**
 * Under an episode card (EpisodeCard): "More" when its synopsis (`.episode-card-overview` in the same card) is cut
 * off, opening the whole text in a sheet. Hidden otherwise, and while Settings → Browsing hides the synopsis of an
 * episode not watched yet. The sheet is only built once asked for.
 */
export function OverviewMore({ video: v }: { video: Video }) {
  const ref = useRef<HTMLButtonElement>(null);
  const clamped = useClamped(
    () => ref.current?.closest(".episode-card")?.querySelector<HTMLElement>(".episode-card-overview") ?? null,
    v.overview,
  );
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="overview-more t-callout"
        hidden={!clamped}
        onClick={() => {
          setAsked(true);
          setOpen(true);
        }}
        aria-label={`More about episode ${v.episode}`}
      >
        More
      </button>
      {asked && (
        // The sheet sits in the card's React tree: a right-click in it isn't the card's.
        <div className="overview-more-layer" onContextMenu={(e) => e.stopPropagation()}>
          <Sheet open={open} onClose={() => setOpen(false)} title={v.title || `Episode ${v.episode}`} subtitle={episodeCode(v.season, v.episode)}>
            <p className="overview-more-text">{v.overview}</p>
          </Sheet>
        </div>
      )}
    </>
  );
}
