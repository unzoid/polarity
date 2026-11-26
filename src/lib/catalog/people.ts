// People and extras on title pages: which names open a person's page, what a person's page lists, and how a
// title's other videos are labelled. Pure; the pages are screens/Person.tsx and tv/TvPerson.tsx.

import { formatDate } from "../format";
import type { Extra, Meta, MetaPreview, PersonPage } from "../types";

/**
 * Name → TMDB person id, from a title's cast and crew. Only TMDB names people by id: from Cinemeta or an
 * add-on the map is empty and the names stay plain text. A name given two ids (two people of one name) is
 * left out rather than guessed.
 */
export function personIds(meta: Pick<Meta, "people" | "crew"> | undefined): ReadonlyMap<string, number> {
  const ids = new Map<string, number>();
  const clash = new Set<string>();
  for (const p of [...(meta?.people ?? []), ...(meta?.crew ?? [])]) {
    if (p.tmdbId == null) continue;
    const had = ids.get(p.name);
    if (had != null && had !== p.tmdbId) clash.add(p.name);
    else ids.set(p.name, p.tmdbId);
  }
  for (const name of clash) ids.delete(name);
  return ids;
}

/** How long a biography shows before "More". */
export const BIO_PREVIEW = 420;

/**
 * The start of a biography for the page's first look: whole paragraphs and sentences up to `max` characters,
 * and whether more is left. A first sentence longer than `max` is cut at a word, with an ellipsis.
 */
export function bioPreview(text: string | undefined, max = BIO_PREVIEW): { text: string; more: boolean } {
  const bio = (text ?? "").trim();
  if (bio.length <= max) return { text: bio, more: false };
  const sentences = bio.match(/[^.!?\n]+[.!?]*["”’)]*\s*|\n+/g) ?? [bio];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trimEnd().length > max) break;
    out += s;
  }
  out = out.trim();
  if (!out) {
    const cut = bio.slice(0, max);
    out = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trimEnd()}…`;
  }
  return { text: out, more: true };
}

/** "Born 14 September 1970 in Example Town", "1970 – 2020" and the like, for under the name. */
export function lifeFacts(p: Pick<PersonPage, "born" | "died" | "birthplace" | "knownFor">): string[] {
  const facts: string[] = [];
  if (p.knownFor) facts.push(p.knownFor);
  const born = formatDate(p.born);
  const died = formatDate(p.died);
  if (born && died) facts.push(`${born} – ${died}`);
  else if (born) facts.push(`Born ${born}`);
  else if (died) facts.push(`Died ${died}`);
  if (p.birthplace) facts.push(p.birthplace);
  return facts;
}

export interface Filmography {
  key: "acting" | "directing" | "writing";
  title: string;
  items: MetaPreview[];
}

/**
 * A person's titles in rows, those they're known for first: a director's directing or a writer's writing
 * comes before the films they appear in. Empty rows are left out.
 */
export function filmography(p: Pick<PersonPage, "acting" | "directing" | "writing" | "knownFor">): Filmography[] {
  const rows: Filmography[] = [
    { key: "acting", title: "Acting", items: p.acting ?? [] },
    { key: "directing", title: "Directing", items: p.directing ?? [] },
    { key: "writing", title: "Writing", items: p.writing ?? [] },
  ];
  const lead = p.knownFor === "Directing" || p.knownFor === "Creator" ? "directing" : p.knownFor === "Writing" ? "writing" : "acting";
  rows.sort((a, b) => Number(b.key === lead) - Number(a.key === lead));
  return rows.filter((r) => r.items.length > 0);
}

/** Whole years from `from` to `to` (YYYY-MM-DD each, `to` today when left out); undefined when `from` isn't a date. */
export function yearsBetween(from: string | undefined, to?: string, now = new Date()): number | undefined {
  const a = parseDay(from);
  const b = to ? parseDay(to) : [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  if (!a || !b) return undefined;
  const years = b[0] - a[0] - (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2]) ? 1 : 0);
  return years >= 0 && years < 130 ? years : undefined;
}

const parseDay = (iso?: string) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

/** The facts card's rows on a person's page: label and value, the ones there. */
export function personFacts(p: Pick<PersonPage, "born" | "died" | "birthplace" | "knownFor">, now = new Date()): [string, string][] {
  const rows: [string, string][] = [];
  const born = formatDate(p.born);
  const died = formatDate(p.died);
  const age = yearsBetween(p.born, p.died, now);
  if (born) rows.push(["Born", p.died || age == null ? born : `${born} (age ${age})`]);
  if (died) rows.push(["Died", age == null ? died : `${died} (aged ${age})`]);
  if (p.birthplace) rows.push(["Birthplace", p.birthplace]);
  if (p.knownFor) rows.push(["Known for", p.knownFor]);
  return rows;
}

/** What they do, as the line under their name: "Actor · Director", the lead first. */
export function professions(p: Pick<PersonPage, "acting" | "directing" | "writing" | "knownFor">): string[] {
  const noun = { acting: "Actor", directing: p.knownFor === "Creator" ? "Creator" : "Director", writing: "Writer" };
  return filmography(p).map((r) => noun[r.key]);
}

/** One line of a person's credits: the title, their part in it, and its year. */
export interface CreditLine {
  item: MetaPreview;
  role?: string;
  episodes?: number;
  year?: number;
}

/** A list's titles with their parts, newest first; those without a year go last, in the list's order. */
export function creditLines(p: Pick<PersonPage, "roles">, row: Filmography): CreditLine[] {
  // Stable: titles of one year keep the list's order (most notable first).
  return linesOf(p, row).sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
}

/** A list's titles with their parts, in the list's order. */
function linesOf(p: Pick<PersonPage, "roles">, row: Filmography): CreditLine[] {
  const roles = new Map((p.roles ?? []).filter((r) => r.list === row.key).map((r) => [r.id, r]));
  return row.items.map((item) => {
    const r = roles.get(item.id);
    const year = Number(item.releaseInfo?.match(/\d{4}/)?.[0]) || undefined;
    return { item, role: r?.name, episodes: r?.episodes, year };
  });
}

/**
 * The few titles a person is best known for: the most notable of their lead list, shows they're in for an episode or
 * two last (a guest part in a big show isn't what they're known for).
 */
export function knownForLines(p: Pick<PersonPage, "acting" | "directing" | "writing" | "knownFor" | "roles">, count = 6): CreditLine[] {
  const lead = filmography(p)[0];
  if (!lead) return [];
  const lines = linesOf(p, lead);
  const guest = (l: CreditLine) => l.item.type === "series" && l.episodes != null && l.episodes <= 2;
  return [...lines.filter((l) => !guest(l)), ...lines.filter(guest)].slice(0, count);
}

/** "12 episodes", "1 episode". */
export const episodeCount = (n: number) => `${n} ${n === 1 ? "episode" : "episodes"}`;

/** The kind of an extra as a label on its tile: TMDB's word for it ("Featurette", "Clip"…). */
export const extraKind = (kind: string) => kind.trim() || "Video";

/**
 * YouTube's own still for a video, from the host that serves the embed's pictures. Pictures may come from any
 * https host (tauri.conf.json `img-src`); a tile whose still doesn't load shows its name and kind instead.
 */
export const extraStill = (e: Pick<Extra, "key">) => `https://i.ytimg.com/vi/${encodeURIComponent(e.key)}/mqdefault.jpg`;

/** High-resolution YouTube stills to try in order (`hqdefault` first, falling back to `mqdefault`). */
export const extraStills = (e: Pick<Extra, "key">): string[] => {
  const id = encodeURIComponent(e.key);
  return [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, extraStill(e)];
};
