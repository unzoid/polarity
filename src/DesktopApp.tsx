import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type CSSProperties } from "react";
import "./styles/screens.css";
import { AccountFullToast } from "./components/AccountFullToast";
import { CardMenuHost } from "./components/CardMenu";
import { HiddenTitleToast } from "./components/HiddenTitleToast";
import { LockedKeysToast } from "./components/LockedKeysToast";
import { useNativeSwipe } from "./components/NativeBack";
import { NavBar } from "./components/NavBar";
import { OpenFilesHost } from "./components/OpenFiles";
import { PlayerLayer, usePlayerLayer } from "./components/PlayerLayer";
import { SecretsSyncToast } from "./components/SecretsSyncToast";
import { StoreProblemToast } from "./components/StoreProblemToast";
import { TrailerHost } from "./components/Trailer";
import { UpdateToast, WhatsNewSheet } from "./components/Updates";
import { SeriesPickToast } from "./components/anime/SeriesPickToast";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { focusSearch } from "./lib/catalog";
import { useSettings } from "./lib/net";
import { leaveApp, systemBack } from "./lib/platform";
import { rootTab, useRouter, type Entry, type Route } from "./lib/router";
import { actionFor, isSettingsOpen, useSettingsOverlay } from "./lib/settings";
import {
  cardGhostParts,
  cardOrigin,
  dismissDepth,
  liveCard,
  onDismissDepth,
  pageDrag,
  playCardMotion,
  pressEscape,
  systemBackAction,
  useFormFactor,
  usePageFocus,
  usePageMotion,
  useSystemBack,
  warmUpBlurShaders,
  watchCardTaps,
  watchInputModality,
  whenIdle,
} from "./lib/ui";
import { LazyDetail } from "./screens/lazyScreens";
import { ControllerToast } from "./tv/TvChrome";

export function DesktopApp({ Screen, Settings }: { Screen: ComponentType<{ route: Route }>; Settings: ComponentType }) {
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
  // Both open AND close card transitions play immediately on commit (lib/ui/cardMotion.ts): the page directly
  // under a pushed title stays warm via data-under-top (content-visibility: visible), so Back and swipe-back
  // never stall re-laying out Home's shelves before moving.
  const main = useRef<HTMLElement>(null);
  const dragScrim = useRef<HTMLDivElement>(null);
  const underTop = pages.length > 1 ? pages[pages.length - 2] : undefined;
  const card = motion?.card;
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
          return top && under ? { top, under, card: cardOrigin(pages[pages.length - 1].key), scrim: dragScrim.current } : null;
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
            style={motion ? ({ "--page-dir": motion.dir } as CSSProperties) : undefined}
            data-under-player={(entry === topPage && !!player) || undefined}
            data-under-top={(phone && entry === underTop) || undefined}
            data-page-key={entry.key}
            inert={entry !== topPage || !!playing}
          >
            <ErrorBoundary where={`page ${entry.route.name}`}>
              <Screen route={entry.route} />
            </ErrorBoundary>
            {/* The card's own picture, on the title's page while it grows out of the card or goes back into it:
                the same box, so they move as one piece (shell.css). */}
            {motion?.card?.src && entry.key === (motion.dir === 1 ? motion.enter : motion.leave) && (
              <CardGhost src={motion.card.src} img={motion.card.img} />
            )}
          </section>
        ))}
        {/* Dedicated zero-children scrim for interactive swipe-back (pageDrag.ts), avoiding inherited CSS var recalcs on under. */}
        <div ref={dragScrim} className="drag-scrim" aria-hidden />
        {/* Between the title's page and the one behind it: dims what's behind as the card opens/closes. */}
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
      <Settings />
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
function CardGhost({ src, img }: { src: string; img?: HTMLImageElement }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { panel, media } = cardGhostParts(src, img);
    el.replaceChildren(panel, media);
  }, [src, img]);
  return <div ref={box} className="card-ghost" aria-hidden />;
}
