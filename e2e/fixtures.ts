import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { serveMedia } from "./media";

/**
 * Every test starts on fake.html with no network beyond the dev server:
 * media.example answers with a silent WAV (media.ts), every other host is
 * refused, so a test never reaches a real service. Uncaught errors in the
 * page fail the test, except WebKit's own note on a load refused here (see
 * refusedLoad).
 *
 * Headless WebKit paints backdrop-filter in software: the title page's glass
 * buttons bring it down to about a frame a second, so Playwright's wait for an
 * element to hold still over two frames runs out on clicks and hovers there.
 * In WebKit every page is drawn without it; no test looks at the blur.
 */
export const test = base.extend<{ tv: boolean; account: boolean; app: Page }>({
  /** Start in TV mode (`test.use({ tv: true })`), as the Controls page's switch leaves it. */
  tv: [false, { option: true }],
  /** Start signed in to the fake shell's account, with watch parties in the page (`test.use({ account: true })`). */
  account: [false, { option: true }],
  app: async ({ page, baseURL, tv, account, browserName }, use) => {
    const errors: string[] = [];
    const refused = new Set<string>();
    page.on("pageerror", (e) => {
      if (browserName === "webkit" && refusedLoad(e, refused)) return;
      errors.push(String(e));
    });
    await page.route(
      (url) => url.origin !== new URL(baseURL!).origin && url.protocol.startsWith("http") && url.host !== "media.example",
      (route) => {
        refused.add(route.request().url());
        return route.abort("blockedbyclient");
      },
    );
    await serveMedia(page);
    if (browserName === "webkit")
      await page.addInitScript(() =>
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = "*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }";
          document.head.append(style);
        }),
      );
    if (tv) await page.addInitScript(() => localStorage.setItem("polar.tvMode", "1"));
    await page.goto(account ? "/fake.html?account=1" : "/fake.html");
    await expect(page.locator("#root > *").first()).toBeAttached();
    await use(page);
    expect(errors, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };

/**
 * WebKit's console note on a failed load of another origin, "Fetch API cannot load <url> due to access control
 * checks.", which Playwright passes on as an error in the page now and then (with the fetch's call stack, but no
 * TypeError and no "Unhandled Promise Rejection"), even when the app catches the failed fetch. Only the note for a
 * URL this fixture refused is let through.
 */
function refusedLoad(e: Error, refused: Set<string>): boolean {
  const m = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec((e.stack ?? "").split("\n")[0]);
  return !!m && refused.has(m[1]);
}

/** A poster or row card, by the title's name (its accessible name is "<name> <year>"). */
export const card = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first();

/** The player's clock (remaining time by default), as text. */
export const clock = (page: Page) => page.locator(".player-remaining").textContent();

/**
 * The watch party's dialogs and panels on screen (#247): the join dialog, a link to confirm, "Watch party over",
 * the party menu (top bar popover, TV panel), the profile menu at its Join or Friends view, and the player's
 * Watch Party panel. Never more than one.
 */
export const partySurfaces = (page: Page) =>
  page
    .locator(
      ".party-dialog, .party-link-confirm, .party-popover, .profile-pop:has(.profile-pop-view:not([data-view=list])), .tv-party, .tv-join, .tv-friends, .options-overlay[data-open=true]:has(.party-pane, .party-column)",
    )
    .filter({ visible: true });

/** Season names whose letters reach below the baseline, and above the capitals (#353). */
export const TALL_LABELS = ["Gypsy Jig Spring", "Ça Ÿ Été Ñ Å"];

/**
 * Puts `text` in a label and says whether all of it shows (#353): its glyph box, from the font's ascent to its
 * descent, inside the nearest box that clips it. A line height of 1 under `overflow: hidden` cut off the "g".
 */
export const labelShowsWhole = (label: Locator, text: string) =>
  label.evaluate((el, text) => {
    el.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(el);
    const glyphs = range.getBoundingClientRect();
    let clip: Element | null = el;
    while (clip && getComputedStyle(clip).overflowY === "visible") clip = clip.parentElement;
    if (!clip) return true;
    const box = clip.getBoundingClientRect();
    const top = box.top + clip.clientTop;
    return glyphs.top >= top - 0.5 && glyphs.bottom <= top + clip.clientHeight + 0.5;
  }, text);

/**
 * Where the shown Back button is (#348): the navbar's on a page (`.navbar-back`), the player's in the player (`.player-back`),
 * rounded to the pixel, once it has settled. Each must be the shared BackButton (`.back-button`).
 */
export const backPlace = async (page: Page, which: "navbar" | "player") => {
  const back = page.locator(which === "navbar" ? ".navbar-back.back-button" : ".player-top > .player-back.back-button");
  await expect(back).toBeVisible();
  // Read once the page has settled: after two frames have been drawn (WebKit can leave the layout where it was between
  // reads, so two reads in a row agreed half a pixel short of where the navbar's slide-in lands), with no transition or
  // animation running on it or anything it sits in.
  const place = () =>
    back.evaluate(async (el) => {
      await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame)));
      for (let at: Element | null = el; at; at = at.parentElement) if (at.getAnimations().some((a) => a.playState === "running")) return "moving";
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round).join(",");
    });
  // And until two reads agree, for whatever moves it without an animation (a page still laying out).
  let last = "";
  await expect.poll(async () => (last === (last = await place()) ? last : "moving")).not.toBe("moving");
  return last;
};

/**
 * Every pair of things in the player's top or bottom bar whose boxes meet (#396): the controls, and the title and show
 * lines as drawn (cut short to their box). Hidden controls (a folded slider, words of an icon-only action) don't count;
 * neither does a control sticking out of the window. Empty when nothing overlaps.
 */
export const barOverlaps = (page: Page) =>
  page.locator(".player").evaluate((player) => {
    const shown = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.opacity !== "0" && r.width > 0 && r.height > 0;
    };
    const problems: string[] = [];
    for (const bar of player.querySelectorAll(".player-top, .player-bottom")) {
      const parts = [...bar.querySelectorAll("button, input, .player-heading > *")]
        .filter((el) => shown(el) && !el.closest(".player-volume[data-folded] .player-volume-slider"))
        .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.slice(0, 24) ?? el.tagName, box: el.getBoundingClientRect() }));
      for (const { name, box } of parts) {
        if (box.left < -0.5 || box.right > innerWidth + 0.5) problems.push(`${name} leaves the window`);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const [a, b] = [parts[i].box, parts[j].box];
          if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)
            problems.push(`${parts[i].name} overlaps ${parts[j].name}`);
        }
    }
    return problems;
  });
