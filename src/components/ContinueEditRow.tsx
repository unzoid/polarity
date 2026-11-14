import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { removeFromContinueWatching } from "../lib/library/titleActions";
import type { Progress } from "../lib/types";
import { Check } from "./icons";
import { Row } from "./Row";
import { Button } from "./ui/Button";

/**
 * Home's Continue Watching row, with Edit: the cards become checkboxes (the card itself goes inert, so a
 * click or Enter picks it rather than opening it), with Select All, Remove (n) and Done in the heading.
 * Remove does what each card menu's "Remove from Continue Watching" does (titleActions.ts): the video
 * goes back to its start, the rest of the title's history stays. Escape leaves Edit, as Done does.
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
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // What's picked and still in the row (a card can leave it while editing: played elsewhere, synced).
  const selected = useMemo(() => items.filter((p) => picked.has(p.videoId)), [items, picked]);
  const all = selected.length === items.length;
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Leaving Edit puts focus back on its button, so the keyboard isn't dropped at the top of the page.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);

  const done = () => {
    setEditing(false);
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

  const action = editing ? (
    <div className="cw-edit-bar" role="toolbar" aria-label="Edit Continue Watching">
      <span className="cw-edit-count t-callout faint" role="status">
        {selected.length ? `${selected.length} selected` : "Select titles to remove"}
      </span>
      <Button size="sm" variant="glass" onClick={() => setPicked(all ? new Set() : new Set(items.map((p) => p.videoId)))}>
        {all ? "Deselect All" : "Select All"}
      </Button>
      <Button size="sm" variant="danger" disabled={!selected.length} onClick={removeSelected}>
        Remove ({selected.length})
      </Button>
      <Button size="sm" variant="glass" onClick={done}>
        Done
      </Button>
    </div>
  ) : (
    <Button ref={editButton} size="sm" variant="glass" className="cw-edit-open" onClick={() => setEditing(true)} aria-label="Edit Continue Watching">
      Edit
    </Button>
  );

  return (
    <div
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
        {items.map((p) =>
          editing ? (
            <div key={p.videoId} className="cw-select" data-selected={picked.has(p.videoId) || undefined}>
              <div className="cw-select-card" inert>
                {card(p)}
              </div>
              <button
                type="button"
                role="checkbox"
                aria-checked={picked.has(p.videoId)}
                aria-label={p.season != null ? `${p.name}, season ${p.season} episode ${p.episode}` : p.name}
                className="cw-select-toggle"
                onClick={() => toggle(p.videoId)}
              >
                <span className="cw-select-mark" aria-hidden>
                  {picked.has(p.videoId) && <Check size={18} strokeWidth={3} />}
                </span>
              </button>
            </div>
          ) : (
            <Fragment key={p.videoId}>{card(p)}</Fragment>
          ),
        )}
      </Row>
    </div>
  );
}
