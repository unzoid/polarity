import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { HOLD_MS, useHoldSpeed } from "../../src/components/player/useHoldSpeed";
import { render } from "./render";

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
afterEach(() => jest.useRealTimers());

let hold: ReturnType<typeof useHoldSpeed>;
function Picture({ enabled = true, playing = true }: { enabled?: boolean; playing?: boolean }) {
  hold = useHoldSpeed(enabled, playing);
  return <div data-held={hold.held} />;
}
const held = (c: HTMLElement) => c.querySelector("div")!.getAttribute("data-held");
const pointer = (id: number, x = 100, y = 100, extra: object = {}) =>
  ({ pointerId: id, clientX: x, clientY: y, pointerType: "touch", button: 0, ...extra }) as unknown as React.PointerEvent;

test("held still, the picture plays faster until let go; the release isn't a tap", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<Picture />);
  await act(async () => hold.handlers.onPointerDown(pointer(1)));
  await tick(HOLD_MS - 50);
  expect(held(container)).toBe("false");
  await tick(100);
  expect(held(container)).toBe("true");
  await act(async () => hold.handlers.onPointerUp());
  expect(held(container)).toBe("false");
  // The click that release makes does nothing; the next one is a tap again.
  expect(hold.swallowClick()).toBe(true);
  expect(hold.swallowClick()).toBe(false);
  await unmount();
});

test("a quick tap, a drag, a second finger or a paused video never speeds up", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<Picture />);
  // A tap: lifted before the hold.
  await act(async () => hold.handlers.onPointerDown(pointer(1)));
  await act(async () => hold.handlers.onPointerUp());
  await tick(HOLD_MS * 2);
  expect(held(container)).toBe("false");
  expect(hold.swallowClick()).toBe(false);
  // A drag (a swipe, the start of a pinch).
  await act(async () => hold.handlers.onPointerDown(pointer(1)));
  await act(async () => hold.handlers.onPointerMove(pointer(1, 140, 100)));
  await tick(HOLD_MS * 2);
  expect(held(container)).toBe("false");
  await act(async () => hold.handlers.onPointerUp());
  // A second finger.
  await act(async () => hold.handlers.onPointerDown(pointer(1)));
  await act(async () => hold.handlers.onPointerDown(pointer(2, 200, 200)));
  await tick(HOLD_MS * 2);
  expect(held(container)).toBe("false");
  await act(async () => hold.handlers.onPointerUp());
  // Paused: nothing to speed up.
  await rerender(<Picture playing={false} />);
  await act(async () => hold.handlers.onPointerDown(pointer(1)));
  await tick(HOLD_MS * 2);
  expect(held(container)).toBe("false");
  await unmount();
});

test("pausing or a watch party mid-hold goes back to the normal speed", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<Picture />);
  await act(async () => hold.handlers.onPointerDown(pointer(1, 100, 100, { pointerType: "mouse" })));
  await tick(HOLD_MS + 10);
  expect(held(container)).toBe("true");
  await rerender(<Picture enabled={false} />);
  expect(held(container)).toBe("false");
  await unmount();
});
