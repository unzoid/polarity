import { useRef, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Img } from "../components/Img";
import { PlaylistTile } from "../components/Playlists";
import { useAccount } from "../lib/account";
import { progressFraction, progressItem } from "../lib/catalog";
import { createPlaylist, MAX_PLAYLISTS, useDownloads, usePlaylists, useUpNextContinueWatching } from "../lib/library";
import { useLibrary, useWatchHistory } from "../lib/net";
import { useNavigation } from "../lib/router";
import { cardArtUrl } from "../lib/ui";
import { IconChevronRight, IconDownload, IconPlus } from "../phone/icons";
import { TopBar } from "./Bar";
import type { Chrome } from "./Nav";
import { openProfiles } from "./Profiles";
import { ContinueRow, Poster, Row } from "./Rows";

/**
 * My Polarity, as Netflix's iPad app has My Netflix: the profile's picture and name in the bar (a click opens
 * Profiles), Downloads as a card across the page, then My List, Continue Watching, what you've watched and your
 * playlists, each with Netflix's quiet box and one button while it's empty.
 */
export function DeskMy({ chrome }: { chrome: Chrome }) {
  const scroller = useRef<HTMLDivElement>(null);
  const account = useAccount();
  const me = account.status !== "guest" ? account.profile : null;
  const { navigate, tab } = useNavigation();
  const { data: saved } = useLibrary();
  const { data: history } = useWatchHistory();
  const playlists = usePlaylists();
  const watching = useUpNextContinueWatching();
  const profile = (
    <button type="button" className="dk-my-profile" aria-label="Profiles" onClick={openProfiles}>
      <Avatar id={me?.avatar ?? "guest"} className="dk-my-avatar" />
      <span className="dk-bar-title">{me?.name ?? "Guest"}</span>
      <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden>
        <path d="M2.5 4.8h9L7 9.8z" fill="currentColor" />
      </svg>
    </button>
  );
  return (
    <div className="dk-page dk-my">
      {chrome === "tabs" && <TopBar scroller={scroller} profile={false} lead={profile} />}
      <div className="dk-scroll" ref={scroller}>
        <DownloadsCard />
        <div className="dk-rows">
          {watching.length > 0 && <ContinueRow />}
          {saved?.length ? (
            <Row title="My List" count={saved.length} onMore={() => navigate({ name: "library-collection", view: "saved" })}>
              {saved.slice(0, 30).map((item) => (
                <Poster key={item.id} item={item} />
              ))}
            </Row>
          ) : (
            saved && (
              <Empty title="My List" button="Browse to Add to My List" onClick={() => tab({ name: "home" })}>
                Keep track of the shows and movies you want to watch next.
              </Empty>
            )
          )}
          {history?.length ? (
            <Row title="Watched" count={history.length} onMore={() => navigate({ name: "library-collection", view: "watched" })}>
              {history.slice(0, 30).map((p) => (
                <Poster key={p.metaId} item={progressItem(p)} entry={p} progress={progressFraction(p)} />
              ))}
            </Row>
          ) : (
            history && (
              <Empty title="Watched" button="Find Something to Watch" onClick={() => tab({ name: "home" })}>
                We'll keep what you've watched here.
              </Empty>
            )
          )}
          {playlists.length ? (
            <Row title="Playlists" count={playlists.length} onMore={() => navigate({ name: "library-collection", view: "playlists" })}>
              {playlists.map((p) => (
                <PlaylistTile key={p.id} playlist={p} onOpen={() => navigate({ name: "playlist", id: p.id })} />
              ))}
              {playlists.length < MAX_PLAYLISTS && (
                <button type="button" className="dk-list-card dk-list-new" onClick={() => newPlaylist(navigate)}>
                  <span className="dk-list-mosaic">
                    <IconPlus size={30} stroke={2} />
                  </span>
                  <span className="dk-list-name">New Playlist</span>
                </button>
              )}
            </Row>
          ) : (
            <Empty title="Playlists" button="Make a Playlist" onClick={() => newPlaylist(navigate)}>
              Put titles together in your own order, to watch or share.
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}

function newPlaylist(navigate: ReturnType<typeof useNavigation>["navigate"]) {
  const made = createPlaylist("New Playlist");
  if (made) navigate({ name: "playlist", id: made.id, fresh: true });
}

function Empty({ title, button, onClick, children }: { title: string; button: string; onClick: () => void; children: ReactNode }) {
  return (
    <section className="dk-row">
      <h2 className="dk-row-title">
        <span className="dk-row-name">{title}</span>
      </h2>
      <div className="dk-my-empty">
        <p>{children}</p>
        <button type="button" className="dk-my-empty-btn" onClick={onClick}>
          {button}
        </button>
      </div>
    </section>
  );
}

/** Netflix's Downloads card: always there, saying what's coming down when something is. */
function DownloadsCard() {
  const { data: downloads } = useDownloads();
  const { navigate } = useNavigation();
  const all = downloads ?? [];
  const active = all.filter((d) => d.state === "downloading" || d.state === "paused");
  const received = active.reduce((n, d) => n + d.received, 0);
  const total = active.reduce((n, d) => n + (d.total ?? 0), 0);
  const fraction = total ? Math.min(1, received / total) : 0;
  const first = active[0];
  const done = all.filter((d) => d.state === "done").length;
  return (
    <button type="button" className="dk-my-dl" onClick={() => navigate({ name: "library-collection", view: "downloads" })}>
      {first && (first.poster || first.background) ? (
        <span className="dk-my-dl-art">
          <Img src={cardArtUrl(first.poster ?? first.background, "poster")} alt="" />
        </span>
      ) : (
        <span className="dk-my-dl-glyph">
          <IconDownload size={26} />
        </span>
      )}
      <span className="dk-my-dl-text">
        <strong>Downloads</strong>
        {first ? (
          <>
            <small>{active.length === 1 ? `Downloading ${first.name}` : `Downloading ${active.length} titles`} · {total ? `${Math.round(fraction * 100)}%` : "Starting…"}</small>
            <span className="dk-my-dl-bar">
              <i style={{ width: `${Math.round(fraction * 100)}%` }} />
            </span>
          </>
        ) : (
          <small>{done ? `${done} ${done === 1 ? "title" : "titles"} ready to watch offline.` : "Shows and movies that you download appear here."}</small>
        )}
      </span>
      <IconChevronRight size={22} />
    </button>
  );
}
