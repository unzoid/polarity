import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { PauseScreen } from "../../src/components/player/PauseScreen";
import { PAUSE_SCREEN_AFTER_MS, type PauseDetails } from "../../src/lib/playback/pauseScreen";
import { render } from "./render";

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
afterEach(() => jest.useRealTimers());

const details: PauseDetails = {
  name: "The Example Show",
  episode: { code: "S1, E2", title: "The Second One" },
  overview: "Two examples meet.",
  cast: [
    { name: "Ada Example", character: "The Lead", photo: "https://images.example.com/ada.jpg" },
    { name: "Bo Sample", character: "The Friend" },
  ],
};

const screen = (c: HTMLElement) => c.querySelector('[aria-label="Paused"]');

test("comes after the wait, with the title, episode, overview and cast", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<PauseScreen allowed details={details} />);
  expect(screen(container)).toBeNull();
  await tick(PAUSE_SCREEN_AFTER_MS - 100);
  expect(screen(container)).toBeNull();
  await tick(200);
  const el = screen(container)!;
  expect(el.textContent).toContain("The Example Show");
  expect(el.textContent).toContain("S1, E2");
  expect(el.textContent).toContain("The Second One");
  expect(el.textContent).toContain("Two examples meet.");
  const cast = [...el.querySelectorAll("li")].map((li) => li.textContent);
  expect(cast).toEqual(["Ada ExampleThe Lead", "BSBo SampleThe Friend"]);
  // Nothing in it takes focus or a click: input goes to the player beneath.
  expect(el.querySelectorAll("button, a, input, [tabindex]").length).toBe(0);
  await unmount();
});

test("leaves at once when the player takes it back (any input), and waits again after", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<PauseScreen allowed details={details} />);
  await tick(PAUSE_SCREEN_AFTER_MS + 10);
  expect(screen(container)).not.toBeNull();
  await rerender(<PauseScreen allowed={false} details={details} />);
  expect(screen(container)).toBeNull();
  await rerender(<PauseScreen allowed details={details} />);
  expect(screen(container)).toBeNull();
  await tick(PAUSE_SCREEN_AFTER_MS + 10);
  expect(screen(container)).not.toBeNull();
  await unmount();
});

test("nothing to show, nothing shown", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<PauseScreen allowed details={undefined} />);
  await tick(PAUSE_SCREEN_AFTER_MS * 2);
  expect(screen(container)).toBeNull();
  await unmount();
});
