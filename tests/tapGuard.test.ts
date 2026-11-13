import { expect, test } from "bun:test";
import { SLOP_PX } from "../src/lib/platform/longPress";
import { CLICK_MS, GLIDE_MS, guardTaps, MOVING_MS } from "../src/lib/platform/tapGuard";

/** A page to touch, and a clock that only moves when told to. The same for iOS and Android: both send these events. */
function setup() {
  const page = new EventTarget();
  let now = 1000;
  const off = guardTaps(page as unknown as Window, () => now);
  const tick = (ms: number) => void (now += ms);
  const touch = (type: string, points: { x: number; y: number }[] = []) =>
    page.dispatchEvent(Object.assign(new Event(type), { touches: points.map((p) => ({ clientX: p.x, clientY: p.y })) }));
  const scroll = () => page.dispatchEvent(new Event("scroll"));
  /** Whether the click went through (a touch's has detail 1, a key's or the remote's 0). */
  const click = (detail = 1) => {
    const e = Object.assign(new Event("click", { cancelable: true }), { detail });
    page.dispatchEvent(e);
    return !e.defaultPrevented;
  };
  const tap = (x = 40, y = 50) => {
    touch("touchstart", [{ x, y }]);
    tick(80);
    touch("touchend");
    tick(10);
  };
  return { tick, touch, scroll, click, tap, off };
}

test("a tap opens, drifting a little included", () => {
  const p = setup();
  p.tap();
  expect(p.click()).toBe(true);
  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.touch("touchmove", [{ x: 40 + SLOP_PX - 1, y: 50 }]);
  p.touch("touchend");
  expect(p.click()).toBe(true);
});

test("a touch that scrolled opens nothing", () => {
  const p = setup();
  p.touch("touchstart", [{ x: 40, y: 300 }]);
  p.touch("touchmove", [{ x: 40, y: 300 - SLOP_PX - 1 }]);
  p.scroll();
  p.touch("touchend");
  p.tick(20);
  expect(p.click()).toBe(false);
  // Only that touch's click: the next tap opens.
  p.tick(MOVING_MS + 1);
  p.tap();
  expect(p.click()).toBe(true);
});

test("a tap that stops a list gliding after a fling opens nothing; once it has stopped, a tap opens", () => {
  const p = setup();
  p.touch("touchstart", [{ x: 40, y: 400 }]);
  p.touch("touchmove", [{ x: 40, y: 100 }]);
  p.scroll();
  p.touch("touchend");
  // Gliding on: the list keeps scrolling with no finger on it.
  for (let i = 0; i < 20; i++) {
    p.tick(16);
    p.scroll();
  }
  p.tick(16);
  p.tap();
  expect(p.click()).toBe(false);
  // The list has stopped.
  p.tick(MOVING_MS + 1);
  p.tap();
  expect(p.click()).toBe(true);
});

test("a list that moves by itself (a carousel turning) never eats a tap", () => {
  const p = setup();
  p.scroll();
  p.tick(10);
  p.tap();
  expect(p.click()).toBe(true);
  // Long after a fling, its glide is over: later scrolling isn't the user's.
  p.touch("touchstart", [{ x: 40, y: 400 }]);
  p.touch("touchmove", [{ x: 40, y: 100 }]);
  p.touch("touchend");
  p.tick(GLIDE_MS + 1);
  p.scroll();
  p.tick(10);
  p.tap();
  expect(p.click()).toBe(true);
});

test("keys, the TV remote and late clicks go through; a second finger isn't a tap", () => {
  const p = setup();
  p.touch("touchstart", [{ x: 40, y: 300 }]);
  p.touch("touchmove", [{ x: 40, y: 200 }]);
  p.touch("touchend");
  expect(p.click(0)).toBe(true);
  p.tick(CLICK_MS + 1);
  expect(p.click()).toBe(true);

  p.touch("touchstart", [
    { x: 40, y: 50 },
    { x: 90, y: 50 },
  ]);
  p.touch("touchend");
  expect(p.click()).toBe(false);
});

test("stops listening when asked", () => {
  const p = setup();
  p.off();
  p.touch("touchstart", [{ x: 40, y: 300 }]);
  p.touch("touchmove", [{ x: 40, y: 100 }]);
  p.touch("touchend");
  expect(p.click()).toBe(true);
});

test("a tap outside the gliding list (the navbar over it) opens, as the list glides on", () => {
  const page = new EventTarget();
  let now = 1000;
  guardTaps(page as unknown as Window, () => now);
  const list = { contains: (n: unknown) => n === row };
  const row = {};
  const navbar = {};
  const send = (type: string, target: unknown, extra: object = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), extra);
    Object.defineProperty(e, "target", { value: target });
    page.dispatchEvent(e);
    return !e.defaultPrevented;
  };
  const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
  // A fling: the list glides on with no finger on it.
  send("touchstart", row, at(40, 400));
  send("touchmove", row, at(40, 100));
  send("scroll", list);
  send("touchend", row, { touches: [] });
  now += 50;
  send("scroll", list);
  // The navbar's button, tapped mid-glide: its click goes through.
  send("touchstart", navbar, at(300, 20));
  now += 80;
  send("touchend", navbar, { touches: [] });
  expect(send("click", navbar, { detail: 1 })).toBe(true);
  // A tap on the list itself only stops it.
  send("scroll", list);
  send("touchstart", row, at(40, 400));
  now += 80;
  send("touchend", row, { touches: [] });
  expect(send("click", row, { detail: 1 })).toBe(false);
});
