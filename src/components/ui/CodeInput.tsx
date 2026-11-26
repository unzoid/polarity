import "../../styles/ui/code-input.css";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A one-time code as a row of cells, after Family's sign-in (measured off a 60 fps recording):
 * - one blue ring marks the next cell and slides there on a spring (≈120 ms, a touch of overshoot), rather than
 *   each cell lighting up on its own;
 * - a typed digit rolls up into its cell from below as the cell's placeholder 0 rolls out of the top (≈100 ms),
 *   and runs the other way when it's deleted;
 * - a wrong code shakes the row (`errorKey`).
 *
 * Under the cells is one ordinary <input>, so typing, pasting, the phone's number pad and the system's "from Mail"
 * code suggestion (autocomplete="one-time-code") all work as they do in any field; the cells only draw its value.
 */
export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once the last digit is in (typed or pasted). */
  onComplete?: (value: string) => void;
  length?: number;
  /** Cells per group, a dash between groups: 3 + 3 by default. */
  groups?: readonly number[];
  /** Change it (a counter) each time a code is refused: the row shakes and the cells turn red until the next digit. */
  errorKey?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label": string;
}

/** The ring's spring: ζ ≈ 0.65, so it lands ~6% past the cell and settles back. */
const RING = { type: "spring", stiffness: 620, damping: 32, mass: 1 } as const;

const roll: Variants = {
  // `dir` 1: typing (in from below, out the top); −1: deleting (the reverse).
  enter: (dir: number) => ({ y: dir > 0 ? "78%" : "-70%", opacity: 0.3 }),
  shown: { y: "0%", opacity: 1, transition: { y: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }, opacity: { duration: 0.18 } } },
  leave: (dir: number) => ({ y: dir > 0 ? "-70%" : "78%", opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }),
};
const fade: Variants = {
  enter: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.12 } },
  leave: { opacity: 0, transition: { duration: 0.1 } },
};

export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  groups = [3, 3],
  errorKey = 0,
  disabled = false,
  autoFocus = false,
  "aria-label": label,
}: CodeInputProps) {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const cells = useRef<(HTMLSpanElement | null)[]>([]);
  const [focused, setFocused] = useState(false);
  const [lefts, setLefts] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);
  // Which way the last edit went, for the digits' roll.
  const last = useRef(value);
  const dir = value.length >= last.current.length ? 1 : -1;
  useEffect(() => {
    last.current = value;
  }, [value]);

  // Where each cell sits in the row, for the ring.
  useLayoutEffect(() => {
    const measure = () => setLefts(cells.current.map((c) => c?.offsetLeft ?? 0));
    measure();
    const ro = new ResizeObserver(measure);
    if (row.current) ro.observe(row.current);
    return () => ro.disconnect();
  }, [length]);

  // A refused code: shake, show red until the next digit.
  const seen = useRef(errorKey);
  useEffect(() => {
    if (errorKey === seen.current) return;
    seen.current = errorKey;
    setWrong(true);
    if (reduce) return;
    // Web views without the Web Animations API (and the tests' DOM) just skip the shake.
    row.current?.animate?.(
      [{ transform: "none" }, { transform: "translateX(-9px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-6px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-2px)" }, { transform: "none" }],
      { duration: 380, easing: "ease-out" },
    );
  }, [errorKey, reduce]);

  const set = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, length);
    if (next === value) return;
    setWrong(false);
    onChange(next);
    if (next.length === length && value.length < length) onComplete?.(next);
  };

  // The caret always sits after the last digit: a cell is filled in order, as Family's are.
  const toEnd = () => {
    const el = input.current;
    if (el && document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
  };

  const at = Math.min(value.length, length - 1);
  const starts = groups.reduce<number[]>((acc, n) => [...acc, (acc.at(-1) ?? 0) + n], []).slice(0, -1);
  const variants = reduce ? fade : roll;

  return (
    <div className="code-input" data-focused={focused || undefined} data-wrong={wrong || undefined} data-disabled={disabled || undefined}>
      <div className="code-row" ref={row} aria-hidden>
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          return (
            <Fragment key={i}>
              {starts.includes(i) && <span className="code-dash" />}
              <span className="code-cell" data-filled={digit !== undefined || undefined} ref={(el) => void (cells.current[i] = el)}>
                <AnimatePresence initial={false} custom={dir}>
                  {digit !== undefined ? (
                    <motion.span key={`d${digit}`} className="code-glyph" custom={dir} variants={variants} initial="enter" animate="shown" exit="leave">
                      {digit}
                    </motion.span>
                  ) : (
                    <motion.span key="ph" className="code-glyph code-placeholder" custom={dir} variants={variants} initial="enter" animate="shown" exit="leave">
                      0
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </Fragment>
          );
        })}
        {lefts.length === length && (
          <motion.span
            className="code-ring"
            initial={false}
            animate={{ x: lefts[at] }}
            transition={reduce ? { duration: 0 } : RING}
          />
        )}
      </div>
      <input
        ref={input}
        className="code-field"
        aria-label={label}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={value}
        readOnly={disabled}
        autoFocus={autoFocus}
        onChange={(e) => set(e.target.value)}
        onFocus={() => {
          setFocused(true);
          requestAnimationFrame(toEnd);
        }}
        onBlur={() => setFocused(false)}
        onSelect={toEnd}
        onKeyDown={(e) => {
          // Left/Right/Home/End would move the caret off the end; there's nowhere else for it to be.
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) e.preventDefault();
        }}
      />
    </div>
  );
}
