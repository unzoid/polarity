import { memo, startTransition, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
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
import {
  LazyAnime,
  LazyAnimeBrowse,
  LazyAnimeDetail,
  LazyAnimeSchedule,
  LazyCalendar,
  LazyDetail,
  LazyDiscover,
  LazyLibrary,
  LazyLibraryCollection,
  LazyLibraryPlaylist,
  LazyPerson,
  LazySearch,
  preloadRoute,
} from "./screens/lazyScreens";
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
  usePresence,
  cardGhostParts,
  cardMotionVars,
  playCardMotion,
  liveCard,
  cardOrigin,
  watchCardTaps,
  useSystemBack,
  watchInputModality,
  warmUpBlurShaders,
  whenIdle,
} from "./lib/ui";
import { PROFILES_EXIT_MS } from "./screens/account/profileHandoff";
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
import { PinHost } from "./components/profileLock/PinHost";
import { StoreProblemToast } from "./components/StoreProblemToast";
import { AccountFullToast } from "./components/AccountFullToast";
import { SecretsSyncToast } from "./components/SecretsSyncToast";
import { LockedKeysToast } from "./components/LockedKeysToast";
import { SeriesPickToast } from "./components/anime/SeriesPickToast";
import { HiddenTitleToast } from "./components/HiddenTitleToast";
import { DetailPending } from "./components/title/HeroSkeleton";
import { useQuery } from "@tanstack/react-query";
import { titlePageQuery } from "./lib/anime";
import type { ContentType, MetaPreview } from "./lib/types";
import { applyTheme, resolveScheme, resolveTheme, useSystemPrefersLight } from "./lib/theme";

// Chunks of their own, loaded the first time they're drawn: most sessions never
// see the sign-in screens, TV mode, Settings or an anime page (the player is in
// PlayerLayer, preloaded once the app is idle).
const AuthScreen = lazyNamed(() => import("./screens/account/AuthScreen"), "AuthScreen");
const OnboardingScreen = lazyNamed(() => import("./screens/account/OnboardingScreen"), "OnboardingScreen");
const ProfilesScreen = lazyNamed(() => import("./screens/account/ProfilesScreen"), "ProfilesScreen");
const TvApp = lazyNamed(() => import("./tv/TvApp"), "TvApp");
const SettingsOverlay = lazyNamed(() => import("./components/SettingsOverlay"), "SettingsOverlay");

/** A page. Its route never changes for its entry, so a change of motion or player around it doesn't render it again. */
const Screen = memo(function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "discover":
      return (
        <Suspense fallback={null}>
          <LazyDiscover type={route.type} catalog={route.catalog} genre={route.genre} addon={route.addon} />
        </Suspense>
      );
    case "library":
      return (
        <Suspense fallback={null}>
          <LazyLibrary />
        </Suspense>
      );
    case "library-collection":
      return (
        <Suspense fallback={null}>
          <LazyLibraryCollection view={route.view} />
        </Suspense>
      );
    case "playlist":
      return (
        <Suspense fallback={null}>
          <LazyLibraryPlaylist id={route.id} fresh={!!route.fresh} />
        </Suspense>
      );
    case "calendar":
      return (
        <Suspense fallback={null}>
          <LazyCalendar />
        </Suspense>
      );
    case "search":
      return (
        <Suspense fallback={null}>
          <LazySearch />
        </Suspense>
      );
    case "settings":
      return <SettingsRoute page={route.page} />;
    case "detail":
      return <TitleRoute type={route.type} id={route.id} preview={route.preview} episode={route.episode} />;
    case "anime":
      return (
        <Suspense fallback={null}>
          <LazyAnime />
        </Suspense>
      );
    case "anime-detail":
      return (
        <Suspense fallback={null}>
          <LazyAnimeDetail id={route.id} preview={route.preview} />
        </Suspense>
      );
    case "anime-schedule":
      return (
        <Suspense fallback={null}>
          <LazyAnimeSchedule />
        </Suspense>
      );
    case "anime-browse":
      return (
        <Suspense fallback={null}>
          <LazyAnimeBrowse />
        </Suspense>
      );
    case "person":
      return (
        <Suspense fallback={null}>
          <LazyPerson id={route.id} name={route.title} />
        </Suspense>
      );
    case "player":
      return null; // rendered as a full-window layer below
  }
});

/**
 * A title's one page (test report 1, item 1): an anime reached by any of its ids opens on its anime
 * page, and which page it is is settled before either renders: a skeleton until then, never one
 * page swapped for the other.
 */
function TitleRoute({ type, id, preview, episode }: { type: ContentType; id: string; preview?: MetaPreview; episode?: string }) {
  const { data: page } = useQuery(titlePageQuery(type, id, preview));
  // On a phone the page opens under the card's picture (lib/ui/cardMotion.ts), which hides it for its first 300ms:
  // the tap renders only the skeleton, so the motion starts in the next frame, and the page itself renders after,
  // in a transition that gives way to every frame.
  const phone = useFormFactor().form === "phone";
  const [ready, setReady] = useState(!phone);
  useEffect(() => {
    if (ready) return;
    const frame = requestAnimationFrame(() => startTransition(() => setReady(true)));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  const loading = <DetailPending />;
  if (!page || !ready) return loading;
  if (page.kind === "anime")
    return (
      <Suspense fallback={loading}>
        <LazyAnimeDetail id={page.anilist} />
      </Suspense>
    );
  return (
    <Suspense fallback={loading}>
      <LazyDetail type={type} id={id} preview={preview} episode={episode} />
    </Suspense>
  );
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
 * Theme, colour scheme, font, card size, spoiler flags and reduced motion sync onto `<html>` before
 * paint so AuthScreen, OnboardingScreen, ProfilesScreen, SignOutDialog, PinHost and portalled menus
 * all receive the user's preferences on frame 0.
 */
export function App() {
  const tv = useTvMode();
  const { data: settings } = useSettings();
  const prefersLight = useSystemPrefersLight();
  const scheme = tv ? "dark" : resolveScheme(settings?.colorScheme, prefersLight);

  useLayoutEffect(() => {
    document.documentElement.dataset.font = uiFontOf(settings?.uiFont);
  }, [settings?.uiFont]);

  useLayoutEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    applyTheme(resolveTheme(settings), scheme, root);
    root.dataset.cardSize = settings.cardSize ?? "medium";
    root.dataset.reduceMotion = settings.reduceMotion ?? "system";
    root.dataset.hideThumbs = String(!!settings.hideEpisodeThumbs);
    root.dataset.hideOverviews = String(!!settings.hideEpisodeDescriptions);
  }, [settings, scheme]);

  const reduce = settings?.reduceMotion;
  return (
    <MotionConfig reducedMotion={reduce === "on" ? "always" : reduce === "off" ? "never" : "user"}>
      <Gate />
      <SignOutDialog />
      <PinHost />
    </MotionConfig>
  );
}

function Gate() {
  const { status, profilesView } = useAccount();
  // Going in from the profile screen, it stays on top of the app a moment to hand over (ProfilesScreen).
  // Anywhere else (signing out) it goes at once.
  const picker = usePresence(status === "profiles" ? profilesView : null, PROFILES_EXIT_MS);
  const handingOver = picker.leaving && (status === "ready" || status === "guest");
  return (
    <>
      {status !== "profiles" && <GateScreen />}
      {picker.shown && (status === "profiles" || handingOver) && (
        <Suspense fallback={<div className="account-shell" />}>
          <ProfilesScreen initial={picker.shown} leaving={handingOver} />
        </Suspense>
      )}
    </>
  );
}

/** What the account's status shows, but the profile screen (Gate keeps that one in its own place). */
function GateScreen() {
  const { status, profile } = useAccount();
  const { data: settings, isFetched } = useSettings();
  // A phone's sections keep their pages, as a phone app's tabs do (router `kept`); elsewhere each opens afresh.
  const phone = useFormFactor().form === "phone";
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
      return null;
    case "guest":
    case "ready": {
      // Each profile starts on its start page with its own navigation. Wait
      // for settings (a local read) so it doesn't open on Home and then jump.
      if (!isFetched) return shell;
      const initial = startRoute(settings?.startPage);
      preloadRoute(initial);
      return (
        <RouterProvider key={profile?.id ?? "guest"} initial={[initial]} keepSections={phone}>
          <MainApp />
        </RouterProvider>
      );
    }
  }
}

/** The desktop app or, in TV mode, the 10-foot one — over the same navigation stack. */
function MainApp() {
  const tv = useTvMode();

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
  const { stack, kept, current, back, tab } = useRouter();
  const { playing, player, leaving } = usePlayerLayer(current);
  // The page under the player stays mounted so leaving playback is instant.
  const pages = stack.filter((e) => e.route.name !== "player");
  const topPage = pages[pages.length - 1];
  const { data: settings } = useSettings();
  usePageFocus(playing || !topPage ? undefined : String(topPage.key));
  const phone = useFormFactor().form === "phone";
  // Pages change as a coordinated pair across desktop, tablet and phone (lib/ui/pageMotion.ts).
  const motion = usePageMotion(pages, !playing, phone);
  // On a phone each section's page stays mounted when another is opened (router `kept`), as a phone app's tabs do:
  // switching back is that page as it was, drawn already, so the switch is only the crossfade. In key order, so a
  // page never moves among the others (moving it would reset its scroll); which is drawn over which is shell.css's.
  const all = new Map<number, Entry>();
  for (const e of [...(phone ? kept : []), ...pages, ...(motion?.leaving ? [motion.leaving] : [])]) all.set(e.key, e);
  const shown = [...all.values()].sort((a, b) => a.key - b.key);
  // A title's page out of its card plays from the commit itself (lib/ui/cardMotion.ts): the tap is answered in the
  // next frame, whatever the new page still has to render or load. Back waits for the pair's first frame (`go`): the
  // page coming back is drawn then, under the title's, so painting it doesn't eat the motion's first frames.
  const main = useRef<HTMLElement>(null);
  const card = motion?.card && (motion.dir === 1 || motion.go) ? motion.card : undefined;
  const cardKey = card && motion ? (motion.dir === 1 ? motion.enter : motion.leave) : undefined;
  useLayoutEffect(() => {
    if (cardKey === undefined || !card) return;
    const page = main.current?.querySelector<HTMLElement>(`:scope > .page[data-page-key="${cardKey}"]`);
    if (!page) return;
    const scrim = main.current?.querySelector<HTMLElement>(":scope > .card-scrim") ?? null;
    const open = page.dataset.card === "open";
    // Back lands where the card is now, not where it was tapped (pageMotion.ts liveCard).
    return playCardMotion({ page, scrim, card: open ? card : liveCard(card), open, width: window.innerWidth, height: window.innerHeight });
  }, [cardKey, card]);
  // On a phone, a section's turn takes the top bar with the pages (shell.css): the real bar comes in with the new page,
  // and a copy of it as it was rides out on the old one. Strictly gated to phone so desktop Back geometry never shifts.
  const turn = phone && motion?.tab ? motion : undefined;
  const barCopy = useRef<{ key: number; node: HTMLElement } | null>(null);
  if (turn && barCopy.current?.key !== turn.leave) {
    const node = main.current?.querySelector(":scope > .navbar")?.cloneNode(true);
    barCopy.current = node instanceof HTMLElement ? { key: turn.leave, node } : null;
  }
  useLayoutEffect(() => {
    const copy = barCopy.current;
    const page = turn && copy?.key === turn.leave ? main.current?.querySelector(`:scope > .page[data-page-key="${turn.leave}"]`) : null;
    if (!copy || !page) return;
    copy.node.classList.add("navbar-copy");
    copy.node.setAttribute("aria-hidden", "true");
    copy.node.inert = true;
    copy.node.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    page.append(copy.node);
    return () => {
      copy.node.remove();
      barCopy.current = null;
    };
  }, [turn?.leave, turn?.enter]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keyboard or mouse, for the menus' highlight (lib/ui/inputModality.ts).
  useEffect(watchInputModality, []);
  useEffect(() => (phone ? watchCardTaps() : undefined), [phone]);
  useEffect(() => whenIdle(() => void LazyDetail.preload().catch(() => {}), 2500), []);
  // Once Home has come in, the blur shaders a title page's entrance needs (lib/ui/shaderWarmup.ts).
  useEffect(() => {
    let cancelIdle = () => {};
    const wait = window.setTimeout(() => (cancelIdle = whenIdle(warmUpBlurShaders, 2000)), 2500);
    return () => {
      window.clearTimeout(wait);
      cancelIdle();
    };
  }, []);

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
  // iOS's swipe (#451) and Android 14's back gesture (#483), on a pushed page with nothing over it, move the page with the finger.
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
      data-card-titles={settings?.showCardTitles ?? false}
      data-card-details={settings?.showCardDetails ?? false}
      data-card-ratings={settings?.showCardRatings ?? false}
      data-rating-position={settings?.cardRatingPosition ?? "poster"}
      data-rating-colors={settings?.ratingColors ?? false}
      data-player-leaving={leaving}
    >
      <main
        className="main"
        ref={main}
        // A section's turn: the top bar comes in with the new page, from its side (shell.css).
        data-turn={(turn?.go && turn.dir) || undefined}
        style={turn ? ({ "--turn-dir": turn.dir } as CSSProperties) : undefined}
      >
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
            // Of the pair, the one drawn on top: the page pushed, or the one going (it comes last). It moves; the
            // other holds still under it (shell.css).
            data-over={(motion && entry.key === (motion.leaving ? motion.leave : motion.enter)) || undefined}
            // Another section: the pair slides across as a pager's pages do. A page replaced: a crossfade in place.
            data-tab={motion?.tab || undefined}
            data-fade={(motion && !motion.card && !motion.tab && motion.dir === 0) || undefined}
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
              <CardGhost src={motion.card.src} />
            )}
          </section>
        ))}
        {/* Between the title's page and the one behind it: dims and softens what's behind as the card opens. */}
        {motion?.card && <div className="card-scrim" aria-hidden data-card={motion.dir === 1 ? "open" : "close"} data-go={motion.go || undefined} />}
        <ErrorBoundary where="toasts" quiet>
          <div className="toast-stack">
            <ControllerToast tv={false} />
            <SeriesPickToast />
            <HiddenTitleToast tv={false} />
            <UpdateToast hidden={!!playing} />
          </div>
        </ErrorBoundary>
      </main>
      {/* The profile sheet's place (ProfileMenu.tsx): beside the pages and the top bar, not in them, so they can step
          back under it (Sheet.tsx) without taking it with them; in the top bar's layer, under the notices. */}
      <div className="sheet-host" />
      <ErrorBoundary where="what's new" quiet>
        <WhatsNewSheet />
      </ErrorBoundary>
      <PlayerLayer player={player} leaving={leaving} />
      <LazySettingsOverlay />
      {/* After Settings: it reports changes made there too, so it must never be under it or inert with the page. */}
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

/** The card's picture on a title's page while it grows out of the card or goes back into it (lib/ui/cardGhost.ts). */
function CardGhost({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { panel, soft, medium, sharp } = cardGhostParts(src);
    el.replaceChildren(panel, soft, medium, sharp);
  }, [src]);
  return <div ref={box} className="card-ghost" aria-hidden />;
}

/** The Settings window, loaded the first time it opens, then kept (it animates its own closing). */
function LazySettingsOverlay() {
  const { open } = useSettingsOverlay();
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  // A phone's Settings is a view of the profile sheet (ProfileMenu.tsx), not a window of its own.
  const phone = useFormFactor().form === "phone";
  // Fetched once the app has genuinely settled (skipping phones and metered/slow connections), so initial load never competes with it.
  useEffect(() => {
    if (phone) return;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } };
    const c = nav.connection;
    if (c && (c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g" || (c.downlink && c.downlink < 2.5))) return;
    let cancelIdle: (() => void) | undefined;
    const later = window.setTimeout(() => {
      cancelIdle = whenIdle(() => void SettingsOverlay.preload().catch(() => {}), 5000);
    }, 5000);
    return () => {
      window.clearTimeout(later);
      cancelIdle?.();
    };
  }, [phone]);
  if (!opened || phone) return null;
  return (
    <Suspense fallback={null}>
      <SettingsOverlay />
    </Suspense>
  );
}
