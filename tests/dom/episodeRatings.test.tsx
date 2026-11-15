import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { EpisodeRatings } from "../../src/components/title/EpisodeRatings";
import { EpisodeRatingsViews, smoothPath, spacedLabels } from "../../src/components/title/EpisodeRatingsViews";
import { ratingGrid } from "../../src/lib/library/episodeRatings";
import type { Video } from "../../src/lib/types";
import { TvDescription } from "../../src/tv/TvMore";
import { click, press, render } from "./render";

// The series page's Episode Ratings table, and TV's "More" under a cut-off description.
afterEach(() => (document.body.innerHTML = ""));

/** The chart asks for IMDb's ratings; here none come, so the episodes' own show. */
const queried = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
);

const ep = (season: number, episode: number, rating?: string, released?: string): Video => ({
  id: `tt0000000:${season}:${episode}`,
  title: `Made-up Episode ${episode}`,
  season,
  episode,
  rating,
  released,
});

const show = [
  ep(1, 1, "7.1"),
  ep(1, 2, "8.0"),
  ep(1, 3, "9.2"),
  ep(2, 1, "6.4"),
  ep(2, 2),
  ep(2, 3, "8.8"),
  ep(2, 4, "8.1", "2999-01-01T00:00:00Z"),
];

test("a table: seasons as columns, episodes as rows, the rating in each cell and the seasons' averages last", async () => {
  const { container } = await render(queried(<EpisodeRatings videos={show} onOpen={() => {}} />));
  const table = container.querySelector("table")!;
  expect(container.querySelector("h2")?.textContent).toBe("Episode Ratings");
  expect([...table.querySelectorAll("thead th[scope=col]")].map((th) => th.textContent)).toEqual(["Episode", "S1Season 1", "S2Season 2"]);
  const rows = [...table.querySelectorAll("tbody tr")];
  expect(rows.map((r) => r.querySelector("th[scope=row]")?.textContent)).toEqual(["E1Episode 1", "E2Episode 2", "E3Episode 3", "E4Episode 4"]);
  const cells = (r: Element) => [...r.querySelectorAll("td")].map((td) => td.textContent);
  expect(cells(rows[0])).toEqual(["7.1", "6.4"]);
  // Unrated: a dash; not out yet: a dot, said in words; a season without the episode: nothing.
  expect(cells(rows[1])).toEqual(["8.0", "–"]);
  expect(cells(rows[3])).toEqual(["", "·Season 2, episode 4, Made-up Episode 4, not out yet"]);
  expect(cells(table.querySelector("tfoot tr")!)).toEqual(["8.1", "7.8"]);
  const button = table.querySelector<HTMLButtonElement>("button[aria-label^='Season 2, episode 2, Made-up Episode 2, no rating']");
  expect(button).not.toBeNull();
  // The colour follows the rating (9.2 is Awesome), and the number is always written.
  expect(rows[2].querySelectorAll("td")[0].getAttribute("data-step")).toBe("5");
});

test("one Tab stop; up and down move through a season, left and right between seasons; a cell opens its episode", async () => {
  const opened: string[] = [];
  const { container } = await render(queried(<EpisodeRatings videos={show} onOpen={(v) => opened.push(v.id)} />));
  const stops = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.tabIndex === 0);
  expect(stops.length).toBe(1);
  await act(async () => stops[0].focus());
  await press("ArrowDown");
  expect(document.activeElement?.textContent).toBe("8.0");
  await press("End");
  expect(document.activeElement?.textContent).toBe("9.2");
  await press("ArrowRight");
  expect(document.activeElement?.textContent).toBe("8.8");
  // The next episode isn't out: nothing to move to.
  await press("ArrowDown");
  expect(document.activeElement?.textContent).toBe("8.8");
  expect((document.activeElement as HTMLButtonElement).tabIndex).toBe(0);
  await click(document.activeElement);
  expect(opened).toEqual(["tt0000000:2:3"]);
});

test("nothing when too few episodes are rated", async () => {
  const { container } = await render(queried(<EpisodeRatings videos={[ep(1, 1, "8"), ep(1, 2, "8"), ep(1, 3)]} onOpen={() => {}} />));
  expect(container.innerHTML).toBe("");
});

test("TV's More shows only when the description is cut off", async () => {
  const proto = HTMLElement.prototype;
  const height = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
  let full = 40;
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => full });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 40 });
  try {
    const opened: number[] = [];
    const short = await render(<TvDescription text="A made-up synopsis." onMore={() => opened.push(1)} />);
    expect(short.container.querySelector("button")).toBeNull();
    await short.unmount();

    full = 160;
    const long = await render(<TvDescription text="A made-up synopsis that runs on and on." onMore={() => opened.push(1)} />);
    await act(async () => {});
    const more = long.container.querySelector("button");
    expect(more?.textContent).toBe("More");
    await click(more);
    expect(opened).toEqual([1]);
  } finally {
    if (height) Object.defineProperty(proto, "scrollHeight", height);
    else delete (proto as unknown as Record<string, unknown>).scrollHeight;
    delete (proto as unknown as Record<string, unknown>).clientHeight;
  }
});

test("the dialog's views: Wrapped tiles, an Episode List per season, a Timeline of dots", async () => {
  const opened: string[] = [];
  const grid = ratingGrid(show, (v) => v.released === undefined);
  const { container } = await render(<EpisodeRatingsViews grid={grid} onOpen={(v) => opened.push(v.id)} />);
  const pick = (name: string) => click([...container.querySelectorAll<HTMLElement>("[role=radio], button")].find((b) => b.textContent === name)!);

  await pick("Wrapped");
  // Every episode that's out, rated or not.
  expect(container.querySelectorAll(".ratings-tile").length).toBe(6);
  await click(container.querySelector(".ratings-tile"));
  expect(opened).toEqual(["tt0000000:1:1"]);

  await pick("Episode List");
  // One season at a time, chosen from a menu that opens on the first.
  expect(container.querySelector(".ratings-list-head")?.textContent).toContain("Season 1");
  expect(container.querySelectorAll(".ratings-list-row").length).toBe(3);

  await pick("Timeline");
  expect(container.querySelectorAll(".ratings-timeline-mark").length).toBe(5);
  expect(container.querySelector(".ratings-timeline-trendline")).not.toBeNull();
});

test("the timeline's season numbers leave out any that would run into the last one drawn", () => {
  // Wide early seasons, then short late ones crowded together (a long show whose later seasons have few rated episodes).
  expect(spacedLabels([40, 120, 200, 210, 220, 240, 250, 290], 34)).toEqual([true, true, true, false, false, true, false, true]);
});

test("the timeline's curve never bulges past the points it joins", () => {
  const ys = [100, 40, 40, 100];
  const path = smoothPath([0, 10, 20, 30], ys);
  const nums = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const yValues = nums.filter((_, i) => i % 2 === 1);
  expect(Math.min(...yValues)).toBeGreaterThanOrEqual(40);
  expect(Math.max(...yValues)).toBeLessThanOrEqual(100);
});
