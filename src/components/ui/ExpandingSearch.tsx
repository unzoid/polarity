import { useEffect, useRef, useState } from "react";
import { Close, Search } from "../icons";

/**
 * A search that waits as a round glass button among a toolbar's pills and opens
 * leftwards into a field when pressed, as the navbar's does (same clip-path
 * sweep, no layout animation). An empty field closes again on blur, Escape or a
 * click elsewhere; one with text stays open. Styling in styles/ui/search-field.css.
 */
export function ExpandingSearch({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Names the button and the field for screen readers. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(!!value);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // An empty field closes on a click anywhere else, even one that doesn't move focus.
  useEffect(() => {
    if (!open || value) return;
    const onDown = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      input.current?.blur();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, value]);

  return (
    <div ref={box} className={className ? `expanding-search ${className}` : "expanding-search"} data-open={open}>
      <button
        type="button"
        className="expanding-search-icon"
        aria-label={label}
        title={label}
        tabIndex={open ? -1 : 0}
        onClick={() => {
          setOpen(true);
          input.current?.focus();
        }}
      >
        <Search size={16} />
      </button>
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => !value && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (value) onChange("");
          else input.current?.blur();
        }}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={label}
        tabIndex={open ? 0 : -1}
      />
      {open && value && (
        <button
          type="button"
          className="expanding-search-clear"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <Close size={14} />
        </button>
      )}
    </div>
  );
}
