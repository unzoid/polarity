import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { AccountFullToast } from "../components/AccountFullToast";
import { Avatar } from "../components/Avatar";
import { CardMenuHost } from "../components/CardMenu";
import { useNativeSwipe } from "../components/NativeBack";
import { OpenFilesHost } from "../components/OpenFiles";
import { PlayerLayer, usePlayerLayer } from "../components/PlayerLayer";
import { ProfileMenu } from "../components/ProfileMenu";
import { HiddenTitleToast } from "../components/HiddenTitleToast";
import { LockedKeysToast } from "../components/LockedKeysToast";
import { SecretsSyncToast } from "../components/SecretsSyncToast";
import { StoreProblemToast } from "../components/StoreProblemToast";
import { TrailerHost } from "../components/Trailer";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { UpdateToast, WhatsNewSheet } from "../components/Updates";
import { SeriesPickToast } from "../components/anime/SeriesPickToast";
import { useAccount } from "../lib/account";
import { ALL_GENRES, BROWSE_GENRES } from "../lib/catalog";
import { useSettings } from "../lib/net";
import { leaveApp, systemBack } from "../lib/platform";
import { rootTab, useRouter, type Entry, type Route } from "../lib/router";
import { isSettingsOpen, usePrefs } from "../lib/settings";
import { dismissDepth, onDismissDepth, pressEscape, systemBackAction, useSystemBack, watchInputModality } from "../lib/ui";
import { IconAnime, IconBack, IconHome, IconSearch } from "./icons";
import { ListOverlay } from "./ListOverlay";
import { OPEN_MS, OPEN_OMEGA, samples, reduced } from "./motion";
import { NotificationsSheet } from "./NotificationsSheet";
import { takeOrigin, watchOrigins, type Origin } from "./origin";
import { PhoneHome, type HomeView } from "./PhoneHome";
import { PhoneMy } from "./PhoneMy";
import { PhoneSearch } from "./PhoneSearch";
import { PhoneSection } from "./PhoneSection";
import { TabHeader } from "./Header";
import { categories } from "./store";
import { TitleSheet } from "./TitleSheet";

type Run = { key: number; kind: "sheet"; entries: Entry[] } | { key: number; kind: "page"; entries: [Entry] };
type Shown = Run & { leaving?: boolean };

const isTitle = (e: Entry) => e.route.name === "detail" || e.route.name === "anime-detail";

/** The pages over a tab's own page: titles one after another share a sheet; anything else is a page of its own. */
function runsOf(overlays: Entry[]): Run[] {
  const runs: Run[] = [];
  for (const e of overlays) {
    const last = runs[runs.length - 1];
    if (isTitle(e) && last?.kind === "sheet") last.entries.push(e);
    else runs.push(isTitle(e) ? { key: e.key, kind: "sheet", entries: [e] } : { key: e.key, kind: "page", entries: [e] });
  }
  return runs;
}

/**
 * The phone app, built as Netflix's: three tabs (Home, Search, My Polarity) behind a floating bar, each keeping its
 * page; a title opening as a sheet out of the poster tapped (titles opened from it stacking in the same sheet); any
 * other page pushed in from the side with a back bar. The pages themselves (a person, a genre, Downloads…) are the
 * app's own screens (`Screen`).
 */
export function PhoneApp({ Screen }: { Screen: ComponentType<{ route: Route }> }) {
  const { stack, kept, current, back, backTo, tab } = useRouter();
  const { playing, player, leaving: playerLeaving } = usePlayerLayer(current);
  const { data: settings } = useSettings();
  const pages = useMemo(() => stack.filter((e) => e.route.name !== "player"), [stack]);
  const root = pages[0];
  const runs = useMemo(() => runsOf(pages.slice(1)), [pages]);
  const [homeView, setHomeView] = useState<HomeView>({ kind: "all" });

  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.phoneUi = "";
    return () => void delete html.dataset.phoneUi;
  }, []);
  useEffect(() => watchOrigins(), []);
  useEffect(watchInputModality, []);

  // Each sheet's poster, noted the first time its run is seen (the tap that opened it was just now).
  const origins = useRef(new Map<number, Origin | undefined>());
  for (const r of runs) if (r.kind === "sheet" && !origins.current.has(r.key)) origins.current.set(r.key, takeOrigin());

  // Runs that went (Back, Close) stay drawn while they leave; a tab switch takes them away at once.
  const [gone, setGone] = useState<{ root: number; runs: Shown[] }>({ root: root.key, runs: [] });
  const prevRuns = useRef<Run[]>(runs);
  const prevRoot = useRef(root.key);
  if (prevRuns.current !== runs || prevRoot.current !== root.key) {
    const now = new Set(runs.map((r) => r.key));
    const left = prevRoot.current === root.key ? prevRuns.current.filter((r) => !now.has(r.key)).map((r) => ({ ...r, leaving: true })) : [];
    prevRuns.current = runs;
    const sameRoot = prevRoot.current === root.key;
    prevRoot.current = root.key;
    if (left.length || !sameRoot) setGone((g) => ({ root: root.key, runs: [...(sameRoot ? g.runs : []), ...left] }));
  }
  const leavingRuns = gone.root === root.key ? gone.runs.filter((g) => !runs.some((r) => r.key === g.key)) : [];
  // A run that went keeps its place: under the runs still there that were over it, over those under it.
  const shown: Shown[] = [...runs, ...leavingRuns].sort((a, b) => a.key - b.key);
  const finish = (key: number) => {
    origins.current.delete(key);
    setGone((g) => ({ ...g, runs: g.runs.filter((r) => r.key !== key) }));
  };
  const firstSheet = shown.findIndex((r) => r.kind === "sheet" && !r.leaving);
  const barZ = firstSheet >= 0 ? 19 + firstSheet * 2 : 500;

  // Back: Escape, Android's back, iOS's edge swipe; at a tab's own page, Home, then out of the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing || isSettingsOpen() || e.defaultPrevented) return;
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, back]);
  const open = () => !!playing || isSettingsOpen() || dismissDepth() > 0;
  useSystemBack(
    () => {
      const action = systemBackAction({ open: open(), pushed: stack.length - 1, atHome: rootTab(stack).name === "home", swipe: systemBack === "swipe" });
      if (action === "escape") pressEscape();
      else if (action === "home") tab({ name: "home" });
      else if (action === "leave") void leaveApp();
    },
    () => undefined,
  );
  const layers = useSyncExternalStore(onDismissDepth, dismissDepth);
  useNativeSwipe(!!playing || layers > 0 || stack.length > 1);

  // Kept tab pages, in key order (moving one would reset its scroll); the current one shown.
  const tabs = useMemo(() => [...new Map([...kept, root].map((e) => [e.key, e])).values()].sort((a, b) => a.key - b.key), [kept, root]);
  const stage = useRef<HTMLDivElement>(null);
  const fadeFrom = useRef(root);
  useLayoutEffect(() => {
    if (fadeFrom.current.key === root.key) return;
    const from = fadeFrom.current;
    fadeFrom.current = root;
    const el = stage.current?.querySelector<HTMLElement>(`:scope > [data-tab-key="${root.key}"]`);
    const old = stage.current?.querySelector<HTMLElement>(`:scope > [data-tab-key="${from.key}"]`);
    if (!el || reduced()) return;
    // A cross-fade with a short slide toward where the tab is in the bar: the new page comes from its side, the
    // old one leaves toward the other. The old page stays drawn under the new one meanwhile.
    const dir = Math.sign(tabIndex(root.route) - tabIndex(from.route)) || 1;
    const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    old?.setAttribute("data-fading", "");
    const out = old?.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: `${-dir * 36}px 0` }], { duration: 220, easing: ease, fill: "forwards" });
    const a = el.animate([{ opacity: 0, translate: `${dir * 48}px 0` }, { opacity: 1, translate: "0 0" }], { duration: 320, easing: ease });
    void a.finished.finally(() => {
      out?.cancel();
      old?.removeAttribute("data-fading");
    });
  }, [root]);

  return (
    <div
      className="ph app"
      data-card-titles={settings?.showCardTitles ?? false}
      data-card-details={settings?.showCardDetails ?? false}
      data-card-ratings={settings?.showCardRatings ?? false}
      data-rating-position={settings?.cardRatingPosition ?? "poster"}
      data-rating-colors={settings?.ratingColors ?? false}
      data-player-leaving={playerLeaving}
    >
      <div className="ph-main" inert={!!playing || undefined}>
        <div className="ph-stage" ref={stage}>
          {tabs.map((e) => (
            <section key={e.key} className="ph-tab" data-tab-key={e.key} data-active={e === root} inert={e !== root || runs.length > 0 || undefined}>
              <ErrorBoundary where={`tab ${e.route.name}`}>
                <TabPage route={e.route} active={e === root && !runs.length && !playing} homeView={homeView} onHomeView={setHomeView} Screen={Screen} />
              </ErrorBoundary>
            </section>
          ))}
        </div>
        <TabBar root={root} z={barZ} onTop={(key) => backTo(key)} />
        {shown.map((r, i) => {
          const z = 20 + i * 2;
          const close = () => {
            const at = stack.findIndex((e) => e.key === r.key);
            if (at > 0) backTo(stack[at - 1].key);
          };
          if (r.kind === "sheet")
            return (
              <ErrorBoundary key={r.key} where="title sheet">
                <TitleSheet entries={r.entries} leaving={!!r.leaving} origin={origins.current.get(r.key)} z={z} onGone={() => finish(r.key)} onClose={close} onBack={back} />
              </ErrorBoundary>
            );
          return <PushedPage key={r.key} entry={r.entries[0]} leaving={!!r.leaving} z={z} top={i === shown.length - 1} onGone={() => finish(r.key)} onBack={back} Screen={Screen} />;
        })}
      </div>
      <Categories onPick={(genre, type) => {
        setHomeView({ kind: "genre", genre, type });
        if (root.route.name !== "home") tab({ name: "home" });
        else if (pages.length > 1) backTo(root.key);
      }} />
      <div className="sheet-host" />
      <ProfileMenu trigger={false} />
      <NotificationsSheet />
      <ErrorBoundary where="toasts" quiet>
        <div className="toast-stack">
          <SeriesPickToast />
          <HiddenTitleToast tv={false} />
          <UpdateToast hidden={!!playing} />
        </div>
      </ErrorBoundary>
      <ErrorBoundary where="what's new" quiet>
        <WhatsNewSheet />
      </ErrorBoundary>
      <PlayerLayer player={player} leaving={playerLeaving} />
      <ErrorBoundary where="notices" quiet>
        <div className="toast-stack toast-stack-notice">
          <StoreProblemToast tv={false} />
          <AccountFullToast tv={false} />
          <SecretsSyncToast tv={false} />
          <LockedKeysToast tv={false} />
        </div>
      </ErrorBoundary>
      <ErrorBoundary where="card menu" quiet>
        {!playing && <CardMenuHost />}
      </ErrorBoundary>
      <ErrorBoundary where="trailer" quiet>
        <TrailerHost />
      </ErrorBoundary>
      <ErrorBoundary where="open files" quiet>
        <OpenFilesHost />
      </ErrorBoundary>
    </div>
  );
}

function TabPage({
  route,
  active,
  homeView,
  onHomeView,
  Screen,
}: {
  route: Route;
  active: boolean;
  homeView: HomeView;
  onHomeView: (v: HomeView) => void;
  Screen: ComponentType<{ route: Route }>;
}) {
  if (route.name === "home") return <PhoneHome view={homeView} onView={onHomeView} />;
  if (route.name === "search") return <PhoneSearch active={active} />;
  if (route.name === "library") return <PhoneMy />;
  if (route.name === "anime") return <AnimeTab Screen={Screen} route={route} />;
  // Another section opened as a tab (the start page, a link): the app's own screen under a plain bar.
  return (
    <div className="ph-tab-page ph-other">
      <PageBar title={titleOf(route)} />
      {/* Shown whenever its tab is (a sheet over it keeps it drawn); the tab itself hides it otherwise. */}
      <div className="page" data-active="true">
        <Screen route={route} />
      </div>
    </div>
  );
}

/** The bar's three places. My Polarity's glyph is the profile's picture, as My Netflix's is. */
function TabBar({ root, z, onTop }: { root: Entry; z: number; onTop: (key: number) => void }) {
  const { stack, tab } = useRouter();
  const account = useAccount();
  const me = account.status !== "guest" ? account.profile : null;
  const at = root.route.name;
  const { animeEnabled } = usePrefs();
  const items: { id: "home" | "search" | "anime" | "library"; label: string; glyph: ReactNode }[] = [
    { id: "home", label: "Home", glyph: <IconHome size={26} /> },
    { id: "search", label: "Search", glyph: <IconSearch size={26} stroke={2} /> },
    // Anime, when it's switched on (Settings → Anime): a section of its own, as on the big screens.
    ...(animeEnabled ? [{ id: "anime" as const, label: "Anime", glyph: <IconAnime size={26} /> }] : []),
    { id: "library", label: "My Polarity", glyph: <Avatar id={me?.avatar ?? "guest"} className="ph-bar-avatar" /> },
  ];
  const index = items.findIndex((i) => i.id === at);
  return (
    <nav className="ph-bar" style={{ zIndex: z, "--n": items.length, "--at": Math.max(0, index) } as CSSProperties} aria-label="Sections">
      <span className="ph-bar-lens" data-hidden={index < 0 || undefined} aria-hidden />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="ph-bar-item"
          aria-current={it.id === at ? "page" : undefined}
          onClick={() => {
            if (it.id !== at) return tab({ name: it.id });
            // The tab you're on: back to its page, or to the page's top.
            if (stack.length > 1) return onTop(root.key);
            document.querySelector<HTMLElement>(`.ph-tab[data-tab-key="${root.key}"] .ph-scroll`)?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="ph-bar-glyph">{it.glyph}</span>
          <span className="ph-bar-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** A pushed page's bar: Back and the page's name, over the page as the app's screens expect (`--nav-h`). */
function PageBar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="ph-pagebar">
      {onBack && (
        <button type="button" className="ph-pagebar-back" aria-label="Back" onClick={onBack}>
          <IconBack size={26} stroke={2.2} />
        </button>
      )}
      <h1>{title}</h1>
    </header>
  );
}

/** A page pushed over the tabs (a person, a genre, Downloads…): in from the right, out to it, on the same spring. */
function PushedPage({
  entry,
  leaving,
  z,
  top,
  onGone,
  onBack,
  Screen,
}: {
  entry: Entry;
  leaving: boolean;
  z: number;
  top: boolean;
  onGone: () => void;
  onBack: () => void;
  Screen: ComponentType<{ route: Route }>;
}) {
  const el = useRef<HTMLElement>(null);
  /** What this page came in over (the tabs, a sheet or another page): it slides a third of the way off and back. */
  const under = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    let below = el.current?.previousElementSibling as HTMLElement | null;
    while (below && below.classList.contains("ph-bar")) below = below.previousElementSibling as HTMLElement | null;
    under.current = below;
    if (reduced()) return;
    const frames = samples(OPEN_OMEGA, OPEN_MS);
    el.current?.animate(
      frames.map(({ offset, p }) => ({ offset, transform: `translateX(${((1 - p) * 100).toFixed(3)}%)` })),
      { duration: OPEN_MS, easing: "linear" },
    );
    below?.animate(
      frames.map(({ offset, p }) => ({ offset, translate: `${(-UNDER_SHIFT * p).toFixed(3)}% 0` })),
      { duration: OPEN_MS, easing: "linear", fill: "forwards", id: "under" },
    );
  }, []);
  useLayoutEffect(() => {
    if (!leaving) return;
    const below = under.current;
    const settle = () => {
      below?.getAnimations().forEach((a) => a.id === "under" && a.cancel());
      onGone();
    };
    if (reduced() || !el.current) return settle();
    const ease = { duration: 320, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" } as const;
    const a = el.current.animate([{ transform: "none" }, { transform: "translateX(100%)" }], ease);
    below?.getAnimations().forEach((x) => x.id === "under" && x.cancel());
    below?.animate([{ translate: `-${UNDER_SHIFT}% 0` }, { translate: "0 0" }], { ...ease, id: "under" });
    void a.finished.finally(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  return (
    <section
      ref={el}
      className="page ph-pushed"
      style={{ zIndex: z }}
      data-active={top && !leaving}
      data-page-key={entry.key}
      inert={!top || leaving || undefined}
      // The page's own large title scrolled away: the bar takes its name (iOS's large titles).
      onScrollCapture={(e) => {
        const t = e.target as HTMLElement;
        el.current?.toggleAttribute("data-scrolled", t.scrollTop > 44);
      }}
    >
      {entry.route.name === "discover" ? (
        // A section: the phone's own page for it, with its own bar.
        <ErrorBoundary where="section">
          <PhoneSection type={entry.route.type} catalog={entry.route.catalog} genre={entry.route.genre} addon={entry.route.addon} onBack={onBack} />
        </ErrorBoundary>
      ) : (
        <>
          <PageBar title={titleOf(entry.route)} onBack={onBack} />
          <ErrorBoundary where={`page ${entry.route.name}`}>
            <Screen route={entry.route} />
          </ErrorBoundary>
        </>
      )}
    </section>
  );
}

/** How far (% of its width) a page slides away under one pushed over it, as iOS's do. */
const UNDER_SHIFT = 30;

/** The tabs' order, for which way a switch slides. */
const TAB_ORDER = ["home", "search", "anime", "library"];
const tabIndex = (r: Route) => {
  const i = TAB_ORDER.indexOf(r.name);
  return i < 0 ? TAB_ORDER.length : i;
};

function titleOf(route: Route): string {
  switch (route.name) {
    case "discover":
      return route.genre ?? (route.type === "movie" ? "Movies" : "Shows");
    case "library-collection":
      return { saved: "My List", watched: "Watched", playlists: "Playlists", downloads: "Downloads" }[route.view];
    case "playlist":
      return "Playlist";
    case "person":
      return route.title ?? "";
    case "calendar":
      return "Calendar";
    case "anime":
      return "Anime";
    case "anime-schedule":
      return "Schedule";
    case "anime-browse":
      return route.title ?? "Browse";
    case "settings":
      return "Settings";
    case "home":
      return "Home";
    case "search":
      return "Search";
    case "library":
      return "My Polarity";
    default:
      return "";
  }
}

/** Home's Categories: the genres for what Home shows (all, Shows or Movies), in Netflix's full-screen list. */
function Categories({ onPick }: { onPick: (genre: string, type?: "movie" | "series") => void }) {
  const scope = categories.use();
  const list = scope === "movie" || scope === "series" ? BROWSE_GENRES[scope] : ALL_GENRES;
  return (
    <ListOverlay
      open={scope !== null}
      label="Categories"
      options={list.map((g) => ({ id: g, label: g }))}
      onPick={(g) => {
        categories.set(null);
        onPick(g, scope === "movie" || scope === "series" ? scope : undefined);
      }}
      onClose={() => categories.set(null)}
    />
  );
}

/**
 * The Anime tab: the app's Anime page under the same bar as the other tabs (its name, Downloads, the bell and
 * Settings), which takes its backing as the page scrolls under it.
 */
function AnimeTab({ Screen, route }: { Screen: ComponentType<{ route: Route }>; route: Route }) {
  const head = useRef<HTMLElement | null>(null);
  const frameRef = useRef(0);
  const lastRef = useRef(-1);
  // The Anime page scrolls inside itself, mounted later (a lazy chunk): its scroll is read as it bubbles up
  // and written only to the header element (never the whole `.ph-tab-page`) coalesced per animation frame.
  const none = useRef<HTMLElement>(null);
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);
  return (
    <div
      className="ph-tab-page ph-anime"
      onScrollCapture={(e) => {
        const target = e.target as HTMLElement;
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0;
          const c = Math.min(1, Math.max(0, target.scrollTop / 56));
          if (c === lastRef.current) return;
          lastRef.current = c;
          head.current?.style.setProperty("--c", c.toFixed(3));
        });
      }}
    >
      <TabHeader scroller={none} headRef={head}>
        <h1 className="ph-head-name">Anime</h1>
      </TabHeader>
      <div className="page" data-active="true">
        <Screen route={route} />
      </div>
    </div>
  );
}
