import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { MpvMedia } from "../../src/components/player/mpvMedia";

const property = (name: string, data: unknown) => emit("mpv://property", { name, data });

async function media() {
  const m = new MpvMedia();
  await m.attach();
  await property("duration", 600);
  await property("time-pos", 100);
  await property("pause", true);
  return m;
}

describe("mpv's ended state", () => {
  beforeEach(() => {
    mockIPC(() => undefined, { shouldMockEvents: true });
  });

  afterEach(() => clearMocks());

  test("reaching the end is reported once", async () => {
    const m = await media();
    let count = 0;
    m.addEventListener("ended", () => count++);
    await property("eof-reached", true);
    expect(m.ended).toBe(true);
    expect(count).toBe(1);
  });

  test("seeking back clears it", async () => {
    const m = await media();
    await property("eof-reached", true);
    m.currentTime = 300;
    expect(m.ended).toBe(false);
  });

  test("mpv reporting it clears it", async () => {
    const m = await media();
    await property("eof-reached", true);
    await property("eof-reached", false);
    expect(m.ended).toBe(false);
  });

  test("seeking to the end doesn't clear it", async () => {
    const m = await media();
    await property("eof-reached", true);
    m.currentTime = 600;
    expect(m.ended).toBe(true);
  });
});
