import type { Route } from "../lib/router";
import { lazyNamed } from "../lib/ui";

export const LazyDiscover = lazyNamed(() => import("./Discover"), "Discover");
export const LazyLibrary = lazyNamed(() => import("./Library"), "Library");
export const LazyLibraryCollection = lazyNamed(() => import("./Library"), "LibraryCollection");
export const LazyLibraryPlaylist = lazyNamed(() => import("./Library"), "LibraryPlaylist");
export const LazyCalendar = lazyNamed(() => import("./Calendar"), "Calendar");
export const LazySearch = lazyNamed(() => import("./Search"), "Search");
export const LazyDetail = lazyNamed(() => import("./Detail"), "Detail");
export const LazyPerson = lazyNamed(() => import("./Person"), "Person");
export const LazyAnime = lazyNamed(() => import("./Anime"), "Anime");
export const LazyAnimeBrowse = lazyNamed(() => import("./Anime"), "AnimeBrowse");
export const LazyAnimeSchedule = lazyNamed(() => import("./Anime"), "AnimeSchedule");
export const LazyAnimeDetail = lazyNamed(() => import("./AnimeDetail"), "AnimeDetail");

export function preloadRoute(route: Route) {
  switch (route.name) {
    case "discover":
      return void LazyDiscover.preload().catch(() => {});
    case "library":
    case "library-collection":
    case "playlist":
      return void LazyLibrary.preload().catch(() => {});
    case "calendar":
      return void LazyCalendar.preload().catch(() => {});
    case "search":
      return void LazySearch.preload().catch(() => {});
    case "detail":
      return void LazyDetail.preload().catch(() => {});
    case "person":
      return void LazyPerson.preload().catch(() => {});
    case "anime":
    case "anime-browse":
    case "anime-schedule":
      return void LazyAnime.preload().catch(() => {});
    case "anime-detail":
      return void LazyAnimeDetail.preload().catch(() => {});
    default:
      return;
  }
}
