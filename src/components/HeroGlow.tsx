import { useEffect, useState, type CSSProperties } from "react";
import { glowColor, type Rgb } from "../lib/ui";
import { loadReadable, pixelsOf } from "./TitleLogo";

/** Each picture's colour, measured once: null when it can't be read. */
const colours = new Map<string, Promise<Rgb | null>>();

/** Pixels across the part measured: plenty for a colour. */
const SAMPLE_W = 24;
/**
 * The part of a backdrop a phone's featured card shows (cards.css): the middle third or so across, all the way
 * down. The colour comes from what's seen, not from the sides the card crops away.
 */
const SHOWN = { x0: 0.32, y0: 0, x1: 0.68, y1: 1, scrim: 0 };

function measure(src: string): Promise<Rgb | null> {
  let c = colours.get(src);
  if (!c) {
    c = loadReadable(src)
      .then((img) => {
        const px = img && pixelsOf(img, SAMPLE_W, SHOWN);
        return px ? glowColor(px, SAMPLE_W) : null;
      })
      .catch(() => null);
    colours.set(src, c);
  }
  return c;
}

/**
 * A phone's Home behind its featured title, as Netflix's: the art's most prominent colour shining in from the
 * top right corner and fading into the page (`glowColor`). The colour changes with the title, eased (cards.css);
 * the next title's is measured ahead, so it's ready when the card turns. Until a colour is known, nothing shows.
 */
export function HeroGlow({ src, next }: { src?: string; next?: string }) {
  const [colour, setColour] = useState<Rgb | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    void measure(src).then((c) => live && c && setColour(c));
    if (next) void measure(next);
    return () => {
      live = false;
    };
  }, [src, next]);
  return <div className="hero-glow" aria-hidden data-shown={!!colour} style={colour ? ({ "--glow": `rgb(${colour.join(" ")})` } as CSSProperties) : undefined} />;
}
