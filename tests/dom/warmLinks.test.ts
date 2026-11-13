import { afterAll, expect, spyOn, test } from "bun:test";
import { api } from "../../src/lib/api";
import { knownReadiness, warmLinks } from "../../src/lib/playback/readiness";
import type { RankedStream, Readiness } from "../../src/lib/types";

const asked: string[] = [];
const ready = spyOn(api, "streamReady").mockImplementation(async (url: string): Promise<Readiness> => {
  asked.push(url);
  return { state: "ready", ms: 300 };
});
afterAll(() => ready.mockRestore());

const source = (url: string) => ({ stream: { url } }) as unknown as RankedStream;

test("the next episode's first picks are asked ahead, web links only, once each", async () => {
  const web = "https://media.example.com/next.mkv";
  const stop = warmLinks([source(web), source("http://127.0.0.1:1/torrent"), source("magnet:?xt=urn:btih:0")]);
  await new Promise((r) => setTimeout(r, 20));
  stop();
  // The torrent engine's loopback link is http too: it answers locally, which is fine to ask.
  expect(asked).toEqual([web, "http://127.0.0.1:1/torrent"]);
  expect(knownReadiness(web)?.state).toBe("ready");
  // Asked again within minutes: the answer kept is used.
  warmLinks([source(web)])();
  await new Promise((r) => setTimeout(r, 20));
  expect(asked.filter((u) => u === web)).toHaveLength(1);
});
