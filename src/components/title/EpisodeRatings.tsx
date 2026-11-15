import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { formatRating, moveInGrid, RATING_STEPS, ratingGrid, showRatingGrid, type GridMove, type RatingGrid } from "../../lib/library";
import type { Video } from "../../lib/types";

const KEYS: Record<string, GridMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
};

/** The grid of a show's episode ratings, or null when too few are rated to show it (lib/library/episodeRatings.ts). */
export function useEpisodeRatings(videos: readonly Video[]): RatingGrid | null {
  return useMemo(() => {
    const grid = ratingGrid(videos);
    return showRatingGrid(grid) ? grid : null;
  }, [videos]);
}

/**
 * Episode Ratings on a series' page: a table with a row per season and a cell per episode, each showing its
 * rating and tinted by it (the number is always there, so the tint is never the only cue), the season's average
 * at the row's end. A cell opens its episode through `onOpen`. Nothing when too few episodes are rated.
 *
 * Desktop and phone: one Tab stop, then the arrow keys, Home and End move between cells. TV (`tv`): every cell is
 * a stop for spatial navigation. The table scrolls inside its own box both ways, the season and average columns
 * and the episode numbers staying in view.
 */
export function EpisodeRatings({ videos, onOpen, tv = false }: { videos: readonly Video[]; onOpen: (v: Video) => void; tv?: boolean }) {
  const grid = useEpisodeRatings(videos);
  if (!grid) return null;
  return <RatingsTable grid={grid} onOpen={onOpen} tv={tv} />;
}

export function RatingsTable({ grid, onOpen, tv = false }: { grid: RatingGrid; onOpen: (v: Video) => void; tv?: boolean }) {
  const heading = useId();
  const box = useRef<HTMLDivElement>(null);
  const first = useMemo(() => {
    for (let r = 0; r < grid.rows.length; r++) {
      const c = grid.rows[r].cells.findIndex((cell) => cell.released);
      if (c >= 0) return [r, c] as [number, number];
    }
    return null;
  }, [grid]);
  const [current, setCurrent] = useState<[number, number] | null>(null);
  const [atRow, atCol] = current ?? first ?? [-1, -1];

  const cellAt = (r: number, c: number) => box.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`) ?? null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = KEYS[e.key];
    const from = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (tv || !move || !from) return;
    e.preventDefault();
    const next = moveInGrid(grid, Number(from.dataset.r), Number(from.dataset.c), move);
    if (!next) return;
    setCurrent(next);
    cellAt(...next)?.focus({ preventScroll: true });
  };
  // Keep the focused cell clear of the sticky headers (the box's scroll-padding).
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!el.dataset.r) return;
    if (!tv) setCurrent([Number(el.dataset.r), Number(el.dataset.c)]);
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  return (
    <section className="episode-ratings" data-variant={tv ? "tv" : undefined} aria-labelledby={heading}>
      <h2 className={tv ? "tv-heading" : "t-title2"} id={heading}>
        Episode Ratings
      </h2>
      <div className="episode-ratings-box" ref={box} onKeyDown={onKeyDown} onFocus={onFocus}>
        <table className="episode-ratings-table tabular">
          <thead>
            <tr>
              <th scope="col" className="episode-ratings-corner">
                <span className="episode-ratings-sr">Season</span>
              </th>
              {Array.from({ length: grid.columns }, (_, i) => (
                <th key={i} scope="col">
                  <span aria-hidden>{i + 1}</span>
                  <span className="episode-ratings-sr">Episode {i + 1}</span>
                </th>
              ))}
              <th scope="col" className="episode-ratings-average">
                <span aria-hidden>Avg</span>
                <span className="episode-ratings-sr">Season average</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, r) => (
              <tr key={row.season}>
                <th scope="row" className="episode-ratings-season">
                  <span aria-hidden>S{row.season}</span>
                  <span className="episode-ratings-sr">Season {row.season}</span>
                </th>
                {Array.from({ length: grid.columns }, (_, c) => {
                  const cell = row.cells[c];
                  if (!cell) return <td key={c} className="episode-ratings-empty" />;
                  const v = cell.video;
                  const shown = cell.rating === undefined ? "–" : formatRating(cell.rating);
                  const said = cell.rating === undefined ? "no rating" : `rated ${shown}`;
                  const title = `Episode ${v.episode}${v.title ? `, ${v.title}` : ""}`;
                  return (
                    <td key={c} data-step={cell.step}>
                      {cell.released ? (
                        <button
                          type="button"
                          className="episode-ratings-cell"
                          data-r={r}
                          data-c={c}
                          tabIndex={tv || (r === atRow && c === atCol) ? 0 : -1}
                          data-nav-default={(tv && r === first?.[0] && c === first?.[1]) || undefined}
                          aria-label={`${title}, ${said}`}
                          title={`${title} · ${cell.rating === undefined ? "No rating" : `★ ${shown}`}`}
                          onClick={() => onOpen(v)}
                        >
                          {shown}
                        </button>
                      ) : (
                        <span className="episode-ratings-cell" data-upcoming title={`${title} · Not out yet`}>
                          <span aria-hidden>·</span>
                          <span className="episode-ratings-sr">{title}, not out yet</span>
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="episode-ratings-average" data-step={row.averageStep}>
                  <span className="episode-ratings-cell">{row.average === undefined ? "–" : formatRating(row.average)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="episode-ratings-legend" aria-label="Tint by rating">
        {RATING_STEPS.map((s, i) => (
          <li key={s.min} data-step={i}>
            <span className="episode-ratings-swatch" aria-hidden />
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
