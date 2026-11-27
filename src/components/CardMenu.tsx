import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "../styles/ui/card-menu.css";
import { api } from "../lib/api";
import { useNavigation } from "../lib/router";
import { useTitleActions } from "../lib/library";
import type { MetaPreview, Progress } from "../lib/types";
import ArrowTopRightOnSquare from "@heroicons/react/24/outline/ArrowTopRightOnSquareIcon";
import ArrowUturnLeft from "@heroicons/react/24/outline/ArrowUturnLeftIcon";
import CheckIcon from "@heroicons/react/24/outline/CheckIcon";
import CheckCircle from "@heroicons/react/24/outline/CheckCircleIcon";
import EyeIcon from "@heroicons/react/24/outline/EyeIcon";
import EyeSlash from "@heroicons/react/24/outline/EyeSlashIcon";
import Film from "@heroicons/react/24/outline/FilmIcon";
import InformationCircle from "@heroicons/react/24/outline/InformationCircleIcon";
import MinusCircle from "@heroicons/react/24/outline/MinusCircleIcon";
import PlayIcon from "@heroicons/react/24/outline/PlayIcon";
import PlusIcon from "@heroicons/react/24/outline/PlusIcon";
import QueueList from "@heroicons/react/24/outline/QueueListIcon";
import XMark from "@heroicons/react/24/outline/XMarkIcon";
import type { ComponentType, SVGProps } from "react";
import { PlaylistChecklist, usePlaylistChecklist } from "./title/PlaylistChecklist";
import { nativeDialogsAvailable, showNativeDialog, type DialogAction } from "../lib/platform";
import { warnFailed } from "../lib/errors";
import { imdbUrl } from "./RatingRing";
import { trailerFor } from "../lib/playback";
import { openTrailer } from "./Trailer";
import { sizedArt } from "../lib/ui";
import { MenuItem, MenuPopup, MenuRoot, MenuSub } from "./ui/Menu";

/**
 * A title's options on right-click (or the Menu key) in desktop mode, and on a
 * long press on iOS: the same choices as TV mode's options menu, as a small menu
 * at the pointer, or on iOS as the system's own menu. One menu for the whole
 * app, so a grid of hundreds of cards costs nothing.
 */

interface Target {
  item: MetaPreview;
  /** The progress the card stands for (Continue Watching): adds that episode's own actions. */
  entry?: Progress;
  /** Opened on an episode of the show's own page, not a Continue Watching card. */
  episode?: boolean;
  /** Custom remover for Continue Watching Up Next cards (dismisses until a newer episode finishes). */
  onRemoveContinue?: () => void;
  /** Where "Go to Show" leads, when not the title's own page (an anime's AniList page). */
  open?: () => void;
  /** False when the title has no id the library knows (an anime with no IMDb or Kitsu link): only "Go to Show". */
  linked?: boolean;
  x: number;
  y: number;
  key: number;
}

let current: Target | null = null;
let opened = 0;
const listeners = new Set<() => void>();
const set = (next: Target | null) => {
  current = next;
  listeners.forEach((l) => l());
};

/** Where a context-menu event points; from the keyboard (Menu key, Shift+F10) there's no pointer, so at the card. */
export function menuPoint(e: ReactMouseEvent<HTMLElement>) {
  let { clientX: x, clientY: y } = e;
  if (!x && !y) {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left + Math.min(32, r.width / 2);
    y = r.top + Math.min(32, r.height / 2);
  }
  return { x, y };
}

/** Opens the menu for `item` at `at`, for cards that work out their title first. */
export function openCardMenu(item: MetaPreview, at: { x: number; y: number }, open?: () => void, { linked = true } = {}) {
  set({ item, open, linked, ...at, key: ++opened });
}

/** Spread on a card: `<button {...cardMenu(item)}>`. */
export function cardMenu(
  item: MetaPreview,
  entry?: Progress,
  { episode = false, onRemoveContinue }: { episode?: boolean; onRemoveContinue?: () => void } = {},
) {
  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      set({ item, entry, episode, onRemoveContinue, ...menuPoint(e), key: ++opened });
    },
  };
}

export function CardMenuHost() {
  const target = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!target) return null;
  if (target.linked === false) return <UnlinkedMenu key={target.key} target={target} />;
  return <OpenMenu key={target.key} target={target} />;
}

/**
 * The menu's glyphs: one outline set (Heroicons, the app's icon library) at one weight, as a Mac's menus draw theirs,
 * rather than filled and outlined icons side by side. Sized by styles/ui/card-menu.css.
 */
const glyph = (Icon: ComponentType<SVGProps<SVGSVGElement>>) => <Icon aria-hidden strokeWidth={1.6} />;
const Play = () => glyph(PlayIcon);
const Info = () => glyph(InformationCircle);
const Trailer = () => glyph(Film);
const Watched = () => glyph(CheckCircle);
const Reset = () => glyph(ArrowUturnLeft);
const Close = () => glyph(XMark);
const Plus = () => glyph(PlusIcon);
const Minus = () => glyph(MinusCircle);
const Check = () => glyph(CheckIcon);
const PlaylistIcon = () => glyph(QueueList);
const Hidden = () => glyph(EyeSlash);
const Shown = () => glyph(EyeIcon);
const ExternalGlyph = () => glyph(ArrowTopRightOnSquare);

/** A zero-size point where the pointer was. */
const pointAnchor = (x: number, y: number) => ({ getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) });

/**
 * One of a title's choices. The web menu draws them with their icons; iOS lists them in its own menu, with
 * `symbol` (an SF Symbol) beside the main ones, as its own apps' menus have: open, play, watched, keep.
 * `playlists` is the Add to Playlist submenu.
 */
type Choice = {
  id: string;
  label: string;
  icon: ReactNode;
  symbol?: string;
  run?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  playlists?: boolean;
};
/** The choices in groups, a separator between groups. */
type Choices = { detail?: string; groups: Choice[][]; settled: boolean };

const goTo = (target: Target, navigate: ReturnType<typeof useNavigation>["navigate"], series: boolean): Choice => ({
  id: "open",
  label: series ? "Go to Show" : "Go to Movie",
  icon: <Info />,
  symbol: "info.circle",
  run: target.open ?? (() => navigate({ name: "detail", type: target.item.type, id: target.item.id, preview: target.item })),
});

/** The menu of a title nothing else can be done with yet: its page. */
function useUnlinkedChoices(target: Target): Choices {
  const { navigate } = useNavigation();
  return { groups: [[goTo(target, navigate, target.item.type === "series")]], settled: true };
}

function useLinkedChoices(target: Target): Choices {
  const { item, entry, episode } = target;
  const { navigate } = useNavigation();
  const a = useTitleActions(item, entry);
  const imdb = imdbUrl(item.id);
  const play: Choice[] = [];
  if (entry)
    play.push({
      id: "play",
      label: a.entryInProgress ? "Resume" : "Play",
      icon: <Play />,
      symbol: "play",
      run: () => navigate({ name: "player", type: entry.type, metaId: entry.metaId, videoId: entry.videoId }),
    });
  play.push(goTo(target, navigate, a.isSeries));
  if (a.trailerYtId || item.id.startsWith("tt"))
    play.push({ id: "trailer", label: "Play Trailer", icon: <Trailer />, symbol: "film", run: () => openTrailer(trailerFor(item.name, item.id, a)) });

  const watched: Choice[] = [];
  if (a.episodeUnwatched) watched.push({ id: "episode-watched", label: `Mark ${a.episodeLabel} as Watched`, icon: <Watched />, symbol: "checkmark.circle", run: a.markEpisodeWatched });
  if (a.episodeWatched) watched.push({ id: "episode-unwatched", label: `Mark ${a.episodeLabel} as Unwatched`, icon: <Reset />, symbol: "arrow.uturn.backward.circle", run: a.markEpisodeUnwatched });
  watched.push({
    id: "watched",
    label: `Mark ${a.isSeries ? "Show " : ""}as ${a.allWatched ? "Unwatched" : "Watched"}`,
    icon: a.allWatched ? <Reset /> : <Watched />,
    symbol: a.allWatched ? "arrow.uturn.backward.circle" : "checkmark.circle",
    disabled: !a.canToggleWatched,
    run: a.toggleWatched,
  });
  if (a.entryInProgress || target.onRemoveContinue)
    watched.push({
      id: "reset-entry",
      label: episode ? `Reset ${a.episodeLabel} Progress` : "Remove from Continue Watching",
      icon: episode ? <Reset /> : <Close />,
      destructive: !episode,
      run: () => {
        if (target.onRemoveContinue) target.onRemoveContinue();
        else a.resetEntry();
      },
    });
  if (a.hasProgress && !a.allWatched)
    watched.push({ id: "reset-all", label: a.isSeries ? "Reset Show Progress" : "Reset Progress", icon: <Reset />, run: a.resetAll });

  const keep: Choice[] = [
    {
      id: "library",
      label: a.inLibrary ? "Remove from Library" : "Add to Library",
      icon: a.inLibrary ? <Minus /> : <Plus />,
      symbol: a.inLibrary ? "minus.circle" : "plus",
      destructive: a.inLibrary,
      run: a.toggleLibrary,
    },
    { id: "playlists", label: a.inPlaylist ? "Playlists" : "Add to Playlist", icon: a.inPlaylist ? <Check /> : <PlaylistIcon />, symbol: "text.badge.plus", playlists: true },
    // Out of Home, Discover and recommendations; Search still finds it (lib/library/hiddenTitles.ts).
    { id: "hide", label: a.hidden ? "Unhide This Title" : "Hide This Title", icon: a.hidden ? <Shown /> : <Hidden />, symbol: a.hidden ? "eye" : "eye.slash", run: a.toggleHidden },
  ];

  const out: Choice[] = [];
  if (imdb) {
    out.push({ id: "imdb", label: "Open on IMDb", icon: <ExternalGlyph />, run: () => void api.openExternal(imdb) });
    if (item.type === "movie")
      out.push({ id: "letterboxd", label: "Open on Letterboxd", icon: <ExternalGlyph />, run: () => void api.openExternal(letterboxdUrl(item.id)) });
  }

  return {
    detail: a.episodeLabel && entry ? `${a.episodeLabel}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}` : undefined,
    groups: [play, watched, keep, out].filter((g) => g.length),
    settled: a.settled,
  };
}

function UnlinkedMenu({ target }: { target: Target }) {
  const choices = useUnlinkedChoices(target);
  return nativeDialogsAvailable ? <NativeMenu target={target} choices={choices} /> : <WebMenu target={target} choices={choices} />;
}

function OpenMenu({ target }: { target: Target }) {
  const choices = useLinkedChoices(target);
  return nativeDialogsAvailable ? <NativeMenu target={target} choices={choices} /> : <WebMenu target={target} choices={choices} />;
}

/**
 * The menu as Family draws its option trays (benji.org/family-values): what it's about at the top (the poster, its
 * name, the year or the episode), then the choices in filled, rounded groups with air between them rather than
 * rules, each row a soft fill under the pointer, the ones that take something away in red. It grows out of the
 * pointer (styles/ui/card-menu.css).
 */
function WebMenu({ target, choices }: { target: Target; choices: Choices }) {
  const { item, x, y } = target;
  const year = item.releaseInfo?.match(/\d{4}/)?.[0];
  const kind = item.type === "series" ? "Show" : item.type === "movie" ? "Movie" : undefined;
  const detail = choices.detail ?? ([year, kind].filter(Boolean).join(" · ") || undefined);
  const poster = sizedArt(item.poster, "w185");
  return (
    <MenuRoot open modal={false} onOpenChange={(open) => !open && set(null)}>
      <MenuPopup
        anchor={pointAnchor(x, y)}
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="fam-menu"
        aria-label={`${item.name} options`}
      >
        <div className="fam-menu-head">
          <span className="fam-menu-art" aria-hidden>
            {poster && <img src={poster} alt="" decoding="async" />}
          </span>
          <span className="fam-menu-name">
            <strong>{item.name}</strong>
            {detail && <span>{detail}</span>}
          </span>
        </div>
        {choices.groups.map((group) => (
          <div key={group[0].id} className="fam-menu-group" role="group">
            {group.map((c) =>
              c.playlists ? (
                <MenuSub key={c.id} icon={c.icon} label={c.label} popupClassName="fam-menu fam-menu-sub">
                  <PlaylistChecklist item={item} look="menu" />
                </MenuSub>
              ) : (
                <MenuItem key={c.id} icon={c.icon} disabled={c.disabled} onClick={() => c.run?.()}>
                  {c.destructive ? <span className="fam-menu-danger">{c.label}</span> : c.label}
                </MenuItem>
              ),
            )}
          </div>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/** How long iOS's menu waits for a title's progress and library to load before it opens with what it has. */
const SETTLE_MS = 800;
/** The menu shown last: StrictMode mounts each menu twice, and iOS should show one. */
let nativeShown = 0;
const NEW_PLAYLIST = "playlist:new";
const playlistId = (id: string) => `playlist:${id}`;

/**
 * iOS: the choices as the system's menu where the finger was (an action sheet before iOS 17.4), the playlists as
 * its submenu. It's drawn once, so it waits for the title's state, or SETTLE_MS, first.
 */
function NativeMenu({ target, choices }: { target: Target; choices: Choices }) {
  const playlists = usePlaylistChecklist(target.item);
  const latest = useRef({ choices, playlists });
  latest.current = { choices, playlists };
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  const ready = choices.settled || waited;

  useEffect(() => {
    if (!ready || nativeShown === target.key) return;
    nativeShown = target.key;
    const { choices, playlists } = latest.current;
    const offered = choices.groups.flat().filter((c) => !c.disabled);
    const children: DialogAction[] = [
      ...playlists.rows.map((r) => ({ id: playlistId(r.id), label: r.name, style: "default", checked: r.has }) as const),
      ...(playlists.full ? [] : [{ id: NEW_PLAYLIST, label: "New Playlist", style: "default" } as const]),
    ];
    const actions = choices.groups.flatMap((group, i) =>
      group
        .filter((c) => !c.disabled)
        .map((c): DialogAction => ({
          id: c.id,
          label: c.label,
          style: c.destructive ? "destructive" : "default",
          group: i,
          ...(c.symbol ? { symbol: c.symbol } : {}),
          ...(c.playlists ? { children } : {}),
        })),
    );
    showNativeDialog({ kind: "menu", title: target.item.name, message: choices.detail, anchor: { x: target.x, y: target.y, width: 0, height: 0 }, actions })
      .then((picked) => {
        const { playlists } = latest.current;
        if (picked === NEW_PLAYLIST) return void playlists.create();
        const row = playlists.rows.find((r) => playlistId(r.id) === picked);
        if (row) return playlists.toggle(row);
        offered.find((c) => c.id === picked && !c.playlists)?.run?.();
      })
      .catch(warnFailed("card menu"))
      .finally(() => set(null));
  }, [ready, target]);
  return null;
}

/** Letterboxd finds a film by its IMDb id. */
export const letterboxdUrl = (imdbId: string) => `https://letterboxd.com/imdb/${imdbId}/`;
