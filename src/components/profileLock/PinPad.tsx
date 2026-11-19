import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { PIN_LENGTH } from "../../lib/account/pin";
import { playSound } from "../../tv/sounds";
import { isTvMode } from "../../tv/tvMode";
import { Backspace } from "../icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
const COLUMNS = 3;
const ROWS = KEYS.length / COLUMNS;

/**
 * Four dots and a keypad: digits by click, tap, a TV remote (arrows move between keys, as on the TV keyboard,
 * tv/TvKeyboard.tsx) or a real keyboard's digits and Backspace. Calls `onComplete` with the fourth digit while
 * keeping all four dots lit until the caller resolves or increments `failures` to shake and clear.
 */
export function PinPad({
  onComplete,
  disabled = false,
  failures = 0,
  label,
}: {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  failures?: number;
  label: string;
}) {
  const [digits, setDigits] = useState("");
  const [lastFailure, setLastFailure] = useState(failures);
  const digitsRef = useRef(digits);
  digitsRef.current = digits;
  if (failures !== lastFailure) {
    setLastFailure(failures);
    setDigits("");
    digitsRef.current = "";
  }
  const done = useRef(onComplete);
  done.current = onComplete;
  const off = useRef(disabled);
  off.current = disabled;
  const keysRef = useRef<HTMLDivElement>(null);

  const type = (d: string) => {
    if (off.current || digitsRef.current.length >= PIN_LENGTH) return;
    const next = (digitsRef.current + d).slice(0, PIN_LENGTH);
    digitsRef.current = next;
    setDigits(next);
    if (next.length === PIN_LENGTH) done.current(next);
  };
  const erase = () => {
    if (off.current || !digitsRef.current) return;
    const next = digitsRef.current.slice(0, -1);
    digitsRef.current = next;
    setDigits(next);
    if (!next && (document.activeElement as HTMLElement | null)?.dataset.slot === "11") {
      keysRef.current?.querySelector<HTMLButtonElement>('button[data-slot="10"]')?.focus();
    }
  };

  // A real keyboard types without the keys. Capture phase: Backspace deletes a digit before it can mean Back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        type(e.key);
      } else if (e.key === "Backspace" && digitsRef.current) {
        e.preventDefault();
        e.stopPropagation();
        erase();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // type/erase read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrows within the 3×4 keypad by slot coordinates, so 7/8/9 step cleanly down to 0/Delete.
  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const raw = (document.activeElement as HTMLElement | null)?.dataset.slot;
    if (raw == null) return;
    const slot = Number(raw);
    const row = Math.floor(slot / COLUMNS);
    const col = slot % COLUMNS;
    const keyAt = (s: number) => e.currentTarget.querySelector<HTMLButtonElement>(`button[data-slot="${s}"]:not(:disabled)`);

    let next: HTMLButtonElement | null = null;
    if (e.key === "ArrowLeft") {
      for (let c = col - 1; c >= 0; c--) {
        next = keyAt(row * COLUMNS + c);
        if (next) break;
      }
    } else if (e.key === "ArrowRight") {
      for (let c = col + 1; c < COLUMNS; c++) {
        next = keyAt(row * COLUMNS + c);
        if (next) break;
      }
    } else if (e.key === "ArrowUp" && row > 0) {
      next = keyAt((row - 1) * COLUMNS + col) ?? keyAt((row - 1) * COLUMNS + 1);
    } else if (e.key === "ArrowDown" && row < ROWS - 1) {
      next = keyAt((row + 1) * COLUMNS + col) ?? keyAt((row + 1) * COLUMNS + 1);
    }

    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    next.focus();
    if (isTvMode()) playSound("move");
  };

  return (
    <div className="pin-pad">
      <div
        key={failures}
        className="pin-dots"
        data-shake={failures > 0 || undefined}
        role="status"
        aria-label={`${label}: ${digits.length} of ${PIN_LENGTH} digits`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className="pin-dot" data-filled={i < digits.length || undefined} />
        ))}
      </div>
      <div ref={keysRef} className="pin-keys" onKeyDown={move}>
        {KEYS.map((k, i) =>
          k === "" ? (
            <span key={i} aria-hidden />
          ) : k === "del" ? (
            <button key={i} type="button" data-slot={i} className="pin-key" aria-label="Delete" onClick={erase} disabled={disabled || !digits}>
              <Backspace size={22} />
            </button>
          ) : (
            <button
              key={i}
              type="button"
              data-slot={i}
              className="pin-key"
              onClick={() => type(k)}
              disabled={disabled}
              autoFocus={k === "1"}
              data-nav-default={k === "1" || undefined}
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
