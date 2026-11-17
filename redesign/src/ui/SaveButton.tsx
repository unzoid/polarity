import { BookmarkIcon } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid } from "@heroicons/react/24/solid";
import { useLibrary, useToggleLibrary } from "../../../src/lib/net";
import type { MetaPreview } from "../../../src/lib/types";
import { Button } from "./Button";

/** Save to or remove from the Library. Reads "Saved" once it's in. */
export function SaveButton({ item, size = "regular" }: { item: MetaPreview; size?: "regular" | "large" }) {
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const saved = !!library?.some((l) => l.id === item.id);
  return (
    <Button
      kind="secondary"
      size={size}
      icon={saved ? BookmarkSolid : BookmarkIcon}
      aria-pressed={saved}
      disabled={!library}
      onClick={() => toggle.mutate(item)}
    >
      {saved ? "Saved" : "Save"}
    </Button>
  );
}
