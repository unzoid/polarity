import { useEffect, useState } from "react";

/** The window the dock is drawn for at 1×: anything bigger scales its controls and menus up to match. */
const BASE_W = 1600;
const BASE_H = 900;
const MAX = 2;

const zoomFor = (w: number, h: number) => Math.round(Math.min(MAX, Math.max(1, Math.min(w / BASE_W, h / BASE_H))) * 100) / 100;

/**
 * How much the desktop dock (its title, timeline, buttons and menus) is scaled up, so a fullscreen
 * 1440p or 4K window gets controls as big, for its size, as a 900-line one (player.css `--pz`).
 */
export function useDockZoom(on: boolean) {
  const [zoom, setZoom] = useState(() => (on ? zoomFor(window.innerWidth, window.innerHeight) : 1));
  useEffect(() => {
    if (!on) return setZoom(1);
    const update = () => setZoom(zoomFor(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [on]);
  return zoom;
}
