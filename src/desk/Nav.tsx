import { useEffect, useRef, useState, type CSSProperties } from "react";
import logo from "../assets/polarity-white.png";
import { EdgeBlur } from "../components/EdgeBlur";
import { WindowControls } from "../components/WindowControls";
import { setSearchText, useSearchText } from "../lib/catalog";
import { useRouter, type Entry } from "../lib/router";
import { usePrefs } from "../lib/settings";
import { useFormFactor } from "../lib/ui";
import { IconSearch } from "../phone/icons";
import { DownloadsButton, Notifications, TvModeButton } from "./Bar";
import type { HomeView } from "./DeskHome";
import { ProfileButton } from "./Profiles";

/** How the desk app is driven: a computer gets Netflix's web bar along the top, a tablet the iPad app's floating tabs. */
export type Chrome = "nav" | "tabs";
export const useChrome = (): Chrome => (useFormFactor().form === "desktop" ? "nav" : "tabs");

/** Asks the bar's search to open and take the keyboard (the app's search shortcut). */
export const focusNavSearch = () => window.dispatchEvent(new Event("dk-search"));

type Link = { id: string; label: string; current: boolean; go: () => void };

/**
 * The bar along the top on a computer, as Netflix's web app has it: the wordmark, the sections as words (the one
 * you're on in a soft pill), then search, Downloads, the bell and your profile. Clear over the page's top; once
 * the page scrolls under it, it takes the page's colour (`--c`, set by DeskApp).
 */
export function NavBar({ root, pages, homeView, onHomeView, z }: { root: Entry; pages: Entry[]; homeView: HomeView; onHomeView: (v: HomeView) => void; z: number }) {
  const { tab, backTo } = useRouter();
  const { animeEnabled } = usePrefs();
  const at = root.route.name;
  const toRoot = () => pages.length > 1 && backTo(root.key);
  const home = (view: HomeView) => {
    onHomeView(view);
    if (at !== "home") tab({ name: "home" });
    else toRoot();
    if (at === "home" && pages.length === 1) document.querySelector<HTMLElement>(".dk-tab-page[data-active='true'] .dk-scroll")?.scrollTo({ top: 0 });
  };
  const section = (name: "anime" | "library") => (at === name ? toRoot() : tab({ name }));
  const topPage = pages[pages.length - 1];
  const onPushed = pages.length > 1 && topPage.route.name !== "detail" && topPage.route.name !== "anime-detail";
  const homeType = !onPushed && at === "home" ? (homeView.kind === "all" ? "all" : (homeView.type ?? "all")) : null;
  const links: Link[] = [
    { id: "home", label: "Home", current: homeType === "all", go: () => home({ kind: "all" }) },
    { id: "series", label: "Shows", current: homeType === "series", go: () => home({ kind: "type", type: "series" }) },
    { id: "movie", label: "Movies", current: homeType === "movie", go: () => home({ kind: "type", type: "movie" }) },
    ...(animeEnabled ? [{ id: "anime", label: "Anime", current: !onPushed && at === "anime", go: () => section("anime") }] : []),
    { id: "library", label: "Library", current: !onPushed && at === "library", go: () => section("library") },
  ];
  return (
    <header className="dk-nav" style={{ zIndex: z } as CSSProperties} data-tauri-drag-region>
      <EdgeBlur className="dk-nav-blur" edge="top" layers={6} step={3} curve={1.25} />
      <div className="dk-nav-bg" aria-hidden />
      <button type="button" className="dk-nav-logo" aria-label="Polarity, Home" onClick={() => home({ kind: "all" })}>
        <img src={logo} alt="" draggable={false} />
      </button>
      <nav className="dk-nav-links" aria-label="Sections">
        {links.map((l) => (
          <button key={l.id} type="button" className="dk-nav-link" aria-current={l.current ? "page" : undefined} onClick={l.go}>
            {l.label}
          </button>
        ))}
      </nav>
      <span className="dk-flex" data-tauri-drag-region />
      <div className="dk-nav-actions">
        <NavSearch onSearch={at === "search"} />
        <DownloadsButton />
        <Notifications />
        <TvModeButton />
        <ProfileButton />
        <WindowControls />
      </div>
    </header>
  );
}

/**
 * Netflix's search in the bar: a magnifier that opens into a field. Typing shows the Search page; clearing it, or
 * Escape on an empty field, goes back Home.
 */
function NavSearch({ onSearch }: { onSearch: boolean }) {
  const text = useSearchText();
  const { tab } = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(onSearch || !!text);
  const shown = open || onSearch || !!text;
  useEffect(() => {
    const focus = () => {
      setOpen(true);
      requestAnimationFrame(() => input.current?.focus());
    };
    window.addEventListener("dk-search", focus);
    return () => window.removeEventListener("dk-search", focus);
  }, []);
  useEffect(() => {
    if (onSearch) input.current?.focus({ preventScroll: true });
  }, [onSearch]);
  const leave = () => {
    setSearchText("");
    setOpen(false);
    input.current?.blur();
    if (onSearch) tab({ name: "home" });
  };
  if (!shown)
    return (
      <button type="button" className="dk-icon-btn" aria-label="Search" onClick={() => tab({ name: "search" })}>
        <IconSearch size={24} stroke={2} />
      </button>
    );
  return (
    <label className="dk-nav-search">
      <IconSearch size={20} stroke={2} />
      <input
        ref={input}
        type="search"
        aria-label="Search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Titles, people, genres"
        value={text}
        onChange={(e) => {
          setSearchText(e.target.value);
          if (e.target.value.trim() && !onSearch) tab({ name: "search" });
        }}
        onBlur={() => !text && !onSearch && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          if (text) setSearchText("");
          else leave();
        }}
      />
      {(text || onSearch) && (
        <button type="button" className="dk-nav-search-clear" aria-label="Close search" onPointerDown={(e) => e.preventDefault()} onClick={leave}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </label>
  );
}
