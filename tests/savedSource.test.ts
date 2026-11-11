import { expect, test } from "bun:test";
import { savedDownload, savedSource } from "../src/lib/playback/savedSource";
import type { RankedStream, Stream } from "../src/lib/types";

const ranked = (stream: Stream): RankedStream => ({ addon: "Open Films", stream, quality: {}, label: "" }) as unknown as RankedStream;
const film = { url: "https://media.example.com/film.mkv" };
const other = { url: "https://media.example.com/other.mkv" };
const torrent = { infoHash: "A".repeat(40), fileIdx: 2 };
const want = { metaId: "tt0000001", videoId: "tt0000001:1:1" };

test("a saved source is gone on with only while the add-ons offer it for this episode (#394)", () => {
  const saved = { ...want, stream: film };
  const answer = [ranked(other), ranked({ ...film, title: "as offered now" })];
  expect(savedSource(saved, want, answer)?.stream.title).toBe("as offered now");
  // Not in this episode's answer: nothing to resume, the answer is ranked as for a first play.
  expect(savedSource(saved, want, [ranked(other)])).toBeUndefined();
  // A torrent by its hash (any case) and file.
  expect(savedSource({ ...want, stream: torrent }, want, [ranked({ infoHash: "a".repeat(40), fileIdx: 2 })])).toBeDefined();
  expect(savedSource({ ...want, stream: torrent }, want, [ranked({ infoHash: "a".repeat(40), fileIdx: 1 })])).toBeUndefined();
});

test("a source saved for another title or episode is never gone on with (#394)", () => {
  const answer = [ranked(film)];
  // Another title sharing the episode's video id (a wrong link): its progress isn't this one's.
  expect(savedSource({ metaId: "tt0000002", videoId: want.videoId, stream: film }, want, answer)).toBeUndefined();
  expect(savedSource({ metaId: want.metaId, videoId: "tt0000001:1:2", stream: film }, want, answer)).toBeUndefined();
  expect(savedSource(null, want, answer)).toBeUndefined();
  expect(savedSource({ ...want, stream: undefined }, want, answer)).toBeUndefined();
});

test("the episode's download it was last played from goes on without asking (#394)", () => {
  const file = { url: "file:///downloads/film.mkv" };
  expect(savedDownload({ ...want, stream: file }, want, file)).toBe(file);
  expect(savedDownload({ ...want, stream: film }, want, file)).toBeUndefined();
  expect(savedDownload({ ...want, stream: file }, want, undefined)).toBeUndefined();
});
