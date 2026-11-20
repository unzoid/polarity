import { expect, test } from "bun:test";
import { pageDrag } from "../../src/lib/ui/pageDrag";

function pages() {
  const top = document.createElement("section");
  const under = document.createElement("section");
  document.body.append(under, top);
  top.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
  return { top, under };
}

/** `later` that waits until asked. */
function clock() {
  const queue: (() => void)[] = [];
  return { later: (fn: () => void) => void queue.push(fn), run: () => queue.splice(0).forEach((fn) => fn()) };
}

test("the top page follows the finger over the page under it, and goes back once it has slid out (#451)", () => {
  const p = pages();
  const t = clock();
  let backs = 0;
  const drag = pageDrag(
    () => p,
    () => backs++,
    t.later,
  );
  expect(drag.begin()).toBe(true);
  expect(p.top.dataset.drag).toBe("top");
  expect(p.under.dataset.drag).toBe("under");
  drag.move(100, 400);
  expect(p.top.style.transform).toBe("translate3d(100px, 0, 0)");
  // The page under comes in from 30% of the width to the left: a quarter of the way, 90 px still to go.
  expect(p.under.style.transform).toBe("translate3d(-90px, 0, 0)");
  expect(p.under.style.getPropertyValue("--drag-in")).toBe("0.25");
  // Never past either edge.
  drag.move(-20, 400);
  expect(p.top.style.transform).toBe("translate3d(0px, 0, 0)");

  drag.end(true);
  expect(p.top.style.transform).toBe("translate3d(400px, 0, 0)");
  expect(p.under.style.transform).toBe("translate3d(0px, 0, 0)");
  expect(p.top.dataset.dragSettle).toBe("");
  // Another swipe while it settles isn't taken.
  expect(drag.begin()).toBe(false);
  expect(backs).toBe(0);
  t.run();
  expect(backs).toBe(1);
  t.run();
  expect(p.under.dataset.drag).toBeUndefined();
  expect(p.under.style.transform).toBe("");
  expect(drag.begin()).toBe(true);
});

test("let go early, both pages slide back and nothing goes back; nothing under, the swipe isn't taken (#451)", () => {
  const p = pages();
  const t = clock();
  let backs = 0;
  const drag = pageDrag(
    () => p,
    () => backs++,
    t.later,
  );
  drag.begin();
  drag.move(150, 400);
  drag.end(false);
  expect(p.top.style.transform).toBe("translate3d(0px, 0, 0)");
  t.run();
  expect(backs).toBe(0);
  expect(p.top.dataset.drag).toBeUndefined();
  expect(p.top.style.transform).toBe("");

  const none = pageDrag(
    () => null,
    () => backs++,
    t.later,
  );
  expect(none.begin()).toBe(false);
});

test("a title page from a card shrinks uniformly with the finger, hides its card slot, and zooms back cleanly once let go", () => {
  const scrim = document.createElement("div");
  const slot = document.createElement("div");
  document.body.append(scrim, slot);
  const p = { ...pages(), scrim, card: { x: 20, y: 300, w: 120, h: 180, src: "https://media.example.com/poster.jpg", el: slot } };
  p.top.getBoundingClientRect = () => ({ width: 400, height: 800 }) as DOMRect;
  const t = clock();
  let backs = 0;
  const drag = pageDrag(
    () => p,
    () => backs++,
    t.later,
  );
  expect(drag.begin()).toBe(true);
  expect(p.top.dataset.drag).toBe("card");
  expect(p.top.style.transformOrigin).toBe("0 0");
  // Constant iPhone-bezel rounded corners set ONCE on drag begin (never mutated per frame).
  expect(p.top.style.borderRadius).toBe("38px");
  // Source card slot hides in flight so no duplicate poster shows underneath.
  expect(slot.style.visibility).toBe("hidden");
  expect(scrim.dataset.dragActive).toBe("card");
  // Half way (200/400): uniform scale 0.88, GPU translate3d tracking, borderRadius untouched.
  drag.move(200, 400);
  expect(p.top.style.transform).toBe("translate3d(108px, 40px, 0) scale(0.88)");
  expect(p.top.style.borderRadius).toBe("38px");
  // Dedicated leaf scrim fades directly so Home (`under`) incurs zero subtree style recalc.
  expect(p.under.style.transform).toBe("");
  expect(p.under.style.getPropertyValue("--drag-in")).toBe("");
  expect(Number(scrim.style.opacity)).toBeCloseTo(0.46, 2);

  drag.end(true, 0.9);
  expect(backs).toBe(0);
  t.run();
  expect(backs).toBe(1);
  t.run();
  expect(p.top.dataset.drag).toBeUndefined();
  expect(p.top.style.transform).toBe("");
  expect(scrim.style.opacity).toBe("");
  expect(scrim.dataset.dragActive).toBeUndefined();
  expect(slot.style.visibility).toBe("");
});
