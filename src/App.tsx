import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { MotionConfig } from "motion/react";
import { actionFor, getPrefs, isSettingsOpen, openSettings, uiFontOf, usePrefs, useSettingsOverlay } from "./lib/settings";
import type { Settings as SettingsT } from "./lib/types";
import { NavBar } from "./components/NavBar";
import { useNativeSwipe } from "./components/NativeBack";
import { PlayerLayer, preloadPlayer, usePlayerLayer } from "./components/PlayerLayer";
import { useSettings } from "./lib/net";
import { rootTab, RouterProvider, useRouter, type Entry, type Route } from "./lib/router";
import { focusSearch } from "./lib/catalog";
import { Home } from "./screens/Home";
import { Discover } from "./screens/Discover";
import { Library, LibraryCollection, LibraryPlaylist } from "./screens/Library";
import { Calendar } from "./screens/Calendar";
import { Search } from "./screens/Search";
import { Detail } from "./screens/Detail";
import { Anime, AnimeBrowse, AnimeSchedule } from "./screens/Anime";
import { useAccount } from "./lib/account";
import { useNotifications } from "./lib/notifications";
import { ControllerToast } from "./tv/TvChrome";
import { isTvMode, setTvMode, useTvMode } from "./tv/tvMode";
import {
  dismissDepth,
  lazyNamed,
  onDismissDepth,
  pageDrag,
  pressEscape,
  systemBackAction,
  useFormFactor,
  usePageFocus,
  usePageMotion,
  cardMotionVars,
  cardOrigin,
  watchCardTaps,
  useSystemBack,
  watchInputModality,
} from "./lib/ui";
import { CardMenuHost } from "./components/CardMenu";
import { TrailerHost } from "./components/Trailer";
import { OpenFilesHost } from "./components/OpenFiles";
import { UpdateToast, WhatsNewSheet } from "./components/Updates";
import { startUpdateChecks } from "./lib/updater";
import { appWindow, guardTaps, leaveApp, longPressMenus, onLongPress, openContextMenu, systemBack } from "./lib/platform";
import { PartyHost } from "./components/party/PartyHost";
import { DeepLinks } from "./components/DeepLinks";
import { FriendsHost } from "./components/friends/FriendsHost";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { SignOutDialog } from "./components/SignOutDialog";
import { StoreProblemToast } from "./components/StoreProblemToast";
import { AccountFullToast } from "./components/AccountFullToast";
import { SecretsSyncToast } from "./components/SecretsSyncToast";
import { LockedKeysToast } from "./components/LockedKeysToast";
import { SeriesPickToast } from "./components/anime/SeriesPickToast";
import { DetailPending } from "./components/title/HeroSkeleton";
import { useQuery } from "@tanstack/react-query";
import { titlePageQuery } from "./lib/anime";
import type { ContentType, MetaPreview } from "./lib/types";
import { applyTheme, resolveScheme, resolveTheme, useSystemPrefersLight } from "./lib/theme";

// Chunks of their own, loaded the first time they're drawn: most sessions never
// see the sign-in screens, TV mode, Settings or an anime page (the player is in
// PlayerLayer, preloaded once the app is idle).
const AnimeDetail = lazyNamed(() => import("./screens/AnimeDetail"), "AnimeDetail");
const AuthScreen = lazyNamed(() => import("./screens/account/AuthScreen"), "AuthScreen");
const OnboardingScreen = lazyNamed(() => import("./screens/account/OnboardingScreen"), "OnboardingScreen");
const ProfilesScreen = lazyNamed(() => import("./screens/account/ProfilesScreen"), "ProfilesScreen");
const TvApp = lazyNamed(() => import("./tv/TvApp"), "TvApp");
const SettingsOverlay = lazyNamed(() => import("./components/SettingsOverlay"), "SettingsOverlay");

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "discover":
      return <Discover type={route.type} catalog={route.catalog} genre={route.genre} addon={route.addon} />;
    case "library":
      return <Library />;
    case "library-collection":
      return <LibraryCollection view={route.view} />;
    case "playlist":
      return <LibraryPlaylist id={route.id} fresh={!!route.fresh} />;
    case "calendar":
      return <Calendar />;
    case "search":
      return <Search />;
    case "settings":
      return <SettingsRoute page={route.page} />;
    case "detail":
      return <TitleRoute type={route.type} id={route.id} preview={route.preview} episode={route.episode} />;
    case "anime":
      return <Anime />;
    case "anime-detail":
      return (
        <Suspense fallback={null}>
          <AnimeDetail id={route.id} preview={route.preview} />
        </Suspense>
      );
    case "anime-schedule":
      return <AnimeSchedule />;
    case "anime-browse":
      return <AnimeBrowse />;
    case "player":
      return null; // rendered as a full-window layer below
  }
}

/**
 * A title's one page (test report 1, item 1): an anime reached by any of its ids opens on its anime
 * page, and which page it is is settled before either renders: a skeleton until then, never one
 * page swapped for the other.
 */
function TitleRoute({ type, id, preview, episode }: { type: ContentType; id: string; preview?: MetaPreview; episode?: string }) {
  const { data: page } = useQuery(titlePageQuery(type, id, preview));
  const loading = <DetailPending />;
  if (!page) return loading;
  if (page.kind === "anime")
    return (
      <Suspense fallback={loading}>
        <AnimeDetail id={page.anilist} />
      </Suspense>
    );
  return <Detail type={type} id={id} preview={preview} episode={episode} />;
}

/**
 * Desktop settings are an overlay, not a screen. The settings route only comes from TV (switching to desktop on
 * TV's settings screen): open the overlay on that page and step off the route.
 */
function SettingsRoute({ page }: { page?: string }) {
  const { stack, back, tab } = useRouter();
  const done = useRef(false); // StrictMode runs the effect twice; leave the route once
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    openSettings(page);
    if (stack.length > 1) back();
    else tab({ name: "home" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Sign-in and profile picking come before the app itself; sign-out may stop to ask over any of them.
 * Settings → Appearance → "Reduce motion" covers all of it, the account screens included.
 */
export function App() {
  const reduce = useSettings().data?.reduceMotion;
  return (
    <MotionConfig reducedMotion={reduce === "on" ? "always" : reduce === "off" ? "never" : "user"}>
      <Gate />
      <SignOutDialog />
    </MotionConfig>
  );
}

function Gate() {
  const { status, profile, profilesView } = useAccount();
  const { data: settings, isFetched } = useSettings();
  const shell = <div className="account-shell" />;
  switch (status) {
    case "loading":
      return shell;
    case "signed-out":
      return (
        <Suspense fallback={shell}>
          <AuthScreen />
        </Suspense>
      );
    case "onboarding":
      return (
        <Suspense fallback={shell}>
          <OnboardingScreen />
        </Suspense>
      );
    case "profiles":
      return (
        <Suspense fallback={shell}>
          <ProfilesScreen initial={profilesView} />
        </Suspense>
      );
    case "guest":
    case "ready":
      // Each profile starts on its start page with its own navigation. Wait
      // for settings (a local read) so it doesn't open on Home and then jump.
      if (!isFetched) return shell;
      return (
        <RouterProvider key={profile?.id ?? "guest"} initial={[startRoute(settings?.startPage)]}>
          <MainApp />
        </RouterProvider>
      );
  }
}

/** The desktop app or, in TV mode, the 10-foot one — over the same navigation stack. */
function MainApp() {
  const tv = useTvMode();
  const { data: settings } = useSettings();

  // On the root element so portalled menus pick it up too.
  useEffect(() => {
    document.documentElement.dataset.font = uiFontOf(settings?.uiFont);
  }, [settings?.uiFont]);

  // Settings → Appearance and → Browsing, as attributes and variables on <html>
  // (TV mode and portalled menus included). TV mode is always dark: it's made for a dim room.
  const prefersLight = useSystemPrefersLight();
  const scheme = tv ? "dark" : resolveScheme(settings?.colorScheme, prefersLight);
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    applyTheme(resolveTheme(settings), scheme, root);
    root.dataset.cardSize = settings.cardSize ?? "medium";
    root.dataset.reduceMotion = settings.reduceMotion ?? "system";
    root.dataset.hideThumbs = String(!!settings.hideEpisodeThumbs);
    root.dataset.hideOverviews = String(!!settings.hideEpisodeDescriptions);
  }, [settings, scheme]);

  // Interface size is this screen's, so it's a device pref.
  const { uiScale, animeEnabled } = usePrefs();

  // Anime turned off (here or on another device) while you're in it: nothing to stay on.
  const { stack, tab } = useRouter();
  // New episodes, finished downloads, clicks on notes (#209).
  useNotifications();
  const inAnime = rootTab(stack).name === "anime";
  useEffect(() => {
    if (inAnime && !animeEnabled) tab({ name: "home" });
  }, [inAnime, animeEnabled, tab]);

  useEffect(() => {
    void appWindow.setZoom(uiScale > 0 ? uiScale : 1).catch(() => {});
  }, [uiScale]);

  // Look for a new version shortly after launch, then every few hours (TV mode too).
  useEffect(() => startUpdateChecks(), []);
  useEffect(() => preloadPlayer(), []);

  // The webview's own right-click menu (Save image as, Copy image link…) has no
  // place in the app. Titles open their own options instead (CardMenu); text
  // fields and selected text keep the native one for copy and paste.
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
      if (window.getSelection()?.toString().trim()) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  // iOS sends no contextmenu for a finger held down: a long press on a title opens its options all the same.
  useEffect(() => (longPressMenus ? onLongPress((held) => openContextMenu(held)) : undefined), []);
  // A touch that scrolled, or stopped a list gliding after a fling, opens nothing (#459).
  useEffect(() => guardTaps(), []);

  // Switching modes works from anywhere, the player included (Settings → Controls to rebind).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (actionFor(e, "app") !== "toggleTv") return;
      e.preventDefault();
      setTvMode(!isTvMode());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {tv ? (
        <Suspense fallback={null}>
          <TvApp />
        </Suspense>
      ) : (
        <DesktopApp />
      )}
      <ErrorBoundary where="party host" quiet>
        <PartyHost />
      </ErrorBoundary>
      <ErrorBoundary where="deep links" quiet>
        <DeepLinks tv={tv} />
      </ErrorBoundary>
      <ErrorBoundary where="friends host" quiet>
        <FriendsHost />
      </ErrorBoundary>
    </>
  );
}

/** Settings → Browsing → "Open the app on". */
function startRoute(page: SettingsT["startPage"] | undefined): Route {
  switch (page) {
    case "library":
      return { name: "library" };
    case "movies":
      return { name: "discover", type: "movie" };
    case "series":
      return { name: "discover", type: "series" };
    case "anime":
      return getPrefs().animeEnabled ? { name: "anime" } : { name: "home" };
    default:
      return { name: "home" };
  }
}

function DesktopApp() {
  const { stack, current, back, tab } = useRouter();
  const { playing, player, leaving } = usePlayerLayer(current);
  // The page under the player stays mounted so leaving playback is instant.
  const pages = stack.filter((e) => e.route.name !== "player");
  const topPage = pages[pages.length - 1];
  const { data: settings } = useSettings();
  usePageFocus(playing || !topPage ? undefined : String(topPage.key));
  // On a phone pages change as a pair (lib/ui/pageMotion.ts); a page taken off the stack stays while it leaves.
  const motion = usePageMotion(pages, useFormFactor().form === "phone" && !playing);
  const shown = motion?.leaving ? [...pages, motion.leaving] : pages;
  // Keyboard or mouse, for the menus' highlight (lib/ui/inputModality.ts).
  useEffect(watchInputModality, []);
  useEffect(watchCardTaps, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing || isSettingsOpen()) return; // the player / settings overlay owns the keyboard
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && !typing && !e.defaultPrevented) back();
      // Modified shortcuts (Ctrl+K) work while typing too; plain keys ("/") would just type.
      if (actionFor(e, "app") === "search" && (!typing || e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, back]);

  // Android's back button and gesture: Escape's Back, then Home, then the app goes to the background.
  // iOS's swipe in from the left edge: Escape's Back only.
  // iOS's swipe, on a pushed page with nothing over it, moves the page with the finger (#451).
  const main = useRef<HTMLElement>(null);
  const now = useRef({ pages, back });
  now.current = { pages, back };
  const drag = useMemo(
    () =>
      pageDrag(
        () => {
          const { pages } = now.current;
          const at = (e: Entry | undefined) => e && main.current?.querySelector<HTMLElement>(`:scope > .page[data-page-key="${e.key}"]`);
          const top = at(pages[pages.length - 1]);
          const under = pages.length > 1 && at(pages[pages.length - 2]);
          // A title page that grew out of a card goes back into it with the finger (pageDrag.ts).
          return top && under ? { top, under, card: cardOrigin(pages[pages.length - 1].key) } : null;
        },
        () => now.current.back(),
      ),
    [],
  );
  const open = () => !!playing || isSettingsOpen() || dismissDepth() > 0;
  useSystemBack(
    () => {
      const action = systemBackAction({ open: open(), pushed: stack.length - 1, atHome: rootTab(stack).name === "home", swipe: systemBack === "swipe" });
      if (action === "escape") pressEscape();
      else if (action === "home") tab({ name: "home" });
      else if (action === "leave") void leaveApp();
    },
    () => (open() ? undefined : drag),
  );
  // The swipe is Back wherever something can be left; at a tab's own page iOS leaves the edge to the page.
  const layers = useSyncExternalStore(onDismissDepth, dismissDepth);
  const settingsOpen = useSettingsOverlay().open;
  useNativeSwipe(!!playing || settingsOpen || layers > 0 || stack.length > 1);

  return (
    <div
      className="app"
      data-card-titles={settings?.showCardTitles ?? true}
      data-card-details={settings?.showCardDetails ?? true}
      data-card-ratings={settings?.showCardRatings ?? false}
      data-rating-position={settings?.cardRatingPosition ?? "poster"}
      data-rating-colors={settings?.ratingColors ?? false}
      data-player-leaving={leaving}
    >
      <main className="main" ref={main}>
        <ErrorBoundary where="top bar">
          <NavBar />
        </ErrorBoundary>
        {shown.map((entry) => (
          <section
            key={entry.key}
            className={entry.route.name === "detail" || entry.route.name === "anime-detail" ? "page page-pushed" : "page"}
            data-active={entry === topPage && !playing}
            data-motion={motion?.enter === entry.key ? "enter" : motion?.leave === entry.key ? "leave" : undefined}
            // A page on its way out is still drawn for a moment, but no longer read out.
            aria-hidden={(motion?.leave === entry.key && entry !== topPage) || undefined}
            // A title's page out of its card, and back into it (shell.css).
            data-card={motion?.card ? (motion.dir === 1 ? "open" : "close") : undefined}
            // The pair moves once the new page is laid out (pageMotion.ts `go`).
            data-go={motion?.go || undefined}
            style={
              motion
                ? ({ "--page-dir": motion.dir, ...(motion.card && cardMotionVars(motion.card, window.innerWidth, window.innerHeight)) } as CSSProperties)
                : undefined
            }
            data-under-player={(entry === topPage && !!player) || undefined}
            data-page-key={entry.key}
            inert={entry !== topPage || !!playing}
          >
            <ErrorBoundary where={`page ${entry.route.name}`}>
              <Screen route={entry.route} />
            </ErrorBoundary>
            {/* The card's own picture, on the title's page while it grows out of the card or goes back into it:
                the same box, so they move as one piece (shell.css). */}
            {motion?.card?.src && entry.key === (motion.dir === 1 ? motion.enter : motion.leave) && (
              <div className="card-ghost" aria-hidden>
                <img className="card-ghost-soft" src={motion.card.src} alt="" draggable={false} />
                <img className="card-ghost-sharp" src={motion.card.src} alt="" draggable={false} />
              </div>
            )}
          </section>
        ))}
        {/* Between the title's page and the one behind it: dims and softens what's behind as the card opens. */}
        {motion?.card && <div className="card-scrim" aria-hidden data-card={motion.dir === 1 ? "open" : "close"} data-go={motion.go || undefined} />}
        <ErrorBoundary where="toasts" quiet>
          <ControllerToast tv={false} />
          <SeriesPickToast />
          <UpdateToast hidden={!!playing} />
        </ErrorBoundary>
      </main>
      <ErrorBoundary where="what's new" quiet>
        <WhatsNewSheet />
      </ErrorBoundary>
      <PlayerLayer player={player} leaving={leaving} />
      <LazySettingsOverlay />
      {/* After Settings: it reports changes made there too, so it must never be under it or inert with the page. */}
      <ErrorBoundary where="notices" quiet>
        <StoreProblemToast tv={false} />
        <AccountFullToast tv={false} />
        <SecretsSyncToast tv={false} />
        <LockedKeysToast tv={false} />
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

/** The Settings window, loaded the first time it opens, then kept (it animates its own closing). */
function LazySettingsOverlay() {
  const { open } = useSettingsOverlay();
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  // Fetched once the app has settled, so the first Settings opens as quickly as the rest.
  useEffect(() => {
    const later = window.setTimeout(() => void import("./components/SettingsOverlay").catch(() => {}), 2000);
    return () => window.clearTimeout(later);
  }, []);
  // A phone's Settings is a view of the profile sheet (ProfileMenu.tsx), not a window of its own.
  const phone = useFormFactor().form === "phone";
  if (!opened || phone) return null;
  return (
    <Suspense fallback={null}>
      <SettingsOverlay />
    </Suspense>
  );
}
