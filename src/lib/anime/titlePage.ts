import type { AnimeLink } from "../library/identity";
import { storeLocal } from "../errors";
import { isRecord, storedJson } from "../parse";
import type { ContentType, MetaPreview } from "../types";

/**
 * Which page a title opens on (test report 1, item 1): an anime has one page, its AniList one,
 * whichever id it was reached by (`tt…` from Continue Watching, Library or a Cinemeta card,
 * `kitsu:…`), and the choice is made before any page renders, so the series page never shows
 * for an anime and is never swapped for another one. A stored anime link answers at once; then
 * an answer remembered from an earlier start; only then the network (the title's genres,
 * ani.zip, AniList).
 */
export type TitlePage = { kind: "anime"; anilist: number } | { kind: "title" };

export interface PageLookup {
  animeEnabled: boolean;
  links: () => Promise<AnimeLink[]>;
  meta: (type: ContentType, id: string) => Promise<MetaPreview | null>;
  anilistForImdb: (id: string, title: { type: string; name: string; year?: number }) => Promise<number | null>;
  anilistForKitsu: (kitsu: number) => Promise<number | null>;
  storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  now: () => number;
}

const STORAGE = "polar.titlePages";
/** "Not an anime" is asked again after this long: a new show gets its ani.zip mapping late. */
const NOT_ANIME_FOR = 7 * 86_400_000;

const TITLE: TitlePage = { kind: "title" };
const anime = (anilist: number): TitlePage => ({ kind: "anime", anilist });

/** Remembered answers: id → [AniList id or 0 for "not an anime", when asked (ms)]. */
type Remembered = Record<string, [number, number]>;
let memStorage: PageLookup["storage"];
let memRaw: string | null | undefined;
let memParsed: Remembered = {};

function remembered(storage: PageLookup["storage"]): Remembered {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE);
    if (storage === memStorage && raw === memRaw) return memParsed;
    const v = storedJson(storage, STORAGE);
    memStorage = storage;
    memRaw = raw;
    memParsed = isRecord(v) ? (v as Remembered) : {};
    return memParsed;
  } catch {
    const v = storedJson(storage, STORAGE);
    return isRecord(v) ? (v as Remembered) : {};
  }
}

const isAnimated = (item: Pick<MetaPreview, "genres">) => !!item.genres?.some((g) => /^anim(e|ation)$/i.test(g));

function linkedAnimeOf(links: readonly AnimeLink[], id: string, kitsu: number | undefined): AnimeLink | undefined {
  let best: AnimeLink | undefined;
  for (const k of links) {
    if (k.canonical === id || (kitsu !== undefined && k.kitsu === kitsu)) {
      if (!best || k.anilist < best.anilist) best = k;
    }
  }
  return best;
}

/**
 * Synchronous fast-path when `links` are already cached in memory: settles non-animated titles,
 * linked anime and remembered answers in 0ms without awaiting IPC or rendering a skeleton frame.
 */
export function syncTitlePage(
  id: string,
  preview: MetaPreview | undefined,
  opts: { animeEnabled: boolean; links: readonly AnimeLink[] | undefined; storage: PageLookup["storage"]; now: number },
): TitlePage | undefined {
  if (!opts.animeEnabled) return TITLE;
  const anilistPrefix = id.match(/^anilist:(\d+)$/);
  if (anilistPrefix) return anime(Number(anilistPrefix[1]));
  const kitsu = Number(id.match(/^kitsu:(\d+)$/)?.[1]) || undefined;
  if (!kitsu && !id.startsWith("tt")) return TITLE;
  if (!opts.links) return undefined;

  const linked = linkedAnimeOf(opts.links, id, kitsu);
  if (linked) return anime(linked.anilist);

  const known = remembered(opts.storage)[id];
  if (known && (known[0] > 0 || opts.now - known[1] < NOT_ANIME_FOR)) return known[0] > 0 ? anime(known[0]) : TITLE;

  if (!kitsu && preview?.genres?.length && !isAnimated(preview)) return TITLE;
  return undefined;
}

/** The page for `id`. Never throws: anything that fails opens the title as it is. */
export async function titlePage(type: ContentType, id: string, preview: MetaPreview | undefined, l: PageLookup): Promise<TitlePage> {
  if (!l.animeEnabled) return TITLE;
  const anilistPrefix = id.match(/^anilist:(\d+)$/);
  if (anilistPrefix) return anime(Number(anilistPrefix[1]));
  const kitsu = Number(id.match(/^kitsu:(\d+)$/)?.[1]) || undefined;
  if (!kitsu && !id.startsWith("tt")) return TITLE;

  // The entry the user opened before (the oldest AniList entry: one IMDb id covers every season).
  const links = await l.links().catch(() => [] as AnimeLink[]);
  const linked = linkedAnimeOf(links, id, kitsu);
  if (linked) return anime(linked.anilist);

  const memo = remembered(l.storage);
  const known = memo[id];
  if (known && (known[0] > 0 || l.now() - known[1] < NOT_ANIME_FOR)) return known[0] > 0 ? anime(known[0]) : TITLE;

  try {
    let found: number | null;
    if (kitsu) found = await l.anilistForKitsu(kitsu);
    else {
      const item = preview?.genres?.length ? preview : ((await l.meta(type, id)) ?? preview);
      if (!item || !isAnimated(item)) return TITLE;
      const year = Number(item.releaseInfo?.match(/\d{4}/)?.[0]) || undefined;
      found = await l.anilistForImdb(id, { type: item.type, name: item.name, year });
    }
    const next = { ...remembered(l.storage), [id]: [found ?? 0, l.now()] as [number, number] };
    const serialized = JSON.stringify(next);
    storeLocal(STORAGE, serialized, l.storage);
    if (l.storage === memStorage) {
      memRaw = serialized;
      memParsed = next;
    }
    return found ? anime(found) : TITLE;
  } catch {
    return TITLE;
  }
}
