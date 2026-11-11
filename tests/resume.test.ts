import { expect, test } from "bun:test";
import { resumeFrom, startPosition, type ResumeRule } from "../src/lib/playback/resume";

const rule: ResumeRule = { resume: true, rewind: 0, watchedFraction: 0.9 };

test("resumeFrom: off or nothing saved starts over", () => {
  expect(resumeFrom({ position: 100, duration: 1000 }, { ...rule, resume: false })).toBeUndefined();
  expect(resumeFrom(undefined, rule)).toBeUndefined();
});

test("resumeFrom: not within the first 30 seconds", () => {
  expect(resumeFrom({ position: 30, duration: 1000 }, rule)).toBeUndefined();
  expect(resumeFrom({ position: 31, duration: 1000 }, rule)).toBe(31);
});

test("resumeFrom: rewinds, never below zero", () => {
  expect(resumeFrom({ position: 100, duration: 1000 }, { ...rule, rewind: 10 })).toBe(90);
  expect(resumeFrom({ position: 100, duration: 1000 }, { ...rule, rewind: 500 })).toBe(0);
});

test("resumeFrom: a watched video starts over", () => {
  expect(resumeFrom({ position: 950, duration: 1000 }, rule)).toBeUndefined();
});

test("startPosition: party, then where a failed source got to, then saved", () => {
  expect(startPosition(50, 1920, 300)).toBe(50);
  expect(startPosition(undefined, 1920, 300)).toBe(1920);
  expect(startPosition(null, undefined, 300)).toBe(300);
  expect(startPosition(undefined, undefined, undefined)).toBeUndefined();
  expect(startPosition(0, 1920, 300)).toBe(0);
});
