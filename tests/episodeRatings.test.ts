import { expect, test } from "bun:test";
import {
  formatRating,
  MIN_RATED,
  moveInGrid,
  parseRating,
  RATING_STEPS,
  ratingGrid,
  ratingStep,
  imdbVotes,
  showImdbId,
  timeline,
  trend,
  showRatingGrid,
  withImdbRatings,
} from "../src/lib/library/episodeRatings";
import type { Video } from "../src/lib/types";

const ep = (season: number, episode: number, rating?: string, released?: string): Video => ({
  id: `tt0000000:${season}:${episode}`,
  title: `Episode ${episode}`,
  season,
  episode,
  rating,
  released,
});
const out = () => true;

test("ratings parse from the strings sources send; nothing, zero and nonsense are no rating", () => {
  expect(parseRating("8.4")).toBe(8.4);
  expect(parseRating(" 7 ")).toBe(7);
  expect(parseRating("6,5")).toBe(6.5);
  expect(parseRating(undefined)).toBeUndefined();
  expect(parseRating("")).toBeUndefined();
  expect(parseRating("0")).toBeUndefined();
  expect(parseRating("N/A")).toBeUndefined();
  expect(parseRating("11")).toBeUndefined();
});

test("each rating takes the last step it reaches, on a fixed scale", () => {
  expect(ratingStep(1)).toBe(0);
  expect(ratingStep(4.99)).toBe(0);
  expect(ratingStep(5)).toBe(1);
  expect(ratingStep(7.9)).toBe(3);
  expect(ratingStep(8)).toBe(4);
  expect(ratingStep(9.6)).toBe(5);
  expect(ratingStep(9.7)).toBe(6);
  expect(ratingStep(10)).toBe(RATING_STEPS.length - 1);
  // Lowest first, rising.
  for (let i = 1; i < RATING_STEPS.length; i++) expect(RATING_STEPS[i].min).toBeGreaterThan(RATING_STEPS[i - 1].min);
});

test("rows by season in order, cells by episode, specials left out, averages of the rated ones", () => {
  const grid = ratingGrid(
    [ep(2, 2, "9.0"), ep(1, 2, "8.0"), ep(0, 1, "9.9"), ep(1, 1, "7.0"), ep(2, 1, "8.5"), ep(1, 3), ep(2, 3, "7.75")],
    out,
  );
  expect(grid.rows.map((r) => r.season)).toEqual([1, 2]);
  expect(grid.rows[0].cells.map((c) => c.video.episode)).toEqual([1, 2, 3]);
  expect(grid.rows[0].cells.map((c) => c.rating)).toEqual([7, 8, undefined]);
  expect(grid.rows[0].average).toBe(7.5);
  expect(grid.rows[0].averageStep).toBe(ratingStep(7.5));
  expect(grid.rows[1].average).toBe(8.4);
  expect(grid.columns).toBe(3);
  expect(grid.rated).toBe(5);
  expect(grid.released).toBe(6);
});

test("a season with no ratings has no average", () => {
  const grid = ratingGrid([ep(1, 1), ep(1, 2)], out);
  expect(grid.rows[0].average).toBeUndefined();
  expect(grid.rows[0].averageStep).toBeUndefined();
});

test("shows only with enough rated episodes, and at least half of those out", () => {
  const rated = (n: number) => Array.from({ length: n }, (_, i) => ep(1, i + 1, "8"));
  expect(showRatingGrid(ratingGrid(rated(MIN_RATED - 1), out))).toBe(false);
  expect(showRatingGrid(ratingGrid(rated(MIN_RATED), out))).toBe(true);
  // 6 rated of 20 out: mostly holes.
  const sparse = [...rated(6), ...Array.from({ length: 14 }, (_, i) => ep(2, i + 1))];
  expect(showRatingGrid(ratingGrid(sparse, out))).toBe(false);
  // Episodes still to come don't count against it.
  const upcoming = [...rated(6), ...Array.from({ length: 14 }, (_, i) => ep(2, i + 1))];
  expect(showRatingGrid(ratingGrid(upcoming, (v) => v.season === 1))).toBe(true);
  expect(showRatingGrid(ratingGrid([], out))).toBe(false);
});

test("episodes not out yet are marked, by their date", () => {
  const grid = ratingGrid([ep(1, 1, "8", "2000-01-01T00:00:00Z"), ep(1, 2, undefined, "2999-01-01T00:00:00Z")]);
  expect(grid.rows[0].cells.map((c) => c.released)).toEqual([true, false]);
});

test("a long show keeps every season and the longest season's width", () => {
  const videos: Video[] = [];
  for (let s = 1; s <= 24; s++) for (let e = 1; e <= (s === 7 ? 60 : 22); e++) videos.push(ep(s, e, "7.9"));
  const grid = ratingGrid(videos, out);
  expect(grid.rows.length).toBe(24);
  expect(grid.columns).toBe(60);
  expect(showRatingGrid(grid)).toBe(true);
});

test("shown with one decimal", () => {
  expect(formatRating(8)).toBe("8.0");
  expect(formatRating(7.75)).toBe("7.8");
});

test("keys move across the grid, passing over what doesn't open", () => {
  const grid = ratingGrid(
    [ep(1, 1, "8"), ep(1, 2, "8"), ep(1, 3, "8"), ep(1, 4, "8"), ep(2, 1, "8"), ep(2, 2, "8"), ep(3, 1, "8"), ep(3, 2), ep(3, 3, "8")],
    (v) => !(v.season === 3 && v.episode === 2),
  );
  expect(moveInGrid(grid, 0, 0, "right")).toEqual([0, 1]);
  expect(moveInGrid(grid, 0, 0, "left")).toBeNull();
  expect(moveInGrid(grid, 0, 3, "right")).toBeNull();
  expect(moveInGrid(grid, 0, 1, "end")).toEqual([0, 3]);
  expect(moveInGrid(grid, 0, 3, "home")).toEqual([0, 0]);
  // Down from the 4th episode into a shorter season: its nearest.
  expect(moveInGrid(grid, 0, 3, "down")).toEqual([1, 1]);
  // Past the one not out yet.
  expect(moveInGrid(grid, 2, 0, "right")).toEqual([2, 2]);
  expect(moveInGrid(grid, 2, 2, "up")).toEqual([1, 1]);
  expect(moveInGrid(grid, 2, 0, "down")).toBeNull();
});

test("IMDb's ratings replace the catalog's by episode id; an episode IMDb leaves unrated is unrated", () => {
  const videos = [ep(1, 1, "7.7"), ep(1, 2, "7.6"), ep(2, 1, "7.5")];
  expect(showImdbId(videos)).toBe("tt0000000");
  const merged = withImdbRatings(videos, [
    { season: 1, episode: 1, rating: 9.1 },
    { season: 2, episode: 1, rating: 8.64 },
  ]);
  expect(merged.map((v) => v.rating)).toEqual(["9.1", undefined, "8.6"]);
});

test("the catalog's ratings stay when IMDb has none, or none that match", () => {
  const videos = [ep(1, 1, "7.7")];
  expect(withImdbRatings(videos, undefined)).toBe(videos);
  expect(withImdbRatings(videos, [])).toBe(videos);
  expect(withImdbRatings(videos, [{ season: 5, episode: 9, rating: 9 }])).toBe(videos);
  expect(showImdbId([{ ...videos[0], id: "kitsu:1:1" }])).toBeUndefined();
});

test("the timeline runs through every rated, released episode in order, each season's run marked", () => {
  const grid = ratingGrid([ep(1, 1, "7.1"), ep(1, 2), ep(1, 3, "8.0"), ep(2, 1, "9.0"), ep(2, 2, "8.0", "2999-01-01T00:00:00Z")], out);
  // ep(2, 2) counts as out here (`out`), so the far-future date doesn't drop it; unrated ones are left out.
  const { points, seasons } = timeline(grid);
  expect(points.map((p) => p.rating)).toEqual([7.1, 8, 9, 8]);
  expect(points.map((p) => p.x)).toEqual([0, 1, 2, 3]);
  expect(seasons).toEqual([
    { season: 1, from: 0, to: 1 },
    { season: 2, from: 2, to: 3 },
  ]);
});

test("the trendline is a moving average, narrower at the ends", () => {
  expect(trend([1, 2, 3, 4, 5], 1)).toEqual([1.5, 2, 3, 4, 4.5]);
  expect(trend([])).toEqual([]);
});

test("IMDb's vote counts reach the grid's cells by episode id", () => {
  const votes = imdbVotes([{ season: 1, episode: 2, rating: 8, votes: 1234 }]);
  const grid = ratingGrid([ep(1, 1, "7"), ep(1, 2, "8")], out, votes);
  expect(grid.rows[0].cells.map((c) => c.votes)).toEqual([undefined, 1234]);
});
