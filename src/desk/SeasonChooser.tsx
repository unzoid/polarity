import { Popover, PopoverContent, PopoverTitle } from "@ui-sdk/react/popover";
import { useEffect, useRef, useState } from "react";
import { IconCheck } from "../phone/icons";
import { ListDialog } from "./ListDialog";

export interface SeasonOption {
  id: number;
  label: string;
  count?: number;
}

const FULLSCREEN_THRESHOLD = 10;

const countLabel = (n?: number) => (n != null && n > 0 ? `${n} Episode${n === 1 ? "" : "s"}` : undefined);

/**
 * Season selector: renders an anchored dropdown with each season's episode count next to it for shows
 * with fewer than 10 seasons, and switches to the fullscreen ListDialog when a show has 10+ seasons.
 */
export function SeasonChooser({
  label = "Seasons",
  options,
  value,
  currentLabel,
  onPick,
  triggerClassName = "dk-season",
  popupClassName = "dk-season-pop",
  disabled = false,
  resetKey,
}: {
  label?: string;
  options: readonly SeasonOption[];
  value?: number;
  currentLabel: string;
  onPick: (id: number) => void;
  triggerClassName?: string;
  popupClassName?: string;
  disabled?: boolean;
  resetKey?: boolean | number | string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const anchor = useRef({
    getBoundingClientRect: () => (triggerRef.current ?? document.body).getBoundingClientRect(),
  }).current;
  const closedAt = useRef(0);
  const fullscreen = options.length >= FULLSCREEN_THRESHOLD;

  useEffect(() => {
    setOpen(false);
  }, [resetKey]);

  const handleOpenChange = (next: boolean) => {
    if (!next && open) closedAt.current = performance.now();
    setOpen(next);
  };

  const choose = (id: number) => {
    onPick(id);
    handleOpenChange(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        disabled={disabled}
        aria-haspopup={fullscreen ? "dialog" : "listbox"}
        aria-expanded={open}
        onClick={() => {
          if (performance.now() - closedAt.current > 200) handleOpenChange(!open);
        }}
      >
        <span>{currentLabel}</span>
        <svg className="dk-season-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M2.5 5l4.5 4.5L11.5 5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {fullscreen ? (
        <ListDialog
          open={open}
          label={label}
          options={options.map((o) => ({ id: o.id, label: o.label, meta: countLabel(o.count) }))}
          value={value}
          onPick={choose}
          onClose={() => handleOpenChange(false)}
        />
      ) : (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverContent
            className={popupClassName}
            anchor={anchor}
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
          >
            <PopoverTitle className="dk-sr">{label}</PopoverTitle>
            <ul className="dk-season-menu" role="listbox" aria-label={label}>
              {options.map((o) => {
                const active = o.id === value;
                const eps = countLabel(o.count);
                return (
                  <li key={o.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className="dk-season-opt"
                      onClick={() => choose(o.id)}
                    >
                      <span className="dk-season-opt-check" aria-hidden>
                        {active && <IconCheck size={15} stroke={2.3} />}
                      </span>
                      <span className="dk-season-opt-label">{o.label}</span>
                      {eps && <span className="dk-season-opt-count tabular">{eps}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
