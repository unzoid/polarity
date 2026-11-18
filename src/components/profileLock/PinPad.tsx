import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { PIN_LENGTH } from "../../lib/account/pin";
import { Backspace } from "../icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
const COLUMNS = 3;

/**
 * Four dots and a keypad: digits by click, tap, a TV remote (arrows move between keys, as on the TV keyboard,
 * tv/TvKeyboard.tsx) or a real keyboard's digits and Backspace. Calls `onComplete` with the fourth digit and
 * starts empty again.
 */
export function PinPad({ onComplete, disabled = false, label }: { onComplete: (pin: string) => void; disabled?: boolean; label: string }) {
  const [digits, setDigits] = useState("");
  const digitsRef = useRef(digits);
  digitsRef.current = digits;
  const done = useRef(onComplete);
  done.current = onComplete;
  const off = useRef(disabled);
  off.current = disabled;

  const type = (d: string) => {
    if (off.current) return;
    const next = (digitsRef.current + d).slice(0, PIN_LENGTH);
    digitsRef.current = next;
    if (next.length === PIN_LENGTH) {
      setDigits("");
      digitsRef.current = "";
      done.current(next);
    } else setDigits(next);
  };
  const erase = () => setDigits((d) => d.slice(0, -1));

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

  // Arrows within the keypad, three to a row.
  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (!step) return;
    const keys = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = keys.indexOf(document.activeElement as HTMLButtonElement);
    const next = keys[i + step];
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  };

  return (
    <div className="pin-pad">
      <div className="pin-dots" role="status" aria-label={`${label}: ${digits.length} of ${PIN_LENGTH} digits`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className="pin-dot" data-filled={i < digits.length || undefined} />
        ))}
      </div>
      <div className="pin-keys" onKeyDown={move}>
        {KEYS.map((k, i) =>
          k === "" ? (
            <span key={i} aria-hidden />
          ) : k === "del" ? (
            <button key={i} type="button" className="pin-key" aria-label="Delete" onClick={erase} disabled={disabled || !digits}>
              <Backspace size={22} />
            </button>
          ) : (
            <button key={i} type="button" className="pin-key" onClick={() => type(k)} disabled={disabled} autoFocus={k === "1"}>
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
