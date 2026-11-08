import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { useTracks } from "../../src/components/player/useTracks";
import { MpvMedia, type MpvTrack } from "../../src/components/player/mpvMedia";
import { resetTrackMemory, trackMemoryKey } from "../../src/lib/playback/trackMemory";
import { render } from "./render";

/** An mpv with these tracks, recording what the hook sets. */
function fakeMpv(tracks: MpvTrack[]) {
  const set = new Map<string, unknown>();
  const mpv = Object.setPrototypeOf(new EventTarget(), MpvMedia.prototype) as MpvMedia;
  mpv.tracks = tracks;
  mpv.aid = "auto";
  mpv.sid = "auto";
  mpv.set = async (name: string, value: unknown) => void set.set(name, value);
  mpv.command = async () => undefined;
  return { mpv, set };
}

const storage = (() => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
})();
beforeEach(() => {
  storage.items.clear();
  resetTrackMemory(storage);
});
afterEach(() => resetTrackMemory(undefined));

const episode = "tt0000001:1:1";
const film = { url: "https://media.example.com/film.mkv" };
const prefs = { audio: "en", subtitle: "en" };

type Tracks = ReturnType<typeof useTracks>;
async function play(mpv: MpvMedia, key: string | undefined) {
  const out: { tracks?: Tracks } = {};
  function Probe() {
    out.tracks = useTracks(mpv, "series", episode, prefs, () => {}, {}, false, key);
    return null;
  }
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  await act(async () => void mpv.dispatchEvent(new Event("loadedmetadata")));
  return { out, view };
}

const first: MpvTrack[] = [
  { id: 1, type: "audio", lang: "eng", codec: "aac", "demux-channel-count": 6 },
  { id: 2, type: "audio", lang: "jpn", codec: "aac", "demux-channel-count": 2 },
  { id: 1, type: "sub", lang: "eng", codec: "subrip" },
  { id: 2, type: "sub", lang: "eng", title: "Signs", codec: "ass" },
];
// The same file after a restart, its tracks numbered differently by the player.
const renumbered: MpvTrack[] = [
  { id: 1, type: "audio", lang: "jpn", codec: "aac", "demux-channel-count": 2 },
  { id: 2, type: "audio", lang: "eng", codec: "aac", "demux-channel-count": 6 },
  { id: 1, type: "sub", lang: "eng", title: "Signs", codec: "ass" },
  { id: 2, type: "sub", lang: "eng", codec: "subrip" },
];

test("tracks picked for a source are chosen again when it plays again, over the language settings (#418)", async () => {
  const key = trackMemoryKey(episode, film);
  const a = fakeMpv(first);
  const one = await play(a.mpv, key);
  // The settings pick English audio and the first English subtitle.
  expect(a.set.get("aid")).toBe(1);
  expect(a.set.get("sid")).toBe(1);
  await act(async () => {
    one.out.tracks!.selectAudio("2");
    await one.out.tracks!.selectSubtitle("emb:2");
  });
  await one.view.unmount();

  // Restart: storage stays, the memory is read again.
  resetTrackMemory(storage);
  const b = fakeMpv(renumbered);
  const two = await play(b.mpv, key);
  expect(b.set.get("aid")).toBe(1);
  expect(b.set.get("sid")).toBe(1);
  await two.view.unmount();

  // Another source of the same episode starts from the settings.
  const c = fakeMpv(renumbered);
  const three = await play(c.mpv, trackMemoryKey(episode, { url: "https://media.example.com/other.mkv" }));
  expect(c.set.get("aid")).toBe(2);
  expect(c.set.get("sid")).toBe(1);
  await three.view.unmount();
});

test("subtitles turned off for a source stay off for it (#418)", async () => {
  const key = trackMemoryKey(episode, film);
  const a = fakeMpv(first);
  const one = await play(a.mpv, key);
  await act(async () => one.out.tracks!.selectSubtitle("off"));
  await one.view.unmount();
  const b = fakeMpv(first);
  const two = await play(b.mpv, key);
  expect(b.set.get("sid")).toBe("no");
  await two.view.unmount();
});
