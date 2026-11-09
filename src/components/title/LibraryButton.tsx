import type { Ref } from "react";
import { useLibrary, useToggleLibrary } from "../../lib/net";
import type { MetaPreview } from "../../lib/types";
import { Check, Plus } from "../icons";
import { SwapIcon } from "../SwapIcon";
import { Button, IconButton } from "../ui/Button";

/** Whether `item` is in the Library (undefined until that's known), what toggling it says, and toggling it. */
export function useLibraryToggle(item: MetaPreview) {
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const inLibrary = library && library.some((l) => l.id === item.id);
  return { inLibrary, label: inLibrary ? "Remove from Library" : "Add to Library", toggle: () => toggle.mutate(item) };
}

/**
 * Add to or remove from the Library (docs/ui-components.md U5): the + / ✓ button of the heroes and title pages.
 * `labelled`: a pill with its word beside the glyph, for a phone's featured card (Play | Save, side by side).
 */
export function LibraryButton({
  item,
  labelled = false,
  ref,
  native,
}: {
  item: MetaPreview;
  labelled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  /** iOS draws it over this one (NativeButtons.tsx): this keeps its place, unseen. */
  native?: boolean;
}) {
  const { inLibrary, label, toggle } = useLibraryToggle(item);
  const glyph = <SwapIcon state={inLibrary === undefined ? undefined : inLibrary ? "in" : "out"}>{inLibrary ? <Check size={20} /> : <Plus size={20} />}</SwapIcon>;
  if (labelled) {
    return (
      <Button ref={ref} variant="glass" onClick={toggle} aria-label={label} aria-pressed={inLibrary} data-native-button={native || undefined}>
        {glyph}
        {inLibrary ? "Saved" : "Save"}
      </Button>
    );
  }
  return (
    <IconButton ref={ref} variant="glass" onClick={toggle} label={label} title={label} aria-pressed={inLibrary}>
      {glyph}
    </IconButton>
  );
}
