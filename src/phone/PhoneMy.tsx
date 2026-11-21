import { useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Img } from "../components/Img";
import { openProfileSheet } from "../components/ProfileMenu";
import { useAccount } from "../lib/account";
import { progressFraction, progressItem } from "../lib/catalog";
import { createPlaylist, MAX_PLAYLISTS, useDownloads, usePlaylists, type Playlist } from "../lib/library";
import { useLibrary, useWatchHistory } from "../lib/net";
import { useNavigation } from "../lib/router";
import { cardArtUrl } from "../lib/ui";
import { TabHeader } from "./Header";
import { BrandMark, IconChevronRight, IconPlus } from "./icons";
import { Poster, Row } from "./Rows";
import { ContinueRow } from "../screens/Home";

/**
 * My Polarity: the profile in the bar (a tap opens Profiles; Downloads and the bell sit beside it as on every tab),
 * then what's yours: anything coming down right now, Continue Watching, My List, what you've watched and your
 * playlists. With nothing yet, one quiet note and a way to Home.
 */
export function PhoneMy() {
  const scroller = useRef<HTMLDivElement>(null);
  const account = useAccount();
  const me = account.status !== "guest" ? account.profile : null;
  const { navigate, tab } = useNavigation();
  const { data: saved } = useLibrary();
  const { data: history } = useWatchHistory();
  const playlists = usePlaylists();
  const empty = saved?.length === 0 && history?.length === 0 && playlists.length === 0;
  return (
    <div className="ph-tab-page ph-my">
      <TabHeader
        scroller={scroller}
        lead={
          <button type="button" className="ph-my-profile" aria-label="Profiles" onClick={openProfileSheet}>
            <Avatar id={me?.avatar ?? "guest"} className="ph-my-avatar" />
            <span className="ph-head-name">{me?.name ?? "Guest"}</span>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M2.5 4.8h9L7 9.8z" fill="currentColor" />
            </svg>
          </button>
        }
      >
        {null}
      </TabHeader>
      <div className="ph-scroll" ref={scroller}>
        <Downloading />
        {empty ? (
          <div className="ph-my-empty">
            {/* Three empty poster frames, fanned: the shelf that fills up. */}
            <svg className="ph-my-art" width="132" height="96" viewBox="0 0 132 96" fill="none" aria-hidden>
              <rect x="10" y="20" width="44" height="64" rx="6" transform="rotate(-10 32 52)" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
              <rect x="78" y="20" width="44" height="64" rx="6" transform="rotate(10 100 52)" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
              <rect x="42" y="12" width="48" height="70" rx="6" fill="var(--bg)" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.5" />
              <path d="M66 39v18M57 48h18" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <h2>Make it yours</h2>
            <p>Add titles to My List, start watching or make a playlist, and they'll gather here.</p>
            <button type="button" className="ph-btn ph-btn-white" onClick={() => tab({ name: "home" })}>
              Find Something to Watch
            </button>
          </div>
        ) : (
          <div className="ph-rows">
            <ContinueRow />
            {!!saved?.length && (
              <Row title="My List" count={saved.length} onMore={() => navigate({ name: "library-collection", view: "saved" })}>
                {saved.slice(0, 24).map((item) => (
                  <Poster key={item.id} item={item} />
                ))}
              </Row>
            )}
            {!!history?.length && (
              <Row title="Watched" count={history.length} onMore={() => navigate({ name: "library-collection", view: "watched" })}>
                {history.slice(0, 24).map((p) => (
                  <Poster key={p.metaId} item={progressItem(p)} entry={p} progress={progressFraction(p)} />
                ))}
              </Row>
            )}
            <Row title="Playlists" count={playlists.length || undefined} onMore={playlists.length ? () => navigate({ name: "library-collection", view: "playlists" }) : undefined}>
              {playlists.map((p) => (
                <PlaylistCard key={p.id} playlist={p} onOpen={() => navigate({ name: "playlist", id: p.id })} />
              ))}
              {playlists.length < MAX_PLAYLISTS && <NewPlaylist onMade={(p) => navigate({ name: "playlist", id: p.id, fresh: true })} />}
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}

/** What's coming down now, as one card: how many, how far along, the first one's art. Nothing when nothing is. */
function Downloading() {
  const { data: downloads } = useDownloads();
  const { navigate } = useNavigation();
  const active = (downloads ?? []).filter((d) => d.state === "downloading" || d.state === "paused");
  if (!active.length) return null;
  const received = active.reduce((n, d) => n + d.received, 0);
  const total = active.reduce((n, d) => n + (d.total ?? 0), 0);
  const fraction = total ? Math.min(1, received / total) : 0;
  const first = active[0];
  return (
    <button type="button" className="ph-my-dl" onClick={() => navigate({ name: "library-collection", view: "downloads" })}>
      <span className="ph-my-dl-art">{(first.poster || first.background) && <Img src={cardArtUrl(first.poster ?? first.background, "poster")} alt="" />}</span>
      <span className="ph-my-dl-text">
        <strong>{active.length === 1 ? `Downloading ${first.name}` : `Downloading ${active.length} titles`}</strong>
        <span className="ph-my-dl-bar">
          <i style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
        <small>{total ? `${Math.round(fraction * 100)}%` : "Starting…"}</small>
      </span>
      <IconChevronRight size={18} />
    </button>
  );
}

/** A playlist as a poster-sized tile: its first four titles' posters as a mosaic, its name and size under it. */
function PlaylistCard({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const posters = playlist.items.map((i) => i.poster).filter((p): p is string => !!p).slice(0, 4);
  return (
    <button type="button" className="ph-list-card" onClick={onOpen} aria-label={`${playlist.name}, ${playlist.items.length} titles`}>
      <span className="ph-list-mosaic" data-n={posters.length}>
        {posters.length ? posters.map((p, i) => <Img key={i} src={cardArtUrl(p, "poster")} alt="" loading="lazy" />) : <BrandMark size={30} />}
      </span>
      <span className="ph-list-name">{playlist.name}</span>
      <span className="ph-list-count">
        {playlist.items.length} {playlist.items.length === 1 ? "title" : "titles"}
      </span>
    </button>
  );
}

/** Starts a playlist and opens it, its name ready to type over. */
function NewPlaylist({ onMade }: { onMade: (p: Playlist) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="ph-list-card ph-list-new"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        const made = createPlaylist("New Playlist");
        setBusy(false);
        if (made) onMade(made);
      }}
    >
      <span className="ph-list-mosaic">
        <span className="ph-list-plus">
          <IconPlus size={26} stroke={2} />
        </span>
      </span>
      <span className="ph-list-name">New Playlist</span>
    </button>
  );
}
