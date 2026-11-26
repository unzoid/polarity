import { useState } from "react";
import { createPlaylist, freshPlaylistName, MAX_PLAYLISTS, usePlaylists, type Playlist } from "../../lib/library";
import { FamilyTray } from "../settings/FamilyTray";

/**
 * New Playlist on a phone: the tray asks for the name first, so the playlist opens already called what it's for
 * (rather than "New Playlist", renamed on its page). Left empty, it takes the next free "New Playlist" name.
 */
export function NewPlaylistTray({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (playlist: Playlist) => void }) {
  const playlists = usePlaylists();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fallback = freshPlaylistName(playlists.map((p) => p.name));

  const close = () => {
    setName("");
    setError(null);
    onClose();
  };
  const create = () => {
    const made = createPlaylist(name.trim() || fallback);
    if (!made) return setError(`You already have ${MAX_PLAYLISTS} playlists. Delete one to make room.`);
    close();
    onCreated(made);
  };

  return (
    <FamilyTray open={open} onClose={close} title="New Playlist" stepKey="new-playlist">
      <form
        className="ft-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className="text-field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder={fallback}
          aria-label="Playlist name"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
          autoFocus
        />
        {error && (
          <p className="ft-desc-error" role="alert">
            {error}
          </p>
        )}
        <div className="ft-actions">
          <button type="submit" className="ft-pill ft-pill-cta">
            Create Playlist
          </button>
        </div>
      </form>
    </FamilyTray>
  );
}
