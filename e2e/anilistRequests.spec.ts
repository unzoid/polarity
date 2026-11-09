import { expect, test } from "./fixtures";
import { entryId, LONG, serveAniList } from "./anilistMock";

/** Waits until AniList has had no request for `quiet` ms (at most 40 s); how many came in all. */
async function settle(app: import("@playwright/test").Page, count: () => number, quiet = 3000) {
  let last = -1;
  let since = Date.now();
  const end = Date.now() + 40_000;
  while (Date.now() < end) {
    const n = count();
    if (n !== last) [last, since] = [n, Date.now()];
    else if (Date.now() - since >= quiet) break;
    await app.waitForTimeout(250);
  }
  return count();
}

const openAnime = (app: import("@playwright/test").Page, id: number) =>
  app.evaluate((id) => (window as unknown as { __polarFakeDeepLink: (u: string) => void }).__polarFakeDeepLink(`polarity://anime/anilist/${id}`), id);

test("the Anime tab and a long franchise's page ask AniList little, and nothing again after a restart (#430)", async ({ app }) => {
  test.setTimeout(240_000);
  const anilist = await serveAniList(app);
  await app.route("https://api.ani.zip/**", (route) => route.fulfill({ status: 404, json: {} }));
  const nav = app.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Anime", exact: true }).click();
  await expect(app.locator(".anime-home, .anime-page, main").first()).toBeVisible();
  await settle(app, anilist.count);
  // Down the whole tab, as someone looking through it: each row asks as it comes near.
  for (let i = 0; i < 12; i++) {
    await app.mouse.wheel(0, 700);
    await app.waitForTimeout(300);
  }
  const tab = await settle(app, anilist.count);
  anilist.reset();
  await openAnime(app, entryId(LONG, 4));
  await expect(app.locator(`.anime-detail[data-anime="${entryId(LONG, 4)}"]`).last()).toBeVisible({ timeout: 20_000 });
  const page = await settle(app, anilist.count);
  // The whole franchise was walked: its seasons are tabs, none still loading.
  await expect(app.locator(".seasons-tabs").last()).toBeVisible();
  await expect(app.locator(".seasons-loading")).toHaveCount(0);
  anilist.reset();
  // A restart: the same visits again.
  await app.reload();
  await nav.getByRole("button", { name: "Anime", exact: true }).click();
  const tabAgain = await settle(app, anilist.count);
  anilist.reset();
  await openAnime(app, entryId(LONG, 4));
  await expect(app.locator(`.anime-detail[data-anime="${entryId(LONG, 4)}"]`).last()).toBeVisible({ timeout: 20_000 });
  const pageAgain = await settle(app, anilist.count);
  console.log("ANILIST REQUESTS", JSON.stringify({ tab, page, tabAgain, pageAgain }));
  // Before #430: 14, 5, 7 and 2 (the banner's entries and their franchises one request each, links not kept).
  expect(tab).toBeLessThanOrEqual(9);
  expect(page).toBeLessThanOrEqual(4);
  expect(tabAgain).toBe(0);
  expect(pageAgain).toBe(0);
});
