import { Check, Close, Info, Instant } from "../icons";
import { Segmented } from "../Segmented";
import { useSourceRowPress } from "../SourceInfo";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Still } from "../StillPlaceholder";
import { VideoBackdrop } from "./VideoBackdrop";
import { railInset } from "./EpisodeRail";
import { IconButton } from "../ui/Button";
import { isMpv, type MediaLike } from "./mpvMedia";
import { os } from "../../lib/platform";
import { missMargin, prefersReducedMotion, useFormFactor, useLayer } from "../../lib/ui";
import { nearest } from "../../tv/spatial";

export interface OptionItem {
  id: string;
  label: string;
  /** Second line: addon · size, airdate · time left, … */
  detail?: string;
  /** 16:9 still shown before the text (episodes). */
  thumbnail?: string;
  /** True when the episode has not been watched yet (spoiler blur applies when enabled). */
  unwatched?: boolean;
  /** 0–1 watch progress drawn under the thumbnail. */
  progress?: number;
  /** Small trailing tag: "Watched", "CAM". */
  /** Trailing tag. With `icon`, the icon is shown and `text` becomes its label. */
  badge?: { text: string; tone?: "good" | "bad"; icon?: ReactNode };
  icon?: ReactNode;
  /** Starts a group: a small heading above this row ("Other sources"). */
  heading?: string;
  disabled?: boolean;
  /** A source checked ahead of time (#21): "yes" shows the bolt, "no" dims the row. */
  ready?: "yes" | "no";
  /** Hover text. */
  note?: string;
  /** A source's "i" panel (#229), from the row's "i", a long press or a right-click. */
  onInfo?: (anchor: HTMLElement) => void;
  /** TV: the row's menu (Info, Play), from holding OK or the options button. */
  onMenu?: (anchor: HTMLElement) => void;
}

export interface OptionColumn {
  title: string;
  options: OptionItem[];
  value?: string;
  onSelect: (id: string) => void;
  /** Shown when the column has nothing to pick. */
  empty?: string;
  /** Wide columns hold rich rows (sources); narrow ones plain labels; full spans the screen (the episode rail). */
  size?: "narrow" | "medium" | "wide" | "full";
  /** The title is for screen readers only: the header stands in for it (the season dropdown above the episodes). */
  titleHidden?: boolean;
  /** Controls shown beside the title (filters, sort). */
  header?: ReactNode;
  /** Shown instead of the rows (e.g. subtitle settings in place of the language list). */
  content?: ReactNode;
}

/**
 * Full-window picker over the playing video: columns of rows, the selected
 * row a light pill with a check. Used for speed, audio & subtitles, episodes
 * and sources, so every "choose something" moment in the player looks alike.
 *
 * Long columns scroll on their own within the window (soft fade at the cut
 * edges), and open scrolled to the current selection.
 *
 * Motion is CSS (transitions + @starting-style), so it stays smooth while the
 * video decodes on the main thread: the layer fades in while the frosted
 * picture pulls out of focus (blur + slight zoom), columns rise 8px. Opens
 * over ~500ms, closes along the same path in 160ms.
 */
export function OptionsOverlay({
  open,
  onClose,
  columns,
  media,
  foreground,
  beside = false,
  dockedTo,
}: {
  open: boolean;
  /** The playing video, frosted behind the options. */
  media: MediaLike | null;
  onClose: () => void;
  columns: OptionColumn[];
  /** Drawn above the blur and the columns (e.g. a subtitle preview). */
  foreground?: ReactNode;
  /**
   * A panel beside the picture, which makes room for it, instead of a layer over it: for YouTube's
   * player, which nothing may cover (#384). No frosted copy, no trapped focus; its columns stack.
   */
  beside?: boolean;
  /**
   * The desktop dock (Player.tsx): the panel is a small menu standing above the dock button with this
   * `data-panel`, right-aligned to it and clear of the timeline, instead of a layer over the whole picture.
   * The picture and the rest of the controls stay as they are; a click outside closes it.
   */
  dockedTo?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const docked = !!dockedTo && !beside;
  const { compact } = useFormFactor();
  // Compact multi-column track pickers (Subtitles & Audio) switch columns by tab; custom multi-card panels
  // like Watch Party render their cards stacked so every party action ("End Party") stays on one screen (#247).
  const tabbed = compact && !beside && columns.length > 1 && columns.some((c) => !c.content);
  const [tabIndex, setTabIndex] = useState(0);
  useEffect(() => {
    if (open) setTabIndex(0);
  }, [open]);
  const clampedTab = tabbed ? Math.min(tabIndex, columns.length - 1) : 0;
  const visibleColumns = tabbed ? [columns[clampedTab]] : columns;

  /** A press that may become a click outside the panel. */
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const missesPanel = (e: { target: EventTarget; clientX: number; clientY: number; pointerType: string }) => {
    if ((e.target as Element).closest?.(".options-close, .options-tabs, .select-popup, .srcf-popover, .source-info, .tv-source-menu-layer")) return false;
    const rects = [...(root.current?.querySelectorAll(".options-column, .options-tabs") ?? [])].map((el) => el.getBoundingClientRect());
    return outsidePanel(e.clientX, e.clientY, rects, missMargin(e.pointerType));
  };
  // Stay mounted through the exit transition.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  // Escape through the shared dismiss stack (lib/ui/dismiss.ts), Tab kept inside, focus back to the
  // opener on close. The parent passes a fresh onClose several times a second during playback;
  // useLayer reads the newest without re-running anything (which would snap the lists back mid-scroll).
  useLayer(root, open, onClose, { modal: !beside && !docked });

  // Docked: stand above the button, clear of the timeline, growing out of the button; again as the window resizes.
  useLayoutEffect(() => {
    const el = root.current;
    if (!docked || !open || !mounted || !el) return;
    const place = () => {
      const player = el.closest<HTMLElement>(".player");
      const button = player?.querySelector<HTMLElement>(`[data-panel="${dockedTo}"]`);
      if (!player || !button) return;
      const p = player.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const floor = player.querySelector<HTMLElement>(".player-timeline")?.getBoundingClientRect().top ?? b.top;
      const right = Math.max(DOCK_EDGE, p.right - b.right);
      el.style.setProperty("--dock-right", `${right}px`);
      el.style.setProperty("--dock-bottom", `${Math.max(DOCK_EDGE, p.bottom - floor + DOCK_GAP)}px`);
      el.style.setProperty("--dock-pw", `${p.width}px`);
      el.style.setProperty("--dock-ph", `${p.height}px`);
      el.style.setProperty("--dock-origin", `${Math.max(0, p.right - (b.left + b.width / 2) - right)}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [docked, dockedTo, open, mounted]);

  // Docked: a press anywhere outside the menu closes it, except on its own button (which toggles it) and on a
  // dropdown or popover the menu opened. A press on the picture only closes the menu: it doesn't also pause.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!docked || !open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest || e.button !== 0) return;
      if (root.current?.querySelector(".options-columns")?.contains(target)) return;
      if (target.closest(`[data-panel], ${OPEN_POPUP}, [role="menu"]`)) return;
      if (target.closest(".player-surface")) {
        e.stopPropagation();
        const swallow = (c: Event) => c.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
      }
      closeRef.current();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [docked, open]);

  // Once per opening: show the current choice in every column, focus it for the keyboard.
  useEffect(() => {
    if (!open || !mounted) return;
    // Scroll each list itself — not scrollIntoView, which also scrolls every
    // ancestor (even overflow:hidden ones) and would shift the whole layer.
    root.current?.querySelectorAll<HTMLElement>('.options-column [aria-checked="true"]').forEach((el) => {
      const list = el.closest<HTMLElement>(".options-list");
      if (list) list.scrollTop = topIn(list, el) - list.clientHeight / 2 + el.offsetHeight / 2;
    });
    // The episode rail starts from the one playing (#226). Nothing chosen yet: the layer itself, so Tab and the arrows start inside it.
    const chosen =
      root.current?.querySelector<HTMLElement>('.episode-rail [aria-current="true"] > .episode-rail-main') ??
      root.current?.querySelector<HTMLElement>('.ep-menu [aria-current="true"] > .ep-menu-row') ??
      root.current?.querySelector<HTMLElement>(".speed-line") ??
      root.current?.querySelector<HTMLElement>('.options-column [aria-checked="true"]');
    (chosen ?? root.current)?.focus({ preventScroll: true });
  }, [open, mounted]);

  // When switching compact tabs, scroll the newly visible column's current selection into view.
  useEffect(() => {
    if (!open || !mounted || !tabbed) return;
    root.current?.querySelectorAll<HTMLElement>('.options-column [aria-checked="true"]').forEach((el) => {
      const list = el.closest<HTMLElement>(".options-list");
      if (list) list.scrollTop = topIn(list, el) - list.clientHeight / 2 + el.offsetHeight / 2;
    });
  }, [open, mounted, tabbed, clampedTab]);

  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown inside the overlay handles its own keys.
      if (document.querySelector(OPEN_POPUP)) return;
      const target = e.target as HTMLElement | null;
      // A slider (the source list's size range) takes the arrows for itself.
      if (target?.closest?.('[role="slider"], input[type="range"]')) return;
      // Compact column tabs handle left/right through Segmented's own radiogroup handler.
      if (target?.closest?.(".options-tabs .segmented") && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      // Text, URL and search fields (party code, Watch a Link) keep left/right caret movement; up/down still navigates rows.
      if (target?.matches?.(TEXT_INPUT)) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const input = target as HTMLInputElement;
          // Empty field in a horizontal form (.party-join): ArrowRight can still step to the submit button beside it.
          if (!(e.key === "ArrowRight" && !input.value && input.closest(".party-join"))) return;
        } else if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
          return;
        }
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopPropagation();
        e.preventDefault();
        moveFocus(root.current, e.key);
      }
      // Enter toggles Switch checkboxes on TV remotes / keyboards (browsers only bind Space to checkboxes).
      if (e.key === "Enter" && target?.matches?.('input[type="checkbox"]:not(:disabled)')) {
        e.stopPropagation();
        e.preventDefault();
        (target as HTMLInputElement).click();
        return;
      }
      // Space/Enter act on the focused row natively; keep them from the player. A TV source row times
      // OK itself (held, it opens the row's menu) and keeps it from the player on its own.
      if ((e.key === " " || e.key === "Enter") && !target?.closest?.("[data-hold-ok]")) e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div
      ref={root}
      className="options-overlay"
      data-open={open}
      data-tabbed={tabbed || undefined}
      data-place={beside ? "beside" : docked ? "dock" : undefined}
      role="dialog"
      aria-modal={!beside && !docked}
      aria-label={beside || docked ? columns.map((c) => c.title).join(" & ") : undefined}
      tabIndex={-1}
      data-layer=""
      // A click clearly outside the panel closes it; one that just misses a control does nothing (#202).
      onPointerDown={(e) => {
        press.current = null;
        if (beside || docked || e.button !== 0 || !missesPanel(e)) return;
        // A dropdown open in the panel closes on this click by itself: the panel stays.
        if (document.querySelector(OPEN_POPUP)) return;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        // Released where it was pressed (not a drag or a scroll), and still clearly outside.
        if (p?.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP && missesPanel(e)) onClose();
      }}
      onPointerCancel={() => (press.current = null)}
    >
      {/* On Android mpv draws on a surface behind the clear page: a frosted snapshot over it jumped every
          time it was retaken (#181), so the live picture shows through the shade instead. */}
      {!beside && !docked && !(os === "android" && isMpv(media)) && <VideoBackdrop media={media} />}
      {!beside && !docked && <div className="options-shade" aria-hidden />}
      {!docked && (
        <IconButton variant="player" className="options-close" onClick={onClose} label="Close" title="Close (Esc)">
          <Close size={26} />
        </IconButton>
      )}
      <div className="options-columns" data-count={visibleColumns.length}>
        {tabbed && (
          <div className="options-tabs">
            <Segmented
              label="Panel section"
              value={clampedTab}
              onChange={setTabIndex}
              options={columns.map((col, idx) => ({ id: idx, label: col.title }))}
            />
          </div>
        )}
        {visibleColumns.map((col, c) => (
          <section key={col.title} className="options-column" data-column={tabbed ? clampedTab : c} data-size={col.size ?? "narrow"}>
            <div className="options-head" data-title-only={(!col.header && tabbed) || undefined}>
              <h2 className="options-title" data-hidden={col.titleHidden || tabbed || undefined}>
                {col.title}
              </h2>
              {col.header}
            </div>
            {col.content ? (
              <div className="options-list options-custom">{col.content}</div>
            ) : (
              <>
                {col.options.length === 0 && col.empty && <p className="options-empty">{col.empty}</p>}
                <div role="radiogroup" aria-label={col.title} className="options-list">
                  {col.options.map((o) => (
                    <Fragment key={o.id}>
                      {o.heading && <p className="options-group">{o.heading}</p>}
                      <Row item={o} selected={o.id === col.value} onSelect={col.onSelect} />
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </section>
        ))}
      </div>
      {foreground}
    </div>
  );
}

/** The least room between a docked menu and the player's edges (px), and between it and the timeline. */
const DOCK_EDGE = 16;
const DOCK_GAP = 12;

/** A dropdown or popover open over the panel. Closed ones can stay in the page (marked data-closed): they don't count (#226). */
const OPEN_POPUP = ".select-popup:not([data-closed]), .srcf-popover:not([data-closed]), .source-info, .tv-source-menu";
const TEXT_INPUT = 'input:not([type]), input[type="text"], input[type="url"], input[type="search"], textarea';
const ITEM_SELECTOR = '.options-item:not(:disabled), .options-custom :is(button, input:not([type="hidden"]), select, .sub-swatch-custom):not(:disabled)';
const HGROUP_SELECTOR = ".sub-stepper, .sub-swatches, .source-chips, .party-buttons, .party-join, .party-member-actions";
/** A press that travels further than this (px) is a drag or a scroll, not a click. */
const CLICK_SLOP = 10;

/**
 * Whether (x, y) is clearly outside the panel: past the box around all its
 * columns (their gaps and the space beside a short one included) by more than
 * `margin` (lib/ui/missMargin.ts: wider at the sides).
 */
export function outsidePanel(
  x: number,
  y: number,
  rects: readonly Pick<DOMRect, "left" | "top" | "right" | "bottom">[],
  margin: { x: number; y: number },
) {
  if (!rects.length) return true;
  const left = Math.min(...rects.map((r) => r.left)) - margin.x;
  const top = Math.min(...rects.map((r) => r.top)) - margin.y;
  const right = Math.max(...rects.map((r) => r.right)) + margin.x;
  const bottom = Math.max(...rects.map((r) => r.bottom)) + margin.y;
  return x < left || x > right || y < top || y > bottom;
}

function Row({ item: o, selected, onSelect }: { item: OptionItem; selected: boolean; onSelect: (id: string) => void }) {
  const press = useSourceRowPress({ onPick: () => onSelect(o.id), onInfo: (a) => o.onInfo?.(a), onMenu: o.onMenu });
  const row = (
    <button
      role="radio"
      aria-checked={selected}
      disabled={o.disabled}
      className="options-item"
      data-rich={!!(o.detail || o.thumbnail)}
      data-ready={o.ready}
      data-hold-ok={o.onInfo && o.onMenu ? true : undefined}
      title={o.note}
      onClick={() => onSelect(o.id)}
      {...(o.onInfo ? press : {})}
    >
      <span className="options-check" aria-hidden>
        {selected ? <Check size={20} strokeWidth={2.5} /> : o.ready === "yes" ? <Instant size={17} fill="currentColor" strokeWidth={0} /> : null}
      </span>
      {o.thumbnail !== undefined && (
        <span className="options-thumb" data-unwatched={o.unwatched || undefined} aria-hidden>
          <Still src={o.thumbnail} />
          {o.progress != null && o.progress > 0 && (
            <span className="options-progress">
              <span style={{ transform: `scaleX(${o.progress})` }} />
            </span>
          )}
        </span>
      )}
      <span className="options-text">
        <span className="options-label">{o.label}</span>
        {o.detail && <span className="options-detail">{o.detail}</span>}
      </span>
      {o.badge && (
        <span
          className="options-badge"
          data-tone={o.badge.tone}
          data-icon={!!o.badge.icon}
          title={o.badge.icon ? o.badge.text : undefined}
          aria-label={o.badge.icon ? o.badge.text : undefined}
        >
          {o.badge.icon ?? o.badge.text}
        </span>
      )}
    </button>
  );
  if (!o.onInfo || o.onMenu) return row;
  // The "i" on the row's right, while it's hovered, focused or on a touch screen (player.css).
  return (
    <div className="options-item-wrap">
      {row}
      <button
        className="options-info"
        aria-label="Source info"
        title="Source info"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          o.onInfo?.(e.currentTarget.previousElementSibling as HTMLElement);
        }}
      >
        <Info size={20} />
      </button>
    </div>
  );
}

function collectItems(scope: ParentNode): HTMLElement[] {
  const raw = [...scope.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const el of raw) {
    // `.sub-swatch-custom` is a `<label>` wrapping `<input type="color">`: resolve to its input once so it isn't listed twice.
    const target = el.classList.contains("sub-swatch-custom") ? (el.querySelector<HTMLElement>("input:not(:disabled)") ?? el) : el;
    if (!seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

function hGroupOf(el: Element | null): HTMLElement | null {
  const g = el?.closest<HTMLElement>(HGROUP_SELECTOR) ?? null;
  // `PartyRoomPane` nests `.party-stream` (`display: contents`) inside `.party-buttons`: treat them as one horizontal row.
  if (g?.classList.contains("party-stream")) return g.parentElement?.closest<HTMLElement>(".party-buttons") ?? g;
  return g;
}

function entryOfGroup(group: HTMLElement, pool: HTMLElement[]): HTMLElement | undefined {
  const inGroup = pool.filter((el) => group.contains(el));
  return (
    inGroup.find(
      (el) =>
        el.getAttribute("aria-checked") === "true" ||
        el.getAttribute("aria-pressed") === "true" ||
        el.closest('[aria-checked="true"]') !== null,
    ) ?? inGroup[0]
  );
}

/**
 * Arrow keys: up/down within a column, left/right within horizontal control
 * groups (`.sub-stepper`, `.sub-swatches`, `.source-chips`, `.party-buttons`,
 * `.party-join`) and across columns. A column's header controls (filters, sort,
 * the settings cog) and compact tabs sit above its first row.
 */
function moveFocus(root: HTMLElement | null, key: string) {
  if (!root) return;
  const active = document.activeElement as HTMLElement | null;
  const columns = [...root.querySelectorAll<HTMLElement>(".options-column")];
  if (!columns.length) return;
  const tabsEl = root.querySelector<HTMLElement>(".options-tabs");
  const ci = Math.max(0, columns.findIndex((c) => c.contains(active)));
  const column = columns[ci];
  const head = [...column.querySelectorAll<HTMLElement>(".options-head :is(button, .select-trigger):not(:disabled)")];
  const items = collectItems(column);
  const hi = head.indexOf(active as HTMLElement);
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;

  // Compact column tabs above the active column: Down enters the column's header or first row.
  if (tabsEl && active && tabsEl.contains(active)) {
    if (key === "ArrowDown") {
      if (head.length) return head[0].focus();
      const first = items[0];
      const fg = first ? hGroupOf(first) : null;
      return show(fg ? entryOfGroup(fg, items) : first);
    }
    return;
  }

  // The episode rail (#226): left/right card by card, down to a card's Download and back, up to the
  // head; down from the head (or left/right from elsewhere) lands on the first card in view. EpisodeRail scrolls the focused card in.
  const rail = column.querySelector<HTMLElement>(".episode-rail");
  if (rail) {
    const mains = [...rail.querySelectorAll<HTMLElement>(".episode-rail-main:not(:disabled)")];
    const card = active?.closest<HTMLElement>(".episode-rail-card");
    if (card && rail.contains(card)) {
      const main = card.querySelector<HTMLElement>(".episode-rail-main");
      if (horizontal) return mains[mains.indexOf(main!) + step]?.focus({ preventScroll: true });
      if (active !== main) return key === "ArrowUp" ? main?.focus({ preventScroll: true }) : undefined;
      if (key === "ArrowDown") return card.querySelector<HTMLElement>(".episode-rail-download")?.focus({ preventScroll: true });
      return head[0]?.focus();
    }
    if (key === "ArrowDown" || (horizontal && hi < 0)) {
      const inset = railInset(rail);
      const inView = mains.find((m) => m.closest<HTMLElement>(".episode-rail-card")!.offsetLeft - inset >= rail.scrollLeft - 1) ?? mains[0];
      return inView?.focus({ preventScroll: true });
    }
  }

  if (hi >= 0) {
    // TV's filter chips come in rows (re-test 7): left/right along a row, up/down between rows,
    // down from the last row into the list.
    const row = active!.closest(".srcf-chiprow");
    if (row) {
      const inRow = head.filter((el) => row.contains(el));
      if (horizontal) return inRow[inRow.indexOf(active!) + step]?.focus();
      const next = nearest(active!, head.filter((el) => !row.contains(el)), key === "ArrowDown" ? "down" : "up");
      if (next) return next.focus();
    } else if (horizontal && head[hi + step]) return head[hi + step].focus();
    if (key === "ArrowUp" && tabsEl) {
      return tabsEl.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus();
    }
    if (key === "ArrowDown") {
      const first = items[0];
      const fg = first ? hGroupOf(first) : null;
      return show(fg ? entryOfGroup(fg, items) : first);
    }
    if (!horizontal) return;
  }

  const group = active && column.contains(active) ? hGroupOf(active) : null;
  if (horizontal) {
    if (group) {
      const inGroup = items.filter((el) => group.contains(el));
      const gi = inGroup.indexOf(active!);
      if (gi >= 0 && inGroup[gi + step]) return show(inGroup[gi + step]);
    }
    const target = columns[ci + step];
    if (!target) return;
    const targetItems = collectItems(target);
    const checked = target.querySelector<HTMLElement>('.options-list [aria-checked="true"]');
    const resolved = checked?.classList.contains("sub-swatch-custom") ? (checked.querySelector<HTMLElement>("input:not(:disabled)") ?? checked) : checked;
    show(resolved ?? targetItems[0]);
    return;
  }

  const i = items.indexOf(active as HTMLElement);
  let nextIdx = i + step;
  if (group && i >= 0) {
    const inGroup = items.filter((el) => group.contains(el));
    const edge = step > 0 ? inGroup.at(-1)! : inGroup[0]!;
    nextIdx = items.indexOf(edge) + step;
  }

  if ((i < 0 ? step < 0 : nextIdx < 0) && (head.length || tabsEl)) {
    if (head.length) {
      // Into the last row of chips when there are rows, else the head's pressed control.
      const rows = [...column.querySelectorAll(".options-head .srcf-chiprow")];
      const last = rows.at(-1);
      const pool = last ? head.filter((el) => last.contains(el)) : head;
      return (pool.find((el) => el.getAttribute("aria-pressed") === "true") ?? pool[0]).focus();
    }
    return tabsEl?.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus();
  }

  if (!items.length) return;
  const clamped = i < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, nextIdx));
  const candidate = items[clamped];
  const candidateGroup = candidate ? hGroupOf(candidate) : null;
  show(candidateGroup && candidateGroup !== group ? entryOfGroup(candidateGroup, items) : candidate);
}

/** Focus a row and bring it to the middle of its column, clear of the faded edges. */
function show(el: HTMLElement | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const list = el.closest<HTMLElement>(".options-list");
  if (!list) return;
  const smooth = !prefersReducedMotion();
  list.scrollTo({ top: topIn(list, el) - list.clientHeight / 2 + el.offsetHeight / 2, behavior: smooth ? "smooth" : "auto" });
}

/** Where a row starts in its scrolling list (a source row sits in a wrapper with its "i", so offsetTop won't do). */
function topIn(list: HTMLElement, el: HTMLElement) {
  return el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
}
