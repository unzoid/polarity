import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { MpvMedia } from "../../src/components/player/mpvMedia";

const property = (name: string, data: unknown, held?: boolean) => emit("mpv://property", { name, data, ...(held ? { held } : {}) });

async function playing() {
  const m = new MpvMedia();
  await m.attach();
  await property("duration", 600);
  await property("time-pos", 100);
  await property("pause", false);
  const events: string[] = [];
  for (const type of ["play", "pause", "playing", "waiting"]) m.addEventListener(type, () => events.push(type));
  const notes: string[] = [];
  m.addEventListener("watch", (e) => notes.push((e as CustomEvent<string>).detail));
  return { m, events, notes };
}

describe("autocrop holding playback for a screenshot (#424)", () => {
  beforeEach(() => mockIPC(() => {}, { shouldMockEvents: true }));
  afterEach(() => clearMocks());

  test("is not a pause: no pause or play for the player (its controls, the watch party) to react to", async () => {
    const { m, events, notes } = await playing();
    await property("pause", true, true);
    expect(m.paused).toBe(false);
    await property("pause", false, true);
    expect(m.paused).toBe(false);
    expect(events).toEqual([]);
    expect(notes.some((n) => /held/.test(n))).toBe(true);
  });

  test("the clock stands still while held, and follows mpv after", async () => {
    const { m } = await playing();
    await property("pause", true, true);
    const at = m.currentTime;
    await new Promise((r) => setTimeout(r, 30));
    expect(m.currentTime).toBe(at);
    await property("pause", false, true);
    await property("time-pos", 100.5);
    expect(m.currentTime).toBeGreaterThanOrEqual(100.5);
  });

  test("the viewer's own pause still counts", async () => {
    const { m, events } = await playing();
    await property("pause", true);
    expect(m.paused).toBe(true);
    expect(events).toContain("pause");
  });

  test("playing on from the viewer's pause is a play, even marked held", async () => {
    const { m, events } = await playing();
    await property("pause", true);
    await property("pause", false, true);
    expect(m.paused).toBe(false);
    expect(events).toContain("play");
  });

  test("the engine's lines reach the watch log", async () => {
    const { notes } = await playing();
    await emit("mpv://watch", { text: "autocrop: bars 140/0 px from 12.000 s, keyframe" });
    expect(notes).toContain("autocrop: bars 140/0 px from 12.000 s, keyframe");
  });
});
