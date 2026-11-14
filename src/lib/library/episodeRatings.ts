import { isReleased } from "../format";
import type { Video } from "../types";

/**
 * The episode ratings grid on a series' page: one row per season, one cell per episode, each cell tinted by
 * its rating on a fixed scale (the same rating is the same tint on every show), and the season's average at
 * the row's end. Specials (season 0) are left out: they're rarely rated and their order means little.
 */

/** At least this many episodes need a rating before the grid shows. */
export const MIN_RATED = 6;
/** ...and at least this share of the episodes already out. Fewer and the grid is mostly holes. */
export const MIN_SHARE = 0.5;

/**
 * The tint steps, lowest first: a rating takes the last step whose `min` it reaches. Fixed, not stretched to
 * the show's own range, so a weak season of a great show doesn't look like a bad one. Most episodes land
 * between 7 and 9, so the steps are finest there.
 */
export const RATING_STEPS: readonly { min: number; label: string }[] = [
  { min: 0, label: "Under 5" },
  { min: 5, label: "5–6" },
  { min: 6, label: "6–7" },
  { min: 7, label: "7–7.5" },
  { min: 7.5, label: "7.5–8" },
  { min: 8, label: "8–8.5" },
  { min: 8.5, label: "8.5–9" },
  { min: 9, label: "9 and up" },
];

export interface RatingCell {
  video: Video;
  /** 0–10, or none when the episode has no rating. */
  rating?: number;
  /** Index into RATING_STEPS, with `rating`. */
  step?: number;
  /** Out (or about to be): only these open. */
  released: boolean;
}

export interface RatingRow {
  season: number;
  /** In episode order. A column is a place in the season, not an episode number (some shows number on across seasons). */
  cells: RatingCell[];
  /** The mean of the season's rated episodes, to one decimal. */
  average?: number;
  averageStep?: number;
}

export interface RatingGrid {
  rows: RatingRow[];
  /** The longest season's length: the number of episode columns. */
  columns: number;
  /** Episodes with a rating. */
  rated: number;
  /** Episodes already out. */
  released: number;
}

/** An episode's rating as a number from 0 to 10; none for missing, zero, or anything that isn't one. */
export function parseRating(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : undefined;
}

/** Which tint step a 0–10 rating takes. */
export function ratingStep(rating: number): number {
  let step = 0;
  for (let i = 0; i < RATING_STEPS.length; i++) if (rating >= RATING_STEPS[i].min) step = i;
  return step;
}

/** Rounded to one decimal, the way it's shown. */
const tenth = (n: number) => Math.round(n * 10) / 10;

export function ratingGrid(videos: readonly Video[], released: (v: Video) => boolean = isReleased): RatingGrid {
  const bySeason = new Map<number, Video[]>();
  for (const v of videos) {
    if (!(v.season > 0)) continue;
    const list = bySeason.get(v.season);
    if (list) list.push(v);
    else bySeason.set(v.season, [v]);
  }
  let rated = 0;
  let out = 0;
  const rows = [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, list]): RatingRow => {
      const cells = [...list]
        .sort((a, b) => a.episode - b.episode)
        .map((video): RatingCell => {
          const rating = parseRating(video.rating);
          const isOut = released(video);
          if (isOut) out++;
          if (rating !== undefined) rated++;
          return { video, rating, step: rating === undefined ? undefined : ratingStep(rating), released: isOut };
        });
      const scores = cells.flatMap((c) => (c.rating === undefined ? [] : [c.rating]));
      const average = scores.length ? tenth(scores.reduce((a, b) => a + b, 0) / scores.length) : undefined;
      return { season, cells, average, averageStep: average === undefined ? undefined : ratingStep(average) };
    });
  return { rows, columns: Math.max(0, ...rows.map((r) => r.cells.length)), rated, released: out };
}

/** Whether enough episodes are rated for the grid to mean something: MIN_RATED of them, and MIN_SHARE of those out. */
export function showRatingGrid(grid: RatingGrid): boolean {
  return grid.rated >= MIN_RATED && grid.rated >= grid.released * MIN_SHARE;
}

/** A rating as shown in a cell: one decimal. */
export function formatRating(rating: number): string {
  return tenth(rating).toFixed(1);
}

export type GridMove = "up" | "down" | "left" | "right" | "home" | "end";

/**
 * Where a key takes focus in the grid from (row, col), passing over places with nothing to open (`open`
 * says which can take focus). Up and down keep the column, or the nearest one that opens in that row when the
 * row is shorter. Home and End go to the row's first and last. None: nothing that way.
 */
export function moveInGrid(
  grid: RatingGrid,
  row: number,
  col: number,
  move: GridMove,
  open: (cell: RatingCell) => boolean = (c) => c.released,
): [number, number] | null {
  const ok = (r: number, c: number) => {
    const cell = grid.rows[r]?.cells[c];
    return !!cell && open(cell);
  };
  const cells = (r: number) => grid.rows[r]?.cells.length ?? 0;
  switch (move) {
    case "left":
      for (let c = col - 1; c >= 0; c--) if (ok(row, c)) return [row, c];
      return null;
    case "right":
      for (let c = col + 1; c < cells(row); c++) if (ok(row, c)) return [row, c];
      return null;
    case "home":
      for (let c = 0; c < col; c++) if (ok(row, c)) return [row, c];
      return null;
    case "end":
      for (let c = cells(row) - 1; c > col; c--) if (ok(row, c)) return [row, c];
      return null;
    case "up":
    case "down": {
      const step = move === "up" ? -1 : 1;
      for (let r = row + step; r >= 0 && r < grid.rows.length; r += step) {
        // The same column, else the nearest that opens.
        let best: number | null = null;
        for (let c = 0; c < cells(r); c++) if (ok(r, c) && (best === null || Math.abs(c - col) < Math.abs(best - col))) best = c;
        if (best !== null) return [r, best];
      }
      return null;
    }
  }
}
