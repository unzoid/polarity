import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TitleDetails } from "../../src/components/title/TitleDetails";
import { api } from "../../src/lib/api";
import { setSearchText } from "../../src/lib/catalog";
import { RouterProvider, useRouter, type Route } from "../../src/lib/router";
import type { Meta, MetaPreview, SearchResults } from "../../src/lib/types";
import { Discover } from "../../src/screens/Discover";
import { Search } from "../../src/screens/Search";
import { render } from "./render";

const settle = (ms = 240) => act(async () => new Promise((r) => setTimeout(r, ms)));

afterEach(() => {
  setSearchText("");
});

test("Search renders People hits, opens Person page on click, and handles errors with Retry", async () => {
  const results: SearchResults = {
    movies: [
      { id: "tt0000201", type: "movie", name: "Example Film", poster: "https://images.example.com/f.jpg", releaseInfo: "2024" },
    ],
    series: [],
    people: [
      { id: 42, name: "Ines Marchetti", knownFor: "Directing", photo: "https://images.example.com/p.jpg" },
    ],
  };
  let shouldFail = true;
  const searchSpy = spyOn(api, "search").mockImplementation(async () => {
    if (shouldFail) throw new Error("network down");
    return results;
  });
  const addonsSpy = spyOn(api, "addons").mockResolvedValue([]);
  let current: Route = { name: "search" };
  function SpyRoute() {
    current = useRouter().current;
    return null;
  }
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setSearchText("Ines");
    const view = await render(
      <QueryClientProvider client={qc}>
        <RouterProvider initial={[{ name: "search" }]}>
          <SpyRoute />
          <Search />
        </RouterProvider>
      </QueryClientProvider>,
    );
    await settle(260);
    // Error renders Retry instead of infinite shimmering skeletons.
    const retryBtn = [...view.container.querySelectorAll("button")].find((b) => b.textContent?.includes("Try Again"));
    expect(retryBtn).toBeDefined();

    // Retrying succeeds and shows the People row.
    shouldFail = false;
    await act(async () => retryBtn!.click());
    await settle(80);
    const personBtn = view.container.querySelector<HTMLButtonElement>(".search-person-card");
    expect(personBtn).not.toBeNull();
    expect(personBtn!.textContent).toContain("Ines Marchetti");
    await act(async () => personBtn!.click());
    expect(current).toEqual({ name: "person", id: 42, title: "Ines Marchetti" });
    await view.unmount();
  } finally {
    searchSpy.mockRestore();
    addonsSpy.mockRestore();
  }
});

test("TitleDetails makes genres navigate to Discover and writers navigate to Person", async () => {
  const ratingsSpy = spyOn(api, "ratings").mockResolvedValue({});
  const meta: Meta = {
    id: "tt0000301",
    type: "movie",
    name: "Example Film",
    genres: ["Sci-Fi", "Drama"],
    videos: [],
    details: { writers: ["Paul Achebe"] },
    crew: [{ name: "Paul Achebe", character: "Writer", tmdbId: 88 }],
  };
  let current: Route = { name: "detail", type: "movie", id: "tt0000301" };
  function SpyRoute() {
    current = useRouter().current;
    return null;
  }
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <RouterProvider initial={[{ name: "detail", type: "movie", id: "tt0000301" }]}>
          <SpyRoute />
          <TitleDetails meta={meta} />
        </RouterProvider>
      </QueryClientProvider>,
    );
    const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("button.name-link")];
    const scifiBtn = buttons.find((b) => b.textContent === "Sci-Fi");
    const writerBtn = buttons.find((b) => b.textContent === "Paul Achebe");
    expect(scifiBtn).toBeDefined();
    expect(writerBtn).toBeDefined();

    await act(async () => scifiBtn!.click());
    expect(current).toEqual({ name: "discover", type: "movie", genre: "Sci-Fi" });

    await act(async () => writerBtn!.click());
    expect(current).toEqual({ name: "person", id: 88, title: "Paul Achebe" });
    await view.unmount();
  } finally {
    ratingsSpy.mockRestore();
  }
});

test("Discover shows a helpful empty state with Reset Filters when zero titles match", async () => {
  const catalogSpy = spyOn(api, "catalog").mockResolvedValue([] as MetaPreview[]);
  const addonsSpy = spyOn(api, "addons").mockResolvedValue([]);
  const continueSpy = spyOn(api, "continueWatching").mockResolvedValue([]);
  const historySpy = spyOn(api, "watchHistory").mockResolvedValue([]);
  const librarySpy = spyOn(api, "library").mockResolvedValue([]);
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <RouterProvider initial={[{ name: "discover", type: "movie", genre: "Western" }]}>
          <Discover type="movie" genre="Western" />
        </RouterProvider>
      </QueryClientProvider>,
    );
    await settle(80);
    expect(view.container.textContent).toContain("No titles match these filters.");
    const resetBtn = [...view.container.querySelectorAll("button")].find((b) => b.textContent?.includes("Reset Filters"));
    expect(resetBtn).toBeDefined();
    await view.unmount();
  } finally {
    catalogSpy.mockRestore();
    addonsSpy.mockRestore();
    continueSpy.mockRestore();
    historySpy.mockRestore();
    librarySpy.mockRestore();
  }
});
