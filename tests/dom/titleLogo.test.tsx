import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { TitleLogo } from "../../src/components/TitleLogo";
import { LOGO_SPOTS } from "../../src/lib/ui";
import { render } from "./render";

const BLACK = "https://media.example.com/black.png";
const WHITE = "https://media.example.com/white.png";
const BACKDROP = "https://media.example.com/backdrop.jpg";

/** Grey level each picture (by its measuring URL) is drawn in; absent = the host refuses it. */
let shades: Record<string, number> = {};
/** Each picture's size where it isn't a wide logo's 400 x 100 (#371). */
let sizes: Record<string, [number, number]> = {};
/** Pictures drawn without a see-through ground (a cover, the backdrop); logos are half see-through. */
let opaque = new Set<string>([BACKDROP]);
/** Pictures that load plainly (as shown) but refuse a CORS request. */
let plainOnly = new Set<string>();
const realImage = globalThis.Image;
const realGetContext = HTMLCanvasElement.prototype.getContext;

/** Pictures for measuring load (or fail) on the next tick; the canvas reads them back as their grey. */
class FakeImage {
  crossOrigin = "";
  decoding = "";
  naturalWidth = 400;
  naturalHeight = 100;
  onload?: () => void;
  onerror?: () => void;
  shade?: number;
  key = "";
  set src(url: string) {
    const key = url.replace("?tone=1", "");
    this.key = key;
    [this.naturalWidth, this.naturalHeight] = sizes[key] ?? [400, 100];
    const loads = key in shades ? !this.crossOrigin || !plainOnly.has(key) : false;
    setTimeout(() => (loads ? ((this.shade = shades[key]), this.onload?.()) : this.onerror?.()));
  }
}

beforeEach(() => {
  (globalThis as { Image: unknown }).Image = FakeImage;
  HTMLCanvasElement.prototype.getContext = function () {
    let shade = 0;
    let clear = false;
    return {
      drawImage: (img: FakeImage) => ((shade = img.shade ?? 0), (clear = !opaque.has(img.key))),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? (clear && (i >> 2) % 2 ? 0 : 255) : shade)),
      }),
    };
  } as unknown as typeof realGetContext;
});

afterEach(() => {
  (globalThis as { Image: unknown }).Image = realImage;
  HTMLCanvasElement.prototype.getContext = realGetContext;
  shades = {};
  sizes = {};
  opaque = new Set([BACKDROP]);
  plainOnly = new Set();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

test("TitleLogo: shows the logo at once, then the one of the title's logos that reads on the backdrop (#215)", async () => {
  shades = { [BLACK]: 0, [WHITE]: 245, [BACKDROP]: 30 };
  const { container, unmount } = await render(<TitleLogo src={BLACK} logos={[BLACK, WHITE]} backdrop={BACKDROP} spot={LOGO_SPOTS.hero} alt="A Show" />);
  // While it's measured the logo keeps its place unseen (a cover handed over as one never flashes, #371).
  expect(container.querySelector("img")?.getAttribute("src")).toBe(BLACK);
  expect(container.querySelector("img")?.hasAttribute("data-logo-pending")).toBe(true);
  await settle();
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe(WHITE);
  expect(img?.dataset.logoLook).toBeUndefined();
  await unmount();
});

test("TitleLogo: a lone black logo becomes the silhouette", async () => {
  shades = { [BLACK]: 0 };
  const { container, unmount } = await render(<TitleLogo src={BLACK} alt="A Show" />);
  await settle();
  expect(container.querySelector("img")?.dataset.logoLook).toBe("silhouette");
  await unmount();
});

test("TitleLogo: when neither the logo nor the backdrop can be measured, the caller shows the name", async () => {
  let failed = 0;
  const logo = "https://media.example.com/refused.png";
  const { container, unmount } = await render(
    <TitleLogo src={logo} backdrop="https://media.example.com/refused.jpg" spot={LOGO_SPOTS.detail} alt="A Show" onFail={() => failed++} />,
  );
  expect(container.querySelector("img")).not.toBeNull();
  await settle();
  expect(failed).toBe(1);
  expect(container.querySelector("img")).toBeNull();
  await unmount();
});

const COVER = "https://media.example.com/cover.jpg";

test("TitleLogo: a square cover handed over as the logo is never shown; the next logo is (#371)", async () => {
  shades = { [COVER]: 245, [BLACK]: 0, [BACKDROP]: 40 };
  sizes = { [COVER]: [460, 460] };
  opaque = new Set([BACKDROP, COVER]);
  const { container, unmount } = await render(<TitleLogo src={COVER} logos={[COVER, BLACK]} backdrop={BACKDROP} spot={LOGO_SPOTS.detail} alt="A Show" />);
  await settle();
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe(BLACK);
  expect(img?.hasAttribute("data-logo-pending")).toBe(false);
  await unmount();
});

test("TitleLogo: no candidate shaped like a logo: the caller shows the name", async () => {
  let failed = 0;
  shades = { [COVER]: 245, [BACKDROP]: 40 };
  sizes = { [COVER]: [460, 650] };
  const { container, unmount } = await render(<TitleLogo src={COVER} backdrop={BACKDROP} spot={LOGO_SPOTS.detail} alt="A Show" onFail={() => failed++} />);
  await settle();
  expect(failed).toBe(1);
  expect(container.querySelector("img")).toBeNull();
  await unmount();
});

test("TitleLogo: a host that refuses CORS still has its picture's shape checked", async () => {
  let failed = 0;
  shades = { [COVER]: 245, [BACKDROP]: 40 };
  sizes = { [COVER]: [460, 460] };
  plainOnly = new Set([COVER]);
  const { container, unmount } = await render(<TitleLogo src={COVER} backdrop={BACKDROP} spot={LOGO_SPOTS.detail} alt="A Show" onFail={() => failed++} />);
  await settle();
  expect(failed).toBe(1);
  expect(container.querySelector("img")).toBeNull();
  await unmount();
});

const DARK = "https://media.example.com/no-cors-logo.png";

/** The app's picture_bytes answers with a picture the canvas reads as `shade`; fetched URLs are kept in `asked`. */
function appReads(shade: number | null, asked: string[]) {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const w = window as { __TAURI_INTERNALS__?: unknown };
  w.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: { url: string }) => {
      if (cmd !== "picture_bytes") throw { code: "unsupported", message: cmd };
      asked.push(args.url);
      if (shade === null) throw { code: "upstream", message: "HTTP 403" };
      return new ArrayBuffer(8);
    },
  };
  URL.createObjectURL = () => {
    shades["blob:app-read"] = shade ?? 0;
    return "blob:app-read";
  };
  URL.revokeObjectURL = () => {};
  return () => {
    delete w.__TAURI_INTERNALS__;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  };
}

test("TitleLogo: a dark logo from a host without CORS headers is measured through the app and drawn as the silhouette (#354)", async () => {
  shades = { [DARK]: 0 };
  plainOnly = new Set([DARK]);
  const asked: string[] = [];
  const restore = appReads(0, asked);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { container, unmount } = await render(<TitleLogo src={DARK} alt="A Show" />);
    await settle();
    expect(asked).toEqual([`${DARK}?tone=1`]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(DARK);
    expect(container.querySelector("img")?.dataset.logoLook).toBe("silhouette");
    expect(warn).not.toHaveBeenCalled();
    await unmount();
  } finally {
    warn.mockRestore();
    restore();
  }
});

test("TitleLogo: a logo even the app can't read is said in the console, by its host alone (#354)", async () => {
  const logo = "https://pictures.example.org/tt0000000/logo.png";
  shades = { [logo]: 0 };
  plainOnly = new Set([logo]);
  const restore = appReads(null, []);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { container, unmount } = await render(<TitleLogo src={logo} alt="A Show" />);
    await settle();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(logo);
    const said = warn.mock.calls.map((c) => String(c[0]));
    expect(said).toEqual(["TitleLogo: couldn't measure the logo from pictures.example.org; it's drawn without the contrast check"]);
    expect(said.join(" ")).not.toContain("tt0000000");
    await unmount();
  } finally {
    warn.mockRestore();
    restore();
  }
});

test("TitleLogo: an app answer that isn't a picture's bytes, or a blob URL that can't be made, counts as unmeasured, never an error (#354)", async () => {
  const logo = "https://pictures.example.org/odd-answer.png";
  const srcs = [`${logo}?null`, `${logo}?bytes`];
  shades = { [srcs[0]!]: 0, [srcs[1]!]: 0 };
  plainOnly = new Set(srcs);
  const w = window as { __TAURI_INTERNALS__?: unknown };
  const realCreate = URL.createObjectURL;
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const answer of [null, new ArrayBuffer(8)]) {
      // A bridge that answers every command with null, as other tests' fakes do; then real bytes whose blob URL fails.
      w.__TAURI_INTERNALS__ = { invoke: async () => answer };
      URL.createObjectURL = () => {
        throw new TypeError("createObjectURL expects a Blob object");
      };
      const { container, unmount } = await render(<TitleLogo src={`${logo}?${answer ? "bytes" : "null"}`} alt="A Show" />);
      await settle();
      expect(container.querySelector("img")?.getAttribute("src")).toBe(`${logo}?${answer ? "bytes" : "null"}`);
      await unmount();
    }
  } finally {
    warn.mockRestore();
    delete w.__TAURI_INTERNALS__;
    URL.createObjectURL = realCreate;
  }
});
