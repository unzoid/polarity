import { Fragment, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useOptionalAccount } from "../../lib/account";
import { useDownload } from "../../lib/library";
import { partyAvailable, useParty } from "../../lib/party";
import type { PlayRequest } from "../../lib/playback";
import type { MetaPreview } from "../../lib/types";
import { useFormFactor } from "../../lib/ui";
import { DownloadButton } from "../DownloadButton";
import { Close, More, Play, Reset, Sources, Trailer, WatchParty } from "../icons";
import { PlaylistButton } from "../Playlists";
import { Button, IconButton } from "../ui/Button";
import { LibraryButton } from "./LibraryButton";
import type { SourcePickerState } from "./SourcePicker";
import { TraktRating } from "./TraktRating";

export type TitleActionsProps = {
  /** What Play and "Choose source" act on; nothing yet (or nothing playable) disables both. */
  request: PlayRequest | null | undefined | false | "";
  picker: SourcePickerState;
  /** The Play button's text ("Resume S2, E3", "Play First Episode"). */
  label: string;
  /** Resuming: the button shows the resume glyph instead of the play triangle. */
  resume: boolean;
  /** Tooltip on Play, e.g. why it's disabled. */
  playTitle?: string;
  /** What Play would play isn't known yet: Play shows a spinner instead of looking disabled (re-test N4). */
  loading?: boolean;
  /** Pointer on Play: warm its sources. */
  onWarm?: () => void;
  /** Shows the Trailer button. */
  onTrailer?: () => void;
  /** Shows the Library button for this item. */
  item?: MetaPreview;
  /** With `item`: also the playlist and (a movie's) download buttons. A show's downloads live with its episodes. */
  playlist?: boolean;
  download?: boolean;
  /** The page's own lesser actions (Hide This Title): with the others behind More. */
  more?: ReactNode;
  /** Trailing buttons of the page's own, always in view (the backdrop trailer's mute). */
  children?: ReactNode;
};

/**
 * The action row of a title page (docs/ui-components.md U5): Play, Trailer and Library in view, then More, which
 * opens in place to the lesser ones: Playlist, Choose source, Download, the Trakt rating (#85, only when linked) and
 * the page's own (`more`). A download under way stays in view, its progress with it. A phone has room for one row of
 * round buttons, so there they're all shown. TV draws its own column of pills (step 6).
 */
export function TitleActions({
  request,
  picker,
  label,
  resume,
  playTitle,
  loading,
  onWarm,
  onTrailer,
  item,
  playlist,
  download,
  more,
  children,
}: TitleActionsProps) {
  // A phone: Play across the width, then one row of round buttons under it, each glyph alone
  // (Trailer and Download had words, and wrapped onto rows of their own).
  const phone = useFormFactor().form === "phone";
  const profile = useOptionalAccount()?.profile ?? null;
  const party = useParty();
  const canStartParty = !!request && partyAvailable() && !!profile && !party;
  const { download: d, pending } = useDownload(item && download ? item.id : undefined);
  // Coming down, paused or failed: its ring and menu stay in view. Finished, it goes behind More with the rest.
  const downloadBusy = !!pending || (!!d && d.state !== "done");
  const downloadButton = item && download && <DownloadButton item={item} />;

  const lesser = [
    canStartParty && (
      <IconButton
        key="watch-party"
        variant="glass"
        onClick={() => picker.play({ ...request, startParty: true })}
        label="Watch Together"
        title="Watch Together"
      >
        <WatchParty size={19} />
      </IconButton>
    ),
    item && playlist && <PlaylistButton key="playlist" item={item} />,
    <IconButton key="sources" variant="glass" disabled={!request} onClick={() => request && picker.choose(request)} label="Choose source" title="Choose source">
      <Sources size={19} />
    </IconButton>,
    !downloadBusy && downloadButton && <Fragment key="download">{downloadButton}</Fragment>,
    item && <TraktRating key="trakt" item={item} />,
    more && <Fragment key="more">{more}</Fragment>,
  ];

  return (
    <div className="detail-actions">
      <Button
        variant="primary"
        className="detail-play"
        disabled={!request}
        busy={!request && loading}
        onClick={() => request && picker.play(request)}
        onPointerEnter={onWarm}
        title={!request && loading ? "Loading…" : playTitle}
      >
        {resume ? <Reset size={18} strokeWidth={2.5} /> : <Play size={18} fill="currentColor" />}
        {label}
      </Button>
      <div className="detail-actions-row">
        {onTrailer &&
          (phone ? (
            <IconButton variant="glass" onClick={onTrailer} label="Trailer" title="Trailer">
              <Trailer size={20} />
            </IconButton>
          ) : (
            <Button variant="glass" className="detail-trailer-btn" onClick={onTrailer}>
              <Trailer size={18} />
              Trailer
            </Button>
          ))}
        {item && <LibraryButton item={item} />}
        {downloadBusy && downloadButton}
        {phone ? lesser : <MoreActions>{lesser}</MoreActions>}
        {children}
      </div>
    </div>
  );
}

/**
 * More, opening in place (as Nuvio's title page does): the row makes room and the lesser buttons come in one after
 * another from beside it, while the dots turn into a close. Escape folds them away again. Folded, they're inert.
 */
function MoreActions({ children }: { children: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const items = children.filter(Boolean);
  if (!items.length) return null;
  return (
    <div
      className="detail-more"
      data-open={open || undefined}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <IconButton
        variant="glass"
        className="detail-more-toggle"
        label={open ? "Fewer actions" : "More actions"}
        title={open ? "Fewer actions" : "More actions"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <More size={20} className="detail-more-dots" />
        <Close size={18} className="detail-more-close" />
      </IconButton>
      <div className="detail-more-tray" id={id} inert={!open}>
        <div className="detail-more-items">
          {items.map((node, i) => (
            <span key={i} className="detail-more-item" style={{ "--i": i } as CSSProperties}>
              {node}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
