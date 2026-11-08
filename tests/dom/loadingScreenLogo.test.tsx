import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { PlayerStatus } from "../../src/components/player/PlayerStatus";
import { render } from "./render";

const LOGO = "https://media.example.com/logo.png";
const COVER = "https://media.example.com/cover.jpg";
const BROKEN = "https://media.example.com/broken-logo.png";

/** Each picture's size; a logo is wide (400 x 100), a cover square and drawn without a see-through ground. */
const sizes: Record<string, [number, number]> = { [LOGO]: [400, 100], [COVER]: [500, 500] };
const opaque = new Set([COVER]);
const realImage = globalThis.Image;
const realGetContext = HTMLCanvasElement.prototype.getContext;

class FakeImage {
  crossOrigin = "";
  decoding = "";
  naturalWidth = 0;
  naturalHeight = 0;
  onload?: () => void;
  onerror?: () => void;
  key = "";
  set src(url: string) {
    this.key = url.replace("?tone=1", "");
    [this.naturalWidth, this.naturalHeight] = sizes[this.key] ?? [400, 100];
    setTimeout(() => (this.key === BROKEN ? this.onerror?.() : this.onload?.()));
  }
}

beforeEach(() => {
  (globalThis as { Image: unknown }).Image = FakeImage;
  HTMLCanvasElement.prototype.getContext = function () {
    let clear = false;
    return {
      drawImage: (img: FakeImage) => (clear = !opaque.has(img.key)),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? (clear && (i >> 2) % 2 ? 0 : 255) : 240)),
      }),
    };
  } as unknown as typeof realGetContext;
});

afterEach(() => {
  (globalThis as { Image: unknown }).Image = realImage;
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const status = { status: "searching" } as const;

test("the loading screen shows the page's logo once it's known to be shaped like one (#391)", async () => {
  const { container, unmount } = await render(<PlayerStatus state={status} error={null} logo={LOGO} logos={[LOGO]} name="A Show" steps={[]} backend="mpv" />);
  // While it's measured nothing shows in its place.
  expect(container.querySelector(".load-mark img")).toBeNull();
  expect(container.querySelector(".load-mark")?.hasAttribute("data-name-wait")).toBe(true);
  await settle();
  const imgs = container.querySelectorAll(".load-mark img");
  expect(imgs.length).toBe(2);
  expect(imgs[0].getAttribute("src")).toBe(LOGO);
  expect(container.querySelector(".load-mark")?.hasAttribute("data-name-wait")).toBe(false);
  await unmount();
});

test("a square cover handed over as the logo is never shown: the name is (#391)", async () => {
  const { container, unmount } = await render(<PlayerStatus state={status} error={null} logo={COVER} name="A Show" steps={[]} backend="mpv" />);
  await settle();
  expect(container.querySelector(".load-mark img")).toBeNull();
  expect(container.querySelector(".load-mark-base")?.textContent).toBe("A Show");
  expect(container.querySelector(".load-mark")?.hasAttribute("data-name-wait")).toBe(false);
  await unmount();
});

test("while the page's art isn't known the name waits unseen; without a logo it shows (#391)", async () => {
  const waiting = await render(<PlayerStatus state={status} error={null} artPending name="A Show" steps={[]} backend="mpv" />);
  expect(waiting.container.querySelector(".load-mark")?.hasAttribute("data-name-wait")).toBe(true);
  await waiting.unmount();
  const none = await render(<PlayerStatus state={status} error={null} name="A Show" steps={[]} backend="mpv" />);
  expect(none.container.querySelector(".load-mark")?.hasAttribute("data-name-wait")).toBe(false);
  expect(none.container.querySelector(".load-mark-base")?.textContent).toBe("A Show");
  await none.unmount();
});

test("a logo that doesn't load leaves the name, never a broken image (#360)", async () => {
  const { container, unmount } = await render(<PlayerStatus state={status} error={null} logo={BROKEN} name="Sintel" steps={[]} backend="mpv" />);
  await settle();
  // It couldn't be measured, so it's drawn as it is (as TitleLogo draws it); the shown picture failing leaves the name.
  const img = container.querySelector<HTMLImageElement>(".load-mark img");
  expect(img).toBeTruthy();
  await act(async () => void img!.dispatchEvent(new Event("error")));
  expect(container.querySelector(".load-mark img")).toBeNull();
  expect(container.querySelector(".load-mark-base")?.textContent).toBe("Sintel");
  await unmount();
  // Opened again, it doesn't try the broken logo a second time.
  const again = await render(<PlayerStatus state={status} error={null} logo={BROKEN} name="Sintel" steps={[]} backend="mpv" />);
  expect(again.container.querySelector(".load-mark img")).toBeNull();
  expect(again.container.querySelector(".load-mark")?.hasAttribute("data-name-wait")).toBe(false);
  await again.unmount();
});
