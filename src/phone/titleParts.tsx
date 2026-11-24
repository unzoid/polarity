import { useState, type ReactNode } from "react";
import { IconBack, IconClose } from "./icons";

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

/** The download glyph for a whole season. */
export function SeasonDownloadGlyph() {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5v10.5M7.5 9.5l4.5 4.5 4.5-4.5M4 17.5h16M6.5 20.5h11" />
    </svg>
  );
}
