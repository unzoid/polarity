import { afterAll, afterEach, beforeAll, expect, jest, spyOn, test } from "bun:test";
import { act } from "react";
import { PAUSED_HIDE_MS, usePlayerChrome } from "../../src/components/player/usePlayerChrome";
import { appWindow } from "../../src/lib/platform/window";
import { render } from "./render";

// No Tauri window here: focus changes never come.
let focus: ReturnType<typeof spyOn>;
beforeAll(() => {
  focus = spyOn(appWindow, "onFocusChanged").mockImplementation(() => Promise.resolve(() => {}));
});
afterAll(() => focus.mockRestore());

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

afterEach(() => jest.useRealTimers());

let poke: (instant?: boolean) => void = () => {};
function Chrome({ hideAfter, paused }: { hideAfter: number; paused: boolean }) {
  const c = usePlayerChrome(hideAfter, paused);
  poke = c.poke;
  return <div data-visible={c.chrome.visible} />;
}
const shown = (c: HTMLElement) => c.querySelector("div")!.getAttribute("data-visible");

test("#334: paused with no input, the controls hide after 5 s and come back on input", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<Chrome hideAfter={2000} paused />);
  await tick(PAUSED_HIDE_MS - 100);
  expect(shown(container)).toBe("true");
  await tick(200);
  expect(shown(container)).toBe("false");
  await act(async () => poke());
  expect(shown(container)).toBe("true");
  await tick(PAUSED_HIDE_MS + 100);
  expect(shown(container)).toBe("false");
  await unmount();
});

test("#334: a longer Hide controls after setting applies while paused too", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<Chrome hideAfter={8000} paused />);
  await tick(PAUSED_HIDE_MS + 100);
  expect(shown(container)).toBe("true");
  await tick(8000 - PAUSED_HIDE_MS);
  expect(shown(container)).toBe("false");
  await unmount();
});

test("#334: playing keeps the set time; pausing shows them and waits 5 s; resuming goes back to the set time", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<Chrome hideAfter={2000} paused={false} />);
  await tick(2100);
  expect(shown(container)).toBe("false");
  // Paused from elsewhere (a headset button, the party): the controls come up.
  await rerender(<Chrome hideAfter={2000} paused />);
  expect(shown(container)).toBe("true");
  await tick(2100);
  expect(shown(container)).toBe("true");
  await tick(PAUSED_HIDE_MS);
  expect(shown(container)).toBe("false");
  // Resumed (the play handler pokes): back to the 2 s of the setting.
  await act(async () => poke());
  await rerender(<Chrome hideAfter={2000} paused={false} />);
  await tick(2100);
  expect(shown(container)).toBe("false");
  await unmount();
});
