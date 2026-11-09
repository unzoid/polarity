import { expect, test } from "bun:test";
import { swipeGoesBack, type BackSwipe } from "../src/lib/platform/backSwipe";
import { followSwipe, type BackDrag } from "../src/lib/platform/back";

const step = (phase: BackSwipe["phase"], x: number, velocity = 0): BackSwipe => ({ phase, x, width: 400, velocity });

test("a swipe goes back past half the width or when flicked, never when flicked back left (#451)", () => {
  expect(swipeGoesBack({ x: 210, width: 400, velocity: 0 })).toBe(true);
  expect(swipeGoesBack({ x: 190, width: 400, velocity: 0 })).toBe(false);
  expect(swipeGoesBack({ x: 60, width: 400, velocity: 800 })).toBe(true);
  expect(swipeGoesBack({ x: 10, width: 400, velocity: 800 })).toBe(false);
  expect(swipeGoesBack({ x: 300, width: 400, velocity: -700 })).toBe(false);
});

test("a swipe the drag takes moves it and ends it; one it doesn't calls the handler only when it goes back (#451)", () => {
  const seen: string[] = [];
  let take = true;
  const drag: BackDrag = {
    begin: () => (seen.push("begin"), take),
    move: (x) => void seen.push(`move ${x}`),
    end: (back) => void seen.push(`end ${back}`),
  };
  let backs = 0;
  const follow = followSwipe(
    () => backs++,
    () => drag,
  );
  for (const s of [step("begin", 8), step("move", 120), step("move", 260), step("end", 260)]) follow(s);
  expect(seen).toEqual(["begin", "move 8", "move 120", "move 260", "end true"]);
  expect(backs).toBe(0);

  // Cancelled (another touch, the app leaving): the drag puts the page back.
  seen.length = 0;
  for (const s of [step("begin", 8), step("move", 300), step("cancel", 300)]) follow(s);
  expect(seen).toEqual(["begin", "move 8", "move 300", "end false"]);

  // Not taken (a sheet is open): nothing moves, and the handler runs once the swipe ends far enough in.
  take = false;
  seen.length = 0;
  for (const s of [step("begin", 8), step("move", 120), step("end", 120)]) follow(s);
  expect(backs).toBe(0);
  for (const s of [step("begin", 8), step("move", 260), step("end", 260)]) follow(s);
  expect(backs).toBe(1);
  expect(seen).toEqual(["begin", "begin"]);

  // No drag at all (TV mode): only the handler.
  const plain = followSwipe(() => backs++);
  for (const s of [step("begin", 8), step("end", 60, 900)]) plain(s);
  expect(backs).toBe(2);
});
