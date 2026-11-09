import { expect, test } from "bun:test";
import { backHistory, MAX_NATIVE_TABS, nativeTabsState, routeTitle, tabId, tabRoute, type NavLink } from "../src/lib/navTabs";
import type { Entry, Route } from "../src/lib/router";

const LINKS: NavLink[] = [
  { route: { name: "home" }, label: "Home" },
  { route: { name: "discover", type: "series" }, label: "Series" },
  { route: { name: "discover", type: "movie" }, label: "Movies" },
  { route: { name: "library" }, label: "Library" },
];

const stack = (...routes: Route[]): Entry[] => routes.map((route, key) => ({ key, route }));

test("each section has its own id, Movies and Series apart", () => {
  expect(LINKS.map((l) => tabId(l.route))).toEqual(["home", "discover:series", "discover:movie", "library"]);
});

test("the tabs carry their titles and SF Symbols", () => {
  const { tabs } = nativeTabsState(LINKS, stack({ name: "home" }), false);
  expect(tabs[0]).toEqual({ id: "home", title: "Home", icon: "house" });
  expect(tabs.map((t) => t.icon)).toEqual(["house", "tv", "film", "books.vertical"]);
});

test("the current tab is the stack's root, also under pushed pages and from a shelf's heading", () => {
  const detail: Route = { name: "detail", type: "movie", id: "tt0000000" };
  expect(nativeTabsState(LINKS, stack({ name: "library" }, detail), false).selected).toBe("library");
  expect(nativeTabsState(LINKS, stack({ name: "discover", type: "movie", catalog: "top", genre: "Drama" }), false).selected).toBe("discover:movie");
});

test("five tabs at most and no search tab, so iOS never adds its own More tab (#449)", () => {
  const anime: NavLink = { route: { name: "anime" }, label: "Anime" };
  const calendar: NavLink = { route: { name: "calendar" }, label: "Calendar" };
  const all = [...LINKS.slice(0, 3), anime, LINKS[3], calendar];
  const { tabs } = nativeTabsState(all, stack({ name: "home" }), false);
  expect(MAX_NATIVE_TABS).toBe(5);
  expect(tabs.map((t) => t.id)).toEqual(["home", "discover:series", "discover:movie", "anime", "library"]);
  // Search opened from the top bar's button is no tab: none is current on it.
  expect(nativeTabsState(LINKS, stack({ name: "search" }), false).selected).toBeNull();
  expect(nativeTabsState(LINKS, stack({ name: "home" }, { name: "search" }), false).selected).toBe("home");
  expect(tabRoute(LINKS, "search")).toBeUndefined();
});

test("no tab is current on a page outside them", () => {
  // Calendar hidden in Settings: its page still open is no tab.
  expect(nativeTabsState(LINKS, stack({ name: "calendar" }), false).selected).toBeNull();
});

test("the bar hides over the player and over anything covering the screen", () => {
  const player: Route = { name: "player", type: "movie", metaId: "tt0000000", videoId: "tt0000000" };
  expect(nativeTabsState(LINKS, stack({ name: "home" }), false).hidden).toBe(false);
  expect(nativeTabsState(LINKS, stack({ name: "home" }, player), false).hidden).toBe(true);
  expect(nativeTabsState(LINKS, stack({ name: "home" }), true).hidden).toBe(true);
});

test("a picked tab opens its section; an unknown id opens nothing", () => {
  expect(tabRoute(LINKS, "discover:movie")).toEqual({ name: "discover", type: "movie" });
  expect(tabRoute(LINKS, "anime")).toBeUndefined();
});

test("the back button's menu lists the pages behind, nearest first, by name (#174)", () => {
  const preview = { id: "tt0000000", type: "movie" as const, name: "The Glass Orchard" };
  const s = stack({ name: "discover", type: "movie" }, { name: "detail", type: "movie", id: "tt0000000", preview }, { name: "library-collection", view: "saved" }, {
    name: "playlist",
    id: "p1",
  });
  expect(backHistory(s)).toEqual(["Saved", "The Glass Orchard", "Movies"]);
  expect(backHistory(stack({ name: "home" }))).toEqual([]);
  expect(routeTitle({ name: "detail", type: "series", id: "tt0000000" })).toBe("Series");
});
