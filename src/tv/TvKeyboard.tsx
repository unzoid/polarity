import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Backspace } from "../components/icons";
import { TV_OSK_EVENT, useGamepadConnected, type TvOskKey } from "./gamepad";
import { playSound } from "./sounds";
import { PadGlyph } from "./TvChrome";

const KEYS = [..."abcdefghijklmnopqrstuvwxyz1234567890'-"];

/**
 * The on-screen keyboard: a text line with a caret, Space / Delete / Clear,
 * then letters and digits. A real keyboard types straight in too.
 *
 * `caps` is for names rather than searches: each word starts with a capital
 * (like a phone keyboard), Shift flips the case of the next letter, and a
 * real keyboard's case is kept. Without it everything is lowercase.
 */
export function TvKeyboard({
  text,
  onChange,
  onSubmit,
  placeholder,
  active,
  max = 60,
  caps = false,
}: {
  text: string;
  onChange: (text: string) => void;
  /** Enter pressed in the text field (rather than on an on-screen key). */
  onSubmit?: () => void;
  placeholder: string;
  /** Whether a real keyboard should type here (the screen is on top). */
  active: boolean;
  max?: number;
  caps?: boolean;
}) {
  const field = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const [shift, setShift] = useState(false);
  const autoCap = caps && (text === "" || text.endsWith(" "));
  const upper = caps && autoCap !== shift;

  const textRef = useRef(text);
  textRef.current = text;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const set = (t: string) => changeRef.current(t.slice(0, max));
  const type = (s: string) => {
    set(textRef.current + s);
    setShift(false);
  };
  const erase = () => set(textRef.current.slice(0, -1));
  const connected = useGamepadConnected();

  // Keep the end of long queries and the caret in view once past ~22 characters.
  useLayoutEffect(() => {
    const el = field.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [text]);

  // Controller shortcuts while focused in the keyboard pane: Y inserts Space, X deletes.
  useEffect(() => {
    if (!active) return;
    const onOsk = (e: Event) => {
      const button = (e as CustomEvent<TvOskKey>).detail;
      if (button === "y") {
        if (textRef.current.length >= max) return playSound("edge");
        type(" ");
        playSound("select");
      } else if (button === "x") {
        if (!textRef.current) return playSound("edge");
        erase();
        playSound("back");
      }
    };
    window.addEventListener(TV_OSK_EVENT, onOsk);
    return () => window.removeEventListener(TV_OSK_EVENT, onOsk);
  }, [active, max]);

  // A physical keyboard types without visiting the on-screen keys. Capture
  // phase, so Backspace deletes a letter before it can mean "Back" (once the
  // field is empty, it's Back again).
  //
  // Typing on it moves focus off the on-screen key you were on and into the
  // field, so Enter afterwards searches instead of pressing that key.
  useEffect(() => {
    if (!active) return;
    const toField = () => {
      if (keys.current?.contains(document.activeElement)) field.current?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 && /[\p{L}\p{N} '&:-]/u.test(e.key)) {
        e.preventDefault();
        type(caps ? e.key : e.key.toLowerCase());
        toField();
      } else if (e.key === "Backspace" && textRef.current) {
        e.preventDefault();
        erase();
        toField();
      } else if (e.key === "Enter" && document.activeElement === field.current && submitRef.current) {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // type/erase only read refs, so they needn't be dependencies.
  }, [active, caps, max]);

  return (
    <>
      {/* Clickable (focus leaves the on-screen keys), but not a stop for the arrows: tabIndex -1. */}
      <div ref={field} className="tv-search-field" tabIndex={-1} role="textbox" aria-label={placeholder} aria-live="polite" data-nav-keep>
        {/* Empty: the caret waits at the start, where typing begins, before the placeholder. */}
        {text ? <span>{text}</span> : <span className="tv-caret" aria-hidden />}
        {text ? <span className="tv-caret" aria-hidden /> : <span className="tv-search-placeholder">{placeholder}</span>}
      </div>
      <div ref={keys} className="tv-osk-keyboard">
      <div className="tv-osk-row" data-caps={caps || undefined} data-nav-memory>
        {caps && (
          <button
            className="tv-key tv-key-wide"
            aria-label="Shift"
            aria-pressed={upper}
            onClick={() => setShift((s) => !s)}
          >
            <ArrowUp size={24} />
          </button>
        )}
        <button className="tv-key tv-key-wide" onClick={() => type(" ")}>
          Space
          {connected && <PadGlyph button="y" />}
        </button>
        <button className="tv-key tv-key-wide" onClick={erase} aria-label="Delete">
          <Backspace size={26} />
          {connected && <PadGlyph button="x" />}
        </button>
        <button className="tv-key tv-key-wide" onClick={() => set("")}>
          Clear
        </button>
      </div>
      <div className="tv-osk-keys" data-nav-memory>
        {KEYS.map((k) => (
          <button key={k} className="tv-key" data-nav-default={k === "a" || undefined} onClick={() => type(upper ? k.toUpperCase() : k)}>
            {upper ? k.toUpperCase() : k}
          </button>
        ))}
      </div>
      </div>
    </>
  );
}
