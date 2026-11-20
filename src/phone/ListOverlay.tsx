import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLayer } from "../lib/ui";
import { IconClose } from "./icons";

/**
 * Netflix's full-screen chooser (its Categories, its seasons): the choices down the middle over the page, dimmed
 * and blurred, the current one white and bold, and a white round close at the foot. It fades in and out.
 */
export function ListOverlay<T extends string | number>({
  open,
  label,
  options,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  label: string;
  options: { id: T; label: string }[];
  value?: T;
  onPick: (id: T) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
    } else if (shown) {
      setLeaving(true);
      const t = window.setTimeout(() => {
        setShown(false);
        setLeaving(false);
      }, 180);
      return () => window.clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayer(panel, open, onClose, { modal: true });
  // The current choice in view when it opens.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "center" });
  }, [open]);
  if (!shown) return null;
  return createPortal(
    <div className="ph-list-overlay scheme-dark" ref={panel} role="dialog" aria-modal aria-label={label} data-leaving={leaving || undefined} tabIndex={-1}>
      <div className="ph-list-scroll">
        <ul>
          {options.map((o) => (
            <li key={o.id}>
              <button type="button" aria-current={o.id === value} onClick={() => onPick(o.id)}>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="ph-list-close" aria-label="Close" onClick={onClose}>
        <IconClose size={28} stroke={2.2} />
      </button>
    </div>,
    document.querySelector(".ph") ?? document.body,
  );
}
