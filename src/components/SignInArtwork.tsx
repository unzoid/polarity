import { useEffect, useRef } from "react";

/**
 * Subtle ordered-dithered chromatic gradient artwork for the sign-in backdrop: an 8x8 Bayer
 * matrix dissolving a sculpted, multi-hue horizon drape (derived from `--accent`) cleanly into
 * `--bg` with a calm centre behind the form. Drawn once onto a lightweight 2D canvas at 2px CSS
 * cells (`image-rendering: pixelated`) and redrawn only on resize or theme/scheme change — zero
 * animation loop, zero WebGL overhead.
 */

// Classic 8x8 Bayer ordered dithering threshold matrix (0..63).
const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** Logical CSS pixels per crisp dither cell (exact integer multiple on 1x and 2x displays). */
const CELL = 2;

type Rgb = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rodrigues hue rotation around (1,1,1) to derive harmonious cool/warm siblings from `--accent`. */
function hueShift([r, g, b]: Rgb, rad: number): Rgb {
  const k = 0.57735027;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dot = k * (r + g + b);
  return [
    clamp01(r * c + (k * b - k * g) * s + k * dot * (1 - c)),
    clamp01(g * c + (k * r - k * b) * s + k * dot * (1 - c)),
    clamp01(b * c + (k * g - k * r) * s + k * dot * (1 - c)),
  ];
}

function vivid([r, g, b]: Rgb, sat: number): Rgb {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [clamp01(l + (r - l) * sat), clamp01(l + (g - l) * sat), clamp01(l + (b - l) * sat)];
}

/** Resolve a CSS colour token (including color-mix()) to [r, g, b] in 0–1 via a 1px canvas. */
function tokenRgb(el: Element, name: string): Rgb {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function paletteFor(accent: Rgb): [Rgb, Rgb, Rgb] {
  // Tight monochromatic-analogous purple palette anchored to `--accent` (deep indigo -> accent -> soft violet-lavender).
  const cMain = vivid(accent, 1.12);
  const cDeep = vivid(hueShift(accent, -0.14), 1.15);
  const cLift = vivid(hueShift(accent, 0.24), 1.1);
  const cSoft: Rgb = [
    clamp01(cLift[0] + (1 - cLift[0]) * 0.16),
    clamp01(cLift[1] + (1 - cLift[1]) * 0.12),
    clamp01(cLift[2] + (1 - cLift[2]) * 0.18),
  ];
  return [cDeep, cMain, cSoft];
}

const toCssRgb = ([r, g, b]: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

function paintDither(canvas: HTMLCanvasElement, w: number, h: number, bg: Rgb, [cDeep, cMain, cSoft]: [Rgb, Rgb, Rgb]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = w;
  canvas.height = h;

  const isLight = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] > 0.5;

  // Subtle peak tint and stepped Bayer quantisation levels.
  const peak = isLight ? 0.2 : 0.32;
  const levels = 3;

  const img = ctx.createImageData(w, h);
  const out = img.data;
  const bgR = bg[0] * 255;
  const bgG = bg[1] * 255;
  const bgB = bg[2] * 255;

  let idx = 0;
  for (let y = 0; y < h; y++) {
    const ny = h > 1 ? y / (h - 1) : 0;
    const rowOff = (y & 7) << 3;

    for (let x = 0; x < w; x++) {
      const nx = w > 1 ? x / (w - 1) : 0;

      // Natural upper purple horizon canopy: shallower above the centred logo (~21%) and curving
      // gently deeper toward the left/right edges (~35%) with a soft organic wave, fading cleanly
      // to exact 0 well above the login area — no circular cutout, no seam.
      const edge = Math.abs(nx - 0.5) * 2;
      const arch = 0.2 + 0.14 * Math.pow(edge, 1.65) + 0.025 * Math.sin(nx * 4.8 + 0.65) + 0.014 * Math.cos(nx * 8.5 - 0.4);
      const tTop = ny < arch ? 1 - ny / arch : 0;
      const raw = tTop > 0 ? tTop * tTop * (1.15 - 0.15 * tTop) : 0;

      if (raw <= 0) {
        out[idx] = bgR;
        out[idx + 1] = bgG;
        out[idx + 2] = bgB;
        out[idx + 3] = 255;
        idx += 4;
        continue;
      }

      // Multi-level 8x8 Bayer ordered dither.
      const threshold = (BAYER_8[rowOff + (x & 7)] + 0.5) / 64;
      const scaled = clamp01(raw) * levels;
      const base = Math.floor(scaled);
      const frac = scaled - base;
      const step = base + (frac > threshold ? 1 : 0);
      const amt = (step / levels) * peak;

      if (amt <= 0) {
        out[idx] = bgR;
        out[idx + 1] = bgG;
        out[idx + 2] = bgB;
        out[idx + 3] = 255;
      } else {
        // Subtle purple tonal sweep: deep indigo-purple left -> accent crown -> soft violet-lavender right.
        const huePos = clamp01(nx * 0.82 + ny * 0.22 + 0.08 * Math.sin(nx * 4.2 - ny * 2.5));
        let cr: number;
        let cg: number;
        let cb: number;
        if (huePos < 0.5) {
          const t = huePos * 2;
          cr = cDeep[0] + (cMain[0] - cDeep[0]) * t;
          cg = cDeep[1] + (cMain[1] - cDeep[1]) * t;
          cb = cDeep[2] + (cMain[2] - cDeep[2]) * t;
        } else {
          const t = (huePos - 0.5) * 2;
          cr = cMain[0] + (cSoft[0] - cMain[0]) * t;
          cg = cMain[1] + (cSoft[1] - cMain[1]) * t;
          cb = cMain[2] + (cSoft[2] - cMain[2]) * t;
        }
        out[idx] = bgR + (cr * 255 - bgR) * amt;
        out[idx + 1] = bgG + (cg * 255 - bgG) * amt;
        out[idx + 2] = bgB + (cb * 255 - bgB) * amt;
        out[idx + 3] = 255;
      }
      idx += 4;
    }
  }

  ctx.putImageData(img, 0, 0);
  canvas.dataset.ready = "";
}

export function SignInArtwork({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current!;
    const canvas = document.createElement("canvas");
    el.appendChild(canvas);

    let bg: Rgb = [0, 0, 0];
    let palette: [Rgb, Rgb, Rgb] = paletteFor([0.37, 0.36, 0.9]);
    const shell = el.closest<HTMLElement>(".account-shell");

    const readColors = () => {
      bg = tokenRgb(el, "--bg");
      palette = paletteFor(tokenRgb(el, "--accent"));
      // Share the exact left -> centre -> right purple stops with the sign-in inputs' gradient borders.
      if (shell) {
        shell.style.setProperty("--si-grad-1", toCssRgb(palette[0]));
        shell.style.setProperty("--si-grad-2", toCssRgb(palette[1]));
        shell.style.setProperty("--si-grad-3", toCssRgb(palette[2]));
      }
    };

    const draw = () => {
      const w = Math.max(1, Math.ceil(el.clientWidth / CELL));
      const h = Math.max(1, Math.ceil(el.clientHeight / CELL));
      paintDither(canvas, w, h, bg, palette);
    };

    readColors();
    draw();

    const resize = new ResizeObserver(draw);
    resize.observe(el);

    const themed = new MutationObserver(() => {
      readColors();
      draw();
    });
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-scheme"],
    });

    return () => {
      resize.disconnect();
      themed.disconnect();
      canvas.remove();
    };
  }, []);

  return <div ref={box} className={className} aria-hidden />;
}
