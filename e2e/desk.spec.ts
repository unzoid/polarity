import { expect, test, wakeControls } from "./fixtures";

/** The Netflix-style layout on a computer (src/desk): the web app's bar along the top, titles as a dialog over the page. */
test.use({ desk: true });

const sections = (app: import("@playwright/test").Page) => app.getByRole("navigation", { name: "Sections" });

test("Home has the bar's sections, the featured card and no classic navbar", async ({ app }) => {
  await expect(sections(app).getByRole("button")).toHaveText(["Home", "Shows", "Movies", "Anime", "Library"]);
  await expect(sections(app).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(app.getByRole("button", { name: "Polarity, Home" })).toBeVisible();
  await expect(app.locator(".dk-billboard")).toBeVisible();
  await expect(app.locator(".navbar")).toHaveCount(0);
});

test("a poster opens its title as a dialog over Home, and Escape closes it", async ({ app }) => {
  const poster = app.locator(".dk-row-slot .dk-poster").first();
  await poster.waitFor();
  const name = await poster.getAttribute("aria-label");
  await poster.click();
  const dialog = app.getByRole("dialog", { name: name! });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: name!, level: 1 })).toBeVisible();
  await expect(dialog.getByRole("tablist", { name: "More about this title" })).toBeVisible();
  await expect(app.locator(".dk-tab-page[data-active='true']")).toHaveCount(0);
  // The page stays drawn under the dialog, for its blur to show.
  await expect(app.locator(".dk-tab-page[data-shown='true'] .dk-billboard")).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(app.locator(".dk-layer")).toHaveCount(0);
  await expect(app.locator(".dk-tab-page[data-active='true']")).toHaveCount(1);
});

test("Shows narrows Home, Genres picks a genre, and ✕ goes back to all shows", async ({ app }) => {
  await sections(app).getByRole("button", { name: "Shows" }).click();
  await expect(sections(app).getByRole("button", { name: "Shows" })).toHaveAttribute("aria-current", "page");
  await expect(app.locator(".dk-head-name")).toHaveText("Shows");
  await app.locator(".dk-head-genres").click();
  await app.getByRole("dialog", { name: "Categories" }).getByRole("button", { name: "Drama", exact: true }).click();
  await expect(app.locator(".dk-head-genres")).toHaveText("Drama");
  await app.getByRole("button", { name: "All Shows" }).click();
  await expect(app.locator(".dk-head-genres")).toHaveText("Genres");
});

test("the bar's search opens into a field, shows results as posters, and closing it goes Home", async ({ app }) => {
  await app.getByRole("button", { name: "Search", exact: true }).click();
  const field = app.getByRole("searchbox", { name: "Search" });
  await expect(field).toBeFocused();
  await field.fill("the");
  await expect(app.locator(".dk-search .dk-grid .dk-poster").first()).toBeVisible();
  await app.getByRole("button", { name: "Close search" }).click();
  await expect(sections(app).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
});

test("Library has Downloads and what you're watching, without a duplicate profile button", async ({ app }) => {
  await sections(app).getByRole("button", { name: "Library" }).click();
  await expect(app.locator(".dk-my").getByText("Continue Watching")).toBeVisible();
  await expect(app.locator(".dk-my-dl")).toContainText("Downloads");
  await expect(app.locator(".dk-my .dk-my-head")).toHaveCount(0);
});

test("the avatar opens Profiles under it, and playing hides the page under the player", async ({ app }) => {
  await app.locator(".dk-nav").getByRole("button", { name: "Profiles" }).click();
  const profiles = app.getByRole("dialog", { name: "Profiles" });
  await expect(profiles.getByRole("button", { name: "App Settings" })).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(profiles).toBeHidden();
  await app.locator(".dk-cw").first().hover();
  await app.locator(".dk-cw-play-btn").first().click();
  await expect(app.locator(".dk-main")).toBeHidden();
  // mpv draws under the page: with it playing, nothing of the desk app may paint a background over it.
  const painted = await app.evaluate(() => {
    document.documentElement.dataset.player = "mpv";
    const clear = (el: Element | null) => !el || getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)";
    const out = [document.documentElement, document.body, document.querySelector(".dk")].filter((el) => !clear(el)).map((el) => el!.tagName + "." + (el as HTMLElement).className);
    delete document.documentElement.dataset.player;
    return out;
  });
  expect(painted).toEqual([]);
});

test("desk player uses Netflix chrome and edge sheets (Episodes, Audio & Subtitles, Speed, Sources, Sleep Timer)", async ({ app }) => {
  // Open a series from Continue Watching (or Shows) and start playback.
  await sections(app).getByRole("button", { name: "Shows" }).click();
  const poster = app.locator(".dk-row-slot .dk-poster").first();
  await poster.waitFor();
  await poster.click();
  const dialog = app.locator(".dk-dlg-frame").first();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^(Play|Resume)/ }).first().click();

  const player = app.locator(".player[data-desk-player='true']");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("data-started", "true");
  await wakeControls(app);

  // Main HUD: top-left close + title, top-right Full Screen, centered bottom actions with Crop.
  await expect(player.locator(".dk-pl-top .dk-pl-close")).toBeVisible();
  await expect(player.locator(".dk-pl-top .dk-pl-title")).toBeVisible();
  await expect(player.locator(".dk-pl-top").getByRole("button", { name: /^(Exit )?Full Screen$/ })).toBeVisible();
  await expect(player.locator(".dk-pl-bottom .dk-pl-actions")).toBeVisible();
  await expect(player.locator(".dk-pl-actions").getByRole("button", { name: /^Crop/ })).toBeVisible();

  // Playback Speed: compact bottom sheet with slider and Normal under 1x.
  await player.locator(".dk-pl-actions").getByRole("button", { name: /^Speed/ }).click();
  const speedSheet = player.getByRole("dialog", { name: "Playback Speed" });
  await expect(speedSheet).toBeVisible();
  await expect(speedSheet.getByRole("slider", { name: "Playback speed" })).toBeVisible();
  await speedSheet.getByRole("radio", { name: "1.25x" }).click();
  await app.keyboard.press("Escape");
  await expect(speedSheet).toBeHidden();
  await expect(player.locator(".dk-pl-actions").getByRole("button", { name: "Speed (1.25x)" })).toBeVisible();

  // Audio & Subtitles: top sheet with bottom controls still visible underneath, and Style inside the same sheet (no duplicate SubtitlePreview).
  await player.locator(".dk-pl-actions").getByRole("button", { name: "Audio & Subtitles" }).click();
  const tracksSheet = player.getByRole("dialog", { name: "Audio & Subtitles" });
  await expect(tracksSheet).toBeVisible();
  await expect(player.locator(".dk-pl-bottom")).toHaveCSS("opacity", "1");
  await tracksSheet.getByRole("button", { name: "Subtitle settings" }).click();
  await expect(tracksSheet.locator(".dk-pl-style")).toBeVisible();
  await expect(tracksSheet.getByRole("radiogroup", { name: "Outline", exact: true })).toBeVisible();
  await expect(player.locator(".sub-preview")).toHaveCount(0);
  await app.keyboard.press("Escape");
  await expect(tracksSheet).toBeHidden();

  // Episodes: right drawer with Netflix season pill & episode list, main HUD visible on left, play icon hidden until hover.
  await player.locator(".dk-pl-actions").getByRole("button", { name: "Episodes" }).click();
  const epSheet = player.getByRole("dialog", { name: "Episodes" });
  await expect(epSheet).toBeVisible();
  await expect(epSheet.locator(".dk-pl-ep-item").first()).toBeVisible();
  await expect(epSheet.locator(".dk-pl-ep-play").first()).toHaveCSS("opacity", "0");
  await app.keyboard.press("Escape");
  await expect(epSheet).toBeHidden();

  // Sources: right drawer with dark rows.
  await player.locator(".dk-pl-actions").getByRole("button", { name: "Sources" }).click();
  const srcSheet = player.getByRole("dialog", { name: "Sources" });
  await expect(srcSheet).toBeVisible();
  await expect(srcSheet.locator(".dk-pl-src-row").first()).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(srcSheet).toBeHidden();

  // Sleep Timer: right drawer with checkmark choices.
  await player.locator(".dk-pl-top").getByRole("button", { name: "Sleep Timer" }).click();
  const sleepSheet = player.getByRole("dialog", { name: "Sleep Timer" });
  await expect(sleepSheet).toBeVisible();
  await sleepSheet.getByRole("radio", { name: "15 minutes" }).click();
  await expect(sleepSheet).toBeHidden();
  await expect(player.getByRole("timer")).toBeVisible();

  // Back exits player cleanly.
  await player.locator(".dk-pl-top .dk-pl-close").click();
  await expect(player).toHaveCount(0);
});

test("Downloads uses clean desk layout, Library card has balanced width, and switching to Home from Downloads resets stage", async ({ app }) => {
  await sections(app).getByRole("button", { name: "Library" }).click();
  const dlCard = app.locator(".dk-my-dl");
  await expect(dlCard).toBeVisible();
  const vp = app.viewportSize()!;
  const cardBox = await dlCard.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.width).toBeGreaterThan(vp.width * 0.75);

  await dlCard.click();
  const dlPage = app.locator(".dk-dl-page");
  await expect(dlPage).toBeVisible();
  await expect(dlPage.getByRole("heading", { name: "Downloads", level: 1 })).toHaveCount(1);
  // No duplicate classic Library back button inside DeskDownloads.
  await expect(dlPage.getByRole("button", { name: "Library" })).toHaveCount(0);
  // Pushed Downloads page covers behind the navbar (no Home backdrop bleeding through) and clears tab active highlights.
  const pushedBox = await app.locator(".dk-pushed").boundingBox();
  expect(pushedBox).not.toBeNull();
  expect(pushedBox!.y).toBe(0);
  await expect(sections(app).locator("[aria-current='page']")).toHaveCount(0);

  // Clicking Home in the top nav while inside Downloads must cleanly reset .dk-stage (no stuck -12% slide).
  await sections(app).getByRole("button", { name: "Home" }).click();
  await expect(dlPage).toHaveCount(0);
  await expect(sections(app).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  const stageBox = await app.locator(".dk-stage").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(Math.abs(stageBox!.x)).toBeLessThan(1);
  await expect(app.locator(".dk-stage")).toHaveCSS("opacity", "1");
});

test("season picker opens as an anchored dropdown with episode counts when fewer than 10 seasons", async ({ app }) => {
  await sections(app).getByRole("button", { name: "Shows" }).click();
  await expect(app.locator(".dk-head-name")).toHaveText("Shows");
  const poster = app.locator(".dk-row-slot .dk-poster").first();
  await poster.waitFor();
  await poster.click();
  const dialog = app.locator(".dk-dlg-frame").first();
  await expect(dialog).toBeVisible();
  const seasonBtn = dialog.locator(".dk-season").first();
  await expect(seasonBtn).toBeVisible();
  await expect(seasonBtn).toHaveAttribute("aria-haspopup", "listbox");
  await seasonBtn.click();
  const list = app.getByRole("listbox", { name: "Seasons" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option").first()).toContainText(/Episode/);
  await app.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await app.keyboard.press("Escape");
});

test("desk profile handoff target resolves to visible .dk-profile-btn avatar", async ({ app }) => {
  const target = await app.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".dk-profile-btn .avatar, .navbar-profile .avatar, .tv-nav-me .avatar")];
    const match = els.find(
      (el) => !el.closest("[inert], .dk-profile-legacy") && !el.parentElement?.closest("[aria-hidden='true']") && el.getBoundingClientRect().width > 0,
    );
    if (!match) return null;
    const r = match.getBoundingClientRect();
    return { cls: match.parentElement?.className ?? "", w: r.width, h: r.height };
  });
  expect(target).not.toBeNull();
  expect(target!.cls).toContain("dk-profile-btn");
  expect(target!.w).toBeGreaterThan(20);
});
