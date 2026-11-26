import "../../styles/trash.css";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../../lib/ui";
import { ArrowLeft, Check, CheckAll, Trash } from "../icons";

/**
 * Select and delete, in the manner of Family's collectibles: a Select button (or a tap of Shift, or Shift-clicking a
 * tile) puts a set of tiles into selection (a check on each), a floating bar of three keys (Back, Select All, Delete)
 * acts on them, and Delete lifts the picked tiles off the page into a stack over a glass bin while the page blurs away
 * behind a confirm view. Confirming drops them into the bin and the page comes back without them; Cancel flies them
 * home.
 *
 * The parts: `useSelection` (state), `Selectable` (one tile), `TrashFlow` (the bar and the confirm view).
 */

// --- Selection ------------------------------------------------------------------------------------

export interface Selection {
  selecting: boolean;
  /** Picked ids still on the page, in page order. */
  selected: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Everything on the page picked, or (when it all is) nothing. */
  toggleAll: () => void;
  allSelected: boolean;
  /** Into selection, with `first` already picked (a Shift-click). */
  start: (first?: string) => void;
  stop: () => void;
}

/** Selection over the ids on the page now; ids that leave the page leave the selection. */
export function useSelection(ids: readonly string[]): Selection {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const selected = ids.filter((id) => picked.has(id));
  const allSelected = ids.length > 0 && selected.length === ids.length;
  const toggle = useCallback(
    (id: string) =>
      setPicked((p) => {
        const next = new Set(p);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  return {
    selecting,
    selected,
    isSelected: (id) => picked.has(id),
    toggle,
    toggleAll: () => setPicked(allSelected ? new Set() : new Set(ids)),
    allSelected,
    start: (first) => {
      setPicked(new Set(first ? [first] : []));
      setSelecting(true);
    },
    stop: () => {
      setSelecting(false);
      setPicked(new Set());
    },
  };
}

/**
 * One tile that can be picked. Always wrapped (so a tile isn't remounted, and its artwork reloaded, on entering
 * selection); while selecting, the tile underneath is inert and a check button covers it.
 */
export function Selectable({
  id,
  label,
  selection,
  className,
  children,
}: {
  id: string;
  /** The tile's name, for the check's label. */
  label: string;
  selection: Selection;
  className?: string;
  children: ReactNode;
}) {
  const on = selection.selecting && selection.isSelected(id);
  return (
    <div
      className={className ? `selectable ${className}` : "selectable"}
      data-trash-key={id}
      data-selecting={selection.selecting || undefined}
      data-selected={on || undefined}
      // Shift-click a tile: into selection with it picked, instead of opening it.
      onClickCapture={(e) => {
        if (selection.selecting || !e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        selection.start(id);
      }}
    >
      <div className="selectable-body" inert={selection.selecting || undefined}>
        {children}
      </div>
      {selection.selecting && (
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={label}
          className="selectable-hit"
          onClick={() => selection.toggle(id)}
        >
          <span className="select-check" data-on={on || undefined} aria-hidden>
            <Check size={14} strokeWidth={3} />
          </span>
        </button>
      )}
    </div>
  );
}

/** "Select", or "Done" while selecting: the way into selection, for a page's header. */
export function SelectButton({ selection, className, disabled }: { selection: Selection; className: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={selection.selecting ? "Done (Shift)" : "Select (Shift)"}
      aria-keyshortcuts="Shift"
      onClick={() => (selection.selecting ? selection.stop() : selection.start())}
    >
      {selection.selecting ? "Done" : "Select"}
    </button>
  );
}

// --- The bar and the confirm view -----------------------------------------------------------------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TrashFlow({
  selection,
  scope,
  noun,
  verb,
  title,
  body,
  note,
  onDelete,
}: {
  selection: Selection;
  /** Where the tiles are (a page underneath may hold tiles with the same ids). */
  scope: RefObject<HTMLElement | null>;
  noun: readonly [one: string, many: string];
  verb: "Delete" | "Remove";
  /** The confirm view's words, for how many are going. */
  title: string | ((n: number) => string);
  body: string | ((n: number) => string);
  note?: string;
  onDelete: (ids: string[]) => void;
}) {
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const n = selection.selected.length;
  // Pages stay mounted under the one on top (and tabs beside it), made inert: selection ends when its page does.
  const { selecting, stop } = selection;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!selecting) return;
    const check = () => scope.current?.closest("[inert]") && stopRef.current();
    const mo = new MutationObserver(check);
    mo.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["inert"],
    });
    return () => mo.disconnect();
  }, [selecting, scope]);

  // A tap of Shift (pressed and let go with nothing else in between) goes into selection, or back out of it.
  const toggleRef = useRef(() => {});
  toggleRef.current = () => (selection.selecting ? selection.stop() : selection.start());
  const confirmingRef = useRef(false);
  confirmingRef.current = !!confirming;
  useEffect(() => {
    let tap = false;
    const typing = (t: Element | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      tap = e.key === "Shift" && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target as Element);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !tap) return;
      tap = false;
      const s = scope.current;
      // Only the page on show answers: the ones under it, and other tabs, are inert.
      if (!s?.isConnected || s.closest("[inert]") || confirmingRef.current || typing(document.activeElement)) return;
      toggleRef.current();
    };
    const interrupt = () => (tap = false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", interrupt, true);
    window.addEventListener("blur", interrupt);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", interrupt, true);
      window.removeEventListener("blur", interrupt);
    };
  }, [scope]);

  const what = (k: number) => `${k} ${k === 1 ? noun[0] : noun[1]}`;
  return (
    <>
      {selection.selecting && (
        <SelectionBar
          count={n}
          status={n ? `${what(n)} selected` : `Select ${noun[1]}`}
          allSelected={selection.allSelected}
          onAll={selection.toggleAll}
          onDone={selection.stop}
          onDelete={() => n && setConfirming(selection.selected)}
          verb={verb}
          deleteLabel={`${verb} ${what(n)}`}
          paused={!!confirming}
        />
      )}
      {confirming && (
        <TrashConfirm
          keys={confirming}
          scope={scope}
          title={typeof title === "function" ? title(confirming.length) : title}
          body={typeof body === "function" ? body(confirming.length) : body}
          note={note}
          action={`${verb} ${confirming.length} ${cap(confirming.length === 1 ? noun[0] : noun[1])}`}
          onConfirm={() => onDelete(confirming)}
          onClosed={(done) => {
            setConfirming(null);
            if (done) selection.stop();
          }}
        />
      )}
    </>
  );
}

/** Family's toolbar: three keys, each a glyph over its word, on a frosted tray. */
function SelectionBar({
  count,
  status,
  allSelected,
  onAll,
  onDone,
  onDelete,
  verb,
  deleteLabel,
  paused,
}: {
  count: number;
  /** "3 playlists selected", read out as it changes. */
  status: string;
  allSelected: boolean;
  onAll: () => void;
  onDone: () => void;
  onDelete: () => void;
  verb: string;
  deleteLabel: string;
  /** The confirm view is up: Escape is its. */
  paused: boolean;
}) {
  useEscape(!paused, onDone);
  return createPortal(
    <div className="select-bar" role="toolbar" aria-label="Selection" data-paused={paused || undefined}>
      <span className="select-bar-status" aria-live="polite">
        {status}
      </span>
      <button type="button" className="select-key" onClick={onDone}>
        <ArrowLeft size={22} strokeWidth={2} />
        <span>Back</span>
      </button>
      <button type="button" className="select-key" aria-pressed={allSelected} onClick={onAll}>
        <CheckAll size={22} strokeWidth={1.8} />
        <span>{allSelected ? "Deselect All" : "Select All"}</span>
      </button>
      <button type="button" className="select-key" aria-label={deleteLabel} disabled={!count} onClick={onDelete}>
        <span className="select-key-glyph">
          <Trash size={22} strokeWidth={1.8} />
          {count > 0 && (
            <b className="select-key-count tabular" key={count}>
              {count}
            </b>
          )}
        </span>
        <span>{verb}</span>
      </button>
    </div>,
    document.body,
  );
}

/** Escape runs `fn` (ahead of the page's own Escape, which would go back). */
function useEscape(on: boolean, fn: () => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [on]);
}

// --- The confirm view and its flight --------------------------------------------------------------

/** The stack over the bin: front card first. Offsets from the bin's centre line, degrees of turn. */
const FAN = [
  { dx: -2, dy: 0, r: -2.5 },
  { dx: 26, dy: -10, r: 8 },
  { dx: -26, dy: -5, r: -9 },
] as const;
const CARD_W = 104;
/** The bin as drawn (its SVG's box), its rim's centre line and its floor. */
const BIN_W = 176;
const RIM_Y = 14;
const FLOOR_Y = 182;
/** How much of a card stands above the rim. */
const ABOVE_RIM = 0.44;

/** Lift-off: a critically damped spring (as the title dialog's open), the front card first. */
const FLY_OMEGA = 15;
const FLY_MS = 620;
const FLY_DELAY = [0, 40, 70];
/** Into the bin: falling (accelerating), back card first so the front one is last seen. */
const SINK_MS = 400;
const SINK_DELAY = [70, 35, 0];
/** The page comes back once the bin has swallowed them. */
const EXIT_AT = 560;
const EXIT_MS = 320;

interface Flight {
  card: HTMLElement;
  source: HTMLElement;
  /** Laid out at its place in the stack; `home` is the transform that puts it back over its tile. */
  home: string;
  rest: string;
  dx: number;
  top: number;
  h: number;
  anim?: Animation;
}

const spring = (omega: number, t: number) => {
  const u = (omega * t) / 1000;
  return 1 - (1 + u) * Math.exp(-u);
};
const tile = (scope: HTMLElement | null, key: string) => scope?.querySelector<HTMLElement>(`[data-trash-key="${CSS.escape(key)}"]`) ?? null;

function TrashConfirm({
  keys,
  scope,
  title,
  body,
  note,
  action,
  onConfirm,
  onClosed,
}: {
  keys: string[];
  scope: RefObject<HTMLElement | null>;
  title: string;
  body: string;
  note?: string;
  action: string;
  onConfirm: () => void;
  onClosed: (confirmed: boolean) => void;
}) {
  const ids = useId();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const flights = useRef<Flight[]>([]);
  /** Picked tiles past the third: they fade where they are instead of flying. */
  const others = useRef<HTMLElement[]>([]);
  const phase = useRef<"open" | "confirming" | "cancelling">("open");
  const [busy, setBusy] = useState(false);

  // The page's parts that come and go together (all but the cards).
  const fading = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-trash-fade]") ?? [])];

  useLayoutEffect(() => {
    const s = stage.current?.getBoundingClientRect();
    const sources = keys.map((k) => tile(scope.current, k)).filter((el): el is HTMLElement => !!el);
    const quiet = prefersReducedMotion();
    const flown = sources.slice(0, FAN.length);
    others.current = sources.slice(FAN.length);
    for (const el of others.current) el.dataset.trashAway = "fade";

    if (s && layer.current) {
      const cx = s.left + BIN_W / 2;
      const rim = s.top + RIM_Y;
      const made: Flight[] = flown.map((source, i) => {
        const art = source.querySelector<HTMLElement>(".card-frame") ?? source;
        const r = art.getBoundingClientRect();
        // The card is drawn at the stack's size; at `k` times the tile's.
        const k = CARD_W / r.width;
        const h = r.height * k;
        const f = FAN[i];
        const left = cx - CARD_W / 2 + f.dx;
        const top = rim - ABOVE_RIM * h + f.dy;
        const card = document.createElement("div");
        card.className = "trash-card";
        Object.assign(card.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${CARD_W}px`,
          height: `${h}px`,
          borderRadius: `${(parseFloat(getComputedStyle(art).borderTopLeftRadius) || 10) * k}px`,
        });
        // The artwork, clipped to the card's corners; the check sits over it, unclipped.
        const clip = document.createElement("div");
        clip.className = "trash-card-art";
        const copy = art.cloneNode(true) as HTMLElement;
        copy.removeAttribute("id");
        Object.assign(copy.style, {
          width: `${r.width}px`,
          height: `${r.height}px`,
          transform: `scale(${k})`,
          transformOrigin: "0 0",
          transition: "none",
          scale: "none",
        });
        clip.append(copy);
        card.append(clip);
        // The tile's own check, copied where it is on the tile and at its size there, so a card flown back home
        // matches its tile exactly when they swap.
        const check = source.querySelector<HTMLElement>(".select-check");
        if (check) {
          const c = check.getBoundingClientRect();
          const tick = check.cloneNode(true) as HTMLElement;
          Object.assign(tick.style, {
            left: `${(c.left - r.left) * k}px`,
            top: `${(c.top - r.top) * k}px`,
            right: "auto",
            width: `${c.width}px`,
            height: `${c.height}px`,
            transform: `scale(${k})`,
            transformOrigin: "0 0",
            animation: "none",
            transition: "none",
          });
          card.append(tick);
        }
        const ox = r.left + r.width / 2 - (left + CARD_W / 2);
        const oy = r.top + r.height / 2 - (top + h / 2);
        const home = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px) scale(${(1 / k).toFixed(4)}) rotate(0deg)`;
        const rest = `translate(0px, 0px) scale(1) rotate(${f.r}deg)`;
        const frames: Keyframe[] = [];
        const n = 30;
        for (let j = 0; j <= n; j++) {
          const p = j === n ? 1 : spring(FLY_OMEGA, (FLY_MS * j) / n);
          // A little lift on the way, as if picked up.
          const lift = 28 * 4 * p * (1 - p);
          const sc = 1 / k + (1 - 1 / k) * p;
          frames.push({
            offset: j / n,
            transform: `translate(${(ox * (1 - p)).toFixed(2)}px, ${(oy * (1 - p) - lift).toFixed(2)}px) scale(${sc.toFixed(4)}) rotate(${(f.r * p).toFixed(2)}deg)`,
          });
        }
        source.dataset.trashAway = "";
        const anim = quiet
          ? card.animate(
              [
                { opacity: 0, transform: rest },
                { opacity: 1, transform: rest },
              ],
              { duration: 200, fill: "both" },
            )
          : card.animate(frames, {
              duration: FLY_MS,
              delay: FLY_DELAY[i],
              easing: "linear",
              fill: "both",
            });
        return { card, source, home, rest, dx: f.dx, top, h, anim };
      });
      // Back card first in the DOM, so the front one draws over it.
      flights.current = made.reverse();
      for (const f of flights.current) layer.current.append(f.card);
    }

    // The page blurs away and the view comes in: the scrim first, the words and the bin together just after.
    const scrim = root.current?.querySelector<HTMLElement>(".trash-scrim");
    scrim?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: quiet ? 150 : 300,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: "both",
    });
    for (const el of fading()) {
      if (el === scrim) continue;
      const delay = quiet ? 0 : Number(el.dataset.trashFade) || 0;
      const isBin = el.dataset.trashBin !== undefined;
      const from: Keyframe = quiet
        ? { opacity: 0 }
        : isBin
          ? { opacity: 0, transform: "scale(0.9)" }
          : { opacity: 0, transform: "translateY(10px)", filter: "blur(8px)" };
      const to: Keyframe = quiet
        ? { opacity: 1 }
        : isBin
          ? { opacity: 1, transform: "none" }
          : { opacity: 1, transform: "none", filter: "blur(0px)" };
      el.animate([from, to], {
        duration: quiet ? 150 : 400,
        delay,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "both",
      });
    }
    cancelBtn.current?.focus({ preventScroll: true });

    const all = [...flown, ...others.current];
    return () => {
      for (const el of all) delete el.dataset.trashAway;
      for (const f of flights.current) f.card.remove();
    };
    // Measured once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Freezes a card where it is now, so the next move starts from there (mid-flight too). */
  const hold = (f: Flight) => {
    if (f.anim) {
      f.anim.commitStyles();
      f.anim.cancel();
    }
    return {
      transform: f.card.style.transform || f.rest,
      opacity: f.card.style.opacity || "1",
    };
  };

  const leave = (ms: number) =>
    Promise.all(
      fading().map((el) => {
        el.getAnimations().forEach((a) => (a.commitStyles(), a.cancel()));
        const blur = el.dataset.trashBin === undefined && !el.classList.contains("trash-scrim");
        return el.animate([{ opacity: 0, ...(blur && { filter: "blur(8px)" }) }], {
          duration: ms,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "forwards",
        }).finished;
      }),
    );

  const confirm = () => {
    if (phase.current !== "open") return;
    phase.current = "confirming";
    setBusy(true);
    const quiet = prefersReducedMotion();
    const s = stage.current?.getBoundingClientRect();
    const n = flights.current.length;
    flights.current.forEach((f, j) => {
      const from = hold(f);
      // Back to front in the DOM; SINK_DELAY is front first.
      const i = n - 1 - j;
      const sink = s ? s.top + FLOOR_Y - f.h - f.top : 120;
      f.anim = quiet
        ? f.card.animate([from, { opacity: 0 }], {
            duration: 160,
            fill: "forwards",
          })
        : f.card.animate(
            [
              { ...from, offset: 0 },
              { opacity: 1, offset: 0.55 },
              {
                transform: `translate(${-f.dx}px, ${sink.toFixed(2)}px) scale(0.96) rotate(0deg)`,
                opacity: 0,
                offset: 1,
              },
            ],
            {
              duration: SINK_MS,
              delay: SINK_DELAY[i],
              easing: "cubic-bezier(0.5, 0, 0.75, 0)",
              fill: "forwards",
            },
          );
    });
    // The bin takes the weight as they land.
    if (!quiet)
      for (const el of root.current?.querySelectorAll<HTMLElement>("[data-trash-bin]") ?? [])
        el.animate(
          [
            { transform: "none" },
            { transform: "scale(1.035, 0.955)", offset: 0.3 },
            { transform: "scale(0.99, 1.01)", offset: 0.65 },
            { transform: "none" },
          ],
          { duration: 420, delay: 300, easing: "ease-out", composite: "add" },
        );
    window.setTimeout(
      () => {
        onConfirm();
        void leave(quiet ? 150 : EXIT_MS).then(() => onClosed(true));
      },
      quiet ? 180 : EXIT_AT,
    );
  };

  const cancel = () => {
    if (phase.current !== "open") return;
    phase.current = "cancelling";
    setBusy(true);
    const quiet = prefersReducedMotion();
    for (const el of others.current) delete el.dataset.trashAway;
    const back = flights.current.map((f) => {
      const from = hold(f);
      f.anim = quiet
        ? f.card.animate([from, { opacity: 0 }], {
            duration: 150,
            fill: "forwards",
          })
        : f.card.animate([from, { transform: f.home, opacity: 1 }], {
            duration: 440,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
            fill: "forwards",
          });
      // Landed over its tile: the tile shows again at once, under the copy, so nothing dips.
      return f.anim.finished.then(() => {
        f.source.style.transition = "none";
        delete f.source.dataset.trashAway;
        void getComputedStyle(f.source).opacity;
        f.source.style.removeProperty("transition");
      });
    });
    void Promise.all([...back, leave(quiet ? 150 : 280)]).then(() => onClosed(false));
  };

  useEscape(true, cancel);

  return createPortal(
    <div
      ref={root}
      className="trash-root"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${ids}-t`}
      aria-describedby={`${ids}-d`}
      data-busy={busy || undefined}
      onKeyDown={(e) => {
        // Two buttons: Tab goes between them.
        if (e.key !== "Tab") return;
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".trash-actions button")];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}
    >
      <div className="trash-scrim" data-trash-fade="0" />
      <div className="trash-sheet">
        <div className="trash-head" data-trash-fade="60">
          <Trash size={22} className="trash-icon" />
          <h2 className="trash-title" id={`${ids}-t`}>
            {title}
          </h2>
          <p className="trash-body" id={`${ids}-d`}>
            {body}
          </p>
        </div>
        <div className="trash-stage" ref={stage}>
          <BinBack />
          <div className="trash-bin-front" data-trash-fade="140" data-trash-bin style={{ clipPath: `path("${BIN_FRONT}")` }}>
            <BinFront />
          </div>
        </div>
        <div className="trash-actions" data-trash-fade="110">
          <button type="button" className="trash-go" onClick={confirm}>
            {action}
          </button>
          <button type="button" className="trash-cancel" ref={cancelBtn} onClick={cancel}>
            Cancel
          </button>
        </div>
        {note && (
          <p className="trash-note" data-trash-fade="160">
            {note}
          </p>
        )}
      </div>
      <div className="trash-cards" ref={layer} aria-hidden />
    </div>,
    document.body,
  );
}

/*
 * The bin, drawn after Family's: a frosted plastic cup, its rim a thin rolled lip, its sides tapering a little to a
 * rounded foot, lit like a cylinder (bright down the middle, shaded toward each side). Its colours are trash.css's
 * --bin-* (milky white on a light page, smoked glass on a dark one). Box 176 × 196; the rim's centre line at y 14.
 */
const RIM = { cx: 88, cy: 14, rx: 86, ry: 12 };
/** The front face: the near half of the rim, down the tapering sides, round the foot. Also the frost's clip. */
const BIN_FRONT = "M2 14 A86 12 0 0 0 174 14 L159.6 166 C158.8 177 152.5 182.6 142 184 Q88 191 34 184 C23.5 182.6 17.2 177 16.4 166 Z";
const stop = (offset: number, color: string) => <stop offset={offset} style={{ stopColor: `var(${color})` }} />;

/** The bin's inside and its shadow on the floor, under the cards. */
function BinBack() {
  const id = useId();
  return (
    <svg className="trash-bin-back" data-trash-fade="140" data-trash-bin viewBox="0 0 176 196" width="176" height="196" aria-hidden>
      <defs>
        {/* Inside: the far wall in the rim's shade, lighter down toward the near rim. */}
        <linearGradient id={`${id}-in`} x1="0" y1="0" x2="0" y2="1">
          {stop(0, "--bin-in-far")}
          {stop(1, "--bin-in-near")}
        </linearGradient>
        <filter id={`${id}-soft`} x="-30%" y="-300%" width="160%" height="700%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <ellipse cx="88" cy="189" rx="62" ry="5" style={{ fill: "var(--bin-floor)" }} filter={`url(#${id}-soft)`} />
      <ellipse {...RIM} fill={`url(#${id}-in)`} />
      <path d={`M2 ${RIM.cy} A86 12 0 0 1 174 ${RIM.cy}`} fill="none" style={{ stroke: "var(--bin-lip)" }} strokeWidth="2.25" />
    </svg>
  );
}

/** The front face: frosted body, cylinder light, a darker foot and the rolled lip. */
function BinFront() {
  const id = useId();
  return (
    <svg viewBox="0 0 176 196" width="176" height="196" aria-hidden>
      <defs>
        <linearGradient id={`${id}-round`} x1="0" y1="0" x2="1" y2="0">
          {stop(0, "--bin-side")}
          {stop(0.16, "--bin-clear")}
          {stop(0.38, "--bin-light")}
          {stop(0.62, "--bin-clear")}
          {stop(0.86, "--bin-clear")}
          {stop(1, "--bin-side")}
        </linearGradient>
        <linearGradient id={`${id}-depth`} x1="0" y1="0" x2="0" y2="1">
          {stop(0, "--bin-under-lip")}
          {stop(0.09, "--bin-clear")}
          {stop(0.72, "--bin-clear")}
          {stop(1, "--bin-foot")}
        </linearGradient>
      </defs>
      <path d={BIN_FRONT} style={{ fill: "var(--bin-body)" }} />
      <path d={BIN_FRONT} fill={`url(#${id}-round)`} />
      <path d={BIN_FRONT} fill={`url(#${id}-depth)`} />
      <path d={BIN_FRONT} fill="none" style={{ stroke: "var(--bin-edge)" }} strokeWidth="1" />
      {/* The lip: a bright rolled edge with its own shadow just under it. */}
      <path d={`M3.5 ${RIM.cy + 2.6} A84.5 11.4 0 0 0 172.5 ${RIM.cy + 2.6}`} fill="none" style={{ stroke: "var(--bin-under-lip)" }} strokeWidth="2" />
      <path d={`M2 ${RIM.cy} A86 12 0 0 0 174 ${RIM.cy}`} fill="none" style={{ stroke: "var(--bin-lip)" }} strokeWidth="2.75" strokeLinecap="round" />
    </svg>
  );
}
