import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { LOCK_CHIP_MS, TouchLockLayer, useTouchLock } from "../../src/components/player/TouchLock";
import { useSwipeLevels, type SwipeSide } from "../../src/components/player/useSwipeLevels";
import { byText, click, press, render } from "./render";

afterEach(() => jest.useRealTimers());

/** A player stand-in: a tap on it counts, and Escape that gets past the layers counts as leaving. */
function Player({ available = true, onTap }: { available?: boolean; onTap: () => void }) {
  const lock = useTouchLock(available);
  return (
    <div className="player" onClick={onTap} onPointerDown={onTap}>
      <span data-locked={lock.locked} />
      {lock.available && (
        <button type="button" onClick={(e) => (e.stopPropagation(), lock.lock())}>
          Lock screen
        </button>
      )}
      {lock.locked && <TouchLockLayer onUnlock={lock.unlock} />}
    </div>
  );
}
const locked = (c: HTMLElement) => c.querySelector("[data-locked]")!.getAttribute("data-locked");

test("locked, touches go nowhere; a tap shows Unlock, which unlocks", async () => {
  jest.useFakeTimers();
  let taps = 0;
  const { container, unmount } = await render(<Player onTap={() => taps++} />);
  await click(byText(container, "button", "Lock screen"));
  expect(locked(container)).toBe("true");
  const layer = container.querySelector<HTMLElement>(".player-lock")!;
  expect(container.textContent).not.toContain("Unlock");

  await act(async () => void layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await click(layer);
  expect(taps).toBe(0);
  expect(byText(container, "button", "Unlock")).toBeTruthy();

  // The chip goes again after a moment.
  await act(async () => void jest.advanceTimersByTime(LOCK_CHIP_MS + 10));
  expect(container.textContent).not.toContain("Unlock");

  await click(layer);
  await click(byText(container, "button", "Unlock"));
  expect(locked(container)).toBe("false");
  expect(taps).toBe(0);
  expect(container.querySelector(".player-lock")).toBeNull();
  await unmount();
});

test("the system's Back (Escape) while locked shows Unlock instead of leaving the player", async () => {
  let left = 0;
  const leave = (e: KeyboardEvent) => e.key === "Escape" && left++;
  window.addEventListener("keydown", leave);
  const { container, unmount } = await render(<Player onTap={() => {}} />);
  await click(byText(container, "button", "Lock screen"));
  await press("Escape", document.body);
  expect(left).toBe(0);
  expect(locked(container)).toBe("true");
  expect(byText(container, "button", "Unlock")).toBeTruthy();
  // Unlocked, Escape goes on to the player again.
  await click(byText(container, "button", "Unlock"));
  await press("Escape", document.body);
  expect(left).toBe(1);
  window.removeEventListener("keydown", leave);
  await unmount();
});

test("no lock where it doesn't apply (TV mode, a mouse), and leaving it unlocks", async () => {
  const { container, rerender, unmount } = await render(<Player onTap={() => {}} />);
  await click(byText(container, "button", "Lock screen"));
  expect(locked(container)).toBe("true");
  await rerender(<Player available={false} onTap={() => {}} />);
  expect(locked(container)).toBe("false");
  expect(container.textContent).not.toContain("Lock screen");
  await unmount();
});

// --- The swipe hook's handlers ------------------------------------------------------------------

const RECT = { left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };
const surface = { getBoundingClientRect: () => RECT } as unknown as Element;
const pointer = (id: number, x: number, y: number, type = "touch") =>
  ({ pointerId: id, clientX: x, clientY: y, pointerType: type, currentTarget: surface }) as unknown as React.PointerEvent;

let swipe: ReturnType<typeof useSwipeLevels>;
function Surface({ enabled = true, changes }: { enabled?: boolean; changes: [SwipeSide, number][] }) {
  swipe = useSwipeLevels({ enabled, begin: () => ({ level: 0.5, max: 1 }), change: (side, level) => void changes.push([side, level]) });
  return <div data-active={swipe.active ?? ""} />;
}

test("a finger up the right half raises the volume; its release isn't a tap", async () => {
  const changes: [SwipeSide, number][] = [];
  const { container, unmount } = await render(<Surface changes={changes} />);
  await act(async () => swipe.handlers.onPointerDown(pointer(1, 600, 300)));
  await act(async () => swipe.handlers.onPointerMove(pointer(1, 600, 270)));
  expect(container.querySelector("div")!.getAttribute("data-active")).toBe("right");
  await act(async () => swipe.handlers.onPointerMove(pointer(1, 600, 210)));
  expect(changes).toEqual([["right", 0.75]]);
  await act(async () => swipe.handlers.onPointerUp(pointer(1, 600, 210)));
  expect(container.querySelector("div")!.getAttribute("data-active")).toBe("");
  expect(swipe.swallowClick()).toBe(true);
  expect(swipe.swallowClick()).toBe(false);
  await unmount();
});

test("sideways, from an edge, a second finger, a mouse or turned off: nothing", async () => {
  const changes: [SwipeSide, number][] = [];
  const { rerender, unmount } = await render(<Surface changes={changes} />);
  const drag = async (from: [number, number], to: [number, number], type = "touch") => {
    await act(async () => swipe.handlers.onPointerDown(pointer(1, ...from, type)));
    await act(async () => swipe.handlers.onPointerMove(pointer(1, ...to, type)));
    await act(async () => swipe.handlers.onPointerMove(pointer(1, to[0], to[1] - 60, type)));
    await act(async () => swipe.handlers.onPointerUp(pointer(1, ...to, type)));
  };
  await drag([200, 200], [260, 200]);
  await drag([5, 200], [5, 150]);
  await drag([200, 395], [200, 300]);
  await drag([600, 300], [600, 250], "mouse");
  // A pinch: the second finger ends the swipe before it starts.
  await act(async () => swipe.handlers.onPointerDown(pointer(1, 600, 300)));
  await act(async () => swipe.handlers.onPointerDown(pointer(2, 500, 300)));
  await act(async () => swipe.handlers.onPointerMove(pointer(1, 600, 200)));
  await act(async () => swipe.handlers.onPointerUp(pointer(2, 500, 300)));
  await act(async () => swipe.handlers.onPointerUp(pointer(1, 600, 200)));
  await rerender(<Surface enabled={false} changes={changes} />);
  await drag([600, 300], [600, 250]);
  expect(changes).toEqual([]);
  expect(swipe.swallowClick()).toBe(false);
  await unmount();
});
