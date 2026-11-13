import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Avatar } from "./Avatar";
import { ChevronLeft, ChevronRight, Close, Reset, SignOut } from "./icons";
import { iconButtonClass } from "./ui/Button";
import { useNativeBack } from "./NativeBack";
import { dismissDepth, isTextField, onDismissDepth, useFormFactor } from "../lib/ui";
import { tvModeAvailable } from "../tv/tvMode";
import { SearchField } from "./ui/SearchField";
import { useAccount } from "../lib/account";
import { buildChannel } from "../lib/platform";
import {
  closeSettings,
  PAGE_SECTIONS,
  type PageId,
  prefsCustomized,
  resetPrefs,
  searchSettings,
  sectionOf,
  type SettingEntry,
  usePrefs,
  useSettingsOverlay,
} from "../lib/settings";
import { SettingsPageBody } from "../screens/settings/SettingsPageBody";
import { PAGES } from "./settings/pages";

/**
 * Sidebar groups, T3 Code style: an unlabelled first group, then headed ones. Account isn't listed: the profile
 * button at the foot of the sidebar opens it (#340), and search still reaches its rows.
 */
const GROUPS: { heading?: string; pages: PageId[] }[] = [
  { pages: ["playback", "subtitles", "appearance", "browsing", "anime", "notifications"] },
  { heading: "Input", pages: ["controls", "controller"] },
  { heading: "Sources", pages: ["sources", "marketplace", "addons", "services"] },
  { heading: "System", pages: ["advanced", "about"] },
];

/** Settings for TV mode, left out of search where there is none (tvMode.ts). */
const TV_ONLY = new Set(["tvMode", "showTvButton"]);

/** Where a search result's row can be on its page. */
const ROW_LABELS = ".settings-row-title, .settings-group-title, .sub-setting-label, .shortcut-label";
const ROW_BOXES = ".settings-row, .settings-group-title, .sub-setting, .shortcut-row";

/** Scrolls a page to the setting (by its schema id, else by its label) and briefly highlights it. */
function revealSetting(root: HTMLElement, entry: SettingEntry) {
  const marked = root.querySelector<HTMLElement>(`[data-setting="${CSS.escape(entry.id)}"]`);
  const label = marked ?? [...root.querySelectorAll<HTMLElement>(ROW_LABELS)].find((el) => el.textContent?.trim() === entry.title);
  if (!label) return;
  const box = marked ?? label.closest<HTMLElement>(ROW_BOXES) ?? label;
  box.scrollIntoView({ block: "center" });
  clearTimeout(hitTimers.get(box));
  box.removeAttribute("data-search-hit");
  void box.offsetWidth; // restart the highlight if it's already running
  box.setAttribute("data-search-hit", "");
  // The mark goes once the highlight has played, however it ends: an interrupted animation (page left,
  // Settings closed, window hidden) fires animationcancel or nothing, and a mark left behind would
  // play the highlight again each time the row is shown.
  const unmark = () => {
    clearTimeout(hitTimers.get(box));
    box.removeEventListener("animationend", unmark);
    box.removeEventListener("animationcancel", unmark);
    box.removeAttribute("data-search-hit");
  };
  box.addEventListener("animationend", unmark);
  box.addEventListener("animationcancel", unmark);
  hitTimers.set(box, setTimeout(unmark, SEARCH_HIT_MS));
}

/** How long the highlight plays (`t3s-search-hit` in settings-overlay.css). */
const SEARCH_HIT_MS = 1400;
const hitTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** What a sheet holding Settings shows in its header (`embedded`): the view's name, and where its Back goes. */
export type SettingsHead = { label: string; back: () => void };

/**
 * Settings as a window over the app (T3 Code, Discord, Obsidian): sidebar of
 * sections on the left, breadcrumb header and one scrolling page on the right.
 *
 * `embedded` (a phone): the next view of the profile sheet (ProfileMenu.tsx) rather than a sheet of its own, so
 * it's the same drawer, in its look. The sheet draws the header: `onHead` says what it shows (Settings, or the
 * section open, with Back to the list), and the list's Back is `onExit` (back to the profiles).
 */
export function SettingsOverlay({
  embedded = false,
  onExit,
  onHead,
}: {
  embedded?: boolean;
  onExit?: () => void;
  onHead?: (head: SettingsHead) => void;
} = {}) {
  const { open, page: requested } = useSettingsOverlay();
  const account = useAccount();
  const prefs = usePrefs();
  const pages = account.enabled ? PAGES : PAGES.filter((p) => p.id !== "account");
  const fallback = pages.find((p) => p.id === "playback")?.id ?? pages[0].id;
  const [page, setPage] = useState<PageId>(fallback);
  // A long page's section open (PAGE_SECTIONS), or null for the page itself: its list of sections.
  const [sectionId, setSection] = useState<string | null>(null);
  // Which way the last move between a page and its sections went, for the page's slide in (settings-overlay.css);
  // null for any other change (another page, a search result), which shows at once.
  const [move, setMove] = useState<"in" | "out" | null>(null);
  const openSection = (id: string) => (setMove("in"), setSection(id));
  const closeSection = () => (setMove("out"), setSection(null));
  const section = PAGE_SECTIONS[page]?.find((s) => s.id === sectionId) ?? null;
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  // A phone has no room for the sidebar beside a page: it shows one or the other, the list of
  // sections first, as a phone's own Settings app does. Back (or Escape) goes from a page to the list.
  const phone = useFormFactor().form === "phone";
  const [view, setView] = useState<"list" | "page">("list");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // On iOS the system draws a section's Back, while no menu covers it (lib/platform/nativeBack.ts).
  const backButton = useRef<HTMLButtonElement>(null);
  const layers = useSyncExternalStore(onDismissDepth, dismissDepth);
  // The layers Settings rose over (the profile sheet it opens from stays open below it): only those opened on it cover it.
  const [below, setBelow] = useState(0);
  useEffect(() => {
    if (open) setBelow(dismissDepth());
  }, [open]);
  // Back from a section goes to its page's list of sections, then (on a phone) to the list of pages.
  const back = () => (section ? closeSection() : setView("list"));
  const nativeBack = useNativeBack(backButton, open && phone && view === "page" && layers <= below, ["Settings"], back);
  // Back on a phone's page goes to the list; on the list it closes Settings (#455). The system's Back (iOS's swipe,
  // Android's button and gesture) arrives as Escape (lib/ui/systemBack.ts), so Escape is taken here, before the
  // dialog would close on it (or the sheet below would). A menu open on the page closes first, as it always does.
  useEffect(() => {
    if (!open || !phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dismissDepth() > below) return;
      // A menu's popup (outside the sheet) holding the focus is what Escape closes first.
      const at = document.activeElement;
      if (at && at !== document.body && !at.closest(".t3s")) return;
      // A search with something in it clears itself first.
      if (isTextField(at) && "value" in at && at.value) return;
      e.preventDefault();
      e.stopPropagation();
      if (view === "page") back();
      else if (onExit) onExit();
      else closeSettings();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, phone, view, below, onExit, section]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each opening lands on the requested page (or where it was left, unless that was Account), search cleared.
  useEffect(() => {
    if (!open) return;
    const asked = !!requested && pages.some((p) => p.id === requested);
    if (asked) setPage(requested);
    else if (page === "account") setPage(fallback);
    setView(asked ? "page" : "list");
    setSection(null);
    setMove(null);
    setQuery("");
    setTarget(null);
  }, [open, requested]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [page, sectionId]);

  const current = pages.find((p) => p.id === page) ?? pages[0];
  // The sheet holding it names the view and takes its Back.
  useEffect(() => {
    if (!onHead) return;
    onHead(
      view === "page"
        ? { label: section?.label ?? current.label, back }
        : { label: "Settings", back: () => (onExit ?? closeSettings)() },
    );
  }, [onHead, onExit, view, current.label, section]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageOf = (id: PageId) => pages.find((p) => p.id === id) ?? pages[0];
  const searching = query.trim() !== "";
  const results = useMemo(
    () =>
      searchSettings(query, (id) => pageOf(id).label, new Set(pages.map((p) => p.id))).filter(
        (entry) => tvModeAvailable || !TV_ONLY.has(entry.id),
      ),
    [query, pages], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [selected, setSelected] = useState(0);
  const resultsList = useRef<HTMLDivElement>(null);
  // The setting to scroll to once its page has rendered.
  const [target, setTarget] = useState<{ entry: SettingEntry } | null>(null);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    resultsList.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!target || !scroller.current) return;
    const root = scroller.current;
    // Revealed once: coming back to the page later shows it as it is, without the highlight.
    const frame = requestAnimationFrame(() => {
      revealSetting(root, target.entry);
      setTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, page, sectionId]);

  const go = (id: PageId, inSection: string | null = null) => {
    setPage(id);
    setSection(inSection);
    setMove(null);
    setView("page");
    setQuery("");
  };

  const dragDown = useDragDown(closeSettings);

  const pick = (entry: SettingEntry) => {
    go(entry.page, sectionOf(entry.page, entry.id)?.id ?? null);
    setTarget({ entry }); // a fresh object, so picking the same one again still scrolls
  };

  // The sections and the page, the same in the window and in the sheet; only the chrome round them differs.
  const body = (
    <>
      <nav className="t3s-sidebar" aria-label="Settings sections">
        {phone && !embedded && (
          <div className="t3s-list-head">
            <h2 className="t3s-list-title">Settings</h2>
            <Dialog.Close className={iconButtonClass("settings")} aria-label="Close settings">
              <Close size={18} strokeWidth={2.2} />
            </Dialog.Close>
          </div>
        )}
        <SearchField
          ref={searchInput}
          look="plain"
          className="t3s-search"
          value={query}
          onChange={setQuery}
          label="Search settings"
          placeholder="Search"
          kbd="/"
          role="combobox"
          aria-expanded={searching}
          aria-controls="t3s-results"
          aria-activedescendant={searching && results.length ? `t3s-result-${selected}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (!results.length) return;
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setSelected((i) => (i + step + results.length) % results.length);
            }
            if (e.key === "Enter" && results[selected]) pick(results[selected]);
          }}
        />

        <div className="t3s-groups">
          {searching ? (
            results.length ? (
              <div className="t3s-results" id="t3s-results" role="listbox" aria-label="Matching settings" ref={resultsList}>
                {results.map((entry, i) => {
                  const p = pageOf(entry.page);
                  const s = sectionOf(entry.page, entry.id);
                  return (
                    <div
                      key={entry.id}
                      id={`t3s-result-${i}`}
                      data-index={i}
                      className="t3s-result"
                      role="option"
                      aria-selected={i === selected}
                      onMouseMove={() => i !== selected && setSelected(i)}
                      onMouseDown={(e) => e.preventDefault()} // keep focus in the search field
                      onClick={() => pick(entry)}
                    >
                      <p.icon size={16} strokeWidth={2} />
                      <span className="t3s-result-text">
                        <span className="t3s-result-title">{entry.title}</span>
                        <span className="t3s-result-page">{s ? `${p.label} › ${s.label}` : p.label}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="t3s-empty">No settings match “{query.trim()}”.</p>
            )
          ) : (
            GROUPS.map((g, i) => {
              const items = pages.filter((p) => g.pages.includes(p.id));
              if (!items.length) return null;
              return (
                <div className="t3s-group" role="group" aria-label={g.heading} key={g.heading ?? i}>
                  {g.heading && <h3 className="t3s-group-heading">{g.heading}</h3>}
                  {items.map((p) => (
                    <NavItem key={p.id} page={p} active={!phone && p.id === page} chevron={phone} onClick={() => go(p.id)} />
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* A phone's list of sections: the device's defaults back, once there's something to restore (#455). */}
        {phone && prefsCustomized(prefs) && (
          <div className="t3s-group">
            <button className="t3s-nav-item" onClick={resetPrefs} title="Interface sounds and controller notices on this device">
              <Reset size={16} strokeWidth={2} />
              <span>Restore device defaults</span>
            </button>
          </div>
        )}
        {!account.enabled && buildChannel === "dev" && (
          <div className="t3s-sidebar-foot">
            <button className="t3s-nav-item" onClick={() => go("advanced")}>
              <SignOut size={16} strokeWidth={2} style={{ transform: "scaleX(-1)" }} />
              <span>No database: connect one</span>
            </button>
          </div>
        )}
        {account.enabled && (
          <div className="t3s-sidebar-foot">
            {account.status === "guest" ? (
              <button className="t3s-nav-item" onClick={account.showSignIn}>
                <SignOut size={16} strokeWidth={2} style={{ transform: "scaleX(-1)" }} />
                <span>Sign in to sync</span>
              </button>
            ) : account.profile ? (
              <button
                className="t3s-nav-item"
                data-active={!phone && page === "account"}
                aria-current={!phone && page === "account" ? "page" : undefined}
                onClick={() => go("account")}
              >
                <Avatar id={account.profile.avatar} style={{ width: 18, borderRadius: 5 }} />
                <span>{account.profile.name}</span>
              </button>
            ) : null}
          </div>
        )}
      </nav>

      <div className="t3s-main">
        {!embedded && (
          <header className="t3s-header">
            {phone && (
              <button
                ref={backButton}
                className={iconButtonClass("settings", "t3s-back")}
                data-native-back={nativeBack || undefined}
                aria-label={section ? current.label : "All settings"}
                onClick={back}
              >
                <ChevronLeft size={20} strokeWidth={2.2} />
              </button>
            )}
            <Dialog.Title className="t3s-crumbs">
              <span className="t3s-crumb-root">Settings</span>
              <span className="t3s-crumb-sep" aria-hidden>
                /
              </span>
              {section ? (
                <>
                  {/* Back to the page's list of sections. */}
                  <button className="t3s-crumb-link" onClick={closeSection}>
                    {current.label}
                  </button>
                  <span className="t3s-crumb-sep" aria-hidden>
                    /
                  </span>
                  <span className="t3s-crumb-page">{section.label}</span>
                </>
              ) : (
                <span className="t3s-crumb-page">{current.label}</span>
              )}
            </Dialog.Title>
            <div className="t3s-header-actions">
              {/* On a phone its label doesn't fit here, and its arrow alone read as a Back that did nothing (#455):
                      it's at the foot of the list of sections there. */}
              {!phone && (
                <button
                  className="t3s-ghost"
                  disabled={!prefsCustomized(prefs)}
                  onClick={resetPrefs}
                  title="Interface sounds and controller notices on this device"
                >
                  <Reset size={14} strokeWidth={2.2} />
                  <span className="t3s-ghost-label">Restore device defaults</span>
                </button>
              )}
              <Dialog.Close className={iconButtonClass("settings")} aria-label="Close settings">
                <Close size={16} strokeWidth={2.2} />
              </Dialog.Close>
            </div>
          </header>
        )}

        <div className="t3s-scroll" ref={scroller}>
          <div className="t3s-page" key={`${page}/${sectionId ?? ""}`} data-move={move ?? undefined}>
            <SettingsPageBody page={page} section={section?.id ?? null} openSection={openSection} />
          </div>
        </div>
      </div>
    </>
  );

  if (embedded)
    return (
      // Named as the window is: by the section open, else Settings.
      <div className="t3s" data-embedded="" data-view={view} role="region" aria-label={view === "page" ? (section?.label ?? current.label) : "Settings"}>
        {body}
      </div>
    );

  return (
    <Dialog.Root
      // Drawn closed first: a dialog that's open from its first render (the first time Settings is asked for,
      // before App.tsx has it loaded) shows without its opening motion.
      open={open && mounted}
      onOpenChange={(o) => {
        if (!o) closeSettings();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="t3s-backdrop" />
        <Dialog.Popup
          className="t3s"
          data-view={phone ? view : undefined}
          aria-label="Settings"
          {...(phone ? dragDown : {})}
          onKeyDown={(e) => {
            const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
            if (e.key === "/" && !typing) {
              e.preventDefault();
              searchInput.current?.focus();
            }
          }}
        >
          {phone && (
            <div className="t3s-grab" aria-hidden>
              <div className="t3s-grabber" />
            </div>
          )}
          {body}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NavItem({
  page,
  active,
  chevron,
  onClick,
}: {
  page: (typeof PAGES)[number];
  active: boolean;
  /** A phone's list: each section opens a page of its own. */
  chevron?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="t3s-nav-item" data-active={active} aria-current={active ? "page" : undefined} onClick={onClick}>
      <page.icon size={16} strokeWidth={2} />
      <span>{page.label}</span>
      {chevron && <ChevronRight size={18} className="t3s-nav-chevron" aria-hidden />}
    </button>
  );
}

/** Past this far down, or this fast (px/ms), letting go closes the sheet. */
const CLOSE_AT = 140;
const FLICK = 0.11;

/**
 * A phone's Settings sheet follows a finger down from its grabber or a header, and closes when let go far
 * enough down or flicked; otherwise it springs back. Up past the top it gives a little, against friction.
 * Only the first finger drags (pointer capture keeps it, off the sheet too).
 */
function useDragDown(close: () => void) {
  const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(null);
  const settle = (el: HTMLElement, transform: string, ms: number, curve: string) => {
    el.style.transition = `transform ${ms}ms ${curve}`;
    el.style.transform = transform;
    const done = () => {
      el.style.transition = "";
      el.removeEventListener("transitionend", done);
    };
    el.addEventListener("transitionend", done);
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const t = e.target as HTMLElement;
      if (drag.current || e.button !== 0) return;
      if (!t.closest(".t3s-grab, .t3s-list-head, .t3s-header") || t.closest("button, input, a")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.style.transition = "none";
      drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const raw = e.clientY - d.y;
      d.dy = raw < 0 ? raw * 0.1 : raw;
      e.currentTarget.style.transform = `translateY(${d.dy}px)`;
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      const el = e.currentTarget;
      const velocity = d.dy / Math.max(1, performance.now() - d.t);
      if (d.dy > CLOSE_AT || (d.dy > 24 && velocity > FLICK)) {
        settle(el, "translateY(100%)", 240, "var(--ease-out)");
        close();
      } else settle(el, "", 320, "var(--ease-drawer)");
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (drag.current?.id !== e.pointerId) return;
      drag.current = null;
      settle(e.currentTarget, "", 320, "var(--ease-drawer)");
    },
  };
}
