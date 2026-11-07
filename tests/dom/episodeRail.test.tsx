import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpisodeRail } from "../../src/components/player/EpisodeRail";
import type { Meta, Video } from "../../src/lib/types";
import { render } from "./render";

// #350: the player's rail opens an episode listed for the coming week, as the title page does (#167).
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const meta = { id: "tt0000000", type: "series", name: "The Lantern Keepers", runtime: "24 min" } as Meta;
const episodes = [
  { id: "tt0000000:1:1", title: "First Light", season: 1, episode: 1, released: day(-7) },
  { id: "tt0000000:1:2", title: "Low Tide", season: 1, episode: 2, released: day(3) },
  { id: "tt0000000:1:3", title: "The Long Night", season: 1, episode: 3, released: day(8) },
] as Video[];

test("an episode listed 3 days ahead opens from the rail and reads Airs; 8 days ahead stays Coming (#350)", async () => {
  const played: string[] = [];
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <EpisodeRail meta={meta} episodes={episodes} playing={episodes[0].id} progress={new Map()} still={() => undefined} onPlay={(id) => played.push(id)} />
    </QueryClientProvider>,
  );
  const cards = [...container.querySelectorAll(".episode-rail-card")];
  const main = (i: number) => cards[i].querySelector<HTMLButtonElement>(".episode-rail-main")!;
  const metaLine = (i: number) => cards[i].querySelector(".episode-rail-meta")?.textContent ?? "";

  expect(main(1).disabled).toBe(false);
  expect(metaLine(1)).toStartWith("Airs ");
  expect(cards[1].querySelector(".episode-rail-download")).not.toBeNull();
  expect(cards[1].querySelector(".episode-rail-play")).not.toBeNull();
  main(1).click();
  expect(played).toEqual([episodes[1].id]);

  expect(main(2).disabled).toBe(true);
  expect(metaLine(2)).toStartWith("Coming ");
  expect(cards[2].querySelector(".episode-rail-download")).toBeNull();
  expect(cards[2].querySelector(".episode-rail-play")).toBeNull();

  // A released one keeps its length on the date line.
  expect(metaLine(0)).not.toMatch(/^(Airs|Coming) /);
  await unmount();
});
