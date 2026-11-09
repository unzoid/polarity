import type { Page } from "@playwright/test";
import { png } from "./media";

/**
 * A stand-in for AniList's GraphQL (#430): invented franchises of three entries each (prequel → sequel), one of
 * eight ({@link LONG}), answered
 * whatever fields a query selects (each entry comes whole, the readers take what they asked for). Top-level fields
 * are read with their aliases, so a batched request gets one answer per alias; one it doesn't know nulls them all,
 * as AniList does. Counts the requests it answers.
 */
export const FRANCHISES = 30;
/** The long franchise. */
export const LONG = 5;
const length = (franchise: number) => (franchise === LONG ? 8 : 3);
const BASE = 880_000;
export const entryId = (franchise: number, k: number) => BASE + franchise * 10 + k;
const known = (id: number) => id >= BASE && id < BASE + FRANCHISES * 10 && (id - BASE) % 10 < length(Math.floor((id - BASE) / 10));

function card(id: number) {
  const f = Math.floor((id - BASE) / 10);
  const k = (id - BASE) % 10;
  return {
    id,
    idMal: null,
    type: "ANIME",
    title: { romaji: `Kazeori ${f} ${k}`, english: k ? `Windfold ${f}: Part ${k + 1}` : `Windfold ${f}`, native: null },
    coverImage: { extraLarge: `https://art.example/cover/${id}.png`, large: `https://art.example/cover/${id}.png`, color: "#4a6fa5" },
    bannerImage: `https://art.example/banner/${id}.png`,
    format: "TV",
    status: "FINISHED",
    episodes: 12,
    duration: 24,
    season: "SPRING",
    seasonYear: 2001 + k,
    averageScore: 70,
    popularity: 10_000 - f,
    genres: ["Adventure"],
    startDate: { year: 2001 + k, month: 4, day: 1 },
    nextAiringEpisode: null,
    description: `Invented entry ${k + 1} of franchise ${f}.`,
  };
}

function relations(id: number, depth: number) {
  const k = (id - BASE) % 10;
  const last = length(Math.floor((id - BASE) / 10)) - 1;
  const edges = [];
  if (k > 0) edges.push({ relationType: "PREQUEL", node: depth > 0 ? media(id - 1, depth - 1) : { ...card(id - 1), relations: { edges: [] } } });
  if (k < last) edges.push({ relationType: "SEQUEL", node: depth > 0 ? media(id + 1, depth - 1) : { ...card(id + 1), relations: { edges: [] } } });
  return { edges };
}

function media(id: number, depth = 1): Record<string, unknown> {
  return {
    ...card(id),
    relations: relations(id, depth),
    synonyms: [],
    source: "ORIGINAL",
    hashtag: null,
    meanScore: 70,
    favourites: 0,
    isAdult: false,
    countryOfOrigin: "JP",
    endDate: { year: 2001, month: 6, day: 30 },
    trailer: null,
    studios: { edges: [] },
    tags: [],
    characters: { edges: [] },
    staff: { edges: [] },
    recommendations: { pageInfo: { hasNextPage: false }, nodes: [] },
    externalLinks: [],
    rankings: [],
    airingSchedule: { nodes: [] },
  };
}

/** The query's top-level fields: alias (or name), name and arguments. */
function topFields(query: string) {
  const open = query.indexOf("{");
  const out: { key: string; name: string; args: string }[] = [];
  let depth = 0;
  let i = open + 1;
  for (; i < query.length; i++) {
    const c = query[i];
    if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      const m = /^\s*(?:(\w+)\s*:\s*)?(\w+)\s*(\(([^)]*)\))?\s*\{/.exec(query.slice(i));
      if (m) {
        out.push({ key: m[1] ?? m[2], name: m[2], args: m[4] ?? "" });
        i += m[0].length - 2;
      }
    }
  }
  return out;
}

const arg = (args: string, name: string, vars: Record<string, unknown>) => {
  const m = new RegExp(`\\b${name}\\s*:\\s*(\\$\\w+|[\\w"]+|\\[[^\\]]*\\])`).exec(args);
  if (!m) return undefined;
  const v = m[1];
  if (v.startsWith("$")) return vars[v.slice(1)];
  if (v.startsWith("[")) return JSON.parse(v);
  return /^\d+$/.test(v) ? Number(v) : v.replace(/"/g, "");
};

/**
 * The `data` for a request asking for entries by id, alone (`Media(id: $id)`) or batched (`m<id>: Media(id: <id>)`,
 * #430): `find`'s answer under each field's alias, null where it has none. Undefined for a request with no `Media`.
 */
export function mediaAnswer(body: string | null, find: (id: number) => unknown): Record<string, unknown> | undefined {
  const { query = "", variables = {} } = JSON.parse(body || "{}") as { query?: string; variables?: Record<string, unknown> };
  const media = topFields(query).filter((f) => f.name === "Media");
  if (!media.length) return undefined;
  return Object.fromEntries(media.map((f) => [f.key, find(Number(arg(f.args, "id", variables))) ?? null]));
}

/** Every franchise's first entry, as the lists answer. */
const firsts = () => Array.from({ length: FRANCHISES }, (_, f) => media(entryId(f, 0), 0));

export function answerAniList(query: string, vars: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const f of topFields(query)) {
    if (f.name === "Media") {
      const id = Number(arg(f.args, "id", vars));
      data[f.key] = known(id) ? media(id) : null;
    } else if (f.name === "Page") {
      const ids = arg(f.args, "id_in", vars);
      const list = Array.isArray(ids) ? ids.filter((n) => known(Number(n))).map((n) => media(Number(n))) : firsts().slice(0, Number(arg(f.args, "perPage", vars) ?? 24));
      data[f.key] = { pageInfo: { hasNextPage: false }, media: list };
    } else data[f.key] = null;
  }
  return data;
}

/** Answers AniList on `app` with the invented franchises; `count()` is how many requests it answered so far. */
export async function serveAniList(app: Page) {
  let n = 0;
  await app.route("https://graphql.anilist.co/**", async (route) => {
    n++;
    if (process.env.ANILIST_LOG) {
      const body = route.request().postData() ?? "";
      const asked = [...body.matchAll(/m(\d+): Media/g)].map((m) => m[1]);
      console.log("Q", n, asked.length ? `${body.includes("airingSchedule") ? "page" : "link"} ${asked.join(" ")}` : body.replace(/\\n|\s+/g, " ").slice(0, 100));
    }
    const { query, variables } = JSON.parse(route.request().postData() ?? "{}") as { query: string; variables?: Record<string, unknown> };
    const data = answerAniList(query, variables ?? {});
    const headers = { "access-control-allow-origin": "*" };
    // As AniList answers an entry it doesn't have: a 404, and every entry in the request null.
    const media = topFields(query).filter((f) => f.name === "Media");
    if (media.some((f) => data[f.key] === null)) {
      for (const f of media) data[f.key] = null;
      return route.fulfill({ status: 404, json: { errors: [{ message: "Not Found.", status: 404 }], data }, headers });
    }
    await route.fulfill({ json: { data }, headers });
  });
  // Its pictures: a plain one each, so no card is left out for a broken picture.
  await app.route("https://art.example/**", (route) => route.fulfill({ body: png(32, 18, (x) => [40 + x * 4, 80, 140, 255]), contentType: "image/png", headers: { "access-control-allow-origin": "*" } }));
  return { count: () => n, reset: () => void (n = 0) };
}
