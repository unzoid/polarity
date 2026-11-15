import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { EpisodeRatings } from "../../src/components/title/EpisodeRatings";
import type { Video } from "../../src/lib/types";
import { TvDescription } from "../../src/tv/TvMore";
import { click, press, render } from "./render";

// The series page's Episode Ratings table, and TV's "More" under a cut-off description.
afterEach(() => (document.body.innerHTML = ""));

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

test("a table: seasons as row headers, episodes as column headers, the rating in each cell and the season average", async () => {
  const { container } = await render(<EpisodeRatings videos={show} onOpen={() => {}} />);
  const table = container.querySelector("table")!;
  expect(container.querySelector("h2")?.textContent).toBe("Episode Ratings");
  const rows = [...table.querySelectorAll("tbody tr")];
  expect(rows.map((r) => r.querySelector("th[scope=row]")?.textContent)).toEqual(["S1Season 1", "S2Season 2"]);
  expect(table.querySelectorAll("thead th[scope=col]").length).toBe(1 + 4 + 1);
  const cells = (r: Element) => [...r.querySelectorAll("td")].map((td) => td.textContent);
  expect(cells(rows[0])).toEqual(["7.1", "8.0", "9.2", "", "8.1"]);
  // Unrated: a dash; not out yet: a dot, said in words.
  expect(cells(rows[1])).toEqual(["6.4", "–", "8.8", "·Episode 4, Made-up Episode 4, not out yet", "7.8"]);
  const button = table.querySelector<HTMLButtonElement>("button[aria-label^='Episode 2, Made-up Episode 2, no rating']");
  expect(button).not.toBeNull();
  // The tint follows the rating, and the number is always written.
  expect(rows[0].querySelectorAll("td")[2].getAttribute("data-step")).toBe("7");
});

test("one Tab stop; arrows move between cells, skipping what isn't out; a cell opens its episode", async () => {
  const opened: string[] = [];
  const { container } = await render(<EpisodeRatings videos={show} onOpen={(v) => opened.push(v.id)} />);
  const stops = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.tabIndex === 0);
  expect(stops.length).toBe(1);
  await act(async () => stops[0].focus());
  await press("ArrowRight");
  expect(document.activeElement?.textContent).toBe("8.0");
  await press("End");
  expect(document.activeElement?.textContent).toBe("9.2");
  await press("ArrowDown");
  expect(document.activeElement?.textContent).toBe("8.8");
  await press("ArrowRight");
  expect(document.activeElement?.textContent).toBe("8.8");
  expect((document.activeElement as HTMLButtonElement).tabIndex).toBe(0);
  await click(document.activeElement);
  expect(opened).toEqual(["tt0000000:2:3"]);
});

test("nothing when too few episodes are rated", async () => {
  const { container } = await render(<EpisodeRatings videos={[ep(1, 1, "8"), ep(1, 2, "8"), ep(1, 3)]} onOpen={() => {}} />);
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
