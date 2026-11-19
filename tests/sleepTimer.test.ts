import { describe, expect, test } from "bun:test";
import {
  EXTEND_MS,
  extendSleep,
  FADE_MS,
  sleepDone,
  sleepGain,
  sleepLabel,
  sleepLeft,
  sleepWarns,
  startSleep,
  WARN_MS,
} from "../src/lib/playback/sleepTimer";

// The player's sleep timer (#270), on a clock the test moves.
const T0 = 1_000_000;
const min = 60_000;

describe("a timer of so many minutes", () => {
  test("Off is no timer", () => {
    expect(startSleep("off", T0)).toBeNull();
  });

  test("runs out that many minutes after it was set, whatever the video does", () => {
    const t = startSleep("30", T0)!;
    expect(sleepLeft(t, T0)).toBe(30 * min);
    expect(sleepLeft(t, T0 + 29 * min)).toBe(min);
    expect(sleepDone(sleepLeft(t, T0 + 30 * min - 1))).toBe(false);
    expect(sleepDone(sleepLeft(t, T0 + 30 * min))).toBe(true);
    // The video's own length plays no part.
    expect(sleepLeft(t, T0, 10, 2)).toBe(30 * min);
  });

  test("the sound is full until the last 30 s, then fades to silence at the end", () => {
    const t = startSleep("15", T0)!;
    const end = T0 + 15 * min;
    expect(sleepGain(sleepLeft(t, end - FADE_MS - 1))).toBe(1);
    expect(sleepGain(sleepLeft(t, end - FADE_MS / 2))).toBeCloseTo(0.5);
    expect(sleepGain(sleepLeft(t, end))).toBe(0);
    expect(sleepGain(null)).toBe(1);
  });

  test("the prompt shows in the last minute only", () => {
    const t = startSleep("15", T0)!;
    const end = T0 + 15 * min;
    expect(sleepWarns(sleepLeft(t, end - WARN_MS - 1))).toBe(false);
    expect(sleepWarns(sleepLeft(t, end - WARN_MS))).toBe(true);
    expect(sleepWarns(sleepLeft(t, end - 1))).toBe(true);
    expect(sleepWarns(sleepLeft(t, end))).toBe(false);
  });

  test("+15 min adds a quarter of an hour to when it would have ended, and ends the fade", () => {
    const t = startSleep("15", T0)!;
    const at = T0 + 15 * min - 20_000; // fading, 20 s to go
    const longer = extendSleep(t, at, sleepLeft(t, at));
    expect(sleepLeft(longer, at)).toBe(20_000 + EXTEND_MS);
    expect(sleepGain(sleepLeft(longer, at))).toBe(1);
    expect(sleepWarns(sleepLeft(longer, at))).toBe(false);
  });
});

describe("the end of this episode", () => {
  test("ends with the video, counting the playback speed", () => {
    const t = startSleep("episode", T0)!;
    // 120 s of video left: 2 min at 1x, 1 min at 2x.
    expect(sleepLeft(t, T0, 120)).toBe(2 * min);
    expect(sleepLeft(t, T0 + 5 * min, 120, 2)).toBe(min);
    expect(sleepDone(sleepLeft(t, T0, 0))).toBe(true);
  });

  test("before the video's length is known it isn't ending, and the sound stays up", () => {
    const t = startSleep("episode", T0)!;
    expect(sleepLeft(t, T0, NaN)).toBeNull();
    expect(sleepLeft(t, T0)).toBeNull();
    expect(sleepDone(null)).toBe(false);
    expect(sleepWarns(null)).toBe(false);
    expect(sleepGain(null)).toBe(1);
  });

  test("fades over the episode's last 30 s and asks in its last minute", () => {
    const t = startSleep("episode", T0)!;
    expect(sleepWarns(sleepLeft(t, T0, 59))).toBe(true);
    expect(sleepGain(sleepLeft(t, T0, 15))).toBeCloseTo(0.5);
  });

  test("+15 min turns it into a time a quarter of an hour past the episode's end", () => {
    const t = startSleep("episode", T0)!;
    const left = sleepLeft(t, T0, 45)!;
    const longer = extendSleep(t, T0, left);
    expect(longer.kind).toBe("at");
    expect(sleepLeft(longer, T0)).toBe(45_000 + EXTEND_MS);
  });
});

test("the time left by the clock", () => {
  expect(sleepLabel(45_000)).toBe("0:45");
  expect(sleepLabel(12 * min + 30_000)).toBe("12:30");
  expect(sleepLabel(65 * min)).toBe("1:05:00");
  expect(sleepLabel(400)).toBe("0:01");
  expect(sleepLabel(-5)).toBe("0:00");
});
