import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { AccountFullToast } from "../components/AccountFullToast";
import { CardMenuHost } from "../components/CardMenu";
import { useNativeSwipe } from "../components/NativeBack";
import { OpenFilesHost } from "../components/OpenFiles";
import { PlayerLayer, usePlayerLayer } from "../components/PlayerLayer";
import { HiddenTitleToast } from "../components/HiddenTitleToast";
import { LockedKeysToast } from "../components/LockedKeysToast";
import { SecretsSyncToast } from "../components/SecretsSyncToast";
import { StoreProblemToast } from "../components/StoreProblemToast";
import { TrailerHost } from "../components/Trailer";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { UpdateToast, WhatsNewSheet } from "../components/Updates";
import { SeriesPickToast } from "../components/anime/SeriesPickToast";
import { useSettings } from "../lib/net";
import { appWindow, isDesktop, leaveApp, os, systemBack } from "../lib/platform";
import { rootTab, useRouter, type Entry, type Route } from "../lib/router";
import { actionFor, isSettingsOpen } from "../lib/settings";
import { dismissDepth, lazyNamed, onDismissDepth, pressEscape, systemBackAction, useSystemBack, watchInputModality, whenIdle } from "../lib/ui";
import { IconBack } from "../phone/icons";
import { OPEN_MS, OPEN_OMEGA, reduced, samples } from "../phone/motion";
import { takeOrigin, watchOrigins, type Origin } from "../phone/origin";
import { BarActions, TabBar, TopBar } from "./Bar";
import { DeskHome, type HomeView } from "./DeskHome";
import { focusNavSearch, NavBar, useChrome, type Chrome } from "./Nav";
import { Profiles } from "./Profiles";
import "./desk.css";

const DeskAnime = lazyNamed(() => import("./DeskAnime"), "DeskAnime");
const DeskDownloads = lazyNamed(() => import("./DeskDownloads"), "DeskDownloads");
const DeskMy = lazyNamed(() => import("./DeskMy"), "DeskMy");
const DeskSearch = lazyNamed(() => import("./DeskSearch"), "DeskSearch");
const DeskSection = lazyNamed(() => import("./DeskSection"), "DeskSection");
const TitleDialog = lazyNamed(() => import("./TitleDialog"), "TitleDialog");

type Run = { key: number; kind: "dialog"; entries: Entry[] } | { key: number; kind: "page"; entries: [Entry] };
type Shown = Run & { leaving?: boolean };

const isTitle = (e: Entry) => e.route.name === "detail" || e.route.name === "anime-detail";

/** The pages over a tab's own page: titles one after another share a dialog; anything else is a page of its own. */
function runsOf(overlays: Entry[]): Run[] {
  const runs: Run[] = [];
  for (const e of overlays) {
    const last = runs[runs.length - 1];
    if (isTitle(e) && last?.kind === "dialog") last.entries.push(e);
    else runs.push(isTitle(e) ? { key: e.key, kind: "dialog", entries: [e] } : { key: e.key, kind: "page", entries: [e] });
  }
  return runs;
}

/**
 * The app on a computer or tablet, built as Netflix's iPad app: Home, (Anime), Search and My Polarity behind a
 * floating bar, each keeping its page; a title opening as a dialog out of the poster clicked (titles opened from it
 * stacking in the same dialog); any other page pushed in from the side. The pushed pages (a person, Downloads…) are
 * the app's own screens (`Screen`).
 */
export function DeskApp({ Screen, Settings }: { Screen: ComponentType<{ route: Route }>; Settings: ComponentType }) {
  const { stack, kept, current, back, backTo, tab } = useRouter();
  const { playing, player, leaving: playerLeaving } = usePlayerLayer(current);
  const { data: settings } = useSettings();
  const pages = useMemo(() => stack.filter((e) => e.route.name !== "player"), [stack]);
  const root = pages[0];
  const runs = useMemo(() => runsOf(pages.slice(1)), [pages]);
  const [homeView, setHomeView] = useState<HomeView>({ kind: "all" });
  const chrome = useChrome();

  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.deskUi = "";
    html.dataset.deskChrome = chrome;
    return () => {
      delete html.dataset.deskUi;
      delete html.dataset.deskChrome;
    };
  }, [chrome]);
  // On Windows the desk layout keeps the system's own title bar (and its buttons); the classic layout draws its own.
  useEffect(() => {
    if (!isDesktop || os !== "windows") return;
    const html = document.documentElement;
    html.dataset.nativeFrame = "";
    void appWindow.setDecorations(true).catch(() => delete html.dataset.nativeFrame);
    return () => {
      delete html.dataset.nativeFrame;
      void appWindow.setDecorations(false).catch(() => {});
    };
  }, []);
  useEffect(() => watchOrigins(), []);
  useEffect(watchInputModality, []);
  // Warm TitleDialog only after initial load settles (skipping slow/metered connections so cold boot never competes).
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } };
    const c = nav.connection;
    if (c && (c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g" || (c.downlink && c.downlink < 2.5))) return;
    let cancelIdle: (() => void) | undefined;
    const t = window.setTimeout(() => {
      cancelIdle = whenIdle(() => void TitleDialog.preload().catch(() => {}), 3000);
    }, 5500);
    return () => {
      window.clearTimeout(t);
      cancelIdle?.();
    };
  }, []);

  const origins = useRef(new Map<number, Origin | undefined>());
  for (const r of runs) if (r.kind === "dialog" && !origins.current.has(r.key)) origins.current.set(r.key, takeOrigin());

  // Runs that went (Back, Close) stay drawn while they leave; a tab switch takes them away at once.
  const [gone, setGone] = useState<{ root: number; runs: Shown[] }>({ root: root.key, runs: [] });
  const prevRuns = useRef<Run[]>(runs);
  const prevRoot = useRef(root.key);
  if (prevRuns.current !== runs || prevRoot.current !== root.key) {
    const now = new Set(runs.map((r) => r.key));
    const sameRoot = prevRoot.current === root.key;
    const left = sameRoot ? prevRuns.current.filter((r) => !now.has(r.key)).map((r) => ({ ...r, leaving: true })) : [];
    prevRuns.current = runs;
    prevRoot.current = root.key;
    if (left.length || !sameRoot) setGone((g) => ({ root: root.key, runs: [...(sameRoot ? g.runs : []), ...left] }));
  }
  const leavingRuns = gone.root === root.key ? gone.runs.filter((g) => !runs.some((r) => r.key === g.key)) : [];
  const shown: Shown[] = [...runs, ...leavingRuns].sort((a, b) => a.key - b.key);
  const finish = (key: number) => {
    origins.current.delete(key);
    setGone((g) => ({ ...g, runs: g.runs.filter((r) => r.key !== key) }));
  };

  // Escape goes back, unless something with its own Escape has the keyboard (a dialog, a field with text in it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing || isSettingsOpen() || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && !typing && !t?.closest(".dk-dlg-frame, [data-slot='dialog-content'], [data-slot='popover-content']")) back();
      if (actionFor(e, "app") === "search" && (!typing || e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        if (chrome === "nav") focusNavSearch();
        else if (rootTab(stack).name !== "search") tab({ name: "search" });
        else document.querySelector<HTMLInputElement>(".dk-search .dk-field input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, back, stack, tab, chrome]);
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

  const tabs = useMemo(() => [...new Map([...kept, root].map((e) => [e.key, e])).values()].sort((a, b) => a.key - b.key), [kept, root]);
  const stage = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const navState = useRef<{ c: string; scrolled: boolean }>({ c: "", scrolled: false });
  const navRaf = useRef(0);
  const navTarget = useRef<HTMLElement | null>(null);
  const syncNavScroll = (top: number) => {
    let nav = navRef.current;
    if (!nav || !nav.isConnected) nav = navRef.current = document.querySelector<HTMLElement>(".dk-nav");
    if (!nav) return;
    const c = Math.min(1, Math.max(0, top / 48)).toFixed(3);
    const scrolled = top > 8;
    if (navState.current.c !== c) {
      navState.current.c = c;
      nav.style.setProperty("--c", c);
    }
    if (navState.current.scrolled !== scrolled) {
      navState.current.scrolled = scrolled;
      if (scrolled) nav.dataset.scrolled = "true";
      else delete nav.dataset.scrolled;
    }
  };
  useEffect(() => () => cancelAnimationFrame(navRaf.current), []);
  const fadeFrom = useRef(root);
  useLayoutEffect(() => {
    // Switching tabs can unmount a PushedPage or TitleDialog without a leaving transition: clear any
    // fill-forwards stage animations ("under" slide or "recede" scale) so the stage always lands at 0.
    stage.current?.getAnimations().forEach((a) => {
      if (a.id === "under" || a.id === "recede") a.cancel();
    });
    if (!document.querySelector(".dk-layer:not([data-leaving])")) stage.current?.removeAttribute("data-recede");
    if (chrome === "nav") {
      const activeScroll = stage.current?.querySelector<HTMLElement>(`.dk-tab-page[data-tab-key="${root.key}"] .dk-scroll`);
      syncNavScroll(activeScroll?.scrollTop ?? 0);
    }
    if (fadeFrom.current.key === root.key) return;
    const from = fadeFrom.current;
    fadeFrom.current = root;
    const el = stage.current?.querySelector<HTMLElement>(`:scope > [data-tab-key="${root.key}"]`);
    const old = stage.current?.querySelector<HTMLElement>(`:scope > [data-tab-key="${from.key}"]`);
    if (!el || reduced()) return;
    // A cross-fade with a short slide toward the tab's side of the bar; the old page stays drawn under the new one.
    const dir = Math.sign(tabIndex(root.route) - tabIndex(from.route)) || 1;
    const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    old?.setAttribute("data-fading", "");
    const out = old?.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: `${-dir * 40}px 0` }], { duration: 220, easing: ease, fill: "forwards" });
    const a = el.animate([{ opacity: 0, translate: `${dir * 56}px 0` }, { opacity: 1, translate: "0 0" }], { duration: 340, easing: ease });
    void a.finished.finally(() => {
      out?.cancel();
      old?.removeAttribute("data-fading");
    });
  }, [root]);

  const hasPushed = runs.some((r) => r.kind === "page");
  useLayoutEffect(() => {
    if (chrome !== "nav") return;
    const scroller = hasPushed
      ? document.querySelector<HTMLElement>(".dk-pushed[data-active='true'] .dk-scroll")
      : stage.current?.querySelector<HTMLElement>(`.dk-tab-page[data-tab-key="${root.key}"] .dk-scroll`);
    syncNavScroll(scroller?.scrollTop ?? 0);
  }, [chrome, root.key, hasPushed]);

  const firstDialog = shown.findIndex((r) => r.kind === "dialog" && !r.leaving);
  const barZ = firstDialog >= 0 ? 19 + firstDialog * 2 : 500;

  return (
    <div
      className="dk app"
      data-card-titles={settings?.showCardTitles ?? false}
      data-card-details={settings?.showCardDetails ?? false}
      data-card-ratings={settings?.showCardRatings ?? false}
      data-rating-position={settings?.cardRatingPosition ?? "poster"}
      data-rating-colors={settings?.ratingColors ?? false}
      data-player-leaving={playerLeaving}
      data-playing={!!playing || undefined}
    >
      <div
        className="dk-main"
        inert={!!playing || undefined}
        onPointerDownCapture={(e) => {
          const target = e.target as Element | null;
          if (target?.closest?.("[data-origin]")) {
            void TitleDialog.preload().catch(() => {});
            if (target.closest(".dk-anime, .dk-search")) void import("./AnimeTitleView").catch(() => {});
          }
        }}
      >
        <div
          className="dk-stage"
          ref={stage}
          // Under the computer's top bar, the bar takes its progressive blur as the page on show scrolls under it.
          onScrollCapture={(e) => {
            if (chrome !== "nav") return;
            const t = e.target as HTMLElement;
            // Ignore horizontal shelf strips and anything other than the active page's vertical scroller.
            if (!t.classList?.contains("dk-scroll") && !t.classList?.contains("scroll")) return;
            if (!t.closest?.(".dk-tab-page[data-active='true']")) return;
            navTarget.current = t;
            if (!navRaf.current) {
              navRaf.current = requestAnimationFrame(() => {
                navRaf.current = 0;
                if (navTarget.current) syncNavScroll(navTarget.current.scrollTop);
              });
            }
          }}
        >
          {tabs.map((e) => (
            <section key={e.key} className="dk-tab-page" data-tab-key={e.key} data-active={e === root && !runs.length} data-shown={e === root} inert={e !== root || runs.length > 0 || undefined}>
              <ErrorBoundary where={`tab ${e.route.name}`}>
                <TabPage route={e.route} active={e === root && !runs.length && !playing} homeView={homeView} onHomeView={setHomeView} Screen={Screen} chrome={chrome} />
              </ErrorBoundary>
            </section>
          ))}
        </div>
        {chrome === "nav" ? (
          <NavBar root={root} pages={pages} homeView={homeView} onHomeView={setHomeView} z={barZ} />
        ) : (
          <div className="dk-tabs-layer" style={{ zIndex: barZ }}>
            <TabBar root={root} hidden={!!playing} onTop={(key) => backTo(key)} />
          </div>
        )}
        {shown.map((r, i) => {
          const z = 20 + i * 2;
          const close = () => {
            const at = stack.findIndex((e) => e.key === r.key);
            if (at > 0) backTo(stack[at - 1].key);
          };
          if (r.kind === "dialog")
            return (
              <ErrorBoundary key={r.key} where="title dialog" action={{ label: "Close", onClick: close }}>
                <Suspense fallback={null}>
                  <TitleDialog entries={r.entries} leaving={!!r.leaving} suspended={!!playing} origin={origins.current.get(r.key)} z={z} onGone={() => finish(r.key)} onClose={close} onBack={back} />
                </Suspense>
              </ErrorBoundary>
            );
          return <PushedPage key={r.key} entry={r.entries[0]} leaving={!!r.leaving} z={z} top={i === shown.length - 1} onGone={() => finish(r.key)} onBack={back} Screen={Screen} chrome={chrome} />;
        })}
      </div>
      <div className="sheet-host" />
      <Profiles />
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
      <Settings />
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

function TabPage({ route, active, homeView, onHomeView, Screen, chrome }: { route: Route; active: boolean; homeView: HomeView; onHomeView: (v: HomeView) => void; Screen: ComponentType<{ route: Route }>; chrome: Chrome }) {
  if (route.name === "home") return <DeskHome view={homeView} onView={onHomeView} chrome={chrome} />;
  if (route.name === "anime")
    return (
      <Suspense fallback={null}>
        <DeskAnime chrome={chrome} />
      </Suspense>
    );
  if (route.name === "search")
    return (
      <Suspense fallback={null}>
        <DeskSearch active={active} chrome={chrome} />
      </Suspense>
    );
  if (route.name === "library")
    return (
      <Suspense fallback={null}>
        <DeskMy chrome={chrome} />
      </Suspense>
    );
  return <ScreenTab route={route} Screen={Screen} chrome={chrome} />;
}

/** A tab that's one of the app's own screens (Anime, the start page, a link): under the tab's bar, which takes its backing as the screen scrolls. */
function ScreenTab({ route, Screen, chrome }: { route: Route; Screen: ComponentType<{ route: Route }>; chrome: Chrome }) {
  const page = useRef<HTMLDivElement>(null);
  const none = useRef<HTMLElement>(null);
  return (
    <div
      className="dk-page dk-screen-tab"
      ref={page}
      onScrollCapture={(e) => {
        const c = Math.min(1, Math.max(0, (e.target as HTMLElement).scrollTop / 48));
        page.current?.querySelector<HTMLElement>(":scope > .dk-bar")?.style.setProperty("--c", c.toFixed(3));
      }}
    >
      {chrome === "tabs" && <TopBar title={titleOf(route)} scroller={none} />}
      <div className="page" data-active="true">
        <Screen route={route} />
      </div>
    </div>
  );
}

/** A page pushed over the tabs (a person, a genre, Downloads…): in from the right on the open spring, out to it. */
function PushedPage({ entry, leaving, z, top, onGone, onBack, Screen, chrome }: { entry: Entry; leaving: boolean; z: number; top: boolean; onGone: () => void; onBack: () => void; Screen: ComponentType<{ route: Route }>; chrome: Chrome }) {
  const el = useRef<HTMLElement>(null);
  const under = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    let below = el.current?.previousElementSibling as HTMLElement | null;
    while (below && (below.classList.contains("dk-tabs-layer") || below.classList.contains("dk-nav"))) below = below.previousElementSibling as HTMLElement | null;
    under.current = below;
    const clearUnder = () => below?.getAnimations().forEach((a) => a.id === "under" && a.cancel());
    if (reduced()) return clearUnder;
    const frames = samples(OPEN_OMEGA, OPEN_MS);
    el.current?.animate(
      frames.map(({ offset, p }) => ({ offset, transform: `translateX(${((1 - p) * 100).toFixed(3)}%)` })),
      { duration: OPEN_MS, easing: "linear" },
    );
    below?.animate(
      frames.map(({ offset, p }) => ({ offset, translate: `${(-UNDER_SHIFT * p).toFixed(3)}% 0`, opacity: 1 - 0.4 * p })),
      { duration: OPEN_MS, easing: "linear", fill: "forwards", id: "under" },
    );
    return clearUnder;
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
    below?.animate([{ translate: `-${UNDER_SHIFT}% 0`, opacity: 0.6 }, { translate: "0 0", opacity: 1 }], { ...ease, id: "under" });
    void a.finished.finally(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  return (
    <section ref={el} className="page dk-pushed" style={{ zIndex: z }} data-active={top && !leaving} data-page-key={entry.key} inert={!top || leaving || undefined}>
      <div className="dk-pushed-body">
        {entry.route.name === "discover" ? (
          <ErrorBoundary where="section">
            <Suspense fallback={null}>
              <DeskSection type={entry.route.type} catalog={entry.route.catalog} genre={entry.route.genre} addon={entry.route.addon} onBack={onBack} chrome={chrome} />
            </Suspense>
          </ErrorBoundary>
        ) : entry.route.name === "library-collection" && entry.route.view === "downloads" ? (
          <ErrorBoundary where="downloads">
            <Suspense fallback={null}>
              <DeskDownloads onBack={onBack} chrome={chrome} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <>
            <header className="dk-bar dk-pagebar" data-tauri-drag-region>
              <div className="dk-bar-lead" data-tauri-drag-region>
                <button type="button" className="dk-round dk-back" aria-label="Back" onClick={onBack}>
                  <IconBack size={22} stroke={2.2} />
                </button>
                <h1 className="dk-bar-title">{titleOf(entry.route)}</h1>
              </div>
              {chrome === "tabs" && <BarActions />}
            </header>
            <ErrorBoundary where={`page ${entry.route.name}`}>
              <Screen route={entry.route} />
            </ErrorBoundary>
          </>
        )}
      </div>
    </section>
  );
}

const UNDER_SHIFT = 12;

const TAB_ORDER = ["home", "anime", "search", "library"];
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
      return "Library";
    default:
      return "";
  }
}
