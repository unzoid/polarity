import { useEffect, useState } from "react";
import { onSeriesChange, type SeriesChange } from "../../lib/anime";
import { usePresence } from "../../lib/ui";
import { Close } from "../icons";
import { Button, IconButton } from "../ui/Button";
import { TOAST_OUT_MS, Toast } from "../ui/Toast";

/** How long the notice stays: long enough to notice a wrong pick and undo it. */
export const SERIES_PICK_MS = 10_000;

/**
 * Says which series an anime plays from right after "Wrong series?" changed it (#335), with Undo: a pick
 * made by mistake, or "Use Polarity's match", is put back as it was, on every device.
 */
export function SeriesPickToast() {
  const [change, setChange] = useState<SeriesChange | null>(null);
  useEffect(() => onSeriesChange(setChange), []);
  useEffect(() => {
    if (!change) return;
    const t = setTimeout(() => setChange(null), SERIES_PICK_MS);
    return () => clearTimeout(t);
  }, [change]);
  const { shown, leaving } = usePresence(change, TOAST_OUT_MS);
  if (!shown) return null;
  const undo = () => {
    shown.undo();
    setChange(null);
  };
  const actions = (
    <>
      <Button size="sm" variant="glass" className="toast-action" onClick={undo}>
        Undo
      </Button>
      <IconButton label="Dismiss" onClick={() => setChange(null)}>
        <Close size={18} />
      </IconButton>
    </>
  );
  return (
    <Toast actions={actions} leaving={leaving} data-kind="series-pick">
      <strong>{shown.name ? `Plays from ${shown.name} now` : "Back to Polarity's match"}</strong>
    </Toast>
  );
}
