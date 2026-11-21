import type { CSSProperties } from "react";

export type Edge = "top" | "right" | "bottom" | "left";

/** The gradient angle that runs from the clear side toward `edge`. */
const ANGLE: Record<Edge, number> = { top: 0, right: 90, bottom: 180, left: 270 };

/**
 * A progressive blur: what's beneath goes out of focus toward `edge`, with no hard line. The technique of
 * motion-primitives' ProgressiveBlur (MIT): `layers` stacked backdrop blurs, each a little stronger than the
 * last and masked to its own overlapping band, so any point is under about three small blurs instead of every
 * layer at full radius. A tint (`::before`, `--edge-tint`) darkens toward the edge. `--edge-strength` scales
 * every radius, `--edge-shown` fades the whole thing (see `.edge-blur` in cards.css): opacity on the element
 * itself would cut the layers off from the page behind them.
 * Layer `i`'s radius is `step × (i + 1)^curve`: 1 grows evenly; above 1 starts barely blurred and gathers toward the
 * edge, so a tall band reads as one gradual blur rather than a smeared strip.
 */
export function EdgeBlur({
  className,
  edge = "bottom",
  layers = 6,
  step = 3,
  curve = 1,
  strength = 1,
}: {
  className?: string;
  edge?: Edge;
  layers?: number;
  step?: number;
  curve?: number;
  strength?: number;
}) {
  const n = Math.max(2, layers);
  return (
    <span className={className ? `edge-blur ${className}` : "edge-blur"} data-edge={edge} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={layerStyle(edge, i, n, step, curve, strength)} />
      ))}
    </span>
  );
}

/** Layer `i` of `n`: opaque over its two segments of the run toward the edge, fading over the ones either side. */
export function layerStyle(edge: Edge, i: number, n: number, step: number, curve = 1, strength = 1): CSSProperties {
  const seg = 100 / (n + 1);
  const stop = (k: number, on: boolean) => `${on ? "#000" : "transparent"} ${+(Math.min(k, n + 1) * seg).toFixed(2)}%`;
  const band = `linear-gradient(${ANGLE[edge]}deg, ${stop(i, false)}, ${stop(i + 1, true)}, ${stop(i + 2, true)}, ${stop(i + 3, false)})`;
  // Emit a flat `blur(Npx)` without nested calc()/var(): WebKit parses calc() inside `-webkit-backdrop-filter: var(...)` but paints zero blur.
  const radius = +(step * (i + 1) ** curve * strength).toFixed(2);
  return { "--band": band, "--edge-filter": `blur(${radius}px)` } as CSSProperties;
}
