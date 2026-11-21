import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { removeFromContinueWatching } from "../lib/library/titleActions";
import type { Progress } from "../lib/types";
import { TrashLid, useConfirmDelete } from "./ConfirmDeleteButton";
import { Check, CheckAll, Close, Edit } from "./icons";
import { useFormFactor } from "../lib/ui";
import { Row } from "./Row";
import { Button, buttonClass } from "./ui/Button";

/**
 * Home's Continue Watching row, with a way to remove several at once: the cards become checkboxes (the card
 * itself goes inert, so a click picks it rather than opening it), with Select All, Remove and Done as round
 * buttons in the heading (Remove asks for a second click, its bin's lid open, as a download's Delete does). With a keyboard it's there while Shift is held, and stays once something is picked, until Done,
 * Escape or Remove; a touch screen, with no Shift, has an Edit button for it. Remove does what each card menu's
 * "Remove from Continue Watching" does (titleActions.ts): the video goes back to its start, the rest of the
 * title's history stays.
 */
export function ContinueEditRow({
  items,
  order,
  card,
  remove = removeFromContinueWatching,
}: {
  items: Progress[];
  order: string;
  card: (p: Progress) => ReactNode;
  /** For tests; the card menu's removal otherwise. */
  remove?: (entries: Progress[]) => unknown;
}) {
  const [opened, setOpened] = useState(false);
  const shift = useShiftHeld();
  const touch = useCoarsePointer();
  const phone = useFormFactor().form === "phone";
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // What's picked and still in the row (a card can leave it while editing: played elsewhere, synced).
  const selected = useMemo(() => items.filter((p) => picked.has(p.videoId)), [items, picked]);
  const editing = opened || shift || selected.length > 0;
  const all = selected.length === items.length;
  const box = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Leaving Edit puts focus back on its button (touch), so the keyboard isn't dropped at the top of the page: when
  // focus was in the row, or fell out of it with the bar it was on. Letting go of Shift elsewhere moves nothing.
  useEffect(() => {
    const at = document.activeElement;
    const dropped = !at || !!box.current?.contains(at) || at.contains(box.current);
    if (wasEditing.current && !editing && dropped) editButton.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);

  const done = () => {
    setOpened(false);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const removeSelected = () => {
    if (!selected.length) return;
    void remove(selected);
    done();
  };

  const { armed, props: confirm } = useConfirmDelete(removeSelected, `Remove ${selected.length === 1 ? "1 Title" : `${selected.length} Titles`}`);
  const n = selected.length;

  // Both states are always there, one faded out and inert, so pressing Shift eases the bar in rather than
  // swapping one header for another; its buttons come in one after another (--i).
  const action = (
    <div className="cw-edit-actions" data-editing={editing || undefined}>
      {touch && phone ? (
        // A phone: the pencil alone, no button around it.
        <button ref={editButton} type="button" className="cw-edit-open cw-edit-icon" inert={editing} onClick={() => setOpened(true)} aria-label="Edit Continue Watching">
          <Edit size={20} />
        </button>
      ) : touch ? (
        <Button ref={editButton} size="sm" variant="glass" className="cw-edit-open" inert={editing} onClick={() => setOpened(true)} aria-label="Edit Continue Watching">
          Edit
        </Button>
      ) : (
        <span className="cw-edit-hint t-callout faint" aria-hidden={editing}>
          Hold <kbd>Shift</kbd> to select
        </span>
      )}
      <div className="cw-edit-bar" role="toolbar" aria-label="Edit Continue Watching" inert={!editing}>
        <span className="cw-edit-count t-callout faint tabular" role="status">
          {n ? `${n} selected` : "Select titles to remove"}
        </span>
        <button
          type="button"
          className={buttonClass("glass", true, "cw-edit-btn pressable")}
          style={{ "--i": 0 } as CSSProperties}
          aria-label={all ? "Deselect All" : "Select All"}
          title={all ? "Deselect all" : "Select all"}
          aria-pressed={all}
          onClick={() => setPicked(all ? new Set() : new Set(items.map((p) => p.videoId)))}
        >
          <CheckAll size={18} />
        </button>
        <button
          type="button"
          className={buttonClass("glass", true, "cw-edit-btn confirm-delete pressable")}
          style={{ "--i": 1 } as CSSProperties}
          disabled={!n}
          aria-label={armed ? "Click again to remove" : `Remove ${n} from Continue Watching`}
          title={armed ? "Click again to remove" : n ? `Remove ${n} from Continue Watching` : "Nothing selected"}
          {...confirm}
        >
          <TrashLid size={18} />
        </button>
        <button
          type="button"
          className={buttonClass("glass", true, "cw-edit-btn pressable")}
          style={{ "--i": 2 } as CSSProperties}
          aria-label="Done"
          title="Done"
          onClick={done}
        >
          <Close size={18} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={box}
      className="cw-edit"
      data-editing={editing || undefined}
      onKeyDown={(e) => {
        if (editing && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          done();
        }
      }}
    >
      <Row title="Continue Watching" shape="landscape" order={order} action={action}>
        {/* Each card is wrapped the same way selecting or not, so nothing is remounted when Shift goes down. */}
        {items.map((p, i) => (
          <div key={p.videoId} className="cw-select" data-selected={picked.has(p.videoId) || undefined} style={{ "--i": Math.min(i, 8) } as CSSProperties}>
            <div className="cw-select-card" inert={editing}>
              {card(p)}
            </div>
            <button
              type="button"
              role="checkbox"
              aria-checked={picked.has(p.videoId)}
              aria-label={p.season != null ? `${p.name}, season ${p.season} episode ${p.episode}` : p.name}
              className="cw-select-toggle"
              inert={!editing}
              onClick={() => toggle(p.videoId)}
            >
              <span className="cw-select-mark" aria-hidden>
                <Check size={16} />
              </span>
            </button>
          </div>
        ))}
      </Row>
    </div>
  );
}

/** Whether Shift is held, not while typing in a field (a capital letter isn't a request to select). */
function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => e.key === "Shift" && !e.repeat && !typing(e.target) && setHeld(true);
    const up = (e: KeyboardEvent) => e.key === "Shift" && setHeld(false);
    // A Shift let go in another window never comes back as a keyup here.
    const lost = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", lost);
    };
  }, []);
  return held;
}

/** A touch screen, with no Shift to hold: Edit is a button there. */
function useCoarsePointer(): boolean {
  const [coarse] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  return coarse;
}
