import { hideTitle, unhideTitle, useIsHidden } from "../../lib/library/hiddenTitles";
import type { MetaPreview } from "../../lib/types";
import { Hidden } from "../icons";
import { Button, IconButton } from "../ui/Button";

/** The title page's "Hide This Title" (lib/library/hiddenTitles.ts): a glyph button in its action row. */
export function HideTitleButton({ item }: { item: MetaPreview }) {
  const hidden = useIsHidden(item.id);
  const label = hidden ? "Unhide This Title" : "Hide This Title";
  return (
    <IconButton variant="glass" label={label} title={label} aria-pressed={hidden} onClick={() => (hidden ? unhideTitle(item.id) : hideTitle(item))}>
      <Hidden size={20} />
    </IconButton>
  );
}

/** Under a hidden title's actions: that it's hidden, and Unhide. */
export function HiddenTitleNote({ item }: { item: MetaPreview }) {
  if (!useIsHidden(item.id)) return null;
  return (
    <p className="detail-hidden-note t-callout" role="status">
      <Hidden size={18} aria-hidden />
      <span>Hidden from Home, Movies, Series and recommendations.</span>
      <Button size="sm" variant="glass" onClick={() => unhideTitle(item.id)}>
        Unhide
      </Button>
    </p>
  );
}
