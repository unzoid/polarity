import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { inventedAnime, LONG_ANIME, longAnimeMedia, longAnimeZip, SHORT_ANIME } from "../src/lib/platform/fake/longAnime";

// Scrolling long pages (#134). Chromium only: these read Chromium's trace and layer tree (WebView2 is Chromium).
// Each budget sits well above what the page needs now and well below what it needed before the fix, so a
// slower runner doesn't trip it and the old problem would.

test.skip(({ browserName }) => browserName !== "chromium", "reads Chromium's trace and layer tree");

type TraceEvent = { name: string; ph: string; pid: number; tid: number; dur?: number; args?: { name?: string; data?: { url?: string } } };

/** The page's main thread while `run` runs: its share of the time busy, and how long each frame's main-thread part took. */
async function mainThread(cdp: CDPSession, run: () => Promise<void>) {
  const events: TraceEvent[] = [];
  const collect = (e: { value: unknown[] }) => void events.push(...(e.value as TraceEvent[]));
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,cc", transferMode: "ReportEvents" });
  const started = Date.now();
  await run();
  const ms = Date.now() - started;
  const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", collect);
  const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  const own = events.filter((e) => e.ph === "X" && e.pid === main?.pid && e.tid === main?.tid);
  // Playwright's own scripts (no URL) aren't the page's work.
  const harness = own.filter((e) => e.name === "EvaluateScript" && !e.args?.data?.url).reduce((a, e) => a + (e.dur ?? 0), 0);
  const busy = own.filter((e) => e.name === "RunTask").reduce((a, e) => a + (e.dur ?? 0), 0) - harness;
  const frames = own
    .filter((e) => e.name === "ProxyMain::BeginMainFrame")
    .map((e) => (e.dur ?? 0) / 1000)
    .sort((a, b) => a - b);
  return { busy: busy / 1000 / ms, medianFrame: frames[Math.floor(frames.length / 2)] ?? 0 };
}

/**
 * How long this machine takes to lay out a fixed block of a few thousand elements (ms): the same kind of
 * main-thread work a frame does. A slower runner takes longer for both, so per-frame budgets are set in
 * multiples of this instead of in milliseconds.
 */
async function layoutUnit(app: Page) {
  return app.evaluate(() => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;width:600px;visibility:hidden;contain:strict;height:400px";
    for (let i = 0; i < 3000; i++) {
      const s = document.createElement("span");
      s.textContent = `Calibration ${i}`;
      s.style.cssText = "display:inline-block;padding:2px 4px;margin:1px";
      box.append(s);
    }
    document.body.append(box);
    const runs: number[] = [];
    for (let r = 0; r < 9; r++) {
      const t = performance.now();
      box.style.width = `${600 + (r % 2) * 7}px`;
      void box.scrollHeight; // lay it out now
      runs.push(performance.now() - t);
    }
    box.remove();
    runs.sort((a, b) => a - b);
    return runs[Math.floor(runs.length / 2)];
  });
}

async function layerCount(app: Page, cdp: CDPSession) {
  let layers = 0;
  const seen = new Promise<void>((resolve) =>
    cdp.on("LayerTree.layerTreeDidChange", (e: { layers?: unknown[] }) => {
      if (e.layers) layers = e.layers.length;
      resolve();
    }),
  );
  await cdp.send("LayerTree.enable");
  await app.mouse.move(720, 120);
  await seen;
  await app.waitForTimeout(500);
  await cdp.send("LayerTree.disable");
  return layers;
}

test("Home stays light while it sits still and while it scrolls (#134)", async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1440, height: 900 });
  const cdp = await app.context().newCDPSession(app);
  await expect(app.locator(".row").first()).toBeVisible();
  await app.waitForTimeout(1500);

  // Loading shelves out of view hold their shimmer still.
  const offscreen = await app.evaluate(() => {
    const skeletons = [...document.querySelectorAll(".row[data-offscreen] .skeleton")];
    return { count: skeletons.length, running: skeletons.flatMap((s) => s.getAnimations()).filter((a) => a.playState === "running").length };
  });
  expect.soft(offscreen.count).toBeGreaterThan(0);
  expect.soft(offscreen.running).toBe(0);

  // Nothing moving: the main thread is free (it was busy two thirds of the time redrawing shimmers and the
  // carousel's dot).
  const idle = await mainThread(cdp, () => app.waitForTimeout(2500));
  expect.soft(idle.busy).toBeLessThan(0.15);

  // Every shelf loaded: a few dozen compositor layers, not a few hundred (each shelf's edge blurs were
  // eight layers, shown or not).
  await app.mouse.move(720, 500);
  for (let i = 0; i < 40; i++) {
    await app.mouse.wheel(0, 400);
    await app.waitForTimeout(40);
  }
  await app.waitForTimeout(1500);
  expect.soft(await layerCount(app, cdp)).toBeLessThan(150);

  // Scrolling back up the loaded page: each frame's main-thread part stays small. In units of this machine's
  // speed (layoutUnit), not milliseconds: on a shared CI runner the same page took 16.4 ms where it takes
  // 9.5 here. The median is about 3 units now and 8-10 before #134, also with the CPU throttled 2x. A frame
  // has a part that doesn't scale with layout speed: where a runner lays out fast (a unit under 2 ms), the
  // same 9-10 ms frame came to more than 5 units, so the budget never goes under 15 ms (#134's frames were
  // three times today's).
  await app.mouse.move(720, 500);
  const scrolling = await mainThread(cdp, async () => {
    for (let i = 0; i < 40; i++) {
      await app.mouse.wheel(0, -200);
      await app.waitForTimeout(30);
    }
  });
  const unit = await layoutUnit(app);
  const budget = Math.max(5 * unit, 15);
  expect.soft(scrolling.medianFrame, `median frame ${scrolling.medianFrame} ms, layout unit ${unit} ms, budget ${budget} ms`).toBeLessThan(budget);
});

/** The invented shows' AniList entries and ani.zip records (src/lib/platform/fake/longAnime.ts); the fake shell has their series. */
async function answerInventedAnime(app: Page) {
  await app.route("https://graphql.anilist.co/**", async (route) => {
    const { variables } = JSON.parse(route.request().postData() ?? "{}") as { variables?: { id?: number } };
    const show = inventedAnime(variables?.id ?? 0);
    await route.fulfill({ json: { data: show ? { Media: longAnimeMedia(show) } : { Page: { media: [], pageInfo: { hasNextPage: false } } } } });
  });
  await app.route("https://api.ani.zip/**", (route) => {
    const show = inventedAnime(Number(new URL(route.request().url()).searchParams.get("anilist_id")));
    return show ? route.fulfill({ json: longAnimeZip(show) }) : route.fulfill({ status: 404, json: {} });
  });
}

/**
 * Opens an anime's page through a polarity:// link: how long until its top (art, name, facts, buttons) is on
 * screen, then its first episode card, and until the main thread was last held up by a long task, all from the
 * link (ms); with the longest such task and how many episode cards the page holds.
 */
async function openAnime(app: Page, id: number) {
  return app.evaluate(
    (id) =>
      new Promise<{ top: number; episodes: number; settled: number; longest: number; cards: number }>((resolve) => {
        const tasks: { start: number; end: number }[] = [];
        const watch = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) tasks.push({ start: e.startTime, end: e.startTime + e.duration });
        });
        watch.observe({ type: "longtask" });
        const start = performance.now();
        // Pages opened before stay in the stack: this open's is the one more than there were.
        const pages = () => document.querySelectorAll(`.anime-detail[data-anime="${id}"]`);
        const before = pages().length;
        const page = () => (pages().length > before ? [...pages()].at(-1) : undefined);
        let top = 0;
        let episodes = 0;
        // Read in each frame before it's drawn: what's there is on screen once it is.
        const look = () => {
          const now = performance.now() - start;
          if (!top && page()?.querySelector(".anime-hero h1")) top = now;
          if (!episodes && page()?.querySelector(".seasons .episode-card")) episodes = now;
          if (!top || !episodes) return void requestAnimationFrame(look);
          // A second more for whatever the open set going.
          setTimeout(() => {
            watch.disconnect();
            const own = tasks.filter((t) => t.end > start).map((t) => ({ start: t.start - start, end: t.end - start }));
            resolve({
              top,
              episodes,
              settled: Math.max(episodes, ...own.map((t) => t.end)),
              longest: Math.max(0, ...own.map((t) => t.end - t.start)),
              cards: page()?.querySelectorAll(".episode-card").length ?? 0,
            });
          }, 1000);
        };
        requestAnimationFrame(look);
        (window as unknown as { __polarFakeDeepLink: (u: string) => void }).__polarFakeDeepLink(`polarity://anime/anilist/${id}`);
      }),
    id,
  );
}

test("an anime with 1,200 episodes opens as quickly as a short one (#397)", async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1440, height: 900 });
  await answerInventedAnime(app);
  await expect(app.locator(".row").first()).toBeVisible();
  await app.waitForTimeout(1000);

  // Each once first, so the page's code and the answers are loaded as they'd be after the first visit.
  await openAnime(app, SHORT_ANIME.anilist);
  await openAnime(app, LONG_ANIME.anilist);
  const short = await openAnime(app, SHORT_ANIME.anilist);
  const long = await openAnime(app, LONG_ANIME.anilist);
  const unit = await layoutUnit(app);
  const report = JSON.stringify({ short, long, unit });
  expect(short.cards, report).toBe(SHORT_ANIME.episodes);
  // Of the page of 100 episodes, only the cards on and near the screen are drawn.
  expect(long.cards, report).toBeGreaterThan(0);
  expect(long.cards, report).toBeLessThanOrEqual(40);
  // Its top, its episodes and a free main thread come about as soon as the short show's: here (the dev
  // server's React) 0.27 s against 0.25 s, where before #397 the long one took 9.7 s. The leeway is in units
  // of this machine's speed (layoutUnit), so a slower runner doesn't trip it.
  const leeway = Math.max(150, 40 * unit);
  expect(long.top, report).toBeLessThan(short.top + leeway);
  expect(long.episodes, report).toBeLessThan(short.episodes + leeway);
  expect(long.settled, report).toBeLessThan(short.settled + leeway);
  expect(long.top, report).toBeLessThan(2000);

  // The cards come as the row scrolls, up to the page's last one, and focus walks on past the first ones drawn.
  const page = app.locator(`.anime-detail[data-anime="${LONG_ANIME.anilist}"]`).last();
  const row = page.locator(".seasons .row-scroller");
  const last = page.locator(`.episode-card[data-video="${LONG_ANIME.imdb}:2:50"]`);
  for (let i = 0; i < 40 && !(await last.count()); i++) {
    await row.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: "instant" }));
    await app.waitForTimeout(50);
  }
  await expect(last).toBeVisible();
  await row.evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
  await page.locator(".episode-card-main").first().focus();
  for (let i = 0; i < 30; i++) await app.keyboard.press("Tab");
  await expect(page.locator(".seasons .row-scroller :focus")).toHaveCount(1);

  // As a list, every card of the page comes as the page scrolls down to it.
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByRole("button", { name: "Show all 100 episodes" }).click();
  expect(await page.locator(".episode-list .episode-card").count()).toBeLessThanOrEqual(40);
  const scroller = page.locator(".detail-scroll");
  for (let i = 0; i < 60 && !(await last.count()); i++) {
    await scroller.evaluate((el) => el.scrollBy({ top: el.clientHeight, behavior: "instant" }));
    await app.waitForTimeout(50);
  }
  await expect(last).toBeVisible();
  await page.getByRole("radio", { name: "Row" }).click();
});

test("a long show's page opens at the episode you're up to and stays there while its cards come (#397)", async ({ app }) => {
  await answerInventedAnime(app);
  // Halfway through episode 160: the second page of 100, its 60th card.
  await app.evaluate(
    (imdb) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("progress_save", {
        progress: { metaId: imdb, videoId: `${imdb}:4:10`, type: "series", name: "Lanternfield Chronicle", position: 600, duration: 1440, updatedAt: Date.now() },
      }),
    LONG_ANIME.imdb,
  );
  await expect(app.locator(".row").first()).toBeVisible();
  await app.evaluate((id) => (window as unknown as { __polarFakeDeepLink: (u: string) => void }).__polarFakeDeepLink(`polarity://anime/anilist/${id}`), LONG_ANIME.anilist);
  const page = app.locator(".anime-detail").last();
  const upNext = page.locator(`.episode-card[data-video="${LONG_ANIME.imdb}:4:10"]`);
  await expect(upNext).toBeVisible();
  await expect(page.getByRole("radio", { name: "101–200" }).or(page.getByRole("combobox", { name: "Episodes" }))).toBeVisible();
  // The cards around it are drawn in the meantime; the row stays on it.
  const inRow = () =>
    upNext.evaluate((card: HTMLElement) => {
      const row = card.closest<HTMLElement>(".row-scroller")!;
      return row.scrollLeft > 0 && card.offsetLeft >= row.scrollLeft && card.offsetLeft + card.offsetWidth <= row.scrollLeft + row.clientWidth + 1;
    });
  expect(await inRow()).toBe(true);
  await app.waitForTimeout(1000);
  expect(await inRow()).toBe(true);
  expect(await page.locator(".seasons .episode-card").count()).toBeLessThanOrEqual(40);
});
