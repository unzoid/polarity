import { memo, startTransition, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { actionFor, getPrefs, openSettings, uiFontOf, usePrefs, useSettingsOverlay } from "./lib/settings";
import type { Settings as SettingsT } from "./lib/types";
import { preloadPlayer } from "./components/PlayerLayer";
import { preloadImage, useSettings } from "./lib/net";
import { rootTab, RouterProvider, useRouter, type Route } from "./lib/router";
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
import { isTvMode, setTvMode, useTvMode } from "./tv/tvMode";
import {
  detailBackdropUrl,
  canPreloadChunks,
  lazyNamed,
  useFormFactor,
  usePresence,
} from "./lib/ui";
import { PROFILES_EXIT_MS } from "./screens/account/profileHandoff";
import { startUpdateChecks } from "./lib/updater";
import { appWindow, formFactor, guardTaps, isDesktop, longPressMenus, onLongPress, openContextMenu, os } from "./lib/platform";
import { PartyHost } from "./components/party/PartyHost";
import { DeepLinks } from "./components/DeepLinks";
import { FriendsHost } from "./components/friends/FriendsHost";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { SignOutDialog } from "./components/SignOutDialog";
import { PinHost } from "./components/profileLock/PinHost";
import { DetailPending } from "./components/title/HeroSkeleton";
import { ProfileSwitchHost } from "./desk/ProfileSwitch";
import { useDeskUi } from "./desk/mode";
import { useQuery } from "@tanstack/react-query";
import { titlePageQuery } from "./lib/anime";
import type { ContentType, MetaPreview } from "./lib/types";
import { applyAccent, resolveAccent, resolveScheme, useSystemPrefersLight } from "./lib/theme";

// Each platform shell and off-boot screen lives in its own chunk so Desk, Phone, Classic Desktop
// and TV never download each other's JS or CSS on cold start.
const AuthScreen = lazyNamed(() => import("./screens/account/AuthScreen"), "AuthScreen");
const OnboardingScreen = lazyNamed(() => import("./screens/account/OnboardingScreen"), "OnboardingScreen");
const ProfilesScreen = lazyNamed(() => import("./screens/account/ProfilesScreen"), "ProfilesScreen");
const TvApp = lazyNamed(() => import("./tv/TvApp"), "TvApp");
const LazyDeskApp = lazyNamed(() => import("./desk/DeskApp"), "DeskApp");
const LazyPhoneApp = lazyNamed(() => import("./phone/PhoneApp"), "PhoneApp");
const LazyDesktopApp = lazyNamed(() => import("./DesktopApp"), "DesktopApp");
const LazyHome = lazyNamed(() => import("./screens/Home"), "Home");
const SettingsOverlay = lazyNamed(() => import("./components/SettingsOverlay"), "SettingsOverlay");

/** Starts loading only the active shell chunk in parallel with boot settings/account init (no waterfall). */
export function preloadActiveShell() {
  // TV mode stays behind its own Suspense boundary (as before) so initial focus lands on Continue Watching cleanly.
  if (isTvMode()) return;
  if (formFactor().form === "phone") return LazyPhoneApp.preload().catch(() => {});
  if (!getPrefs().classicDesktop) return LazyDeskApp.preload().catch(() => {});
  return Promise.all([LazyDesktopApp.preload(), LazyHome.preload()]).catch(() => {});
}

/** A page. Its route never changes for its entry, so a change of motion or player around it doesn't render it again. */
const Screen = memo(function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return (
        <Suspense fallback={null}>
          <LazyHome />
        </Suspense>
      );
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
  // On a phone the page opens under the card's picture (lib/ui/cardMotion.ts), which hides it briefly:
  // start preloading the detail backdrop on frame 0 and mount the full Detail tree in a non-blocking transition.
  const phone = useFormFactor().form === "phone";
  const [ready, setReady] = useState(!phone);
  useEffect(() => {
    if (phone && preview?.background) preloadImage(detailBackdropUrl(preview.background, true));
  }, [phone, preview?.background]);
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
        <LazyAnimeDetail id={page.anilist} episode={episode} />
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
 * Accent, colour scheme, font, card size, spoiler flags and reduced motion sync onto `<html>` before
 * paint so AuthScreen, OnboardingScreen, ProfilesScreen, SignOutDialog, PinHost and portalled menus
 * all receive the user's preferences on frame 0.
 */
export function App() {
  const tv = useTvMode();
  const desk = useDeskUi();
  const { data: settings } = useSettings();
  const prefersLight = useSystemPrefersLight();
  const scheme = tv ? "dark" : resolveScheme(settings?.colorScheme, prefersLight);

  // On Windows, the desk layout keeps the system's native title bar across the entire app
  // (Sign In, Who's watching? / Manage Profiles, and DeskApp) so in-app window buttons never
  // reappear when switching profiles. Classic desktop and TV mode keep a frameless window.
  const nativeFrame = isDesktop && os === "windows" && desk;
  useLayoutEffect(() => {
    if (!nativeFrame) return;
    const html = document.documentElement;
    html.dataset.nativeFrame = "";
    void appWindow.setDecorations(true).catch(() => delete html.dataset.nativeFrame);
    return () => {
      delete html.dataset.nativeFrame;
      void appWindow.setDecorations(false).catch(() => {});
    };
  }, [nativeFrame]);

  useLayoutEffect(() => {
    document.documentElement.dataset.font = uiFontOf(settings?.uiFont);
  }, [settings?.uiFont]);

  useLayoutEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    applyAccent(resolveAccent(settings), scheme, root);
    root.dataset.cardSize = settings.cardSize ?? "medium";
    root.dataset.reduceMotion = settings.reduceMotion ?? "system";
    root.dataset.hideThumbs = String(!!settings.hideEpisodeThumbs);
    root.dataset.hideOverviews = String(!!settings.hideEpisodeDescriptions);
  }, [settings, scheme]);

  const reduce = settings?.reduceMotion;
  return (
    <MotionConfig reducedMotion={reduce === "on" ? "always" : reduce === "off" ? "never" : "user"}>
      <Gate />
      <ProfileSwitchHost />
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
  const desk = useDeskUi();
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
        <RouterProvider key={profile?.id ?? "guest"} initial={[initial]} keepSections={phone || desk}>
          <MainApp />
        </RouterProvider>
      );
    }
  }
}

/** The desktop app or, in TV mode, the 10-foot one — over the same navigation stack. */
function MainApp() {
  const tv = useTvMode();
  // A phone has its own app (src/phone): Netflix's layout and motion over the same pages and navigation.
  const phone = useFormFactor().form === "phone";
  // A computer or tablet gets the same app in its large-screen form (src/desk), unless Settings asks for the classic one.
  const desk = useDeskUi();

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
    const zoom = uiScale > 0 ? uiScale : 1;
    void appWindow.setZoom(zoom).catch(() => {});
    // The page's zoom, for what has to stay put on screen whatever it is: room for macOS's traffic lights (shell.css).
    document.documentElement.style.setProperty("--ui-zoom", String(zoom));
  }, [uiScale]);

  // Fullscreen, on the root: macOS hides the traffic lights then, so the bars stop making room for them (shell.css).
  useEffect(() => {
    if (!isDesktop) return;
    const root = document.documentElement;
    const read = () =>
      void appWindow
        .isFullscreen()
        .then((fs) => {
          if (fs) root.dataset.fullscreen = "";
          else delete root.dataset.fullscreen;
        })
        .catch(() => {});
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

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
      <Suspense fallback={null}>
        {tv ? (
          <TvApp />
        ) : phone ? (
          <LazyPhoneApp Screen={Screen} />
        ) : desk ? (
          <LazyDeskApp Screen={Screen} Settings={LazySettingsOverlay} />
        ) : (
          <LazyDesktopApp Screen={Screen} Settings={LazySettingsOverlay} />
        )}
      </Suspense>
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

/** The Settings window, loaded the first time it opens, then kept (it animates its own closing). */
function LazySettingsOverlay() {
  const { open } = useSettingsOverlay();
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  // A phone's Settings is a view of the profile sheet (ProfileMenu.tsx), not a window of its own.
  const phone = useFormFactor().form === "phone";
  // Fetched right after the first painted frame so the first click on Settings never suspends.
  useEffect(() => {
    if (phone || !canPreloadChunks()) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        void SettingsOverlay.preload().catch(() => {});
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [phone]);
  if (!opened || phone) return null;
  return (
    <Suspense fallback={null}>
      <SettingsOverlay />
    </Suspense>
  );
}
