import type { Page } from "@playwright/test";
import { backPlace, barOverlaps, card, expect, labelShowsWhole, partySurfaces, TALL_LABELS, test } from "./fixtures";

// Phone width (Pixel 7: 412×915, touch). The same components as desktop in the phone layout (docs/ARCHITECTURE.md §4).

/** Nothing sticks out sideways: the page never scrolls horizontally. */
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the phone layout: tab bar at the bottom, no window buttons", async ({ app }) => {
  await expect(app.locator("html")).toHaveAttribute("data-form", "phone");
  await expect(app.locator("html")).toHaveAttribute("data-touch", "true");
  const tabs = app.getByRole("navigation", { name: "Primary" });
  const box = await tabs.boundingBox();
  const height = app.viewportSize()!.height;
  expect(box!.y + box!.height).toBeGreaterThan(height - 120);
  await expect(app.getByRole("button", { name: "Minimize" })).toHaveCount(0);
  // The shelves' paging paddles are a mouse thing: on touch they'd catch taps on the cards under them.
  await expect(app.locator(".row-paddle").first()).toBeHidden();
  expect(await fitsWidth(app)).toBe(true);
});

test("with the Calendar on, the tab bar keeps the five sections and the Calendar is a top bar button (#449)", async ({ app }) => {
  await app.goto("/fake.html?showCalendar=true");
  const tabs = app.getByRole("navigation", { name: "Primary" });
  await expect(tabs.getByRole("button", { name: "Library", exact: true })).toBeVisible();
  await expect(tabs.locator(".navbar-link:not([data-overflow])")).toHaveText(["Home", "Series", "Movies", "Anime", "Library"]);
  await expect(tabs.getByRole("button", { name: "Calendar", exact: true })).toHaveCount(0);
  await app.locator(".navbar-actions").getByRole("button", { name: "Calendar", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
});

test("tabs, a title page and the player by touch", async ({ app }) => {
  const tabs = app.getByRole("navigation", { name: "Primary" });
  await tabs.getByRole("button", { name: "Series", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Series" })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);

  await tabs.getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await expect(app.getByRole("heading", { level: 1, name: "The Glass Orchard" })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);

  const backOnPage = await backPlace(app, "navbar");
  await app.getByRole("button", { name: "Play", exact: true }).tap();
  const player = app.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  // The controls hide while it plays; a tap on the picture brings them back, a second one hides them.
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "true");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  // An Android phone's volume buttons set the volume: no slider, Mute still there (#179).
  await expect(player.getByRole("slider", { name: "Volume" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "Mute" })).toBeVisible();
  // Back is the title page's, in the same spot (#348).
  expect(await backPlace(app, "player")).toBe(backOnPage);
  await player.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(player).toHaveCount(0);
});

test("search on a phone is a page of its own: genres to start from, results as you type, Back to where you were", async ({ app }) => {
  await app.getByRole("button", { name: "Search", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(app.getByRole("button", { name: "Horror", exact: true })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
  await app.getByRole("searchbox", { name: "Search" }).fill("orchard");
  await expect(card(app, "Orchard House")).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
  await app.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Search" })).toHaveCount(0);
});

test("an add-on's catalogs switched on show as Home rows and fit a phone (#206)", async ({ app }) => {
  await app.addInitScript(() =>
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), addonCatalogsHome: '{"on":["example.lists"],"order":[]}' })),
  );
  await app.reload();
  const picks = app.locator('[data-addon-row="picks"]');
  await expect(picks.getByRole("button", { name: "Staff Picks · Example Lists" })).toBeVisible();
  await expect(picks.locator(".card")).toHaveCount(4);
  await picks.locator(".card").first().tap();
  await expect(app.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
});

test("a sideways swipe on the featured card steps through the titles", async ({ app }) => {
  const dots = app.getByRole("tablist", { name: "Featured" }).getByRole("tab");
  await expect(dots.first()).toHaveAttribute("aria-selected", "true");
  // The arrows give way to the swipe on a phone.
  await expect(app.getByRole("button", { name: "Next featured" })).toBeHidden();
  const swipe = (from: number, to: number) =>
    app.locator(".hero-card").evaluate(
      (el, [from, to]) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const at = (type: string, x: number) =>
          el.dispatchEvent(new PointerEvent(type, { pointerType: "touch", isPrimary: true, pointerId: 7, clientX: x, clientY: y, bubbles: true }));
        at("pointerdown", r.left + r.width * from);
        at("pointerup", r.left + r.width * to);
      },
      [from, to],
    );
  await swipe(0.8, 0.2);
  await expect(dots.nth(1)).toHaveAttribute("aria-selected", "true");
  await swipe(0.2, 0.8);
  await expect(dots.first()).toHaveAttribute("aria-selected", "true");
  // Still on Home: the swipe didn't open the title.
  await expect(app.getByRole("tablist", { name: "Featured" })).toBeVisible();
});

test("a title page's action row fits a phone", async ({ app }) => {
  const tabs = app.getByRole("navigation", { name: "Primary" });
  await tabs.getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Kingsbridge").tap();
  const download = app.locator(".detail-actions").getByRole("button").last();
  await expect(download).toBeVisible();
  const box = await download.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(app.viewportSize()!.width);
});

test("on touch, an episode's Sources and Download buttons are always there, in the quiet style (#79)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Fieldwork").tap();
  const ep = app.locator(".episode-card:has(.episode-card-main:not([disabled]))").first();
  await expect(ep).toBeVisible();
  for (const sel of [".episode-sources", ".episode-download"]) {
    await expect(ep.locator(sel)).toBeVisible();
    expect(await ep.locator(sel).evaluate((b) => getComputedStyle(b).opacity)).toBe("1");
  }
});

test("a phone has no TV mode (#141)", async ({ app }) => {
  await expect(app.getByRole("button", { name: "TV mode" })).toHaveCount(0);
});

test("the season picker keeps its own row on a phone (#151)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Kingsbridge").tap();
  const picker = app.locator(".seasons-picker");
  await expect(picker).toBeVisible();
  const box = await picker.boundingBox();
  // The whole bar's width, not squeezed beside Download Season and the layout switch.
  expect(box!.width).toBeGreaterThan(app.viewportSize()!.width * 0.8);
  expect(await fitsWidth(app)).toBe(true);
});

test("the season dropdown shows a name's descenders and accents whole (#353)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Kingsbridge").tap();
  const value = app.locator(".seasons-picker .select-value");
  await expect(value).toBeVisible();
  for (const name of TALL_LABELS) expect(await labelShowsWhole(value, name), name).toBe(true);
});

test("settings on a phone: the sections, then one section with a way back", async ({ app }) => {
  await app.getByRole("button", { name: /^Profile/ }).tap();
  // The profile menu is a sheet on a phone; Settings rises over it.
  const profiles = app.locator(".sheet");
  await profiles.getByRole("button", { name: "Settings" }).tap();
  // Not by name: on a phone the header shows only the open section, and that names the dialog ("Browsing").
  const settings = app.locator(".t3s");
  await expect(settings).toHaveAccessibleName(/^Settings/);
  const browsing = settings.getByRole("button", { name: "Browsing", exact: true });
  await expect(browsing).toBeVisible();
  await browsing.tap();
  await expect(settings.getByRole("switch", { name: /^Show the Calendar/ })).toBeVisible();
  await expect(settings).toHaveAccessibleName("Browsing");
  await expect(browsing).toBeHidden();
  await settings.getByRole("button", { name: "All settings" }).tap();
  await expect(browsing).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).tap();
  await expect(settings).toHaveCount(0);
  // Closing Settings leaves the profile sheet it rose over.
  await expect(profiles).toBeVisible();
});

/** Settings from the profile menu (iOS's own menu on an iPhone, picked through the fake shell), on the page `section`. */
async function openSettingsPage(app: Page, section: string, { iPhone = false } = {}) {
  if (iPhone) await app.evaluate(() => ((window as unknown as { __polarFakeDialogPick?: string }).__polarFakeDialogPick = "Settings"));
  await app.getByRole("button", { name: /^Profile/ }).tap();
  if (!iPhone) await app.locator(".sheet").getByRole("button", { name: "Settings" }).tap();
  const settings = app.locator(".t3s");
  await settings.getByRole("button", { name: section, exact: true }).tap();
  await expect(settings).toHaveAccessibleName(section);
  return settings;
}

test("a settings page on a phone: no arrow beside the X, and Back goes to the list, then closes (#455)", async ({ app }) => {
  const settings = await openSettingsPage(app, "Appearance");
  // Restore device defaults' arrow, alone and greyed, read as a Back that did nothing: not in a phone's header.
  await expect(settings.locator(".t3s-header .t3s-ghost")).toHaveCount(0);
  // Android's back button and gesture arrive as Escape (lib/ui/systemBack.ts).
  await app.keyboard.press("Escape");
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeVisible();
  await expect(settings).toHaveAccessibleName(/^Settings/);
  await app.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
});

test("an add-on's long name and description, unbroken words and a link among them, wrap inside Settings (#456)", async ({ app }) => {
  await app.goto("/fake.html?worst=1");
  await app.getByRole("button", { name: /^Profile/ }).tap();
  await app.locator(".sheet").getByRole("button", { name: "Settings" }).tap();
  const settings = app.locator(".t3s");
  await settings.getByRole("button", { name: "Add-ons", exact: true }).tap();
  const row = settings.getByRole("button", { name: /^Community Archive of Restored Public-Domain Cinema/ });
  await row.tap();
  const description = settings.getByText(/ExampleProvider1\/ExampleProvider2/);
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
    expect.soft(b.bottom, `${b.name} above the bottom inset`).toBeLessThanOrEqual(height - i.bottom);
    expect.soft(b.left, `${b.name} right of the left inset`).toBeGreaterThanOrEqual(i.left);
    expect.soft(b.right, `${b.name} left of the right inset`).toBeLessThanOrEqual(width - i.right);
  }
}

async function openPlayer(page: Page) {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(page, "The Glass Orchard").tap();
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  const player = page.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "true");
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

test("Back stays in the title page's spot in the player around the notch, upright and sideways (#348)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  const player = app.locator(".player");
  for (const [size, i] of [
    [{ width: 412, height: 915 }, { top: 59, right: 0, bottom: 34, left: 0 }],
    [{ width: 915, height: 412 }, { top: 0, right: 59, bottom: 21, left: 59 }],
  ] as const) {
    await app.setViewportSize(size);
    await insets(app, i);
    const onPage = await backPlace(app, "navbar");
    expect(Number(onPage.split(",")[0]), "clear of the cutout").toBeGreaterThanOrEqual(i.left);
    await app.getByRole("button", { name: "Play", exact: true }).tap();
    await expect(player).toHaveAttribute("data-started", "true");
    // The controls hide on their own first: a tap while they show would hide them.
    await expect(player).toHaveAttribute("data-chrome", "false");
    await player.tap({ position: { x: 200, y: 200 } });
    await expect(player).toHaveAttribute("data-chrome", "true");
    expect(await backPlace(app, "player"), `${size.width}×${size.height}`).toBe(onPage);
    await player.getByRole("button", { name: "Back", exact: true }).tap();
    await expect(player).toHaveCount(0);
  }
});

test("the trailer fits the screen at every phone width, upright and sideways, its controls inside the insets (#289)", async ({ app }) => {
  await app.getByRole("button", { name: "Search", exact: true }).tap();
  await app.getByRole("searchbox", { name: "Search" }).fill("lanterns");
  await card(app, "Paper Lanterns").tap();
  await app.getByRole("button", { name: "Trailer", exact: true }).tap();
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
    await openPlayer(app);
    await controlsClearOf(app, tablet);
  });
});

test("on a phone, a long press on a source opens its info; no i button shows (#229)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await app.getByRole("button", { name: "Choose source", exact: true }).tap();
  const row = app.locator(".sheet .stream-row").last();
  await expect(row).toBeVisible();
  await expect(app.locator(".sheet .stream-info").first()).toHaveCSS("opacity", "0");
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
  await expect(app.locator(".sheet")).toBeVisible();
});

test("a phone on its side: each player panel starts under its X, nothing under it (#464)", async ({ app }) => {
  await app.setViewportSize({ width: 915, height: 412 });
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await app.getByRole("button", { name: "Play", exact: true }).tap();
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  for (const name of ["Subtitles & Audio", "Sources"]) {
    const button = app.getByRole("button", { name, exact: true });
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
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await app.getByRole("button", { name: "Play", exact: true }).tap();
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  for (const [width, height] of [
    [412, 915],
    [915, 412],
  ]) {
    await app.setViewportSize({ width, height });
    const button = app.getByRole("button", { name: "Sources", exact: true });
    if (!(await button.isVisible())) await app.locator(".player").tap({ position: { x: width / 2, y: height / 2 } });
    await button.tap();
    const column = app.locator('.options-overlay[data-open="true"] .options-column');
    // The fake add-ons are two: the picker shows, as the issue asks.
    await expect(column.locator(".srcf-addon")).toBeVisible();
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
    await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Play", exact: true }).tap();
    await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
    await app.getByRole("button", { name: "Watch Party", exact: true }).tap();
    await expect(partySurfaces(app)).toHaveCount(1);
    await app.getByRole("button", { name: "Start a Watch Party" }).tap();
    await expect(app.getByRole("button", { name: "End Party" })).toBeVisible();
    await expect(partySurfaces(app)).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Copy Invite" })).toBeFocused();
  });
});

/** Movies → The Glass Orchard → Play, every source a made-up torrent. `nativeTabs`: iOS's own tab bar takes the tab. */
async function playTorrentFilm(app: Page, nativeTabs = false) {
  await app.addInitScript(() => localStorage.setItem("polar.fakeTorrents", "1"));
  await app.reload();
  if (nativeTabs) await app.evaluate(() => (window as unknown as { __polarFakeNativeTab: (id: string) => void }).__polarFakeNativeTab("discover:movie"));
  else await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await app.getByRole("button", { name: "Play", exact: true }).tap();
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

test.describe("on an iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });

  test("a torrent source can't play here: no notice, the player says so, nothing is opened (#458)", async ({ app }) => {
    await playTorrentFilm(app, true);
    await expect(app.getByText("Torrent sources can't play on this device.").first()).toBeVisible({ timeout: 15_000 });
    await expect(app.getByRole("dialog", { name: "Torrent playback" })).toHaveCount(0);
    expect(await app.evaluate(() => (window as { __torrentOpens?: number }).__torrentOpens ?? 0)).toBe(0);
  });

  test("the back swipe on a settings page goes to the list; on the list it closes Settings (#455)", async ({ app }) => {
    const swipe = () =>
      app.evaluate(() => {
        const send = (window as unknown as { __polarFakeBackSwipe: (s: object) => void }).__polarFakeBackSwipe;
        const width = window.innerWidth;
        send({ phase: "begin", x: 4, width, velocity: 0 });
        send({ phase: "move", x: width * 0.6, width, velocity: 0 });
        send({ phase: "end", x: width * 0.6, width, velocity: 0 });
      });
    const settings = await openSettingsPage(app, "Add-ons", { iPhone: true });
    await expect(settings.locator(".t3s-header .t3s-ghost")).toHaveCount(0);
    await swipe();
    await expect(settings.getByRole("button", { name: "Add-ons", exact: true })).toBeVisible();
    await expect(settings).toHaveAccessibleName(/^Settings/);
    await swipe();
    await expect(settings).toHaveCount(0);
  });

  test("Subtitles & Audio opens the app's own panel, fitted to the phone, not an iOS menu (#465)", async ({ app }) => {
    await app.evaluate(() => (window as unknown as { __polarFakeNativeTab: (id: string) => void }).__polarFakeNativeTab("discover:movie"));
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Play", exact: true }).tap();
    await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
    const button = app.getByRole("button", { name: "Subtitles & Audio", exact: true });
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

  test("five tabs in iOS's bar, no More; Search and the Calendar in the top bar; Back to the Library (#449)", async ({ app }) => {
    // The Calendar turned on (Settings → Browsing): it stays out of the bar, as a sixth tab is what makes iOS add More.
    await app.goto("/fake.html?showCalendar=true");
    const nativeTabs = () => app.evaluate(() => (window as { __nativeTabs?: { tabs: { id: string }[]; hidden: boolean } }).__nativeTabs);
    await expect(app.locator("html")).toHaveAttribute("data-native-tabs", "true");
    await expect.poll(async () => (await nativeTabs())?.tabs.map((t) => t.id)).toEqual(["home", "discover:series", "discover:movie", "anime", "library"]);
    expect((await nativeTabs())?.hidden).toBe(false);

    const header = app.locator(".navbar-actions");
    await header.getByRole("button", { name: "Calendar", exact: true }).tap();
    await expect(app.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page");
    await header.getByRole("button", { name: "Search", exact: true }).tap();
    await expect(app.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();

    // A title opened from the Library goes back to it with the swipe in from the left edge.
    await app.evaluate(() => (window as unknown as { __polarFakeNativeTab: (id: string) => void }).__polarFakeNativeTab("library"));
    await expect(app.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await card(app, "Low Water Station").tap();
    await expect(app.getByRole("heading", { level: 1, name: "Low Water Station" })).toBeVisible();
    // iOS's own edge swipe (#451), past half the width.
    await app.evaluate(() => {
      const send = (window as unknown as { __polarFakeBackSwipe: (s: object) => void }).__polarFakeBackSwipe;
      const width = window.innerWidth;
      send({ phase: "begin", x: 4, width, velocity: 0 });
      send({ phase: "move", x: width * 0.6, width, velocity: 0 });
      send({ phase: "end", x: width * 0.6, width, velocity: 0 });
    });
    await expect(app.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  });

  test("a sheet opens at half the screen, expands and closes like iOS's own (#174)", async ({ app }) => {
    await app.locator(".navbar-actions").getByRole("button", { name: "Search", exact: true }).tap();
    await app.getByRole("searchbox", { name: "Search" }).fill("glass orchard");
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Choose source", exact: true }).tap();
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

  test("a title page follows the finger off the page under it, and stays when let go early (#451)", async ({ app }) => {
    const swipe = (phase: string, x: number, velocity = 0) =>
      app.evaluate(([phase, x, velocity]) => {
        const send = (window as unknown as { __polarFakeBackSwipe: (s: object) => void }).__polarFakeBackSwipe;
        send({ phase, x, width: window.innerWidth, velocity });
      }, [phase, x, velocity] as const);
    const width = app.viewportSize()!.width;
    await app.evaluate(() => (window as unknown as { __polarFakeNativeTab: (id: string) => void }).__polarFakeNativeTab("discover:movie"));
    await card(app, "The Glass Orchard").tap();
    const title = app.getByRole("heading", { level: 1, name: "The Glass Orchard" });
    await expect(title).toBeVisible();
    const top = app.locator(".page[data-active='true']");
    const under = app.locator(".page[data-active='false']");
    const shift = (l: typeof top) => l.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);

    // Moving: the title page goes with the finger, Movies shows under it coming in from the left.
    await swipe("begin", 4);
    await swipe("move", 120);
    await expect(top).toHaveAttribute("data-drag", "top");
    await expect.poll(() => shift(top)).toBe(120);
    await expect(under).toHaveCSS("visibility", "visible");
    expect(await shift(under)).toBeLessThan(0);

    // Let go before half the width, slowly: both slide back and the title page stays.
    await swipe("end", 120);
    await expect(top).not.toHaveAttribute("data-drag", /./);
    expect(await shift(top)).toBe(0);
    await expect(under).toHaveCSS("visibility", "hidden");
    await expect(title).toBeVisible();

    // Past half: it slides out and Movies is the page, with no page change played over it.
    await swipe("begin", 4);
    await swipe("move", width * 0.6);
    await swipe("end", width * 0.6);
    await expect(app.locator(".page")).toHaveCount(1);
    await expect(app.locator(".page").first()).not.toHaveAttribute("data-motion", /./);
    expect(await shift(app.locator(".page").first())).toBe(0);
    await expect(app.getByRole("heading", { level: 1, name: "Movies" })).toBeVisible();
  });

  test("over a sheet the swipe closes the sheet and leaves the page where it is (#451)", async ({ app }) => {
    await app.evaluate(() => (window as unknown as { __polarFakeNativeTab: (id: string) => void }).__polarFakeNativeTab("discover:movie"));
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Choose source", exact: true }).tap();
    await expect(app.locator(".sheet")).toBeVisible();
    for (const [phase, x] of [["begin", 4], ["move", 260], ["end", 260]] as const)
      await app.evaluate(
        ([phase, x]) => (window as unknown as { __polarFakeBackSwipe: (s: object) => void }).__polarFakeBackSwipe({ phase, x, width: window.innerWidth, velocity: 0 }),
        [phase, x] as const,
      );
    await expect(app.locator(".sheet")).toHaveCount(0);
    await expect(app.locator(".page[data-drag]")).toHaveCount(0);
    await expect(app.getByRole("heading", { level: 1, name: "The Glass Orchard" })).toBeVisible();
  });
});

test("on mobile data a torrent source doesn't start and says why, until the setting allows it (#207)", async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("polar.fakeTorrents", "1");
    (window as { polarDevice?: object }).polarDevice = { onMobileData: () => true, batterySaver: () => false };
  });
  await app.reload();
  const opens = () => app.evaluate(() => (window as { __torrentOpens?: number }).__torrentOpens ?? 0);
  const play = async () => {
    await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Play", exact: true }).tap();
  };

  // Every fake source is a torrent: each is passed over, the last says why, and nothing is opened.
  await play();
  const status = app.locator(".player-status");
  await expect(status.getByRole("status")).toHaveText(/^Torrent sources don't play on mobile data\./);
  await expect(app.getByRole("dialog", { name: "Torrent playback" })).toHaveCount(0);
  expect(await opens()).toBe(0);

  await status.getByRole("button", { name: "Open Settings" }).tap();
  await expect(app.locator(".player")).toHaveCount(0);
  const settings = app.getByRole("dialog");
  const allow = settings.getByRole("switch", { name: /^Play torrent streams on mobile data/ });
  await expect(allow).not.toBeChecked();
  await allow.tap();
  await expect(allow).toBeChecked();
  await settings.getByRole("button", { name: "Close settings" }).tap();

  // Allowed: the torrent goes on (to the one-time notice first).
  await play();
  await expect(app.getByRole("dialog", { name: "Torrent playback" })).toBeVisible();
});

test("each page starts right under the top bar, which sits right under the status bar, with or without a notch (#450)", async ({ app }) => {
  const tabs = app.getByRole("navigation", { name: "Primary" });
  for (const top of [0, 59]) {
    await insets(app, { top, right: 0, bottom: top ? 34 : 0, left: 0 });
    for (const [tab, first] of [
      ["Home", ".hero-card"],
      ["Series", ".screen-header h1"],
      ["Library", ".screen-header h1"],
    ] as const) {
      await tabs.getByRole("button", { name: tab, exact: true }).tap();
      const content = app.locator(first).first();
      await expect(content).toBeVisible();
      const [bar, logo, page] = await Promise.all([
        app.locator(".navbar").boundingBox(),
        app.locator(".brand-logo").boundingBox(),
        content.boundingBox(),
      ]);
      // The bar's row begins where the status bar ends, the logo centred in it.
      expect(Math.round(logo!.y + logo!.height / 2), `${tab}, inset ${top}`).toBe(Math.round(top + (bar!.height - top) / 2));
      const gap = page!.y - (bar!.y + bar!.height);
      expect(gap, `${tab}, inset ${top}`).toBeGreaterThanOrEqual(0);
      expect(gap, `${tab}, inset ${top}`).toBeLessThanOrEqual(12);
    }
  }
  // Anime with AniList not answering: its message stays clear of the bar too.
  await app.route("https://graphql.anilist.co/**", (route) => route.fulfill({ status: 503, body: "" }));
  await tabs.getByRole("button", { name: "Anime", exact: true }).tap();
  const note = app.locator(".anime-unreachable");
  await expect(note).toBeVisible({ timeout: 15_000 });
  const barBottom = await app.locator(".navbar").evaluate((e) => e.getBoundingClientRect().bottom);
  // The text's own top, once the page has slid in.
  await expect.poll(() => note.evaluate((e) => e.getBoundingClientRect().top + parseFloat(getComputedStyle(e).paddingTop))).toBeGreaterThanOrEqual(barBottom);
});
