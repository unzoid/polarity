import { useEffect, useState } from "react";
import { freshPlaylistName, usePlaylists } from "../../lib/library";
import type { MetaPreview } from "../../lib/types";
import { Check, Plus } from "../icons";
import { FamilyTray } from "../settings/FamilyTray";
import { useLibraryToggle } from "../title/LibraryButton";
import { usePlaylistChecklist } from "../title/PlaylistChecklist";

/**
 * Add to List on a phone's title page (docs/ui-components.md U10): My List, then the playlists, as rows to tick
 * (each playlist with how many titles it holds), and New Playlist, which asks for the name on a step of its own and
 * starts the playlist with this title in it.
 */
export function PlaylistTray({ item, open, onClose }: { item: MetaPreview; open: boolean; onClose: () => void }) {
  const list = usePlaylistChecklist(item);
  const library = useLibraryToggle(item);
  const playlists = usePlaylists();
  const [step, setStep] = useState<"list" | "new">("list");
  const [name, setName] = useState("");
  const fallback = freshPlaylistName(playlists.map((p) => p.name));
  const naming = step === "new";

  // Each opening starts on the list, with the name field empty.
  useEffect(() => {
    if (!open) return;
    setStep("list");
    setName("");
  }, [open]);

  const create = () => {
    list.create(name.trim() || undefined);
    setName("");
    setStep("list");
  };

  return (
    <FamilyTray
      open={open}
      onClose={onClose}
      title={naming ? "New Playlist" : "Add to List"}
      stepKey={naming ? "new" : "list"}
      direction={naming ? "forward" : "back"}
      onBack={naming ? () => setStep("list") : undefined}
    >
      {naming ? (
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
            onChange={(e) => setName(e.target.value)}
            placeholder={fallback}
            aria-label="Playlist name"
            maxLength={60}
            autoComplete="off"
            enterKeyHint="done"
            autoFocus
          />
          <div className="ft-actions">
            <button type="submit" className="ft-pill ft-pill-cta">
              Create Playlist
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="ft-picker-list ft-picker-multi" role="group" aria-label="Lists">
            <button
              type="button"
              role="checkbox"
              aria-checked={!!library.inLibrary}
              className={`ft-picker-opt ft-picker-library${library.inLibrary ? " is-selected" : ""}`}
              onClick={library.toggle}
            >
              <span className="ft-picker-label">My List</span>
              <span className="ft-picker-check" aria-hidden>
                <Check size={13} strokeWidth={3.2} />
              </span>
            </button>
            {list.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="checkbox"
                aria-checked={row.has}
                className={`ft-picker-opt${row.has ? " is-selected" : ""}`}
                onClick={() => list.toggle(row)}
              >
                <span className="ft-picker-label">{row.name}</span>
                <span className="ft-picker-meta tabular">{row.count}</span>
                <span className="ft-picker-check" aria-hidden>
                  <Check size={13} strokeWidth={3.2} />
                </span>
              </button>
            ))}
            {!list.full && (
              <button type="button" className="ft-picker-opt ft-picker-new" onClick={() => setStep("new")}>
                <span className="ft-picker-label">New Playlist</span>
                <Plus size={18} />
              </button>
            )}
          </div>
          <div className="ft-actions ft-picker-foot">
            <button type="button" className="ft-pill ft-pill-cta" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </FamilyTray>
  );
}
