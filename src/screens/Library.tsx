import { useMemo, useState, type ReactNode } from "react";
import { Dropdown } from "../components/Dropdown";
import { ConfirmDeleteButton } from "../components/ConfirmDeleteButton";
import { DownloadGlyph } from "../components/DownloadButton";
import { ChevronLeft, ChevronRight, Close, Download, Play, Plus, Trailer } from "../components/icons";
import { PlaylistTile, usePlaylistItem } from "../components/Playlists";
import { PosterCard } from "../components/PosterCard";
import { Card, ProgressBar } from "../components/title/Card";
import { errorMessage } from "../lib/errors";
import { formatRemaining } from "../lib/format";
import { watchedFraction } from "../lib/library";
import { fileKind, fileTitle, forgetRecent, playRecent, useRecentFiles, type RecentFile } from "../lib/localFiles";
import { Row } from "../components/Row";
import { StillPlaceholder } from "../components/StillPlaceholder";
import { localStream, useDownloads, useLeaving, type Download as DownloadRecord } from "../lib/library";
import { DownloadsPage, downloadLine } from "../components/downloads/DownloadsPage";
import { formatBytes } from "../lib/format";
import {
  createPlaylist,
  MAX_PLAYLISTS,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
  usePlaylists,
  type PlaylistItem,
} from "../lib/library";
import { useLibrary, useWatchHistory } from "../lib/net";
import { useRouter, type Route } from "../lib/router";
import { progressFraction, progressItem } from "../lib/catalog";
import type { ContentType } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";
import { PosterGrid } from "../components/title/PosterGrid";

type Collection = Extract<Route, { name: "library-collection" }>["view"];
type Open = { view: Collection } | { view: "playlist"; id: string; fresh: boolean };
type Kind = "all" | ContentType;
type Sort = "recent" | "title";

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Shows" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
];

/**
 * Your titles, nothing suggested. Laid out like Netflix's My Netflix: Downloads
 * as a panel up top, then a shelf from each collection. A shelf's heading opens
 * the whole collection (route `library-collection`), as Home's do; a playlist
 * opens from there (route `playlist`), so Esc and Back step out one page at a time.
 */
export function Library() {
  const open = useOpen();
  return (
    <div className="scroll">
      <Overview onOpen={open} />
    </div>
  );
}

/** Library's sub-pages go on the navigation stack, like Anime's. */
function useOpen() {
  const { navigate } = useRouter();
  return (o: Open) => navigate(o.view === "playlist" ? { name: "playlist", id: o.id, fresh: o.fresh } : { name: "library-collection", view: o.view });
}

/** One collection in full. */
export function LibraryCollection({ view }: { view: Collection }) {
  const { back } = useRouter();
  const open = useOpen();
  return (
    <div className="scroll">
      {view === "saved" && (
        <CollectionPage title="Saved" onBack={back} filters>
          {(kind, sort) => <Saved kind={kind} sort={sort} />}
        </CollectionPage>
      )}
      {view === "watched" && (
        <CollectionPage title="Watched" onBack={back} filters>
          {(kind, sort) => <WatchedGrid kind={kind} sort={sort} />}
        </CollectionPage>
      )}
      {view === "playlists" && (
        <CollectionPage title="Playlists" onBack={back}>
          {() => <Playlists onOpen={(id, fresh = false) => open({ view: "playlist", id, fresh })} />}
        </CollectionPage>
      )}
      {view === "downloads" && (
        <CollectionPage title="Downloads" onBack={back}>
          {() => <DownloadsPage />}
        </CollectionPage>
      )}
    </div>
  );
}

/** One playlist; its back button names the page it came from. */
export function LibraryPlaylist({ id, fresh }: { id: string; fresh: boolean }) {
  const { back, stack } = useRouter();
  // Where it was opened from (pages pushed on top later don't change it).
  const [backLabel] = useState(() => (stack[stack.length - 2]?.route.name === "library-collection" ? "Playlists" : "Library"));
  return (
    <div className="scroll">
      <PlaylistView id={id} fresh={fresh} onClose={back} backLabel={backLabel} />
    </div>
  );
}

// --- Overview --------------------------------------------------------------------------------

function Overview({ onOpen }: { onOpen: (o: Open) => void }) {
  const { data: saved } = useLibrary();
  const { data: history } = useWatchHistory();
  const watching = useWatching();
  const { data: downloads } = useDownloads();
  const playlists = usePlaylists();
  const dl = downloads ?? [];
  const { data: recentFiles = [] } = useRecentFiles();
  const nothing = saved?.length === 0 && history?.length === 0 && playlists.length === 0 && dl.length === 0 && !recentFiles.length;

  return (
    <>
      <header className="screen-header">
        <h1 className="t-title1">Library</h1>
      </header>
      <DownloadsPanel downloads={dl} onOpen={() => onOpen({ view: "downloads" })} />

      {nothing && <EmptyState>Titles you save, download, watch or put in a playlist gather here.</EmptyState>}

      <div className="rows library-rows">
        {!!history?.length && (
          <Row title="Recently Watched" onOpen={() => onOpen({ view: "watched" })}>
            {history.slice(0, 20).map((p) => (
              <PosterCard key={p.metaId} item={progressItem(p)} progress={progressFraction(p)} entry={p} />
            ))}
          </Row>
        )}
        {!!saved?.length && (
          <Row title="Saved" onOpen={() => onOpen({ view: "saved" })}>
            {saved.slice(0, 20).map((item) => (
              <PosterCard key={item.id} item={item} watching={watching.get(item.id)} />
            ))}
          </Row>
        )}
        {/* Always shown, so a first playlist can be started from here. */}
        <Row title="Playlists" onOpen={() => onOpen({ view: "playlists" })}>
          {playlists.map((p) => (
            <PlaylistTile key={p.id} playlist={p} onOpen={() => onOpen({ view: "playlist", id: p.id, fresh: false })} />
          ))}
          {playlists.length < MAX_PLAYLISTS && <NewPlaylistTile onCreate={(id) => onOpen({ view: "playlist", id, fresh: true })} />}
        </Row>
        {recentFiles.length > 0 && (
          <Row title="Recent Files" shape="landscape">
            {recentFiles.map((f) => (
              <RecentFileCard key={f.path} file={f} />
            ))}
          </Row>
        )}
      </div>
    </>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Downloads as one panel up top, as on Netflix: a heading that opens the full
 * page, what's on this device inside it, or where downloads will show when
 * there are none yet.
 */
function DownloadsPanel({ downloads, onOpen }: { downloads: DownloadRecord[]; onOpen: () => void }) {
  const finished = downloads.filter((d) => d.state === "done");
  const moving = downloads.length - finished.length;
  const bytes = finished.reduce((n, d) => n + (d.total ?? d.received), 0);
  const detail = moving
    ? `${moving} downloading`
    : finished.length
      ? `${count(finished.length, "video")} · ${formatBytes(bytes)}`
      : "Videos you download appear here.";
  return (
    <section className="library-panel">
      <button className="library-panel-head" onClick={onOpen}>
        <span className="library-panel-icon">
          <Download size={20} />
        </span>
        <span className="library-panel-text">
          <span className="library-panel-title">Downloads</span>
          <span className="library-panel-detail tabular">{detail}</span>
        </span>
        <ChevronRight size={20} className="library-panel-chevron" />
      </button>
      {downloads.length > 0 && (
        <Row shape="landscape">
          {downloads.slice(0, 16).map((d) => (
            <DownloadCard key={d.id} d={d} onOpen={onOpen} />
          ))}
        </Row>
      )}
    </section>
  );
}

/** The last tile among playlists: starts one and opens it with its name ready to type over. */
function NewPlaylistTile({ onCreate }: { onCreate: (id: string) => void }) {
  return (
    <button
      className="card card-poster playlist-tile"
      onClick={() => {
        const p = createPlaylist("New Playlist");
        if (p) onCreate(p.id);
      }}
    >
      <div className="card-frame playlist-new">
        <Plus size={28} />
        <span className="t-callout">New Playlist</span>
      </div>
    </button>
  );
}

/** One download on the overview's shelf: plays when it's here, else opens Downloads. */
function DownloadCard({ d, onOpen }: { d: DownloadRecord; onOpen: () => void }) {
  const play = usePlayDownload();
  const leaving = useLeaving(d.id);
  return (
    <Card
      shape="landscape"
      className="download-card"
      art={d.thumbnail ?? d.background ?? d.poster}
      fallback={<StillPlaceholder />}
      title={d.name}
      detail={downloadLine(d)}
      data-leaving={leaving || undefined}
      onClick={() => (d.state === "done" ? play(d) : onOpen())}
    >
      <div className="card-art-scrim" />
      <span className="download-card-state" data-state={d.state}>
        {d.state === "done" ? <Play size={14} fill="currentColor" /> : <DownloadGlyph d={d} size={18} />}
      </span>
    </Card>
  );
}

/**
 * A video file opened on this device (#204), kept here and never synced: plays from where it stopped,
 * with its folder's other videos as episodes. One that's gone says so; × takes it off the list.
 */
function RecentFileCard({ file }: { file: RecentFile }) {
  const { navigate } = useRouter();
  const [gone, setGone] = useState<string | null>(null);
  const fraction = file.duration > 0 ? file.position / file.duration : 0;
  const watched = fraction >= watchedFraction();
  const detail = gone ?? [formatBytes(file.size), watched ? "Watched" : fraction > 0.01 ? formatRemaining(file.position, file.duration) : ""].filter(Boolean).join(" · ");
  const open = () =>
    void playRecent(file.path).then(
      (route) => route && navigate(route),
      (e) => setGone(errorMessage(e)),
    );
  return (
    <Card
      shape="landscape"
      className="recent-file-card"
      fallback={
        <span className="recent-file-placeholder" aria-hidden>
          <Trailer size={28} />
        </span>
      }
      title={fileTitle(file.name)}
      detail={detail}
      hint={file.name}
      onClick={open}
      actions={
        <button
          type="button"
          className="recent-file-forget"
          aria-label={`Remove ${file.name} from Recent Files`}
          onClick={(e) => {
            e.stopPropagation();
            void forgetRecent(file.path);
          }}
        >
          <Close size={16} />
        </button>
      }
    >
      <span className="recent-file-kind">{fileKind(file.name)}</span>
      {!gone && !watched && fraction > 0.01 && <ProgressBar fraction={fraction} />}
    </Card>
  );
}

function usePlayDownload() {
  const { navigate } = useRouter();
  return (d: DownloadRecord) => navigate({ name: "player", type: d.type, metaId: d.metaId, videoId: d.id, stream: localStream(d) });
}

// --- A whole collection ----------------------------------------------------------------------

function CollectionPage({
  title,
  onBack,
  filters = false,
  children,
}: {
  title: string;
  onBack: () => void;
  filters?: boolean;
  children: (kind: Kind, sort: Sort) => ReactNode;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("recent");
  return (
    <>
      <header className="screen-header library-page-header">
        <div className="library-page-title">
          <button className="playlist-back t-callout" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={2.25} />
            Library
          </button>
          <h1 className="t-title1">{title}</h1>
        </div>
        {filters && (
          <div className="library-toolbar">
            <Dropdown label="Show" value={kind} onChange={setKind} options={KINDS} />
            <Dropdown label="Sort by" value={sort} onChange={setSort} options={SORTS} />
          </div>
        )}
      </header>
      {children(kind, sort)}
    </>
  );
}

function arrange<T extends { type: ContentType; name: string }>(items: T[] | undefined, kind: Kind, sort: Sort) {
  if (!items) return undefined;
  const shown = kind === "all" ? items : items.filter((i) => i.type === kind);
  return sort === "title" ? [...shown].sort((a, b) => a.name.localeCompare(b.name)) : shown;
}

/** Title id → the episode last watched, for saved anime shown by their entry with seasons as separate shows (#22). */
function useWatching(): ReadonlyMap<string, string> {
  const { data } = useWatchHistory();
  return useMemo(() => new Map((data ?? []).map((p) => [p.metaId, p.videoId])), [data]);
}

function Saved({ kind, sort }: { kind: Kind; sort: Sort }) {
  const { data } = useLibrary();
  const watching = useWatching();
  const items = useMemo(() => arrange(data, kind, sort), [data, kind, sort]);
  if (data?.length === 0) return <EmptyState>Titles you save with + on their page appear here.</EmptyState>;
  return (
    <>
      {items?.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
      <PosterGrid>
        {items?.map((item) => (
          <PosterCard key={item.id} item={item} watching={watching.get(item.id)} />
        ))}
      </PosterGrid>
    </>
  );
}

function WatchedGrid({ kind, sort }: { kind: Kind; sort: Sort }) {
  const { data } = useWatchHistory();
  const items = useMemo(() => arrange(data, kind, sort), [data, kind, sort]);
  if (data?.length === 0) return <EmptyState>Movies and shows you watch appear here.</EmptyState>;
  return (
    <>
      {items?.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
      <PosterGrid>
        {items?.map((p) => (
          <PosterCard key={p.metaId} item={progressItem(p)} progress={progressFraction(p)} entry={p} />
        ))}
      </PosterGrid>
    </>
  );
}

// --- Playlists -------------------------------------------------------------------------------

function Playlists({ onOpen }: { onOpen: (id: string, isNew?: boolean) => void }) {
  const playlists = usePlaylists();
  return (
    <>
      {playlists.length === 0 && (
        <p className="library-hint t-body muted">Group titles into playlists from their page, or start one here.</p>
      )}
      <PosterGrid>
        {playlists.map((p) => (
          <PlaylistTile key={p.id} playlist={p} onOpen={() => onOpen(p.id)} />
        ))}
        {playlists.length < MAX_PLAYLISTS && <NewPlaylistTile onCreate={(id) => onOpen(id, true)} />}
      </PosterGrid>
    </>
  );
}

function PlaylistView({ id, fresh, onClose, backLabel }: { id: string; fresh: boolean; onClose: () => void; backLabel: string }) {
  const playlist = usePlaylists().find((p) => p.id === id);
  if (!playlist) return null;
  const n = playlist.items.length;

  return (
    <div className="playlist-view">
      <div className="playlist-view-head">
        <button className="playlist-back t-callout" onClick={onClose}>
          <ChevronLeft size={16} strokeWidth={2.25} />
          {backLabel}
        </button>
        <div className="playlist-view-title">
          <input
            key={playlist.name}
            className="playlist-name-input t-title2"
            defaultValue={playlist.name}
            maxLength={60}
            aria-label="Playlist name"
            // A new playlist starts with its name selected, ready to type over.
            autoFocus={fresh}
            onFocus={(e) => fresh && e.currentTarget.select()}
            onBlur={(e) => {
              if (e.target.value.trim()) renamePlaylist(id, e.target.value);
              else e.target.value = playlist.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                e.currentTarget.value = playlist.name;
                e.currentTarget.blur();
              }
            }}
          />
          <span className="t-callout faint tabular">
            {n} {n === 1 ? "title" : "titles"}
          </span>
          <span className="playlist-view-spacer" />
          <ConfirmDeleteButton label="playlist" onConfirm={() => (deletePlaylist(id), onClose())} />
        </div>
      </div>
      {playlist.packed ? (
        <EmptyState>Made with a newer version of Polarity. Update Polarity to see its titles.</EmptyState>
      ) : n === 0 ? (
        <EmptyState>Add titles with the playlist button on their page.</EmptyState>
      ) : (
        <PosterGrid>
          {playlist.items.map((item) => (
            <PlaylistEntry key={item.id} playlistId={id} item={item} />
          ))}
        </PosterGrid>
      )}
    </div>
  );
}

function PlaylistEntry({ playlistId, item }: { playlistId: string; item: PlaylistItem }) {
  const shown = usePlaylistItem(item);
  return (
    <div className="playlist-entry">
      <PosterCard item={shown ?? { id: item.id, type: item.type, name: "" }} />
      <button
        className="playlist-remove"
        aria-label={`Remove ${shown?.name ?? "title"} from playlist`}
        title="Remove from playlist"
        onClick={() => removeFromPlaylist(playlistId, item.id)}
      >
        <Close size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
