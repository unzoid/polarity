import { useEffect, useState } from "react";
import { onTitleHidden, unhideTitle } from "../lib/library/hiddenTitles";
import type { MetaPreview } from "../lib/types";
import { usePresence } from "../lib/ui";
import { Close, Hidden } from "./icons";
import { Button, IconButton } from "./ui/Button";
import { TOAST_OUT_MS, Toast } from "./ui/Toast";

/** How long the notice stays: long enough to undo a hide picked by mistake. */
export const HIDDEN_TOAST_MS = 8_000;

/**
 * Says a title was hidden ("Hide This Title"), with Undo. TV's toasts can't take focus, so there it
 * says where to unhide it instead: the title's page.
 */
export function HiddenTitleToast({ tv }: { tv: boolean }) {
  const [item, setItem] = useState<(MetaPreview & { key: number }) | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (!item && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }
  const paused = hovered || focused;
  useEffect(() => onTitleHidden((it) => setItem({ ...it, key: Date.now() })), []);
  useEffect(() => {
    if (!item || paused) return;
    const t = setTimeout(() => setItem(null), HIDDEN_TOAST_MS);
    return () => clearTimeout(t);
  }, [item, paused]);
  const { shown, leaving } = usePresence(item, TOAST_OUT_MS);
  if (!shown) return null;
  const undo = () => {
    unhideTitle(shown.id);
    setItem(null);
  };
  const actions = !tv && (
    <>
      <Button size="sm" variant="glass" className="toast-action" onClick={undo}>
        Undo
      </Button>
      <IconButton label="Dismiss" onClick={() => setItem(null)}>
        <Close size={18} />
      </IconButton>
    </>
  );
  return (
    <Toast
      key={shown.key}
      variant={tv ? "tv" : undefined}
      lines={tv}
      icon={<Hidden className="toast-icon" />}
      actions={actions}
      leaving={leaving}
      data-kind="title-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <strong>{shown.name} is hidden</strong>
      {tv && <span>Its page can unhide it.</span>}
    </Toast>
  );
}
