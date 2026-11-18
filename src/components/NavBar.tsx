import { EdgeBlur } from "./EdgeBlur";
import logo from "../assets/polarity-white.png";
import { Calendar, ChevronDown, Close, Search, Speed, Trailer, Tv } from "./icons";
import {
  addRecentSearch,
  clearRecentSearches,
  FOCUS_SEARCH_EVENT,
  SEARCH_ANIME,
  SEARCH_GENRES,
  setSearchText,
  useRecentSearches,
  useSearchText,
} from "../lib/catalog";
import { setTvMode, tvModeAvailable } from "../tv/tvMode";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { rootTab, useRouter, type TabRoute } from "../lib/router";
import { usePrefs, useSettingsOverlay } from "../lib/settings";
import { dismissDepth, lazyNamed, onDismissDepth, useFormFactor, useHandFocus, usePresence } from "../lib/ui";
import { MOD_LABEL, nativeTabsAvailable } from "../lib/platform";
import { useSettings } from "../lib/net";
import { WindowControls } from "./WindowControls";
import { ProfileMenu } from "./ProfileMenu";
import { UpdatePill } from "./Updates";
import { setPartyMenuOpen, useParty, usePartyMenuOpen } from "../lib/party";
import { PartyFaces, partyBadgeLabel } from "./party/PartyUI";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./ui/Popover";

const PartyMenu = lazyNamed(() => import("./party/PartyMenu"), "PartyMenu");
import { Chip } from "./ui/Chip";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "./ui/Menu";
import { useNativeTabs } from "./NativeTabs";
import { useNativeBack } from "./NativeBack";
import { BackButton } from "./BackButton";
import { backHistory, type NavLink } from "../lib/navTabs";
import { preloadRoute } from "../screens/lazyScreens";

const LINKS: NavLink[] = [
  { route: { name: "home" }, label: "Home" },
  { route: { name: "discover", type: "series" }, label: "Series" },
  { route: { name: "discover", type: "movie" }, label: "Movies" },
  { route: { name: "anime" }, label: "Anime" },
  { route: { name: "library" }, label: "Library" },
];
/** A phone's last tab: Search is a page of its own there (screens/Search.tsx). */
const SEARCH: NavLink = { route: { name: "search" }, label: "Search" };
/** Settings → Browsing → Show the Calendar (off by default). */
const CALENDAR: NavLink = { route: { name: "calendar" }, label: "Calendar" };

const SCROLLED_AT = 8;

/**
 * Top navigation in the modern Netflix pattern, doubling as the window's
 * title bar (drag region + window controls).
 *
 * It floats transparent over hero art, and settles onto a solid material once
 * the page scrolls under it — a state change, so the background crossfades
 * via an opacity-only layer rather than repainting a gradient.
 */
export function NavBar() {
  const { stack, current, tab, back } = useRouter();
  const active = rootTab(stack);
  const isActive = (r: TabRoute) => JSON.stringify(r) === JSON.stringify(active);
  // On a phone search is a page of its own (screens/Search.tsx), left with Back like any other. Elsewhere its
  // results are closed by clearing the navbar's field, not with Back.
  const phone = useFormFactor().form === "phone";
  const canGoBack = stack.length > 1 && (phone || current.name !== "search");
  // Back to a top-level page with focus on Back: it hides, so focus moves off it first (test report 1, item 25).
  const backButton = useRef<HTMLButtonElement>(null);
  useHandFocus(backButton, !canGoBack);
  // On iOS the system draws Back here, while nothing covers the page (lib/platform/nativeBack.ts).
  const layers = useSyncExternalStore(onDismissDepth, dismissDepth);
  const settingsOpen = useSettingsOverlay().open;
  const covered = layers > 0 || settingsOpen || current.name === "player";
  const nativeBack = useNativeBack(backButton, canGoBack && !covered, backHistory(stack), (steps) => {
    // Never further than the stack goes, whatever number comes over the bridge.
    for (let i = 0; i < Math.min(steps, stack.length - 1); i++) back();
  });
  const scrolled = useActivePageScrolled(stack[stack.length - 1]?.key);
  const { data: settings } = useSettings();
  const { animeEnabled, showTvButton } = usePrefs();
  const showCalendar = !!settings?.showCalendar;
  const sections = useMemo(() => (animeEnabled ? LINKS : LINKS.filter((l) => l.route.name !== "anime")), [animeEnabled]);
  // A phone's tab bar (iOS's own or ours) holds the five sections; the Calendar is a button in the top bar there,
  // as on an iPad with iOS's tab bar. A sixth tab would make iOS add its own More tab (#449).
  const calendarButton = showCalendar && (phone || nativeTabsAvailable);
  // A phone's tab bar is Home, Anime, Library and Search, as phone apps have it: Series and Movies are the two
  // buttons beside the profile in the top bar, where Search used to be.
  const catalogs = useMemo(() => (phone ? sections.filter((l) => l.route.name === "discover") : []), [phone, sections]);
  const tabs = useMemo(() => (phone ? [...sections.filter((l) => l.route.name !== "discover"), SEARCH] : sections), [phone, sections]);
  const links = useMemo(() => (showCalendar && !calendarButton ? [...tabs, CALENDAR] : tabs), [showCalendar, calendarButton, tabs]);
  useNativeTabs(tabs);
  useSearchTab(phone);

  return (
    <header className="navbar" data-scrolled={scrolled} data-tauri-drag-region>
      <EdgeBlur className="navbar-fade" edge="top" />
      {/* Always takes its place, so the brand and tabs never shift when it appears. */}
      <BackButton
        ref={backButton}
        className="navbar-back"
        data-shown={canGoBack}
        data-native-back={nativeBack || undefined}
        onClick={back}
        inert={!canGoBack}
        tabIndex={canGoBack ? 0 : -1}
        disabled={!canGoBack}
      />
      {/* A phone's Search page names itself in the bar, as a phone app's large title does, instead of the wordmark. */}
      {phone && current.name === "search" ? (
        <h1 className="navbar-title">Search</h1>
      ) : (
        <button className="navbar-brand" onClick={() => tab({ name: "home" })} aria-label="Polarity home">
          <img className="brand-logo wordmark" src={logo} alt="Polarity" draggable={false} />
        </button>
      )}
      <NavLinks links={links} isActive={isActive} open={tab} />
      <div className="navbar-actions">
        <UpdatePill />
        <NavParty />
        {!phone && <SearchBox />}
        {catalogs.map((l) => (
          <button
            key={l.label}
            className="navbar-icon navbar-catalog pressable"
            aria-label={l.label}
            title={l.label}
            aria-current={active.name === "discover" && l.route.name === "discover" && active.type === l.route.type ? "page" : undefined}
            onClick={() => tab(l.route)}
          >
            {l.route.name === "discover" && l.route.type === "movie" ? <Trailer size={23} /> : <Tv size={23} />}
          </button>
        ))}
        {calendarButton && (
          <button
            className="navbar-icon pressable"
            aria-label="Calendar"
            aria-current={active.name === "calendar" ? "page" : undefined}
            onClick={() => tab(CALENDAR.route)}
          >
            <Calendar size={23} />
          </button>
        )}
        {showTvButton && tvModeAvailable && (
          <button className="navbar-icon pressable" aria-label="TV mode" title="TV mode" onClick={() => setTvMode(true)}>
            <Tv size={23} />
          </button>
        )}
        {/* Settings lives in the profile menu, for guests too. */}
        <ProfileMenu />
      </div>
      <WindowControls />
    </header>
  );
}

/** In a watch party while browsing: who's in it; opens the party menu (#156). */
function NavParty() {
  const party = useParty();
  // A party surface (lib/party/surface.ts): opening it closes any other.
  const open = usePartyMenuOpen();
  const shown = !!party?.playback && !party.knocking;
  useEffect(() => {
    if (!shown) setPartyMenuOpen(false);
  }, [shown]);
  if (!party || !shown) return null;
  return (
    <PopoverRoot open={open} onOpenChange={setPartyMenuOpen}>
      <PopoverTrigger className="party-badge pressable" aria-label={partyBadgeLabel(party)} title="Watch party" data-status={party.status}>
        <PartyFaces party={party} />
      </PopoverTrigger>
      <PopoverPopup sideOffset={8} align="end" collisionPadding={12} className="party-popover" aria-label="Watch party">
        <Suspense fallback={null}>
          <PartyMenu party={party} onClose={() => setPartyMenuOpen(false)} />
        </Suspense>
      </PopoverPopup>
    </PopoverRoot>
  );
}

/**
 * The tabs, as many as fit; the rest go in a "More" menu at the end, so a
 * narrow window never cuts one in half. Every tab stays rendered (the
 * overflowing ones invisible) so their widths can be measured.
 */
function NavLinks({ links, isActive, open }: { links: NavLink[]; isActive: (r: TabRoute) => boolean; open: (r: TabRoute) => void }) {
  const nav = useRef<HTMLElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const hadPill = useRef(false);
  const mousePressed = useRef(false);
  const [fit, setFit] = useState(links.length);
  const activeIndex = links.findIndex((l) => isActive(l.route));

  const syncPill = (instant: boolean) => {
    const el = nav.current;
    const bar = pill.current;
    if (!el || !bar) return;
    const current = el.querySelector<HTMLElement>(':scope > .navbar-link[aria-current="page"]:not([data-overflow])');
    if (!current || current.offsetWidth <= 0) {
      delete bar.dataset.shown;
      hadPill.current = false;
      return;
    }
    const snap = instant || !hadPill.current;
    if (snap) bar.dataset.instant = "true";
    else delete bar.dataset.instant;
    bar.style.transform = `translate3d(${current.offsetLeft}px, ${current.offsetTop}px, 0)`;
    bar.style.width = `${current.offsetWidth}px`;
    bar.style.height = `${current.offsetHeight}px`;
    bar.dataset.shown = "true";
    if (snap) void bar.offsetWidth;
    hadPill.current = true;
  };

  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    let live = true;
    const measure = () => {
      const tabs = [...el.querySelectorAll<HTMLElement>(":scope > .navbar-link:not(.navbar-more)")];
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const widths = tabs.map((t) => t.offsetWidth + gap);
      const room = el.clientWidth;
      if (widths.reduce((a, b) => a + b, 0) - gap <= room) {
        setFit(tabs.length);
        syncPill(true);
        return;
      }
      let used = (more.current?.offsetWidth ?? 90) + gap;
      let n = 0;
      while (n < widths.length && used + widths[n] <= room) used += widths[n++];
      setFit(n);
      syncPill(true);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [links]);

  useLayoutEffect(() => {
    syncPill(false);
  }, [activeIndex, fit, links]);

  const rest = links.slice(fit);
  return (
    <nav ref={nav} className="navbar-links" aria-label="Primary" data-tauri-drag-region>
      <span ref={pill} className="navbar-active-pill" aria-hidden="true" />
      {links.map((l, i) => (
        <button
          key={l.label}
          className="navbar-link"
          data-label={l.label}
          data-overflow={i >= fit || undefined}
          aria-hidden={i >= fit || undefined}
          tabIndex={i >= fit ? -1 : undefined}
          aria-current={isActive(l.route) ? "page" : undefined}
          onPointerEnter={() => preloadRoute(l.route)}
          onFocus={() => preloadRoute(l.route)}
          onPointerDown={(e) => {
            mousePressed.current = e.pointerType === "mouse" && e.button === 0;
            if (mousePressed.current) open(l.route);
          }}
          onClick={(e) => {
            if (e.detail > 0 && mousePressed.current) {
              mousePressed.current = false;
              return;
            }
            mousePressed.current = false;
            open(l.route);
          }}
        >
          {l.label}
        </button>
      ))}
      <MenuRoot modal={false}>
        <MenuTrigger
          ref={more}
          className="navbar-link navbar-more"
          data-overflow={rest.length ? undefined : true}
          aria-current={rest.some((l) => isActive(l.route)) ? "page" : undefined}
          onPointerEnter={() => rest.forEach((l) => preloadRoute(l.route))}
        >
          {rest.find((l) => isActive(l.route))?.label ?? "More"}
          <ChevronDown size={14} />
        </MenuTrigger>
        <MenuPopup look="roomy" sideOffset={8} align="start">
          {rest.map((l) => (
            <MenuItem key={l.label} onClick={() => open(l.route)}>
              {l.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </MenuRoot>
    </nav>
  );
}

/**
 * On a phone search is a tab of its own, as in phone apps (screens/Search.tsx). Asking for search (Ctrl K, a
 * link) opens that tab, or goes back to it from a title opened there; on it, the page's own field takes the ask.
 */
function useSearchTab(phone: boolean) {
  const { stack, tab, back } = useRouter();
  const latest = useRef({ stack, tab, back });
  latest.current = { stack, tab, back };

  useEffect(() => {
    if (!phone) return;
    const open = () => {
      const { stack, tab, back } = latest.current;
      if (stack[stack.length - 1].route.name === "search") return; // the page's field takes it (Search.tsx)
      const at = stack.map((e) => e.route.name).lastIndexOf("search");
      if (at < 0) tab({ name: "search" });
      else for (let i = at; i < stack.length - 1; i++) back();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, open);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, open);
  }, [phone]);
}

/**
 * The search icon opens into a field right in the navbar; results only take
 * over the page once you start typing. Clearing the field goes back to where
 * you were, and leaving the results page empties it.
 */
function SearchBox() {
  const { stack, current, navigate, back, tab } = useRouter();
  const text = useSearchText();
  const { animeEnabled, searchSuggestions } = usePrefs();
  const recent = useRecentSearches().slice(0, RECENT_SHOWN);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const onResults = current.name === "search";
  const inStack = stack.some((e) => e.route.name === "search");
  // Text outlives the navbar (a trip through TV mode unmounts it). Still on
  // the results: come back open, without the sweep. Left them meanwhile: start fresh.
  const resume = !!text && inStack;
  const [open, setOpen] = useState(resume);
  // Opened from the keyboard (Ctrl K, "/"): appear instantly, no transition.
  const [instant, setInstant] = useState(resume);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestShown = open && !text && searchSuggestions;
  const suggest = usePresence(suggestShown ? true : null, SUGGEST_OUT_MS);
  const suggestItems = useMemo(() => [...recent, ...SEARCH_GENRES, ...(animeEnabled ? SEARCH_ANIME : [])], [recent, animeEnabled]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestShown, recent.length, animeEnabled]);

  useEffect(() => {
    if (resume) return;
    setSearchText("");
    // Arrived on an empty results page (TV mode's search keeps its own text): leave it.
    if (onResults) {
      if (stack.length > 1) back();
      else tab({ name: "home" });
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expand = () => {
    setInstant(false);
    setOpen(true);
    input.current?.focus();
  };

  const change = (value: string) => {
    setSearchText(value);
    if (value.trim() && !inStack) navigate({ name: "search" });
    if (!value.trim() && onResults) back();
  };

  // Left the results page some other way (a tab, Back): start fresh next time.
  const wasInStack = useRef(inStack);
  useEffect(() => {
    if (wasInStack.current && !inStack) {
      setSearchText("");
      if (document.activeElement !== input.current) setOpen(false);
    }
    wasInStack.current = inStack;
  }, [inStack]);

  // An empty field closes when you click anywhere else (blur alone misses
  // clicks that don't move focus, e.g. on the page background).
  useEffect(() => {
    if (!open || text) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".search-suggest")) {
        input.current?.blur();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, text]);

  useEffect(() => {
    const onFocus = () => {
      setInstant(true);
      setOpen(true);
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocus);
  }, []);

  return (
    <div ref={box} className="navbar-search" data-open={open} data-instant={instant}>
      <button
        className="navbar-search-icon"
        aria-label="Search"
        title={`Search (${MOD_LABEL} K)`}
        tabIndex={open ? -1 : 0}
        onClick={expand}
      >
        <Search size={23} strokeWidth={2} />
      </button>
      <input
        ref={input}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={() => !text && setOpen(false)}
        onKeyDown={(e) => {
          if (suggestShown && suggestItems.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % suggestItems.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (i <= 0 ? suggestItems.length - 1 : i - 1));
              return;
            }
            if (e.key === "Enter" && activeIndex >= 0 && activeIndex < suggestItems.length) {
              e.preventDefault();
              change(suggestItems[activeIndex]);
              return;
            }
          }
          if (e.key === "Enter") return addRecentSearch(text);
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (text) change("");
          else input.current?.blur();
        }}
        placeholder="Titles, genres…"
        spellCheck={false}
        aria-label="Search"
        tabIndex={open ? 0 : -1}
      />
      {suggest.shown && (
        <SearchSuggestions
          pick={change}
          under={box.current}
          leaving={suggest.leaving}
          activeIndex={activeIndex}
          recent={recent}
          animeEnabled={animeEnabled}
        />
      )}
      {open && text && (
        <button className="navbar-search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => change("")}>
          <Close size={16} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}

/** The recent searches shown above the genres. */
const RECENT_SHOWN = 3;
const SUGGEST_OUT_MS = 150;

/** The suggestions panel's width, and the least room it keeps from the window's edges. */
const SUGGEST_W = 440;
const SUGGEST_MARGIN = 16;

function suggestPosition(under: HTMLElement) {
  const r = under.getBoundingClientRect();
  const width = Math.min(SUGGEST_W, window.innerWidth - 2 * SUGGEST_MARGIN);
  const right = Math.max(SUGGEST_MARGIN, Math.min(window.innerWidth - r.right, window.innerWidth - SUGGEST_MARGIN - width));
  return { top: r.bottom + 8, right, width };
}

/** Under the empty field: your last searches, then genres to search by, one click or arrow-key away. */
function SearchSuggestions({
  pick,
  under,
  leaving,
  activeIndex,
  recent,
  animeEnabled,
}: {
  pick: (text: string) => void;
  under: HTMLElement | null;
  leaving: boolean;
  activeIndex: number;
  recent: string[];
  animeEnabled: boolean;
}) {
  const [pos, setPos] = useState(() => (under ? suggestPosition(under) : null));

  useLayoutEffect(() => {
    if (!under) return;
    const measure = () => {
      const next = suggestPosition(under);
      setPos((prev) => (prev && prev.top === next.top && prev.right === next.right && prev.width === next.width ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(under);
    if (under.parentElement) ro.observe(under.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [under]);

  if (!under || !pos) return null;
  const genreOffset = recent.length;
  const animeOffset = genreOffset + SEARCH_GENRES.length;
  const chips = (list: string[], offset: number) =>
    list.map((g, i) => (
      <Chip key={g} tabIndex={-1} data-highlighted={activeIndex === offset + i ? "true" : undefined} onClick={() => pick(g)}>
        {g}
      </Chip>
    ));
  return createPortal(
    // Keeps focus in the field, so it doesn't blur (and close) on the way.
    <div
      className="search-suggest"
      data-leaving={leaving || undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      style={{ top: pos.top, right: pos.right, width: pos.width }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {recent.length > 0 && (
        <>
          <div className="search-suggest-head">
            <span className="search-suggest-title">Recent</span>
            <button className="search-suggest-clear" tabIndex={-1} onClick={clearRecentSearches}>
              Clear
            </button>
          </div>
          <div className="search-recent">
            {recent.map((r, i) => (
              <button
                key={r}
                className="search-recent-item"
                tabIndex={-1}
                data-highlighted={activeIndex === i ? "true" : undefined}
                onClick={() => pick(r)}
              >
                <Speed size={16} aria-hidden />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <span className="search-suggest-title">Genres</span>
      <div className="genre-wrap">{chips(SEARCH_GENRES, genreOffset)}</div>
      {animeEnabled && (
        <>
          <span className="search-suggest-title">Anime</span>
          <div className="genre-wrap">{chips(SEARCH_ANIME, animeOffset)}</div>
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * Whether the visible page is scrolled. Each page owns its scroller, so listen
 * for scroll anywhere (capture) and look at the active one; re-check whenever
 * `topKey` changes (plus 1 rAF for lazy `.scroll` mounts), so root tab switches
 * and Back restore the right scrolled state immediately.
 */
function useActivePageScrolled(topKey: number | undefined) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => {
      const scroller = document.querySelector<HTMLElement>('.page[data-active="true"] .scroll');
      const next = (scroller?.scrollTop ?? 0) > SCROLLED_AT;
      setScrolled((prev) => (prev === next ? prev : next));
    };
    read();
    const raf = requestAnimationFrame(read);
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains("scroll")) return;
      if (t.closest(".page")?.getAttribute("data-active") !== "true") return;
      const next = t.scrollTop > SCROLLED_AT;
      setScrolled((prev) => (prev === next ? prev : next));
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [topKey]);
  return scrolled;
}
