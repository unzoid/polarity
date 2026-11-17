import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { RATED_SHOWN_MS, RatingPrompt } from "../../src/components/player/RatingPrompt";
import { click, render } from "./render";

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
afterEach(() => jest.useRealTimers());

const card = (c: HTMLElement) => c.querySelector("section");
const noop = () => {};

test("asks with 1 to 10 and a dismiss, naming where the rating goes", async () => {
  const { container, unmount } = await render(<RatingPrompt shown title="An Example Film" services={["Trakt", "Simkl"]} onRate={noop} onDismiss={noop} />);
  expect(card(container)!.getAttribute("aria-label")).toBe("Rate An Example Film");
  expect(container.textContent).toContain("Rate An Example Film");
  expect(container.textContent).toContain("On Trakt and Simkl");
  const scores = [...container.querySelectorAll(".rating-prompt-scale button")].map((b) => b.getAttribute("aria-label"));
  expect(scores).toEqual(Array.from({ length: 10 }, (_, i) => `${i + 1} of 10`));
  expect(container.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
  // It takes no focus by itself: keys keep going to the player.
  expect(container.contains(document.activeElement)).toBe(false);
  await unmount();
});

test("a score is sent, said, and the card leaves", async () => {
  jest.useFakeTimers();
  const sent: number[] = [];
  const at = (shown: boolean) => <RatingPrompt shown={shown} title="An Example Film" services={["Trakt"]} onRate={(n) => sent.push(n)} onDismiss={noop} />;
  const { container, rerender, unmount } = await render(at(true));
  await click(container.querySelector('[aria-label="8 of 10"]'));
  expect(sent).toEqual([8]);
  // The service now has the rating, so the player stops asking; the thanks stays a moment.
  await rerender(at(false));
  expect(container.textContent).toContain("Rated 8 of 10 on Trakt");
  await tick(RATED_SHOWN_MS + 10);
  expect(card(container)).toBeNull();
  await unmount();
});

test("dismiss calls back; not asked, nothing shows", async () => {
  let dismissed = 0;
  const { container, rerender, unmount } = await render(
    <RatingPrompt shown title="An Example Film" services={["Simkl"]} onRate={noop} onDismiss={() => dismissed++} />,
  );
  await click(container.querySelector('[aria-label="Dismiss"]'));
  expect(dismissed).toBe(1);
  await rerender(<RatingPrompt shown={false} title="An Example Film" services={["Simkl"]} onRate={noop} onDismiss={noop} />);
  expect(card(container)).toBeNull();
  await unmount();
});
