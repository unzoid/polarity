import { afterAll, afterEach, beforeAll, expect, jest, spyOn, test } from "bun:test";
import { act, type ReactNode } from "react";
import { FrameLabel } from "../../src/components/player/PlayerClock";
import type { MediaLike } from "../../src/components/player/mpvMedia";
import { PAUSED_HIDE_MS, usePlayerChrome } from "../../src/components/player/usePlayerChrome";
import { STEP_SLOW_MS, useStepping } from "../../src/components/player/useStepping";
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

let hooks: { poke: (instant?: boolean) => void; steps: ReturnType<typeof useStepping> };
/** The player's wiring: the controls' paused wait gives way to the set time while on a stepped frame. */
function Screen({ paused, buffering = false }: { paused: boolean; buffering?: boolean }) {
  const steps = useStepping(paused, buffering);
  const c = usePlayerChrome(2000, paused && !steps.stepping);
  hooks = { poke: c.poke, steps };
  return <div data-chrome={c.chrome.visible} data-stepping={steps.stepping} data-spinner={steps.spinner} />;
}
const attr = (c: HTMLElement, name: string) => c.querySelector("div")!.getAttribute(name);

/** One step as the player takes it: the key pokes the controls, the step pauses and seeks. */
async function step(rerender: (n: ReactNode) => Promise<void>, ms = 40, buffering = true) {
  await act(async () => {
    hooks.poke(true);
    hooks.steps.begin();
  });
  await rerender(<Screen paused buffering={buffering} />);
  await tick(ms);
  await rerender(<Screen paused />);
  await act(async () => hooks.steps.end());
}

test("#346: after a step the controls hide after the set time; the frame number outlives them until playback resumes", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<Screen paused={false} />);
  await step(rerender);
  expect(attr(container, "data-chrome")).toBe("true");
  expect(attr(container, "data-stepping")).toBe("true");
  // Counted from the last step: a second step a second later starts it again.
  await tick(1000);
  await step(rerender);
  await tick(1900);
  expect(attr(container, "data-chrome")).toBe("true");
  await tick(200);
  expect(attr(container, "data-chrome")).toBe("false");
  // Still paused on the stepped frame, well past the paused wait: the frame number stays.
  await tick(PAUSED_HIDE_MS * 2);
  expect(attr(container, "data-stepping")).toBe("true");
  // The controls back (a mouse move): the clock shows the frame again, the label hides with data-chrome.
  await act(async () => hooks.poke());
  expect(attr(container, "data-chrome")).toBe("true");
  expect(attr(container, "data-stepping")).toBe("true");
  // Playback resumes: gone.
  await rerender(<Screen paused={false} />);
  expect(attr(container, "data-stepping")).toBe("false");
  await unmount();
});

test("#346: already paused, a step hides the controls after the set time, not the paused wait", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<Screen paused />);
  await tick(1000);
  await step(rerender);
  await tick(2100);
  expect(attr(container, "data-chrome")).toBe("false");
  expect(attr(container, "data-stepping")).toBe("true");
  // A seek leaves the stepped frame.
  await act(async () => hooks.steps.leave());
  expect(attr(container, "data-stepping")).toBe("false");
  await unmount();
});

test("#346: held steps keep the play button's icon steady; a slow step shows the spinner, a stall outside steps at once", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<Screen paused />);
  const spins: string[] = [];
  const watch = new MutationObserver(() => spins.push(attr(container, "data-spinner")!));
  watch.observe(container, { attributes: true, subtree: true });
  // A held key: steps back to back, each seek reporting buffering on and off.
  for (let i = 0; i < 20; i++) await step(rerender, 30);
  await tick(0);
  watch.disconnect();
  expect(spins.includes("true")).toBe(false);
  expect(attr(container, "data-spinner")).toBe("false");
  // A step back to a far keyframe that takes long: the spinner after about half a second.
  await act(async () => hooks.steps.begin());
  await rerender(<Screen paused buffering />);
  await tick(STEP_SLOW_MS - 50);
  expect(attr(container, "data-spinner")).toBe("false");
  await tick(100);
  expect(attr(container, "data-spinner")).toBe("true");
  await rerender(<Screen paused />);
  await act(async () => hooks.steps.end());
  await tick(1000);
  // No step: buffering shows at once.
  await rerender(<Screen paused buffering />);
  expect(attr(container, "data-spinner")).toBe("true");
  await unmount();
});

test("#346: the frame label reads the frame the playhead is on", async () => {
  const media = Object.assign(new EventTarget(), { currentTime: 2, duration: 60, paused: true }) as unknown as MediaLike;
  const { container, unmount } = await render(<FrameLabel media={media} fps={24} />);
  expect(container.textContent).toBe("Frame 48");
  await act(async () => {
    (media as { currentTime: number }).currentTime = 2 + 1 / 24;
    media.dispatchEvent(new Event("timeupdate"));
  });
  expect(container.textContent).toBe("Frame 49");
  await unmount();
});
