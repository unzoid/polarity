import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { MpvMedia } from "../../src/components/player/mpvMedia";

const urlA = "https://media.example.com/a.mkv";
const urlB = "https://media.example.com/b.mkv";

const calls: [string, Record<string, unknown>][] = [];
const resolvers: (() => void)[] = [];

const tick = () => new Promise((r) => setTimeout(r, 0));
const seen = (cmd: string) => calls.filter(([c]) => c === cmd);
const until = async (cmd: string, n = 1) => {
  for (let i = 0; i < 50 && seen(cmd).length < n; i++) await tick();
};

describe("which player an mpv call is for", () => {
  beforeEach(() => {
    calls.length = 0;
    resolvers.length = 0;
    mockIPC(
      (cmd, args) => {
        calls.push([cmd, (args ?? {}) as Record<string, unknown>]);
        if (cmd === "mpv_load") return new Promise<void>((r) => resolvers.push(r));
      },
      { shouldMockEvents: true },
    );
  });

  afterEach(() => clearMocks());

  test("calls name their player", async () => {
    const a = new MpvMedia();
    await a.attach();
    a.load(urlA);
    await until("mpv_load");
    const owner = seen("mpv_load")[0][1].owner;
    expect(typeof owner).toBe("number");
    a.stop();
    resolvers[0]();
    await tick();
    await tick();
    await until("mpv_stop");
    expect(seen("mpv_stop")[0][1].owner).toBe(owner);
  });

  test("two players have different numbers", async () => {
    const a = new MpvMedia();
    const b = new MpvMedia();
    await a.attach();
    await b.attach();
    a.load(urlA);
    b.load(urlB);
    await until("mpv_load", 2);
    const [first, second] = seen("mpv_load");
    expect(first[1].owner).not.toBe(second[1].owner);
  });

  test("a load answered after a stop reports nothing", async () => {
    const a = new MpvMedia();
    await a.attach();
    let played = 0;
    a.addEventListener("play", () => played++);
    a.load(urlA);
    await until("mpv_load");
    a.stop();
    resolvers[0]();
    await tick();
    await tick();
    expect(played).toBe(0);
  });

  test("a load that isn't stopped reports playing", async () => {
    const a = new MpvMedia();
    await a.attach();
    let played = 0;
    a.addEventListener("play", () => played++);
    a.load(urlA);
    await until("mpv_load");
    resolvers[0]();
    await tick();
    await tick();
    expect(played).toBe(1);
  });
});
