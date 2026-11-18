import { isReleased } from "../format";
import type { EpisodeRating, Video } from "../types";

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
 * The colour steps, lowest first: a rating takes the last step whose `min` it reaches. Fixed, not stretched to
 * the show's own range, so a weak season of a great show doesn't look like a bad one. Each has a name, shown in
 * the legend, and its own colour (--rating-<step> in tokens.css).
 */
export const RATING_STEPS: readonly { min: number; label: string }[] = [
  { min: 0, label: "Bad" },
  { min: 5, label: "Poor" },
  { min: 6, label: "Mixed" },
  { min: 7, label: "Good" },
  { min: 8, label: "Great" },
  { min: 9, label: "Excellent" },
  { min: 9.7, label: "Masterpiece" },
];

/** A step's range as the legend says it: "9.7+", "8–9", "under 5". */
export function stepRange(i: number): string {
  const s = RATING_STEPS[i];
  const next = RATING_STEPS[i + 1];
  if (!next) return `${s.min}+`;
  if (s.min === 0) return `under ${next.min}`;
  return `${s.min}–${next.min}`;
}

export interface RatingCell {
  video: Video;
  /** 0–10, or none when the episode has no rating. */
  rating?: number;
  /** Index into RATING_STEPS, with `rating`. */
  step?: number;
  /** Out (or about to be): only these open. */
  released: boolean;
  /** How many rated it (IMDb's count), when known. */
  votes?: number;
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

/** The IMDb id a show's episodes are listed under (`tt…:season:episode`), if they are. */
export function showImdbId(videos: readonly Video[]): string | undefined {
  for (const v of videos) {
    const m = /^(tt\d+):\d+:\d+$/.exec(v.id);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * The episodes with IMDb's ratings in place of the catalog's (TMDB's are few and run low). Matched by the
 * episode's id, which is in IMDb's numbering whatever order the show is listed in. When IMDb rates none of
 * them the catalog's stay, rather than mixing the two scales; an episode IMDb leaves unrated is unrated.
 */
export function withImdbRatings(videos: readonly Video[], imdb: readonly EpisodeRating[] | undefined): readonly Video[] {
  if (!imdb?.length) return videos;
  const byId = new Map(imdb.map((r) => [`${r.season}:${r.episode}`, r.rating]));
  let matched = false;
  const out = videos.map((v) => {
    const place = imdbPlace(v);
    const rating = place ? byId.get(place) : undefined;
    if (rating !== undefined) matched = true;
    return { ...v, rating: rating === undefined ? undefined : rating.toFixed(1) };
  });
  return matched ? out : videos;
}

/** Rounded to one decimal, the way it's shown. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** IMDb's vote counts by `season:episode`, for ratingGrid. */
export function imdbVotes(imdb: readonly EpisodeRating[] | undefined): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const r of imdb ?? []) if (r.votes) out.set(`${r.season}:${r.episode}`, r.votes);
  return out;
}

/** A video's place in IMDb's numbering (`tt…:season:episode`), as `season:episode`. */
const imdbPlace = (v: Video) => {
  const m = /^tt\d+:(\d+):(\d+)$/.exec(v.id);
  return m ? `${Number(m[1])}:${Number(m[2])}` : undefined;
};

export function ratingGrid(
  videos: readonly Video[],
  released: (v: Video) => boolean = isReleased,
  votes: ReadonlyMap<string, number> = new Map(),
): RatingGrid {
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
          const place = imdbPlace(video);
          const count = place === undefined ? undefined : votes.get(place);
          return { video, rating, step: rating === undefined ? undefined : ratingStep(rating), released: isOut, votes: count };
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

/** One rated episode on the timeline: its place along the show (0, 1, 2…) and where it sits in the grid. */
export interface TimelinePoint {
  x: number;
  rating: number;
  step: number;
  /** Its grid row and cell. */
  row: number;
  col: number;
}

/** Every rated, released episode in order along the show, and where each season's run of them starts and ends. */
export function timeline(grid: RatingGrid): { points: TimelinePoint[]; seasons: { season: number; from: number; to: number }[] } {
  const points: TimelinePoint[] = [];
  const seasons: { season: number; from: number; to: number }[] = [];
  grid.rows.forEach((row, r) => {
    const from = points.length;
    row.cells.forEach((cell, c) => {
      if (cell.released && cell.rating !== undefined && cell.step !== undefined)
        points.push({ x: points.length, rating: cell.rating, step: cell.step, row: r, col: c });
    });
    if (points.length > from) seasons.push({ season: row.season, from, to: points.length - 1 });
  });
  return { points, seasons };
}

/**
 * The trendline: each value the mean of those within `half` either side of it (fewer at the ends), so it follows
 * the show's drift without its episode-to-episode swings. `half` grows with the length: about a twentieth of it.
 */
export function trend(values: readonly number[], half = Math.max(2, Math.round(values.length / 20))): number[] {
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    return sum / (hi - lo + 1);
  });
}
