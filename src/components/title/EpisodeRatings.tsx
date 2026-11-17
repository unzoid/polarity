import { Dialog } from "@base-ui/react/dialog";
import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  formatRating,
  imdbVotes,
  moveInGrid,
  RATING_STEPS,
  ratingGrid,
  showImdbId,
  showRatingGrid,
  stepRange,
  withImdbRatings,
  type GridMove,
  type RatingGrid,
} from "../../lib/library";
import { useImdbEpisodeRatings } from "../../lib/net";
import type { Video } from "../../lib/types";
import { EdgeBlur } from "../EdgeBlur";
import { Close } from "../icons";
import { iconButtonClass } from "../ui/Button";
import { EpisodeRatingsViews } from "./EpisodeRatingsViews";

/**
 * The table shows a season per column and an episode per row, so the keys turn: up and down move through a
 * season's episodes (the grid's "left" and "right"), left and right between seasons (its "up" and "down").
 */
const KEYS: Record<string, GridMove> = {
  ArrowUp: "left",
  ArrowDown: "right",
  ArrowLeft: "up",
  ArrowRight: "down",
  Home: "home",
  End: "end",
};

/**
 * The grid of a show's episode ratings, IMDb's where it has them, or null when too few are rated to show it
 * (lib/library/episodeRatings.ts).
 */
export function useEpisodeRatings(videos: readonly Video[]): RatingGrid | null {
  const { data: imdb } = useImdbEpisodeRatings(useMemo(() => showImdbId(videos), [videos]));
  return useMemo(() => {
    const grid = ratingGrid(withImdbRatings(videos, imdb), undefined, imdbVotes(imdb));
    return showRatingGrid(grid) ? grid : null;
  }, [videos, imdb]);
}

/**
 * Episode Ratings: a table with a column per season and a row per episode, each cell showing its rating and
 * coloured by it (the number is always there, so the colour is never the only cue), the seasons' averages in
 * the last row. A cell opens its episode through `onOpen`. Nothing when too few episodes are rated.
 *
 * Desktop and phone: one Tab stop, then the arrow keys, Home and End move between cells. TV (`tv`): every cell is
 * a stop for spatial navigation. The table scrolls inside its own box both ways, the season numbers, the episode
 * numbers and the averages staying in view.
 */
export function EpisodeRatings({ videos, onOpen, tv = false }: { videos: readonly Video[]; onOpen: (v: Video) => void; tv?: boolean }) {
  const grid = useEpisodeRatings(videos);
  if (!grid) return null;
  return <RatingsTable grid={grid} onOpen={onOpen} tv={tv} />;
}

export function RatingsTable({
  grid,
  onOpen,
  tv = false,
  dialog = false,
  legend = true,
}: {
  grid: RatingGrid;
  onOpen: (v: Video) => void;
  tv?: boolean;
  /** In EpisodeRatingsDialog, whose title names it: no heading of its own. */
  dialog?: boolean;
  /** Its own legend above it; off where the views share one (EpisodeRatingsViews). */
  legend?: boolean;
}) {
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
    <section
      className="episode-ratings"
      data-variant={tv ? "tv" : dialog ? "dialog" : undefined}
      aria-labelledby={dialog ? undefined : heading}
      aria-label={dialog ? "Episode Ratings" : undefined}
    >
      {!dialog && (
        <h2 className={tv ? "tv-heading" : "t-title2"} id={heading}>
          Episode Ratings
        </h2>
      )}
      {legend && <RatingsLegend />}
      <div className="episode-ratings-box" ref={box} onKeyDown={onKeyDown} onFocus={onFocus}>
        <table className="episode-ratings-table tabular">
          <thead>
            <tr>
              <th scope="col" className="episode-ratings-corner">
                <span className="episode-ratings-sr">Episode</span>
              </th>
              {grid.rows.map((row) => (
                <th key={row.season} scope="col">
                  <span aria-hidden>S{row.season}</span>
                  <span className="episode-ratings-sr">Season {row.season}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: grid.columns }, (_, c) => (
              <tr key={c}>
                <th scope="row" className="episode-ratings-episode">
                  <span aria-hidden>E{c + 1}</span>
                  <span className="episode-ratings-sr">Episode {c + 1}</span>
                </th>
                {grid.rows.map((row, r) => {
                  const cell = row.cells[c];
                  if (!cell) return <td key={row.season} className="episode-ratings-empty" />;
                  const v = cell.video;
                  const shown = cell.rating === undefined ? "–" : formatRating(cell.rating);
                  const said = cell.rating === undefined ? "no rating" : `rated ${shown}`;
                  const title = `Season ${v.season}, episode ${v.episode}${v.title ? `, ${v.title}` : ""}`;
                  const code = `S${v.season} E${v.episode}${v.title ? ` · ${v.title}` : ""}`;
                  return (
                    <td key={row.season} data-step={cell.step}>
                      {cell.released ? (
                        <button
                          type="button"
                          className="episode-ratings-cell"
                          data-r={r}
                          data-c={c}
                          tabIndex={tv || (r === atRow && c === atCol) ? 0 : -1}
                          data-nav-default={(tv && r === first?.[0] && c === first?.[1]) || undefined}
                          aria-label={`${title}, ${said}`}
                          title={`${code} · ${cell.rating === undefined ? "No rating" : `★ ${shown}`}`}
                          onClick={() => onOpen(v)}
                        >
                          {shown}
                        </button>
                      ) : (
                        <span className="episode-ratings-cell" data-upcoming title={`${code} · Not out yet`}>
                          <span aria-hidden>·</span>
                          <span className="episode-ratings-sr">{title}, not out yet</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="episode-ratings-episode">
                <span aria-hidden>AVG.</span>
                <span className="episode-ratings-sr">Season average</span>
              </th>
              {grid.rows.map((row) => (
                <td key={row.season} className="episode-ratings-average" data-step={row.averageStep}>
                  <span className="episode-ratings-avg">{row.average === undefined ? "–" : formatRating(row.average)}</span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Best first, as the cells read from great to poor. */
const LEGEND = RATING_STEPS.map((s, i) => ({ ...s, i })).reverse();

/** What each colour means, best first. */
export function RatingsLegend() {
  return (
    <ul className="episode-ratings-legend" aria-label="Colour by rating">
      {LEGEND.map((s) => (
        <li key={s.min} data-step={s.i}>
          <span className="episode-ratings-swatch" aria-hidden />
          {s.label}
          <span className="episode-ratings-range tabular">{stepRange(s.i)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Episode Ratings over the page, opened from a season's menu (SeasonActions): the page behind goes softly out of
 * focus, more toward the bottom (a progressive blur, components/EdgeBlur.tsx), under a light grain, and the chart
 * sits on a dark card in the middle. A cell opens its episode through `onOpen` and closes the dialog; Escape, a
 * click outside or Close shut it.
 */
export function EpisodeRatingsDialog({
  grid,
  title,
  open,
  onClose,
  onOpen,
}: {
  grid: RatingGrid;
  /** The show's name, for the dialog's title. */
  title: string;
  open: boolean;
  onClose: () => void;
  onOpen: (v: Video) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ratings-dialog-scrim">
          <EdgeBlur edge="bottom" layers={6} step={4} />
        </Dialog.Backdrop>
        {/* The card itself takes focus, not Close: a ring on Close the moment it opens looked like a mistake. */}
        <Dialog.Popup className="ratings-dialog" initialFocus={card} ref={card}>
          <Dialog.Title className="episode-ratings-sr">Episode Ratings, {title}</Dialog.Title>
          <Dialog.Close className={iconButtonClass("plain", "ratings-dialog-close")} aria-label="Close">
            <Close size={16} />
          </Dialog.Close>
          <EpisodeRatingsViews
            grid={grid}
            onOpen={(v) => {
              onClose();
              onOpen(v);
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
