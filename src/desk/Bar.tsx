import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import wordmark from "../assets/polarity-white.png";
import { Avatar } from "../components/Avatar";
import { Img } from "../components/Img";
import { WindowControls } from "../components/WindowControls";
import { useAccount } from "../lib/account";
import { useCalendar } from "../lib/catalog";
import { useDownloads } from "../lib/library";
import { useNavigation, useRouter, type Entry } from "../lib/router";
import { usePrefs } from "../lib/settings";
import { cardArtUrl } from "../lib/ui";
import { useCollapse } from "../phone/Header";
import { setTvMode, tvModeAvailable } from "../tv/tvMode";
import { ProfileButton } from "./Profiles";
import { BrandMark, IconAnime, IconBell, IconDownload, IconHome, IconSearch } from "../phone/icons";

/**
 * A tab's bar, over its page as Netflix's iPad app has it: Polarity's mark and the page's name on the left, Downloads,
 * the bell and Settings on the right (then the window's own buttons, on Windows and Linux). Clear at the top; scrolled,
 * it takes a backing from one value the scroll sets (`--c`, 0–1).
 */
export function TopBar({ title, lead, scroller, profile, logo, tint }: { title?: ReactNode; lead?: ReactNode; scroller: RefObject<HTMLElement | null>; profile?: boolean; logo?: boolean; tint?: CSSProperties }) {
  const bar = useRef<HTMLElement>(null);
  useCollapse(scroller, bar, 48);
  return (
    <header className="dk-bar" ref={bar} data-tauri-drag-region>
      <div className="dk-bar-bg" style={tint} aria-hidden />
      <div className="dk-bar-lead" data-tauri-drag-region>
        {lead ??
          (logo ? (
            <>
              <img className="dk-wordmark" src={wordmark} alt="Polarity" draggable={false} />
              {title && <span className="dk-bar-sub">{title}</span>}
            </>
          ) : (
            <>
              <BrandMark size={30} className="dk-bar-mark" />
              <h1 className="dk-bar-title">{title}</h1>
            </>
          ))}
      </div>
      <BarActions profile={profile} />
    </header>
  );
}

export function BarActions({ profile = true }: { profile?: boolean }) {
  return (
    <div className="dk-bar-actions">
      <DownloadsButton />
      <Notifications />
      <TvModeButton />
      {profile && <ProfileButton />}
      <WindowControls />
    </div>
  );
}

/** Sleek widescreen display button to switch into 10-foot TV mode (hidden if disabled in Settings). */
export function TvModeButton() {
  const { showTvButton } = usePrefs();
  if (!tvModeAvailable || !showTvButton) return null;
  return (
    <button
      type="button"
      className="dk-icon-btn"
      aria-label="TV Mode"
      title="Switch to TV Mode"
      onClick={() => setTvMode(true)}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="2.5" y="4.5" width="19" height="12.5" rx="2.5" />
        <path d="M8.5 20h7M12 17v3" />
        <path d="M10.4 8.7l3.8 2.05-3.8 2.05V8.7z" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}

export function DownloadsButton() {
  const { navigate } = useNavigation();
  const { data: downloads } = useDownloads();
  const active = (downloads ?? []).some((d) => d.state === "downloading");
  return (
    <button type="button" className="dk-icon-btn" aria-label="Downloads" data-busy={active || undefined} onClick={() => navigate({ name: "library-collection", view: "downloads" })}>
      <IconDownload size={26} />
    </button>
  );
}

const DAY = 86_400_000;

/** The bell: new episodes of your shows from the past week, newest first, in a panel under it. */
export function Notifications() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="dk-icon-btn" aria-label="Notifications">
        <IconBell size={26} />
      </PopoverTrigger>
      <PopoverContent className="dk-notes" side="bottom" align="end" sideOffset={10} collisionPadding={12}>
        <PopoverTitle className="dk-notes-title">Notifications</PopoverTitle>
        {open && <NoteList onPick={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function NoteList({ onPick }: { onPick: () => void }) {
  const { entries, loading } = useCalendar(true);
  const { navigate } = useNavigation();
  const today = new Date().setHours(0, 0, 0, 0);
  const recent = useMemo(() => entries.filter((e) => e.day <= today).sort((a, b) => b.day - a.day), [entries, today]);
  if (loading && !recent.length) return <p className="dk-notes-empty" aria-busy>Looking for new episodes…</p>;
  if (!recent.length) return <p className="dk-notes-empty">New episodes of the shows you follow show up here.</p>;
  return (
    <ul className="dk-notes-list">
      {recent.map(({ show, video, day }) => {
        const ago = Math.round((today - day) / DAY);
        return (
          <li key={video.id}>
            <button
              type="button"
              onClick={() => {
                onPick();
                navigate({ name: "detail", type: "series", id: show.id, episode: video.id });
              }}
            >
              <span className="dk-notes-still">
                <Img src={cardArtUrl(video.thumbnail ?? show.background, "landscape")} fallbacks={[cardArtUrl(show.background, "landscape")]} alt="" loading="lazy" />
              </span>
              <span className="dk-notes-text">
                <strong>New Episode</strong>
                <span>
                  {show.name}: S{video.season} E{video.episode}
                  {video.title?.trim() ? ` · ${video.title.trim()}` : ""}
                </span>
                <small>{ago === 0 ? "Today" : ago === 1 ? "Yesterday" : `${ago} days ago`}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type TabId = "home" | "anime" | "search" | "library";

/**
 * The floating bar at the foot, as Netflix's iPad app has it: Home, (Anime), Search and My Polarity (the profile's
 * picture as its glyph), a lighter capsule under the one you're on that slides to the next.
 */
export function TabBar({ root, hidden, onTop }: { root: Entry; hidden: boolean; onTop: (key: number) => void }) {
  const { stack, tab } = useRouter();
  const account = useAccount();
  const me = account.status !== "guest" ? account.profile : null;
  const at = root.route.name;
  const { animeEnabled } = usePrefs();
  const items: { id: TabId; label: string; glyph: ReactNode }[] = [
    { id: "home", label: "Home", glyph: <IconHome size={24} /> },
    ...(animeEnabled ? [{ id: "anime" as const, label: "Anime", glyph: <IconAnime size={24} /> }] : []),
    { id: "search", label: "Search", glyph: <IconSearch size={24} stroke={2} /> },
    { id: "library", label: "Library", glyph: <Avatar id={me?.avatar ?? "guest"} className="dk-tab-avatar" /> },
  ];
  const index = items.findIndex((i) => i.id === at);
  // The capsule appears where it is the first time, then slides.
  const [moved, setMoved] = useState(false);
  const first = useRef(index);
  useEffect(() => {
    if (index !== first.current) setMoved(true);
  }, [index]);
  return (
    <nav
      className="dk-tabs"
      data-hidden={hidden || undefined}
      data-moved={moved || undefined}
      style={{ "--n": items.length, "--at": Math.max(0, index) } as CSSProperties}
      aria-label="Sections"
      inert={hidden || undefined}
    >
      <span className="dk-tabs-lens" data-hidden={index < 0 || undefined} aria-hidden />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="dk-tab"
          aria-current={it.id === at ? "page" : undefined}
          onClick={() => {
            if (it.id !== at) return tab({ name: it.id });
            if (stack.length > 1) return onTop(root.key);
            document.querySelector<HTMLElement>(`.dk-tab-page[data-tab-key="${root.key}"] .dk-scroll`)?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="dk-tab-glyph">{it.glyph}</span>
          <span className="dk-tab-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
