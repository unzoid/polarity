import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import { loadCoordinator } from "../src/lib/net/limiter";
import { checkReadiness, firstReady } from "../src/lib/playback/readiness";
import { api } from "../src/lib/api";
import type { RankedStream, Readiness } from "../src/lib/types";

function makeStream(url: string): RankedStream {
  return {
    stream: { url, name: "Example" },
    addon: "ExampleAddon",
    score: 100,
    quality: {
      resolution: "1080p",
      hdr: [],
      audio: [],
      source: "web",
      codec: "h264",
      cached: true,
      languages: [],
    },
  } as unknown as RankedStream;
}

describe("readiness ExclusivePriorityQueue & critical-playback shedding", () => {
  const origStreamReady = api.streamReady;

  afterEach(() => {
    api.streamReady = origStreamReady;
    loadCoordinator.reset();
  });

  test("critical playback sheds background readiness probes immediately", async () => {
    let calls = 0;
    api.streamReady = async () => {
      calls++;
      return { state: "ready", ms: 50 };
    };
    const release = loadCoordinator.enterCritical();
    try {
      const res = await checkReadiness(makeStream("https://media-shed.example.com/film.mkv"));
      expect(res.state).toBe("unchecked");
      expect(calls).toBe(0);
    } finally {
      release();
    }
  });

  test("firstReady resolves immediately on the first ready stream across hosts without HoL blocking", async () => {
    const started: string[] = [];
    let releaseSlow!: (r: Readiness) => void;
    api.streamReady = (url: string) => {
      started.push(new URL(url).host);
      if (url.includes("slow.example.com")) {
        return new Promise<Readiness>((resolve) => {
          releaseSlow = resolve;
        });
      }
      return Promise.resolve({ state: "ready", ms: 42 });
    };

    const s1 = makeStream("https://slow.example.com/a.mkv");
    const s2 = makeStream("https://slow.example.com/b.mkv"); // same host as s1: must NOT block fast.example.com!
    const s3 = makeStream("https://fast.example.com/c.mkv");

    const winner = await firstReady([s1, s2, s3]);
    expect(winner?.stream.stream.url).toBe("https://fast.example.com/c.mkv");
    expect(winner?.readiness.state).toBe("ready");
    // fast.example.com started even while slow.example.com/a.mkv was still pending.
    expect(started).toContain("fast.example.com");
    releaseSlow({ state: "slow", ms: 4000 });
  });
});
