import { useRef, type KeyboardEvent } from "react";
import { RatingsTable, useEpisodeRatings } from "../components/title/EpisodeRatings";
import { useClamped } from "../lib/ui";
import type { Video } from "../lib/types";
import { glideScroll, glideTarget } from "./follow";
import { useFocusTrap } from "./shell";

/**
 * The title page's synopsis, clamped to four lines, with a "More" under it when it's cut off: the whole text
 * opens in a panel (TvTextPanel) that Back closes.
 */
export function TvDescription({ text, onMore }: { text: string; onMore: () => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const clamped = useClamped(() => ref.current, text);
  return (
    <>
      <p className="tv-detail-description" ref={ref}>
        {text}
      </p>
      {clamped && (
        <button className="tv-more" onClick={onMore} aria-label="More: the whole description">
          More
        </button>
      )}
    </>
  );
}

/**
 * Beside an episode in the Episodes panel: "More" when its synopsis (`.tv-episode-overview` in the same row) is
 * cut off. Hidden otherwise, and while Settings → Browsing hides the synopsis of an episode not watched yet.
 */
export function TvOverviewMore({ episode, text, onMore }: { episode: number; text?: string; onMore: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const clamped = useClamped(() => ref.current?.closest(".tv-episode")?.querySelector<HTMLElement>(".tv-episode-overview") ?? null, text);
  return (
    <button ref={ref} className="tv-episode-more" hidden={!clamped} onClick={onMore} aria-label={`More about episode ${episode}`}>
      More
    </button>
  );
}

/** Up and down read on through a long text before reaching anything else (as TvDetail's Details panel). */
export function readOn(e: KeyboardEvent<HTMLElement>) {
  if (e.target !== e.currentTarget || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  const el = e.currentTarget;
  const down = e.key === "ArrowDown";
  if (down ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4 : el.scrollTop <= 0) return;
  e.preventDefault();
  glideScroll(el, "y", (glideTarget(el, "y") ?? el.scrollTop) + (down ? 1 : -1) * el.clientHeight * 0.4);
}

/** A description in full, over the page. Back closes it (TvDetail's panel stack). */
export function TvTextPanel({ heading, sub, text }: { heading: string; sub?: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div className="tv-panel tv-sources tv-text" ref={ref} data-nav-scope role="dialog" aria-label={heading}>
      <header className="tv-sources-head">
        <h2 className="tv-heading">{heading}</h2>
        {sub && <p className="tv-sources-sub">{sub}</p>}
      </header>
      {/* Focusable, so the arrows scroll it though there's nothing to press. */}
      <div className="tv-scroll tv-sources-list tv-text-body" data-nav-scroll tabIndex={0} data-nav-default onKeyDown={readOn}>
        <p>{text}</p>
      </div>
    </div>
  );
}

/** Whether a show has enough episode ratings for the Episode Ratings panel (and its pill). */
export const useHasEpisodeRatings = (videos: readonly Video[]) => useEpisodeRatings(videos) !== null;

/** Episode Ratings, full screen: every cell a stop for the arrows; a cell opens that episode's sources. */
export function TvRatingsPanel({ videos, onOpen }: { videos: readonly Video[]; onOpen: (v: Video) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const grid = useEpisodeRatings(videos);
  return (
    <div className="tv-panel tv-ratings" ref={ref} data-nav-scope role="dialog" aria-label="Episode Ratings">
      {grid && <RatingsTable grid={grid} onOpen={onOpen} tv />}
    </div>
  );
}
