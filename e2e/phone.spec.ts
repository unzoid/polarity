import type { Locator, Page } from "@playwright/test";
import { serveAniList } from "./anilistMock";
import { barOverlaps, card, expect, labelShowsWhole, partySurfaces, TALL_LABELS, test } from "./fixtures";

// Phone width (Pixel 7: 412×915, touch): the phone shell (src/phone) over the app's pages (docs/ARCHITECTURE.md §4).

/** Nothing sticks out sideways: the page never scrolls horizontally. */
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The floating bar's places. */
const bar = (page: Page) => page.getByRole("navigation", { name: "Sections" });

/** A title found through Search, opened as its sheet. */
async function openTitle(page: Page, query: string, name: string): Promise<Locator> {
  await bar(page).getByRole("button", { name: "Search", exact: true }).tap();
  await page.getByRole("searchbox", { name: "Search" }).fill(query);
  await page.locator(".ph-results").getByRole("button", { name: new RegExp(`^${name}\\b`) }).first().tap();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The Glass Orchard, played from its sheet. */
async function playFilm(page: Page) {
  const sheet = await openTitle(page, "glass orchard", "The Glass Orchard");
  await sheet.getByRole("button", { name: "Play", exact: true }).tap();
}

async function openPlayer(page: Page) {
  await playFilm(page);
  const player = page.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "true");
}

/** Settings from the Profiles sheet (My Polarity → the profile → App Settings), on the page `section`. */
async function openSettingsPage(app: Page, section: string) {
  await openSettingsList(app);
  const settings = app.locator(".t3s");
  await settings.getByRole("button", { name: section, exact: true }).tap();
  await expect(settings).toHaveAccessibleName(section);
  return settings;
}

async function openSettingsList(app: Page) {
  await bar(app).getByRole("button", { name: "My Polarity", exact: true }).tap();
  await app.getByRole("button", { name: "Profiles", exact: true }).tap();
  await app.locator(".sheet").getByRole("button", { name: "App Settings" }).tap();
  await expect(app.locator(".t3s")).toBeVisible();
}

test("the phone layout: the floating bar at the bottom, no window buttons", async ({ app }) => {
  await expect(app.locator("html")).toHaveAttribute("data-form", "phone");
  await expect(app.locator("html")).toHaveAttribute("data-touch", "true");
  const box = await bar(app).boundingBox();
  const height = app.viewportSize()!.height;
  expect(box!.y + box!.height).toBeGreaterThan(height - 120);
  await expect(bar(app).getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(app.getByRole("button", { name: "Minimize" })).toHaveCount(0);
  // The shelves' paging paddles are a mouse thing: on touch they'd catch taps on the cards under them.
  await expect(app.locator(".row-paddle").first()).toBeHidden();
  expect(await fitsWidth(app)).toBe(true);
});

test("with the Calendar on, it's in the Profiles sheet, not a place in the bar (#449)", async ({ app }) => {
  await app.goto("/fake.html?showCalendar=true");
  await expect(bar(app).getByRole("button", { name: "Calendar", exact: true })).toHaveCount(0);
  await bar(app).getByRole("button", { name: "My Polarity", exact: true }).tap();
  await app.getByRole("button", { name: "Profiles", exact: true }).tap();
  await app.locator(".sheet").getByRole("button", { name: "Calendar" }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Calendar" }).first()).toBeVisible();
});

test("search, a title's sheet and the player by touch", async ({ app }) => {
  const sheet = await openTitle(app, "glass orchard", "The Glass Orchard");
  expect(await fitsWidth(app)).toBe(true);
  await sheet.getByRole("button", { name: "Play", exact: true }).tap();
  const player = app.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  // The controls hide while it plays; a tap on the picture brings them back, a second one hides them.
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "true");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  // A phone's volume buttons set the volume: no slider and no volume button (#179, #460), and the player plays at full volume.
  await expect(player.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await expect(player.getByRole("slider", { name: "Volume" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: /^(Mute|Unmute|Volume)$/ })).toHaveCount(0);
  expect(await player.locator("video").evaluate((v: HTMLVideoElement) => [v.volume, v.muted])).toEqual([1, false]);
  // Back leaves the player for the title's sheet.
  await player.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(player).toHaveCount(0);
  await expect(sheet).toBeVisible();
  // Close takes the sheet away, back to Search.
  await sheet.getByRole("button", { name: "Close", exact: true }).first().tap();
  await expect(sheet).toHaveCount(0);
});

test("search on a phone is a tab of its own: genres to start from, results as you type, another tab to leave", async ({ app }) => {
  await bar(app).getByRole("button", { name: "Search", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(app.getByRole("button", { name: "Horror", exact: true })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
  await app.getByRole("searchbox", { name: "Search" }).fill("orchard");
  await expect(card(app, "Orchard House")).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
  await bar(app).getByRole("button", { name: "Home", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Search" })).toHaveCount(0);
});

test("an add-on's catalogs switched on show as Home rows and fit a phone (#206)", async ({ app }) => {
  await app.addInitScript(() =>
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), addonCatalogsHome: '{"on":["example.lists"],"order":[]}' })),
  );
  await app.reload();
  const picks = app.locator('[data-addon-row="picks"]');
  await expect(picks.getByRole("button", { name: /^Staff Picks · Example Lists/ })).toBeVisible();
  await expect(picks.locator(".ph-poster")).toHaveCount(4);
  // Scrolled to first: a tap on a list still moving is taken as stopping it, not as a tap (#459).
  await picks.locator(".ph-poster").first().scrollIntoViewIfNeeded();
  await app.waitForTimeout(500);
  await picks.locator(".ph-poster").first().tap();
  await expect(app.getByRole("dialog")).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
});

test("a sideways swipe on the featured card turns to the next title and back", async ({ app }) => {
  const hero = app.locator(".ph-hero").first();
  await expect(hero).toBeVisible();
  const first = await hero.getAttribute("aria-label");
  const swipe = (from: number, to: number) =>
    hero.evaluate(
      (el, [from, to]) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const touch = (x: number) => [new Touch({ identifier: 7, target: el, clientX: r.left + r.width * x, clientY: y })];
        el.dispatchEvent(new TouchEvent("touchstart", { touches: touch(from), bubbles: true, cancelable: true }));
        for (let i = 1; i <= 6; i++) el.dispatchEvent(new TouchEvent("touchmove", { touches: touch(from + ((to - from) * i) / 6), bubbles: true, cancelable: true }));
        el.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true, cancelable: true }));
      },
      [from, to],
    );
  await swipe(0.8, 0.2);
  await expect(hero).not.toHaveAttribute("aria-label", first!);
  await swipe(0.2, 0.8);
  await expect(hero).toHaveAttribute("aria-label", first!);
  // Still on Home: the swipe didn't open the title.
  await expect(app.getByRole("dialog")).toHaveCount(0);
});

test("a title's action row fits a phone", async ({ app }) => {
  const sheet = await openTitle(app, "kingsbridge", "Kingsbridge");
  const last = sheet.locator(".ps-actions .ps-action").last();
  await expect(last).toBeVisible();
  const box = await last.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(app.viewportSize()!.width);
});

test("on touch, an episode's Download is always there, not waiting for a hover (#79)", async ({ app }) => {
  const sheet = await openTitle(app, "fieldwork", "Fieldwork");
  const download = sheet.locator(".ps-episode-dl").first();
  await expect(download).toBeVisible();
  expect(await download.evaluate((b) => getComputedStyle(b).opacity)).toBe("1");
});

test("a phone has no TV mode (#141)", async ({ app }) => {
  await expect(app.getByRole("button", { name: "TV mode" })).toHaveCount(0);
});

test("the season dropdown is compact, its name shown whole (#151)", async ({ app }) => {
  const sheet = await openTitle(app, "kingsbridge", "Kingsbridge");
  const name = sheet.locator(".ps-season-dropdown .select-value");
  await expect(name).toBeVisible();
  expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect(await fitsWidth(app)).toBe(true);
});

test("the season dropdown shows a name's descenders and accents whole (#353)", async ({ app }) => {
  const sheet = await openTitle(app, "kingsbridge", "Kingsbridge");
  const value = sheet.locator(".ps-season-dropdown .select-value");
  await expect(value).toBeVisible();
  for (const name of TALL_LABELS) expect(await labelShowsWhole(value, name), name).toBe(true);
});

test("settings on a phone: the sections, then one section with a way back", async ({ app }) => {
  await openSettingsList(app);
  const profiles = app.locator(".sheet");
  // Not by name: on a phone the header shows only the open section, and that names the region ("Browsing").
  const settings = app.locator(".t3s");
  await expect(settings).toHaveAccessibleName(/^Settings/);
  const browsing = settings.getByRole("button", { name: "Browsing", exact: true });
  await expect(browsing).toBeVisible();
  await browsing.tap();
  // Browsing is split into sections: its list first, then the section's own view.
  await expect(settings).toHaveAccessibleName("Browsing");
  await expect(browsing).toBeHidden();
  const pages = settings.getByRole("button", { name: /^Home & Title Pages/ });
  await pages.tap();
  await expect(settings.getByRole("switch", { name: /^Show the Calendar/ })).toBeVisible();
  await expect(settings).toHaveAccessibleName("Home & Title Pages");
  // The sheet's Back: from the section to its page's list, to the list of pages, then back to the profiles.
  await profiles.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(pages).toBeVisible();
  await profiles.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(browsing).toBeVisible();
  await profiles.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(settings).toHaveCount(0);
  await expect(profiles.getByRole("button", { name: "App Settings" })).toBeVisible();
});

test("the gear in the bar opens Settings straight away", async ({ app }) => {
  await app.locator(".ph-tab[data-active='true'] .ph-head").getByRole("button", { name: "Settings", exact: true }).tap();
  await expect(app.locator(".t3s")).toHaveAccessibleName(/^Settings/);
});

test("a settings page on a phone: no stray arrow in its header, and Back goes to the list, then to the profiles (#455)", async ({ app }) => {
  const settings = await openSettingsPage(app, "Appearance");
  // Restore device defaults' arrow, alone and greyed, read as a Back that did nothing: not in a phone's header.
  await expect(settings.locator(".t3s-header .t3s-ghost")).toHaveCount(0);
  // Android's back button and gesture arrive as Escape (lib/ui/systemBack.ts).
  await app.keyboard.press("Escape");
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeVisible();
  await expect(settings).toHaveAccessibleName(/^Settings/);
  await app.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(app.locator(".sheet").getByRole("button", { name: "App Settings" })).toBeVisible();
});

test("an add-on's long name and description, unbroken words and a link among them, wrap inside Settings (#456)", async ({ app }) => {
  await app.goto("/fake.html?worst=1");
  const settings = await openSettingsPage(app, "Add-ons");
  const row = settings.getByRole("button", { name: /^Community Archive of Restored Public-Domain Cinema/ });
  await row.tap();
  // On a phone an add-on's details open in the settings' tray, over the page.
  const description = app.locator(".ft-tray").getByText(/ExampleProvider1\/ExampleProvider2/);
  await expect(description).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
  // The description itself stays on the screen: its words wrap rather than run off the right.
  const box = await description.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(app.viewportSize()!.width);
  expect(await description.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

/** A notched phone's insets (in CSS px), set on the page as the webview would report them. */
async function insets(page: Page, i: { top: number; right: number; bottom: number; left: number }) {
  await page.evaluate((i) => {
    const s = document.documentElement.style;
    for (const [side, px] of Object.entries(i)) s.setProperty(`--safe-${side}`, `${px}px`);
  }, i);
}

/** Every control in the player's bars lies inside the screen less the insets. */
async function controlsClearOf(page: Page, i: { top: number; right: number; bottom: number; left: number }) {
  const { width, height } = page.viewportSize()!;
  const boxes = await page.locator(".player :is(.player-top, .player-bottom) :is(button, input)").evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent).map((e) => ({ name: e.getAttribute("aria-label") ?? e.textContent, ...e.getBoundingClientRect().toJSON() })),
  );
  expect(boxes.length).toBeGreaterThan(3);
  for (const b of boxes) {
    expect.soft(b.top, `${b.name} below the top inset`).toBeGreaterThanOrEqual(i.top);
    // The bottom row reaches 0.75rem into the home indicator's strip on a phone (player.css).
    expect.soft(b.bottom, `${b.name} above the bottom inset`).toBeLessThanOrEqual(height - i.bottom + (i.bottom ? 12 : 0));
    expect.soft(b.left, `${b.name} right of the left inset`).toBeGreaterThanOrEqual(i.left);
    expect.soft(b.right, `${b.name} left of the right inset`).toBeLessThanOrEqual(width - i.right);
  }
}

test("the player's controls keep clear of the notch and the home indicator, upright and sideways (#172)", async ({ app }) => {
  const upright = { top: 59, right: 0, bottom: 34, left: 0 };
  await insets(app, upright);
  await openPlayer(app);
  await controlsClearOf(app, upright);
  // Nor do they overlap each other or the title (#396).
  expect(await barOverlaps(app)).toEqual([]);

  await app.setViewportSize({ width: 915, height: 412 });
  const sideways = { top: 0, right: 59, bottom: 21, left: 59 };
  await insets(app, sideways);
  await controlsClearOf(app, sideways);
  expect(await barOverlaps(app)).toEqual([]);
});

test("the trailer fits the screen at every phone width, upright and sideways, its controls inside the insets (#289)", async ({ app }) => {
  const sheet = await openTitle(app, "lanterns", "Paper Lanterns");
  await sheet.locator(".ps-actions").getByRole("button", { name: "Trailer", exact: true }).tap();
  const layer = app.getByRole("dialog", { name: "Paper Lanterns trailer" });
  await expect(layer).toBeVisible();
  for (const width of [360, 390, 430]) {
    for (const [w, h, i] of [
      [width, 800, { top: 59, right: 0, bottom: 34, left: 0 }],
      [800, width, { top: 0, right: 59, bottom: 21, left: 59 }],
    ] as const) {
      await app.setViewportSize({ width: w, height: h });
      await insets(app, i);
      const at = `${w}×${h}`;
      const video = await layer.locator(".trailer-video").boundingBox();
      expect.soft(video!.x, `${at}: the video right of the left inset`).toBeGreaterThanOrEqual(i.left);
      expect.soft(video!.x + video!.width, `${at}: the video left of the right inset`).toBeLessThanOrEqual(w - i.right + 0.5);
      expect.soft(video!.y, `${at}: the video below the top inset`).toBeGreaterThanOrEqual(i.top);
      // Sideways the picture takes the whole height between the insets, or the whole width but a column for the buttons.
      if (w > h) {
        const tall = video!.height >= h - i.top - i.bottom - 32;
        const wide = video!.width >= w - i.left - i.right - 96;
        expect.soft(tall || wide, `${at}: the video fills the height or the width (${video!.width}×${video!.height})`).toBe(true);
      }
      for (const control of await layer.getByRole("button").all()) {
        const b = (await control.boundingBox())!;
        const name = (await control.getAttribute("aria-label")) ?? (await control.textContent());
        expect.soft(b.x, `${at}: ${name} right of the left inset`).toBeGreaterThanOrEqual(i.left);
        expect.soft(b.x + b.width, `${at}: ${name} left of the right inset`).toBeLessThanOrEqual(w - i.right + 0.5);
        expect.soft(b.y, `${at}: ${name} below the top inset`).toBeGreaterThanOrEqual(i.top);
        expect.soft(b.y + b.height, `${at}: ${name} above the bottom inset`).toBeLessThanOrEqual(h - i.bottom + 0.5);
      }
      expect.soft(await fitsWidth(app), `${at}: nothing sticks out sideways`).toBe(true);
    }
  }
  await layer.getByRole("button", { name: "Close trailer" }).tap();
  await expect(layer).toHaveCount(0);
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 1180, height: 820 } });

  test("the player's controls keep clear of the status bar and the home indicator (#172)", async ({ app }) => {
    await expect(app.locator("html")).toHaveAttribute("data-form", "tablet");
    const tablet = { top: 24, right: 0, bottom: 20, left: 0 };
    await insets(app, tablet);
    // A tablet keeps the big screens' layout: its top bar's Movies, the title's page.
    await app.locator(".navbar").getByRole("button", { name: "Movies", exact: true }).tap();
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Play", exact: true }).tap();
    const player = app.locator(".player");
    await expect(player).toHaveAttribute("data-started", "true");
    await expect(player).toHaveAttribute("data-chrome", "false");
    await player.tap({ position: { x: 200, y: 300 } });
    await expect(player).toHaveAttribute("data-chrome", "true");
    await controlsClearOf(app, tablet);
  });
});

test("on a phone, a long press on a source opens its info; no i button shows (#229)", async ({ app }) => {
  const sheet = await openTitle(app, "glass orchard", "The Glass Orchard");
  await sheet.locator(".ps-actions").getByRole("button", { name: "Sources", exact: true }).tap();
  const overlay = app.locator(".ph-sources-overlay");
  const row = overlay.locator(".stream-row").last();
  await expect(row).toBeVisible();
  await expect(overlay.locator(".stream-info")).toHaveCount(0);
  // What a held finger sends (lib/platform/longPress.ts sends it on iOS; Android's web view itself).
  await row.dispatchEvent("contextmenu");
  const panel = app.getByRole("dialog", { name: "Source Info" });
  await expect(panel).toContainText("https://media.example/token/•••/4.mp4?apikey=•••");
  expect(await panel.textContent()).not.toContain("TOKEN0000");
  // Best Match's table scrolls sideways inside the card, never the page (#274).
  await expect(panel.getByRole("table").getByRole("rowheader", { name: "Total" })).toBeAttached();
  expect(await fitsWidth(app)).toBe(true);
  await panel.getByRole("button", { name: "Close" }).tap();
  await expect(panel).toHaveCount(0);
  await expect(overlay).toBeVisible();
});

test("title pages have no colored top gradient and Sources opens as a borderless full-screen overlay", async ({ app }) => {
  const sheet = await openTitle(app, "glass orchard", "The Glass Orchard");
  // No coloured art-tint gradient at the top of the title sheet's scroll area.
  const scrollBg = await sheet.locator(".ps-scroll").evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(scrollBg).toBe("none");

  await sheet.locator(".ps-actions").getByRole("button", { name: "Sources", exact: true }).tap();
  const overlay = app.locator(".ph-sources-overlay");
  await expect(overlay).toBeVisible();
  await expect(app.locator(".sheet")).toHaveCount(0);
  const featured = overlay.locator('.stream-row[data-featured="true"]');
  await expect(featured).toBeVisible();
  // Borderless, cardless rows: transparent background and no inset card outline.
  const rowStyle = await featured.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, shadow: s.boxShadow };
  });
  expect(rowStyle.bg).toBe("rgba(0, 0, 0, 0)");
  expect(rowStyle.shadow).toBe("none");

  // Quality radios, add-on picker sub-view, and Filters sub-view all live inside the overlay.
  const qualities = overlay.getByRole("radiogroup", { name: "Picture quality" });
  await expect(qualities).toBeVisible();
  await overlay.getByRole("button", { name: "Add-on" }).tap();
  await expect(overlay).toHaveAttribute("data-view", "addon");
  await overlay.getByRole("button", { name: /^Open Films/ }).tap();
  await expect(overlay).toHaveAttribute("data-view", "list");
  await expect(overlay.getByRole("button", { name: "Add-on" })).toContainText("Open Films");

  await overlay.getByRole("button", { name: /^Filters/ }).tap();
  await expect(overlay).toHaveAttribute("data-view", "filters");
  await overlay.getByRole("button", { name: "Highest Quality" }).tap();
  await overlay.getByRole("button", { name: "Done", exact: true }).tap();
  await expect(overlay).toHaveAttribute("data-view", "list");

  expect(await fitsWidth(app)).toBe(true);
  await overlay.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(overlay).toHaveCount(0);
});

test("a phone on its side: each player panel starts under its X, nothing under it (#464)", async ({ app }) => {
  await app.setViewportSize({ width: 915, height: 412 });
  await playFilm(app);
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  for (const name of ["Subtitles & Audio", "Sources"]) {
    const button = app.locator(".player").getByRole("button", { name, exact: true });
    // The controls may have hidden: a tap on the picture brings them back.
    if (!(await button.isVisible())) await app.locator(".player").tap({ position: { x: 450, y: 200 } });
    await button.tap();
    const overlay = app.locator('.options-overlay[data-open="true"]');
    const close = overlay.locator(".options-close");
    await expect(close).toBeVisible();
    const x = (await close.boundingBox())!;
    const columns = await overlay.locator(".options-column").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
    expect(columns.length).toBeGreaterThan(0);
    for (const c of columns) {
      const apart = c.right <= x.x || c.left >= x.x + x.width || c.bottom <= x.y || c.top >= x.y + x.height;
      expect(apart, `${name}: a column at ${c.left},${c.top} under the X at ${x.x},${x.y}`).toBe(true);
      expect(c.bottom).toBeLessThanOrEqual(412);
    }
    await close.tap();
    await expect(overlay).toHaveCount(0);
  }
});

test("the player's Sources panel fits a phone upright and sideways, add-on picker and all (#462)", async ({ app }) => {
  await playFilm(app);
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  for (const [width, height] of [
    [412, 915],
    [915, 412],
  ]) {
    await app.setViewportSize({ width, height });
    const button = app.locator(".player").getByRole("button", { name: "Sources", exact: true });
    if (!(await button.isVisible())) await app.locator(".player").tap({ position: { x: width / 2, y: height / 2 } });
    await button.tap();
    const column = app.locator('.options-overlay[data-open="true"] .options-column');
    // The fake add-ons are two: the picker shows, as the issue asks.
    await expect(column.locator(".srcf-addon")).toBeVisible();
    // Measured once the panel has finished coming in.
    await column.evaluate((el) => Promise.all(el.closest(".options-overlay")!.getAnimations({ subtree: true }).map((a) => a.finished)));
    const box = async (sel: string) => (await column.locator(sel).first().boundingBox())!;
    const col = (await column.boundingBox())!;
    const [title, head, list] = [await box(".options-title"), await box(".options-head"), await box(".options-list")];
    const at = `${width}×${height}`;
    expect(col.x, at).toBeGreaterThanOrEqual(0);
    expect(col.x + col.width, at).toBeLessThanOrEqual(width);
    expect(col.y + col.height, at).toBeLessThanOrEqual(height);
    // The filters sit under the title, not squeezed beside it.
    for (const sel of [".srcf-bar > :first-child", ".srcf-addon", ".srcf-filters"]) {
      const b = await box(sel);
      expect(b.y, `${at}: ${sel} under the title`).toBeGreaterThanOrEqual(title.y + title.height);
      expect(b.x + b.width, `${at}: ${sel} inside the panel`).toBeLessThanOrEqual(col.x + col.width + 1);
    }
    // Every row is the panel's width at most, and the list starts under the filters (its fade reaches 12px up).
    const rows = await column.locator(".options-item").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(rows.length).toBeGreaterThan(0);
    for (const right of rows) expect(right, at).toBeLessThanOrEqual(col.x + col.width + 1);
    expect(list.y + 12, at).toBeGreaterThanOrEqual(head.y + head.height);
    expect(list.height, `${at}: room for the list`).toBeGreaterThan(80);
    expect(await fitsWidth(app)).toBe(true);
    await app.locator('.options-overlay[data-open="true"] .options-close').tap();
    await expect(column).toHaveCount(0);
  }
});

test.describe("signed in, on a fresh profile", () => {
  test.use({ account: true });

  test("starting a watch party in the player leaves one party panel up, with the focus in it (#247)", async ({ app }) => {
    await playFilm(app);
    await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
    // On a phone, Watch Party and Sleep Timer live inside the top-right More ("…") menu so the bottom bar fits.
    await expect(app.locator(".player-actions").getByRole("button", { name: "Watch Party" })).toHaveCount(0);
    await expect(app.locator(".player-actions").getByRole("button", { name: "Sleep Timer" })).toHaveCount(0);
    await app.locator(".player-top").getByRole("button", { name: "More", exact: true }).tap();
    await app.getByRole("menuitem", { name: "Watch Party" }).tap();
    await expect(partySurfaces(app)).toHaveCount(1);
    await app.getByRole("button", { name: "Start a Watch Party" }).tap();
    await expect(app.getByRole("button", { name: "End Party" })).toBeVisible();
    await expect(partySurfaces(app)).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Copy Invite" })).toBeFocused();
  });
});

/** The Glass Orchard played, every source a made-up torrent. */
async function playTorrentFilm(app: Page) {
  await app.addInitScript(() => localStorage.setItem("polar.fakeTorrents", "1"));
  await app.reload();
  await playFilm(app);
}

test("the torrent notice fits a phone: the upload limit and both buttons inside the screen (#458)", async ({ app }) => {
  await playTorrentFilm(app);
  const notice = app.getByRole("dialog", { name: "Torrent playback" });
  await expect(notice).toBeVisible();
  const width = app.viewportSize()!.width;
  for (const part of [notice.locator(".torrent-notice-card"), notice.getByRole("textbox", { name: "Upload limit" }), notice.getByRole("button", { name: "Cancel" }), notice.getByRole("button", { name: "Play", exact: true })]) {
    const box = await part.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  expect(await fitsWidth(app)).toBe(true);
});

test("a section: its list and genre side by side, picked from the chooser (#457)", async ({ app }) => {
  // A Home row's name opens it as a section.
  await app.locator(".ph-tab[data-active='true'] .ph-row-more").first().tap();
  const section = app.locator(".ph-pushed .ph-section");
  const pills = section.locator(".ph-sect-pills .ph-pill");
  await expect(pills).toHaveCount(2);
  // Measured once the page has slid in.
  await section.evaluate((el) => Promise.all(el.closest(".ph-pushed")!.getAnimations().map((a) => a.finished)));
  const [list, genre] = [await pills.nth(0).boundingBox(), await pills.nth(1).boundingBox()];
  expect(Math.abs(list!.y - genre!.y)).toBeLessThanOrEqual(1);
  expect(genre!.x).toBeGreaterThan(list!.x + list!.width);
  expect(await fitsWidth(app)).toBe(true);
  await pills.nth(0).tap();
  const chooser = app.getByRole("dialog", { name: "List" });
  await chooser.getByRole("button", { name: "Top Rated", exact: true }).tap();
  await expect(chooser).toHaveCount(0);
  await expect(pills.nth(0)).toHaveText(/Top Rated/);
  await expect(section.locator(".ph-sect-grid .ph-poster").first()).toBeVisible();
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });

  test("a torrent source can't play here: no notice, the player says so, nothing is opened (#458)", async ({ app }) => {
    await playTorrentFilm(app);
    await expect(app.getByText("Torrent sources can't play on this device.").first()).toBeVisible({ timeout: 15_000 });
    await expect(app.getByRole("dialog", { name: "Torrent playback" })).toHaveCount(0);
    expect(await app.evaluate(() => (window as { __torrentOpens?: number }).__torrentOpens ?? 0)).toBe(0);
  });

  test("the back swipe on a settings page goes to the list; on the list it leaves Settings for the profiles (#455)", async ({ app }) => {
    const swipe = () =>
      app.evaluate(() => {
        const send = (window as unknown as { __polarFakeBackSwipe: (s: object) => void }).__polarFakeBackSwipe;
        const width = window.innerWidth;
        send({ phase: "begin", x: 4, width, velocity: 0 });
        send({ phase: "move", x: width * 0.6, width, velocity: 0 });
        send({ phase: "end", x: width * 0.6, width, velocity: 0 });
      });
    const settings = await openSettingsPage(app, "Add-ons");
    await expect(settings.locator(".t3s-header .t3s-ghost")).toHaveCount(0);
    await swipe();
    await expect(settings.getByRole("button", { name: "Add-ons", exact: true })).toBeVisible();
    await expect(settings).toHaveAccessibleName(/^Settings/);
    await swipe();
    await expect(settings).toHaveCount(0);
  });

  test("Subtitles & Audio opens the app's own panel, fitted to the phone, not an iOS menu (#465)", async ({ app }) => {
    await playFilm(app);
    await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
    const button = app.locator(".player").getByRole("button", { name: "Subtitles & Audio", exact: true });
    if (!(await button.isVisible())) await app.locator(".player").tap({ position: { x: 200, y: 300 } });
    await button.tap();
    const overlay = app.locator('.options-overlay[data-open="true"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".options-column").first()).toBeVisible();
    const width = app.viewportSize()!.width;
    for (const box of await overlay.locator(".options-column").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    expect(await fitsWidth(app)).toBe(true);
  });

  test("the phone shell's places are iOS's own tab bar, and its drawn bar steps aside", async ({ app }) => {
    // The fake shell stands in for iOS's bar (lib/platform/fake/tabBar.ts), built from what the app tells it.
    await expect(app.locator("html")).toHaveAttribute("data-native-tabs", "true");
    await expect(app.locator(".ph-bar")).toBeHidden();
    await expect(bar(app)).toHaveAttribute("data-fake-native", "");
    await expect(bar(app).getByRole("button")).toHaveText(["Home", "Search", "Anime", "My Polarity"]);
    await expect(bar(app).getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    await bar(app).getByRole("button", { name: "Search", exact: true }).tap();
    await expect(bar(app).getByRole("button", { name: "Search", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(app.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("a sheet opens at half the screen, expands and closes like iOS's own (#174)", async ({ app }) => {
    await serveAniList(app);
    await bar(app).getByRole("button", { name: "Anime", exact: true }).tap();
    await app.getByRole("button", { name: "Browse All", exact: true }).tap();
    await app.getByRole("button", { name: "Filters", exact: true }).tap();
    const sheet = app.locator(".sheet");
    await expect(sheet).toHaveAttribute("data-detent", "medium");
    const height = app.viewportSize()!.height;
    const top = async () => (await sheet.boundingBox())!.y;
    await expect.poll(top).toBeGreaterThan(height * 0.45);
    await expect.poll(top).toBeLessThan(height * 0.55);

    await sheet.getByRole("button", { name: "Expand" }).tap();
    await expect(sheet).toHaveAttribute("data-detent", "large");
    await expect.poll(top).toBeLessThan(height * 0.05);

    await sheet.getByRole("button", { name: "Collapse" }).tap();
    await expect(sheet).toHaveAttribute("data-detent", "medium");
    // Pushing the list up at half height brings the rest of it up.
    await sheet.locator(".sheet-body").evaluate((b) => {
      const touch = (y: number) => [new Touch({ identifier: 1, target: b, clientX: 100, clientY: y })];
      b.dispatchEvent(new TouchEvent("touchstart", { touches: touch(700), bubbles: true }));
      b.dispatchEvent(new TouchEvent("touchmove", { touches: touch(660), bubbles: true }));
    });
    await expect(sheet).toHaveAttribute("data-detent", "large");

    await expect.poll(top).toBeLessThan(height * 0.05);
    // Pulled down by its header from the top, past half: closed.
    const header = (await sheet.locator(".sheet-header").boundingBox())!;
    const x = header.x + header.width / 2;
    const y = header.y + header.height / 2;
    await app.mouse.move(x, y);
    await app.mouse.down();
    for (let i = 1; i <= 10; i++) await app.mouse.move(x, y + (height * 0.9 * i) / 10);
    await app.mouse.up();
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("on an iPhone, Back by swiping", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });

  const swipeBack = (app: Page) =>
    app.evaluate(() => {
      const send = (window as unknown as { __polarFakeBackSwipe: (s: object) => void }).__polarFakeBackSwipe;
      const width = window.innerWidth;
      send({ phase: "begin", x: 4, width, velocity: 0 });
      send({ phase: "move", x: width * 0.6, width, velocity: 0 });
      send({ phase: "end", x: width * 0.6, width, velocity: 0 });
    });

  test("the swipe in from the edge closes a title's sheet (#451)", async ({ app }) => {
    const sheet = await openTitle(app, "glass orchard", "The Glass Orchard");
    await swipeBack(app);
    await expect(sheet).toHaveCount(0);
    await expect(app.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  });

  test("over the Sources overlay the swipe closes it and leaves the title where it is (#451)", async ({ app }) => {
    const title = await openTitle(app, "glass orchard", "The Glass Orchard");
    await title.locator(".ps-actions").getByRole("button", { name: "Sources", exact: true }).tap();
    const overlay = app.locator(".ph-sources-overlay");
    await expect(overlay).toBeVisible();
    await swipeBack(app);
    await expect(overlay).toHaveCount(0);
    await expect(title).toBeVisible();
  });
});

test("on mobile data a torrent source doesn't start and says why, until the setting allows it (#207)", async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("polar.fakeTorrents", "1");
    (window as { polarDevice?: object }).polarDevice = { onMobileData: () => true, batterySaver: () => false };
  });
  await app.reload();
  const opens = () => app.evaluate(() => (window as { __torrentOpens?: number }).__torrentOpens ?? 0);

  // Every fake source is a torrent: each is passed over, the last says why, and nothing is opened.
  await playFilm(app);
  const status = app.locator(".player-status");
  await expect(status.getByRole("status")).toHaveText(/^Torrent sources don't play on mobile data\./);
  await expect(app.getByRole("dialog", { name: "Torrent playback" })).toHaveCount(0);
  expect(await opens()).toBe(0);

  await status.getByRole("button", { name: "Open Settings" }).tap();
  await expect(app.locator(".player")).toHaveCount(0);
  // A phone's Settings is its full-screen page, opened at the setting's page.
  const settings = app.locator(".t3s.fms-root");
  const allow = settings.getByRole("switch", { name: /^Play torrent streams on mobile data/ });
  await expect(allow).not.toBeChecked();
  await allow.tap();
  await expect(allow).toBeChecked();
  // Back to the list, then closed.
  await settings.getByRole("button", { name: "Back", exact: true }).tap();
  await settings.getByRole("button", { name: "Close settings", exact: true }).tap();
  await expect(settings).toHaveCount(0);

  // Allowed: the torrent goes on (to the one-time notice first), from the title's sheet still open.
  await app.getByRole("dialog", { name: "The Glass Orchard" }).getByRole("button", { name: "Play", exact: true }).tap();
  await expect(app.getByRole("dialog", { name: "Torrent playback" })).toBeVisible();
});

test("each tab's bar sits right under the status bar, its page right under it, with or without a notch (#450)", async ({ app }) => {
  for (const top of [0, 59]) {
    await insets(app, { top, right: 0, bottom: top ? 34 : 0, left: 0 });
    for (const [tab, first] of [
      ["Home", ".ph-chips"],
      ["My Polarity", ".ph-scroll > :not(.ph-tint)"],
    ] as const) {
      await bar(app).getByRole("button", { name: tab, exact: true }).tap();
      const page = app.locator(".ph-tab[data-active='true']");
      const content = page.locator(first).first();
      await expect(content).toBeVisible();
      const [row, box] = await Promise.all([page.locator(".ph-head-row").boundingBox(), content.boundingBox()]);
      // The bar's row begins where the status bar ends.
      expect(Math.round(row!.y), `${tab}, inset ${top}`).toBe(top);
      const gap = box!.y - (row!.y + row!.height);
      expect(gap, `${tab}, inset ${top}`).toBeGreaterThanOrEqual(-1);
      expect(gap, `${tab}, inset ${top}`).toBeLessThanOrEqual(12);
    }
  }
  // Anime with AniList not answering: its message stays clear of the bar too.
  await app.route("https://graphql.anilist.co/**", (route) => route.fulfill({ status: 503, body: "" }));
  await bar(app).getByRole("button", { name: "Anime", exact: true }).tap();
  const note = app.locator(".anime-unreachable");
  await expect(note).toBeVisible({ timeout: 15_000 });
  const barBottom = await app.locator(".ph-anime .ph-head").evaluate((e) => e.getBoundingClientRect().bottom);
  await expect.poll(() => note.evaluate((e) => e.getBoundingClientRect().top + parseFloat(getComputedStyle(e).paddingTop))).toBeGreaterThanOrEqual(barBottom);
});

test("the error screen on a phone keeps clear of the controls, and a panel opened over it covers it (#467)", async ({ app }) => {
  await app.goto("/fake.html?sources=filtered");
  await playFilm(app);
  const player = app.locator(".player");
  const status = player.locator('.player-status[data-failed="true"]');
  await expect(status).toBeVisible();
  // Held sideways, the shortest screen there is for it.
  await app.setViewportSize({ width: 915, height: 412 });
  await insets(app, { top: 0, right: 59, bottom: 21, left: 59 });
  // Nothing playing, the controls stay up: none of the error's buttons may sit under one of them.
  await expect(player).toHaveAttribute("data-chrome", "true");
  const overlaps = await app.evaluate(() => {
    const boxes = (sel: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.offsetParent).map((e) => ({ name: e.getAttribute("aria-label") ?? e.textContent?.trim(), r: e.getBoundingClientRect() }));
    const controls = boxes(".player :is(.player-top, .player-bottom) :is(button, input)");
    const mine = boxes(".player-status button");
    const meet = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return mine.flatMap((m) => controls.filter((c) => meet(m.r, c.r)).map((c) => `${m.name} under ${c.name}`));
  });
  expect(overlaps).toEqual([]);
  // A panel over the error frosts it: the error's text doesn't read through.
  await status.getByRole("button", { name: "Choose Another Source" }).tap();
  const shade = player.locator('.options-overlay[data-open="true"] .options-shade');
  await expect(shade).toBeVisible();
  expect(await shade.evaluate((e) => getComputedStyle(e).backdropFilter || getComputedStyle(e).getPropertyValue("-webkit-backdrop-filter"))).toContain("blur");
});
