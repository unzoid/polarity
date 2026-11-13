import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { useTracks, type TrackPrefs } from "../../src/components/player/useTracks";
import { MpvMedia, type MpvTrack } from "../../src/components/player/mpvMedia";
import { resetTrackMemory } from "../../src/lib/playback/trackMemory";
import { resetPrefs, setPrefs } from "../../src/lib/settings";
import { render } from "./render";

// The native side: two subtitle add-ons, one with two English files.
const ADDON_SUBS = [
  { id: "a1", url: "https://subs.example.com/a1.srt", lang: "eng", addon: "Subs One" },
  { id: "a2", url: "https://subs.example.com/a2.srt", lang: "eng", addon: "Subs One" },
  { id: "b1", url: "https://subs.example.org/b1.srt", lang: "fre", addon: "Subs Two" },
];
const w = window as { __TAURI_INTERNALS__?: unknown };
w.__TAURI_INTERNALS__ = { invoke: async (cmd: string) => (cmd === "subtitles" ? ADDON_SUBS : null) };
afterAll(() => delete w.__TAURI_INTERNALS__);

/** An mpv with these tracks, recording what the hook sets and asks. */
function fakeMpv(tracks: MpvTrack[]) {
  const set = new Map<string, unknown>();
  const commands: unknown[][] = [];
  const mpv = Object.setPrototypeOf(new EventTarget(), MpvMedia.prototype) as MpvMedia;
  mpv.tracks = tracks;
  mpv.aid = "auto";
  mpv.sid = "auto";
  mpv.set = async (name: string, value: unknown) => void set.set(name, value);
  mpv.command = async (...args: unknown[]) => void commands.push(args);
  return { mpv, set, commands };
}

const storage = (() => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
})();
beforeEach(() => {
  storage.items.clear();
  resetTrackMemory(storage);
});
afterEach(() => {
  resetTrackMemory(undefined);
  resetPrefs();
});

type Tracks = ReturnType<typeof useTracks>;
async function play(mpv: MpvMedia, prefs: TrackPrefs, online = false) {
  const out: { tracks?: Tracks } = {};
  function Probe() {
    out.tracks = useTracks(mpv, "movie", "tt0000001", prefs, () => {}, {}, online, undefined);
    return null;
  }
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  await act(async () => void mpv.dispatchEvent(new Event("loadedmetadata")));
  // The add-ons' answer.
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  return { out, view };
}

const english = { audio: "en", subtitle: "en" };

test("every add-on subtitle is its own entry, named by its add-on", async () => {
  const { mpv } = fakeMpv([{ id: 1, type: "audio", lang: "jpn" }]);
  const { out, view } = await play(mpv, { audio: "", subtitle: "" }, true);
  const addon = out.tracks!.subtitles.filter((s) => s.id.startsWith("ext:"));
  expect(addon.map((s) => [s.label, s.detail])).toEqual([
    ["English", "Subs One · 1"],
    ["English", "Subs One · 2"],
    ["French", "Subs Two"],
  ]);
  expect(new Set(addon.map((s) => s.id)).size).toBe(3);
  await view.unmount();
});

test("the settings' language picks the full subtitle, or SDH when asked", async () => {
  const tracks: MpvTrack[] = [
    { id: 1, type: "audio", lang: "jpn" },
    { id: 1, type: "sub", lang: "eng", forced: true },
    { id: 2, type: "sub", lang: "eng", "hearing-impaired": true },
    { id: 3, type: "sub", lang: "eng" },
  ];
  const a = fakeMpv(tracks);
  await (await play(a.mpv, english)).view.unmount();
  expect(a.set.get("sid")).toBe(3);

  setPrefs({ preferSdh: true });
  const b = fakeMpv(tracks);
  await (await play(b.mpv, english)).view.unmount();
  expect(b.set.get("sid")).toBe(2);
});

test("speech already in the subtitle language shows only the forced subtitle", async () => {
  const tracks: MpvTrack[] = [
    { id: 1, type: "audio", lang: "eng" },
    { id: 1, type: "sub", lang: "eng" },
    { id: 2, type: "sub", lang: "eng", title: "Signs" },
  ];
  const a = fakeMpv(tracks);
  await (await play(a.mpv, { ...english, subtitleMode: "foreign" })).view.unmount();
  expect(a.set.get("sid")).toBe(2);

  const b = fakeMpv(tracks.slice(0, 2));
  await (await play(b.mpv, { ...english, subtitleMode: "foreign" })).view.unmount();
  expect(b.set.has("sid")).toBe(false);
});

test("the audio in the preferred language is the film's, not its description", async () => {
  const a = fakeMpv([
    { id: 1, type: "audio", lang: "eng", "visual-impaired": true },
    { id: 2, type: "audio", lang: "eng", title: "Commentary" },
    { id: 3, type: "audio", lang: "eng" },
  ]);
  await (await play(a.mpv, english)).view.unmount();
  expect(a.set.get("aid")).toBe(3);
});

test("the second subtitle comes on in its language, from the file first", async () => {
  setPrefs({ secondSubtitles: true, secondSubtitleLanguage: "ja" });
  const a = fakeMpv([
    { id: 1, type: "audio", lang: "jpn" },
    { id: 1, type: "sub", lang: "eng" },
    { id: 2, type: "sub", lang: "jpn" },
  ]);
  const { out, view } = await play(a.mpv, english);
  expect(a.set.get("sid")).toBe(1);
  expect(a.set.get("secondary-sid")).toBe(2);
  // Off in the column: gone, and not put on by itself next time.
  await act(async () => void (await out.tracks!.selectSecond("off")));
  expect(a.set.get("secondary-sid")).toBe("no");
  await view.unmount();
});

test("an add-on's second subtitle is added without replacing the first", async () => {
  setPrefs({ secondSubtitles: true, secondSubtitleLanguage: "fr" });
  const a = fakeMpv([
    { id: 1, type: "audio", lang: "jpn" },
    { id: 1, type: "sub", lang: "eng" },
  ]);
  // mpv lists the subtitle once it's added.
  a.mpv.command = async (...args: unknown[]) => {
    a.commands.push(args);
    if (args[0] === "sub-add") {
      a.mpv.tracks = [...a.mpv.tracks, { id: 2, type: "sub", lang: "fre", external: true, "external-filename": String(args[1]) }];
      a.mpv.dispatchEvent(new Event("tracks"));
    }
  };
  const { view } = await play(a.mpv, english, true);
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  expect(a.commands).toContainEqual(["sub-add", "https://subs.example.org/b1.srt", "auto", "French", "fr"]);
  expect(a.set.get("sid")).toBe(1);
  expect(a.set.get("secondary-sid")).toBe(2);
  await view.unmount();
});
