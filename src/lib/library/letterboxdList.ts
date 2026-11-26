import type { LetterboxdListFilm } from "../types";
import { normaliseTitle, type LetterboxdFilm } from "./letterboxdImport";

/**
 * Import Playlist's side of a Letterboxd list (#87's matching, for a list read from its link by
 * src-tauri/src/letterboxd.rs): which pasted text is a list's link, and the list's films as the
 * export import's matcher takes them.
 */

/**
 * A list's link (`letterboxd.com/<name>/list/<slug>/…`, with or without `https://` or `www.`) or a
 * `boxd.it` short link, which the app follows to see whether it is one.
 */
export function isLetterboxdListLink(text: string): boolean {
  const s = text.trim().replace(/^https?:\/\//i, "");
  return /^(www\.)?letterboxd\.com\/[\w-]+\/list\/[\w-]+(\/|$|[?#])/i.test(s) || /^boxd\.it\/[A-Za-z0-9]+\/?$/.test(s);
}

/** The list's films in its order; the key carries the position, so a film listed twice stays twice until the playlist drops it. */
export function listFilms(films: LetterboxdListFilm[]): LetterboxdFilm[] {
  return films.map((f, i) => ({ key: `${i}|${normaliseTitle(f.name)}|${f.year ?? ""}`, name: f.name, year: f.year }));
}
