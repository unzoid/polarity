import { expect, test } from "bun:test";
import { YouTubeMedia, youtubeError } from "../src/components/player/youtubeMedia";

// A YouTube link's player (#201): YouTube's embed driven by its IFrame Player API messages.

function setup() {
  const sent: { event: string; func?: string; args?: unknown[] }[] = [];
  const media = new YouTubeMedia((m) => sent.push(JSON.parse(m)));
  const events: string[] = [];
  for (const name of ["play", "pause", "waiting", "playing", "loadedmetadata", "timeupdate", "ended", "error", "seeking", "seeked", "titlechange"]) {
    media.addEventListener(name, () => events.push(name));
  }
  const say = (event: string, info?: unknown) => media.receive(JSON.stringify({ event, info }));
  const commands = () => sent.filter((m) => m.event === "command").map((m) => [m.func, ...(m.args ?? [])]);
  return { media, sent, events, say, commands };
}

test("nothing is commanded before the player is ready; then it starts where the room is", () => {
  const { media, say, commands } = setup();
  media.volume = 0.5;
  media.load(42);
  expect(commands()).toEqual([]);
  say("onReady");
  expect(commands()).toEqual([
    ["addEventListener", "onStateChange"],
    ["addEventListener", "onError"],
    ["setVolume", 50],
    ["unMute"],
    ["seekTo", 42, true],
    ["playVideo"],
  ]);
  // A second onReady changes nothing.
  say("onReady");
  expect(commands()).toHaveLength(6);
});

test("paused before it was ready, it starts paused", () => {
  const { media, say, commands } = setup();
  media.pause();
  media.load(null);
  say("onReady");
  expect(commands().at(-1)).toEqual(["pauseVideo"]);
});

test("the player's reports become a video element's events", () => {
  const { media, say, events } = setup();
  say("onReady");
  say("infoDelivery", { duration: 600, currentTime: 0, playerState: 3, videoData: { title: "An Open Film" } });
  expect(media.duration).toBe(600);
  expect(media.readyState).toBe(4);
  expect(media.title).toBe("An Open Film");
  expect(media.paused).toBe(false);
  say("onStateChange", 1);
  say("infoDelivery", { currentTime: 12.5, videoLoadedFraction: 0.5 });
  expect(media.currentTime).toBeGreaterThanOrEqual(12.5);
  expect(media.buffered.end(0)).toBe(300);
  say("onStateChange", 2);
  expect(media.paused).toBe(true);
  say("onStateChange", 1);
  say("onStateChange", 0);
  expect(media.ended).toBe(true);
  expect(events).toEqual(["loadedmetadata", "titlechange", "play", "waiting", "timeupdate", "playing", "timeupdate", "pause", "play", "playing", "pause", "ended"]);
});

test("controls become commands", () => {
  const { media, say, commands, events } = setup();
  say("onReady");
  const before = commands().length;
  media.pause();
  void media.play();
  media.muted = true;
  media.volume = 0.25;
  media.playbackRate = 1.5;
  media.currentTime = 90;
  expect(commands().slice(before)).toEqual([["pauseVideo"], ["playVideo"], ["mute"], ["setVolume", 25], ["setPlaybackRate", 1.5], ["seekTo", 90, true]]);
  expect(events.at(-1)).toBe("seeking");
  expect(media.currentTime).toBe(90);
});

test("a report from before a seek landed doesn't move the time back", () => {
  const { media, say, events } = setup();
  say("onReady");
  say("infoDelivery", { duration: 600, currentTime: 10, playerState: 2 });
  media.currentTime = 300;
  say("infoDelivery", { currentTime: 10.2 });
  expect(media.currentTime).toBe(300);
  say("infoDelivery", { currentTime: 300.1 });
  expect(media.currentTime).toBe(300.1);
  expect(events.filter((e) => e === "seeked")).toHaveLength(1);
});

test("errors say why, and junk messages are dropped", () => {
  const { media, say, events } = setup();
  for (const junk of [
    "not json",
    "null",
    "[]",
    '{"event":5}',
    '{"event":"infoDelivery","info":"x"}',
    '{"event":"infoDelivery","info":{"duration":"600","currentTime":null}}',
  ])
    media.receive(junk);
  media.receive({ event: "onStateChange", info: "1" });
  expect(events).toEqual([]);
  expect(media.duration).toBeNaN();
  say("onError", 150);
  expect(events).toEqual(["error"]);
  expect(media.error).toEqual({ code: 150, message: youtubeError(150) });
  expect(youtubeError(100)).toContain("private");
  expect(youtubeError(999)).toContain("999");
});

test("#383: a buffer that ends paused, or a player that stops loaded (held, or its autoplay refused), says it can play", () => {
  const { media, say } = setup();
  const ready: number[] = [];
  media.addEventListener("canplay", () => ready.push(media.currentTime));
  say("onReady");
  // Autoplay refused: unstarted, then paused, before the duration is known.
  say("onStateChange", 2);
  expect(ready).toHaveLength(0);
  say("infoDelivery", { duration: 600, currentTime: 0 });
  expect(ready).toHaveLength(1);
  // Played, paused mid-buffer (a seek, or the party's hold): no longer loading.
  say("onStateChange", 1);
  say("onStateChange", 3);
  say("onStateChange", 2);
  expect(ready).toHaveLength(2);
  expect(media.paused).toBe(true);
  // Cued counts as stopped too.
  say("onStateChange", 5);
  expect(ready).toHaveLength(3);
});

test("#383: a play that buffers first says play once, as a video element does; a stall mid-play doesn't", () => {
  const { say, events } = setup();
  say("onReady");
  say("infoDelivery", { duration: 600, currentTime: 0, playerState: 2 });
  events.length = 0;
  say("onStateChange", 3);
  say("onStateChange", 1);
  say("onStateChange", 3);
  say("onStateChange", 1);
  expect(events).toEqual(["play", "waiting", "playing", "waiting", "playing"]);
});

test("#383: in a party, a play pressed on a YouTube video that buffers first reaches the room", async () => {
  const { createPartyFollower } = await import("../src/components/player/partyFollower");
  const { media, say } = setup();
  say("onReady");
  say("infoDelivery", { duration: 600, currentTime: 12, playerState: 2 });
  let t = 0;
  const room = { v: 1, by: "a", media: { videoId: "yt:abc", type: "movie" }, paused: true, held: false, position: 12, lag: 0 } as never;
  const acts: { paused?: boolean }[] = [];
  const f = createPartyFollower({
    media,
    videoId: "yt:abc",
    room: () => room,
    act: (p) => void acts.push(p),
    expected: () => 12,
    now: () => t,
    started: () => true,
    buffering: () => false,
  });
  media.addEventListener("play", f.onPlayPause);
  media.addEventListener("pause", f.onPlayPause);
  f.tick(); // matched the room (paused): from here on what happens here is the viewer's
  t = 5000;
  media.play();
  say("onStateChange", 3);
  say("onStateChange", 1);
  expect(acts).toContainEqual(expect.objectContaining({ paused: false }));
});
