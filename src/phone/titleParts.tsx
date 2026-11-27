import { useState, type ReactNode } from "react";
import { PlaylistTray } from "../components/library/PlaylistTray";
import { useLibraryToggle } from "../components/title/LibraryButton";
import { usePlaylistChecklist } from "../components/title/PlaylistChecklist";
import type { MetaPreview } from "../lib/types";
import { IconBack, IconCheck, IconClose, IconPlus } from "./icons";

/** Close (and Back, for a title opened from another) over the top of a title's art. */
export function MediaButtons({ onClose, onBack }: { onClose: () => void; onBack?: () => void }) {
  return (
    <div className="ps-media-buttons scheme-dark">
      {onBack && (
        <button type="button" className="ps-round" aria-label="Back" onClick={onBack}>
          <IconBack size={24} stroke={2.2} />
        </button>
      )}
      <span className="ps-flex" />
      <button type="button" className="ps-round" aria-label="Close" onClick={onClose}>
        <IconClose size={26} stroke={1.8} />
      </button>
    </div>
  );
}

/** Three lines of what it's about; a tap opens the rest. */
export function Synopsis({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <p className="ps-synopsis" data-open={open || undefined} onClick={() => setOpen(true)}>
      {text}
    </p>
  );
}

/** One of the labelled glyphs in the row under a title's details (My List, Trailer, Sources…). */
export function Action({ label, onClick, pressed, disabled, children }: { label: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="ps-action" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <span className="ps-action-glyph">{children}</span>
      <span className="ps-action-label">{label}</span>
    </button>
  );
}

/**
 * Add to List: opens the tray that ticks My List and the playlists this title is in, or starts a new playlist with it.
 * Ticked, and "Added", while the title is in any of them.
 */
export function ListAction({ item }: { item: MetaPreview }) {
  const [open, setOpen] = useState(false);
  const { inLibrary } = useLibraryToggle(item);
  const { inAny } = usePlaylistChecklist(item);
  const saved = !!inLibrary || inAny;
  return (
    <>
      <Action label={saved ? "Added" : "Add to List"} pressed={saved} onClick={() => setOpen(true)}>
        {saved ? <IconCheck size={28} stroke={1.6} /> : <IconPlus size={28} stroke={1.5} />}
      </Action>
      <PlaylistTray item={item} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The download glyph for a whole season. */
export function SeasonDownloadGlyph() {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5v10.5M7.5 9.5l4.5 4.5 4.5-4.5M4 17.5h16M6.5 20.5h11" />
    </svg>
  );
}
