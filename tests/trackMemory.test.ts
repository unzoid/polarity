import { beforeEach, expect, test } from "bun:test";
import {
  MAX,
  forgetTracks,
  matchTrack,
  recallTracks,
  rememberTracks,
  rememberedSources,
  resetTrackMemory,
  trackMemoryKey,
} from "../src/lib/playback/trackMemory";

/** A localStorage stand-in that outlives `resetTrackMemory`, as the real one outlives a restart. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

let storage = memoryStorage();
beforeEach(() => {
  storage = memoryStorage();
  resetTrackMemory(storage);
});

const episode = "tt0000001:1:1";
const film = { url: "https://media.example.com/film.mkv?token=TOKEN" };
const other = { url: "https://media.example.com/other.mkv" };

test("tracks picked for a source come back for that source after a restart, and only for it (#418)", () => {
  const key = trackMemoryKey(episode, film);
  rememberTracks(key, episode, { audio: { id: "2", lang: "jpn", codec: "aac", channels: 2 } });
  rememberTracks(key, episode, { subtitle: { off: true } });
  rememberTracks(key, episode, { delay: -0.5 });
  resetTrackMemory(storage);
  expect(recallTracks(trackMemoryKey(episode, film))).toEqual({
    audio: { id: "2", lang: "jpn", codec: "aac", channels: 2, title: undefined },
    subtitle: { off: true },
    delay: -0.5,
  });
  // Another source of the same episode, or the same file for another episode, starts from the settings.
  expect(recallTracks(trackMemoryKey(episode, other))).toBeUndefined();
  expect(recallTracks(trackMemoryKey("tt0000001:1:2", film))).toBeUndefined();
  // A torrent's file is its own source; its hash in either case is the same one.
  const torrent = trackMemoryKey(episode, { infoHash: "A".repeat(40), fileIdx: 1 });
  expect(torrent).toBe(trackMemoryKey(episode, { infoHash: "a".repeat(40), fileIdx: 1 }));
  expect(torrent).not.toBe(trackMemoryKey(episode, { infoHash: "a".repeat(40), fileIdx: 2 }));
});

test("storage keeps no link, token or title id (#418)", () => {
  rememberTracks(trackMemoryKey(episode, film), episode, { subtitle: { addon: { lang: "en", id: "h4sh" } } });
  const raw = [...storage.items.values()].join("");
  expect(raw).not.toContain("example.com");
  expect(raw).not.toContain("TOKEN");
  expect(raw).not.toContain("tt0000001");
});

test("only the 500 most recently played sources are kept (#418)", () => {
  for (let i = 0; i <= MAX; i++) rememberTracks(trackMemoryKey(episode, { url: `https://media.example.com/${i}.mkv` }), episode, { delay: i }, 1000 + i);
  expect(rememberedSources()).toBe(MAX);
  resetTrackMemory(storage);
  expect(rememberedSources()).toBe(MAX);
  expect(recallTracks(trackMemoryKey(episode, { url: "https://media.example.com/0.mkv" }))).toBeUndefined();
  expect(recallTracks(trackMemoryKey(episode, { url: `https://media.example.com/${MAX}.mkv` }))?.delay).toBe(MAX);
});

test("resetting a title's progress forgets its episodes' sources; clearing forgets them all (#418)", () => {
  rememberTracks(trackMemoryKey(episode, film), episode, { delay: 1 });
  rememberTracks(trackMemoryKey("tt0000002", film), "tt0000002", { delay: 2 });
  forgetTracks([episode]);
  expect(recallTracks(trackMemoryKey(episode, film))).toBeUndefined();
  expect(recallTracks(trackMemoryKey("tt0000002", film))?.delay).toBe(2);
  forgetTracks();
  expect(rememberedSources()).toBe(0);
});

test("something unreadable in storage is left out, the rest kept (#418)", () => {
  const key = trackMemoryKey(episode, film)!;
  storage.setItem("polar.sourceTracks", JSON.stringify({ [key]: { video: "v", used: 1, delay: 1, audio: 7, subtitle: { addon: {} } }, bad: 3 }));
  resetTrackMemory(storage);
  expect(recallTracks(key)).toEqual({ delay: 1, audio: undefined, subtitle: undefined });
  expect(rememberedSources()).toBe(1);
});

test("a remembered track is found again when the player numbers tracks differently (#418)", () => {
  const want = { id: "2", lang: "jpn", title: "Main", codec: "aac", channels: 2 };
  // The same numbering: the same id.
  const same = [
    { id: "1", lang: "eng", codec: "aac", channels: 6 },
    { id: "2", lang: "jpn", title: "Main", codec: "aac", channels: 2 },
  ];
  expect(matchTrack(want, same)?.id).toBe("2");
  // Renumbered: id 2 is now another language; found by language, title, codec and channels.
  const renumbered = [
    { id: "1", lang: "jpn", title: "Commentary", codec: "aac", channels: 2 },
    { id: "2", lang: "eng", codec: "aac", channels: 6 },
    { id: "3", lang: "ja", title: "Main", codec: "aac", channels: 2 },
  ];
  expect(matchTrack(want, renumbered)?.id).toBe("3");
  // No track in that language: nothing, so the settings decide.
  expect(matchTrack(want, [{ id: "2", lang: "eng", codec: "aac" }])).toBeUndefined();
});
