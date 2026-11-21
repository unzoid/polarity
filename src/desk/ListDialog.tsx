import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useLayoutEffect, useRef } from "react";
import { IconClose } from "../phone/icons";

/**
 * Netflix's chooser (Categories, a season, a list): the screen blurred and darkened, the choices in a centred column
 * that scrolls, the one in use white and the rest grey, and a white round ✕ at the foot.
 */
export function ListDialog<T extends string | number>({
  open,
  label,
  options,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  label: string;
  options: readonly { id: T; label: string; meta?: string }[];
  value?: T;
  onPick: (id: T) => void;
  onClose: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const at = list.current?.querySelector<HTMLElement>("[aria-current]");
    if (at && list.current) list.current.scrollTop = at.offsetTop - list.current.clientHeight / 2 + at.offsetHeight / 2;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogBackdrop className="dk-list-backdrop" />
      <DialogContent className="dk-list" initialFocus={() => list.current?.querySelector<HTMLElement>("[aria-current]") ?? list.current?.querySelector<HTMLElement>("button") ?? null}>
        <DialogTitle className="dk-sr">{label}</DialogTitle>
        <ul ref={list} className="dk-list-items">
          {options.map((o) => (
            <li key={o.id}>
              <button type="button" aria-current={o.id === value || undefined} onClick={() => onPick(o.id)}>
                <span>{o.label}</span>
                {o.meta && <span className="dk-list-meta">{o.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
        <DialogClose className="dk-list-close" aria-label="Close">
          <IconClose size={28} stroke={2} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
