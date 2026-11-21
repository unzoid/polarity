import { Suspense, useEffect, useState } from "react";
import { type PlayRequest, useTitlePlayback } from "../../lib/playback";
import { lazyNamed, useFormFactor } from "../../lib/ui";
import { useDeskUi } from "../../desk/mode";
import { Sheet } from "../Sheet";
import { StreamList } from "../StreamList";

const SourcesOverlay = lazyNamed(() => import("../../phone/SourcesOverlay"), "SourcesOverlay");

/**
 * Play, and the source sheet it may need (docs/ui-components.md U5, U6). `play(req)` opens the player or, when
 * a source has to be chosen first, the sheet; `choose(req)` always opens the sheet (the "Choose source"
 * buttons). Render `<SourcePicker picker={...} />` once where the sheet belongs. `onOpen` hears the sheet
 * open and close (the page pauses its trailer behind it).
 */
export function useSourcePicker(onOpen?: (open: boolean) => void) {
  // Kept after closing, so the sheet keeps its content while it slides out.
  const [request, setRequest] = useState<PlayRequest | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !onOpen) return;
    onOpen(true);
    return () => onOpen(false);
  }, [open, onOpen]);
  const choose = (req: PlayRequest) => {
    setRequest(req);
    setOpen(true);
  };
  const play = useTitlePlayback(choose);
  return { play, choose, request, open, close: () => setOpen(false) };
}

export type SourcePickerState = ReturnType<typeof useSourcePicker>;

/** The source chooser: a full-screen overlay on phones and in the desk layout (src/desk), a side sheet in the classic one. */
export function SourcePicker({ picker }: { picker: SourcePickerState }) {
  const { request, open, close, play } = picker;
  const desk = useDeskUi();
  const phone = useFormFactor().form === "phone" || desk;
  const [everOpen, setEverOpen] = useState(open);
  if (open && !everOpen) setEverOpen(true);
  if (phone) {
    if (!everOpen) return null;
    return (
      <Suspense fallback={null}>
        <SourcesOverlay
          open={open}
          onClose={close}
          title="Sources"
          subtitle={request?.subtitle}
          request={request ? { type: request.type, videoId: request.videoId } : null}
          onPick={(s) => {
            close();
            if (request) play(request, s);
          }}
        />
      </Suspense>
    );
  }
  return (
    <Sheet open={open} onClose={close} title="Sources" subtitle={request?.subtitle} forgiveMisses>
      {request && (
        <StreamList
          type={request.type}
          videoId={request.videoId}
          onPick={(s) => {
            close();
            play(request, s);
          }}
        />
      )}
    </Sheet>
  );
}
