import { contentType, count, isRecord, listOf, num, str } from "../parse";
import type { AnimeLink } from "./identity";
import type { LibraryItem, Progress } from "../types";
import { MAX_PLAYLIST_ITEMS, type Playlist, type PlaylistItem } from "./playlists";

/**
 * A Polarity export (Settings → Export library and history): the active profile's library, every
 * progress entry, anime links and playlists, written by Rust (crates/library/src/export.rs) as
 *
 *   { "app": "polarity", "version": 1, "exportedAt": ms, "library": [...], "progress": [...],
 *     "animeLinks": [...], "playlists": [...] }
 *
 * Sources played, stream links and anything secret are never in it. "Import a Polarity export"
 * reads it back here: the links (api.importAnimeLinks), then library and progress
 * (api.importLibrary), then playlists (playlists.ts `importPlaylists`), each keeping its times so
 * newer entries already here win, and importing the same file again adds nothing.
 */

export const EXPORT_APP = "polarity";
export const EXPORT_VERSION = 1;

/** A playlist as the export carries it. */
export interface ExportPlaylist {
  id: string;
  name: string;
  updatedAt: number;
  items: PlaylistItem[];
}

export interface PolarityExport {
  version: number;
  exportedAt: number;
  library: LibraryItem[];
  progress: Progress[];
  animeLinks: AnimeLink[];
  playlists: ExportPlaylist[];
  /** Entries left out because they couldn't be read. */
  unreadable: number;
}

export class ExportError extends Error {}

/** Reads an export's text; throws an ExportError saying what's wrong with another kind of file. */
export function readPolarityExport(text: string): PolarityExport {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new ExportError("This isn't a Polarity export: the file isn't JSON.");
  }
  if (!isRecord(v) || v.app !== EXPORT_APP) throw new ExportError("This isn't a Polarity export.");
  const version = count(v.version);
  if (version === undefined || version < 1) throw new ExportError("This Polarity export has no version Polarity knows.");
  if (version > EXPORT_VERSION) throw new ExportError("This export is from a newer version of Polarity. Update Polarity to import it.");
  if (!Array.isArray(v.library) || !Array.isArray(v.progress)) throw new ExportError("This Polarity export is incomplete: it has no library or history.");
  const lists = [v.library, v.progress, Array.isArray(v.animeLinks) ? v.animeLinks : [], Array.isArray(v.playlists) ? v.playlists : []];
  const library = listOf(v.library, readItem);
  const progress = listOf(v.progress, readProgress);
  const animeLinks = listOf(v.animeLinks, readLink);
  const playlists = listOf(v.playlists, readPlaylist);
  const read = library.length + progress.length + animeLinks.length + playlists.length;
  return {
    version,
    exportedAt: count(v.exportedAt) ?? 0,
    library,
    progress,
    animeLinks,
    playlists,
    unreadable: lists.reduce((n, l) => n + l.length, 0) - read,
  };
}

function readItem(v: unknown): LibraryItem | undefined {
  if (!isRecord(v)) return;
  const [id, type, name, addedAt] = [str(v.id), contentType(v.type), str(v.name), count(v.addedAt)];
  if (!id || !type || name === undefined || addedAt === undefined) return;
  const poster = str(v.poster);
  return { id, type, name, addedAt, ...(poster && { poster }) };
}

/** Built field by field, so nothing else in the file (a `stream` above all) reaches the store. */
function readProgress(v: unknown): Progress | undefined {
  if (!isRecord(v)) return;
  const [metaId, videoId, type, name] = [str(v.metaId), str(v.videoId), contentType(v.type), str(v.name)];
  const [position, duration, updatedAt] = [num(v.position), num(v.duration), count(v.updatedAt)];
  if (!metaId || !videoId || !type || name === undefined || position === undefined || duration === undefined || updatedAt === undefined) return;
  const [poster, background, episodeTitle] = [str(v.poster), str(v.background), str(v.episodeTitle)];
  const [season, episode] = [count(v.season), count(v.episode)];
  return {
    metaId,
    videoId,
    type,
    name,
    position,
    duration,
    updatedAt,
    ...(poster && { poster }),
    ...(background && { background }),
    ...(season !== undefined && { season }),
    ...(episode !== undefined && { episode }),
    ...(episodeTitle && { episodeTitle }),
  };
}

function readLink(v: unknown): AnimeLink | undefined {
  if (!isRecord(v) || v.removed === true) return;
  const [canonical, anilist, updatedAt] = [str(v.canonical), count(v.anilist), count(v.updatedAt)];
  if (!canonical || anilist === undefined || updatedAt === undefined) return;
  const [mal, kitsu] = [count(v.mal), count(v.kitsu)];
  return { canonical, anilist, updatedAt, ...(mal !== undefined && { mal }), ...(kitsu !== undefined && { kitsu }) };
}

function readPlaylist(v: unknown): ExportPlaylist | undefined {
  if (!isRecord(v)) return;
  const [id, name, updatedAt] = [str(v.id), str(v.name), count(v.updatedAt)];
  if (!id || name === undefined || updatedAt === undefined) return;
  const items = listOf(v.items, (i): PlaylistItem | undefined => {
    if (!isRecord(i)) return;
    const [itemId, type, itemName, poster] = [str(i.id), contentType(i.type), str(i.name), str(i.poster)];
    if (!itemId || !type) return;
    return { id: itemId, type, ...(itemName && { name: itemName }), ...(poster && { poster }) };
  });
  return { id, name, updatedAt, items: items.slice(0, MAX_PLAYLIST_ITEMS) };
}

/** The playlists to export: the ones shown (a newer version's packed playlist can't be read here). */
export const exportablePlaylists = (playlists: Playlist[]): ExportPlaylist[] =>
  playlists
    .filter((p) => !p.deleted && !p.packed)
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, items: p.items.map(({ id, type, name, poster }) => ({ id, type, name, poster })) }));

/** What an import added. */
export interface ExportImported {
  library: number;
  progress: number;
  links: number;
  playlists: number;
}

export interface ImportDeps {
  importAnimeLinks: (links: AnimeLink[]) => Promise<number>;
  importLibrary: (library: LibraryItem[], progress: Progress[]) => Promise<{ library: number; progress: number }>;
  importPlaylists: (playlists: ExportPlaylist[]) => number;
}

/** Imports a read export: links first, so titles land under the ids they lead to. */
export async function importPolarityExport(doc: PolarityExport, deps: ImportDeps): Promise<ExportImported> {
  const links = doc.animeLinks.length ? await deps.importAnimeLinks(doc.animeLinks) : 0;
  const added = doc.library.length || doc.progress.length ? await deps.importLibrary(doc.library, doc.progress) : { library: 0, progress: 0 };
  const playlists = doc.playlists.length ? deps.importPlaylists(doc.playlists) : 0;
  return { library: added.library, progress: added.progress, links, playlists };
}

const counted = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Added 3 library titles, 12 history entries and 1 playlist." */
export function describeImport(added: ExportImported, unreadable = 0): string {
  const parts = [
    added.library && counted(added.library, "library title"),
    added.progress && counted(added.progress, "history entry", "history entries"),
    added.playlists && counted(added.playlists, "playlist"),
    added.links && counted(added.links, "anime link"),
  ].filter((p): p is string => !!p);
  const what = parts.length ? `Added ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.` : "Nothing new: everything in the file is already here, or newer here.";
  return unreadable ? `${what} ${counted(unreadable, "entry", "entries")} couldn't be read.` : what;
}
