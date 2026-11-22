import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { EpisodeRatingsViews } from "../components/title/EpisodeRatingsViews";
import type { RatingGrid } from "../lib/library";
import type { Video } from "../lib/types";
import { IconClose } from "../phone/icons";

/**
 * Cardless full-screen frosted overlay for Episode Ratings, matching SourcesOverlay and ListDialog:
 * dark blurred scrim, centred header + segmented views floating directly on the canvas (no modal box),
 * and the signature round white ✕ button at the foot.
 */
export function DeskRatingsOverlay({
  grid,
  title,
  open,
  onClose,
  onOpen,
}: {
  grid: RatingGrid;
  title: string;
  open: boolean;
  onClose: () => void;
  onOpen: (v: Video) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogBackdrop className="dk-ratings-backdrop" />
      <DialogContent className="dk-ratings-overlay scheme-dark" initialFocus="content">
        <div className="dk-ratings-head">
          <DialogTitle className="dk-ratings-title">Episode Ratings</DialogTitle>
          <p className="dk-ratings-sub">{title}</p>
        </div>
        <div className="dk-ratings-body">
          <EpisodeRatingsViews
            grid={grid}
            onOpen={(v) => {
              onClose();
              onOpen(v);
            }}
          />
        </div>
        <DialogClose className="dk-list-close dk-ratings-close" aria-label="Close">
          <IconClose size={28} stroke={2} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
