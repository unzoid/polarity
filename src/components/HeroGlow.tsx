import { useEffect, useRef, useState, type CSSProperties } from "react";
import { glowColor, type Rgb } from "../lib/ui";
import { usePageOnTop } from "./BackdropTrailer";
import { loadReadable, pixelsOf } from "./TitleLogo";

/** Each picture's colour, measured once: null when it can't be read. */
const colours = new Map<string, Promise<Rgb | null>>();
/** Glows showing on the page on top (Home's and the Anime tab's can both be mounted). */
let lighting = 0;

/** Pixels across the part measured: plenty for a colour. */
const SAMPLE_W = 24;
/**
 * The part of a backdrop a phone's featured card shows (cards.css): the middle third or so across, all the way
 * down. The colour comes from what's seen, not from the sides the card crops away.
 */
const SHOWN = { x0: 0.32, y0: 0, x1: 0.68, y1: 1, scrim: 0 };
/** Elsewhere the card shows the whole backdrop. */
const WHOLE = { x0: 0, y0: 0, x1: 1, y1: 1, scrim: 0 };

/** What the card shows of the backdrop: a phone's middle third, or (elsewhere) the whole of it. */
export type GlowArea = "middle" | "whole";

function measure(src: string, area: GlowArea): Promise<Rgb | null> {
  const key = `${area} ${src}`;
  let c = colours.get(key);
  if (!c) {
    c = loadReadable(src)
      .then((img) => {
        const px = img && pixelsOf(img, SAMPLE_W, area === "middle" ? SHOWN : WHOLE);
        return px ? glowColor(px, SAMPLE_W) : null;
      })
      .catch(() => null);
    colours.set(key, c);
  }
  return c;
}

/**
 * Home behind its featured title, as Netflix's: the page takes a dark shade of the art's colour (`glowColor`),
 * strongest at the top and fading evenly down the window into the page, on a phone and elsewhere alike. The colour
 * changes with the title, eased (cards.css); the next title's is measured ahead, so it's ready when the card turns.
 * Until a colour is known, nothing shows.
 */
export function HeroGlow({ src, next, area = "whole" }: { src?: string; next?: string; area?: GlowArea }) {
  const [colour, setColour] = useState<Rgb | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const onTop = usePageOnTop(ref);
  // While it shows on the page on top, the top bar leaves its dark shade off (shell.css): it would dim the glow.
  const lit = !!colour && onTop;
  useEffect(() => {
    if (!lit) return;
    lighting++;
    document.documentElement.dataset.heroGlow = "";
    return () => {
      if (--lighting === 0) delete document.documentElement.dataset.heroGlow;
    };
  }, [lit]);
  useEffect(() => {
    if (!src) return;
    let live = true;
    void measure(src, area).then((c) => live && c && setColour(c));
    if (next) void measure(next, area);
    return () => {
      live = false;
    };
  }, [src, next, area]);
  return <div ref={ref} className="hero-glow" aria-hidden data-shown={!!colour} style={colour ? ({ "--glow": `rgb(${colour.join(" ")})` } as CSSProperties) : undefined} />;
}
