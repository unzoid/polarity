import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useFormFactor } from "../lib/ui";
import { artFocusX, focusPosition } from "../lib/ui";
import { loadReadable, pixelsOf } from "./TitleLogo";
import { nativeArtFocus, nativeArtFocusAvailable } from "../lib/platform";

/** Each picture's subject (artFocusX) and shape, measured once: null when it can't be read. */
const found = new Map<string, Promise<{ focus: number; aspect: number } | null>>();

const SAMPLE_W = 48;
/** The picture the system is asked about: wide enough for a face in a crowd to be found. */
const ASK_W = 480;

/** `img` as a small JPEG data URL; null when its pixels can't be read (no CORS). */
function small(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = ASK_W;
    canvas.height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * ASK_W));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

function measure(src: string) {
  let f = found.get(src);
  if (!f) {
    f = loadReadable(src)
      .then(async (img) => {
        if (!img || !img.naturalWidth) return null;
        const aspect = img.naturalWidth / img.naturalHeight;
        // iOS finds the faces (or what draws the eye); elsewhere, and when it finds nothing, the busy part of the picture.
        const picture = nativeArtFocusAvailable ? small(img) : null;
        const asked = picture ? await nativeArtFocus(picture) : null;
        if (asked !== null) return { focus: asked, aspect };
        const px = pixelsOf(img, SAMPLE_W);
        return px ? { focus: artFocusX(px, SAMPLE_W), aspect } : null;
      })
      .catch(() => null);
    found.set(src, f);
  }
  return f;
}

/**
 * A phone's title page shows a strip of a wide backdrop (detail.css, `--art-h` tall): this puts the strip on the
 * picture's subject rather than its middle, which often cuts the subject in half. `--art-x` for the art's
 * `object-position`, while `on`; the middle until the picture is measured, or when it can't be.
 */
export function useArtFocus(src: string | undefined, on: boolean): CSSProperties | undefined {
  const [x, setX] = useState<number | null>(null);
  useEffect(() => {
    setX(null);
    if (!src || !on) return;
    let live = true;
    void measure(src).then((m) => {
      if (!live || !m) return;
      // The art box: the screen's width, `--art-h` (min(64svh, 150vw)) tall.
      const boxAspect = window.innerWidth / Math.min(window.innerHeight * 0.64, window.innerWidth * 1.5);
      setX(focusPosition(m.focus, boxAspect / m.aspect));
    });
    return () => {
      live = false;
    };
  }, [src, on]);
  return x === null ? undefined : ({ "--art-x": `${Math.round(x * 100)}%` } as CSSProperties);
}

/** A title page's art box (`.detail-bg`), its art placed on `src`'s subject on a phone (useArtFocus). */
export function DetailArt({ src, children }: { src: string | undefined; children: ReactNode }) {
  const style = useArtFocus(src, useFormFactor().form === "phone");
  return (
    <div className="detail-bg" aria-hidden style={style}>
      {children}
    </div>
  );
}
