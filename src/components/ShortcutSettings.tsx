import { useEffect, useRef, useState } from "react";
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  GROUPS,
  MAX_BINDINGS,
  RESERVED,
  bind,
  comboLabel,
  comboOf,
  resetBindings,
  unbind,
  useBindings,
  type Action,
} from "../lib/settings";
import { Close, Plus, Reset } from "./icons";
import { SearchField } from "./ui/SearchField";
import { Button } from "./ui/Button";

/**
 * Settings → Controls & TV → Keyboard Shortcuts, laid out like an editor's
 * keybindings page: a search field, grouped rows, each key its own keycap.
 * Click a shortcut and press the new keys; while you hold modifiers they
 * show up as you go.
 */
export function ShortcutSettings() {
  const bindings = useBindings();
  const [query, setQuery] = useState("");
  const customized = ACTIONS.some((a) => bindings[a.id].join() !== DEFAULT_BINDINGS[a.id].join());

  const q = query.trim().toLowerCase();
  const matches = (a: (typeof ACTIONS)[number]) =>
    !q ||
    a.label.toLowerCase().includes(q) ||
    bindings[a.id].some((c) => comboLabel(c).join(" ").toLowerCase().includes(q) || c.toLowerCase().includes(q));

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">Keyboard Shortcuts</h2>
      <div className="shortcut-toolbar">
        <SearchField className="shortcut-search" value={query} onChange={setQuery} label="Search shortcuts" placeholder="Search shortcuts" />
        <Button disabled={!customized} onClick={() => resetBindings()}>
          <Reset size={15} />
          Reset All
        </Button>
      </div>

      {GROUPS.map((g) => {
        const actions = ACTIONS.filter((a) => a.group === g.id && matches(a));
        if (!actions.length) return null;
        return (
          <div key={g.id} className="shortcut-group">
            <h3 className="shortcut-group-title">{g.label}</h3>
            <div className="settings-card">
              {actions.map((a) => (
                <ShortcutRow key={a.id} action={a.id} label={a.label} when={a.when ?? g.when} />
              ))}
            </div>
          </div>
        );
      })}
      {GROUPS.every((g) => !ACTIONS.some((a) => a.group === g.id && matches(a))) && (
        <p className="settings-footer">No shortcuts match “{query.trim()}”.</p>
      )}
      <p className="settings-footer">
        Click a shortcut to change it, then press the new keys. Esc cancels; Backspace removes it.
      </p>
    </section>
  );
}

const actionLabel = (id: Action) => ACTIONS.find((a) => a.id === id)?.label ?? id;

function Keycaps({ combo }: { combo: string }) {
  return (
    <span className="keycaps">
      {comboLabel(combo).map((k, i) => (
        <kbd key={i} className="keycap">
          {k}
        </kbd>
      ))}
    </span>
  );
}

const heldModifiers = (e: KeyboardEvent) =>
  [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean) as string[];

function ShortcutRow({ action, label, when }: { action: Action; label: string; when: string }) {
  const bindings = useBindings();
  const combos = bindings[action];
  const [capturing, setCapturing] = useState<number | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const restoreTarget = useRef<{ kind: "slot"; slot: number } | { kind: "add" } | null>(null);
  const changed = combos.join() !== DEFAULT_BINDINGS[action].join();

  useEffect(() => {
    if (capturing != null || !restoreTarget.current) return;
    const target = restoreTarget.current;
    restoreTarget.current = null;
    const row = rowRef.current;
    if (!row) return;
    const btn =
      target.kind === "add"
        ? (row.querySelector<HTMLButtonElement>("[data-add]") ??
          row.querySelector<HTMLButtonElement>(`button.shortcut-combo[data-slot="${Math.max(0, combos.length - 1)}"]`))
        : (row.querySelector<HTMLButtonElement>(`button.shortcut-combo[data-slot="${target.slot}"]`) ??
          row.querySelector<HTMLButtonElement>(`button.shortcut-combo[data-slot="${Math.max(0, combos.length - 1)}"]`));
    btn?.focus({ preventScroll: true });
  }, [capturing, combos.length]);

  useEffect(() => {
    if (capturing == null) return;
    setHeld([]);
    const finishTo = (target: { kind: "slot"; slot: number } | { kind: "add" }) => {
      restoreTarget.current = target;
      setCapturing(null);
    };
    // Capture phase, ahead of every other shortcut in the app.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return finishTo(capturing >= combos.length ? { kind: "add" } : { kind: "slot", slot: capturing });
      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey) {
        if (capturing < combos.length) unbind(action, capturing);
        return finishTo({ kind: "slot", slot: Math.max(0, Math.min(capturing, combos.length - 2)) });
      }
      const combo = comboOf(e);
      if (!combo) return setHeld(heldModifiers(e)); // a modifier on its own: show it, wait for the key
      if (RESERVED.has(e.key)) return setNote(`${comboLabel(combo).join("+")} can't be used: it's reserved.`);
      const stolen = bind(action, capturing, combo);
      setNote(stolen ? `Removed from “${actionLabel(stolen)}”.` : null);
      finishTo({ kind: "slot", slot: capturing });
    };
    const onUp = (e: KeyboardEvent) => setHeld(heldModifiers(e));
    const cancel = () => setCapturing(null);
    // A click anywhere else cancels, as Esc does, without pulling focus back from what was clicked.
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".shortcut-capture")) cancel();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", cancel);
    };
  }, [capturing, action, combos.length]);

  const start = (i: number) => {
    setNote(null);
    setCapturing(capturing === i ? null : i);
  };
  const cancelCapture = (i: number) => {
    restoreTarget.current = i >= combos.length ? { kind: "add" } : { kind: "slot", slot: i };
    setCapturing(null);
  };
  const adding = capturing === combos.length;

  return (
    <div ref={rowRef} className="shortcut-row" data-capturing={capturing != null || undefined}>
      <span className="shortcut-text">
        <span className="shortcut-label">
          {label}
          {changed && <span className="shortcut-modified" title="Changed from the default" />}
        </span>
        <span className="shortcut-when" data-note={note ? "" : undefined}>
          {note ?? when}
        </span>
      </span>

      <span className="shortcut-keys">
        {/* Row tools sit left of the keys and show on hover, like an editor's. */}
        {changed && capturing == null && (
          <button
            className="shortcut-tool"
            title="Reset to default"
            aria-label={`Reset ${label} to default`}
            onClick={() => {
              setNote(null);
              resetBindings(action);
            }}
          >
            <Reset size={14} />
          </button>
        )}
        {combos.length < MAX_BINDINGS && capturing == null && (
          <button
            data-add=""
            className="shortcut-tool"
            title="Add another shortcut"
            aria-label={`Add a shortcut for ${label}`}
            onClick={() => start(combos.length)}
          >
            <Plus size={14} />
          </button>
        )}

        {combos.length === 0 && !adding && (
          <button className="shortcut-combo" data-empty data-slot={0} onClick={() => start(0)}>
            Not set
          </button>
        )}
        {combos.map((combo, i) => (
          <span key={combo} className="shortcut-slot">
            {i > 0 && <span className="shortcut-or">or</span>}
            {capturing === i ? (
              <Capture held={held} onCancel={() => cancelCapture(i)} />
            ) : (
              <button
                className="shortcut-combo"
                data-slot={i}
                aria-label={`${label}: ${comboLabel(combo).join(" ")}. Change`}
                title="Click to change"
                onClick={() => start(i)}
              >
                <Keycaps combo={combo} />
              </button>
            )}
          </span>
        ))}
        {adding && (
          <span className="shortcut-slot">
            {combos.length > 0 && <span className="shortcut-or">or</span>}
            <Capture held={held} onCancel={() => cancelCapture(combos.length)} />
          </span>
        )}
      </span>
    </div>
  );
}

function Capture({ held, onCancel }: { held: string[]; onCancel: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <span ref={ref} className="shortcut-combo shortcut-capture" tabIndex={-1} role="status">
      {held.length ? (
        <span className="keycaps">
          {held.map((k) => (
            <kbd key={k} className="keycap">
              {k}
            </kbd>
          ))}
          <span className="keycap keycap-ghost">…</span>
        </span>
      ) : (
        "Press keys…"
      )}
      <button className="shortcut-capture-cancel" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
        <Close size={12} strokeWidth={2.5} />
      </button>
    </span>
  );
}
