import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import { buildContinueEntries, dismissUpNext, resetDismissedUpNext, upNextSeriesCandidates } from "../src/lib/library/continueWatching";
import type { Meta, Progress } from "../src/lib/types";

const showMeta: Meta = {
  id: "tt0000001",
  type: "series",
  name: "Example Series",
  poster: "https://images.example.com/poster.jpg",
  background: "https://images.example.com/bg.jpg",
  runtime: "48 min",
  videos: [
    { id: "tt0000001:1:1", title: "Episode One", season: 1, episode: 1, released: "2024-01-01" },
    { id: "tt0000001:1:2", title: "Episode Two", season: 1, episode: 2, released: "2024-01-08", thumbnail: "https://images.example.com/e2.jpg" },
    { id: "tt0000001:1:3", title: "Future Finale", season: 1, episode: 3, released: "2099-01-01" },
  ],
};

const finishedE1: Progress = {
  metaId: "tt0000001",
  type: "series",
  videoId: "tt0000001:1:1",
  name: "Example Series",
  position: 2800,
  duration: 2880,
  season: 1,
  episode: 1,
  episodeTitle: "Episode One",
  updatedAt: 2000,
};

const finishedMovie: Progress = {
  metaId: "tt0000002",
  type: "movie",
  videoId: "tt0000002",
  name: "Finished Film",
  position: 7100,
  duration: 7200,
  updatedAt: 3000,
};

const inProgressMovie: Progress = {
  metaId: "tt0000003",
  type: "movie",
  videoId: "tt0000003",
  name: "Halfway Film",
  position: 1800,
  duration: 7200,
  updatedAt: 1500,
};

afterEach(() => resetDismissedUpNext());

describe("Continue Watching Up Next", () => {
  test("queues the next released episode for a finished series and keeps finished movies out", () => {
    const metas = new Map<string, Meta>([[showMeta.id, showMeta]]);
    const entries = buildContinueEntries([inProgressMovie], [finishedMovie, finishedE1, inProgressMovie], metas);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      upNext: true,
      afterVideoId: "tt0000001:1:1",
      progress: {
        metaId: "tt0000001",
        videoId: "tt0000001:1:2",
        season: 1,
        episode: 2,
        episodeTitle: "Episode Two",
        position: 0,
        duration: 2880,
        background: "https://images.example.com/e2.jpg",
      },
    });
    expect(entries[1]).toMatchObject({ progress: inProgressMovie });
    expect(entries[1]!.upNext).toBeUndefined();
  });

  test("does not queue an unreleased episode when caught up", () => {
    const finishedE2: Progress = { ...finishedE1, videoId: "tt0000001:1:2", episode: 2, episodeTitle: "Episode Two" };
    const metas = new Map<string, Meta>([[showMeta.id, showMeta]]);
    const entries = buildContinueEntries([], [finishedE2], metas);
    expect(entries).toEqual([]);
  });

  test("dismissing an Up Next entry hides it until a newer episode finishes", () => {
    const metas = new Map<string, Meta>([[showMeta.id, showMeta]]);
    const entries = buildContinueEntries([], [finishedE1], metas);
    expect(entries).toHaveLength(1);
    dismissUpNext(entries);
    // Still hidden for the same finished episode.
    expect(upNextSeriesCandidates([], [finishedE1], { tt0000001: "tt0000001:1:1" })).toEqual([]);
    // Watching a different episode later makes it eligible again.
    const newer = { ...finishedE1, videoId: "tt0000001:1:2", episode: 2, updatedAt: 4000 };
    expect(upNextSeriesCandidates([], [newer], { tt0000001: "tt0000001:1:1" })).toHaveLength(1);
  });

  test("does not duplicate a series that already has an in-progress episode", () => {
    const partialE2: Progress = {
      ...finishedE1,
      videoId: "tt0000001:1:2",
      episode: 2,
      position: 500,
      duration: 2880,
      updatedAt: 2500,
    };
    const metas = new Map<string, Meta>([[showMeta.id, showMeta]]);
    const entries = buildContinueEntries([partialE2], [partialE2, finishedE1], metas);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.upNext).toBeUndefined();
    expect(entries[0]!.progress.videoId).toBe("tt0000001:1:2");
  });
});
