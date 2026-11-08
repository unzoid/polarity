import { expect, test } from "bun:test";
import { listable, playableFromList } from "../src/lib/catalog/listable";
import type { MetaPreview } from "../src/lib/types";

const none = () => false;
const all = () => true;
const series = (more: Partial<MetaPreview> = {}): MetaPreview => ({ id: "tt0000001", type: "series", name: "Lantern Street", releaseInfo: "2017", ...more });
const film = (more: Partial<MetaPreview> = {}): MetaPreview => ({ id: "tt0000002", type: "movie", name: "The Quiet Harbour", ...more });
const episode = { id: "tt0000001:1:1", title: "Pilot", season: 1, episode: 1 };

test("listable: a series with no art, no description and no known episodes is left out (#337)", () => {
  expect(listable(series(), undefined, none)).toBe(false);
});

test("listable: art whose every picture failed counts as none; one still loading counts as there", () => {
  const art = { poster: "https://media.example.com/p.jpg", background: "https://media.example.com/b.jpg" };
  expect(listable(series(art), undefined, all)).toBe(false);
  expect(listable(series(art), undefined, none)).toBe(true);
  expect(listable(series(art), undefined, (u) => u === art.poster)).toBe(true); // the backdrop may still load
});

test("listable: a playable title without art is kept, and a series counts as playable once its cached details list an episode", () => {
  expect(listable(film(), undefined, none)).toBe(true);
  expect(listable(film({ poster: "https://media.example.com/p.jpg" }), undefined, all)).toBe(true);
  expect(listable(series(), { videos: [episode] }, none)).toBe(true);
  expect(listable(series(), { videos: [] }, none)).toBe(false);
});

test("listable: an unplayable title with a description or art is kept (an announced series)", () => {
  expect(listable(series({ description: "Coming next spring." }), undefined, all)).toBe(true);
  expect(listable(series({ description: "   " }), undefined, none)).toBe(false);
  expect(listable(series({ poster: "https://media.example.com/p.jpg" }), undefined, none)).toBe(true);
});

test("playableFromList: films always, series only with episodes", () => {
  expect(playableFromList(film())).toBe(true);
  expect(playableFromList(series())).toBe(false);
  expect(playableFromList(series(), { videos: [episode] })).toBe(true);
});
