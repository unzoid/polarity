import { expect, test } from "bun:test";
import { cardAt } from "../../src/lib/ui/pageMotion";

// On a phone a title's page grows out of what opened it (lib/ui/pageMotion.ts): the featured banner too (#214),
// with the picture it shows.

/** Gives `el` a place on the screen, which happy-dom doesn't lay out. */
function place(el: Element, x: number, y: number, w: number, h: number) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} }) as DOMRect;
}

/** A picture that has loaded. */
function loaded(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", { value: true });
  Object.defineProperty(img, "naturalWidth", { value: 1280 });
}

function element(html: string): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = html.trim();
  const el = box.firstElementChild as HTMLElement;
  document.body.append(el);
  return el;
}

test("a tap anywhere on the featured banner is the banner's, with the picture showing on it", () => {
  const banner = element(`
    <div class="hero-card">
      <div class="hero-art">
        <img class="hero-backdrop" data-current="false" src="https://media.example.com/other.jpg">
        <img class="hero-backdrop" data-current="true" src="https://media.example.com/shown.jpg">
      </div>
      <h2 class="hero-title">A title</h2>
    </div>`);
  place(banner, 16, 80, 380, 214);
  banner.querySelectorAll("img").forEach(loaded);
  // On its text, not its picture: the banner is still what it grows from.
  expect(cardAt(banner.querySelector(".hero-title"))).toEqual({ x: 16, y: 80, w: 380, h: 214, src: "https://media.example.com/shown.jpg" });
  banner.remove();
});

test("a banner whose picture hasn't loaded grows without one", () => {
  const banner = element(`<div class="hero-card"><img class="hero-backdrop" data-current="true" src="https://media.example.com/slow.jpg"></div>`);
  place(banner, 0, 60, 412, 232);
  expect(cardAt(banner)?.src).toBeUndefined();
  expect(cardAt(banner)?.w).toBe(412);
  banner.remove();
});

test("a card is still its art's frame, not the caption under it; elsewhere is no card", () => {
  const card = element(`<div class="card"><div class="card-frame"><img src="https://media.example.com/poster.jpg"></div><p class="caption">Name</p></div>`);
  place(card, 0, 0, 150, 260);
  place(card.querySelector(".card-frame")!, 0, 0, 150, 225);
  loaded(card.querySelector("img")!);
  expect(cardAt(card.querySelector(".caption"))).toEqual({ x: 0, y: 0, w: 150, h: 225, src: "https://media.example.com/poster.jpg" });
  expect(cardAt(document.body)).toBeUndefined();
  expect(cardAt(null)).toBeUndefined();
  card.remove();
});
