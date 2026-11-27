import { useState, type FormEvent, type ReactNode } from "react";
import {
  addToPlaylist,
  createPlaylist,
  freshPlaylistName,
  inAnyPlaylist,
  MAX_PLAYLISTS,
  type PlaylistRow,
  playlistRows,
  removeFromPlaylist,
  usePlaylists,
} from "../../lib/library";
import type { MetaPreview } from "../../lib/types";
import { Check, Plus } from "../icons";
import { Button } from "../ui/Button";
import { MenuCheckItem, MenuItem, MenuSeparator } from "../ui/Menu";
import { TextField } from "../ui/TextField";
import { useLibraryToggle } from "./LibraryButton";

/**
 * Add-to-playlist (docs/ui-components.md U10): the playlists as tickable rows
 * and "New Playlist". The card menu's submenu and the detail page's popover
 * draw it with `PlaylistChecklist`; TV's panel draws its own rows from the hook.
 */
export function usePlaylistChecklist(item: MetaPreview) {
  const playlists = usePlaylists();
  return {
    rows: playlistRows(playlists, item.id),
    inAny: inAnyPlaylist(playlists, item.id),
    /** No room for another playlist (MAX_PLAYLISTS): New Playlist isn't offered. */
    full: playlists.length >= MAX_PLAYLISTS,
    toggle: (row: PlaylistRow) => (row.has ? removeFromPlaylist(row.id, item.id) : addToPlaylist(row.id, item)),
    /** Starts a playlist with the title in it; without a name, "New Playlist" (2, 3, …). */
    create: (name?: string) => createPlaylist(name || freshPlaylistName(playlists.map((p) => p.name)), item),
  };
}

/**
 * `look="menu"`: rows inside a `MenuSub`, New Playlist made at once with a free name.
 * `look="popover"`: rows inside a `Popover`, New Playlist asks for a name first; `withLibrary` puts My List
 * above the playlists, for the title pages' one Add to List button.
 */
export function PlaylistChecklist({ item, look, withLibrary }: { item: MetaPreview; look: "menu" | "popover"; withLibrary?: boolean }) {
  const list = usePlaylistChecklist(item);
  if (look === "popover") return <PopoverChecklist list={list} library={withLibrary ? <LibraryRow item={item} /> : undefined} />;
  return (
    <>
      {list.rows.map((row) => (
        <MenuCheckItem key={row.id} checked={row.has} meta={row.count} onCheckedChange={() => list.toggle(row)}>
          {row.name}
        </MenuCheckItem>
      ))}
      {list.rows.length > 0 && !list.full && <MenuSeparator />}
      {!list.full && (
        <MenuItem icon={<Plus />} onClick={() => list.create()}>
          New Playlist
        </MenuItem>
      )}
    </>
  );
}

/** My List as the popover's first row, ticked while the title is in it. */
function LibraryRow({ item }: { item: MetaPreview }) {
  const { inLibrary, toggle } = useLibraryToggle(item);
  return (
    <div className="playlist-menu-list playlist-menu-library">
      <button className="playlist-menu-item" role="menuitemcheckbox" aria-checked={!!inLibrary} onClick={toggle}>
        <span className="playlist-menu-check">{inLibrary && <Check size={14} strokeWidth={2.5} />}</span>
        <span className="playlist-menu-name">My List</span>
      </button>
    </div>
  );
}

/** The popover's rows; it remounts each time the popover opens, so the name form starts closed and empty. */
function PopoverChecklist({ list, library }: { list: ReturnType<typeof usePlaylistChecklist>; library?: ReactNode }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = (e: FormEvent) => {
    e.preventDefault();
    list.create(name);
    setName("");
    setCreating(false);
  };

  return (
    <>
      {library}
      {library && <p className="playlist-menu-title playlist-menu-subtitle">Playlists</p>}
      {list.rows.length > 0 && (
        <div className="playlist-menu-list">
          {list.rows.map((row) => (
            <button key={row.id} className="playlist-menu-item" role="menuitemcheckbox" aria-checked={row.has} onClick={() => list.toggle(row)}>
              <span className="playlist-menu-check">{row.has && <Check size={14} strokeWidth={2.5} />}</span>
              <span className="playlist-menu-name">{row.name}</span>
              <span className="playlist-menu-count tabular">{row.count}</span>
            </button>
          ))}
        </div>
      )}
      {list.full ? null : creating ? (
        <form className="playlist-menu-form" onSubmit={create}>
          <TextField
            autoFocus
            maxLength={60}
            placeholder="Playlist name"
            value={name}
            onChange={setName}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setCreating(false))}
          />
          <Button variant="primary" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      ) : (
        <button className="playlist-menu-item playlist-menu-new" onClick={() => setCreating(true)}>
          <span className="playlist-menu-check">
            <Plus size={15} strokeWidth={2.25} />
          </span>
          New Playlist
        </button>
      )}
    </>
  );
}
