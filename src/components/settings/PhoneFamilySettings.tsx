import { AnimatePresence, animate, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "../Avatar";
import { ChevronRight, Reset, Search, SignOut } from "../icons";
import { SearchField } from "../ui/SearchField";
import { useAccount } from "../../lib/account";
import { useSettings } from "../../lib/net";
import { buildChannel } from "../../lib/platform";
import {
  closeSettings,
  PAGE_SECTIONS,
  type PageId,
  prefsCustomized,
  resetPrefs,
  sectionOf,
  usePrefs,
  useSettingsOverlay,
} from "../../lib/settings";
import { searchSettings, type SettingEntry } from "../../lib/settings/catalog";
import { dismissDepth, isTextField, prefersReducedMotion, project, useFormFactor } from "../../lib/ui";
import { useSmoothCorners } from "../../lib/ui/cornerSmoothing";
import { tvModeAvailable } from "../../tv/tvMode";
import { SettingsPageBody } from "../../screens/settings/SettingsPageBody";
import type { SettingsHead } from "../SettingsOverlay";
import { FamilyResetTray } from "./FamilyTray";
import { PAGES } from "./pages";

const GROUPS: { heading?: string; pages: PageId[] }[] = [
  { heading: "Settings", pages: ["playback", "subtitles", "appearance", "browsing", "anime", "notifications"] },
  { heading: "Sources", pages: ["sources", "marketplace", "addons", "services"] },
  { heading: "System", pages: ["advanced", "about"] },
];

/**
 * Controls & TV and Controller aren't listed on a phone (keyboard, TV mode and gamepads). The one setting of theirs
 * a phone uses, the player's swipes, is under Playback → On-Screen Controls instead (PlaybackPage).
 */
const PHONE_HIDDEN_PAGES = new Set<PageId>(["controls", "controller"]);
const PHONE_MOVED: Record<string, { page: PageId; section: string }> = {
  swipeGestures: { page: "playback", section: "controls" },
};

const TV_ONLY = new Set(["tvMode", "showTvButton"]);
/** The cards that get smoothed corners, and their radius (`--fms-r-card`). */
const SMOOTH_CARDS = ".fms-list, .fms-results, .ft-account-hero, .settings-card";
const CARD_RADIUS = 24;
const ROW_LABELS = ".settings-row-title, .settings-group-title, .sub-setting-label, .shortcut-label";
const ROW_BOXES = ".settings-row, .settings-group-title, .sub-setting, .shortcut-row";

function revealSetting(root: HTMLElement, entry: SettingEntry) {
  const marked = root.querySelector<HTMLElement>(`[data-setting="${CSS.escape(entry.id)}"]`);
  const label = marked ?? [...root.querySelectorAll<HTMLElement>(ROW_LABELS)].find((el) => el.textContent?.trim() === entry.title);
  if (!label) return;
  const box = marked ?? label.closest<HTMLElement>(ROW_BOXES) ?? label;
  const expand = box.classList.contains("settings-expand") ? box : box.closest<HTMLElement>(".settings-expand");
  const toggle = expand?.dataset.open === "false" ? expand.querySelector<HTMLButtonElement>('.settings-row-button[aria-expanded="false"]') : null;
  toggle?.click();
  box.scrollIntoView({ block: "center" });
  box.removeAttribute("data-search-hit");
  void box.offsetWidth;
  box.setAttribute("data-search-hit", "");
  window.setTimeout(() => box.removeAttribute("data-search-hit"), 1400);
}

/** Snappy critically-damped Family push/pop spring (~220ms settle, zero bounce). */
const FAMILY_PUSH = { type: "spring" as const, stiffness: 560, damping: 44, mass: 0.85 };
/** Pixel-locked ease for the vertical Home ↔ Settings push transition (matches `.ph-main` CSS). */
const FAMILY_ENTER = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

/**
 * 1:1 Family Wallet-inspired mobile Settings experience (phone form factor only):
 * - Opens full-screen from top, pushing the app page cleanly down (exact Family transition, no drawer).
 * - Pure #000000 (dark) / #FFFFFF (light) canvas, bare × / < header icons, centered title,
 *   edge-to-edge rows with indented hairlines and muted gray icons.
 * - Snappy side-by-side horizontal stack push/pop with clean opacity crossfade (zero darkening)
 *   and 1:1 interactive left-edge swipe back.
 */
export function PhoneFamilySettings({
  embedded = false,
  onExit,
  onHead,
}: {
  embedded?: boolean;
  onExit?: () => void;
  onHead?: (head: SettingsHead) => void;
}) {
  const { open, page: requested, embedded: openedEmbedded } = useSettingsOverlay();
  const visible = embedded ? true : open && !openedEmbedded;
  const account = useAccount();
  const prefs = usePrefs();
  const { data: settingsData } = useSettings();
  const { touch } = useFormFactor();
  const reduced = prefersReducedMotion();

  const pages = account.enabled ? PAGES : PAGES.filter((p) => p.id !== "account");
  const fallback = pages.find((p) => p.id === "playback")?.id ?? pages[0].id;
  const [page, setPage] = useState<PageId>(fallback);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "page">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resetTrayOpen, setResetTrayOpen] = useState(false);
  const [target, setTarget] = useState<{ entry: SettingEntry } | null>(null);

  // Track stack animation state so underlying layers stay visible during push/pop/swipe and hide once covered.
  const [animating, setAnimating] = useState(false);
  const [swiping, setSwiping] = useState(false);
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const animTimer = useRef<number | undefined>(undefined);
  const markAnimating = (dir: 1 | -1) => {
    setNavDir(dir);
    window.clearTimeout(animTimer.current);
    setAnimating(true);
    animTimer.current = window.setTimeout(() => setAnimating(false), reduced ? 40 : 260);
  };
  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  const section = PAGE_SECTIONS[page]?.find((s) => s.id === sectionId) ?? null;
  const current = pages.find((p) => p.id === page) ?? pages[0];
  const depth = view === "list" ? 0 : section ? 2 : 1;

  const listLayerRef = useRef<HTMLDivElement>(null);
  const pageLayerRef = useRef<HTMLDivElement>(null);
  const sectionLayerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // The cards' corners: Apple's continuous curve (60% smoothing), not a CSS circle.
  const stackRef = useRef<HTMLDivElement>(null);
  useSmoothCorners(stackRef, SMOOTH_CARDS, CARD_RADIUS, 60, visible);

  const [below, setBelow] = useState(0);
  useEffect(() => {
    if (visible) setBelow(dismissDepth());
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const asked = !!requested && pages.some((p) => p.id === requested);
    if (asked) setPage(requested);
    else if (page === "account") setPage(fallback);
    setView(asked ? "page" : "list");
    setSectionId(null);
    setQuery("");
    setSearchOpen(false);
    setTarget(null);
    setResetTrayOpen(false);
    setAnimating(false);
  }, [visible, requested]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPage = (id: PageId, inSection: string | null = null) => {
    markAnimating(1);
    setPage(id);
    setSectionId(inSection);
    setView("page");
    setQuery("");
    setSearchOpen(false);
  };

  const openSection = (id: string) => {
    markAnimating(1);
    setSectionId(id);
  };

  const popOne = () => {
    if (section) {
      markAnimating(-1);
      setSectionId(null);
    } else if (view === "page") {
      markAnimating(-1);
      setView("list");
    } else if (searchOpen) {
      setSearchOpen(false);
      setQuery("");
    } else if (onExit) {
      onExit();
    } else {
      closeSettings();
    }
  };

  // Report current header title & back handler to ProfileSheet when embedded.
  useEffect(() => {
    if (!onHead) return;
    onHead(
      view === "page"
        ? { label: section?.label ?? current.label, back: popOne }
        : { label: "Settings", back: () => (onExit ?? closeSettings)() },
    );
  }, [onHead, onExit, view, current.label, section]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape / Android system back: yields to open trays/menus (dismissDepth > below).
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dismissDepth() > below) return;
      const at = document.activeElement;
      if (at && at !== document.body && !at.closest(".t3s")) return;
      if (isTextField(at) && "value" in at && at.value) return;
      e.preventDefault();
      e.stopPropagation();
      popOne();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, view, section, searchOpen, below, onExit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal search hit once its target layer mounts.
  useEffect(() => {
    if (!target) return;
    const root = section ? sectionLayerRef.current : pageLayerRef.current;
    if (!root) return;
    const frame = requestAnimationFrame(() => {
      revealSetting(root, target.entry);
      setTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, page, sectionId, section]);

  const pageOf = (id: PageId) => pages.find((p) => p.id === id) ?? pages[0];
  const searching = query.trim() !== "";
  const results = useMemo(
    () =>
      searching
        ? searchSettings(query, (id) => pageOf(id).label, new Set(pages.map((p) => p.id)))
            .map((entry) => (PHONE_MOVED[entry.id] && touch ? { ...entry, page: PHONE_MOVED[entry.id].page } : entry))
            .filter((entry) => (tvModeAvailable || !TV_ONLY.has(entry.id)) && !PHONE_HIDDEN_PAGES.has(entry.page))
        : [],
    [searching, query, pages, touch], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sectionFor = (entry: SettingEntry) =>
    PHONE_MOVED[entry.id]?.page === entry.page ? PAGE_SECTIONS[entry.page]?.find((s) => s.id === PHONE_MOVED[entry.id].section) : sectionOf(entry.page, entry.id);

  const pick = (entry: SettingEntry) => {
    openPage(entry.page, sectionFor(entry)?.id ?? null);
    setTarget({ entry });
  };

  // 1:1 Interactive left-edge swipe back (exact Family 14-30-52 @ 00:18 & 00:37!)
  const swipe = useEdgeSwipeBack({
    enabled: depth > 0 && !reduced,
    topRef: depth === 2 ? sectionLayerRef : pageLayerRef,
    underRef: depth === 2 ? pageLayerRef : listLayerRef,
    onStart: () => setSwiping(true),
    onEnd: (committed) => {
      setSwiping(false);
      if (committed) popOne();
    },
  });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  };

  const activeLabel = view === "page" ? (section?.label ?? current.label) : "Settings";
  const schemeRaw = settingsData?.colorScheme ?? "dark";
  const schemeLabel = schemeRaw === "system" ? "System" : schemeRaw === "light" ? "Light" : "Dark";

  const listCovered = depth > 0 && !animating && !swiping;
  const pageCovered = depth > 1 && !animating && !swiping;

  const titleShift = reduced ? 0 : navDir * 24;

  const content = (
    <>
      {!embedded && (
        <header className={`fms-header${searchOpen && depth === 0 ? " is-searching" : ""}`}>
          {searchOpen && depth === 0 ? (
            <motion.div
              key="search-bar"
              className="fms-head-search"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduced ? 0.08 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <SearchField
                ref={searchInputRef}
                look="plain"
                className="t3s-search fms-search"
                value={query}
                onChange={setQuery}
                label="Search settings"
                placeholder="Search settings"
              />
              <button
                type="button"
                className="fms-search-cancel"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
              >
                Cancel
              </button>
            </motion.div>
          ) : (
            <>
              <button
                type="button"
                className="fms-head-btn"
                aria-label={depth > 0 ? "Back" : "Close settings"}
                onClick={popOne}
              >
                {depth > 0 ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 5l-7 7 7 7" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                )}
              </button>
              <div className="fms-head-title-wrap">
                <AnimatePresence mode="popLayout" initial={false} custom={titleShift}>
                  <motion.h2
                    key={activeLabel}
                    className="fms-head-title"
                    custom={titleShift}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, x: titleShift }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, x: -titleShift }}
                    transition={{ duration: reduced ? 0.08 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {activeLabel}
                  </motion.h2>
                </AnimatePresence>
              </div>
              {depth === 0 ? (
                <button
                  type="button"
                  className="fms-head-btn"
                  aria-label="Search settings"
                  onClick={() => {
                    setSearchOpen(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                >
                  <Search size={20} />
                </button>
              ) : (
                <span className="fms-head-spacer" aria-hidden />
              )}
            </>
          )}
        </header>
      )}

      <div className="fms-stack" ref={stackRef} {...swipe}>
        {/* Layer 0: Root Settings list */}
        <motion.div
          ref={listLayerRef}
          className="fms-layer fms-layer-list"
          data-covered={listCovered || undefined}
          aria-hidden={depth > 0 || undefined}
          animate={reduced ? { opacity: depth > 0 ? 0 : 1 } : { x: depth > 0 ? "-35%" : "0%", opacity: depth > 0 ? 0 : 1 }}
          transition={reduced ? { duration: 0.08 } : FAMILY_PUSH}
        >
          <div className="fms-scroll">
            {embedded && (
              <div className="fms-search-holder">
                <SearchField
                  ref={searchInputRef}
                  look="plain"
                  className="t3s-search fms-search"
                  value={query}
                  onChange={setQuery}
                  label="Search settings"
                  placeholder="Search"
                />
              </div>
            )}

            {searching ? (
              results.length ? (
                <div className="fms-results" role="listbox" aria-label="Matching settings">
                  {results.map((entry) => {
                    const p = pageOf(entry.page);
                    const s = sectionFor(entry);
                    return (
                      <button key={entry.id} type="button" className="fms-result" onClick={() => pick(entry)}>
                        <p.icon size={26} className="fms-row-ico" />
                        <span className="fms-result-text">
                          <span className="fms-result-title">{entry.title}</span>
                          <span className="fms-result-path">{s ? `${p.label} › ${s.label}` : p.label}</span>
                        </span>
                        <ChevronRight size={16} className="fms-row-chev" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="t3s-empty">No settings match “{query.trim()}”.</p>
              )
            ) : (
              <>
                {account.enabled && (
                  <div className="fms-hero-wrap">
                    {account.status === "guest" ? (
                      <button type="button" className="ft-account-hero" onClick={account.showSignIn}>
                        <span className="ft-account-hero-icon" aria-hidden>
                          <SignOut size={22} style={{ transform: "scaleX(-1)" }} />
                        </span>
                        <span className="ft-account-hero-text">
                          <span className="ft-account-hero-title">Sign in</span>
                          <span className="ft-account-hero-sub">Sync profiles, library &amp; settings</span>
                        </span>
                        <ChevronRight size={16} className="fms-row-chev" aria-hidden />
                      </button>
                    ) : account.profile ? (
                      <button type="button" className="ft-account-hero" onClick={() => openPage("account")}>
                        <Avatar id={account.profile.avatar} />
                        <span className="ft-account-hero-text">
                          <span className="ft-account-hero-title">{account.profile.name}</span>
                        </span>
                        <ChevronRight size={16} className="fms-row-chev" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                )}

                {GROUPS.map((g, gi) => {
                  const items = pages.filter((p) => g.pages.includes(p.id));
                  if (!items.length) return null;
                  return (
                    <div className="fms-group" role="group" aria-label={g.heading} key={g.heading ?? gi}>
                      {g.heading && <h3 className="fms-eyebrow">{g.heading}</h3>}
                      <div className="fms-list">
                        {items.map((p) => {
                          return (
                          <button
                            key={p.id}
                            type="button"
                            className="fms-row"
                            data-page={p.id}
                            aria-label={p.label}
                            onClick={() => openPage(p.id)}
                          >
                            <p.icon size={26} className="fms-row-ico" />
                            <span className="fms-row-label">{p.label}</span>
                            {p.id === "appearance" && (
                              <span className="fms-row-val" aria-hidden>
                                {schemeLabel}
                              </span>
                            )}
                            <ChevronRight size={17} className="fms-row-chev" aria-hidden />
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {!account.enabled && buildChannel === "dev" && (
                  <div className="fms-group">
                    <div className="fms-list">
                      <button type="button" className="fms-row" onClick={() => openPage("advanced")}>
                        <SignOut size={26} className="fms-row-ico" style={{ transform: "scaleX(-1)" }} />
                        <span className="fms-row-label">Connect a database</span>
                        <ChevronRight size={16} className="fms-row-chev" aria-hidden />
                      </button>
                    </div>
                  </div>
                )}

                {prefsCustomized(prefs) && (
                  <div className="fms-group">
                    <div className="fms-list">
                      <button
                        type="button"
                        className="fms-row fms-row-danger"
                        onClick={() => setResetTrayOpen(true)}
                      >
                        <Reset size={26} className="fms-row-ico" />
                        <span className="fms-row-label">Restore device defaults</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Layer 1: Pushed Page */}
        <AnimatePresence initial={false}>
          {view === "page" && (
            <motion.div
              ref={pageLayerRef}
              key={`page:${page}`}
              className="fms-layer fms-layer-pushed"
              data-covered={pageCovered || undefined}
              aria-hidden={depth > 1 || undefined}
              initial={reduced ? { opacity: 0 } : { x: "100%", opacity: 0.35 }}
              animate={reduced ? { opacity: depth > 1 ? 0 : 1 } : { x: depth > 1 ? "-35%" : "0%", opacity: depth > 1 ? 0 : 1 }}
              exit={reduced ? { opacity: 0 } : { x: "100%", opacity: 0 }}
              transition={reduced ? { duration: 0.08 } : FAMILY_PUSH}
            >
              <div className="fms-scroll fms-page-scroll">
                <div className="t3s-page fms-page">
                  <SettingsPageBody page={page} section={null} openSection={openSection} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Layer 2: Pushed Section */}
        <AnimatePresence initial={false}>
          {view === "page" && section && (
            <motion.div
              ref={sectionLayerRef}
              key={`sec:${page}/${section.id}`}
              className="fms-layer fms-layer-pushed fms-layer-top"
              initial={reduced ? { opacity: 0 } : { x: "100%", opacity: 0.35 }}
              animate={reduced ? { opacity: 1 } : { x: "0%", opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { x: "100%", opacity: 0 }}
              transition={reduced ? { duration: 0.08 } : FAMILY_PUSH}
            >
              <div className="fms-scroll fms-page-scroll">
                <div className="t3s-page fms-page">
                  <SettingsPageBody page={page} section={section.id} openSection={openSection} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <FamilyResetTray open={resetTrayOpen} onClose={() => setResetTrayOpen(false)} onConfirmReset={() => resetPrefs()} />
    </>
  );

  if (embedded) {
    return (
      <div className="t3s fms-root" data-embedded="" role="region" aria-label={activeLabel} onKeyDown={onKeyDown}>
        {content}
      </div>
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          className="t3s fms-root fms-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label={activeLabel}
          initial={reduced ? { opacity: 0 } : { y: "-100%" }}
          animate={reduced ? { opacity: 1 } : { y: "0%" }}
          exit={reduced ? { opacity: 0 } : { y: "-100%" }}
          transition={reduced ? { duration: 0.1 } : FAMILY_ENTER}
          onKeyDown={onKeyDown}
        >
          {content}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 1:1 left-edge swipe back gesture for stacked Family mobile settings layers. */
function useEdgeSwipeBack({
  enabled,
  topRef,
  underRef,
  onStart,
  onEnd,
}: {
  enabled: boolean;
  topRef: React.RefObject<HTMLDivElement | null>;
  underRef: React.RefObject<HTMLDivElement | null>;
  onStart: () => void;
  onEnd: (committed: boolean) => void;
}) {
  const drag = useRef<{ id: number; startX: number; startY: number; lastX: number; lastT: number; vx: number; dx: number; locked: boolean } | null>(null);

  return {
    onPointerDownCapture: (e: PointerEvent<HTMLElement>) => {
      if (!enabled || drag.current || e.button !== 0) return;
      if (e.clientX > 34) return;
      const now = performance.now();
      drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastT: now, vx: 0, dx: 0, locked: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const rawX = e.clientX - d.startX;
      const rawY = e.clientY - d.startY;
      if (!d.locked) {
        if (Math.abs(rawX) < 10 && Math.abs(rawY) < 10) return;
        if (rawX <= 0 || Math.abs(rawY) > Math.abs(rawX)) {
          drag.current = null;
          return;
        }
        d.locked = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart();
      }
      const now = performance.now();
      const dt = now - d.lastT;
      if (dt > 0) {
        const inst = ((e.clientX - d.lastX) / dt) * 1000;
        d.vx = d.vx === 0 ? inst : inst * 0.6 + d.vx * 0.4;
        d.lastX = e.clientX;
        d.lastT = now;
      }
      const w = e.currentTarget.offsetWidth || window.innerWidth || 390;
      d.dx = Math.max(0, Math.min(w, rawX));
      const progress = d.dx / w;
      const top = topRef.current;
      const under = underRef.current;
      if (top) {
        top.style.transform = `translateX(${d.dx}px)`;
        top.style.opacity = String(Math.max(0.25, 1 - progress * 0.75));
      }
      if (under) {
        under.style.transform = `translateX(${-35 * (1 - progress)}%)`;
        under.style.opacity = String(Math.min(1, progress));
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      if (!d.locked) return;
      const w = e.currentTarget.offsetWidth || window.innerWidth || 390;
      const stale = performance.now() - d.lastT > 80;
      const vx = stale ? 0 : d.vx;
      const projected = d.dx + project(vx, 0.992);
      const commit = vx >= -100 && (d.dx > w * 0.35 || projected > w * 0.45);
      const top = topRef.current;
      const under = underRef.current;
      if (commit) {
        if (top) {
          top.style.transform = "";
          top.style.opacity = "";
        }
        if (under) {
          under.style.transform = "";
          under.style.opacity = "";
        }
        onEnd(true);
      } else {
        if (top) {
          void animate(top, { x: 0, opacity: 1 }, { ...FAMILY_PUSH, velocity: vx }).finished.then(() => {
            top.style.transform = "";
            top.style.opacity = "";
          });
        }
        if (under) {
          void animate(under, { x: "-35%", opacity: 0 }, FAMILY_PUSH).finished.then(() => {
            under.style.transform = "";
            under.style.opacity = "";
          });
        }
        onEnd(false);
      }
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      if (!d.locked) return;
      const top = topRef.current;
      const under = underRef.current;
      if (top) {
        top.style.transform = "";
        top.style.opacity = "";
      }
      if (under) {
        under.style.transform = "";
        under.style.opacity = "";
      }
      onEnd(false);
    },
  };
}
