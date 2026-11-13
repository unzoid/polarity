import { expect, test } from "bun:test";
import { followPredictive, onPredictiveBack, PREDICTIVE_BACK_EVENT, type BackDrag, type PredictiveBack } from "../../src/lib/platform/back";
import { pageDrag } from "../../src/lib/ui/pageDrag";

/** The window as MainActivity.kt sees it: messages out on `polarActions`, steps in as `polar-back` events. */
function activity() {
  const posted: string[] = [];
  const scope = Object.assign(new EventTarget(), { polarActions: { postMessage: (m: string) => void posted.push(m) } });
  // What MainActivity.sendBack evaluates in the page.
  const send = (phase: PredictiveBack["phase"], progress: number) =>
    scope.dispatchEvent(new CustomEvent(PREDICTIVE_BACK_EVENT, { detail: { phase, progress } }));
  return { scope, posted, send };
}

function pages() {
  const top = document.createElement("section");
  const under = document.createElement("section");
  document.body.append(under, top);
  top.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
  return { top, under };
}

test("Android's back gesture moves the page with the finger, and goes back once Android says so (#483)", () => {
  const a = activity();
  const p = pages();
  const later: (() => void)[] = [];
  let backs = 0;
  let handled = 0;
  const drag = pageDrag(
    () => p,
    () => backs++,
    (fn) => void later.push(fn),
  );
  const off = onPredictiveBack(
    followPredictive(
      () => handled++,
      () => drag,
      () => 400,
    ),
    a.scope,
  );
  expect(a.posted).toEqual(["predictive-back:on"]);

  a.send("begin", 0);
  expect(p.top.dataset.drag).toBe("top");
  a.send("move", 0.25);
  expect(p.top.style.transform).toBe("translate3d(100px, 0, 0)");
  expect(p.under.style.transform).toBe("translate3d(-90px, 0, 0)");
  a.send("move", 0.5);
  expect(p.top.style.transform).toBe("translate3d(200px, 0, 0)");

  // Android decided: the page carries on out, then Back runs once.
  a.send("back", 1);
  expect(p.top.style.transform).toBe("translate3d(400px, 0, 0)");
  later.splice(0).forEach((fn) => fn());
  expect(backs).toBe(1);
  expect(handled).toBe(0);

  off();
  expect(a.posted).toEqual(["predictive-back:on", "predictive-back:off"]);
  // Nothing hears it any more.
  a.send("begin", 0);
  a.send("back", 1);
  expect(backs).toBe(1);
  expect(handled).toBe(0);
  p.top.remove();
  p.under.remove();
});

test("let go early the page goes back where it was, however far it had come (#483)", () => {
  const seen: string[] = [];
  const drag: BackDrag = {
    begin: () => (seen.push("begin"), true),
    move: (x, width) => void seen.push(`move ${x}/${width}`),
    end: (back) => void seen.push(`end ${back}`),
  };
  let handled = 0;
  const follow = followPredictive(
    () => handled++,
    () => drag,
    () => 400,
  );
  for (const [phase, progress] of [
    ["begin", 0.1],
    ["move", 0.8],
    ["cancel", 0],
  ] as const)
    follow({ phase, progress });
  expect(seen).toEqual(["begin", "move 40/400", "move 320/400", "end false"]);
  expect(handled).toBe(0);
});

test("over a sheet or the player, and for a button press, Back goes to the handler as before (#483)", () => {
  let handled = 0;
  let taken = 0;
  const declines: BackDrag = { begin: () => false, move: () => void taken++, end: () => void taken++ };
  // A sheet open: App gives no drag; the page under can't come (nothing under it): the drag declines.
  for (const drag of [() => undefined, () => declines]) {
    const before = handled;
    const follow = followPredictive(
      () => handled++,
      drag,
      () => 400,
    );
    follow({ phase: "begin", progress: 0 });
    follow({ phase: "move", progress: 0.6 });
    follow({ phase: "cancel", progress: 0 });
    expect(handled).toBe(before);
    follow({ phase: "begin", progress: 0 });
    follow({ phase: "back", progress: 1 });
    expect(handled).toBe(before + 1);
  }
  expect(handled).toBe(2);
  expect(taken).toBe(0);

  // A press (3-button navigation, a TV remote, Android 13 and older): only `back`.
  const press = followPredictive(
    () => handled++,
    () => declines,
  );
  press({ phase: "back", progress: 1 });
  expect(handled).toBe(3);
});

test("the activity is told once while anything hears it, and nothing is asked of a web view without messages (#483)", () => {
  const a = activity();
  const one = onPredictiveBack(() => {}, a.scope);
  const two = onPredictiveBack(() => {}, a.scope);
  one();
  one();
  expect(a.posted).toEqual(["predictive-back:on"]);
  two();
  expect(a.posted).toEqual(["predictive-back:on", "predictive-back:off"]);

  const old = Object.assign(new EventTarget(), { polarDevice: {} });
  let heard = 0;
  const off = onPredictiveBack(() => heard++, old);
  old.dispatchEvent(new CustomEvent(PREDICTIVE_BACK_EVENT, { detail: { phase: "back", progress: 1 } }));
  expect(heard).toBe(0);
  off();
});
