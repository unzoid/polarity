import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { ArtTitle } from "../../src/components/title/Card";
import { TitleHeading } from "../../src/components/title/TitleHeading";
import { NAME_WAIT } from "../../src/lib/ui";
import { render } from "./render";

// #343: a title's name shows only when it has no logo, never while the logo is still coming.

const NAME = "A Placeholder Film";
const LOGO = "https://media.example.com/name-wait-logo.png";
const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const fail = (img: Element | null) => act(async () => void img!.dispatchEvent(new Event("error")));

afterEach(() => jest.useRealTimers());

test("while the logo isn't known, the name keeps the heading's place unseen and screen readers still get it", async () => {
  const { container, unmount } = await render(<TitleHeading name={NAME} look="detail" pending />);
  const h1 = container.querySelector("h1")!;
  expect(h1.textContent).toBe(NAME);
  expect(h1.hasAttribute("data-name-wait")).toBe(true);
  expect(container.querySelector("img")).toBeNull();
  await unmount();
});

test("the logo arriving replaces the unseen name; the heading is named by the title", async () => {
  const { container, rerender, unmount } = await render(<TitleHeading name={NAME} look="hero" pending />);
  await rerender(<TitleHeading name={NAME} logo={LOGO} look="hero" />);
  const h1 = container.querySelector("h1")!;
  expect(h1.classList.contains("title-heading")).toBe(true);
  expect(h1.getAttribute("aria-label")).toBe(NAME);
  expect(h1.querySelector("img.hero-logo")).not.toBeNull();
  expect(container.querySelector("[data-name-wait]")).toBeNull();
  await unmount();
});

test("known to have no logo: the name shows at once", async () => {
  const { container, rerender, unmount } = await render(<TitleHeading name={NAME} look="tv-detail" pending />);
  await rerender(<TitleHeading name={NAME} look="tv-detail" />);
  const h1 = container.querySelector("h1")!;
  expect(h1.textContent).toBe(NAME);
  expect(h1.hasAttribute("data-name-wait")).toBe(false);
  await unmount();
});

test("a logo that fails to load leaves the name, fading in", async () => {
  const { container, unmount } = await render(<TitleHeading name={NAME} logo="https://media.example.com/name-wait-broken.png" look="detail" />);
  await fail(container.querySelector("img"));
  const h1 = container.querySelector("h1")!;
  expect(h1.textContent).toBe(NAME);
  expect(h1.classList.contains("name-in")).toBe(true);
  expect(h1.hasAttribute("data-name-wait")).toBe(false);
  await unmount();
});

test("if nothing answers, the name shows after NAME_WAIT", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<TitleHeading name={NAME} look="tv-stage" pending />);
  await tick(NAME_WAIT - 100);
  expect(container.querySelector("h1")!.hasAttribute("data-name-wait")).toBe(true);
  await tick(200);
  expect(container.querySelector("h1")!.hasAttribute("data-name-wait")).toBe(false);
  await unmount();
});

test("a new title waits afresh", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<TitleHeading name={NAME} look="detail" pending />);
  await tick(NAME_WAIT + 100);
  await rerender(<TitleHeading name="Another Placeholder" look="detail" pending />);
  expect(container.querySelector("h1")!.hasAttribute("data-name-wait")).toBe(true);
  await unmount();
});

test("wide cards: the name waits unseen while the logo is unknown, shows when there's none or after NAME_WAIT", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<ArtTitle name={NAME} pending />);
  expect(container.querySelector(".card-art-title")!.hasAttribute("data-name-wait")).toBe(true);
  await tick(NAME_WAIT + 100);
  expect(container.querySelector(".card-art-title")!.hasAttribute("data-name-wait")).toBe(false);
  await rerender(<ArtTitle name={NAME} logo={LOGO} />);
  expect(container.querySelector(".card-art-title")).toBeNull();
  expect(container.querySelector("img.card-logo")).not.toBeNull();
  await unmount();
  const none = await render(<ArtTitle name={NAME} />);
  expect(none.container.querySelector(".card-art-title")!.hasAttribute("data-name-wait")).toBe(false);
  await none.unmount();
});
