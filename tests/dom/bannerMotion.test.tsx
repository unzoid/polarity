import { expect, test } from "bun:test";
import { usePageMotion, watchCardTaps, type PageMotion } from "../../src/lib/ui/pageMotion";
import type { Entry } from "../../src/lib/router";
import { render } from "./render";

// On a phone a title's page grows out of what opened it: the featured banner too (#214), with the picture it shows.

function Probe({ pages, seen }: { pages: Entry[]; seen: (m: PageMotion | undefined) => void }) {
  seen(usePageMotion(pages, true));
  return null;
}

/** Gives `el` a place on the screen, which happy-dom doesn't lay out. */
function place(el: Element, x: number, y: number, w: number, h: number) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} }) as DOMRect;
}

/** A picture that has loaded. */
function loaded(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", { value: true });
  Object.defineProperty(img, "naturalWidth", { value: 1280 });
}

test("a title opened from the featured banner grows out of the banner, with the picture showing on it", async () => {
  const stop = watchCardTaps();
  const home: Entry = { key: 1, route: { name: "home" } as Entry["route"] };
  const detail: Entry = { key: 2, route: { name: "detail", type: "movie", id: "tt0000001" } as Entry["route"] };
  let motion: PageMotion | undefined;
  const { container, rerender, unmount } = await render(<Probe pages={[home]} seen={(m) => (motion = m)} />);

  const banner = document.createElement("div");
  banner.className = "hero-card";
  banner.innerHTML = `
    <div class="hero-art">
      <img class="hero-backdrop" data-current="false" src="https://media.example.com/other.jpg">
      <img class="hero-backdrop" data-current="true" src="https://media.example.com/shown.jpg">
    </div>
    <h2 class="hero-title">A title</h2>`;
  container.append(banner);
  place(banner, 16, 80, 380, 214);
  banner.querySelectorAll("img").forEach(loaded);

  // A tap on the banner's text, not its picture: the banner is still what it grows from.
  banner.querySelector<HTMLElement>(".hero-title")!.click();
  await rerender(<Probe pages={[home, detail]} seen={(m) => (motion = m)} />);
  expect(motion?.dir).toBe(1);
  expect(motion?.card).toEqual({ x: 16, y: 80, w: 380, h: 214, src: "https://media.example.com/shown.jpg" });

  stop();
  await unmount();
});
