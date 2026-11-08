import type { Page } from "@playwright/test";
import { expect, labelShowsWhole, partySurfaces, TALL_LABELS, test } from "./fixtures";
import { png } from "./media";
import { FRANCHISE, franchiseMedia, franchiseZip, longAnimeMedia, SHORT_ANIME } from "../src/lib/platform/fake/longAnime";

// TV mode at 1920×1080, driven only by the arrow keys, Enter and Backspace (a remote's Back).
test.use({ tv: true });

const focused = (page: Page) => page.locator(":focus");

async function press(page: Page, ...keys: string[]) {
  for (const key of keys) await page.keyboard.press(key);
}

/** Home's second row, third card: Quiet Machines' page. Waits for Home's first card to take the focus, or the keys walk the tabs. */
async function openQuietMachines(page: Page) {
  await expect(focused(page)).toHaveAccessibleName("The Understudies");
  await press(page, "ArrowDown", "ArrowRight", "ArrowRight", "Enter");
}

test("arrows move between cards and Back returns to the same card", async ({ app }) => {
  await expect(focused(app)).toHaveAccessibleName("The Understudies");
  await press(app, "ArrowDown");
  await expect(focused(app)).toHaveAccessibleName("Tidewater");
  await press(app, "ArrowRight", "ArrowRight");
  await expect(focused(app)).toHaveAccessibleName("Quiet Machines");

  await press(app, "Enter");
  await expect(app.getByRole("heading", { level: 1, name: "Quiet Machines" })).toBeVisible();
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");

  await press(app, "Backspace");
  await expect(focused(app)).toHaveAccessibleName("Quiet Machines");
  await expect(app.getByRole("heading", { level: 2, name: "Trending Now" })).toBeVisible();
});

test("an add-on's catalogs switched on are rails under Trending Now; one that fails leaves itself out (#206)", async ({ app }) => {
  await app.addInitScript(() =>
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), addonCatalogsHome: '{"on":["example.lists"],"order":[]}' })),
  );
  await app.reload();
  await expect(focused(app)).toHaveAccessibleName("The Understudies");
  await press(app, "ArrowDown", "ArrowDown");
  await expect(app.getByRole("heading", { level: 2, name: "Staff Picks · Example Lists" })).toBeVisible();
  await press(app, "ArrowDown");
  await expect(app.getByRole("heading", { level: 2, name: "Weekend Series · Example Lists" })).toBeVisible();
  await expect(app.getByRole("heading", { level: 2, name: "Late Night · Example Lists" })).toHaveCount(0);
  await press(app, "Enter");
  await expect(app.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the section tabs are reached from the top row", async ({ app }) => {
  await expect(focused(app)).toHaveAccessibleName("The Understudies");
  await press(app, "ArrowUp");
  await expect(focused(app)).toHaveAccessibleName("Home");
  await press(app, "ArrowRight", "ArrowRight", "Enter");
  await expect(focused(app)).toHaveAccessibleName("Movies");
  await press(app, "ArrowDown");
  await expect(focused(app)).toHaveClass(/tv-card/);
});

test("a title plays from the remote and Back leaves the player", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await press(app, "Backspace");
  await expect(app.locator(".player")).toHaveCount(0);
  await expect(app.getByRole("heading", { level: 1, name: "Quiet Machines" })).toBeVisible();
});

test("in a title's Sources, up and down move between the rows of filter chips (re-test 7)", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await app.getByRole("button", { name: "Choose Source" }).focus();
  await press(app, "Enter");
  const panel = app.getByRole("dialog", { name: "Sources" });
  await expect(panel).toBeVisible();
  const row = () => focused(app).evaluate((el) => el.closest(".srcf-chiprow")?.getAttribute("aria-label") ?? "list");
  await panel.getByRole("group", { name: "Quality" }).getByRole("button").first().focus();
  await press(app, "ArrowDown");
  expect(await row()).toBe("Add-on");
  await press(app, "ArrowUp");
  expect(await row()).toBe("Quality");
});

test("in the player's Sources, up and down move between the rows of filter chips (re-test 7)", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Sources", exact: true }).click();
  const head = app.locator(".options-column").filter({ has: app.locator(".srcf") });
  await head.getByRole("group", { name: "Quality" }).getByRole("button").first().focus();
  const row = () => focused(app).evaluate((el) => el.closest(".srcf-chiprow")?.getAttribute("aria-label") ?? "list");
  await press(app, "ArrowDown");
  expect(await row()).toBe("Add-on");
  await press(app, "ArrowUp");
  expect(await row()).toBe("Quality");
});

test("in TV mode's larger type, the player's season dropdown shows a name's descenders and accents whole (#353)", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Episodes", exact: true }).click();
  const value = app.locator('.select-trigger[data-size="large"] .select-value').filter({ visible: true }).first();
  await expect(value).toBeVisible();
  for (const name of TALL_LABELS) expect(await labelShowsWhole(value, name), name).toBe(true);
});

test("in the player, the remote walks the episode rail to the season's last episode (#226)", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Episodes", exact: true }).click();
  const rail = app.locator(".episode-rail");
  await expect(rail.locator('[aria-current="true"] > .episode-rail-main')).toBeFocused();
  const count = await rail.locator(".episode-rail-card").count();
  expect(count).toBeGreaterThan(5);
  for (let i = 1; i < count; i++) await press(app, "ArrowRight");
  await expect(rail.locator(".episode-rail-main").last()).toBeFocused();
  await expect
    .poll(() =>
      rail.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const c = el.lastElementChild!.getBoundingClientRect();
        return c.left >= r.left - 1 && c.right <= r.right + 1;
      }),
    )
    .toBe(true);
  // Up reaches the head: the season, then along it to the row/list switch.
  await press(app, "ArrowUp");
  await expect(focused(app)).toHaveClass(/select-trigger/);
  await press(app, "ArrowRight", "ArrowRight");
  await expect(focused(app)).toHaveAccessibleName("List");
  await press(app, "Enter");
  await expect(rail).toHaveCount(0);
  await expect(app.getByRole("radiogroup", { name: "Episodes" })).toBeVisible();
});

test("in a title's Sources, holding OK on a row opens its menu; Info shows the source, the remote scrolls it, Back returns to the row (#229)", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await app.getByRole("button", { name: "Choose Source" }).focus();
  await press(app, "Enter");
  const sources = app.getByRole("dialog", { name: "Sources" });
  await expect(sources).toBeVisible();
  const row = sources.locator(".stream-row").last();
  await row.focus();
  // A short press would play; held, OK opens the row's menu with Info first.
  await app.keyboard.down("Enter");
  await app.waitForTimeout(700);
  await app.keyboard.up("Enter");
  const menu = app.getByRole("menu", { name: "Source options" });
  await expect(menu).toBeVisible();
  await expect(focused(app)).toHaveAccessibleName("Info");
  await expect(app.locator(".player")).toHaveCount(0);
  await press(app, "Enter");

  const info = app.getByRole("dialog", { name: "Source Info" });
  const body = info.getByTestId("source-info-body");
  await expect(body).toBeFocused();
  await expect(info).toContainText("https://media.example/token/•••/4.mp4?apikey=•••");
  expect(await info.textContent()).not.toContain("TOKEN0000");
  await expect(info.getByRole("table").getByRole("rowheader", { name: "Total" })).toBeAttached();
  // Longer than the screen: down scrolls it.
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await press(app, "ArrowDown");
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await press(app, "Backspace");
  await expect(info).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();

  // The controller's options button opens the same menu; Back closes it onto the row.
  await press(app, "ContextMenu");
  await expect(menu).toBeVisible();
  await press(app, "Backspace");
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("in the player's Sources, holding OK on a row opens its menu, Info opens the panel and Back returns to the row (#229)", async ({ app }) => {
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Sources", exact: true }).click();
  const row = app.getByRole("radiogroup", { name: "Sources" }).locator(".options-item").last();
  await row.focus();
  await app.keyboard.down("Enter");
  await app.waitForTimeout(700);
  await app.keyboard.up("Enter");
  const menu = app.getByRole("menu", { name: "Source options" });
  await expect(menu).toBeVisible();
  await expect(focused(app)).toHaveAccessibleName("Info");
  await press(app, "ArrowDown");
  await expect(focused(app)).toHaveAccessibleName("Play This Source");
  await press(app, "ArrowUp", "Enter");
  const info = app.getByRole("dialog", { name: "Source Info" });
  await expect(info.getByTestId("source-info-body")).toBeFocused();
  expect(await info.textContent()).not.toContain("TOKEN0000");
  await press(app, "Backspace");
  await expect(info).toHaveCount(0);
  await expect(row).toBeFocused();
  // Still in the player, its Sources still open.
  await expect(app.locator(".player")).toHaveCount(1);
});

test("in the player's Sources, OK on a torrent row tries it, after one failed and for the failed one again (#393)", async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("polar.fakeTorrents", "1");
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), torrentNotice: false }));
  });
  await app.reload();
  const opens = () => app.evaluate(() => (window as { __torrentOpens?: number }).__torrentOpens ?? 0);
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  // The fake shell has no engine: each torrent fails.
  const choose = app.getByRole("button", { name: "Choose Another Source" });
  await expect(choose).toBeFocused();
  const rows = app.getByRole("radiogroup", { name: "Sources" }).locator(".options-item");
  for (const n of [1, 0]) {
    const before = await opens();
    await press(app, "Enter");
    await expect(rows.first()).toBeVisible();
    await rows.nth(n).focus();
    await press(app, "Enter");
    await expect.poll(opens).toBe(before + 1);
    await expect(choose).toBeFocused();
  }
});

test.describe("signed in, on a fresh profile", () => {
  test.use({ account: true });

  test("starting a watch party from the remote leaves one party panel up, with the focus in it (#247)", async ({ app }) => {
    await openQuietMachines(app);
    await expect(focused(app)).toHaveAccessibleName("Play First Episode");
    await press(app, "Enter");
    await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
    await app.getByRole("button", { name: "Watch Party", exact: true }).focus();
    await press(app, "Enter");
    await expect(partySurfaces(app)).toHaveCount(1);
    await app.getByRole("button", { name: "Start a Watch Party" }).focus();
    await press(app, "Enter");
    await expect(app.getByRole("button", { name: "End Party" })).toBeVisible();
    await expect(partySurfaces(app)).toHaveCount(1);
    // The remote carries on from inside the panel, not from nowhere.
    await expect(focused(app)).toHaveAccessibleName("Copy Invite");
  });
  test("Home's Friends row: friends in a party first; OK joins the party (#135)", async ({ app }) => {
    // Friends turned on (on another device, as far as TV is concerned): Home lists them.
    await app.goto("/fake.html?account=1&friends=1");
    const row = app.locator(".tv-rail").filter({ has: app.locator(".tv-rail-title", { hasText: "Friends" }) });
    await expect(row.locator(".tv-friend").first()).toContainText("Sam");
    await expect(row.locator(".tv-friend").first()).toContainText("In a watch party · Big Buck Bunny");
    await expect(row.locator(".tv-rail-title")).toContainText("1 friend request");
    await row.locator(".tv-friend").first().focus();
    await press(app, "Enter");
    await expect(row.locator(".tv-rail-title")).toContainText("Joining the watch party…");
  });
});

test("Downloads opens from the Library's rail and its titles open and close with the remote (#15)", async ({ app }) => {
  await app.goto("/fake.html?downloads=many");
  await press(app, "ArrowUp");
  await app.getByRole("button", { name: "Library", exact: true }).click();
  await app.getByRole("button", { name: "All Downloads" }).click();
  await expect(app.getByRole("heading", { level: 1, name: "Downloads" })).toBeVisible();
  // Down past the downloads still coming down (their menus stay shut) to the first titles.
  await press(app, "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown");
  await expect(focused(app)).toHaveAccessibleName(/^Low Water Station/);
  await expect(app.getByRole("menu")).toHaveCount(0);
  await press(app, "Enter");
  await expect(focused(app)).toHaveAttribute("aria-expanded", "true");
  // While the fold is still opening its buttons sit level with the next title, which lines up better and wins.
  const fold = app.locator(`[id="${await focused(app).getAttribute("aria-controls")}"]`);
  await expect.poll(() => fold.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await press(app, "ArrowDown");
  await expect(focused(app)).toHaveAccessibleName(/^Delete (Watched|All)/);
  await press(app, "ArrowUp", "Enter");
  await expect(focused(app)).toHaveAttribute("aria-expanded", "false");
  await press(app, "Backspace");
  await expect(focused(app)).toHaveAccessibleName("All Downloads");
});

test("signed out, the TV offers the phone first; denied, it says so and gets a new code (#133)", async ({ app }) => {
  await app.goto("/fake.html?account=signed-out");
  const phone = app.getByRole("button", { name: "Sign in with your phone" });
  await expect(app.locator(".auth-actions button").first()).toHaveAccessibleName("Sign in with your phone");
  await phone.focus();
  await press(app, "Enter");
  const code = app.locator(".auth-device-code");
  await expect(code).toHaveText(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const first = await code.textContent();
  await app.evaluate(() => (globalThis as unknown as { __polarFakeTv: { answer(a: boolean): void } }).__polarFakeTv.answer(false));
  await expect(app.getByText("The sign-in was denied on the other device.")).toBeVisible({ timeout: 10_000 });
  await app.getByRole("button", { name: "Get a new code" }).focus();
  await press(app, "Enter");
  await expect(code).toHaveText(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  expect(await code.textContent()).not.toBe(first);
});

test("when Settings' source filters leave out every source, the error screen opens TV's Sources settings (#435)", async ({ app }) => {
  await app.goto("/fake.html?sources=filtered");
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  const status = app.locator(".player-status");
  await expect(status).toContainText("Your source filters left out every source.");
  await status.getByRole("button", { name: "Open Settings" }).focus();
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveCount(0);
  await expect(app.locator(".tv-settings")).toContainText("Filters Hide Other Sources");
});

test("when no add-on was asked, the error screen opens Add-ons in desktop mode, which TV mode has no page for (#435)", async ({ app }) => {
  await app.goto("/fake.html?sources=none");
  await openQuietMachines(app);
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  const status = app.locator(".player-status");
  await status.getByRole("button", { name: "Open Add-ons" }).focus();
  await press(app, "Enter");
  await expect(app.locator(".tv-main")).toHaveCount(0);
  await expect(app.getByRole("dialog", { name: /^Settings/ }).getByRole("heading", { name: "Add-ons" }).first()).toBeVisible();
});

test("the Anime stage shows a later entry's franchise art and logo, as desktop does, never its own banner or name (#431)", async ({ app }) => {
  // The invented franchise's film (after its series) is the only card; its own banner differs from the series' art.
  const own = "https://art.example/banner/film.png";
  const fanart = "https://art.example/fanart/series.png";
  const logo = "https://art.example/clearlogo/series.png";
  const film = { ...franchiseMedia(FRANCHISE.film.anilist)!, bannerImage: own };
  const empty = { media: [], pageInfo: { hasNextPage: false } };
  await app.route("https://graphql.anilist.co/**", async (route) => {
    const body = route.request().postData() ?? "{}";
    const { query = "", variables } = JSON.parse(body) as { query?: string; variables?: { id?: number } };
    if (query.includes("trending:")) {
      const home = Object.fromEntries(["trending", "upcoming", "top", "popular", "movies"].map((k) => [k, empty]));
      return route.fulfill({ json: { data: { ...home, season: { media: [film], pageInfo: { hasNextPage: false } } } } });
    }
    const media = variables?.id === FRANCHISE.film.anilist ? film : franchiseMedia(variables?.id ?? 0);
    await route.fulfill({ json: { data: media ? { Media: media } : { Page: empty } } });
  });
  await app.route("https://api.ani.zip/**", (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get("anilist_id"));
    const zip = franchiseZip(id);
    if (!zip) return route.fulfill({ status: 404, json: {} });
    const images = id === FRANCHISE.show.anilist ? [{ coverType: "Fanart", url: fanart }, { coverType: "Clearlogo", url: logo }] : [];
    return route.fulfill({ json: { ...zip, images } });
  });
  // A dark backdrop, and a wide logo of white letters on clear ground.
  const dark = png(64, 36, () => [20, 24, 32, 255]);
  const letters = png(400, 100, (x, y) => (y > 25 && y < 75 && x % 40 < 28 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  await app.route("https://art.example/**", (route) =>
    route.fulfill({ body: route.request().url().includes("clearlogo") ? letters : dark, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }),
  );
  await app.getByRole("button", { name: "Anime", exact: true }).click();
  const stage = app.locator(".tv-stage");
  await expect(stage.locator(".tv-stage-art img").last()).toHaveAttribute("src", fanart);
  await expect(stage.locator(`img[src="${logo}"]`)).toBeVisible();
  await expect(stage.locator(`img[src="${own}"]`)).toHaveCount(0);
  await expect(stage.getByText(FRANCHISE.film.name, { exact: true })).toHaveCount(0);
});

test("a typed genre's rows come in desktop's order: its popular movies and series, its anime, then titles named like it (#338, #431)", async ({ app }) => {
  // AniList answers a genre or kind of show with an invented show, a title search with nothing.
  await app.route("https://graphql.anilist.co/**", async (route) => {
    const { variables } = JSON.parse(route.request().postData() ?? "{}") as { variables?: { genre?: string; tag?: string } };
    const media = variables?.genre || variables?.tag ? [longAnimeMedia(SHORT_ANIME)] : [];
    await route.fulfill({ json: { data: { Page: { media, pageInfo: { hasNextPage: false } } } } });
  });
  await app.getByRole("button", { name: "Search", exact: true }).click();
  await app.keyboard.type("Action");
  const titles = app.locator(".tv-search-results .tv-rail-title");
  await expect(titles.filter({ hasText: "Popular Action Anime" })).toBeVisible();
  const shown = (await titles.allTextContents()).map((t) => t.trim());
  expect(shown.slice(0, 3)).toEqual(["Popular Action Movies", "Popular Action Series", "Popular Action Anime"]);
});
