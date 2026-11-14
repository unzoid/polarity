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
  key: "acting" | "directing";
  title: string;
  items: MetaPreview[];
}

/**
 * A person's titles in rows, those they're known for first: a director's directing comes before the films
 * they appear in. Empty rows are left out.
 */
export function filmography(p: Pick<PersonPage, "acting" | "directing" | "knownFor">): Filmography[] {
  const rows: Filmography[] = [
    { key: "acting", title: "Acting", items: p.acting ?? [] },
    { key: "directing", title: "Directing", items: p.directing ?? [] },
  ];
  if (p.knownFor === "Directing" || p.knownFor === "Creator") rows.reverse();
  return rows.filter((r) => r.items.length > 0);
}

/** The kind of an extra as a label on its tile: TMDB's word for it ("Featurette", "Clip"…). */
export const extraKind = (kind: string) => kind.trim() || "Video";

/**
 * YouTube's own still for a video, from the host that serves the embed's pictures. Pictures may come from any
 * https host (tauri.conf.json `img-src`); a tile whose still doesn't load shows its name and kind instead.
 */
export const extraStill = (e: Pick<Extra, "key">) => `https://i.ytimg.com/vi/${encodeURIComponent(e.key)}/mqdefault.jpg`;
